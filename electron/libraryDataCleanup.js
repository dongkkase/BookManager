import fs from 'node:fs';
import path from 'node:path';
import { createLibraryPathScope } from './libraryPathScope.js';

function libraryRoots(library, libraryPaths) {
    const pathApi = library.platform === 'win32' ? path.win32 : path.posix;
    if (!Array.isArray(libraryPaths) || libraryPaths.some(value => (
        typeof value !== 'string' || !value || value.includes('\0') || !pathApi.isAbsolute(value)
    ))) throw new Error('invalid_library_paths');
    const normalize = value => {
        const normalized = library.normalizeFilePath(pathApi.resolve(value));
        return library.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    const roots = new Set(libraryPaths.map(normalize));
    const prefixes = [...roots].map(root => root.endsWith(pathApi.sep) ? root : `${root}${pathApi.sep}`);
    return {
        isRoot: value => typeof value === 'string' && pathApi.isAbsolute(value) && roots.has(normalize(value)),
        contains: value => {
            if (typeof value !== 'string' || !pathApi.isAbsolute(value)) return false;
            const normalized = normalize(value);
            return roots.has(normalized) || prefixes.some(prefix => normalized.startsWith(prefix));
        },
        isAbsolute: value => typeof value === 'string' && pathApi.isAbsolute(value),
    };
}

function hasOutsideReference(value, scope) {
    if (typeof value === 'string') return scope.isAbsolute(value) && !scope.contains(value);
    if (Array.isArray(value)) return value.some(entry => hasOutsideReference(entry, scope));
    return value && typeof value === 'object'
        ? Object.values(value).some(entry => hasOutsideReference(entry, scope)) : false;
}

function originalPathFilter(originalPaths, cachePaths, platform) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const key = value => {
        const resolved = paths.resolve(value).normalize('NFC');
        return ['win32', 'darwin'].includes(platform) ? resolved.toLowerCase() : resolved;
    };
    const realKey = value => {
        try { return key(fs.realpathSync(value)); }
        catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
            return '';
        }
    };
    const names = new Set([...cachePaths].map(value => paths.basename(value).normalize('NFC').toLowerCase()));
    const protectedPaths = new Set();
    for (const originalPath of originalPaths) {
        protectedPaths.add(key(originalPath));
        if (names.has(paths.basename(originalPath).normalize('NFC').toLowerCase())) {
            const canonical = realKey(originalPath);
            if (canonical) protectedPaths.add(canonical);
        }
    }
    return cachePath => !protectedPaths.has(key(cachePath)) && !protectedPaths.has(realKey(cachePath));
}

export async function pruneUnregisteredLibraryData(library, libraryPaths) {
    const registeredPaths = Array.isArray(libraryPaths) ? [...libraryPaths] : libraryPaths;
    const roots = libraryRoots(library, registeredPaths);
    return library.withLock(() => {
        const db = library.getConnection();
        const scopeFor = column => createLibraryPathScope(library, registeredPaths, `normalize_library_file_path(${column})`);
        const outside = scope => `NOT COALESCE((${scope.where}), 0)`;
        const tableColumns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
        return db.transaction(() => {
            const result = {
                changes: 0,
                cachePaths: [],
                deletedFileCount: 0,
                deletedActivityCount: 0,
                deletedReadingStateCount: 0,
                deletedTextMetadataPathCount: 0,
                deletedTextMetadataCount: 0,
                deletedDuplicateIndexCount: 0,
                deletedDuplicateCacheCount: 0,
                deletedLibraryScanStateCount: 0,
                deletedLibraryFolderCount: 0,
                deletedLegacyRowCount: 0,
            };
            const cachePaths = new Set();
            const originalPaths = new Set();
            const rememberOriginal = value => {
                if (roots.isAbsolute(value)) originalPaths.add(value);
            };
            const rememberCover = value => {
                if (typeof value === 'string' && value.trim()) cachePaths.add(value);
            };
            const removals = new Map();
            const planRemoval = (table, rows, countKey) => {
                if (!removals.has(table)) removals.set(table, { rowIds: new Set(), countKey });
                const plan = removals.get(table);
                for (const row of rows) plan.rowIds.add(row.cleanup_rowid);
            };
            const outsideRows = (table, column, columns = []) => {
                const scope = scopeFor(column);
                return db.prepare(`SELECT rowid AS cleanup_rowid${columns.map(name => `, ${name}`).join('')}
                    FROM ${table} WHERE ${outside(scope)}`).all(...scope.params);
            };
            const outsideFiles = outsideRows('files', 'path', ['path', 'thumb_path', 'cover_override_path']);
            for (const row of outsideFiles) {
                rememberOriginal(row.path);
                rememberCover(row.thumb_path);
                rememberCover(row.cover_override_path);
            }
            planRemoval('files', outsideFiles, 'deletedFileCount');
            for (const [table, column, countKey] of [
                ['reading_file_activity', 'path', 'deletedActivityCount'],
                ['reading_states', 'file_path', 'deletedReadingStateCount'],
                ['text_metadata_paths', 'path', 'deletedTextMetadataPathCount'],
                ['dup_target_index', 'full_path', 'deletedDuplicateIndexCount'],
            ]) {
                const rows = outsideRows(table, column, [column]);
                if (['text_metadata_paths', 'dup_target_index'].includes(table)) {
                    for (const row of rows) rememberOriginal(row[column]);
                }
                planRemoval(table, rows, countKey);
            }
            const retainedTextHashes = new Set();
            for (const row of db.prepare('SELECT rowid AS cleanup_rowid, content_hash FROM text_metadata_paths').iterate()) {
                if (!removals.get('text_metadata_paths').rowIds.has(row.cleanup_rowid)) retainedTextHashes.add(row.content_hash);
            }
            const orphanedTextMetadata = [];
            for (const row of db.prepare('SELECT rowid AS cleanup_rowid, content_hash, cover_path FROM text_metadata').iterate()) {
                if (retainedTextHashes.has(row.content_hash)) continue;
                orphanedTextMetadata.push(row);
                rememberCover(row.cover_path);
            }
            planRemoval('text_metadata', orphanedTextMetadata, 'deletedTextMetadataCount');

            const obsoleteDuplicates = [];
            for (const row of db.prepare('SELECT rowid AS cleanup_rowid, a_path, match_data FROM dup_cache').iterate()) {
                let obsolete = !roots.contains(row.a_path);
                if (!obsolete) {
                    try { obsolete = hasOutsideReference(JSON.parse(row.match_data), roots); }
                    catch { obsolete = true; }
                }
                if (obsolete) obsoleteDuplicates.push(row);
            }
            planRemoval('dup_cache', obsoleteDuplicates, 'deletedDuplicateCacheCount');
            planRemoval('library_scan_state', db.prepare('SELECT rowid AS cleanup_rowid, library_path FROM library_scan_state')
                .all().filter(row => !roots.isRoot(row.library_path)), 'deletedLibraryScanStateCount');
            const obsoleteFolders = [];
            for (const row of db.prepare('SELECT rowid AS cleanup_rowid, library_path, folder_path FROM library_folders').iterate()) {
                if (!roots.isRoot(row.library_path) || !roots.contains(row.folder_path)) obsoleteFolders.push(row);
            }
            planRemoval('library_folders', obsoleteFolders, 'deletedLibraryFolderCount');

            for (const [table, candidates] of [
                ['file_info', ['path', 'filepath', 'file_path', 'full_path']],
                ['target_index', ['file_path', 'full_path', 'path', 'filepath']],
            ]) {
                const columns = tableColumns(table);
                const column = candidates.find(candidate => columns.has(candidate));
                if (!column) continue;
                const coverColumns = ['thumb_path', 'thumbnail', 'cover_override_path'].filter(candidate => columns.has(candidate));
                const rows = outsideRows(table, column, [column, ...coverColumns]);
                for (const row of rows) {
                    rememberOriginal(row[column]);
                    coverColumns.forEach(name => rememberCover(row[name]));
                }
                planRemoval(table, rows, 'deletedLegacyRowCount');
            }
            if (tableColumns('dup_match').has('a_path')) {
                const obsoleteLegacyDuplicates = [];
                for (const row of db.prepare('SELECT rowid AS cleanup_rowid, * FROM dup_match').iterate()) {
                    if (!roots.contains(row.a_path) || hasOutsideReference(row.match_path, roots)) obsoleteLegacyDuplicates.push(row);
                }
                planRemoval('dup_match', obsoleteLegacyDuplicates, 'deletedLegacyRowCount');
            }

            if (cachePaths.size > 0) {
                const retainedCovers = new Set();
                for (const row of db.prepare('SELECT rowid AS cleanup_rowid, thumb_path, cover_override_path FROM files').iterate()) {
                    if (removals.get('files').rowIds.has(row.cleanup_rowid)) continue;
                    retainedCovers.add(row.thumb_path);
                    retainedCovers.add(row.cover_override_path);
                }
                for (const row of db.prepare('SELECT rowid AS cleanup_rowid, cover_path FROM text_metadata').iterate()) {
                    if (!removals.get('text_metadata').rowIds.has(row.cleanup_rowid)) retainedCovers.add(row.cover_path);
                }
                const isNotOriginal = originalPathFilter(originalPaths, cachePaths, library.platform);
                result.cachePaths = [...cachePaths].filter(coverPath => !retainedCovers.has(coverPath) && isNotOriginal(coverPath));
            }

            // Plan scans and filesystem checks before acquiring the SQLite write lock.
            // A concurrent writer invalidates this deferred snapshot instead of deleting stale rows.
            for (const [table, { rowIds, countKey }] of removals) {
                if (rowIds.size === 0) continue;
                const remove = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);
                for (const rowId of rowIds) result[countKey] += remove.run(rowId).changes;
            }
            result.changes = Object.entries(result).reduce((count, [key, value]) => key.startsWith('deleted') ? count + value : count, 0);
            return result;
        }).deferred();
    });
}
