export function createCoverPreviewQueue({ concurrency = 2, queueLimit = 96, requestLimit = 32, keyForFile, load, onResult }) {
    let scope = '';
    let generation = 0;
    let queue = [];
    let queuedKeys = new Set();
    const active = new Set();
    const attempted = new Set();

    const reset = () => {
        generation += 1;
        queue = [];
        queuedKeys.clear();
        attempted.clear();
    };

    const setScope = nextScope => {
        if (scope === nextScope) return;
        scope = nextScope;
        reset();
    };

    const pump = () => {
        while (active.size < concurrency && queue.length > 0) {
            const request = queue.shift();
            queuedKeys.delete(request.key);
            attempted.add(request.key);
            active.add(request);
            Promise.resolve()
                .then(() => request.generation === generation ? load(request.file, request.context) : undefined)
                .then(result => {
                    if (request.generation === generation) onResult(result, request.file, request.context);
                })
                .catch(() => {})
                .finally(() => {
                    active.delete(request);
                    pump();
                });
        }
    };

    const enqueue = (files = [], context) => {
        const next = [];
        const seen = new Set(queuedKeys);
        for (const file of files) {
            const key = keyForFile(file);
            if (!key || file.cover || attempted.has(key) || seen.has(key)) continue;
            seen.add(key);
            next.push({ file, key, context, generation });
            if (next.length >= requestLimit) break;
        }
        if (next.length === 0) return;
        queue = [...next, ...queue].slice(0, queueLimit);
        queuedKeys = new Set(queue.map(request => request.key));
        pump();
    };

    return { enqueue, reset, setScope };
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
