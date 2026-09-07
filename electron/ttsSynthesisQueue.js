export function throwIfTtsCancelled(signal) {
    if (signal?.aborted) {
        throw Object.assign(new Error('TTS request cancelled.'), { name: 'AbortError', code: 'TTS_CANCELLED' });
    }
}

export function createTtsSynthesisQueue(synthesize) {
    let queue = Promise.resolve();
    return (options, runtime = {}) => {
        const signal = runtime.signal;
        let abortListener;
        const cancelled = new Promise((resolve, reject) => {
            abortListener = () => reject(Object.assign(new Error('TTS request cancelled.'), { name: 'AbortError', code: 'TTS_CANCELLED' }));
            signal?.addEventListener('abort', abortListener, { once: true });
            if (signal?.aborted) abortListener();
        });
        const task = queue.catch(() => {}).then(() => {
            throwIfTtsCancelled(signal);
            return synthesize(options, runtime);
        });
        queue = task.catch(() => {});
        return Promise.race([task, cancelled]).finally(() => signal?.removeEventListener('abort', abortListener));
    };
}
