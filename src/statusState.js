export const IDLE_STATUS = Object.freeze({
    message: '',
    progress: 0,
    phase: 'idle',
    canRun: false,
});

export function emitStatusState(tabId, state) {
    window.dispatchEvent(new CustomEvent('bookmanager:status-state', {
        detail: {
            tabId,
            ...IDLE_STATUS,
            ...state,
            progress: Math.max(0, Math.min(100, Number(state.progress) || 0)),
        },
    }));
}

export function isTaskActive(phase) {
    return ['analyzing', 'executing', 'cancelling'].includes(phase);
}
