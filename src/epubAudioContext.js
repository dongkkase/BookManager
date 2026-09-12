import { resolveEpubReadingPosition } from './epubOriginalPagination.js';

function pageHasAudioAnchor(page, track) {
    if (track.anchor && page.anchors?.includes(track.anchor)) return true;
    return (page.blocks || []).some(block => (
        (track.anchor && block.anchors?.includes(track.anchor)) || block.audioTracks?.includes(track.id)
    ));
}

export function mapEpubAudioTracks(chapters = [], pages = []) {
    const byPage = new Map();
    const tracks = [];
    for (const chapter of chapters) {
        const chapterPages = pages.map((page, index) => ({ page, index })).filter(({ page }) => page.name === chapter.name);
        if (!chapterPages.length) continue;
        for (const track of chapter.audioTracks || []) {
            if (!track.id || !track.sources?.some(source => source.src)) continue;
            const match = chapterPages.find(({ page }) => pageHasAudioAnchor(page, track));
            const pageIndex = match?.index ?? (track.text
                ? resolveEpubReadingPosition(pages, { entryName: chapter.name, textQuote: track.text, chapterProgress: 0 })
                : chapterPages[0].index);
            const mapped = { ...track, entryName: chapter.name, pageIndex };
            tracks.push(mapped);
            if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
            byPage.get(pageIndex).push(mapped);
        }
    }
    return { tracks, byPage };
}

function intersects(rect, viewport) {
    return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1
        && rect.right > viewport.left + 1 && rect.left < viewport.right - 1;
}

function isVisiblePage(page, root) {
    const leaf = page.closest('[data-curl-visible]');
    if (leaf && leaf.dataset.curlVisible !== 'true') return false;
    for (let node = page; node && node !== root; node = node.parentElement) {
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
}

function audioAnchorBounds(page, track) {
    const frame = page.querySelector('.viewer-epub-original-frame');
    const document = frame?.contentDocument;
    if (frame && frame.dataset.originalReady !== 'true') return null;
    const target = frame
        ? document?.getElementById(track.anchor)
        : [...page.querySelectorAll('[data-epub-anchor]')].find(node => node.dataset.epubAnchor === track.anchor);
    if (!target) return page.getBoundingClientRect();
    let node = target;
    let rect = node.getBoundingClientRect();
    while ((!rect.width || !rect.height) && node.parentElement && node !== page) {
        node = node.parentElement;
        rect = node.getBoundingClientRect();
    }
    if (!frame) return rect;
    const outer = frame.getBoundingClientRect();
    const scaleX = outer.width / Math.max(1, frame.clientWidth);
    const scaleY = outer.height / Math.max(1, frame.clientHeight);
    return {
        left: outer.left + rect.left * scaleX,
        right: outer.left + rect.right * scaleX,
        top: outer.top + rect.top * scaleY,
        bottom: outer.top + rect.bottom * scaleY,
    };
}

export function visibleEpubAudioTracks(root, mapping, { flowMode, pageIndex }) {
    if (!root || !mapping.tracks.length) return [];
    const viewport = root.getBoundingClientRect();
    const result = [];
    const added = new Set();
    const attribute = flowMode === 'scroll' ? 'data-reader-index' : 'data-reader-page-index';
    for (const page of root.querySelectorAll(`[${attribute}]`)) {
        const index = Number(page.getAttribute(attribute));
        if (flowMode !== 'scroll' && index !== pageIndex && !(flowMode === 'spread' && index === pageIndex + 1)) continue;
        const candidates = mapping.byPage.get(index);
        if (!candidates?.length || !isVisiblePage(page, root) || !intersects(page.getBoundingClientRect(), viewport)) continue;
        const frame = page.querySelector('.viewer-epub-original-frame');
        if (frame && frame.dataset.originalReady !== 'true') continue;
        for (const track of candidates) {
            if (added.has(track.id)) continue;
            const bounds = flowMode === 'scroll' ? audioAnchorBounds(page, track) : null;
            if (flowMode === 'scroll' && (!bounds || !intersects(bounds, viewport))) continue;
            added.add(track.id);
            result.push(track);
        }
    }
    return result.sort((first, second) => mapping.tracks.indexOf(first) - mapping.tracks.indexOf(second));
}
