import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveAppDataDir } from '../dataPaths.js';

const require = createRequire(import.meta.url);
const CONTENT_INDEX_SCHEMA_VERSION = '1';
const DEFAULT_SEARCH_LIMIT = 1000;
const MAX_SEARCH_LIMIT = 10000;
const READY_STATUSES = new Set(['ready', 'ok', 'truncated', 'empty']);
const SEARCHABLE_STATUSES = ['ready', 'ok', 'truncated'];
const PENDING_STATUSES = new Set(['pending', 'queued', 'indexing']);
const FAILED_STATUSES = new Set(['failed', 'error']);
const UNICODE61_TOKEN_PATTERN = /[\p{L}\p{N}\p{M}\p{Co}]+/gu;
const CONNECTION_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];
const connectionRetryWaitState = new Int32Array(new SharedArrayBuffer(4));

let DatabaseConstructor = null;

function getDatabaseConstructor() {
    if (!DatabaseConstructor) DatabaseConstructor = require('better-sqlite3');
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

function contentIndexError(message, code, cause = null) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function normalizePath(value, fieldName) {
    const source = String(value || '').trim();
    if (!source) {
        throw contentIndexError(`${fieldName} is required.`, 'ERR_CONTENT_INDEX_INVALID_ARGUMENT');
    }
    return path.resolve(source);
}

function normalizeStatus(value, fallback = 'ready') {
    return String(value || fallback).trim().toLowerCase() || fallback;
}

function normalizeErrorText(value) {
    if (value instanceof Error) return value.message || String(value);
    return String(value || '');
}

function normalizeTokenText(tokens) {
    if (Array.isArray(tokens)) {
        return [...new Set(tokens
            .map(token => String(token || '').trim())
            .filter(Boolean))]
            .join(' ');
    }
    return String(tokens || '').trim();
}

function countProvidedTokens(tokenText) {
    if (!tokenText) return 0;
    return tokenText.split(/\s+/).filter(Boolean).length;
}

function queryTokens(value) {
    const values = Array.isArray(value) ? value : [value];
    const tokens = [];
    const seen = new Set();
    for (const item of values) {
        const matches = String(item || '').normalize('NFC').match(UNICODE61_TOKEN_PATTERN) || [];
        for (const token of matches) {
            const key = token.toLocaleLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            tokens.push(token);
        }
    }
    return tokens;
}

function literalFtsToken(token) {
    return `"${String(token).replace(/"/g, '""')}"`;
}

function andFtsQuery(value) {
    return queryTokens(value).map(token => `${literalFtsToken(token)}*`).join(' AND ');
}

function normalizedLibraryPaths(libraries = []) {
    return [...new Set((libraries || [])
        .filter(Boolean)
        .map(libraryPath => path.resolve(libraryPath)))];
}

function safeFileSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function isSqliteBusyError(error) {
    const code = String(error?.code || '');
    return code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED');
}

function waitForConnectionRetry(delayMs) {
    Atomics.wait(connectionRetryWaitState, 0, 0, delayMs);
}

export class ContentIndexDB {
    constructor(options = {}) {
        this.dbPath = options.dbPath
            || path.join(options.userDataPath || defaultUserDataPath(), 'content_index', 'content.db');
        this.db = null;
        this.lock = Promise.resolve();
        this.closing = false;
        this.closed = false;
        this.closePromise = null;
    }

    getConnection() {
        if (this.closed) {
            throw contentIndexError('Content index DB is closed.', 'ERR_CONTENT_INDEX_CLOSED');
        }
        if (this.db) return this.db;

        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        const Database = getDatabaseConstructor();
        for (let attempt = 0; ; attempt += 1) {
            const db = new Database(this.dbPath);
            try {
                db.pragma('busy_timeout = 5000');
                db.pragma('journal_mode = WAL');
                db.pragma('synchronous = NORMAL');
                db.pragma('foreign_keys = ON');
                db.pragma('temp_store = MEMORY');
                db.pragma('cache_size = -32768');
                db.pragma('mmap_size = 268435456');
                this.db = db;
                this.createSchema();
                db.pragma('optimize');
                return db;
            } catch (error) {
                this.db = null;
                try {
                    db.close();
                } catch {
                    // 실패한 연결은 다음 재시도에서 새로 엽니다.
                }
                const retryDelay = CONNECTION_RETRY_DELAYS_MS[attempt];
                if (!isSqliteBusyError(error) || retryDelay === undefined) throw error;
                waitForConnectionRetry(retryDelay);
            }
        }
    }

    createSchema() {
        const db = this.db;
        db.exec(`
            CREATE TABLE IF NOT EXISTS content_index_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                document_id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                library_path TEXT NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                mtime REAL NOT NULL DEFAULT 0,
                ext TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT NOT NULL DEFAULT '',
                token_count INTEGER NOT NULL DEFAULT 0,
                indexed_at TEXT NOT NULL DEFAULT '',
                extractor_version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS documents_library_status_idx
            ON documents(library_path, status);
        `);

        const schemaVersion = db.prepare(
            'SELECT value FROM content_index_meta WHERE key = ?',
        ).get('schema_version')?.value;
        if (schemaVersion && schemaVersion !== CONTENT_INDEX_SCHEMA_VERSION) {
            throw contentIndexError(
                `Unsupported content index schema version: ${schemaVersion}.`,
                'ERR_CONTENT_INDEX_SCHEMA',
            );
        }

        const existingFts = db.prepare(`
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'document_terms_fts'
        `).get();
        if (!existingFts) {
            try {
                db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS document_terms_fts USING fts5(
                        tokens,
                        content='',
                        contentless_delete=1,
                        detail=none,
                        tokenize='unicode61'
                    );
                `);
            } catch (error) {
                const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get()?.version || 'unknown';
                throw contentIndexError(
                    `This SQLite runtime cannot create the contentless FTS5 index (SQLite ${sqliteVersion}).`,
                    'ERR_CONTENT_INDEX_UNSUPPORTED',
                    error,
                );
            }
        } else {
            const sql = String(existingFts.sql || '');
            const compatible = /content\s*=\s*''/i.test(sql)
                && /contentless_delete\s*=\s*1/i.test(sql)
                && /detail\s*=\s*none/i.test(sql)
                && /tokenize\s*=\s*'unicode61'/i.test(sql);
            if (!compatible) {
                throw contentIndexError(
                    'The existing content index uses an incompatible FTS5 schema.',
                    'ERR_CONTENT_INDEX_SCHEMA',
                );
            }
        }

        db.prepare(`
            INSERT INTO content_index_meta(key, value) VALUES('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(CONTENT_INDEX_SCHEMA_VERSION);
    }

    withLock(operation) {
        if (this.closing || this.closed) {
            return Promise.reject(contentIndexError(
                'Content index DB is closed.',
                'ERR_CONTENT_INDEX_CLOSED',
            ));
        }
        const result = this.lock.then(operation);
        this.lock = result.catch(() => {});
        return result;
    }

    normalizeDocument(record = {}, existing = null, overrides = {}) {
        const filePath = normalizePath(record.path || record.file_path || existing?.path, 'path');
        const libraryPath = normalizePath(
            record.library_path || record.libraryPath || existing?.library_path,
            'library_path',
        );
        const size = Math.max(0, Number(record.size ?? existing?.size) || 0);
        const mtime = Number(record.mtime ?? existing?.mtime) || 0;
        const extractorVersion = Math.max(
            0,
            Math.floor(Number(
                record.extractor_version
                ?? record.extractorVersion
                ?? existing?.extractor_version
                ?? 1,
            ) || 0),
        );
        return {
            path: filePath,
            library_path: libraryPath,
            size,
            mtime,
            ext: String(record.ext ?? existing?.ext ?? path.extname(filePath)).trim().toLowerCase(),
            status: normalizeStatus(overrides.status ?? record.status ?? existing?.status, 'ready'),
            error: normalizeErrorText(overrides.error ?? record.error ?? ''),
            token_count: Math.max(0, Math.floor(Number(
                overrides.tokenCount
                ?? record.token_count
                ?? record.tokenCount
                ?? existing?.token_count
                ?? 0,
            ) || 0)),
            indexed_at: String(
                overrides.indexedAt
                ?? record.indexed_at
                ?? record.indexedAt
                ?? new Date().toISOString(),
            ),
            extractor_version: extractorVersion,
        };
    }

    getDocument(filePath) {
        return this.withLock(async () => {
            const normalizedPath = normalizePath(filePath, 'path');
            return this.getConnection().prepare(
                'SELECT * FROM documents WHERE path = ?',
            ).get(normalizedPath) || null;
        });
    }

    upsertDocumentTokens(record = {}, tokens = undefined) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const tokenText = normalizeTokenText(tokens ?? record.tokens ?? '');
            const selectByPath = db.prepare('SELECT * FROM documents WHERE path = ?');
            const deleteTerms = db.prepare('DELETE FROM document_terms_fts WHERE rowid = ?');
            const saveDocument = db.prepare(`
                INSERT INTO documents (
                    path, library_path, size, mtime, ext, status, error,
                    token_count, indexed_at, extractor_version
                ) VALUES (
                    @path, @library_path, @size, @mtime, @ext, @status, @error,
                    @token_count, @indexed_at, @extractor_version
                )
                ON CONFLICT(path) DO UPDATE SET
                    library_path = excluded.library_path,
                    size = excluded.size,
                    mtime = excluded.mtime,
                    ext = excluded.ext,
                    status = excluded.status,
                    error = excluded.error,
                    token_count = excluded.token_count,
                    indexed_at = excluded.indexed_at,
                    extractor_version = excluded.extractor_version
            `);
            const selectId = db.prepare('SELECT document_id FROM documents WHERE path = ?');
            const insertTerms = db.prepare(
                'INSERT INTO document_terms_fts(rowid, tokens) VALUES (?, ?)',
            );

            const write = db.transaction(() => {
                const inputPath = normalizePath(record.path || record.file_path, 'path');
                const existing = selectByPath.get(inputPath) || null;
                const status = normalizeStatus(record.status, 'ready');
                const document = this.normalizeDocument(record, existing, {
                    status,
                    error: record.error || '',
                    tokenCount: record.token_count
                        ?? record.tokenCount
                        ?? countProvidedTokens(tokenText),
                });
                if (existing) deleteTerms.run(existing.document_id);
                saveDocument.run(document);
                const documentId = selectId.get(document.path).document_id;
                if (tokenText && SEARCHABLE_STATUSES.includes(document.status)) {
                    insertTerms.run(documentId, tokenText);
                }
                return selectByPath.get(document.path);
            });
            return write.immediate();
        });
    }

    markDocumentFailed(record = {}, error = '') {
        return this.withLock(async () => {
            const db = this.getConnection();
            const inputPath = normalizePath(record.path || record.file_path, 'path');
            const selectByPath = db.prepare('SELECT * FROM documents WHERE path = ?');
            const write = db.transaction(() => {
                const existing = selectByPath.get(inputPath) || null;
                const document = this.normalizeDocument(record, existing, {
                    status: 'failed',
                    error: error || record.error || 'Content extraction failed.',
                    tokenCount: 0,
                    indexedAt: record.indexed_at || record.indexedAt || new Date().toISOString(),
                });
                if (existing) {
                    db.prepare('DELETE FROM document_terms_fts WHERE rowid = ?')
                        .run(existing.document_id);
                }
                db.prepare(`
                    INSERT INTO documents (
                        path, library_path, size, mtime, ext, status, error,
                        token_count, indexed_at, extractor_version
                    ) VALUES (
                        @path, @library_path, @size, @mtime, @ext, @status, @error,
                        @token_count, @indexed_at, @extractor_version
                    )
                    ON CONFLICT(path) DO UPDATE SET
                        library_path = excluded.library_path,
                        size = excluded.size,
                        mtime = excluded.mtime,
                        ext = excluded.ext,
                        status = excluded.status,
                        error = excluded.error,
                        token_count = 0,
                        indexed_at = excluded.indexed_at,
                        extractor_version = excluded.extractor_version
                `).run(document);
                return selectByPath.get(document.path);
            });
            return write.immediate();
        });
    }

    removeDocumentPaths(db, filePaths = []) {
        const normalizedPaths = [...new Set(filePaths
            .filter(Boolean)
            .map(filePath => path.resolve(filePath)))];
        if (normalizedPaths.length === 0) return 0;

        const selectDocument = db.prepare(
            'SELECT document_id FROM documents WHERE path = ?',
        );
        const deleteTerms = db.prepare(
            'DELETE FROM document_terms_fts WHERE rowid = ?',
        );
        const deleteDocument = db.prepare('DELETE FROM documents WHERE document_id = ?');
        let removedCount = 0;
        const remove = db.transaction(() => {
            for (const filePath of normalizedPaths) {
                const document = selectDocument.get(filePath);
                if (!document) continue;
                deleteTerms.run(document.document_id);
                removedCount += deleteDocument.run(document.document_id).changes;
            }
        });
        remove.immediate();
        return removedCount;
    }

    removeDocuments(filePaths = []) {
        return this.withLock(async () => ({
            removedCount: this.removeDocumentPaths(this.getConnection(), filePaths),
        }));
    }

    removeDocumentsNotInLibrary(libraryPath, currentPaths = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const normalizedLibraryPath = normalizePath(libraryPath, 'library_path');
            const currentPathSet = new Set((currentPaths || [])
                .filter(Boolean)
                .map(filePath => path.resolve(filePath)));
            const missingPaths = db.prepare(
                'SELECT path FROM documents WHERE library_path = ?',
            ).all(normalizedLibraryPath)
                .map(row => row.path)
                .filter(filePath => !currentPathSet.has(path.resolve(filePath)));
            return {
                removedCount: this.removeDocumentPaths(db, missingPaths),
            };
        });
    }

    removeMissingRoots(activeLibraryPaths = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const activeRoots = new Set(normalizedLibraryPaths(activeLibraryPaths));
            const missingPaths = db.prepare(
                'SELECT path, library_path FROM documents',
            ).all()
                .filter(document => !activeRoots.has(path.resolve(document.library_path)))
                .map(document => document.path);
            return {
                removedCount: this.removeDocumentPaths(db, missingPaths),
            };
        });
    }

    search(tokens, libraries = [], options = {}) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const query = andFtsQuery(tokens);
            const libraryPaths = normalizedLibraryPaths(libraries);
            if (!query || libraryPaths.length === 0) return [];

            const limit = Math.max(
                1,
                Math.min(
                    MAX_SEARCH_LIMIT,
                    Math.floor(Number(options.limit) || DEFAULT_SEARCH_LIMIT),
                ),
            );
            const libraryPlaceholders = libraryPaths.map(() => '?').join(', ');
            const statusPlaceholders = SEARCHABLE_STATUSES.map(() => '?').join(', ');
            return db.prepare(`
                SELECT d.*
                FROM document_terms_fts
                JOIN documents AS d ON d.document_id = document_terms_fts.rowid
                WHERE document_terms_fts MATCH ?
                    AND d.status IN (${statusPlaceholders})
                    AND d.library_path IN (${libraryPlaceholders})
                ORDER BY d.path COLLATE NOCASE ASC
                LIMIT ?
            `).all(query, ...SEARCHABLE_STATUSES, ...libraryPaths, limit);
        });
    }

    getStatus(libraries = []) {
        return this.withLock(async () => {
            const db = this.getConnection();
            const libraryPaths = normalizedLibraryPaths(libraries);
            const whereClause = libraryPaths.length > 0
                ? `WHERE library_path IN (${libraryPaths.map(() => '?').join(', ')})`
                : '';
            const rows = db.prepare(`
                SELECT
                    status,
                    COUNT(*) AS count,
                    COALESCE(SUM(token_count), 0) AS token_count,
                    MAX(indexed_at) AS last_indexed_at
                FROM documents
                ${whereClause}
                GROUP BY status
            `).all(...libraryPaths);
            const statusCounts = Object.fromEntries(
                rows.map(row => [normalizeStatus(row.status, 'pending'), Number(row.count) || 0]),
            );
            const countStatuses = statuses => [...statuses]
                .reduce((total, status) => total + (statusCounts[status] || 0), 0);
            return {
                totalCount: rows.reduce((total, row) => total + (Number(row.count) || 0), 0),
                readyCount: countStatuses(READY_STATUSES),
                pendingCount: countStatuses(PENDING_STATUSES),
                failedCount: countStatuses(FAILED_STATUSES),
                tokenCount: rows.reduce((total, row) => total + (Number(row.token_count) || 0), 0),
                lastIndexedAt: rows
                    .map(row => row.last_indexed_at || '')
                    .sort()
                    .at(-1) || '',
                statusCounts,
            };
        });
    }

    getDatabaseSize() {
        return this.withLock(async () => {
            this.getConnection();
            const databaseBytes = safeFileSize(this.dbPath);
            const walBytes = safeFileSize(`${this.dbPath}-wal`);
            const sharedMemoryBytes = safeFileSize(`${this.dbPath}-shm`);
            return {
                databaseBytes,
                walBytes,
                sharedMemoryBytes,
                totalBytes: databaseBytes + walBytes + sharedMemoryBytes,
            };
        });
    }

    clear() {
        return this.withLock(async () => {
            const db = this.getConnection();
            const removedCount = Number(
                db.prepare('SELECT COUNT(*) AS count FROM documents').get()?.count || 0,
            );
            db.transaction(() => {
                db.prepare(`
                    INSERT INTO document_terms_fts(document_terms_fts)
                    VALUES('delete-all')
                `).run();
                db.prepare('DELETE FROM documents').run();
            }).immediate();
            db.pragma('wal_checkpoint(TRUNCATE)');
            db.exec('VACUUM');
            db.pragma('wal_checkpoint(TRUNCATE)');
            return { removedCount };
        });
    }

    close() {
        if (this.closePromise) return this.closePromise;
        this.closing = true;
        this.closePromise = this.lock.then(() => {
            if (this.db) {
                try {
                    this.db.pragma('wal_checkpoint(PASSIVE)');
                } catch {
                    // 다른 연결이 사용 중이면 SQLite close에 맡깁니다.
                }
                this.db.close();
                this.db = null;
            }
            this.closed = true;
        });
        this.lock = this.closePromise.catch(() => {});
        return this.closePromise;
    }
}
