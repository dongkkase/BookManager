export const DEFAULT_SCROLL_SETTINGS = Object.freeze({
    behavior: 'default',
    wheelAmount: 'system',
    keyboardPercent: 85,
    autoSeconds: 20,
});

const WHEEL_MULTIPLIERS = Object.freeze({ system: 1, slow: 0.5, fast: 1.5, faster: 2 });
const AUTO_SECONDS = [40, 30, 20, 12, 8];
const MAX_FRAME_MS = 50;
const SMOOTH_TIME_MS = 85;

export function normalizeScrollSettings(value) {
    const settings = value && typeof value === 'object' ? value : {};
    const percent = Number(settings.keyboardPercent);
    const seconds = Number(settings.autoSeconds);
    return {
        behavior: settings.behavior === 'smooth' ? 'smooth' : 'default',
        wheelAmount: Object.hasOwn(WHEEL_MULTIPLIERS, settings.wheelAmount) ? settings.wheelAmount : 'system',
        keyboardPercent: Number.isFinite(percent) && percent > 0
            ? Math.max(10, Math.min(100, Math.round(percent / 5) * 5))
            : DEFAULT_SCROLL_SETTINGS.keyboardPercent,
        autoSeconds: AUTO_SECONDS.includes(seconds) ? seconds : DEFAULT_SCROLL_SETTINGS.autoSeconds,
    };
}

export function viewerWheelDelta(event, element, lineHeight = 16) {
    const mode = Number(event.deltaMode) || 0;
    const xUnit = mode === 1 ? lineHeight : mode === 2 ? element.clientWidth : 1;
    const yUnit = mode === 1 ? lineHeight : mode === 2 ? element.clientHeight : 1;
    return {
        x: (Number(event.deltaX) || 0) * xUnit,
        y: (Number(event.deltaY) || 0) * yUnit,
    };
}

export function createViewerScrollController({
    getElement,
    getSettings = () => DEFAULT_SCROLL_SETTINGS,
    isEnabled = () => true,
    isBlocked = () => false,
    onAutoScrollChange = () => {},
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id),
    now = () => performance.now(),
}) {
    let frame = null;
    let previousTime = 0;
    let smoothTarget = null;
    let smoothPosition = 0;
    let autoScrolling = false;
    let autoPosition = 0;
    let lastWrittenPosition = null;

    const maxScroll = element => Math.max(0, element.scrollHeight - element.clientHeight);
    const clampPosition = (position, element) => Math.max(0, Math.min(maxScroll(element), position));
    const writePosition = (element, position) => {
        const top = clampPosition(position, element);
        if (typeof element.scrollTo === 'function') {
            element.scrollTo({ top, behavior: 'instant' });
        } else {
            element.scrollTop = top;
        }
        lastWrittenPosition = element.scrollTop;
    };
    const cancelFrameLoop = () => {
        if (frame !== null) cancelFrame(frame);
        frame = null;
        previousTime = 0;
    };
    const setAutoScrolling = next => {
        if (autoScrolling === next) return;
        autoScrolling = next;
        onAutoScrollChange(next);
    };
    const stopAutoScroll = () => {
        if (!autoScrolling) return;
        setAutoScrolling(false);
        cancelFrameLoop();
        lastWrittenPosition = null;
    };
    const cancelMotion = () => {
        smoothTarget = null;
        setAutoScrolling(false);
        cancelFrameLoop();
        lastWrittenPosition = null;
    };
    const tick = timestamp => {
        frame = null;
        const element = getElement();
        if (!isEnabled() || !element || element.clientHeight <= 0 || (autoScrolling && isBlocked())) {
            cancelMotion();
            return;
        }
        // A stalled frame must not advance a whole paragraph when rendering resumes.
        const elapsed = Math.max(0, Math.min(MAX_FRAME_MS, timestamp - previousTime));
        previousTime = timestamp;
        if (autoScrolling) {
            if (lastWrittenPosition !== null && Math.abs(element.scrollTop - lastWrittenPosition) > 1) {
                autoPosition = element.scrollTop;
            }
            const settings = normalizeScrollSettings(getSettings());
            autoPosition = clampPosition(autoPosition + element.clientHeight * elapsed / (settings.autoSeconds * 1000), element);
            writePosition(element, autoPosition);
            if (autoPosition >= maxScroll(element)) {
                stopAutoScroll();
                return;
            }
        } else if (smoothTarget !== null) {
            smoothTarget = clampPosition(smoothTarget, element);
            if (lastWrittenPosition !== null && Math.abs(element.scrollTop - lastWrittenPosition) > 1) {
                smoothPosition = element.scrollTop;
            }
            const remaining = smoothTarget - smoothPosition;
            const next = smoothPosition + remaining * (1 - Math.exp(-elapsed / SMOOTH_TIME_MS));
            if (Math.abs(remaining) < 0.5 || Math.abs(next - smoothTarget) < 0.5) {
                writePosition(element, smoothTarget);
                smoothTarget = null;
                lastWrittenPosition = null;
                return;
            }
            smoothPosition = next;
            writePosition(element, next);
        } else {
            return;
        }
        frame = requestFrame(tick);
    };
    const schedule = () => {
        if (frame !== null) return;
        previousTime = now();
        frame = requestFrame(tick);
    };
    const moveBy = delta => {
        const element = getElement();
        if (!isEnabled() || !element || !Number.isFinite(delta) || delta === 0) return false;
        stopAutoScroll();
        const settings = normalizeScrollSettings(getSettings());
        if (settings.behavior === 'smooth') {
            // Accumulate against the destination so repeated input never discards pending distance.
            if (smoothTarget === null) smoothPosition = element.scrollTop;
            smoothTarget = clampPosition((smoothTarget ?? element.scrollTop) + delta, element);
            schedule();
        } else {
            cancelMotion();
            writePosition(element, element.scrollTop + delta);
        }
        return true;
    };
    const handleScrollWheel = event => {
        const element = getElement();
        if (!isEnabled() || !element) return false;
        stopAutoScroll();
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || (Number(event.buttons) & 3)) {
            cancelMotion();
            return false;
        }
        const delta = viewerWheelDelta(event, element);
        if (!delta.y || event.shiftKey || Math.abs(delta.x) > Math.abs(delta.y)) {
            cancelMotion();
            return false;
        }
        const settings = normalizeScrollSettings(getSettings());
        if (settings.behavior === 'default' && settings.wheelAmount === 'system') {
            cancelMotion();
            return false;
        }
        if (event.cancelable === false) {
            cancelMotion();
            return false;
        }
        event.preventDefault();
        if (delta.x) element.scrollLeft += delta.x;
        return moveBy(delta.y * WHEEL_MULTIPLIERS[settings.wheelAmount]);
    };
    const scrollByKeyboard = direction => {
        stopAutoScroll();
        const element = getElement();
        if (!element || !Number.isFinite(direction) || direction === 0) return false;
        const settings = normalizeScrollSettings(getSettings());
        return moveBy(Math.sign(direction) * element.clientHeight * settings.keyboardPercent / 100);
    };
    const startAutoScroll = () => {
        cancelMotion();
        const element = getElement();
        if (!isEnabled() || isBlocked() || !element || element.clientHeight <= 0 || element.scrollTop >= maxScroll(element)) return false;
        autoPosition = element.scrollTop;
        lastWrittenPosition = element.scrollTop;
        setAutoScrolling(true);
        schedule();
        return true;
    };
    const toggleAutoScroll = () => {
        if (autoScrolling) {
            stopAutoScroll();
            return false;
        }
        return startAutoScroll();
    };

    return {
        startAutoScroll,
        stopAutoScroll,
        toggleAutoScroll,
        scrollByKeyboard,
        handleScrollWheel,
        cancelMotion,
        getAutoScrolling: () => autoScrolling,
    };
}
