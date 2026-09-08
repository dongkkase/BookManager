import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinks, isReadiveSkippedName, readiveFileFormat } from './manifest.js';
import { cleanRelativePath, fail, READIVE_LIMITS } from './policy.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
const rootIdentity = stat => ({ dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs });
const equalIdentity = (identity, stat) => Object.entries(identity).every(([key, value]) => stat[key] === value);

export function registeredReadiveLibraries(state, configured = []) {
    if (!Array.isArray(configured) || configured.length > 500) throw fail('invalid_libraries');
    const seen = new Set();
    return configured.flatMap(entry => {
        const value = typeof entry === 'string' ? entry : entry?.path;
        if (typeof value !== 'string' || !path.isAbsolute(value)) return [];
        const sourcePath = path.resolve(value);
        const key = sourceKey(sourcePath);
        if (seen.has(key)) return [];
        seen.add(key);
        const id = hash(`${state.serverId}\0${key}`).slice(0, 32);
        return [{ id, path: sourcePath, name: String(entry.alias || path.basename(sourcePath) || sourcePath).slice(0, 255) }];
    });
}

export async function validateReadiveLibrary(state, configured, libraryId, expectedScope) {
    const library = registeredReadiveLibraries(state, configured).find(item => item.id === libraryId);
    if (!library || (expectedScope && (expectedScope.libraryId !== libraryId || library.path !== expectedScope.rootPath))) throw fail('library_unavailable', 409);
    try {
        await assertNoSymlinks(library.path);
        const stat = await fs.lstat(library.path);
        if (!stat.isDirectory() || (expectedScope && !equalIdentity(expectedScope.identity, stat))) throw fail('library_unavailable', 409);
        const identity = rootIdentity(stat);
        const scope = expectedScope || {
            libraryId,
            approvalId: hash(JSON.stringify({ libraryId, identity })).slice(0, 32),
            rootPath: library.path,
            identity,
        };
        return { library, scope };
    } catch { throw fail('library_unavailable', 409); }
}

export async function resolveReadiveLibraryPath(scope, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length > 2048) throw fail('invalid_library_path');
    if (relativePath) {
        try { cleanRelativePath(relativePath); } catch { throw fail('invalid_library_path'); }
        if (relativePath.split('/').some(isReadiveSkippedName) || relativePath.split('/').length > READIVE_LIMITS.depth) throw fail('invalid_library_path');
    }
    const sourcePath = path.resolve(scope.rootPath, ...relativePath.split('/'));
    const prefix = scope.rootPath.endsWith(path.sep) ? scope.rootPath : scope.rootPath + path.sep;
    if (sourcePath !== scope.rootPath && !sourcePath.startsWith(prefix)) throw fail('invalid_library_path');
    try {
        await assertNoSymlinks(sourcePath);
        const stat = await fs.lstat(sourcePath);
        if (!stat.isDirectory() && (!stat.isFile() || !readiveFileFormat(sourcePath))) throw fail('invalid_library_path');
        return { sourcePath, stat };
    } catch (error) {
        if (error.code === 'invalid_library_path') throw error;
        throw fail('source_changed', 409);
    }
}

const nameCollator = new Intl.Collator('en', { numeric: true });
const stableNameCollator = new Intl.Collator();
const compareEntries = (left, right) => (left.kind === right.kind ? 0 : left.kind === 'directory' ? -1 : 1)
    || nameCollator.compare(left.name, right.name) || stableNameCollator.compare(left.name, right.name);
const directoryVersion = stat => ({ ...rootIdentity(stat), mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const sameDirectory = (before, after) => after.isDirectory() && equalIdentity(directoryVersion(before), after);
const catalogScopeKey = (scope, relativePath) => hash(`${scope.libraryId}\0${scope.approvalId}\0${relativePath}`);

export class ReadiveCatalogCache {
    constructor({ now = Date.now, ttlMs = 60000, maxSnapshots = 8, maxEntries = READIVE_LIMITS.browseEntries, maxBytes = 32 * 1024 ** 2, maxPending = 4 } = {}) {
        this.now = now;
        this.ttlMs = ttlMs;
        this.maxSnapshots = maxSnapshots;
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.maxPending = maxPending;
        this.snapshots = new Map();
        this.pending = new Map();
        this.scanControllers = new Set();
        this.activeRequests = new Set();
        this.generation = 0;
    }

    clear() {
        this.generation += 1;
        this.snapshots.clear();
        for (const controller of this.scanControllers) controller.abort();
        for (const controller of this.activeRequests) controller.abort();
    }

    async run(operation, signal) {
        checkCatalogCancelled(signal);
        if (this.activeRequests.size >= this.maxPending) throw fail('catalog_busy', 429);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        this.activeRequests.add(controller);
        try { return await operation(controller.signal); }
        finally {
            signal?.removeEventListener('abort', cancel);
            this.activeRequests.delete(controller);
        }
    }

    async read(key, stat, scan) {
        const version = JSON.stringify(directoryVersion(stat));
        for (const [id, snapshot] of this.snapshots) if (snapshot.expiresAt <= this.now()) this.snapshots.delete(id);
        const cached = this.snapshots.get(key);
        if (cached?.version === version) {
            this.snapshots.delete(key);
            this.snapshots.set(key, cached);
            return cached.value;
        }
        this.snapshots.delete(key);
        const pendingKey = `${key}:${version}`;
        if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
        if (this.pending.size >= this.maxPending) throw fail('catalog_busy', 429);
        const generation = this.generation;
        const controller = new AbortController();
        this.scanControllers.add(controller);
        const promise = Promise.resolve().then(() => { checkCatalogCancelled(controller.signal); return scan(controller.signal); }).then(value => {
            if (generation !== this.generation || value.entries.length > this.maxEntries || value.bytes > this.maxBytes) return value;
            this.snapshots.delete(key);
            this.snapshots.set(key, { version, value, expiresAt: this.now() + this.ttlMs });
            let entries = 0;
            let bytes = 0;
            for (const snapshot of this.snapshots.values()) {
                entries += snapshot.value.entries.length;
                bytes += snapshot.value.bytes;
            }
            while (this.snapshots.size > this.maxSnapshots || entries > this.maxEntries || bytes > this.maxBytes) {
                const oldest = this.snapshots.keys().next().value;
                const removed = this.snapshots.get(oldest);
                entries -= removed.value.entries.length;
                bytes -= removed.value.bytes;
                this.snapshots.delete(oldest);
            }
            return value;
        }).finally(() => {
            this.scanControllers.delete(controller);
            if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
        });
        this.pending.set(pendingKey, promise);
        return promise;
    }
}

function checkCatalogCancelled(signal) {
    if (signal?.aborted) throw fail('catalog_cancelled', 409);
}

async function validateDirectory(sourcePath, before) {
    try {
        await assertNoSymlinks(sourcePath);
        if (!sameDirectory(before, await fs.lstat(sourcePath))) throw fail('catalog_changed', 409);
    } catch { throw fail('catalog_changed', 409); }
}

async function scanDirectoryNames(sourcePath, stat, relativePath, signal) {
    const entries = [];
    const names = new Map();
    let visited = 0;
    let bytes = 0;
    const directory = await fs.opendir(sourcePath);
    for await (const child of directory) {
        checkCatalogCancelled(signal);
        if (++visited > READIVE_LIMITS.browseEntries) throw fail('catalog_too_large', 413);
        if (isReadiveSkippedName(child.name) || child.isSymbolicLink()) continue;
        const kind = child.isDirectory() ? 'directory' : child.isFile() && readiveFileFormat(child.name) ? 'file' : null;
        if (!kind) continue;
        const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
        try { cleanRelativePath(childPath); } catch { continue; }
        if (names.has(child.name)) {
            if (names.get(child.name) !== kind) throw fail('catalog_changed', 409);
            continue;
        }
        names.set(child.name, kind);
        entries.push({ name: child.name, kind });
        bytes += Buffer.byteLength(child.name) + 80;
    }
    await validateDirectory(sourcePath, stat);
    checkCatalogCancelled(signal);
    entries.sort(compareEntries);
    const signature = hash(JSON.stringify({ version: directoryVersion(stat), entries }));
    return { entries, signature, bytes };
}

async function readPageEntries(scope, sourcePath, relativePath, entries, signal) {
    const result = new Array(entries.length);
    let next = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
        while (!failure) {
            try {
                checkCatalogCancelled(signal);
                const index = next++;
                if (index >= entries.length) return;
                const entry = entries[index];
                let stat;
                try { stat = await fs.lstat(path.join(sourcePath, entry.name)); } catch { throw fail('catalog_changed', 409); }
                checkCatalogCancelled(signal);
                if (stat.isSymbolicLink() || (entry.kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) throw fail('catalog_changed', 409);
                const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
                result[index] = {
                    id: hash(`${scope.libraryId}\0${childPath}`).slice(0, 32), name: entry.name, kind: entry.kind, relativePath: childPath,
                    size: entry.kind === 'file' ? stat.size : null, format: entry.kind === 'file' ? readiveFileFormat(entry.name) : null,
                };
            } catch (error) { failure ||= error; }
        }
    }));
    if (failure) throw failure;
    return result;
}

export async function readReadiveLibraryEntries(scope, relativePath, cursor, options) {
    if (options.cache) return options.cache.run(signal => readCatalogPage(scope, relativePath, cursor, { ...options, signal }), options.signal);
    return readCatalogPage(scope, relativePath, cursor, options);
}

async function readCatalogPage(scope, relativePath, cursor, { secret, cache, signal }) {
    checkCatalogCancelled(signal);
    const { sourcePath, stat } = await resolveReadiveLibraryPath(scope, relativePath);
    checkCatalogCancelled(signal);
    if (!stat.isDirectory()) throw fail('invalid_library_path');
    const scopeKey = catalogScopeKey(scope, relativePath);
    let offset = 0;
    let previousSignature;
    if (cursor) {
        if (typeof cursor !== 'string' || cursor.length > 8192) throw fail('invalid_cursor');
        const [payload, signature, extra] = cursor.split('.');
        const expected = crypto.createHmac('sha256', secret).update(payload || '').digest('base64url');
        if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw fail('invalid_cursor');
        let parsed;
        try { parsed = JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw fail('invalid_cursor'); }
        if (parsed?.v === undefined) return readLegacyReadiveLibraryEntries(scope, relativePath, cursor, { secret, signal });
        if (parsed.v !== 2 || parsed.scope !== scopeKey || !Number.isInteger(parsed.offset)
            || parsed.offset < 1 || parsed.offset > READIVE_LIMITS.browseEntries || typeof parsed.signature !== 'string'
            || !/^[a-f0-9]{64}$/.test(parsed.signature)) throw fail('invalid_cursor');
        offset = parsed.offset;
        previousSignature = parsed.signature;
    }
    const scan = scanSignal => scanDirectoryNames(sourcePath, stat, relativePath, scanSignal);
    const snapshot = cache ? await cache.read(scopeKey, stat, scan) : await scan(signal);
    checkCatalogCancelled(signal);
    if (previousSignature && previousSignature !== snapshot.signature) throw fail('catalog_changed', 409);
    const entries = await readPageEntries(scope, sourcePath, relativePath, snapshot.entries.slice(offset, offset + 200), signal);
    await validateDirectory(sourcePath, stat);
    checkCatalogCancelled(signal);
    let nextCursor = null;
    if (offset + entries.length < snapshot.entries.length) {
        const payload = Buffer.from(JSON.stringify({ v: 2, scope: scopeKey, offset: offset + entries.length, signature: snapshot.signature })).toString('base64url');
        nextCursor = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
    }
    return { entries, path: relativePath, nextCursor };
}

async function readLegacyReadiveLibraryEntries(scope, relativePath, cursor, { secret, signal }) {
    const { sourcePath, stat } = await resolveReadiveLibraryPath(scope, relativePath);
    checkCatalogCancelled(signal);
    if (!stat.isDirectory()) throw fail('invalid_library_path');
    let offset = 0;
    let previousSignature;
    if (cursor) {
        if (typeof cursor !== 'string' || cursor.length > 8192) throw fail('invalid_cursor');
        const [payload, signature, extra] = cursor.split('.');
        const expected = crypto.createHmac('sha256', secret).update(payload || '').digest('base64url');
        if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw fail('invalid_cursor');
        let parsed;
        try { parsed = JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw fail('invalid_cursor'); }
        if (parsed.libraryId !== scope.libraryId || parsed.approvalId !== scope.approvalId || parsed.path !== relativePath
            || !Number.isInteger(parsed.offset) || parsed.offset < 1 || parsed.offset > READIVE_LIMITS.scanEntries) throw fail('invalid_cursor');
        offset = parsed.offset;
        previousSignature = parsed.signature;
    }
    const entries = [];
    const identities = [];
    let visited = 0;
    const directory = await fs.opendir(sourcePath);
    for await (const child of directory) {
        checkCatalogCancelled(signal);
        if (++visited > READIVE_LIMITS.scanEntries) throw fail('catalog_too_large', 413);
        if (isReadiveSkippedName(child.name)) continue;
        const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
        try { cleanRelativePath(childPath); } catch { continue; }
        let childStat;
        try { childStat = await fs.lstat(path.join(sourcePath, child.name)); } catch { throw fail('catalog_changed', 409); }
        if (childStat.isSymbolicLink() || (!childStat.isDirectory() && !childStat.isFile())) continue;
        const format = childStat.isFile() ? readiveFileFormat(child.name) : null;
        if (childStat.isFile() && !format) continue;
        entries.push({ id: hash(`${scope.libraryId}\0${childPath}`).slice(0, 32), name: child.name, kind: childStat.isDirectory() ? 'directory' : 'file', relativePath: childPath, size: childStat.isFile() ? childStat.size : null, format });
        identities.push([child.name, childStat.ino, childStat.dev, childStat.size, childStat.mtimeMs, childStat.ctimeMs]);
    }
    await assertNoSymlinks(sourcePath);
    const after = await fs.lstat(sourcePath);
    if (!after.isDirectory() || !equalIdentity(rootIdentity(stat), after) || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw fail('catalog_changed', 409);
    const signature = hash(JSON.stringify({ identity: rootIdentity(stat), mtime: stat.mtimeMs, ctime: stat.ctimeMs, identities: identities.sort((a, b) => a[0].localeCompare(b[0])) }));
    if (previousSignature && previousSignature !== signature) throw fail('catalog_changed', 409);
    entries.sort(compareEntries);
    const page = entries.slice(offset, offset + 200);
    let nextCursor = null;
    if (offset + page.length < entries.length) {
        const payload = Buffer.from(JSON.stringify({ libraryId: scope.libraryId, approvalId: scope.approvalId, path: relativePath, offset: offset + page.length, signature })).toString('base64url');
        nextCursor = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
    }
    return { entries: page, path: relativePath, nextCursor };
}
