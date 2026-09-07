import { useEffect, useRef } from 'react';

export function restoreFolderNavigationViewport({
    container,
    request,
    revealBounds,
    onScrollPositionChange,
    onComplete,
    scheduleFrame = callback => window.requestAnimationFrame(callback),
    cancelFrame = frame => window.cancelAnimationFrame(frame),
}) {
    let cancelled = false;
    let frame = 0;
    const previousScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';

    const applyPosition = () => {
        container.scrollTop = Math.max(0, Number(request.scrollTop) || 0);
        container.scrollLeft = Math.max(0, Number(request.scrollLeft) || 0);
        if (request.revealPath) {
            const element = Array.from(container.querySelectorAll('[data-file-path]'))
                .find(item => item.dataset.filePath === request.revealPath);
            const headerHeight = container.querySelector('thead')?.offsetHeight || 0;
            let bounds = revealBounds ? {
                top: revealBounds.top + headerHeight,
                height: revealBounds.height,
            } : null;
            if (element) {
                const elementRect = element.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                bounds = {
                    top: elementRect.top - containerRect.top - container.clientTop + container.scrollTop,
                    height: elementRect.height,
                };
            }
            if (bounds) {
                if (bounds.top < container.scrollTop + headerHeight) {
                    container.scrollTop = Math.max(0, bounds.top - headerHeight);
                } else if (bounds.top + bounds.height > container.scrollTop + container.clientHeight) {
                    container.scrollTop = Math.max(0, bounds.top + bounds.height - container.clientHeight);
                }
            }
        }
        onScrollPositionChange?.({ scrollTop: container.scrollTop, scrollLeft: container.scrollLeft });
    };

    applyPosition();
    frame = scheduleFrame(() => {
        if (cancelled) return;
        applyPosition();
        frame = scheduleFrame(() => {
            if (cancelled) return;
            applyPosition();
            container.style.scrollBehavior = previousScrollBehavior;
            onComplete?.(request.id);
        });
    });

    return () => {
        cancelled = true;
        cancelFrame(frame);
        container.style.scrollBehavior = previousScrollBehavior;
    };
}

export function useFolderNavigationRestore({
    containerRef,
    navigationRestore,
    onNavigationRestore,
    viewportReady,
    revealBounds,
    onScrollPositionChange,
}) {
    const completedRequestRef = useRef(null);
    const callbacksRef = useRef({ onNavigationRestore, onScrollPositionChange });
    callbacksRef.current = { onNavigationRestore, onScrollPositionChange };
    const requestId = navigationRestore?.id;
    const scrollTop = navigationRestore?.scrollTop;
    const scrollLeft = navigationRestore?.scrollLeft;
    const revealPath = navigationRestore?.revealPath;
    const revealTop = revealBounds?.top;
    const revealHeight = revealBounds?.height;

    useEffect(() => {
        if (requestId === undefined || !viewportReady || completedRequestRef.current === requestId) return undefined;
        const container = containerRef?.current;
        if (!container || container.clientWidth <= 0 || container.clientHeight <= 0) return undefined;
        return restoreFolderNavigationViewport({
            container,
            request: { id: requestId, scrollTop, scrollLeft, revealPath },
            revealBounds: revealTop === undefined ? null : { top: revealTop, height: revealHeight },
            onScrollPositionChange: position => callbacksRef.current.onScrollPositionChange?.(position),
            onComplete: id => {
                completedRequestRef.current = id;
                callbacksRef.current.onNavigationRestore?.(id);
            },
        });
    }, [containerRef, requestId, scrollTop, scrollLeft, revealPath, viewportReady, revealTop, revealHeight]);
}
