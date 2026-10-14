export async function trackRenamerPreview(pending, request) {
    const promise = Promise.resolve(request);
    pending.add(promise);
    try {
        return await promise;
    } finally {
        pending.delete(promise);
    }
}

export function waitForRenamerPreviews(pending, signal) {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
        let settled = false;
        const onAbort = () => finish(false);
        const finish = ready => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(ready);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.allSettled([...pending]).then(() => finish(true));
    });
}
