function estimateBytes(value) {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (typeof value === 'string') return value.length * 2;
    try {
        return (JSON.stringify(value)?.length || 0) * 2;
    } catch {
        return Infinity;
    }
}

export class BoundedMemoryCache {
    constructor({ maxEntries, maxBytes, sizeOf = estimateBytes, now = Date.now }) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.sizeOf = sizeOf;
        this.now = now;
        this.entries = new Map();
        this.pending = new Map();
        this.byteSize = 0;
        this.generation = 0;
    }

    get size() {
        return this.entries.size;
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt && entry.expiresAt <= this.now()) {
            this.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    set(key, value, { ttlMs = 0 } = {}) {
        this.delete(key);
        if (value === undefined) return this;
        const bytes = this.sizeOf(value) + estimateBytes(key);
        if (!Number.isFinite(bytes) || bytes > this.maxBytes || this.maxEntries < 1) return this;
        this.entries.set(key, {
            value,
            bytes,
            expiresAt: ttlMs > 0 ? this.now() + ttlMs : 0,
        });
        this.byteSize += bytes;
        while (this.entries.size > this.maxEntries || this.byteSize > this.maxBytes) {
            this.delete(this.entries.keys().next().value);
        }
        return this;
    }

    delete(key) {
        const entry = this.entries.get(key);
        if (!entry) return false;
        this.byteSize -= entry.bytes;
        return this.entries.delete(key);
    }

    keys() {
        return this.entries.keys();
    }

    clear() {
        this.entries.clear();
        this.pending.clear();
        this.byteSize = 0;
        this.generation += 1;
    }

    getOrLoad(key, loader, options) {
        const cached = this.get(key);
        if (cached !== undefined) return Promise.resolve(cached);
        const pending = this.pending.get(key);
        if (pending) return pending;
        const generation = this.generation;
        const request = Promise.resolve().then(loader).then(value => {
            if (generation === this.generation && this.pending.get(key) === request) {
                this.set(key, value, options);
            }
            return value;
        }).finally(() => {
            if (this.pending.get(key) === request) this.pending.delete(key);
        });
        this.pending.set(key, request);
        return request;
    }
}
