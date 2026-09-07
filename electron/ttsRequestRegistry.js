export function createTtsRequestRegistry() {
    const senders = new Map();
    const clearSender = sender => {
        const state = senders.get(sender);
        if (!state) return;
        senders.delete(sender);
        sender.removeListener?.('destroyed', state.onDestroyed);
        for (const controller of state.requests.values()) controller.abort();
        state.requests.clear();
    };
    return {
        async run(sender, requestId, operation) {
            if (sender.isDestroyed?.()) {
                throw Object.assign(new Error('TTS request cancelled.'), { name: 'AbortError', code: 'TTS_CANCELLED' });
            }
            let state = senders.get(sender);
            if (!state) {
                state = { requests: new Map(), onDestroyed: () => clearSender(sender) };
                senders.set(sender, state);
                sender.once?.('destroyed', state.onDestroyed);
            }
            const key = typeof requestId === 'string' && requestId ? requestId : Symbol('tts-request');
            state.requests.get(key)?.abort();
            const controller = new AbortController();
            state.requests.set(key, controller);
            try {
                return await operation(controller.signal);
            } finally {
                if (state.requests.get(key) === controller) state.requests.delete(key);
                if (senders.get(sender) === state && state.requests.size === 0) clearSender(sender);
            }
        },
        cancel(sender, requestId) {
            const controller = senders.get(sender)?.requests.get(requestId);
            if (!controller) return false;
            controller.abort();
            return true;
        },
        dispose() {
            for (const sender of [...senders.keys()]) clearSender(sender);
        },
    };
}
