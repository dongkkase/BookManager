export function missingVolumesLibraryScope(folders = []) {
    const paths = new Map();
    for (const folder of folders) {
        const original = String(folder || '');
        if (!original.trim()) continue;
        const normalized = original.replace(/\\/g, '/').normalize('NFC');
        const key = /^[a-z]:\/+$/i.test(normalized)
            ? `${normalized.slice(0, 2)}/`
            : normalized.replace(/\/+$/, '') || '/';
        if (!paths.has(key)) paths.set(key, original);
    }
    const keys = [...paths.keys()].sort();
    return { key: JSON.stringify(keys), folders: keys.map(key => paths.get(key)) };
}

export function missingVolumesLibraryKey(folders = []) {
    return missingVolumesLibraryScope(folders).key;
}

export function createMissingVolumesCheck({ onBusy, onResult, onError, stop }) {
    let active = null;
    let cached = null;
    let revision = 0;
    let disposed = false;
    let stopping = Promise.resolve();

    const cancel = () => {
        const request = active;
        if (!request) return stopping;
        request.cancelled = true;
        active = null;
        if (!disposed) onBusy(false);
        if (request.started) stopping = Promise.resolve().then(stop).catch(() => {});
        return stopping;
    };

    const run = (key, execute) => {
        if (disposed) return Promise.resolve(null);
        if (active?.key === key && active.revision === revision) return active.promise;
        if (active) cancel();
        if (cached?.key === key) return Promise.resolve(cached.result);
        const request = { key, revision, cancelled: false, started: false };
        active = request;
        onBusy(true);
        request.promise = (async () => {
            try {
                await stopping;
                if (request.cancelled || disposed) return null;
                request.started = true;
                const result = await execute();
                if (active !== request || disposed || request.cancelled || result?.cancelled) return null;
                if (request.revision !== revision) return null;
                if (!Array.isArray(result?.missing)) throw new Error('Missing-volume analysis returned no result.');
                cached = { key, result };
                onResult(result);
                return result;
            } catch (error) {
                if (active === request && !disposed && !request.cancelled) onError(error);
                return null;
            } finally {
                if (active === request) {
                    active = null;
                    if (!disposed) onBusy(false);
                }
            }
        })();
        return request.promise;
    };

    return {
        run,
        cancel,
        invalidate() {
            revision += 1;
            cached = null;
        },
        hasResult(key) {
            return cached?.key === key;
        },
        dispose() {
            disposed = true;
            cancel();
        },
    };
}
