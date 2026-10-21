import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function statIfPresent(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function makeCopiedDataWritable(directory) {
    fs.chmodSync(directory, 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            makeCopiedDataWritable(entryPath);
        } else if (entry.isFile()) {
            fs.chmodSync(entryPath, 0o600 | (fs.statSync(entryPath).mode & 0o100));
        }
    }
}

function migrateStoredCoverPaths(directory, sourceDir, destinationDir) {
    const dbPath = path.join(directory, 'library.db');
    if (!statIfPresent(dbPath)) return;
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { fileMustExist: true });
    const sourcePrefix = `${path.resolve(sourceDir)}${path.sep}`;
    const remap = value => typeof value === 'string' && value.startsWith(sourcePrefix)
        ? path.join(destinationDir, value.slice(sourcePrefix.length))
        : value;
    try {
        db.function('migrate_data_cover_path', remap);
        db.transaction(() => {
            for (const [table, candidates] of [
                ['files', ['thumb_path', 'cover_override_path']],
                ['file_info', ['thumb_path', 'thumbnail']],
                ['text_metadata', ['cover_path']],
            ]) {
                const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
                for (const column of candidates.filter(candidate => columns.has(candidate))) {
                    db.prepare(`UPDATE ${table} SET ${column} = migrate_data_cover_path(${column})
                        WHERE instr(${column}, ?) = 1`).run(sourcePrefix);
                }
                if (table === 'text_metadata' && columns.has('record_json')) {
                    const update = db.prepare('UPDATE text_metadata SET record_json = ? WHERE content_hash = ?');
                    for (const row of db.prepare('SELECT content_hash, record_json FROM text_metadata').all()) {
                        const record = JSON.parse(row.record_json);
                        let changed = false;
                        for (const key of ['thumb_path', 'cover_override_path']) {
                            if (record?.[key] !== remap(record?.[key])) {
                                record[key] = remap(record[key]);
                                changed = true;
                            }
                        }
                        if (changed) update.run(JSON.stringify(record), row.content_hash);
                    }
                }
            }
        })();
        db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
        db.close();
    }
}

export function assertAppDataDirWritable(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    for (const relativePath of [
        'config.json', 'library.db', 'library.db-wal', 'library.db-shm',
        '.api_cache.db', '.api_cache.db-wal', '.api_cache.db-shm', 'rename_history.json',
        'content_index', 'content_index/content.db', 'content_index/content.db-wal', 'content_index/content.db-shm',
        'thumbnails', 'text-thumbnails', 'api_cover_cache', 'logs', 'models',
    ]) {
        const entryPath = path.join(directory, relativePath);
        const stat = statIfPresent(entryPath);
        if (stat) {
            fs.accessSync(entryPath, fs.constants.R_OK | fs.constants.W_OK | (stat.isDirectory() ? fs.constants.X_OK : 0));
        }
    }
    const probeDir = fs.mkdtempSync(path.join(directory, '.write-check-'));
    try {
        const probePath = path.join(probeDir, 'write');
        fs.writeFileSync(probePath, 'BookManager', { flag: 'wx', mode: 0o600 });
        fs.renameSync(probePath, path.join(probeDir, 'replace'));
    } finally {
        fs.rmSync(probeDir, { recursive: true, force: true });
    }
}

export function migrateMacAppDataDir(appDataDir, legacyDirs) {
    if (statIfPresent(appDataDir)) return appDataDir;
    for (const legacyDir of legacyDirs) {
        const stat = statIfPresent(legacyDir);
        if (!stat) continue;
        if (!stat.isDirectory()) throw new Error(`App data path is not a directory: ${legacyDir}`);

        const parentDir = path.dirname(appDataDir);
        fs.mkdirSync(parentDir, { recursive: true });
        const stagingDir = fs.mkdtempSync(path.join(parentDir, '.BookManagerData-migration-'));
        try {
            // Keep the source intact, including when its parent is read-only.
            fs.cpSync(legacyDir, stagingDir, { recursive: true, dereference: true, force: false, errorOnExist: true });
            makeCopiedDataWritable(stagingDir);
            migrateStoredCoverPaths(stagingDir, legacyDir, appDataDir);
            assertAppDataDirWritable(stagingDir);
            fs.renameSync(stagingDir, appDataDir);
            return appDataDir;
        } finally {
            try {
                if (statIfPresent(stagingDir)) {
                    makeCopiedDataWritable(stagingDir);
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                }
            } catch (error) {
                console.warn('Could not remove incomplete app data migration:', error);
            }
        }
    }
    return appDataDir;
}
