export function createFolderTreeLoader({ readChildren, onChange, maxConcurrent = 4 }) {
    const concurrency = Number.isFinite(maxConcurrent) && maxConcurrent >= 1
        ? Math.floor(maxConcurrent)
        : 4;
    const entries = new Map();
    const requests = new Map();
    const queue = [];
    let activeCount = 0;
    let disposed = false;

    const isCurrent = request => !disposed && requests.get(request.path) === request;

    const run = async request => {
        let entry;
        try {
            const children = await readChildren(request.path);
            entry = { status: 'ready', children: Array.isArray(children) ? children : [] };
        } catch (error) {
            entry = {
                status: 'error',
                children: [],
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }

        try {
            if (isCurrent(request)) {
                requests.delete(request.path);
                entries.set(request.path, entry);
                request.resolve(entry.children);
                onChange?.(request.path, entry);
            }
        } finally {
            activeCount -= 1;
            drain();
        }
    };

    const drain = () => {
        while (!disposed && activeCount < concurrency && queue.length > 0) {
            const request = queue.shift();
            if (!isCurrent(request)) continue;
            activeCount += 1;
            void run(request);
        }
    };

    const load = (path, { priority = false } = {}) => {
        if (disposed) return Promise.resolve([]);
        const entry = entries.get(path);
        if (entry?.status === 'ready') return Promise.resolve(entry.children);
        const pending = requests.get(path);
        if (pending) {
            if (priority) {
                const index = queue.indexOf(pending);
                if (index > 0) {
                    queue.splice(index, 1);
                    queue.unshift(pending);
                }
            }
            return pending.promise;
        }

        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const request = { path, promise, resolve };
        const loading = { status: 'loading', children: [] };
        requests.set(path, request);
        entries.set(path, loading);
        if (priority) queue.unshift(request);
        else queue.push(request);
        onChange?.(path, loading);
        drain();
        return promise;
    };

    const reset = () => {
        queue.length = 0;
        entries.clear();
        for (const request of requests.values()) request.resolve([]);
        requests.clear();
    };

    const dispose = () => {
        disposed = true;
        reset();
    };

    return { load, get: path => entries.get(path), reset, dispose };
}
