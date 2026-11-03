export const MAX_CONCURRENT_COMIC_READS = 2;
export const MAX_CACHED_COMIC_PAGE_BYTES = 64 * 1024 * 1024;
export const MAX_CACHED_COMIC_PAGES = 12;

export function comicRequestAbortedError() {
    const error = new Error('Operation cancelled.');
    error.name = 'AbortError';
    return error;
}

export class ViewerComicQueue {
    constructor(concurrency = MAX_CONCURRENT_COMIC_READS) {
        this.concurrency = Math.max(1, Math.floor(concurrency));
        this.active = 0;
        this.activeResources = new Set();
        this.pending = [];
        this.requests = new Map();
    }

    run(key, group, work, options = {}) {
        if (options.signal?.aborted) return Promise.reject(comicRequestAbortedError());
        const priority = options.priority === 1 ? 1 : 0;
        let request = this.requests.get(key);
        if (!request) {
            request = { key, group, work, priority, resource: options.resource || group, controller: new AbortController(), subscribers: new Set() };
            this.requests.set(key, request);
            this.pending.push(request);
        } else request.priority = Math.min(request.priority, priority);
        const result = new Promise((resolve, reject) => {
            const subscriber = { resolve, reject, signal: options.signal, onAbort: null };
            subscriber.onAbort = () => {
                this.removeSubscriber(request, subscriber);
                reject(comicRequestAbortedError());
                if (request.subscribers.size === 0) this.cancel(request);
            };
            request.subscribers.add(subscriber);
            options.signal?.addEventListener('abort', subscriber.onAbort, { once: true });
        });
        this.drain();
        return result;
    }

    removeSubscriber(request, subscriber) {
        subscriber.signal?.removeEventListener('abort', subscriber.onAbort);
        request.subscribers.delete(subscriber);
    }

    cancel(request) {
        if (this.requests.get(request.key) === request) this.requests.delete(request.key);
        this.pending = this.pending.filter(item => item !== request);
        for (const subscriber of request.subscribers) {
            this.removeSubscriber(request, subscriber);
            subscriber.reject(comicRequestAbortedError());
        }
        request.controller.abort();
    }

    cancelGroup(group) {
        for (const request of this.requests.values()) {
            if (request.group === group) this.cancel(request);
        }
    }

    drain() {
        while (this.active < this.concurrency && this.pending.length > 0) {
            let index = -1;
            for (let candidate = 0; candidate < this.pending.length; candidate += 1) {
                const request = this.pending[candidate];
                if (this.activeResources.has(request.resource)) continue;
                if (index < 0 || request.priority < this.pending[index].priority) index = candidate;
            }
            if (index < 0) return;
            const [request] = this.pending.splice(index, 1);
            if (request.controller.signal.aborted) continue;
            this.active += 1;
            this.activeResources.add(request.resource);
            Promise.resolve().then(() => {
                if (request.controller.signal.aborted) throw comicRequestAbortedError();
                return request.work(request.controller.signal);
            }).then(
                value => this.finish(request, null, value),
                error => this.finish(request, error),
            );
        }
    }

    finish(request, error, value) {
        if (this.requests.get(request.key) === request) this.requests.delete(request.key);
        for (const subscriber of request.subscribers) {
            this.removeSubscriber(request, subscriber);
            if (error) subscriber.reject(error);
            else subscriber.resolve(value);
        }
        // An aborted child keeps its slot until its close event settles the work.
        this.active -= 1;
        this.activeResources.delete(request.resource);
        this.drain();
    }
}

export const viewerComicQueue = new ViewerComicQueue();

export class ViewerComicPageCache {
    constructor(maxBytes = MAX_CACHED_COMIC_PAGE_BYTES, maxEntries = MAX_CACHED_COMIC_PAGES) {
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
        this.bytes = 0;
        this.entries = new Map();
    }

    delete(key) {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.bytes -= entry.page.buffer.length;
        this.entries.delete(key);
    }

    get(key, signature) {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (!signature || entry.signature !== signature) {
            this.delete(key);
            return null;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.page;
    }

    set(key, group, signature, page) {
        this.delete(key);
        const bytes = page.buffer.length;
        if (!signature || bytes > this.maxBytes || this.maxEntries < 1) return;
        for (const oldest of this.entries.keys()) {
            if (this.bytes + bytes <= this.maxBytes && this.entries.size < this.maxEntries) break;
            this.delete(oldest);
        }
        this.entries.set(key, { group, signature, page });
        this.bytes += bytes;
    }

    clearGroup(group) {
        for (const [key, entry] of this.entries) {
            if (entry.group === group) this.delete(key);
        }
    }
}

export const viewerComicPageCache = new ViewerComicPageCache();
