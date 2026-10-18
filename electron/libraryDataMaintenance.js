import { Worker } from 'node:worker_threads';

export function createLibraryDataMaintenance({ getLibraryPaths, dbPath, thumbnailDir, contentIndexDbPath, pruneLinkedData = async () => null, onChanged = () => {}, onError = console.warn, workerUrl = new URL('./libraryDataMaintenanceWorker.js', import.meta.url) }) {
    let pending = null;
    let repeat = false;
    let stopped = false;
    let worker = null;
    let request = null;
    let disposePromise = null;
    const send = (type, libraries) => new Promise((resolve, reject) => {
        if (!worker) {
            const current = new Worker(workerUrl, { workerData: { dbPath, thumbnailDir, contentIndexDbPath } });
            worker = current;
            const fail = error => {
                if (worker !== current) return;
                worker = null;
                const failed = request;
                request = null;
                failed?.reject(error);
            };
            current.on('message', message => {
                if (worker !== current || !request) return;
                const completed = request;
                request = null;
                current.unref();
                if (message.error) completed.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
                else completed.resolve(message);
            });
            current.on('error', fail);
            current.on('exit', code => fail(new Error(`Library maintenance worker exited (${code}).`)));
        }
        request = { resolve, reject };
        worker.ref();
        try { worker.postMessage({ type, libraries }); }
        catch (error) {
            request = null;
            worker.unref();
            reject(error);
        }
    });
    const prune = async () => {
        const libraries = getLibraryPaths();
        if (!Array.isArray(libraries)) return;
        let result;
        let changed = false;
        try {
            const completed = await send('prune', [...libraries]);
            result = completed.result;
            changed = completed.changed;
            for (const error of completed.errors || []) onError(Object.assign(new Error(error.message || error.code), error));
            const linkedData = await pruneLinkedData(libraries);
            changed ||= linkedData?.changes > 0;
        } finally {
            if (changed) onChanged(result);
        }
    };
    const run = ({ repeatIfRunning = true } = {}) => {
        if (stopped) return Promise.resolve();
        if (pending) {
            repeat ||= repeatIfRunning;
            return pending;
        }
        pending = (async () => {
            do {
                repeat = false;
                try { await prune(); } catch (error) { onError(error); }
            } while (repeat && !stopped);
        })().finally(() => { pending = null; });
        return pending;
    };
    const timer = setInterval(() => { void run({ repeatIfRunning: false }); }, 60000);
    timer.unref?.();
    return {
        run,
        async withIdle(operation) {
            while (pending) await pending;
            return operation();
        },
        dispose() {
            if (disposePromise) return disposePromise;
            clearInterval(timer);
            disposePromise = (async () => {
                await run();
                stopped = true;
                await pending;
                if (worker) {
                    try { await send('close'); }
                    catch (error) { onError(error); }
                    worker = null;
                }
            })();
            return disposePromise;
        },
    };
}
