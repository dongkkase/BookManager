export function createWebResponseCache(options = {}) {
    const maxEntries = options.maxEntries ?? 64;
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    const now = options.now || Date.now;
    const entries = new Map();
    let bytes = 0;
    const remove = key => {
        const entry = entries.get(key);
        if (!entry) return;
        bytes -= entry.bytes;
        entries.delete(key);
    };
    const find = key => {
        const entry = entries.get(key);
        if (entry && entry.expiresAt <= now()) {
            remove(key);
            return undefined;
        }
        return entry;
    };
    return {
        has(key) {
            return Boolean(find(key));
        },
        get(key) {
            const entry = find(key);
            if (!entry) return undefined;
            entries.delete(key);
            entries.set(key, entry);
            return JSON.parse(entry.json);
        },
        set(key, value) {
            remove(key);
            const json = JSON.stringify(value);
            if (json === undefined) return false;
            // Account for UTF-16 string storage; object overhead is bounded by maxEntries.
            const entryBytes = 2 * (String(key).length + json.length);
            if (entryBytes > maxBytes || maxEntries < 1) return false;
            const timestamp = now();
            for (const [cachedKey, entry] of entries) {
                if (entry.expiresAt <= timestamp) remove(cachedKey);
            }
            while (entries.size >= maxEntries || bytes + entryBytes > maxBytes) {
                remove(entries.keys().next().value);
            }
            entries.set(key, { json, bytes: entryBytes, expiresAt: timestamp + ttlMs });
            bytes += entryBytes;
            return true;
        },
        clear() {
            entries.clear();
            bytes = 0;
        },
        get size() {
            return entries.size;
        },
        get byteSize() {
            return bytes;
        },
    };
}
