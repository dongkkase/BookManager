import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FOLDER_TAG_CATEGORIES } from '../../../src/folderTagFilter.js';
import { assertNoSymlinks, readiveFileFormat } from '../../readive/manifest.js';
import { fail } from '../../readive/policy.js';

const maximumRows = 100000;
const maximumResults = 10000;
const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
const canonicalPath = value => process.platform === 'darwin' ? value.normalize('NFD') : value;
const directoryKey = value => process.platform === 'win32' ? value.toLowerCase() : canonicalPath(value);
const cancelled = signal => { if (signal?.aborted) throw fail('catalog_cancelled', 409); };
const within = (root, file) => {
    const relative = path.relative(canonicalPath(root), canonicalPath(file));
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const categories = {
    genres: FOLDER_TAG_CATEGORIES.find(category => category.id === 'genre'),
    tags: FOLDER_TAG_CATEGORIES.find(category => category.id === 'tags'),
    publishers: FOLDER_TAG_CATEGORIES.find(category => category.id === 'publisher'),
    authors: { values: row => ['writer', 'penciller', 'inker', 'colorist']
        .flatMap(role => FOLDER_TAG_CATEGORIES.find(category => category.id === role).values(row)) },
    characters: FOLDER_TAG_CATEGORIES.find(category => category.id === 'characters'),
    years: FOLDER_TAG_CATEGORIES.find(category => category.id === 'year'),
};

export function validateTagFilter(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => ![...Object.keys(categories), 'match'].includes(key))
        || !['all', 'any'].includes(value.match)) throw fail('invalid_tag_filter');
    const result = { match: value.match };
    for (const field of Object.keys(categories)) {
        if (value[field] === undefined && field !== 'genres' && field !== 'tags') { result[field] = []; continue; }
        if (!Array.isArray(value[field]) || value[field].length > 50
            || value[field].some(item => typeof item !== 'string' || !item.trim() || item.length > 256
                || /[\x00-\x1f\x7f]/.test(item) || (field === 'years' && !/^[1-9]\d{3}$/.test(item)))) throw fail('invalid_tag_filter');
        result[field] = [...new Set(value[field].map(normalize))];
    }
    if (Object.keys(categories).every(field => result[field].length === 0)) throw fail('invalid_tag_filter');
    return result;
}

export function tagValues(row, field) {
    // PDF keywords are presented under Tags in the remote tag picker.
    const category = field === 'tags' && (String(row.book_type).toLowerCase() === 'pdf' || String(row.ext).replace(/^\./, '').toLowerCase() === 'pdf')
        ? FOLDER_TAG_CATEGORIES.find(value => value.id === 'pdf_keywords') : categories[field];
    return category.values(row).filter(value => value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value));
}

export async function readTagCatalog(library, roots, filterValue = null, signal) {
    const filter = validateTagFilter(filterValue);
    if (!library?.withLock || !library?.getConnection) throw fail('tag_search_unavailable', 404);
    cancelled(signal);
    const scopes = [...new Set(roots.map(root => library.normalizeFilePath(path.resolve(root))))];
    if (!scopes.length) throw fail('library_unavailable', 409);
    for (const root of scopes) await assertNoSymlinks(root);
    const rows = await library.withLock(async () => {
        const clauses = scopes.map(() => "path LIKE ? ESCAPE '\\'");
        const parameters = scopes.map(root => `${(root.endsWith(path.sep) ? root : root + path.sep).replace(/[\\%_]/g, '\\$&')}%`);
        return library.getConnection().prepare(`
            SELECT path, genre, tags, publisher, writer, penciller, inker, colorist, characters, publish_date, book_type, ext
            FROM files WHERE (${clauses.join(' OR ')})
                AND (COALESCE(genre, '') != '' OR COALESCE(tags, '') != ''
                    OR COALESCE(publisher, '') != '' OR COALESCE(writer, '') != ''
                    OR COALESCE(penciller, '') != '' OR COALESCE(inker, '') != ''
                    OR COALESCE(colorist, '') != '' OR COALESCE(characters, '') != ''
                    OR COALESCE(publish_date, '') != '')
            ORDER BY path LIMIT ?
        `).all(...parameters, maximumRows + 1);
    });
    if (rows.length > maximumRows) throw fail('catalog_too_large', 413);
    const counts = Object.fromEntries(Object.keys(categories).map(field => [field, new Map()]));
    const candidates = [];
    for (let index = 0; index < rows.length; index += 1) {
        if (index % 512 === 0) {
            await new Promise(resolve => setImmediate(resolve));
            cancelled(signal);
        }
        const row = rows[index];
        if (typeof row.path !== 'string' || !path.isAbsolute(row.path)
            || canonicalPath(path.resolve(row.path)) !== canonicalPath(row.path)
            || !scopes.some(root => within(root, row.path)) || !readiveFileFormat(row.path)) continue;
        const values = {};
        for (const field of Object.keys(categories)) {
            values[field] = new Set();
            for (const label of tagValues(row, field)) {
                const id = normalize(label);
                if (values[field].has(id)) continue;
                values[field].add(id);
                const current = counts[field].get(id);
                counts[field].set(id, { id, label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
                if (counts[field].size > 10000) throw fail('catalog_too_large', 413);
            }
        }
        if (filter) {
            const checks = Object.keys(categories).flatMap(field => filter[field].map(id => values[field].has(id)));
            if (filter.match === 'all' ? checks.every(Boolean) : checks.some(Boolean)) candidates.push(row);
        }
    }
    const facets = Object.fromEntries(Object.entries(counts).map(([field, values]) => [field,
        [...values.values()].sort((a, b) => a.label.localeCompare(b.label)),
    ]));
    cancelled(signal);
    // Facets describe the indexed metadata. Only matching books require live filesystem checks.
    const directories = new Map(scopes.map(root => [directoryKey(root), Promise.resolve()]));
    const checkDirectory = directory => {
        const key = directoryKey(directory);
        if (!directories.has(key)) {
            directories.set(key, (async () => {
                cancelled(signal);
                const parent = path.dirname(directory);
                if (parent === directory) throw fail('invalid_library_path');
                await checkDirectory(parent);
                cancelled(signal);
                const stat = await fs.lstat(directory);
                if (!stat.isDirectory()) throw fail('symlink_not_allowed', 409);
            })());
        }
        return directories.get(key);
    };
    const matches = [];
    let offset = 0;
    let stopped = false;
    await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, async () => {
        try {
            while (!stopped && offset < candidates.length) {
                cancelled(signal);
                const row = candidates[offset++];
                let stat;
                try {
                    await checkDirectory(path.dirname(row.path));
                    cancelled(signal);
                    if (stopped) return;
                    stat = await fs.lstat(row.path);
                } catch {
                    cancelled(signal);
                    continue;
                }
                cancelled(signal);
                if (stopped) return;
                if (!stat.isFile()) continue;
                matches.push({ ...row, size: stat.size });
                if (matches.length > maximumResults) throw fail('catalog_too_large', 413);
            }
        } catch (error) {
            stopped = true;
            throw error;
        }
    }));
    cancelled(signal);
    matches.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    return { ...facets, matches };
}

export function directTagEntries(matches, scope) {
    return matches.map(row => {
        const relativePath = path.relative(canonicalPath(scope.rootPath), canonicalPath(row.path)).split(path.sep).join('/');
        return {
            id: crypto.createHash('sha256').update(`${scope.libraryId}\0${relativePath}`).digest('hex').slice(0, 32),
            name: path.basename(row.path), relativePath, kind: 'file',
            size: row.size, format: readiveFileFormat(row.path),
        };
    });
}
