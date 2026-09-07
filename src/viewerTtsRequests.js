let requestSequence = 0;

function cancelledError() {
    return Object.assign(new Error('TTS request cancelled.'), { name: 'AbortError', code: 'TTS_CANCELLED' });
}

export function createViewerTtsRequests(cancelRequest) {
    const activeRequests = new Set();
    let cancelled = false;
    return {
        async run(createSpeech, payload) {
            if (cancelled) throw cancelledError();
            const requestId = `viewer-tts-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
            activeRequests.add(requestId);
            try {
                const result = await createSpeech({ ...payload, requestId });
                if (cancelled || result?.code === 'TTS_CANCELLED') throw cancelledError();
                return result;
            } finally {
                activeRequests.delete(requestId);
            }
        },
        cancel() {
            if (cancelled) return;
            cancelled = true;
            for (const requestId of activeRequests) {
                try {
                    Promise.resolve(cancelRequest?.(requestId)).catch(() => {});
                } catch {
                    // A closed viewer may no longer have an IPC bridge.
                }
            }
            activeRequests.clear();
        },
    };
}
