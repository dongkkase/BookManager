export function isPlainPrimaryClick(event) {
    return event?.button === 0
        && !event.shiftKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey;
}

export function selectionEventSnapshot(event) {
    return {
        button: event?.button ?? 0,
        detail: event?.detail ?? 0,
        shiftKey: Boolean(event?.shiftKey),
        ctrlKey: Boolean(event?.ctrlKey),
        metaKey: Boolean(event?.metaKey),
        altKey: Boolean(event?.altKey),
    };
}

export function scheduleAfterNextPaint(callback) {
    if (typeof window === 'undefined') {
        callback?.();
        return () => {};
    }

    let cancelled = false;
    let frameId = 0;
    let timerId = 0;
    const run = () => {
        if (cancelled) return;
        timerId = window.setTimeout(() => {
            if (!cancelled) callback?.();
        }, 0);
    };

    if (typeof window.requestAnimationFrame === 'function') {
        frameId = window.requestAnimationFrame(run);
    } else {
        timerId = window.setTimeout(run, 0);
    }

    return () => {
        cancelled = true;
        if (frameId && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(frameId);
        }
        if (timerId) window.clearTimeout(timerId);
    };
}

export function applyImmediateSingleSelection(container, target, itemSelector) {
    const selectedItem = target?.closest?.(itemSelector);
    if (!container || !selectedItem) return;
    for (const element of container.querySelectorAll(itemSelector)) {
        if (element === selectedItem) continue;
        element.classList.remove('selected');
        element.classList.remove('active-selection');
    }
    selectedItem.classList.add('selected');
    selectedItem.classList.add('active-selection');
}
