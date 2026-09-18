export function runTextCleanerSearchJob(request, { signal, timeoutMs = 5000, createWorker } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(Object.assign(new Error('Search cancelled'), { code: 'cancelled' }));
            return;
        }
        const worker = createWorker ? createWorker()
            : new Worker(new URL('./workers/textCleanerSearchWorker.js', import.meta.url), { type: 'module' });
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error);
            else resolve(result);
        };
        const fail = code => finish(Object.assign(new Error(code), { code }));
        const abort = () => fail('cancelled');
        const timeout = setTimeout(() => fail('search_timeout'), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => data.ok ? finish(null, data.result) : fail(data.code);
        worker.onerror = () => fail('search_failed');
        try {
            worker.postMessage(request);
        } catch {
            fail('search_failed');
        }
    });
}
