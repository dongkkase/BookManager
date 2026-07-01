export const IDLE_STATUS = Object.freeze({
    message: '',
    progress: 0,
    phase: 'idle',
    canRun: false,
});

const STATUS_EVENT_NAME = 'bookmanager:status-state';
const pendingStatusByTab = new Map();
let pendingStatusFrame = 0;

export function normalizeStatusState(tabId, state = {}) {
    return {
        tabId,
        ...IDLE_STATUS,
        ...state,
        progress: Math.max(0, Math.min(100, Number(state.progress) || 0)),
    };
}

function dispatchStatusState(detail) {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT_NAME, { detail }));
}

function flushPendingStatusStates() {
    pendingStatusFrame = 0;
    const pending = [...pendingStatusByTab.values()];
    pendingStatusByTab.clear();
    for (const detail of pending) dispatchStatusState(detail);
}

export function emitStatusState(tabId, state) {
    const detail = normalizeStatusState(tabId, state);
    if (typeof window === 'undefined') return;
    if (typeof window.requestAnimationFrame !== 'function') {
        dispatchStatusState(detail);
        return;
    }
    pendingStatusByTab.set(tabId, detail);
    if (pendingStatusFrame) return;
    pendingStatusFrame = window.requestAnimationFrame(flushPendingStatusStates);
}

export function isTaskActive(phase) {
    return ['analyzing', 'executing', 'cancelling'].includes(phase);
}
