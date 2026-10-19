export function createCoverPreviewQueue({ concurrency = 2, queueLimit = 96, requestLimit = 32, keyForFile, load, onResult, onResults, resultFlushDelay = 0 }) {
    let scope = '';
    let generation = 0;
    let queue = [];
    let visibleFiles = [];
    let visibleContext;
    let nextVisibleIndex = 0;
    let pendingResults = [];
    let resultTimer = null;
    const active = new Set();
    const attempted = new Set();

    const reset = () => {
        generation += 1;
        queue = [];
        visibleFiles = [];
        visibleContext = undefined;
        nextVisibleIndex = 0;
        pendingResults = [];
        if (resultTimer !== null) clearTimeout(resultTimer);
        resultTimer = null;
        attempted.clear();
    };

    const setScope = nextScope => {
        if (scope === nextScope) return;
        scope = nextScope;
        reset();
    };

    const flushResults = () => {
        resultTimer = null;
        const entries = pendingResults;
        pendingResults = [];
        if (entries.length > 0) {
            try {
                onResults(entries);
            } catch {
                // A rejected UI update must not stop the remaining preview requests.
            }
        }
    };

    const publishResult = (result, request) => {
        if (typeof onResults !== 'function') {
            onResult?.(result, request.file, request.context);
            return;
        }
        pendingResults.push({ result, file: request.file, context: request.context });
        if (resultFlushDelay <= 0) flushResults();
        else if (resultTimer === null) resultTimer = setTimeout(flushResults, resultFlushDelay);
    };

    const fillQueue = () => {
        const seen = new Set();
        const limit = Math.max(1, Math.min(queueLimit, requestLimit));
        while (nextVisibleIndex < visibleFiles.length && queue.length < limit) {
            const file = visibleFiles[nextVisibleIndex++];
            const key = keyForFile(file);
            if (!key || file.cover || attempted.has(key) || seen.has(key)) continue;
            seen.add(key);
            queue.push({ file, key, context: visibleContext, generation });
        }
    };

    const pump = () => {
        while (active.size < concurrency) {
            if (queue.length === 0) fillQueue();
            if (queue.length === 0) break;
            const request = queue.shift();
            attempted.add(request.key);
            active.add(request);
            Promise.resolve()
                .then(() => request.generation === generation ? load(request.file, request.context) : undefined)
                .then(result => {
                    if (request.generation === generation) publishResult(result, request);
                })
                .catch(() => {})
                .finally(() => {
                    active.delete(request);
                    pump();
                });
        }
    };

    const enqueue = (files = [], context) => {
        visibleFiles = Array.isArray(files) ? files : [];
        visibleContext = context;
        nextVisibleIndex = 0;
        queue = [];
        pump();
    };

    return { enqueue, reset, setScope, forgetKey: key => attempted.delete(key) };
}

export function createFolderPoller({ readStat, canPoll, mtimeRef, onChange }) {
    let disposed = false;
    let pending = false;
    const isCurrent = () => !disposed;

    const poll = async () => {
        if (disposed || pending || !canPoll()) return;
        pending = true;
        try {
            const stat = await readStat();
            if (disposed || !canPoll() || !stat?.isDirectory) return;
            if (mtimeRef.current === null) {
                mtimeRef.current = stat.mtime;
                return;
            }
            if (stat.mtime === mtimeRef.current) return;
            mtimeRef.current = stat.mtime;
            await onChange(isCurrent);
        } catch {
            // A temporarily unavailable folder is checked again on the next poll.
        } finally {
            pending = false;
        }
    };

    return { poll, dispose: () => { disposed = true; } };
}
