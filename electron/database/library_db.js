import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { resolveAppDataDir } from '../dataPaths.js';

const require = createRequire(import.meta.url);

function defaultUserDataPath() {
    try {
        const electron = require('electron');
        if (electron?.app?.isPackaged && electron?.app?.getPath) {
            return resolveAppDataDir(path.dirname(electron.app.getPath('exe')));
        }
    } catch {
        // 일반 Node 테스트에서는 프로젝트 data 경로를 사용합니다.
    }
    return resolveAppDataDir(process.cwd());
}

const FILE_COLUMNS = [
    'path', 'mtime', 'size', 'ext', 'resolution', 'title', 'series', 'series_group',
    'volume', 'number', 'writer', 'creators', 'publisher', 'imprint', 'genre',
    'volume_count', 'page_count', 'format', 'manga', 'language', 'rating',
    'age_rating', 'publish_date', 'summary', 'characters', 'teams', 'locations',
    'story_arc', 'tags', 'notes', 'web', 'thumb_path',
];

const LIBRARY_SCAN_STATE_COLUMNS = [
    'library_path',
    'status',
    'fingerprint',
    'root_mtime',
    'file_count',
    'indexed_count',
    'added_count',
    'updated_count',
    'removed_count',
    'last_scanned_at',
    'last_checked_at',
    'last_changed_at',
    'last_error',
    'scan_reason',
];

export class LibraryDB {
    constructor(options = {}) {
        this.dbPath = options.dbPath || path.join(options.userDataPath || defaultUserDataPath(), 'library.db');
        this.db = null;
        this.lock = Promise.resolve();
    }

    getConnection() {
        if (this.db) return this.db;
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this.createTables();
        this.ensureSchemaColumns();
        this.migrateLegacyTables();
        return this.db;
    }

    createTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                mtime REAL,
                size REAL,
                ext TEXT,
                resolution TEXT,
                title TEXT,
                series TEXT,
                series_group TEXT,
                volume TEXT,
                number TEXT,
                writer TEXT,
                creators TEXT,
                publisher TEXT,
                imprint TEXT,
                genre TEXT,
                volume_count TEXT,
                page_count TEXT,
                format TEXT,
                manga TEXT,
                language TEXT,
                rating TEXT,
                age_rating TEXT,
                publish_date TEXT,
                summary TEXT,
                characters TEXT,
                teams TEXT,
                locations TEXT,
                story_arc TEXT,
                tags TEXT,
                notes TEXT,
                web TEXT,
                thumb_path TEXT
            );
            CREATE TABLE IF NOT EXISTS dup_cache (
                a_path TEXT PRIMARY KEY,
                match_data TEXT
            );
            CREATE TABLE IF NOT EXISTS dup_target_index (
                full_path TEXT PRIMARY KEY,
                target_folder TEXT,
                name TEXT,
                size REAL,
                mtime REAL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS library_scan_state (
                library_path TEXT PRIMARY KEY,
                status TEXT,
                fingerprint TEXT,
                root_mtime REAL DEFAULT 0,
                file_count INTEGER DEFAULT 0,
                indexed_count INTEGER DEFAULT 0,
                added_count INTEGER DEFAULT 0,
                updated_count INTEGER DEFAULT 0,
                removed_count INTEGER DEFAULT 0,
                last_scanned_at TEXT,
                last_checked_at TEXT,
                last_changed_at TEXT,
                last_error TEXT,
                scan_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_files_series ON files(series);
            CREATE INDEX IF NOT EXISTS idx_files_title ON files(title);
            CREATE INDEX IF NOT EXISTS idx_files_writer ON files(writer);
            CREATE INDEX IF NOT EXISTS idx_dup_target_folder ON dup_target_index(target_folder);
            CREATE INDEX IF NOT EXISTS idx_dup_target_name ON dup_target_index(name);
            CREATE INDEX IF NOT EXISTS idx_library_scan_status ON library_scan_state(status);
        `);
    }

    tableColumns(name) {
        if (!this.tableExists(name)) return new Set();
        return new Set(this.db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
    }

    ensureSchemaColumns() {
        const dupColumns = this.tableColumns('dup_target_index');
        if (!dupColumns.has('mtime')) {
            this.db.exec('ALTER TABLE dup_target_index ADD COLUMN mtime REAL DEFAULT 0');
        }
    }

    tableExists(name) {
        return Boolean(this.db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(name));
    }

    migrateLegacyTables() {
        const migrate = this.db.transaction(() => {
            if (this.tableExists('file_info')) {
                const columns = new Set(this.db.prepare('PRAGMA table_info(file_info)').all().map(row => row.name));
                const value = (preferred, fallback = "''") => {
                    const candidates = Array.isArray(preferred) ? preferred : [preferred];
                    return candidates.find(candidate => columns.has(candidate)) || fallback;
                };
                const pathColumn = value(['path', 'filepath', 'file_path', 'full_path']);
                this.db.exec(`
                    INSERT OR IGNORE INTO files (
                        path, mtime, size, ext, title, series, volume, number,
                        writer, page_count, format, thumb_path
                    )
                    SELECT
                        ${pathColumn},
                        ${value('mod_date', '0')},
                        ${value(['size', 'file_size'], '0')},
                        ${value('ext')},
                        ${value('meta_title', value('title'))},
                        ${value('series_name', value('series'))},
                        ${value('meta_volume', value('volume'))},
                        ${value('meta_chapter', value('number'))},
                        ${value('meta_creator', value('writer'))},
                        ${value('meta_pages', value('pages', '0'))},
                        ${value('format')},
                        ${value('thumb_path', value('thumbnail'))}
                    FROM file_info
                    WHERE ${pathColumn} IS NOT NULL AND ${pathColumn} != ''
                `);
            }
            if (this.tableExists('target_index')) {
                const columns = new Set(this.db.prepare('PRAGMA table_info(target_index)').all().map(row => row.name));
                const value = (preferred, fallback = "''") => {
                    const candidates = Array.isArray(preferred) ? preferred : [preferred];
                    return candidates.find(candidate => columns.has(candidate)) || fallback;
                };
                const filePathColumn = value(['file_path', 'full_path', 'path', 'filepath']);
                const folderColumn = value(['target_folder', 'folder_path', 'library_path']);
                this.db.exec(`
                    INSERT OR IGNORE INTO dup_target_index (full_path, target_folder, name, size)
                    SELECT ${filePathColumn}, ${folderColumn}, '', 0 FROM target_index
                    WHERE ${filePathColumn} IS NOT NULL AND ${filePathColumn} != ''
                `);
            }
            if (this.tableExists('dup_match')) {
                const rows = this.db.prepare('SELECT * FROM dup_match').all();
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO dup_cache (a_path, match_data) VALUES (?, ?)',
                );
                for (const row of rows) {
                    insert.run(row.a_path, JSON.stringify({
                        match_path: row.match_path,
                        match_score: row.match_score,
                        match_time: row.match_time,
                    }));
                }
            }
        });
        migrate();
    }

    async initDB() {
        this.getConnection();
        return true;
    }

    async withLock(fn) {
        const operation = this.lock.then(fn);
        this.lock = operation.catch(() => {});
        return operation;
    }

    normalizeFileRecord(record = {}) {
        return {
            ...record,
            path: record.path || record.filepath || record.file_path || record.full_path || '',
            mtime: record.mtime ?? record.mod_date ?? 0,
            size: record.size ?? record.file_size ?? 0,
            ext: record.ext || path.extname(record.path || record.filepath || record.file_path || record.full_path || '').toLowerCase(),
            title: record.title ?? record.meta_title ?? '',
            series: record.series ?? record.series_name ?? '',
            series_group: record.series_group ?? '',
            volume: record.volume ?? record.meta_volume ?? '',
            number: record.number ?? record.meta_chapter ?? '',
            writer: record.writer ?? record.meta_creator ?? '',
            page_count: record.page_count ?? record.pages ?? record.meta_pages ?? '',
            format: record.format ?? '',
            thumb_path: record.thumb_path ?? record.thumbnail ?? '',
        };
    }

    async upsertFileInfo(record) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const normalized = this.normalizeFileRecord(record);
            const placeholders = FILE_COLUMNS.map(column => `@${column}`).join(', ');
            const updates = FILE_COLUMNS.slice(1).map(column => `${column} = excluded.${column}`).join(', ');
            const values = Object.fromEntries(FILE_COLUMNS.map(column => [column, normalized[column] ?? '']));
            const result = db.prepare(`
                INSERT INTO files (${FILE_COLUMNS.join(', ')})
                VALUES (${placeholders})
                ON CONFLICT(path) DO UPDATE SET ${updates}
            `).run(values);
            return { changes: result.changes };
        });
    }

    async upsertFileInfoBulk(records = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const placeholders = FILE_COLUMNS.map(column => `@${column}`).join(', ');
            const updates = FILE_COLUMNS.slice(1).map(column => `${column} = excluded.${column}`).join(', ');
            const statement = db.prepare(`
                INSERT INTO files (${FILE_COLUMNS.join(', ')})
                VALUES (${placeholders})
                ON CONFLICT(path) DO UPDATE SET ${updates}
            `);
            const insertMany = db.transaction(items => {
                for (const record of items) {
                    const normalized = this.normalizeFileRecord(record);
                    statement.run(Object.fromEntries(FILE_COLUMNS.map(column => [column, normalized[column] ?? ''])));
                }
            });
            insertMany(records);
            return { successCount: records.length, errorCount: 0 };
        });
    }

    async getFileInfo(filePath) {
        return this.withLock(async () => this.getConnection().prepare(
            `SELECT *,
                path AS filepath,
                path AS file_path,
                mtime AS mod_date,
                size AS file_size,
                page_count AS pages,
                thumb_path AS thumbnail
            FROM files WHERE path = ?`,
        ).get(filePath) || null);
    }

    async saveTargetIndex(records = []) {
        return this.withLock(async () => {
            const statement = this.getConnection().prepare(`
                INSERT INTO dup_target_index (full_path, target_folder, name, size, mtime)
                VALUES (@full_path, @target_folder, @name, @size, @mtime)
                ON CONFLICT(full_path) DO UPDATE SET
                    target_folder = excluded.target_folder,
                    name = excluded.name,
                    size = excluded.size,
                    mtime = excluded.mtime
            `);
            const insertMany = this.db.transaction(items => {
                for (const record of items) {
                    const fullPath = record.full_path || record.file_path || record.path || record.filepath;
                    statement.run({
                        full_path: fullPath,
                        target_folder: record.target_folder,
                        name: record.name || path.basename(fullPath),
                        size: Number(record.size) || 0,
                        mtime: Number(record.mtime) || 0,
                    });
                }
            });
            insertMany(records);
            return { successCount: records.length };
        });
    }

    async getTargetIndex(targetFolder) {
        return this.withLock(async () => this.getConnection().prepare(`
            SELECT full_path, target_folder, name, size, mtime
            FROM dup_target_index WHERE target_folder = ?
        `).all(targetFolder).map(row => ({
            ...row,
            file_path: row.full_path,
            path: path.dirname(row.full_path),
        })));
    }

    async replaceTargetIndex(targetFolder, filePaths = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const remove = db.prepare('DELETE FROM dup_target_index WHERE target_folder = ?');
            const insert = db.prepare(`
                INSERT INTO dup_target_index (full_path, target_folder, name, size, mtime)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(full_path) DO UPDATE SET
                    target_folder = excluded.target_folder,
                    name = excluded.name,
                    size = excluded.size,
                    mtime = excluded.mtime
            `);
            db.transaction(() => {
                remove.run(targetFolder);
                for (const filePath of filePaths) {
                    let size = 0;
                    let mtime = 0;
                    try {
                        const stat = fs.statSync(filePath);
                        size = stat.size;
                        mtime = stat.mtimeMs;
                    } catch {
                        size = 0;
                    }
                    insert.run(filePath, targetFolder, path.basename(filePath), size, mtime);
                }
            })();
            return { changes: filePaths.length };
        });
    }

    async syncTargetIndex(targetFolder, entries = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const normalizedTargetFolder = path.resolve(targetFolder);
            const existingRows = db.prepare(`
                SELECT full_path, size, mtime
                FROM dup_target_index
                WHERE target_folder = ?
            `).all(normalizedTargetFolder);
            const existingByPath = new Map(existingRows.map(row => [path.resolve(row.full_path), row]));
            const normalizedEntries = entries
                .map(entry => {
                    const sourcePath = entry.full_path || entry.file_path || entry.path || '';
                    if (!sourcePath) return null;
                    const fullPath = path.resolve(sourcePath);
                    return {
                        full_path: fullPath,
                        target_folder: normalizedTargetFolder,
                        name: entry.name || path.basename(fullPath),
                        size: Number(entry.size) || 0,
                        mtime: Number(entry.mtime) || 0,
                    };
                })
                .filter(Boolean);
            const nextPathSet = new Set(normalizedEntries.map(entry => entry.full_path));
            const added = [];
            const updated = [];
            const unchanged = [];
            const removed = [];
            const removeStatement = db.prepare('DELETE FROM dup_target_index WHERE full_path = ?');
            const upsertStatement = db.prepare(`
                INSERT INTO dup_target_index (full_path, target_folder, name, size, mtime)
                VALUES (@full_path, @target_folder, @name, @size, @mtime)
                ON CONFLICT(full_path) DO UPDATE SET
                    target_folder = excluded.target_folder,
                    name = excluded.name,
                    size = excluded.size,
                    mtime = excluded.mtime
            `);

            db.transaction(() => {
                for (const row of existingRows) {
                    const fullPath = path.resolve(row.full_path);
                    if (!nextPathSet.has(fullPath)) {
                        removed.push(row.full_path);
                        removeStatement.run(row.full_path);
                    }
                }

                for (const entry of normalizedEntries) {
                    const existing = existingByPath.get(entry.full_path);
                    const isUnchanged = existing
                        && Number(existing.size) === entry.size
                        && Math.abs(Number(existing.mtime || 0) - entry.mtime) < 2;
                    if (isUnchanged) {
                        unchanged.push(entry.full_path);
                        continue;
                    }
                    if (existing) updated.push(entry.full_path);
                    else added.push(entry.full_path);
                    upsertStatement.run(entry);
                }
            })();

            return {
                added,
                updated,
                removed,
                unchanged,
                addedCount: added.length,
                updatedCount: updated.length,
                removedCount: removed.length,
                unchangedCount: unchanged.length,
                indexedCount: normalizedEntries.length,
            };
        });
    }

    normalizeLibraryScanState(record = {}) {
        const libraryPath = record.library_path || record.libraryPath || record.path || '';
        return {
            library_path: libraryPath ? path.resolve(libraryPath) : '',
            status: record.status || 'idle',
            fingerprint: record.fingerprint || '',
            root_mtime: Number(record.root_mtime ?? record.rootMtime) || 0,
            file_count: Number(record.file_count ?? record.fileCount) || 0,
            indexed_count: Number(record.indexed_count ?? record.indexedCount) || 0,
            added_count: Number(record.added_count ?? record.addedCount) || 0,
            updated_count: Number(record.updated_count ?? record.updatedCount) || 0,
            removed_count: Number(record.removed_count ?? record.removedCount) || 0,
            last_scanned_at: record.last_scanned_at || record.lastScannedAt || '',
            last_checked_at: record.last_checked_at || record.lastCheckedAt || '',
            last_changed_at: record.last_changed_at || record.lastChangedAt || '',
            last_error: record.last_error || record.lastError || '',
            scan_reason: record.scan_reason || record.scanReason || '',
        };
    }

    async saveLibraryScanState(record = {}) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const normalized = this.normalizeLibraryScanState(record);
            if (!normalized.library_path) return { changes: 0 };
            const columns = LIBRARY_SCAN_STATE_COLUMNS;
            const placeholders = columns.map(column => `@${column}`).join(', ');
            const updates = columns.slice(1).map(column => `${column} = excluded.${column}`).join(', ');
            const values = Object.fromEntries(columns.map(column => [column, normalized[column] ?? '']));
            const result = db.prepare(`
                INSERT INTO library_scan_state (${columns.join(', ')})
                VALUES (${placeholders})
                ON CONFLICT(library_path) DO UPDATE SET ${updates}
            `).run(values);
            return { changes: result.changes };
        });
    }

    async getLibraryScanState(libraryPath) {
        return this.withLock(async () => {
            const value = String(libraryPath || '');
            if (!value) return null;
            const normalized = path.resolve(value);
            return this.getConnection().prepare(`
                SELECT *
                FROM library_scan_state
                WHERE library_path = ?
            `).get(normalized) || null;
        });
    }

    async getLibraryScanStates(libraryPaths = []) {
        return this.withLock(async () => {
            const normalizedPaths = [...new Set((libraryPaths || []).filter(Boolean).map(folder => path.resolve(folder)))];
            if (normalizedPaths.length === 0) return [];
            const statement = this.getConnection().prepare(`
                SELECT *
                FROM library_scan_state
                WHERE library_path = ?
            `);
            return normalizedPaths.map(libraryPath => statement.get(libraryPath) || {
                library_path: libraryPath,
                status: 'idle',
                fingerprint: '',
                root_mtime: 0,
                file_count: 0,
                indexed_count: 0,
                added_count: 0,
                updated_count: 0,
                removed_count: 0,
                last_scanned_at: '',
                last_checked_at: '',
                last_changed_at: '',
                last_error: '',
                scan_reason: '',
            });
        });
    }

    async removeTargetIndexBulk(paths = []) {
        if (paths.length === 0) return { changes: 0 };
        return this.withLock(async () => {
            const statement = this.getConnection().prepare('DELETE FROM dup_target_index WHERE full_path = ?');
            let changes = 0;
            this.db.transaction(items => {
                for (const filePath of items) changes += statement.run(filePath).changes;
            })(paths);
            return { changes };
        });
    }

    async saveDupMatch(aPath, matchData) {
        return this.withLock(async () => {
            const result = this.getConnection().prepare(`
                INSERT INTO dup_cache (a_path, match_data) VALUES (?, ?)
                ON CONFLICT(a_path) DO UPDATE SET match_data = excluded.match_data
            `).run(aPath, JSON.stringify(matchData || {}));
            return { changes: result.changes };
        });
    }

    async getDupMatch(aPath) {
        return this.withLock(async () => {
            const row = this.getConnection().prepare('SELECT match_data FROM dup_cache WHERE a_path = ?').get(aPath);
            if (!row) return null;
            try {
                return JSON.parse(row.match_data);
            } catch {
                return null;
            }
        });
    }

    async getAllDupMatch() {
        return this.withLock(async () => Object.fromEntries(
            this.getConnection().prepare('SELECT a_path, match_data FROM dup_cache').all().map(row => {
                try {
                    return [row.a_path, JSON.parse(row.match_data)];
                } catch {
                    return [row.a_path, null];
                }
            }),
        ));
    }

    async saveDupMatchesBulk(matchList = []) {
        return this.withLock(async () => {
            const statement = this.getConnection().prepare(`
                INSERT INTO dup_cache (a_path, match_data) VALUES (?, ?)
                ON CONFLICT(a_path) DO UPDATE SET match_data = excluded.match_data
            `);
            this.db.transaction(items => {
                for (const match of items) {
                    const aPath = Array.isArray(match) ? match[0] : match.a_path;
                    const data = Array.isArray(match) ? match[1] : match.match_data || match;
                    statement.run(aPath, JSON.stringify(data || {}));
                }
            })(matchList);
            return { successCount: matchList.length };
        });
    }

    async clearDupCache() {
        return this.withLock(async () => {
            const result = this.getConnection().prepare('DELETE FROM dup_cache').run();
            this.db.exec('VACUUM');
            return { changes: result.changes };
        });
    }

    async getAllFilesInPath(folderPath, includeSub) {
        return this.withLock(async () => {
            const normalized = path.resolve(folderPath);
            const rows = this.getConnection().prepare('SELECT * FROM files WHERE path LIKE ?').all(
                `${normalized}${path.sep}%`,
            );
            return rows.filter(row => includeSub || path.dirname(path.resolve(row.path)) === normalized);
        });
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        return Promise.resolve();
    }
}

let instance = null;

export function getLibraryDB() {
    if (!instance) instance = new LibraryDB();
    return instance;
}
