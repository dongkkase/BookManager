function previewBounds(frame, viewport) {
    const rect = frame.getBoundingClientRect();
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (!width || !height || !rect.width || !rect.height) return null;
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(viewport.innerWidth, rect.right);
    let bottom = Math.min(viewport.innerHeight, rect.bottom);
    for (let parent = frame.parentElement; parent; parent = parent.parentElement) {
        const style = viewport.getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, parentRect.left);
            right = Math.min(right, parentRect.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, parentRect.top);
            bottom = Math.min(bottom, parentRect.bottom);
        }
    }
    if (right <= left || bottom <= top) return null;
    return { left: (left - rect.left) / scaleX, right: (right - rect.left) / scaleX, top: (top - rect.top) / scaleY, bottom: (bottom - rect.top) / scaleY };
}

function audioTextRanges(document) {
    const groups = new Map();
    for (const span of document.querySelectorAll('span[data-bookmanager-audio-range]')) {
        const id = span.getAttribute('data-bookmanager-audio-range');
        if (!id) continue;
        if (!groups.has(id)) groups.set(id, []);
        const walker = document.createTreeWalker(span, document.defaultView.NodeFilter.SHOW_TEXT);
        let text;
        while ((text = walker.nextNode())) {
            const start = text.data.search(/\S/);
            if (start < 0 || text.parentElement?.closest('audio, script, style, [hidden]')) continue;
            const range = document.createRange();
            range.setStart(text, start);
            range.setEnd(text, text.data.trimEnd().length);
            groups.get(id).push(range);
        }
    }
    return groups;
}

function visibleAudio(item, bounds, viewport) {
    if (!bounds) return false;
    if (item.ranges) {
        return item.ranges.some(range => {
            if (![...range.getClientRects()].some(rect => rect.right > rect.left && rect.bottom > rect.top && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom)) return false;
            const element = range.startContainer.parentElement;
            if (!element) return false;
            const style = viewport.getComputedStyle(element);
            if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
            for (let parent = element; parent; parent = parent.parentElement) {
                if (viewport.getComputedStyle(parent).opacity === '0') return false;
            }
            return true;
        });
    }
    const rect = item.anchor?.getBoundingClientRect();
    // A hidden player's figure keeps its zero-height position in the reading flow.
    return rect && item.anchor.getClientRects().length && rect.right > bounds.left && rect.left < bounds.right && rect.bottom >= bounds.top && rect.top < bounds.bottom;
}

export function attachPreviewAudio(frame) {
    const document = frame.contentDocument;
    const hostDocument = frame.ownerDocument;
    const viewport = hostDocument.defaultView;
    if (!document?.body || !viewport) return () => {};
    const ranges = audioTextRanges(document);
    const items = [...document.querySelectorAll('figure.audio audio, audio[data-bookmanager-audio-range]')].map(audio => {
        const value = audio.getAttribute('data-bookmanager-audio-volume');
        const volume = value == null || value.trim() === '' ? 1 : Number(value);
        audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
        const rangeId = audio.getAttribute('data-bookmanager-audio-range');
        return { audio, anchor: audio.closest('figure.audio'), ranges: rangeId == null ? null : ranges.get(rangeId) || [], entered: false, retry: false, generation: 0 };
    });
    if (!items.length) return () => {};
    let disposed = false;
    let scheduled = null;
    const listeners = [];
    const listen = (target, type, callback, capture = false) => {
        target?.addEventListener(type, callback, capture);
        listeners.push(() => target?.removeEventListener(type, callback, capture));
    };
    const stop = item => {
        item.entered = false;
        item.retry = false;
        item.generation += 1;
        item.audio.pause();
        try { item.audio.currentTime = 0; } catch {}
    };
    const stopAll = () => items.forEach(stop);
    const active = () => !disposed && frame.isConnected && frame.contentDocument === document && hostDocument.visibilityState !== 'hidden' && document.visibilityState !== 'hidden' && hostDocument.hasFocus();
    const update = (retry = false) => {
        if (!active()) { stopAll(); return; }
        const bounds = previewBounds(frame, viewport);
        for (const item of items) {
            if (!visibleAudio(item, bounds, document.defaultView)) { if (item.entered || !item.audio.paused) stop(item); continue; }
            if (item.entered && !(retry && item.retry)) continue;
            item.entered = true;
            item.retry = false;
            const generation = ++item.generation;
            const failed = () => { if (!disposed && item.generation === generation && item.entered) item.retry = true; };
            try {
                Promise.resolve(item.audio.play()).then(() => {
                    if (!active() || !item.entered) item.audio.pause();
                }, failed);
            } catch { failed(); }
        }
    };
    const schedule = () => {
        if (disposed || scheduled != null) return;
        scheduled = viewport.requestAnimationFrame(() => { scheduled = null; update(); });
    };
    const interact = event => { if (!event.repeat) update(true); };
    const blur = () => { if (!hostDocument.hasFocus()) stopAll(); };
    listen(document, 'scroll', schedule, true);
    listen(hostDocument, 'scroll', schedule, true);
    listen(document, 'load', schedule, true);
    listen(viewport, 'resize', schedule);
    listen(document.defaultView, 'resize', schedule);
    listen(viewport, 'blur', blur);
    listen(document.defaultView, 'blur', blur);
    listen(viewport, 'focus', schedule);
    listen(document.defaultView, 'focus', schedule);
    listen(hostDocument, 'visibilitychange', () => update());
    listen(document, 'visibilitychange', () => update());
    listen(document.defaultView, 'pagehide', stopAll);
    for (const target of [document, hostDocument]) {
        listen(target, 'pointerdown', interact, true);
        listen(target, 'keydown', interact, true);
    }
    const observer = viewport.ResizeObserver ? new viewport.ResizeObserver(schedule) : null;
    observer?.observe(document.body);
    observer?.observe(frame);
    document.fonts?.ready.then(schedule);
    update();
    return () => {
        disposed = true;
        if (scheduled != null) viewport.cancelAnimationFrame(scheduled);
        observer?.disconnect();
        listeners.forEach(remove => remove());
        stopAll();
    };
}
