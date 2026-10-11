import { createViewerScrollController, viewerWheelDelta } from './viewerScroll.js';

export function attachCoverEditorSearchScroll(element) {
    const view = element?.ownerDocument?.defaultView;
    if (!view?.requestAnimationFrame || !view.cancelAnimationFrame) return () => {};
    const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let writingPosition = false;
    let expectedTop = element.scrollTop;
    const controller = createViewerScrollController({
        getElement: () => element,
        getSettings: () => ({ behavior: 'smooth' }),
        isEnabled: () => !disposed && !reducedMotion?.matches && element.isConnected !== false,
        now: () => view.performance.now(),
        cancelFrame: id => view.cancelAnimationFrame(id),
        requestFrame: callback => view.requestAnimationFrame(timestamp => {
            if (disposed) return;
            if (Math.abs(element.scrollTop - expectedTop) > 1) {
                cancelMotion();
                return;
            }
            writingPosition = true;
            try {
                callback(timestamp);
            } finally {
                writingPosition = false;
                expectedTop = element.scrollTop;
            }
        }),
    });
    const cancelMotion = () => {
        controller.cancelMotion();
        expectedTop = element.scrollTop;
    };
    const onWheel = event => {
        if (Math.abs(element.scrollTop - expectedTop) > 1) cancelMotion();
        const delta = viewerWheelDelta(event, element);
        const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
        const atEdge = delta.y < 0 ? element.scrollTop <= 0 : element.scrollTop >= maxTop;
        // Fine pixel deltas already carry the platform's trackpad motion and inertia.
        const finePixels = !event.deltaMode && Math.abs(delta.y) < 40;
        if (reducedMotion?.matches || event.altKey || !Number.isFinite(delta.y) || finePixels || atEdge) {
            cancelMotion();
            return;
        }
        controller.handleScrollWheel(event);
    };
    const onScroll = () => {
        if (!writingPosition && Math.abs(element.scrollTop - expectedTop) > 1) cancelMotion();
    };
    const listeners = [
        ['wheel', onWheel, { passive: false }],
        ['scroll', onScroll, { passive: true }],
        ['pointerdown', cancelMotion, { passive: true, capture: true }],
        ['touchstart', cancelMotion, { passive: true, capture: true }],
        ['keydown', cancelMotion, true],
    ];
    for (const [name, listener, options] of listeners) element.addEventListener(name, listener, options);
    reducedMotion?.addEventListener('change', cancelMotion);
    return () => {
        if (disposed) return;
        disposed = true;
        cancelMotion();
        for (const [name, listener, options] of listeners) element.removeEventListener(name, listener, options);
        reducedMotion?.removeEventListener('change', cancelMotion);
    };
}
