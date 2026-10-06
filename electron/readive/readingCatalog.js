import crypto from 'node:crypto';
import path from 'node:path';
import { readSharedReadingList, sharedReadingLists } from '../servers/shared/readingCatalog.js';
import { readReadiveLibraryEntries, registeredReadiveLibraries, resolveReadiveLibraryPath, validateReadiveLibrary } from './catalog.js';
import { cleanRelativePath, fail, READIVE_LIMITS } from './policy.js';
import { readReadivePreview } from './preview.js';
import { readiveFileFormat } from './manifest.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const entryKey = filePath => hash(process.platform === 'win32' ? filePath.toLowerCase() : filePath).slice(0, 32);
const checkCancelled = signal => { if (signal?.aborted) throw fail('catalog_cancelled', 409); };

export class ReadiveReadingCatalog {
    constructor({ getState, getLibraryDb, getRegisteredLibraries, getConfig }) {
        this.getState = getState;
        this.getLibraryDb = getLibraryDb;
        this.getRegisteredLibraries = getRegisteredLibraries;
        this.getConfig = getConfig;
    }

    descriptors() {
        return sharedReadingLists(this.getConfig()).map(list => ({
            ...list, listId: list.id, id: hash(`${this.getState().serverId}\0reading:${list.id}`).slice(0, 32),
        }));
    }

    has(libraryId) {
        return this.descriptors().some(list => list.id === libraryId);
    }

    async libraries() {
        const db = await this.getLibraryDb();
        return db?.withLock && db?.getConnection ? this.descriptors().map(({ id, name }) => ({ id, name })) : [];
    }

    async location(libraryId, relativePath = '') {
        const descriptor = this.descriptors().find(list => list.id === libraryId);
        if (!descriptor) throw fail('library_unavailable', 409);
        if (typeof relativePath !== 'string' || relativePath.length > 2048) throw fail('invalid_library_path');
        if (relativePath) {
            try { cleanRelativePath(relativePath); } catch { throw fail('invalid_library_path'); }
        }
        const parts = relativePath ? relativePath.split('/') : [];
        const collectionId = descriptor.listId === 'collections' ? parts.shift() || '' : '';
        const db = await this.getLibraryDb();
        if (!db?.withLock || !db?.getConnection) throw fail('library_unavailable', 409);
        let result;
        try { result = await readSharedReadingList(db, descriptor.listId, collectionId); }
        catch (error) {
            if (error.message === 'list_not_found') throw fail('library_unavailable', 409);
            throw error;
        }
        if (result.rows.length > READIVE_LIMITS.browseEntries) throw fail('catalog_too_large', 413);
        return { ...result, descriptor, collectionId, parts, db };
    }

    async resolveRow(row, scopes = new Map()) {
        if (typeof row.path !== 'string' || !path.isAbsolute(row.path)) throw fail('invalid_library_path');
        const libraries = registeredReadiveLibraries(this.getState(), this.getRegisteredLibraries());
        for (const library of libraries) {
            const relativePath = path.relative(library.path, row.path).split(path.sep).join('/');
            if (relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) continue;
            let scope = scopes.get(library.id);
            if (!scope) {
                ({ scope } = await validateReadiveLibrary(this.getState(), this.getRegisteredLibraries(), library.id));
                scopes.set(library.id, scope);
            }
            const resolved = await resolveReadiveLibraryPath(scope, relativePath);
            return { ...resolved, scope, relativePath };
        }
        throw fail('library_unavailable', 409);
    }

    async members(location, signal) {
        const scopes = new Map();
        const results = new Array(location.rows.length);
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(8, results.length) }, async () => {
            while (index < results.length) {
                checkCancelled(signal);
                const current = index++;
                const row = location.rows[current];
                try {
                    const resolved = await this.resolveRow(row, scopes);
                    results[current] = { ...resolved, row, key: entryKey(row.path) };
                } catch { checkCancelled(signal); }
            }
        }));
        checkCancelled(signal);
        return results.filter(Boolean);
    }

    async resolve(libraryId, relativePath, signal) {
        checkCancelled(signal);
        const location = await this.location(libraryId, relativePath);
        const [key, ...children] = location.parts;
        const row = location.rows.find(item => entryKey(item.path) === key);
        if (!row) throw fail('invalid_library_path');
        const member = await this.resolveRow(row);
        if (children.length && !member.stat.isDirectory()) throw fail('invalid_library_path');
        const actualPath = [member.relativePath, ...children].filter(Boolean).join('/');
        const resolved = await resolveReadiveLibraryPath(member.scope, actualPath);
        checkCancelled(signal);
        return { ...resolved, scope: member.scope, relativePath: actualPath, db: location.db };
    }

    async validate(scope) {
        return validateReadiveLibrary(this.getState(), this.getRegisteredLibraries(), scope.libraryId, scope);
    }

    page(entries, libraryId, relativePath, cursor, secret) {
        const signature = hash(JSON.stringify(entries));
        const scope = `${libraryId}:${relativePath}`;
        let offset = 0;
        if (cursor) {
            if (typeof cursor !== 'string' || cursor.length > 8192) throw fail('invalid_cursor');
            const [payload, mac, extra] = cursor.split('.');
            const expected = crypto.createHmac('sha256', secret).update(payload || '').digest('base64url');
            if (extra || !mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw fail('invalid_cursor');
            let value;
            try { value = JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw fail('invalid_cursor'); }
            if (value.scope !== scope || !Number.isInteger(value.offset) || value.offset < 1 || value.offset > READIVE_LIMITS.browseEntries) throw fail('invalid_cursor');
            if (value.signature !== signature) throw fail('catalog_changed', 409);
            offset = value.offset;
        }
        const page = entries.slice(offset, offset + 200);
        let nextCursor = null;
        if (offset + page.length < entries.length) {
            const payload = Buffer.from(JSON.stringify({ scope, signature, offset: offset + page.length })).toString('base64url');
            nextCursor = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
        }
        return { entries: page, path: relativePath, nextCursor };
    }

    async entries(libraryId, relativePath, cursor, options) {
        checkCancelled(options.signal);
        const location = await this.location(libraryId, relativePath);
        if (location.parts.length) {
            const resolved = await this.resolve(libraryId, relativePath, options.signal);
            const scope = { ...resolved.scope, libraryId, approvalId: hash(`${resolved.scope.approvalId}\0${relativePath}`) };
            const result = await readReadiveLibraryEntries(scope, resolved.relativePath, cursor, { ...options, cache: undefined });
            await this.validate(resolved.scope);
            return { ...result, path: relativePath, entries: result.entries.map(entry => ({
                ...entry, relativePath: `${relativePath}/${entry.name}`,
            })) };
        }
        const members = location.collections ? null : await this.members(location, options.signal);
        const entries = location.collections
            ? location.collections.map(collection => ({ id: hash(`${libraryId}\0${collection.id}`).slice(0, 32), name: collection.name, kind: 'directory', relativePath: collection.id, size: null, format: null }))
            : members.map(member => ({
                id: member.key, name: path.basename(member.sourcePath), kind: member.stat.isDirectory() ? 'directory' : 'file',
                relativePath: [location.collectionId, member.key].filter(Boolean).join('/'),
                size: member.stat.isFile() ? member.stat.size : null,
                format: member.stat.isFile() ? readiveFileFormat(member.sourcePath) : null,
            }));
        for (const scope of new Map((members || []).map(member => [member.scope.libraryId, member.scope])).values()) await this.validate(scope);
        checkCancelled(options.signal);
        return this.page(entries, libraryId, relativePath, cursor, options.secret);
    }

    async preview(libraryId, relativePath, signal) {
        const location = await this.location(libraryId, relativePath);
        if (location.parts.length) {
            const resolved = await this.resolve(libraryId, relativePath, signal);
            const result = await readReadivePreview(resolved.scope, resolved.relativePath, resolved.db, signal);
            await this.validate(resolved.scope);
            return { ...result, path: relativePath };
        }
        const members = (await this.members(location, signal)).sort((a, b) => Number(a.stat.isDirectory()) - Number(b.stat.isDirectory()));
        for (const member of members) {
            try {
                const result = await readReadivePreview(member.scope, member.relativePath, location.db, signal);
                await this.validate(member.scope);
                if (result.thumbnail) return { ...result, path: relativePath, metadata: null };
            } catch { checkCancelled(signal); }
        }
        return { path: relativePath, sourceVersion: hash(`${libraryId}:${relativePath}:empty`), metadata: null, thumbnail: null };
    }

    async selection(libraryId, paths, signal) {
        const resolved = [];
        for (const relativePath of paths) {
            checkCancelled(signal);
            const location = await this.location(libraryId, relativePath);
            if (location.parts.length) resolved.push(await this.resolve(libraryId, relativePath, signal));
            else if (location.collections) {
                for (const collection of location.collections) {
                    const nested = await this.location(libraryId, collection.id);
                    resolved.push(...await this.members(nested, signal));
                }
            } else resolved.push(...await this.members(location, signal));
            if (resolved.length > READIVE_LIMITS.hardFiles + READIVE_LIMITS.hardFolders) throw fail('transfer_hard_limit', 413);
        }
        if (!resolved.length) throw fail('empty_transfer');
        const sourceScopes = [...new Map(resolved.map(member => [member.scope.libraryId, member.scope])).values()];
        return {
            sourcePaths: [...new Set(resolved.map(member => member.sourcePath))],
            scope: { libraryId, sourceScopes, approvalId: hash(JSON.stringify(sourceScopes)) },
        };
    }
}
