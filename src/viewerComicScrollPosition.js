export function normalizeComicScrollPosition(position, fallbackPageIndex = 0) {
    const pageIndex = Number(position?.pageIndex ?? fallbackPageIndex);
    const offsetRatio = Number(position?.offsetRatio);
    return {
        pageIndex: Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0,
        offsetRatio: Number.isFinite(offsetRatio) ? Math.max(0, Math.min(1, offsetRatio)) : 0,
    };
}

export function captureComicScrollPosition(root, fallbackPageIndex = 0) {
    const fallback = normalizeComicScrollPosition(null, fallbackPageIndex);
    if (!root) return fallback;
    const viewportTop = root.getBoundingClientRect().top + (root.clientTop || 0);
    let page = root.querySelector(`[data-page-index="${fallback.pageIndex}"]`);
    let bounds = page?.getBoundingClientRect();
    if (!bounds || bounds.top > viewportTop + 1 || bounds.bottom <= viewportTop + 1) {
        page = [...root.querySelectorAll('[data-page-index]')].find(candidate => {
            const rect = candidate.getBoundingClientRect();
            return rect.bottom > viewportTop + 1;
        });
        bounds = page?.getBoundingClientRect();
    }
    if (!page || !bounds || bounds.height <= 0) return fallback;
    return normalizeComicScrollPosition({
        pageIndex: Number(page.dataset.pageIndex),
        offsetRatio: (viewportTop - bounds.top) / bounds.height,
    }, fallback.pageIndex);
}

export function restoreComicScrollPosition(root, position, { isCurrent = () => true, onFinish = () => {} } = {}) {
    const viewport = root?.ownerDocument?.defaultView;
    const inputRoot = root?.ownerDocument;
    const target = normalizeComicScrollPosition(position);
    let finished = false;
    let frameId = null;
    let pendingTimerId = null;
    let previousGeometry = '';
    let stableSince = 0;
    let previouslyReady = false;
    const inputEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
    const finish = reason => {
        if (finished) return;
        finished = true;
        if (frameId !== null) viewport?.cancelAnimationFrame(frameId);
        if (pendingTimerId !== null) viewport?.clearTimeout(pendingTimerId);
        inputEvents.forEach(type => inputRoot?.removeEventListener(type, cancelForInput, true));
        onFinish({ reason });
    };
    const cancelForInput = () => finish('cancelled');
    const cleanup = () => finish('cancelled');
    if (!viewport || !root.querySelector) {
        finish('cancelled');
        return cleanup;
    }
    const tick = now => {
        frameId = null;
        if (finished) return;
        if (!isCurrent() || root.isConnected === false) {
            finish('cancelled');
            return;
        }
        const page = root.querySelector(`[data-page-index="${target.pageIndex}"]`);
        const bounds = page?.getBoundingClientRect();
        let ready = false;
        if (bounds?.height > 0) {
            const viewportTop = root.getBoundingClientRect().top + (root.clientTop || 0);
            const top = root.scrollTop + bounds.top - viewportTop + bounds.height * target.offsetRatio;
            const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
            const nextTop = Math.min(maximum, Math.max(0, top));
            if (Math.abs(root.scrollTop - nextTop) > 0.5) root.scrollTop = nextTop;
            const images = [...page.querySelectorAll('img')];
            ready = images.some(image => image.complete && image.naturalWidth > 0)
                || Boolean(page.querySelector('[data-comic-tiled-ready="true"]'))
                || Boolean(page.querySelector('.viewer-comic-placeholder.is-error'));
            const geometry = `${Math.round(top * 10)}:${Math.round(bounds.height * 10)}`;
            if (!ready || !previouslyReady || geometry !== previousGeometry) {
                previousGeometry = geometry;
                stableSince = now;
            } else if (now - stableSince >= 250) {
                finish('restored');
                return;
            }
        }
        previouslyReady = ready;
        if (ready) frameId = viewport.requestAnimationFrame(tick);
        else pendingTimerId = viewport.setTimeout(() => {
            pendingTimerId = null;
            frameId = viewport.requestAnimationFrame(tick);
        }, 100);
    };
    inputEvents.forEach(type => inputRoot.addEventListener(type, cancelForInput, { capture: true, passive: true }));
    frameId = viewport.requestAnimationFrame(tick);
    return cleanup;
}
