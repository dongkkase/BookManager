export const READING_ACTIVITY_HEARTBEAT_MS = 5_000;
export const READING_ACTIVITY_FLUSH_MS = 30_000;
export const READING_ACTIVITY_IDLE_MS = 5 * 60_000;
const MAX_HEARTBEAT_GAP_MS = 12_000;

export function createReadingActivityTracker({
    record,
    now = () => Date.now(),
    monotonicNow = () => performance.now(),
    createId = () => globalThis.crypto.randomUUID(),
    initialState = {},
}) {
    let state = { ready: false, visible: false, focused: false, playing: false, visualReading: true, ...initialState };
    let previousWall = now();
    let previousMonotonic = monotonicNow();
    let lastInteraction = previousMonotonic;
    let pending = null;
    let disposed = false;

    const sendPending = () => {
        if (!pending) return;
        const interval = pending;
        pending = null;
        try {
            Promise.resolve(record({ eventId: createId(), ...interval })).catch(() => {});
        } catch {
            // Recording must not interrupt reading when the window is closing.
        }
    };

    const sample = () => {
        if (disposed) return;
        const wall = now();
        const monotonic = monotonicNow();
        const elapsed = monotonic - previousMonotonic;
        const wallElapsed = wall - previousWall;
        const continuous = elapsed >= 0 && elapsed <= MAX_HEARTBEAT_GAP_MS
            && wallElapsed >= 0 && Math.abs(wallElapsed - elapsed) <= 1_000;
        let activeElapsed = 0;
        if (continuous && state.ready) {
            if (state.playing) activeElapsed = elapsed;
            else if (state.visualReading && state.visible && state.focused) {
                activeElapsed = Math.max(0, Math.min(elapsed, lastInteraction + READING_ACTIVITY_IDLE_MS - previousMonotonic));
            }
        }
        if (activeElapsed > 0) {
            const startedAt = Math.round(previousWall);
            const endedAt = Math.round(previousWall + Math.min(activeElapsed, wallElapsed));
            if (endedAt > startedAt) {
                if (pending && (pending.endedAt !== startedAt || endedAt - pending.startedAt > READING_ACTIVITY_FLUSH_MS)) sendPending();
                if (pending) pending.endedAt = endedAt;
                else pending = { startedAt, endedAt };
                if (pending.endedAt - pending.startedAt >= READING_ACTIVITY_FLUSH_MS) sendPending();
            }
        } else sendPending();
        previousWall = wall;
        previousMonotonic = monotonic;
    };

    return {
        sample,
        update(patch) {
            sample();
            state = { ...state, ...patch };
            if (!state.ready || !state.playing && (!state.visualReading || !state.visible || !state.focused)) sendPending();
        },
        interact() {
            sample();
            lastInteraction = previousMonotonic;
        },
        flush() {
            sample();
            sendPending();
        },
        dispose() {
            if (disposed) return;
            sample();
            sendPending();
            disposed = true;
        },
    };
}
