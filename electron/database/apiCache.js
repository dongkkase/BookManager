import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const API_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function openApiCache(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS search_cache (
            api TEXT,
            query TEXT,
            results TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (api, query)
        );
        CREATE TABLE IF NOT EXISTS img_cache (
            url TEXT PRIMARY KEY,
            data BLOB
        );
        CREATE TABLE IF NOT EXISTS trans_cache (
            original TEXT PRIMARY KEY,
            translated TEXT
        );
        CREATE TABLE IF NOT EXISTS ridi_date_cache (
            b_id TEXT PRIMARY KEY,
            pub_date TEXT
        );
    `);
    return db;
}

export function getCachedApiResults(db, apiName, cacheQuery, now = Date.now()) {
    const row = db.prepare(`
        SELECT results, updated_at FROM search_cache
        WHERE api = ? AND query = ?
    `).get(apiName, cacheQuery);
    if (!row) return null;
    const updatedAt = new Date(row.updated_at).getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt > API_CACHE_TTL_MS) {
        db.prepare('DELETE FROM search_cache WHERE api = ? AND query = ?').run(apiName, cacheQuery);
        return null;
    }
    try {
        const results = JSON.parse(row.results);
        return Array.isArray(results) ? results : null;
    } catch {
        return null;
    }
}

export function setCachedApiResults(db, apiName, cacheQuery, results, updatedAt = new Date()) {
    db.prepare(`
        INSERT INTO search_cache (api, query, results, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(api, query) DO UPDATE SET
            results = excluded.results,
            updated_at = excluded.updated_at
    `).run(apiName, cacheQuery, JSON.stringify(results || []), updatedAt.toISOString());
}

export function clearApiCache(dbPath, imageDirectories = []) {
    let deletedRows = 0;
    if (fs.existsSync(dbPath)) {
        const db = openApiCache(dbPath);
        try {
            const clear = db.transaction(() => {
                for (const table of ['search_cache', 'img_cache', 'trans_cache', 'ridi_date_cache']) {
                    deletedRows += db.prepare(`DELETE FROM ${table}`).run().changes;
                }
            });
            clear();
            db.exec('VACUUM');
        } finally {
            db.close();
        }
    }

    let deletedFiles = 0;
    for (const directory of imageDirectories) {
        if (!fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            fs.rmSync(path.join(directory, entry.name), { force: true });
            deletedFiles += 1;
        }
    }
    return { deletedRows, deletedFiles };
}
