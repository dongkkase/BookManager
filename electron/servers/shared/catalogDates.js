import path from 'node:path';
import { createLibraryPathScope, normalizeLibraryRoots } from '../../libraryPathScope.js';
import { fail } from '../../readive/policy.js';

const checkCancelled = signal => { if (signal?.aborted) throw fail('catalog_cancelled', 409); };

export function catalogDate(value) {
    const timestamp = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function catalogCreatedAt(stat) {
    const timestamp = stat?.birthtimeMs;
    return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
        && timestamp <= 8640000000000000 ? new Date(timestamp).toISOString() : null;
}

export function catalogPathKey(value) {
    const normalized = path.resolve(value).normalize(process.platform === 'darwin' ? 'NFD' : 'NFC');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export async function readCatalogReadingDates(library, filePaths, signal, directories = []) {
    checkCancelled(signal);
    const result = new Map();
    if (!library?.listReadingStatesByPaths) return result;
    const paths = [...new Set(filePaths.map(catalogPathKey))];
    for (let offset = 0; offset < paths.length; offset += 500) {
        checkCancelled(signal);
        const states = await library.listReadingStatesByPaths(paths.slice(offset, offset + 500));
        for (const state of states) {
            const timestamp = catalogDate(state.lastReadAt);
            if (timestamp && typeof state.filePath === 'string') result.set(catalogPathKey(state.filePath), timestamp);
        }
    }
    const folders = [...new Set(directories.map(catalogPathKey))];
    if (folders.length && library.withLock && library.getConnection) {
        for (let offset = 0; offset < folders.length; offset += 200) {
            checkCancelled(signal);
            const batch = folders.slice(offset, offset + 200);
            const rows = await library.withLock(() => {
                const db = library.getConnection();
                if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reading_states'").get()) return [];
                const parameters = batch.flatMap(folder => {
                    const prefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
                    const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
                    return [folder, prefix, upper];
                });
                return db.prepare(`
                    WITH folders(directory, prefix, upper) AS (VALUES ${batch.map(() => '(?, ?, ?)').join(', ')})
                    SELECT folders.directory, MAX(states.last_read_at) AS last_read_at
                    FROM folders JOIN reading_states states ON states.file_path >= folders.prefix AND states.file_path < folders.upper
                    WHERE states.deleted_at = '' GROUP BY folders.directory
                `).all(...parameters);
            });
            for (const row of rows) {
                const timestamp = catalogDate(row.last_read_at);
                if (timestamp) result.set(catalogPathKey(row.directory), timestamp);
            }
        }
    }
    checkCancelled(signal);
    return result;
}

export async function readCollectionReadingDates(library, collections, roots) {
    const result = new Map();
    if (!collections.length || !library?.withLock || !library?.getConnection) return result;
    const memberScope = createLibraryPathScope(library, roots, 'members.path');
    const normalizedRoots = normalizeLibraryRoots(library, roots);
    const readingScope = createLibraryPathScope(library, roots, 'states.file_path');
    const paths = library.platform === 'win32' ? path.win32 : path.posix;
    const upperSeparator = String.fromCharCode(paths.sep.charCodeAt(0) + 1);
    for (let offset = 0; offset < collections.length; offset += 200) {
        const batch = collections.slice(offset, offset + 200);
        const rows = await library.withLock(() => library.getConnection().prepare(`
            SELECT members.list_id, MAX(states.last_read_at) AS last_read_at
            FROM reading_list_members members JOIN reading_states states ON
                (members.is_directory = 0 AND states.file_path = members.path)
                OR (members.is_directory = 1 AND states.file_path >= rtrim(members.path, ?) || ? AND states.file_path < rtrim(members.path, ?) || ?)
            WHERE members.list_id IN (${batch.map(() => '?').join(', ')})
                AND states.deleted_at = ''
                AND ((${memberScope.where}) OR members.path IN (${normalizedRoots.map(() => '?').join(', ') || 'NULL'}))
                AND (${readingScope.where})
            GROUP BY members.list_id
        `).all(paths.sep, paths.sep, paths.sep, upperSeparator, ...batch.map(collection => collection.id), ...memberScope.params, ...normalizedRoots, ...readingScope.params));
        for (const row of rows) {
            const timestamp = catalogDate(row.last_read_at);
            if (timestamp) result.set(row.list_id, timestamp);
        }
    }
    return result;
}
