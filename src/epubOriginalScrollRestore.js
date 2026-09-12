export function restoreEpubOriginalScrollPosition(root, position, { isCurrent = () => true, onFinish = () => {} } = {}) {
    const viewport = root?.ownerDocument?.defaultView;
    let finished = false;
    let frameId = null;
    let timeoutId = null;
    let observer;
    let previousGeometry = '';
    let stableFrames = 0;
    let applied = false;
    let lastChange = 0;
    const observed = new Set();
    const frameDocuments = new Set();
    const inputEvents = ['wheel', 'pointerdown', 'keydown'];
    const progress = Math.min(1, Math.max(0, Number(position?.chapterProgress) || 0));
    const pageIndex = Number(position?.pageIndex);

    const finish = reason => {
        if (finished) return;
        finished = true;
        if (frameId !== null) viewport?.cancelAnimationFrame(frameId);
        if (timeoutId !== null) viewport?.clearTimeout(timeoutId);
        observer?.disconnect();
        inputEvents.forEach(type => root?.removeEventListener?.(type, cancelForInput, true));
        frameDocuments.forEach(document => inputEvents.forEach(type => document.removeEventListener(type, cancelForInput, true)));
        onFinish({ reason });
    };
    const cleanup = () => finish('cancelled');
    const cancelForInput = event => {
        if (event.target?.closest?.('.viewer-settings-panel')) return;
        finish('cancelled');
    };
    if (!viewport || !root?.querySelectorAll || (!Number.isInteger(pageIndex) && !position?.entryName)) {
        finish('cancelled');
        return cleanup;
    }

    const watch = elements => {
        if (!observer) return;
        elements.forEach(element => {
            if (!element || observed.has(element)) return;
            observed.add(element);
            observer.observe(element);
        });
    };
    const watchFrameInput = frames => {
        frames.forEach(frame => {
            try {
                const document = frame.contentDocument;
                if (!document || frameDocuments.has(document)) return;
                frameDocuments.add(document);
                inputEvents.forEach(type => document.addEventListener(type, cancelForInput, { capture: true, passive: true }));
            } catch {}
        });
    };
    const measure = () => {
        const sections = [...root.querySelectorAll('[data-reader-index]')];
        const targetIndex = sections.findIndex(section => Number.isInteger(pageIndex)
            ? Number(section.dataset.readerIndex) === pageIndex
            : section.querySelector('.viewer-epub-original-frame')?.dataset.originalEntry === position.entryName);
        if (targetIndex < 0) return null;
        const preceding = sections.slice(0, targetIndex + 1);
        const frames = preceding.map(section => section.querySelector('.viewer-epub-original-frame'));
        watchFrameInput(frames.filter(Boolean));
        watch([root, root.firstElementChild, ...preceding]);
        if (frames.some(frame => !frame || frame.dataset.originalReady !== 'true')) return null;
        const rootTop = root.getBoundingClientRect().top + (root.clientTop || 0);
        const rects = preceding.map(section => section.getBoundingClientRect());
        if (rects.some(rect => rect.width <= 0 || rect.height <= 0)) return null;
        const target = rects[rects.length - 1];
        const top = root.scrollTop + target.top - rootTop + target.height * progress;
        const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
        return {
            top: Math.min(maximum, Math.max(0, top)),
            geometry: JSON.stringify([root.clientHeight, root.scrollHeight, ...rects.map(rect => [
                Math.round((root.scrollTop + rect.top - rootTop) * 10),
                Math.round(rect.width * 10), Math.round(rect.height * 10),
            ])]),
        };
    };
    const tick = now => {
        frameId = null;
        if (finished) return;
        if (!isCurrent() || root.isConnected === false) {
            finish('cancelled');
            return;
        }
        const layout = measure();
        if (!layout || layout.geometry !== previousGeometry) {
            previousGeometry = layout?.geometry || '';
            stableFrames = 0;
            lastChange = now;
        } else {
            stableFrames += 1;
        }
        if (layout && stableFrames >= 2) {
            if (Math.abs(root.scrollTop - layout.top) > 0.5) {
                root.scrollTo({ top: layout.top, left: root.scrollLeft, behavior: 'instant' });
            }
            if (!applied) {
                applied = true;
                lastChange = now;
            }
            if (now - lastChange >= 1000) {
                finish('restored');
                return;
            }
        }
        frameId = viewport.requestAnimationFrame(tick);
    };
    if (typeof viewport.ResizeObserver === 'function') {
        observer = new viewport.ResizeObserver(() => {
            stableFrames = 0;
            lastChange = viewport.performance.now();
        });
    }
    inputEvents.forEach(type => root.addEventListener(type, cancelForInput, { capture: true, passive: true }));
    timeoutId = viewport.setTimeout(() => finish('timeout'), 5000);
    frameId = viewport.requestAnimationFrame(tick);
    return cleanup;
}
