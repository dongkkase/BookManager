import fs from 'node:fs';
import path from 'node:path';

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const IMAGE_EXTENSION = '\\.(?:jpg|jpeg|png|webp|bmp|gif)';
const THUMBNAIL_NAME = new RegExp(`^(?:(?:pdf-first-page-v2-)?[a-f0-9]{32}|(?:local|audio)-cover-override-${UUID})${IMAGE_EXTENSION}$`);
const TEXT_COVER_NAME = new RegExp(`^[a-f0-9]{64}-${UUID}${IMAGE_EXTENSION}$`);

function absolutePath(value) {
    return typeof value === 'string' && value && !value.includes('\0') && path.isAbsolute(value)
        ? path.resolve(value) : '';
}

function pathKey(value, platform) {
    const resolved = absolutePath(value);
    if (!resolved) return '';
    const normalized = resolved.normalize('NFC');
    return ['win32', 'darwin'].includes(platform) ? normalized.toLowerCase() : normalized;
}

function sameEntry(left, right) {
    return ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(key => left[key] === right[key]);
}

async function managedRoot(directory, pattern) {
    const resolved = absolutePath(directory);
    if (!resolved || resolved === path.parse(resolved).root) return null;
    try {
        const stat = await fs.promises.lstat(resolved);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
        return { path: resolved, realPath: await fs.promises.realpath(resolved), stat, pattern };
    } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) return null;
        throw error;
    }
}

function rootUnchanged(root) {
    const current = fs.lstatSync(root.path);
    return current.isDirectory() && !current.isSymbolicLink()
        && current.dev === root.stat.dev && current.ino === root.stat.ino
        && fs.realpathSync(root.path) === root.realPath;
}

function readProtectedPaths(db, roots, names, platform) {
    const protectedPaths = new Set();
    const resolvedReferences = new Set();
    const rows = db.prepare(`
        SELECT thumb_path AS path, 1 AS is_cover FROM files WHERE COALESCE(thumb_path, '') <> ''
        UNION ALL SELECT cover_override_path, 1 FROM files WHERE COALESCE(cover_override_path, '') <> ''
        UNION ALL SELECT cover_path, 1 FROM text_metadata WHERE cover_path <> ''
        UNION ALL SELECT path, 0 FROM files
        UNION ALL SELECT path, 0 FROM reading_list_members
        UNION ALL SELECT path, 0 FROM text_metadata_paths
    `);
    for (const row of rows.iterate()) {
        const resolved = absolutePath(row.path);
        if (!resolved) continue;
        protectedPaths.add(pathKey(resolved, platform));
        for (const root of roots) {
            if (pathKey(path.dirname(resolved), platform) === pathKey(root.path, platform)) {
                protectedPaths.add(pathKey(path.join(root.realPath, path.basename(resolved)), platform));
            }
        }
        if ((row.is_cover || names.has(path.basename(resolved).toLowerCase())) && !resolvedReferences.has(resolved)) {
            resolvedReferences.add(resolved);
            try {
                protectedPaths.add(pathKey(fs.realpathSync(resolved), platform));
            } catch (error) {
                if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
            }
        }
    }
    return protectedPaths;
}

export async function removeUnreferencedLibraryCovers(library, cachePaths, { thumbnailDir, textCoverDir } = {}) {
    const result = { removedFiles: 0, skippedFiles: 0, errors: [] };
    const candidates = [...new Set((Array.isArray(cachePaths) ? cachePaths : [])
        .filter(value => typeof value === 'string' && value))];
    if (!candidates.length) return result;
    const roots = (await Promise.all([
        managedRoot(thumbnailDir, THUMBNAIL_NAME),
        managedRoot(textCoverDir, TEXT_COVER_NAME),
    ])).filter(Boolean);
    if (!roots.length) return { ...result, skippedFiles: candidates.length };
    const names = new Set(candidates.map(value => path.basename(value).toLowerCase()));
    const platform = library.platform || process.platform;

    return library.withLock(async () => {
        const db = library.getConnection();
        let protectedPaths;
        let databaseVersion;
        let connectionChanges;
        const totalChanges = db.prepare('SELECT total_changes() AS count');
        const referencesUnchanged = () => databaseVersion === db.pragma('data_version', { simple: true })
            && connectionChanges === totalChanges.get().count;
        const refreshProtectedPaths = () => {
            databaseVersion = db.pragma('data_version', { simple: true });
            connectionChanges = totalChanges.get().count;
            const paths = readProtectedPaths(db, roots, names, platform);
            protectedPaths = referencesUnchanged() ? paths : null;
        };
        const remove = db.transaction(candidate => {
            // Recheck after acquiring the write lock without scanning references under it.
            if (!referencesUnchanged()) return null;
            const resolved = absolutePath(candidate);
            const root = roots.find(value => resolved && path.dirname(resolved) === value.path
                && value.pattern.test(path.basename(resolved)));
            if (!root || !rootUnchanged(root)) return false;
            const before = fs.lstatSync(resolved);
            if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) return false;
            const realPath = fs.realpathSync(resolved);
            if (path.dirname(realPath) !== root.realPath) return false;

            if (protectedPaths.has(pathKey(resolved, platform)) || protectedPaths.has(pathKey(realPath, platform))) return false;
            if (!rootUnchanged(root) || !sameEntry(before, fs.lstatSync(resolved))
                || fs.realpathSync(resolved) !== realPath) return false;
            // The write lock keeps new database references from racing this unlink.
            fs.unlinkSync(resolved);
            return true;
        });
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            try {
                let removed = false;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    // Full database and filesystem reads must not block other connections' writes.
                    if (!protectedPaths) refreshProtectedPaths();
                    if (!protectedPaths) continue;
                    const outcome = remove.immediate(candidate);
                    if (outcome !== null) {
                        removed = outcome;
                        break;
                    }
                    protectedPaths = null;
                }
                if (removed) result.removedFiles += 1;
                else result.skippedFiles += 1;
            } catch (error) {
                result.skippedFiles += 1;
                if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
                    result.errors.push({ path: candidate, code: error.code || 'CACHE_CLEANUP_FAILED' });
                }
            }
            if ((index + 1) % 100 === 0) await new Promise(resolve => setImmediate(resolve));
        }
        return result;
    });
}
