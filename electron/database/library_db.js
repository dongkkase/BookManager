import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { resolveAppDataDir } from '../dataPaths.js';
import {
    FILE_EXTENSION_FORMAT_VALUES,
    normalizeMetadataFormat,
} from '../metadataFormat.js';
import { buildLibraryFolderIndexRecords } from '../libraryFolderIndex.js';

const require = createRequire(import.meta.url);
let DatabaseConstructor = null;

function getDatabaseConstructor() {
    if (!DatabaseConstructor) {
        DatabaseConstructor = require('better-sqlite3');
    }
    return DatabaseConstructor;
}

function defaultUserDataPath() {
    try {
        const electron = require('electron');
        if (electron?.app?.isPackaged && electron?.app?.getPath) {
            return resolveAppDataDir(path.dirname(electron.app.getPath('exe')));
        }
    } catch {
        // 일반 Node 테스트에서는 프로젝트 BookManagerData 경로를 사용합니다.
    }
    return resolveAppDataDir(process.cwd());
}

const FILE_COLUMNS = [
    'path', 'mtime', 'size', 'ext', 'resolution', 'title', 'series', 'series_group',
    'volume', 'number', 'writer', 'creators', 'penciller', 'inker', 'colorist',
    'letterer', 'cover_artist', 'editor', 'publisher', 'imprint', 'genre',
    'volume_count', 'page_count', 'format', 'manga', 'language', 'rating',
    'age_rating', 'publish_date', 'summary', 'characters', 'teams', 'locations',
    'story_arc', 'tags', 'notes', 'web', 'isbn', 'book_type', 'thumb_path',
    'cover_override_path', 'has_metadata', 'metadata_override',
    'album', 'album_artist', 'composer', 'duration_seconds', 'bitrate',
    'sample_rate', 'codec', 'container', 'channels', 'track_number',
    'track_total', 'disc_number', 'disc_total', 'mime_type',
];

const TAG_METADATA_COLUMNS = [
    'path', 'ext', 'book_type', 'genre', 'tags', 'publisher', 'writer',
    'penciller', 'inker', 'colorist', 'letterer', 'cover_artist', 'editor',
    'age_rating', 'format', 'characters', 'publish_date',
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

const LIBRARY_FOLDER_COLUMNS = [
    'library_path',
    'folder_path',
    'parent_path',
    'name',
    'child_folder_count',
    'direct_file_count',
    'recursive_file_count',
    'last_seen_at',
];

const READING_STATE_COLUMNS = [
    'item_id',
    'file_path',
    'format',
    'locator_json',
    'page_index',
    'page_count',
    'scroll_percent',
    'position_seconds',
    'duration_seconds',
    'status',
    'last_read_at',
    'updated_at',
    'device_id',
    'revision',
    'deleted_at',
];

const FILE_SEARCH_COLUMNS = [
    'path',
    'title',
    'series',
    'series_group',
    'volume',
    'number',
    'writer',
    'creators',
    'penciller',
    'inker',
    'colorist',
    'letterer',
    'cover_artist',
    'editor',
    'publisher',
    'imprint',
    'genre',
    'isbn',
    'format',
    'summary',
    'characters',
    'teams',
    'locations',
    'story_arc',
    'tags',
    'notes',
    'web',
    'album',
    'album_artist',
    'composer',
    'codec',
    'container',
];

const FILE_SEARCH_INDEX_VERSION = '3';
const FILE_SEARCH_INDEX_META_KEY = 'files_search_index_version';
const FILE_PATH_NORMALIZATION_VERSION = 'darwin-nfd-v1';
const FILE_PATH_NORMALIZATION_META_KEY = 'files_path_normalization_version';
const FILE_SEARCH_SCHEMA_OBJECTS = [
    ['table', 'files_search_ids'],
    ['view', 'files_search_content'],
    ['table', 'files_search_fts'],
    ['trigger', 'files_search_ai'],
    ['trigger', 'files_search_ad'],
    ['trigger', 'files_search_au'],
];

function escapeLikeValue(value = '') {
    return String(value).replace(/[\\%_]/g, match => `\\${match}`);
}

function ftsLiteralPhrase(value = '') {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function isDatabaseBusyError(error) {
    return ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code);
}

function isRepairableSearchIndexError(error) {
    return (
        ['SQLITE_CORRUPT', 'SQLITE_CORRUPT_VTAB'].includes(error?.code)
        || /^Search index mapping is inconsistent/.test(error?.message || '')
    );
}

export function normalizeLibraryFilePath(filePath = '', platform = process.platform) {
    const value = String(filePath || '');
    return platform === 'darwin' ? value.normalize('NFD') : value;
}

function hasStoredFileValue(value) {
    return value !== null && value !== undefined && value !== '' && value !== 0;
}

function storedFileValueCount(record = {}) {
    return FILE_COLUMNS.reduce(
        (count, column) => count + (hasStoredFileValue(record[column]) ? 1 : 0),
        0,
    );
}

function finiteReadingNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function readingTimestamp(value, fallback = new Date().toISOString()) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(String(value || ''));
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function parseReadingLocator(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '{}'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function readingStateStatus(state = {}) {
    if (state.status === 'completed') return 'completed';
    const format = String(state.format || '').toLowerCase();
    const isAudio = format === 'audio' || state.duration_seconds > 0 || state.position_seconds > 0;
    if (isAudio) {
        return state.duration_seconds > 0 && state.position_seconds >= state.duration_seconds - 1
            ? 'completed'
            : 'reading';
    }
    return (
        state.page_count > 0 && state.page_index >= state.page_count - 1
    ) || state.scroll_percent >= 99.5
        ? 'completed'
        : 'reading';
}

function defaultReadingLocator(state = {}) {
    if (state.format === 'audio') {
        return { kind: 'audio-time', positionSeconds: state.position_seconds };
    }
    return {
        kind: 'page',
        pageIndex: state.page_index,
        scrollPercent: state.scroll_percent,
    };
}

function normalizeReadingStateRow(row = {}) {
    return {
        itemId: String(row.item_id || ''),
        filePath: String(row.file_path || ''),
        format: String(row.format || ''),
        locator: parseReadingLocator(row.locator_json),
        pageIndex: Math.max(0, Math.floor(finiteReadingNumber(row.page_index, 0))),
        pageCount: Math.max(0, Math.floor(finiteReadingNumber(row.page_count, 0))),
        scrollPercent: Math.max(0, Math.min(100, finiteReadingNumber(row.scroll_percent, 0))),
        positionSeconds: Math.max(0, finiteReadingNumber(row.position_seconds, 0)),
        durationSeconds: Math.max(0, finiteReadingNumber(row.duration_seconds, 0)),
        status: row.status === 'completed' ? 'completed' : 'reading',
        lastReadAt: String(row.last_read_at || ''),
        updatedAt: String(row.updated_at || ''),
        deviceId: String(row.device_id || ''),
        revision: Math.max(0, Math.floor(finiteReadingNumber(row.revision, 0))),
        deletedAt: String(row.deleted_at || ''),
    };
}

function mergeEquivalentFileRecords(records = [], canonicalPath = '') {
    const ranked = [...records].sort((left, right) => {
        const overrideOrder = Number(right.metadata_override) - Number(left.metadata_override);
        if (overrideOrder !== 0) return overrideOrder;
        if (Number(left.metadata_override) === 1 && Number(right.metadata_override) === 1) {
            const rowIdOrder = Number(right.storage_rowid || 0) - Number(left.storage_rowid || 0);
            if (rowIdOrder !== 0) return rowIdOrder;
        }
        const metadataOrder = Number(right.has_metadata) - Number(left.has_metadata);
        if (metadataOrder !== 0) return metadataOrder;
        const valueOrder = storedFileValueCount(right) - storedFileValueCount(left);
        if (valueOrder !== 0) return valueOrder;
        const mtimeOrder = Number(right.mtime || 0) - Number(left.mtime || 0);
        if (mtimeOrder !== 0) return mtimeOrder;
        return Number(right.path === canonicalPath) - Number(left.path === canonicalPath);
    });
    const preferred = ranked[0] || {};
    const merged = { ...preferred, path: canonicalPath };
    for (const column of ['mtime', 'size', 'ext', 'resolution', 'book_type']) {
        if (hasStoredFileValue(merged[column])) continue;
        const fallback = ranked.find(record => hasStoredFileValue(record[column]));
        if (fallback) merged[column] = fallback[column];
    }
    if (!hasStoredFileValue(merged.thumb_path)) {
        if (hasStoredFileValue(merged.cover_override_path)) {
            merged.thumb_path = merged.cover_override_path;
        } else {
            const fallback = ranked.find(record => (
                hasStoredFileValue(record.thumb_path)
                && !hasStoredFileValue(record.cover_override_path)
            ));
            if (fallback) merged.thumb_path = fallback.thumb_path;
        }
    }
    return merged;
}

export class LibraryDB {
    constructor(options = {}) {
        this.dbPath = options.dbPath || path.join(options.userDataPath || defaultUserDataPath(), 'library.db');
        this.platform = options.platform || process.platform;
        this.db = null;
        this.lock = Promise.resolve();
        this.searchIndexAttempted = false;
        this.searchIndexReady = false;
        this.searchIndexUnhealthy = false;
    }

    getConnection() {
        if (this.db) return this.db;
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        const Database = getDatabaseConstructor();
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('cache_size = -65536');
        this.db.pragma('mmap_size = 268435456');
        this.db.pragma('busy_timeout = 5000');
        this.createTables();
        this.ensureSchemaColumns();
        this.migrateLegacyTables();
        this.normalizeStoredFilePaths();
        this.sanitizeFormatColumn();
        this.db.pragma('optimize');
        return this.db;
    }

    normalizeFilePath(filePath = '') {
        return normalizeLibraryFilePath(filePath, this.platform);
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
                penciller TEXT,
                inker TEXT,
                colorist TEXT,
                letterer TEXT,
                cover_artist TEXT,
                editor TEXT,
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
                isbn TEXT,
                book_type TEXT,
                thumb_path TEXT,
                cover_override_path TEXT,
                has_metadata INTEGER,
                metadata_override INTEGER,
                album TEXT,
                album_artist TEXT,
                composer TEXT,
                duration_seconds REAL,
                bitrate REAL,
                sample_rate REAL,
                codec TEXT,
                container TEXT,
                channels REAL,
                track_number TEXT,
                track_total TEXT,
                disc_number TEXT,
                disc_total TEXT,
                mime_type TEXT
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
            CREATE TABLE IF NOT EXISTS library_folders (
                library_path TEXT,
                folder_path TEXT,
                parent_path TEXT,
                name TEXT,
                child_folder_count INTEGER DEFAULT 0,
                direct_file_count INTEGER DEFAULT 0,
                recursive_file_count INTEGER DEFAULT 0,
                last_seen_at TEXT,
                PRIMARY KEY (library_path, folder_path)
            );
            CREATE TABLE IF NOT EXISTS library_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS text_metadata (
                content_hash TEXT PRIMARY KEY,
                metadata_json TEXT NOT NULL,
                record_json TEXT NOT NULL,
                cover_path TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS text_metadata_paths (
                path TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                FOREIGN KEY (content_hash) REFERENCES text_metadata(content_hash)
            );
            CREATE TABLE IF NOT EXISTS reading_states (
                item_id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL UNIQUE,
                format TEXT NOT NULL DEFAULT '',
                locator_json TEXT NOT NULL DEFAULT '{}',
                page_index INTEGER NOT NULL DEFAULT 0,
                page_count INTEGER NOT NULL DEFAULT 0,
                scroll_percent REAL NOT NULL DEFAULT 0,
                position_seconds REAL NOT NULL DEFAULT 0,
                duration_seconds REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'reading',
                last_read_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                device_id TEXT NOT NULL DEFAULT '',
                revision INTEGER NOT NULL DEFAULT 1,
                deleted_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_files_series ON files(series);
            CREATE INDEX IF NOT EXISTS idx_files_title ON files(title);
            CREATE INDEX IF NOT EXISTS idx_files_title_nocase ON files(title COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_files_writer ON files(writer);
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
            CREATE INDEX IF NOT EXISTS idx_files_path_nocase ON files(path COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_text_metadata_paths_hash ON text_metadata_paths(content_hash);
            CREATE INDEX IF NOT EXISTS idx_dup_target_folder ON dup_target_index(target_folder);
            CREATE INDEX IF NOT EXISTS idx_dup_target_name ON dup_target_index(name);
            CREATE INDEX IF NOT EXISTS idx_library_scan_status ON library_scan_state(status);
            CREATE INDEX IF NOT EXISTS idx_library_folders_parent ON library_folders(library_path, parent_path, name);
            CREATE INDEX IF NOT EXISTS idx_library_folders_path ON library_folders(folder_path);
            CREATE INDEX IF NOT EXISTS idx_reading_states_recent ON reading_states(deleted_at, last_read_at DESC);
        `);
    }

    tableColumns(name) {
        if (!this.tableExists(name)) return new Set();
        return new Set(this.db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
    }

    ensureSchemaColumns() {
        const fileColumns = this.tableColumns('files');
        const fileColumnDefinitions = {
            isbn: 'TEXT',
            book_type: 'TEXT',
            penciller: 'TEXT',
            inker: 'TEXT',
            colorist: 'TEXT',
            letterer: 'TEXT',
            cover_artist: 'TEXT',
            editor: 'TEXT',
            cover_override_path: 'TEXT',
            has_metadata: 'INTEGER',
            metadata_override: 'INTEGER',
            album: 'TEXT',
            album_artist: 'TEXT',
            composer: 'TEXT',
            duration_seconds: 'REAL',
            bitrate: 'REAL',
            sample_rate: 'REAL',
            codec: 'TEXT',
            container: 'TEXT',
            channels: 'REAL',
            track_number: 'TEXT',
            track_total: 'TEXT',
            disc_number: 'TEXT',
            disc_total: 'TEXT',
            mime_type: 'TEXT',
        };
        for (const [column, definition] of Object.entries(fileColumnDefinitions)) {
            if (!fileColumns.has(column)) {
                this.db.exec(`ALTER TABLE files ADD COLUMN ${column} ${definition}`);
            }
        }

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
        this.db.function('normalize_library_file_path', filePath => this.normalizeFilePath(filePath));
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
                        normalize_library_file_path(${pathColumn}),
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

    normalizeStoredFilePaths() {
        if (this.platform !== 'darwin' || !this.tableExists('files')) return;
        const storedVersion = this.db.prepare('SELECT value FROM library_meta WHERE key = ?')
            .get(FILE_PATH_NORMALIZATION_META_KEY)?.value;
        if (storedVersion === FILE_PATH_NORMALIZATION_VERSION) return;

        const selectExact = this.db.prepare(`
            SELECT rowid AS storage_rowid, ${FILE_COLUMNS.join(', ')} FROM files WHERE path = ?
        `);
        const selectEquivalentRows = storedPathGroup => storedPathGroup
            .map(storedPath => selectExact.get(storedPath))
            .filter(Boolean);

        const remove = this.db.prepare('DELETE FROM files WHERE path = ?');
        const insert = this.db.prepare(`
            INSERT INTO files (${FILE_COLUMNS.join(', ')})
            VALUES (${FILE_COLUMNS.map(column => `@${column}`).join(', ')})
        `);
        const saveVersion = this.db.prepare(`
            INSERT INTO library_meta(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        const migrate = this.db.transaction(() => {
            const currentVersion = this.db.prepare('SELECT value FROM library_meta WHERE key = ?')
                .get(FILE_PATH_NORMALIZATION_META_KEY)?.value;
            if (currentVersion === FILE_PATH_NORMALIZATION_VERSION) return;

            const pathsByCanonicalPath = new Map();
            for (const row of this.db.prepare('SELECT path FROM files').iterate()) {
                const storedPath = row.path;
                const canonicalPath = this.normalizeFilePath(storedPath);
                if (!pathsByCanonicalPath.has(canonicalPath)) {
                    pathsByCanonicalPath.set(canonicalPath, storedPath);
                    continue;
                }
                const existing = pathsByCanonicalPath.get(canonicalPath);
                if (Array.isArray(existing)) existing.push(storedPath);
                else pathsByCanonicalPath.set(canonicalPath, [existing, storedPath]);
            }
            const changedPathGroups = [];
            for (const [canonicalPath, storedPaths] of pathsByCanonicalPath) {
                const storedPathGroup = Array.isArray(storedPaths) ? storedPaths : [storedPaths];
                if (storedPathGroup.length > 1 || storedPathGroup[0] !== canonicalPath) {
                    changedPathGroups.push([canonicalPath, storedPathGroup]);
                }
            }
            if (changedPathGroups.length > 0) {
                this.db.exec(`
                    DROP TRIGGER IF EXISTS files_search_ai;
                    DROP TRIGGER IF EXISTS files_search_ad;
                    DROP TRIGGER IF EXISTS files_search_au;
                    DROP TABLE IF EXISTS files_search_fts;
                    DROP VIEW IF EXISTS files_search_content;
                    DROP TABLE IF EXISTS files_search_ids;
                `);
                this.db.prepare('DELETE FROM library_meta WHERE key = ?')
                    .run(FILE_SEARCH_INDEX_META_KEY);
            }
            for (const [canonicalPath, storedPathGroup] of changedPathGroups) {
                const equivalentRows = selectEquivalentRows(storedPathGroup);
                const merged = mergeEquivalentFileRecords(equivalentRows, canonicalPath);
                for (const row of equivalentRows) remove.run(row.path);
                insert.run(Object.fromEntries(
                    FILE_COLUMNS.map(column => [column, merged[column]]),
                ));
            }
            saveVersion.run(FILE_PATH_NORMALIZATION_META_KEY, FILE_PATH_NORMALIZATION_VERSION);
        });
        migrate.immediate();
        this.searchIndexAttempted = false;
        this.searchIndexReady = false;
        this.searchIndexUnhealthy = false;
    }

    sanitizeFormatColumn() {
        if (!this.tableExists('files') || FILE_EXTENSION_FORMAT_VALUES.length === 0) return;
        const placeholders = FILE_EXTENSION_FORMAT_VALUES.map(() => '?').join(', ');
        this.db.prepare(`
            UPDATE files
            SET format = ''
            WHERE REPLACE(UPPER(TRIM(COALESCE(format, ''))), '.', '') IN (${placeholders})
        `).run(...FILE_EXTENSION_FORMAT_VALUES);
    }

    hasSearchIndexSchema(db = this.getConnection()) {
        const version = db.prepare('SELECT value FROM library_meta WHERE key = ?')
            .get(FILE_SEARCH_INDEX_META_KEY)?.value;
        if (version !== FILE_SEARCH_INDEX_VERSION) return false;
        const schemaObject = db.prepare(`
            SELECT 1
            FROM sqlite_master
            WHERE type = ? AND name = ?
        `);
        return FILE_SEARCH_SCHEMA_OBJECTS.every(
            ([type, name]) => Boolean(schemaObject.get(type, name)),
        );
    }

    hasReadySearchIndex(db = this.getConnection()) {
        if (!this.hasSearchIndexSchema(db)) return false;
        this.assertSearchIndexIntegrity(db);
        return true;
    }

    assertSearchIndexIntegrity(db = this.getConnection()) {
        const mappingProblem = db.prepare(`
            SELECT 'missing-id' AS reason, f.path
            FROM files AS f
            LEFT JOIN files_search_ids AS ids ON ids.path = f.path
            WHERE ids.search_id IS NULL
            UNION ALL
            SELECT 'orphan-id' AS reason, ids.path
            FROM files_search_ids AS ids
            LEFT JOIN files AS f ON f.path = ids.path
            WHERE f.path IS NULL
            LIMIT 1
        `).get();
        if (mappingProblem) {
            throw new Error(
                `Search index mapping is inconsistent (${mappingProblem.reason}: ${mappingProblem.path}).`,
            );
        }
        db.prepare(`
            INSERT INTO files_search_fts(files_search_fts, rank)
            VALUES('integrity-check', 1)
        `).run();
    }

    rebuildSearchIndex(db = this.getConnection(), options = {}) {
        const searchColumns = FILE_SEARCH_COLUMNS.join(', ');
        const contentColumns = FILE_SEARCH_COLUMNS.map(column => `f.${column}`).join(', ');
        const oldSearchValues = FILE_SEARCH_COLUMNS.map(column => `old.${column}`).join(', ');
        const newSearchValues = FILE_SEARCH_COLUMNS.map(column => `new.${column}`).join(', ');
        const changedSearchValues = FILE_SEARCH_COLUMNS
            .map(column => `old.${column} IS NOT new.${column}`)
            .join(' OR ');
        let rebuilt = false;

        const rebuild = db.transaction(() => {
            if (this.hasSearchIndexSchema(db)) {
                if (options.repairExisting !== true) return;
                try {
                    this.assertSearchIndexIntegrity(db);
                    return;
                } catch (error) {
                    if (!isRepairableSearchIndexError(error)) throw error;
                    // The caller observed a broken index. Recheck after obtaining
                    // the write lock so a concurrent repair is not repeated.
                }
            }
            db.exec(`
                DROP TRIGGER IF EXISTS files_search_ai;
                DROP TRIGGER IF EXISTS files_search_ad;
                DROP TRIGGER IF EXISTS files_search_au;
                DROP TABLE IF EXISTS files_search_fts;
                DROP VIEW IF EXISTS files_search_content;
                DROP TABLE IF EXISTS files_search_ids;

                CREATE TABLE files_search_ids (
                    search_id INTEGER PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE
                );
                INSERT INTO files_search_ids (path)
                SELECT path FROM files ORDER BY path;

                CREATE VIEW files_search_content AS
                SELECT ids.search_id, ${contentColumns}
                FROM files AS f
                JOIN files_search_ids AS ids ON ids.path = f.path;

                CREATE VIRTUAL TABLE files_search_fts USING fts5(
                    ${searchColumns},
                    content='files_search_content',
                    content_rowid='search_id',
                    tokenize='trigram'
                );
                INSERT INTO files_search_fts(files_search_fts) VALUES('rebuild');

                CREATE TRIGGER files_search_ai AFTER INSERT ON files BEGIN
                    INSERT INTO files_search_ids(path)
                    SELECT new.path
                    WHERE NOT EXISTS (
                        SELECT 1 FROM files_search_ids WHERE path = new.path
                    );
                    INSERT INTO files_search_fts(rowid, ${searchColumns})
                    SELECT search_id, ${newSearchValues}
                    FROM files_search_ids
                    WHERE path = new.path;
                END;

                CREATE TRIGGER files_search_ad AFTER DELETE ON files BEGIN
                    INSERT INTO files_search_fts(files_search_fts, rowid, ${searchColumns})
                    SELECT 'delete', search_id, ${oldSearchValues}
                    FROM files_search_ids
                    WHERE path = old.path;
                    DELETE FROM files_search_ids WHERE path = old.path;
                END;

                CREATE TRIGGER files_search_au
                AFTER UPDATE OF ${searchColumns} ON files
                WHEN ${changedSearchValues}
                BEGIN
                    INSERT INTO files_search_fts(files_search_fts, rowid, ${searchColumns})
                    SELECT 'delete', search_id, ${oldSearchValues}
                    FROM files_search_ids
                    WHERE path = old.path;
                    UPDATE files_search_ids
                    SET path = new.path
                    WHERE path = old.path AND old.path IS NOT new.path;
                    INSERT INTO files_search_ids(path)
                    SELECT new.path
                    WHERE NOT EXISTS (
                        SELECT 1 FROM files_search_ids WHERE path = new.path
                    );
                    INSERT INTO files_search_fts(rowid, ${searchColumns})
                    SELECT search_id, ${newSearchValues}
                    FROM files_search_ids
                    WHERE path = new.path;
                END;
            `);
            db.prepare(`
                INSERT INTO library_meta(key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(FILE_SEARCH_INDEX_META_KEY, FILE_SEARCH_INDEX_VERSION);
            rebuilt = true;
        });
        rebuild.immediate();
        return rebuilt;
    }

    ensureSearchIndex(db = this.getConnection(), options = {}) {
        if (this.searchIndexReady) return true;
        if (this.searchIndexUnhealthy && options.repairUnhealthy !== true) return false;
        if (options.repairUnhealthy === true) {
            this.searchIndexAttempted = false;
            this.searchIndexUnhealthy = false;
        }
        if (this.searchIndexAttempted) return false;
        this.searchIndexAttempted = true;
        try {
            let verified = false;
            let repairExisting = false;
            try {
                verified = this.hasReadySearchIndex(db);
            } catch (error) {
                if (!isRepairableSearchIndexError(error)) throw error;
                repairExisting = true;
            }
            if (!verified) {
                this.rebuildSearchIndex(db, { repairExisting });
                if (!this.hasReadySearchIndex(db)) {
                    throw new Error('Search index schema is incomplete after preparation.');
                }
            }
            this.searchIndexReady = true;
            this.searchIndexUnhealthy = false;
        } catch (error) {
            this.searchIndexReady = false;
            if (isDatabaseBusyError(error)) {
                this.searchIndexAttempted = false;
            } else {
                this.searchIndexUnhealthy = true;
            }
            console.warn(`[LibraryDB] Search index unavailable; using LIKE fallback: ${error.message}`);
        }
        return this.searchIndexReady;
    }

    async prepareSearchIndex() {
        return this.withLock(async () => this.ensureSearchIndex(this.getConnection(), {
            repairUnhealthy: true,
        }));
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
        const filePath = this.normalizeFilePath(
            record.path || record.filepath || record.file_path || record.full_path || '',
        );
        return {
            ...record,
            path: filePath,
            mtime: record.mtime ?? record.mod_date ?? 0,
            size: record.size ?? record.file_size ?? 0,
            ext: record.ext || path.extname(filePath).toLowerCase(),
            title: record.title ?? record.meta_title ?? '',
            series: record.series ?? record.series_name ?? '',
            series_group: record.series_group ?? '',
            volume: record.volume ?? record.meta_volume ?? '',
            number: record.number ?? record.meta_chapter ?? '',
            writer: record.writer ?? record.meta_creator ?? '',
            page_count: record.page_count ?? record.pages ?? record.meta_pages ?? '',
            format: normalizeMetadataFormat(record.format ?? record.Format),
            isbn: record.isbn ?? record.ISBN ?? '',
            book_type: record.book_type ?? record.bookType ?? '',
            thumb_path: record.thumb_path ?? record.thumbnail ?? '',
            cover_override_path: record.cover_override_path ?? record.coverOverridePath ?? '',
            has_metadata: record.has_metadata ?? record.hasMetadata ?? '',
            metadata_override: record.metadata_override ?? record.metadataOverride ?? '',
            album: record.album ?? '',
            album_artist: record.album_artist ?? record.albumArtist ?? '',
            composer: record.composer ?? '',
            duration_seconds: record.duration_seconds ?? record.durationSeconds ?? '',
            bitrate: record.bitrate ?? record.bitrateBitsPerSecond ?? '',
            sample_rate: record.sample_rate ?? record.sampleRateHz ?? '',
            codec: record.codec ?? '',
            container: record.container ?? '',
            channels: record.channels ?? '',
            track_number: record.track_number ?? record.trackNumber ?? '',
            track_total: record.track_total ?? record.trackTotal ?? '',
            disc_number: record.disc_number ?? record.discNumber ?? '',
            disc_total: record.disc_total ?? record.discTotal ?? '',
            mime_type: record.mime_type ?? record.mimeType ?? '',
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
        ).get(this.normalizeFilePath(filePath)) || null);
    }

    async getTextMetadata(contentHash) {
        return this.withLock(async () => {
            const row = this.getConnection().prepare(
                'SELECT * FROM text_metadata WHERE content_hash = ?',
            ).get(contentHash);
            if (!row) return null;
            return {
                contentHash: row.content_hash,
                metadata: JSON.parse(row.metadata_json),
                record: JSON.parse(row.record_json),
                coverPath: row.cover_path,
            };
        });
    }

    async getTextMetadataPathHash(filePath) {
        return this.withLock(async () => this.getConnection().prepare(
            'SELECT content_hash FROM text_metadata_paths WHERE path = ?',
        ).get(this.normalizeFilePath(filePath))?.content_hash || '');
    }

    async getTextMetadataPaths(contentHash) {
        return this.withLock(async () => this.getConnection().prepare(
            'SELECT path FROM text_metadata_paths WHERE content_hash = ?',
        ).all(contentHash).map(row => row.path));
    }

    writeTextMetadataIndex(db, contentHash, record) {
        const normalized = this.normalizeFileRecord(record);
        const placeholders = FILE_COLUMNS.map(column => `@${column}`).join(', ');
        const updates = FILE_COLUMNS.slice(1).map(column => `${column} = excluded.${column}`).join(', ');
        db.prepare(`
            INSERT INTO files (${FILE_COLUMNS.join(', ')}) VALUES (${placeholders})
            ON CONFLICT(path) DO UPDATE SET ${updates}
        `).run(Object.fromEntries(FILE_COLUMNS.map(column => [column, normalized[column] ?? ''])));
        db.prepare(`
            INSERT INTO text_metadata_paths (path, content_hash) VALUES (?, ?)
            ON CONFLICT(path) DO UPDATE SET content_hash = excluded.content_hash
        `).run(normalized.path, contentHash);
    }

    async linkTextMetadataRecord({ contentHash, record, missingPaths = [] }) {
        return this.withLock(async () => {
            const db = this.getConnection();
            db.transaction(() => {
                this.writeTextMetadataIndex(db, contentHash, record);
                const remove = db.prepare(`
                    DELETE FROM files WHERE path = ? AND path IN (
                        SELECT path FROM text_metadata_paths WHERE content_hash = ?
                    )
                `);
                for (const filePath of missingPaths) remove.run(this.normalizeFilePath(filePath), contentHash);
            })();
        });
    }

    async saveTextMetadataRecord({ contentHash, metadata, record, coverPath = '', relatedRecords = [] }) {
        return this.withLock(async () => {
            const db = this.getConnection();
            db.transaction(() => {
                db.prepare(`
                    INSERT INTO text_metadata (content_hash, metadata_json, record_json, cover_path, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(content_hash) DO UPDATE SET
                        metadata_json = excluded.metadata_json,
                        record_json = excluded.record_json,
                        cover_path = excluded.cover_path,
                        updated_at = excluded.updated_at
                `).run(contentHash, JSON.stringify(metadata), JSON.stringify(record), coverPath, new Date().toISOString());
                this.writeTextMetadataIndex(db, contentHash, record);
                const linkedHash = db.prepare('SELECT content_hash FROM text_metadata_paths WHERE path = ?');
                for (const related of relatedRecords) {
                    if (linkedHash.get(this.normalizeFilePath(related.path))?.content_hash === contentHash) {
                        this.writeTextMetadataIndex(db, contentHash, related);
                    }
                }
            })();
        });
    }

    async getDistinctPublishers(limit = 500) {
        return this.withLock(async () => this.getConnection().prepare(`
            SELECT publisher, COUNT(*) AS count
            FROM files
            WHERE TRIM(COALESCE(publisher, '')) <> ''
            GROUP BY publisher
            ORDER BY count DESC, publisher COLLATE NOCASE ASC
            LIMIT ?
        `).all(Math.max(1, Math.min(5000, Number(limit) || 500))));
    }

    async getDistinctSeriesGroups(limit = 1000) {
        return this.withLock(async () => this.getConnection().prepare(`
            SELECT series_group, COUNT(*) AS count
            FROM files
            WHERE TRIM(COALESCE(series_group, '')) <> ''
            GROUP BY series_group
            ORDER BY count DESC, series_group COLLATE NOCASE ASC
            LIMIT ?
        `).all(Math.max(1, Math.min(5000, Number(limit) || 1000))));
    }

    async getMetadataTitleCandidates(criteria = {}) {
        return this.withLock(async () => {
            const title = String(criteria.title || '').trim();
            if (!title) return [];

            const limit = Math.max(1, Math.min(5000, Number(criteria.limit) || 5000));
            const titlePrefixes = [...new Set([
                title.normalize('NFC'),
                title.normalize('NFD'),
            ])].map(value => `${escapeLikeValue(value)}%`);
            const titleClauses = titlePrefixes.map(() => "title LIKE ? ESCAPE '\\' COLLATE NOCASE");
            return this.getConnection().prepare(`
                SELECT path, title, volume, number, mtime, book_type, ext
                FROM files
                WHERE (${titleClauses.join(' OR ')})
                ORDER BY mtime DESC, path COLLATE NOCASE ASC
                LIMIT ?
            `).all(...titlePrefixes, limit);
        });
    }

    async searchFiles(query, libraryPaths = [], options = {}) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const term = String(query || '').trim();
            const normalizedPaths = [...new Set((libraryPaths || [])
                .filter(Boolean)
                .map(folder => this.normalizeFilePath(path.resolve(folder))))];
            if (!term || normalizedPaths.length === 0) return [];

            const limit = Math.max(1, Math.min(5000, Number(options.limit) || 1000));
            const termVariants = [...new Set([
                term.normalize('NFC'),
                term.normalize('NFD'),
            ])];
            const canUseTrigramIndex = termVariants.every(
                value => Array.from(value).length >= 3,
            );
            const libraryClauses = normalizedPaths.map(() => "(f.path LIKE ? ESCAPE '\\')");
            const searchClauses = FILE_SEARCH_COLUMNS.map(column => `(${termVariants
                .map(() => `LOWER(COALESCE(f.${column}, '')) LIKE LOWER(?) ESCAPE '\\'`)
                .join(' OR ')})`);
            const libraryParams = normalizedPaths.map(folder => `${escapeLikeValue(`${folder}${path.sep}`)}%`);
            const searchParams = FILE_SEARCH_COLUMNS.flatMap(() => (
                termVariants.map(value => `%${escapeLikeValue(value)}%`)
            ));
            const ftsQuery = termVariants.map(ftsLiteralPhrase).join(' OR ');

            const runLikeSearch = () => db.prepare(`
                SELECT f.*
                FROM files AS f
                WHERE (${libraryClauses.join(' OR ')})
                    AND (${searchClauses.join(' OR ')})
                ORDER BY
                    COALESCE(NULLIF(f.series, ''), NULLIF(f.title, ''), f.path) COLLATE NOCASE ASC,
                    f.path COLLATE NOCASE ASC
                LIMIT ?
            `).all(...libraryParams, ...searchParams, limit);

            if (
                !canUseTrigramIndex
                || options.useSearchIndex === false
                || !this.ensureSearchIndex(db)
            ) {
                return runLikeSearch();
            }

            try {
                return db.prepare(`
                    SELECT f.*
                    FROM files_search_fts
                    JOIN files_search_ids AS ids ON ids.search_id = files_search_fts.rowid
                    JOIN files AS f ON f.path = ids.path
                    WHERE files_search_fts MATCH ?
                        AND (${libraryClauses.join(' OR ')})
                        AND (${searchClauses.join(' OR ')})
                    ORDER BY
                        COALESCE(NULLIF(f.series, ''), NULLIF(f.title, ''), f.path) COLLATE NOCASE ASC,
                        f.path COLLATE NOCASE ASC
                    LIMIT ?
                `).all(ftsQuery, ...libraryParams, ...searchParams, limit);
            } catch (error) {
                this.searchIndexReady = false;
                this.searchIndexAttempted = true;
                this.searchIndexUnhealthy = true;
                console.warn(`[LibraryDB] Indexed search failed; using LIKE fallback: ${error.message}`);
                return runLikeSearch();
            }
        });
    }

    async listTagMetadata(libraryPaths = []) {
        return this.withLock(async () => {
            const normalizedPaths = [...new Set((libraryPaths || [])
                .filter(Boolean)
                .map(folder => this.normalizeFilePath(path.resolve(folder))))];
            if (normalizedPaths.length === 0) return [];

            const clauses = normalizedPaths.map(() => "path LIKE ? ESCAPE '\\'");
            const params = normalizedPaths.map(folder => `${escapeLikeValue(`${folder}${path.sep}`)}%`);
            return this.getConnection().prepare(`
                SELECT ${TAG_METADATA_COLUMNS.join(', ')}
                FROM files
                WHERE ${clauses.map(clause => `(${clause})`).join(' OR ')}
                ORDER BY
                    COALESCE(NULLIF(series, ''), NULLIF(title, ''), path) COLLATE NOCASE ASC,
                    path COLLATE NOCASE ASC
            `).all(...params);
        });
    }

    async listFilesByPaths(filePaths = []) {
        return this.withLock(async () => {
            const normalizedPaths = [...new Set((filePaths || [])
                .filter(Boolean)
                .map(filePath => this.normalizeFilePath(String(filePath))))];
            if (normalizedPaths.length === 0) return [];

            const connection = this.getConnection();
            const rows = [];
            const chunkSize = 500;
            for (let index = 0; index < normalizedPaths.length; index += chunkSize) {
                const chunk = normalizedPaths.slice(index, index + chunkSize);
                const placeholders = chunk.map(() => '?').join(', ');
                rows.push(...connection.prepare(`
                    SELECT *
                    FROM files
                    WHERE path IN (${placeholders})
                `).all(...chunk));
            }
            const rowsByPath = new Map(rows.map(row => [row.path, row]));
            return normalizedPaths.map(filePath => rowsByPath.get(filePath)).filter(Boolean);
        });
    }

    readingDeviceId(connection = this.getConnection()) {
        const key = 'reading_device_id';
        const existing = connection.prepare('SELECT value FROM library_meta WHERE key = ?').get(key)?.value;
        if (existing) return existing;
        const deviceId = randomUUID();
        connection.prepare('INSERT OR IGNORE INTO library_meta (key, value) VALUES (?, ?)').run(key, deviceId);
        return connection.prepare('SELECT value FROM library_meta WHERE key = ?').get(key)?.value || deviceId;
    }

    async upsertReadingState(filePath, patch = {}) {
        return this.withLock(async () => {
            const value = String(filePath || '').trim();
            if (!value) return null;
            const connection = this.getConnection();
            const normalizedPath = this.normalizeFilePath(path.resolve(value));
            const previous = connection.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(normalizedPath) || {};
            const now = new Date().toISOString();
            const has = key => Object.prototype.hasOwnProperty.call(patch || {}, key);
            const pageIndex = Math.max(0, Math.floor(finiteReadingNumber(
                has('pageIndex') ? patch.pageIndex : previous.page_index,
                0,
            )));
            const pageCount = Math.max(0, Math.floor(finiteReadingNumber(
                has('pageCount') ? patch.pageCount : previous.page_count,
                0,
            )));
            const scrollPercent = Math.max(0, Math.min(100, finiteReadingNumber(
                has('scrollPercent') ? patch.scrollPercent : previous.scroll_percent,
                0,
            )));
            const positionSeconds = Math.max(0, finiteReadingNumber(
                has('positionSeconds') ? patch.positionSeconds : previous.position_seconds,
                0,
            ));
            const durationSeconds = Math.max(0, finiteReadingNumber(
                has('durationSeconds') ? patch.durationSeconds : previous.duration_seconds,
                0,
            ));
            const format = String(patch.format || previous.format || '').slice(0, 32);
            const nextState = {
                item_id: previous.item_id || randomUUID(),
                file_path: normalizedPath,
                format,
                page_index: pageIndex,
                page_count: pageCount,
                scroll_percent: scrollPercent,
                position_seconds: positionSeconds,
                duration_seconds: durationSeconds,
                status: '',
                last_read_at: readingTimestamp(patch.lastReadAt || patch.last_read_at, now),
                updated_at: now,
                device_id: previous.device_id || this.readingDeviceId(connection),
                revision: Math.max(0, Math.floor(finiteReadingNumber(previous.revision, 0))) + 1,
                deleted_at: '',
            };
            nextState.status = readingStateStatus({
                ...nextState,
                status: patch.status,
            });
            const previousLocator = parseReadingLocator(previous.locator_json);
            const locator = has('locator')
                ? parseReadingLocator(patch.locator)
                : Object.keys(previousLocator).length > 0
                    ? previousLocator
                    : defaultReadingLocator(nextState);
            nextState.locator_json = JSON.stringify(locator);

            connection.prepare(`
                INSERT INTO reading_states (${READING_STATE_COLUMNS.join(', ')})
                VALUES (${READING_STATE_COLUMNS.map(column => `@${column}`).join(', ')})
                ON CONFLICT(file_path) DO UPDATE SET
                    format = excluded.format,
                    locator_json = excluded.locator_json,
                    page_index = excluded.page_index,
                    page_count = excluded.page_count,
                    scroll_percent = excluded.scroll_percent,
                    position_seconds = excluded.position_seconds,
                    duration_seconds = excluded.duration_seconds,
                    status = excluded.status,
                    last_read_at = excluded.last_read_at,
                    updated_at = excluded.updated_at,
                    device_id = excluded.device_id,
                    revision = excluded.revision,
                    deleted_at = ''
            `).run(nextState);
            return normalizeReadingStateRow(
                connection.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(normalizedPath),
            );
        });
    }

    async listRecentReadingStates(limit = 50) {
        return this.withLock(async () => {
            const safeLimit = Math.max(1, Math.min(200, Math.floor(finiteReadingNumber(limit, 50))));
            return this.getConnection().prepare(`
                SELECT *
                FROM reading_states
                WHERE deleted_at = ''
                ORDER BY last_read_at DESC, updated_at DESC
                LIMIT ?
            `).all(safeLimit).map(normalizeReadingStateRow);
        });
    }

    async removeReadingState(filePath) {
        return this.withLock(async () => {
            const value = String(filePath || '').trim();
            if (!value) return { changes: 0 };
            const now = new Date().toISOString();
            const normalizedPath = this.normalizeFilePath(path.resolve(value));
            const result = this.getConnection().prepare(`
                UPDATE reading_states
                SET deleted_at = ?, updated_at = ?, revision = revision + 1
                WHERE file_path = ? AND deleted_at = ''
            `).run(now, now, normalizedPath);
            return { changes: result.changes };
        });
    }

    async clearReadingStates() {
        return this.withLock(async () => {
            const now = new Date().toISOString();
            const result = this.getConnection().prepare(`
                UPDATE reading_states
                SET deleted_at = ?, updated_at = ?, revision = revision + 1
                WHERE deleted_at = ''
            `).run(now, now);
            return { changes: result.changes };
        });
    }

    async getDataVersion() {
        return this.withLock(async () => Number(
            this.getConnection().pragma('data_version', { simple: true }),
        ) || 0);
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

    async getFilesByPaths(filePaths = []) {
        return this.withLock(async () => {
            const normalizedPaths = [...new Set((filePaths || [])
                .filter(Boolean)
                .map(filePath => this.normalizeFilePath(path.resolve(filePath))))];
            if (normalizedPaths.length === 0) return [];
            const db = this.getConnection();
            const rows = [];
            const chunkSize = 400;
            for (let offset = 0; offset < normalizedPaths.length; offset += chunkSize) {
                const chunk = normalizedPaths.slice(offset, offset + chunkSize);
                rows.push(...db.prepare(`
                    SELECT *
                    FROM files
                    WHERE path IN (${chunk.map(() => '?').join(', ')})
                `).all(...chunk));
            }
            return rows;
        });
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

    async replaceLibraryFolders(libraryPath, folders = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const normalizedLibraryPath = path.resolve(libraryPath);
            const remove = db.prepare('DELETE FROM library_folders WHERE library_path = ?');
            const insert = db.prepare(`
                INSERT INTO library_folders (${LIBRARY_FOLDER_COLUMNS.join(', ')})
                VALUES (${LIBRARY_FOLDER_COLUMNS.map(column => `@${column}`).join(', ')})
            `);
            const normalizedFolders = folders
                .map(folder => {
                    const folderPath = folder.folder_path || folder.folderPath || folder.path || '';
                    if (!folderPath) return null;
                    const normalizedFolderPath = path.resolve(folderPath);
                    const parentPath = folder.parent_path || folder.parentPath || '';
                    return {
                        library_path: normalizedLibraryPath,
                        folder_path: normalizedFolderPath,
                        parent_path: parentPath ? path.resolve(parentPath) : '',
                        name: folder.name || path.basename(normalizedFolderPath) || normalizedFolderPath,
                        child_folder_count: Number(folder.child_folder_count ?? folder.childFolderCount) || 0,
                        direct_file_count: Number(folder.direct_file_count ?? folder.directFileCount) || 0,
                        recursive_file_count: Number(folder.recursive_file_count ?? folder.recursiveFileCount) || 0,
                        last_seen_at: folder.last_seen_at || folder.lastSeenAt || new Date().toISOString(),
                    };
                })
                .filter(Boolean);

            db.transaction(() => {
                remove.run(normalizedLibraryPath);
                for (const folder of normalizedFolders) insert.run(folder);
            })();
            return { changes: normalizedFolders.length };
        });
    }

    async hasLibraryFolderIndex(libraryPath) {
        return this.withLock(async () => {
            const normalizedLibraryPath = path.resolve(libraryPath);
            const row = this.getConnection().prepare(`
                SELECT 1
                FROM library_folders
                WHERE library_path = ?
                LIMIT 1
            `).get(normalizedLibraryPath);
            return Boolean(row);
        });
    }

    async getLibraryFolderChildren(libraryPath, parentPath) {
        return this.withLock(async () => {
            const normalizedLibraryPath = path.resolve(libraryPath);
            const normalizedParentPath = path.resolve(parentPath || libraryPath);
            return this.getConnection().prepare(`
                SELECT
                    library_path,
                    folder_path,
                    parent_path,
                    name,
                    child_folder_count,
                    direct_file_count,
                    recursive_file_count,
                    last_seen_at
                FROM library_folders
                WHERE library_path = ? AND parent_path = ?
                ORDER BY name COLLATE NOCASE ASC
            `).all(normalizedLibraryPath, normalizedParentPath);
        });
    }

    async applyLibraryMoveIndexChanges(changes = {}) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const sourcePaths = (changes.sourcePaths || []).filter(Boolean).map(filePath => path.resolve(filePath));
            const sourcePrefixes = (changes.sourcePrefixes || []).filter(Boolean).map(folderPath => path.resolve(folderPath));
            const targetEntries = (changes.targetEntries || [])
                .map(entry => {
                    const fullPath = entry.full_path || entry.file_path || entry.path || '';
                    const targetFolder = entry.target_folder || entry.targetFolder || '';
                    if (!fullPath || !targetFolder) return null;
                    return {
                        full_path: path.resolve(fullPath),
                        target_folder: path.resolve(targetFolder),
                        name: entry.name || path.basename(fullPath),
                        size: Number(entry.size) || 0,
                        mtime: Number(entry.mtime) || 0,
                    };
                })
                .filter(Boolean);
            const fileInfoMoves = (changes.fileInfoMoves || [])
                .map(move => ({
                    src: move?.src ? this.normalizeFilePath(path.resolve(move.src)) : '',
                    dest: move?.dest ? this.normalizeFilePath(path.resolve(move.dest)) : '',
                    recursive: move?.recursive === true,
                }))
                .filter(move => move.src && move.dest);
            const targetIndexMoves = (changes.targetIndexMoves || [])
                .map(move => ({
                    src: move?.src ? path.resolve(move.src) : '',
                    dest: move?.dest ? path.resolve(move.dest) : '',
                    recursive: move?.recursive === true,
                }))
                .filter(move => move.src && move.dest);
            const fileInfoDeletes = (changes.fileInfoDeletes || [])
                .map(entry => ({
                    path: entry?.path ? this.normalizeFilePath(path.resolve(entry.path)) : '',
                    recursive: entry?.recursive === true,
                }))
                .filter(entry => entry.path);
            const touchedLibraries = [...new Set([
                ...(changes.touchedLibraries || []),
                ...targetEntries.map(entry => entry.target_folder),
            ].filter(Boolean).map(folderPath => path.resolve(folderPath)))];
            const checkedAt = changes.checkedAt || new Date().toISOString();

            const deleteTargetExact = db.prepare('DELETE FROM dup_target_index WHERE full_path = ?');
            const deleteTargetPrefix = db.prepare(`
                DELETE FROM dup_target_index
                WHERE full_path = ? OR full_path LIKE ? ESCAPE '\\'
            `);
            const selectTargetExact = db.prepare('SELECT * FROM dup_target_index WHERE full_path = ?');
            const selectTargetPrefix = db.prepare(`
                SELECT * FROM dup_target_index
                WHERE full_path = ? OR full_path LIKE ? ESCAPE '\\'
            `);
            const upsertTarget = db.prepare(`
                INSERT INTO dup_target_index (full_path, target_folder, name, size, mtime)
                VALUES (@full_path, @target_folder, @name, @size, @mtime)
                ON CONFLICT(full_path) DO UPDATE SET
                    target_folder = excluded.target_folder,
                    name = excluded.name,
                    size = excluded.size,
                    mtime = excluded.mtime
            `);
            const selectFileExact = db.prepare('SELECT * FROM files WHERE path = ?');
            const selectTextPath = db.prepare('SELECT content_hash FROM text_metadata_paths WHERE path = ?');
            const linkTextPath = db.prepare(`
                INSERT INTO text_metadata_paths (path, content_hash) VALUES (?, ?)
                ON CONFLICT(path) DO UPDATE SET content_hash = excluded.content_hash
            `);
            const selectFilePrefix = db.prepare(`
                SELECT * FROM files
                WHERE path = ? OR path LIKE ? ESCAPE '\\'
            `);
            const deleteFile = db.prepare('DELETE FROM files WHERE path = ?');
            const deleteFilePrefix = db.prepare(`
                DELETE FROM files
                WHERE path = ? OR path LIKE ? ESCAPE '\\'
            `);
            const upsertFile = db.prepare(`
                INSERT INTO files (${FILE_COLUMNS.join(', ')})
                VALUES (${FILE_COLUMNS.map(column => `@${column}`).join(', ')})
                ON CONFLICT(path) DO UPDATE SET ${FILE_COLUMNS.slice(1).map(column => `${column} = excluded.${column}`).join(', ')}
            `);
            const insertFileStub = db.prepare(`
                INSERT OR IGNORE INTO files (${FILE_COLUMNS.join(', ')})
                VALUES (${FILE_COLUMNS.map(column => `@${column}`).join(', ')})
            `);
            const countTargets = db.prepare('SELECT COUNT(*) AS count FROM dup_target_index WHERE target_folder = ?');
            const selectTargetPaths = db.prepare('SELECT full_path FROM dup_target_index WHERE target_folder = ?');
            const selectLibraryFolders = db.prepare('SELECT folder_path FROM library_folders WHERE library_path = ?');
            const removeLibraryFolders = db.prepare('DELETE FROM library_folders WHERE library_path = ?');
            const insertLibraryFolder = db.prepare(`
                INSERT INTO library_folders (${LIBRARY_FOLDER_COLUMNS.join(', ')})
                VALUES (${LIBRARY_FOLDER_COLUMNS.map(column => `@${column}`).join(', ')})
            `);
            const selectState = db.prepare('SELECT * FROM library_scan_state WHERE library_path = ?');
            const upsertState = db.prepare(`
                INSERT INTO library_scan_state (${LIBRARY_SCAN_STATE_COLUMNS.join(', ')})
                VALUES (${LIBRARY_SCAN_STATE_COLUMNS.map(column => `@${column}`).join(', ')})
                ON CONFLICT(library_path) DO UPDATE SET ${LIBRARY_SCAN_STATE_COLUMNS.slice(1).map(column => `${column} = excluded.${column}`).join(', ')}
            `);

            const prefixLike = folderPath => `${escapeLikeValue(`${folderPath}${path.sep}`)}%`;
            const fileStat = filePath => {
                try {
                    const stat = fs.statSync(filePath);
                    return { size: stat.size, mtime: stat.mtimeMs };
                } catch {
                    return { size: 0, mtime: 0 };
                }
            };
            const fileValues = (record = {}, filePath, stat = fileStat(filePath)) => {
                const values = Object.fromEntries(FILE_COLUMNS.map(column => [column, record[column] ?? '']));
                values.path = this.normalizeFilePath(filePath);
                const rawMtime = Number(stat.mtime) || 0;
                values.mtime = rawMtime > 100000000000 ? rawMtime / 1000 : rawMtime;
                values.size = stat.size;
                values.ext = path.extname(filePath).toLowerCase();
                if (!values.title && !(values.ext === '.txt' && Number(values.metadata_override) === 1)) {
                    values.title = path.parse(filePath).name;
                }
                return values;
            };
            const stateValues = libraryPath => {
                const previous = selectState.get(libraryPath) || {};
                const count = Number(countTargets.get(libraryPath)?.count || 0);
                const previousCount = beforeCounts.get(libraryPath) ?? Number(previous.indexed_count || 0);
                const addedCount = Math.max(0, count - previousCount);
                const removedCount = Math.max(0, previousCount - count);
                const rootMtime = (() => {
                    try {
                        return fs.statSync(libraryPath).mtimeMs;
                    } catch {
                        return 0;
                    }
                })();
                return {
                    library_path: libraryPath,
                    status: previous.last_scanned_at ? 'ready' : (previous.status || 'idle'),
                    fingerprint: '',
                    root_mtime: rootMtime,
                    file_count: count,
                    indexed_count: count,
                    added_count: addedCount,
                    updated_count: 0,
                    removed_count: removedCount,
                    last_scanned_at: previous.last_scanned_at || '',
                    last_checked_at: checkedAt,
                    last_changed_at: checkedAt,
                    last_error: '',
                    scan_reason: 'move',
                };
            };

            const beforeCounts = new Map(touchedLibraries.map(libraryPath => [
                libraryPath,
                Number(countTargets.get(libraryPath)?.count || 0),
            ]));
            const result = {
                removedTargetCount: 0,
                savedTargetCount: 0,
                movedTargetCount: 0,
                movedFileInfoCount: 0,
                deletedFileInfoCount: 0,
                stubbedFileInfoCount: 0,
                libraryCount: touchedLibraries.length,
            };

            db.transaction(() => {
                for (const filePath of sourcePaths) {
                    result.removedTargetCount += deleteTargetExact.run(filePath).changes;
                }
                for (const folderPath of sourcePrefixes) {
                    result.removedTargetCount += deleteTargetPrefix.run(folderPath, prefixLike(folderPath)).changes;
                }
                for (const entry of targetEntries) {
                    result.savedTargetCount += upsertTarget.run(entry).changes;
                }
                for (const move of targetIndexMoves) {
                    const rows = move.recursive
                        ? selectTargetPrefix.all(move.src, prefixLike(move.src))
                        : [selectTargetExact.get(move.src)].filter(Boolean);
                    for (const row of rows) {
                        const sourcePath = path.resolve(row.full_path);
                        const destinationPath = move.recursive
                            ? path.resolve(move.dest, path.relative(move.src, sourcePath))
                            : move.dest;
                        const relativeTargetFolder = path.relative(move.src, row.target_folder);
                        const targetFolderMovesWithSource = move.recursive && (
                            relativeTargetFolder === ''
                            || (!relativeTargetFolder.startsWith('..') && !path.isAbsolute(relativeTargetFolder))
                        );
                        const destinationTargetFolder = targetFolderMovesWithSource
                            ? path.resolve(move.dest, relativeTargetFolder)
                            : row.target_folder;
                        const stat = fileStat(destinationPath);
                        if (sourcePath !== destinationPath) deleteTargetExact.run(destinationPath);
                        deleteTargetExact.run(row.full_path);
                        upsertTarget.run({
                            ...row,
                            full_path: destinationPath,
                            target_folder: destinationTargetFolder,
                            name: path.basename(destinationPath),
                            size: stat.size,
                            mtime: stat.mtime,
                        });
                        result.movedTargetCount += 1;
                    }
                }
                for (const move of fileInfoMoves) {
                    const rows = move.recursive
                        ? selectFilePrefix.all(move.src, prefixLike(move.src))
                        : [selectFileExact.get(move.src)].filter(Boolean);
                    for (const row of rows) {
                        const sourcePath = this.normalizeFilePath(path.resolve(row.path));
                        const destinationPath = move.recursive
                            ? this.normalizeFilePath(path.resolve(move.dest, path.relative(move.src, sourcePath)))
                            : move.dest;
                        if (sourcePath !== destinationPath) deleteFile.run(destinationPath);
                        deleteFile.run(row.path);
                        upsertFile.run(fileValues(row, destinationPath));
                        const textPath = selectTextPath.get(row.path);
                        if (textPath) linkTextPath.run(destinationPath, textPath.content_hash);
                        result.movedFileInfoCount += 1;
                    }
                }
                for (const entry of fileInfoDeletes) {
                    result.deletedFileInfoCount += entry.recursive
                        ? deleteFilePrefix.run(entry.path, prefixLike(entry.path)).changes
                        : deleteFile.run(entry.path).changes;
                }
                for (const entry of targetEntries) {
                    const insertResult = insertFileStub.run(fileValues({
                        title: path.parse(entry.full_path).name,
                    }, entry.full_path, {
                        size: entry.size,
                        mtime: entry.mtime,
                    }));
                    result.stubbedFileInfoCount += insertResult.changes;
                }
                for (const libraryPath of touchedLibraries) {
                    upsertState.run(stateValues(libraryPath));
                }
                for (const libraryPath of touchedLibraries) {
                    const existingFolders = selectLibraryFolders.all(libraryPath)
                        .map(row => row.folder_path)
                        .filter(folderPath => folderPath && fs.existsSync(folderPath));
                    const targetPaths = selectTargetPaths.all(libraryPath)
                        .map(row => row.full_path)
                        .filter(Boolean);
                    if (existingFolders.length === 0 && targetPaths.length === 0) {
                        removeLibraryFolders.run(libraryPath);
                        continue;
                    }
                    const folderRecords = buildLibraryFolderIndexRecords(libraryPath, existingFolders, targetPaths);
                    removeLibraryFolders.run(libraryPath);
                    for (const record of folderRecords) insertLibraryFolder.run(record);
                }
            })();

            return result;
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

    async getMissingVolumeMetadata(libraryPaths = []) {
        return this.withLock(async () => {
            const roots = [...new Set(libraryPaths.filter(Boolean).flatMap(folder => {
                const root = this.normalizeFilePath(path.resolve(folder));
                return this.platform === 'darwin' ? [root.normalize('NFC'), root.normalize('NFD')] : [root];
            }))];
            if (roots.length === 0) return [];
            const fileClauses = roots.map(() => "path LIKE ? ESCAPE '\\'");
            const indexClauses = roots.map(() => "full_path LIKE ? ESCAPE '\\'");
            const prefixes = roots.map(folder => {
                const prefix = folder.endsWith(path.sep) ? folder : `${folder}${path.sep}`;
                return `${escapeLikeValue(prefix)}%`;
            });
            const rows = this.getConnection().prepare(`
                SELECT path, series FROM files
                WHERE ${fileClauses.map(clause => `(${clause})`).join(' OR ')}
                UNION
                SELECT full_path AS path, '' AS series FROM dup_target_index
                WHERE ${indexClauses.map(clause => `(${clause})`).join(' OR ')}
            `).all(...prefixes, ...prefixes);
            const filesByPath = new Map();
            for (const row of rows) {
                const key = this.normalizeFilePath(row.path);
                const previous = filesByPath.get(key);
                if (!previous || (!previous.series && row.series)) filesByPath.set(key, row);
            }
            return [...filesByPath.values()];
        });
    }

    async getAllFilesInPath(folderPath, includeSub) {
        return this.withLock(async () => {
            const normalized = this.normalizeFilePath(path.resolve(folderPath));
            const rows = this.getConnection().prepare('SELECT * FROM files WHERE path LIKE ?').all(
                `${normalized}${path.sep}%`,
            );
            return rows.filter(row => (
                includeSub
                || this.normalizeFilePath(path.dirname(path.resolve(row.path))) === normalized
            ));
        });
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.searchIndexAttempted = false;
        this.searchIndexReady = false;
        this.searchIndexUnhealthy = false;
        return Promise.resolve();
    }
}

let instance = null;

export function getLibraryDB() {
    if (!instance) instance = new LibraryDB();
    return instance;
}
