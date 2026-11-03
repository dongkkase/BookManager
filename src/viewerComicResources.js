export const COMIC_FALLBACK_CACHE_BYTES = 64 * 1024 * 1024;
export const COMIC_FALLBACK_CACHE_ENTRIES = 24;

export function comicDataUrlBytes(value = '') {
    // Count a conservative two bytes per character, including the base64 expansion.
    return value.length * 2;
}

export function limitComicPageData(data, newestName, protectedNames = []) {
    const entries = Object.entries(data);
    const protectedSet = new Set([newestName, ...protectedNames]);
    let bytes = entries.reduce((sum, [, value]) => sum + comicDataUrlBytes(value), 0);
    let count = entries.length;
    const next = { ...data };
    for (const [name, value] of entries) {
        if (count <= COMIC_FALLBACK_CACHE_ENTRIES && bytes <= COMIC_FALLBACK_CACHE_BYTES) break;
        if (protectedSet.has(name)) continue;
        delete next[name];
        bytes -= comicDataUrlBytes(value);
        count -= 1;
    }
    return next;
}

// Mounted frames keep their successfully loaded fallback until they leave the
// reading window, even when the shared cache evicts that entry.
export function retainComicImageSource(previous, source = '') {
    return source.startsWith('data:') || !previous?.startsWith('data:') ? source : previous;
}

export function comicBackgroundPageUrl(source = '') {
    if (!source.startsWith('bookmanager-comic:')) return source;
    const url = new URL(source);
    url.searchParams.set('priority', 'background');
    return url.href;
}

let comicRequestSequence = 0;
const comicRequestPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createComicPageRequest(source = '', api = globalThis.window?.viewerAPI) {
    if (!source.startsWith('bookmanager-comic:') || !api?.cancelComicPageRequest) {
        return { url: source, release() {} };
    }
    const url = new URL(source);
    const sessionId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '');
    const requestId = `${comicRequestPrefix}-${++comicRequestSequence}`;
    url.searchParams.set('requestId', requestId);
    let released = false;
    return {
        url: url.href,
        release() {
            if (released) return;
            released = true;
            try {
                Promise.resolve(api.cancelComicPageRequest(sessionId, requestId)).catch(() => {});
            } catch {
                // The viewer can close before its final image cleanup runs.
            }
        },
    };
}

const thumbnailObservers = new WeakMap();

export function observeComicThumbnail(element, onVisible) {
    const root = element?.closest('.viewer-slide-strip');
    if (!root || typeof IntersectionObserver !== 'function') {
        onVisible(true);
        return () => {};
    }
    let group = thumbnailObservers.get(root);
    if (!group) {
        const callbacks = new Map();
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => callbacks.get(entry.target)?.(entry.isIntersecting));
        }, { root, rootMargin: '0px 100px' });
        group = { observer, callbacks };
        thumbnailObservers.set(root, group);
    }
    group.callbacks.set(element, onVisible);
    group.observer.observe(element);
    return () => {
        group.observer.unobserve(element);
        group.callbacks.delete(element);
        if (group.callbacks.size === 0) {
            group.observer.disconnect();
            thumbnailObservers.delete(root);
        }
    };
}
