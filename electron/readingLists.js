import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readingActionFormat } from './readingActions.js';

const RECENT_ACTIVITY_LIMIT = 1000;
const RECENT_ACTIVITY_DAYS = 14;

function recentActivityCutoff() {
    return new Date(Date.now() - RECENT_ACTIVITY_DAYS * 86400000).toISOString();
}

function recentActivityCount(db, column, cutoff) {
    return db.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT activity.path FROM reading_file_activity activity JOIN files ON files.path = activity.path
        WHERE activity.${column} >= ? LIMIT ?
    )`).get(cutoff, RECENT_ACTIVITY_LIMIT).count;
}

export function initializeReadingLists(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS reading_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            name_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reading_list_members (
            list_id TEXT NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            added_at TEXT NOT NULL,
            is_directory INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (list_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_reading_list_members_path ON reading_list_members(path);
        CREATE TABLE IF NOT EXISTS reading_file_activity (
            path TEXT PRIMARY KEY,
            added_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_reading_activity_added ON reading_file_activity(added_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reading_activity_updated ON reading_file_activity(updated_at DESC);
        INSERT OR IGNORE INTO reading_lists VALUES ('want-to-read', '', '', 'wishlist', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        CREATE TRIGGER IF NOT EXISTS reading_activity_insert AFTER INSERT ON files BEGIN
            INSERT OR IGNORE INTO reading_file_activity(path, added_at, updated_at)
            VALUES (new.path, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
        END;
        CREATE TRIGGER IF NOT EXISTS reading_activity_update AFTER UPDATE ON files
        WHEN old.mtime IS NOT new.mtime OR old.size IS NOT new.size
            OR old.title IS NOT new.title OR old.series IS NOT new.series
            OR old.writer IS NOT new.writer OR old.summary IS NOT new.summary
            OR old.rating IS NOT new.rating OR old.genre IS NOT new.genre
            OR old.volume IS NOT new.volume OR old.number IS NOT new.number
            OR old.tags IS NOT new.tags OR old.cover_override_path IS NOT new.cover_override_path
        BEGIN
            INSERT INTO reading_file_activity(path, added_at, updated_at)
            VALUES (new.path, '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at;
        END;
    `);
    if (!db.pragma('table_info(reading_list_members)').some(column => column.name === 'is_directory')) {
        db.exec('ALTER TABLE reading_list_members ADD COLUMN is_directory INTEGER NOT NULL DEFAULT 0');
    }
}

const prefixPattern = value => `${`${value}${path.sep}`.replace(/[\\%_]/g, '\\$&')}%`;

export function moveReadingListPaths(db, move) {
    const where = move.recursive ? "path = ? OR path LIKE ? ESCAPE '\\'" : 'path = ?';
    const params = move.recursive ? [move.src, prefixPattern(move.src)] : [move.src];
    for (const table of ['reading_list_members', 'reading_file_activity']) {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params);
        for (const row of rows) {
            const destination = move.recursive ? path.resolve(move.dest, path.relative(move.src, row.path)) : move.dest;
            if (destination === row.path) continue;
            if (table === 'reading_list_members') {
                db.prepare('INSERT OR IGNORE INTO reading_list_members (list_id, path, added_at, is_directory) VALUES (?, ?, ?, ?)')
                    .run(row.list_id, destination, row.added_at, row.is_directory);
                db.prepare('DELETE FROM reading_list_members WHERE list_id = ? AND path = ?').run(row.list_id, row.path);
            } else {
                db.prepare(`INSERT INTO reading_file_activity VALUES (?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET added_at = excluded.added_at, updated_at = excluded.updated_at`)
                    .run(destination, row.added_at, row.updated_at);
                db.prepare('DELETE FROM reading_file_activity WHERE path = ?').run(row.path);
            }
        }
    }
}

export function deleteReadingListPaths(db, entry) {
    const where = entry.recursive ? "path = ? OR path LIKE ? ESCAPE '\\'" : 'path = ?';
    const params = entry.recursive ? [entry.path, prefixPattern(entry.path)] : [entry.path];
    for (const table of ['reading_list_members', 'reading_file_activity']) {
        db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params);
    }
}

function validatePaths(paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 10000 || paths.some(value => (
        typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0') || !path.isAbsolute(value)
    ))) throw new Error('invalid_paths');
}

async function resolveListEntries(library, paths) {
    validatePaths(paths);
    const pending = [...paths];
    const visited = new Set();
    const entries = [];
    const errors = [];
    while (pending.length) {
        const filePath = path.resolve(pending.pop());
        const key = library.normalizeFilePath(filePath);
        if (visited.has(key)) continue;
        visited.add(key);
        try {
            const stat = await fs.lstat(filePath);
            if (stat.isDirectory()) {
                entries.push({ path: key, isDirectory: true });
            } else if (stat.isFile() && readingActionFormat(filePath)) entries.push({ path: key, isDirectory: false });
        } catch (error) {
            errors.push({ path: filePath, message: error.message });
        }
    }
    return { entries, errors };
}

function collectionName(value) {
    const name = String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) throw new Error('invalid_name');
    return { name, key: name.toLocaleLowerCase('en-US') };
}

function requireList(db, id, collectionOnly = false) {
    const row = db.prepare('SELECT * FROM reading_lists WHERE id = ?').get(String(id || ''));
    if (!row || (collectionOnly && row.kind !== 'collection')) throw new Error('list_not_found');
    return row;
}

export async function readingListsRequest(library, request = {}) {
    const operation = request?.operation;
    if (operation === 'add') {
        await library.withLock(() => requireList(library.getConnection(), request.id));
        const resolved = await resolveListEntries(library, request.paths);
        return library.withLock(() => {
            const db = library.getConnection();
            requireList(db, request.id);
            const insert = db.prepare('INSERT OR IGNORE INTO reading_list_members (list_id, path, added_at, is_directory) VALUES (?, ?, ?, ?)');
            const addedAt = new Date().toISOString();
            const changes = db.transaction(() => resolved.entries.reduce((count, entry) => (
                count + insert.run(request.id, entry.path, addedAt, Number(entry.isDirectory)).changes
            ), 0))();
            return { changes, matchedCount: resolved.entries.length, errors: resolved.errors };
        });
    }
    return library.withLock(() => {
        const db = library.getConnection();
        if (operation === 'overview') {
            const lists = db.prepare(`SELECT lists.id, lists.name, lists.kind, lists.created_at, COUNT(members.path) AS count
                FROM reading_lists lists LEFT JOIN reading_list_members members ON members.list_id = lists.id
                GROUP BY lists.id ORDER BY lists.created_at, lists.name`).all();
            const cutoff = recentActivityCutoff();
            return {
                collections: lists.filter(list => list.kind === 'collection'),
                wishlistCount: lists.find(list => list.kind === 'wishlist')?.count || 0,
                recentAddedCount: recentActivityCount(db, 'added_at', cutoff),
                recentUpdatedCount: recentActivityCount(db, 'updated_at', cutoff),
            };
        }
        if (operation === 'preview') {
            requireList(db, request.id, true);
            return { previewRows: db.prepare(`SELECT path, is_directory FROM reading_list_members
                WHERE list_id = ? ORDER BY is_directory, added_at, path`).all(request.id) };
        }
        if (operation === 'list') {
            if (['recent-added', 'recent-updated'].includes(request.id)) {
                const column = request.id === 'recent-added' ? 'added_at' : 'updated_at';
                const rows = db.prepare(`SELECT files.*, activity.${column} AS list_added_at
                    FROM reading_file_activity activity JOIN files ON files.path = activity.path
                    WHERE activity.${column} >= ? ORDER BY activity.${column} DESC, files.path LIMIT ?`)
                    .all(recentActivityCutoff(), RECENT_ACTIVITY_LIMIT);
                return { rows };
            }
            requireList(db, request.id);
            return { rows: db.prepare(`SELECT files.*, members.path AS path, members.added_at AS list_added_at, members.is_directory
                FROM reading_list_members members LEFT JOIN files ON files.path = members.path
                WHERE members.list_id = ? ORDER BY members.added_at DESC, members.path`).all(request.id) };
        }
        if (operation === 'create' || operation === 'rename') {
            const { name, key } = collectionName(request.name);
            const id = operation === 'create' ? randomUUID() : requireList(db, request.id, true).id;
            if (db.prepare('SELECT id FROM reading_lists WHERE name_key = ? AND id != ?').get(key, id)) throw new Error('duplicate_name');
            if (operation === 'create') db.prepare('INSERT INTO reading_lists VALUES (?, ?, ?, ?, ?)').run(id, name, key, 'collection', new Date().toISOString());
            else db.prepare('UPDATE reading_lists SET name = ?, name_key = ? WHERE id = ?').run(name, key, id);
            return { id, name };
        }
        if (operation === 'delete') {
            requireList(db, request.id, true);
            db.prepare('DELETE FROM reading_lists WHERE id = ?').run(request.id);
            return { changes: 1 };
        }
        if (operation === 'remove') {
            requireList(db, request.id);
            validatePaths(request.paths);
            const remove = db.prepare('DELETE FROM reading_list_members WHERE list_id = ? AND path = ?');
            const changes = db.transaction(() => request.paths.reduce((count, value) => {
                const filePath = library.normalizeFilePath(path.resolve(value));
                return count + remove.run(request.id, filePath).changes;
            }, 0))();
            return { changes };
        }
        throw new Error('invalid_operation');
    });
}

export async function hydrateReadingListRows(rows, normalize) {
    const files = new Array(rows.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(16, rows.length) }, async () => {
        while (index < rows.length) {
            const current = index++;
            const row = rows[current];
            let stat;
            try { stat = await fs.stat(row.path); } catch { stat = null; }
            const isDirectory = stat ? stat.isDirectory() : Boolean(row.is_directory);
            files[current] = {
                ...normalize({ ...row, size: row.size ?? stat?.size, mtime: row.mtime ?? stat?.mtimeMs }),
                ...(isDirectory ? {
                    name: path.basename(row.path),
                    title: path.basename(row.path),
                    ext: '',
                    size: 0,
                    cover: '',
                    thumb_path: '',
                    has_metadata: false,
                } : {}),
                isDirectory,
                is_folder: isDirectory,
                exists: Boolean(stat?.isFile() || stat?.isDirectory()),
                readingListAddedAt: row.list_added_at,
            };
        }
    }));
    return files;
}

export async function loadCollectionPreview(rows, loadPreview) {
    for (const row of rows) {
        try {
            const file = await loadPreview(row.path);
            if (!file?.cover) continue;
            return {
                isDirectory: true,
                is_folder: true,
                cover: file.cover,
                thumb_path: file.thumb_path || '',
                cover_file_path: file.cover_file_path || row.path,
                cover_file_mtime: file.cover_file_mtime ?? file.mtime,
                cover_file_size: file.cover_file_size ?? file.size,
            };
        } catch {
            // Missing or unreadable members do not prevent another member from providing a cover.
        }
    }
    return { isDirectory: true, is_folder: true, cover: '', thumb_path: '', cover_file_path: '' };
}

export function registerReadingListsIpc({ ipcMain, getMainWindow, createLibrary, normalizeFile, loadPreview, broadcast }) {
    ipcMain.handle('reading:lists', async (event, request) => {
        const window = getMainWindow?.();
        if (!window || window.isDestroyed() || window.webContents !== event.sender
            || (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) throw new Error('reading_untrusted_sender');
        const library = createLibrary();
        try {
            const result = await readingListsRequest(library, request);
            if (result.rows) return { success: true, files: await hydrateReadingListRows(result.rows, normalizeFile) };
            if (result.previewRows) return { success: true, file: await loadCollectionPreview(result.previewRows, loadPreview) };
            if (!['overview', 'list'].includes(request.operation)) broadcast();
            return { success: true, ...result };
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            await library.close();
        }
    });
}
