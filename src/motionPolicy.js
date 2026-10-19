export const MOTION_CHANGE_EVENT = 'bookmanager:motion-change';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function normalizeMotionPreference(value) {
    return ['system', 'full', 'reduced'].includes(value) ? value : 'system';
}

export function resolveReducedMotion(preference, systemReduced = false) {
    const normalized = normalizeMotionPreference(preference);
    return normalized === 'reduced' || normalized === 'system' && Boolean(systemReduced);
}

function readPreference(view) {
    return normalizeMotionPreference(view?.document?.documentElement?.getAttribute('data-motion-preference'));
}

export function isMotionReduced(view = globalThis.window) {
    return resolveReducedMotion(readPreference(view), view?.matchMedia?.(MOTION_QUERY)?.matches);
}

export function applyMotionPreference(preference, view = globalThis.window) {
    const normalized = normalizeMotionPreference(preference);
    const reduced = resolveReducedMotion(normalized, view?.matchMedia?.(MOTION_QUERY)?.matches);
    const root = view?.document?.documentElement;
    if (!root) return reduced;
    const effective = reduced ? 'reduced' : 'full';
    const changed = root.getAttribute('data-motion-preference') !== normalized
        || root.getAttribute('data-motion') !== effective;
    root.setAttribute('data-motion-preference', normalized);
    root.setAttribute('data-motion', effective);
    if (changed) view.dispatchEvent(new view.Event(MOTION_CHANGE_EVENT));
    return reduced;
}

export function subscribeMotionPreference(callback, view = globalThis.window) {
    if (!view?.addEventListener) return () => {};
    const media = view.matchMedia?.(MOTION_QUERY);
    const updateSystemPreference = () => applyMotionPreference(readPreference(view), view);
    view.addEventListener(MOTION_CHANGE_EVENT, callback);
    media?.addEventListener?.('change', updateSystemPreference);
    return () => {
        view.removeEventListener(MOTION_CHANGE_EVENT, callback);
        media?.removeEventListener?.('change', updateSystemPreference);
    };
}

export function initializeMotionPreference(view = globalThis.window) {
    applyMotionPreference(readPreference(view), view);
    return subscribeMotionPreference(() => {}, view);
}
