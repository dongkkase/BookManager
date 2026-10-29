import { createHash } from 'node:crypto';
import { API_CACHE_TTL_MS, getCachedApiResults, openApiCache, setCachedApiResults } from './database/apiCache.js';

export const AUTHOR_SEARCH_CACHE_TTL_MS = API_CACHE_TTL_MS;
const MAX_ENTRY_BYTES = 1024 * 1024;
const CACHE_PREFIX = 'author-search:';

function cacheIdentity(namespace, key) {
    if (typeof namespace !== 'string' || !/^[a-z][a-z0-9:-]{0,63}$/.test(namespace)
        || typeof key !== 'string' || !key || key.length > 4096) return null;
    return { api: `${CACHE_PREFIX}${namespace}`, query: createHash('sha256').update(key).digest('hex') };
}

export function createAuthorSearchCache({ getDbPath, now = Date.now } = {}) {
    const access = async (operation, fallback) => {
        let db;
        try {
            if (typeof getDbPath !== 'function') return fallback;
            db = openApiCache(await getDbPath());
            return operation(db);
        } catch {
            return fallback;
        } finally {
            try { db?.close(); } catch { /* Cache failures must not prevent searching. */ }
        }
    };
    return {
        async get(namespace, key) {
            const identity = cacheIdentity(namespace, key);
            if (!identity) return null;
            return access(db => {
                const timestamp = now();
                const rows = getCachedApiResults(db, identity.api, identity.query, timestamp);
                if (rows === null) return null;
                const entry = rows[0];
                if (rows.length !== 1 || entry?.version !== 1 || !Number.isFinite(entry.createdAt)
                    || entry.createdAt > timestamp || entry.expiresAt !== entry.createdAt + AUTHOR_SEARCH_CACHE_TTL_MS
                    || entry.expiresAt <= timestamp || entry.value === undefined
                    || Buffer.byteLength(JSON.stringify(rows)) > MAX_ENTRY_BYTES) {
                    db.prepare('DELETE FROM search_cache WHERE api = ? AND query = ?').run(identity.api, identity.query);
                    return null;
                }
                return { value: entry.value, expiresAt: entry.expiresAt };
            }, null);
        },
        async set(namespace, key, value) {
            const identity = cacheIdentity(namespace, key);
            if (!identity || value === undefined) return;
            await access(db => {
                const timestamp = now();
                const rows = [{ version: 1, createdAt: timestamp, expiresAt: timestamp + AUTHOR_SEARCH_CACHE_TTL_MS, value }];
                if (Buffer.byteLength(JSON.stringify(rows)) > MAX_ENTRY_BYTES) return;
                const oldest = new Date(timestamp - AUTHOR_SEARCH_CACHE_TTL_MS).toISOString();
                db.prepare('DELETE FROM search_cache WHERE api LIKE ? AND updated_at <= ?').run(`${CACHE_PREFIX}%`, oldest);
                setCachedApiResults(db, identity.api, identity.query, rows, new Date(timestamp));
            });
        },
    };
}
