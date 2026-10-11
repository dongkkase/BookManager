const ARRIVAL_DURATION = 800;
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|bmp|x-ms-bmp);base64,/i;

function visibleRect(element, view) {
    if (!element || element.isConnected === false || element.closest?.('[hidden], [inert]')) return null;
    if (element.getClientRects && !element.getClientRects().length) return null;
    const style = view.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return null;
    const rect = element.getBoundingClientRect?.();
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(view.innerWidth, rect.left + rect.width);
    const bottom = Math.min(view.innerHeight, rect.top + rect.height);
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

function fitImage(width, height, maxWidth, maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return { width: width * scale, height: height * scale };
}

export function animateCoverEditorImageArrival({ sourceElement, targetElement, container, image, onFinish }) {
    const document = container?.ownerDocument;
    const view = document?.defaultView;
    let finished = false;
    let started = false;
    let animation;
    let flyer;
    let thumbnail;
    let timeout;
    let observer;
    const listeners = [];
    const finish = (notify = true) => {
        if (finished) return;
        finished = true;
        if (timeout !== undefined) view.clearTimeout(timeout);
        observer?.disconnect();
        for (const [target, name, listener, options] of listeners) target.removeEventListener(name, listener, options);
        if (thumbnail) {
            thumbnail.onload = null;
            thumbnail.onerror = null;
        }
        if (animation) {
            animation.onfinish = null;
            animation.oncancel = null;
            animation.cancel();
        }
        flyer?.remove();
        if (notify) onFinish?.();
    };
    const cancel = () => finish(false);
    const listen = (target, name, listener, options) => {
        if (!target?.addEventListener) return;
        target.addEventListener(name, listener, options);
        listeners.push([target, name, listener, options]);
    };
    const canShow = () => !document.hidden
        && visibleRect(container, view) && visibleRect(sourceElement, view) && visibleRect(targetElement, view);
    if (!view || !document.createElement || !container.appendChild || !RASTER_DATA_URL.test(image?.dataUrl || '')
        || !Number.isFinite(image?.width) || !Number.isFinite(image?.height) || image.width <= 0 || image.height <= 0
        || !canShow()) {
        finish();
        return cancel;
    }

    flyer = document.createElement('div');
    if (typeof flyer.animate !== 'function') {
        finish();
        return cancel;
    }
    thumbnail = document.createElement('img');
    flyer.className = 'cover-editor-image-arrival';
    flyer.setAttribute('aria-hidden', 'true');
    thumbnail.alt = '';
    thumbnail.draggable = false;
    Object.assign(flyer.style, {
        position: 'fixed', pointerEvents: 'none', transformOrigin: 'center', opacity: '0',
    });
    flyer.appendChild(thumbnail);
    container.appendChild(flyer);

    const finishMotion = () => finish();
    const checkVisibility = () => { if (!canShow()) finish(); };
    listen(view, 'resize', finishMotion);
    listen(view, 'scroll', finishMotion, true);
    listen(document, 'visibilitychange', checkVisibility);
    if (view.MutationObserver) {
        observer = new view.MutationObserver(checkVisibility);
        observer.observe(container, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] });
        for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement) {
            observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'style', 'class'] });
        }
    }
    timeout = view.setTimeout(finishMotion, 1800);
    const start = () => {
        if (finished || started) return;
        if (!canShow()) {
            finish();
            return;
        }
        started = true;
        const source = visibleRect(sourceElement, view);
        const target = targetElement.getBoundingClientRect();
        const destination = fitImage(image.width, image.height, target.width, target.height);
        const size = fitImage(image.width, image.height,
            Math.min(destination.width * 2, view.innerWidth - 32),
            Math.min(destination.height * 2, view.innerHeight - 32));
        const scale = Math.min(0.32, destination.width / size.width);
        const left = Math.max(16, Math.min(source.left + (source.width - size.width) / 2, view.innerWidth - size.width - 16));
        const top = Math.max(16, Math.min(source.top + (source.height - size.height) / 2, view.innerHeight - size.height - 16));
        const dx = target.left + target.width / 2 - (left + size.width / 2);
        const dy = target.top + target.height / 2 - (top + size.height / 2);
        Object.assign(flyer.style, { left: `${left}px`, top: `${top}px`, width: `${size.width}px`, height: `${size.height}px` });
        const destinationTransform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        try {
            animation = flyer.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 0, offset: 0, easing: 'ease-out' },
                { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.175 },
                { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.4, easing: 'cubic-bezier(0.55, 0.05, 0.82, 0.52)' },
                { transform: destinationTransform, opacity: 1, offset: 0.925 },
                { transform: destinationTransform, opacity: 0, offset: 1 },
            ], { duration: ARRIVAL_DURATION, fill: 'both' });
            animation.onfinish = finishMotion;
            animation.oncancel = finishMotion;
            view.clearTimeout(timeout);
            timeout = view.setTimeout(finishMotion, ARRIVAL_DURATION + 200);
        } catch {
            finish();
        }
    };
    thumbnail.onerror = finishMotion;
    if (typeof thumbnail.decode !== 'function') thumbnail.onload = start;
    thumbnail.src = image.dataUrl;
    if (typeof thumbnail.decode === 'function') {
        try {
            Promise.resolve(thumbnail.decode()).then(start, finishMotion);
        } catch {
            finish();
        }
    } else if (thumbnail.complete && thumbnail.naturalWidth > 0) {
        start();
    }
    return cancel;
}
