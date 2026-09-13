import { resolveEpubReadingPosition } from './epubOriginalPagination.js';
import { getEpubOriginalAnchorRects } from './epubOriginalDocument.js';

function triggerAnchors(track) {
    return Array.isArray(track.triggerAnchors) ? [...new Set(track.triggerAnchors.filter(anchor => typeof anchor === 'string' && anchor))] : [];
}

function pageHasAudioAnchor(page, track) {
    const triggers = triggerAnchors(track);
    if (triggers.length) {
        return triggers.some(anchor => page.anchors?.includes(anchor)
            || (page.blocks || []).some(block => block.anchors?.includes(anchor)));
    }
    if (track.anchor && page.anchors?.includes(track.anchor)) return true;
    return (page.blocks || []).some(block => (
        (track.anchor && block.anchors?.includes(track.anchor)) || block.audioTracks?.includes(track.id)
    ));
}

export function mapEpubAudioTracks(chapters = [], pages = []) {
    const byPage = new Map();
    const byChapter = new Map();
    const tracks = [];
    for (const chapter of chapters) {
        const chapterPages = pages.map((page, index) => ({ page, index })).filter(({ page }) => page.name === chapter.name);
        if (!chapterPages.length) continue;
        for (const track of chapter.audioTracks || []) {
            if (!track.id || !track.sources?.some(source => source.src)) continue;
            const matches = chapterPages.filter(({ page }) => pageHasAudioAnchor(page, track));
            const pageIndex = matches[0]?.index ?? (track.text
                ? resolveEpubReadingPosition(pages, { entryName: chapter.name, textQuote: track.text, chapterProgress: 0 })
                : chapterPages[0].index);
            const mapped = { ...track, entryName: chapter.name, pageIndex };
            tracks.push(mapped);
            if (!byChapter.has(chapter.name)) byChapter.set(chapter.name, []);
            byChapter.get(chapter.name).push(mapped);
            const pageIndexes = triggerAnchors(track).length ? matches.map(match => match.index) : [pageIndex];
            for (const index of pageIndexes) {
                if (!byPage.has(index)) byPage.set(index, []);
                byPage.get(index).push(mapped);
            }
        }
    }
    return { tracks, byPage, byChapter };
}

function intersects(rect, viewport) {
    return rect.bottom > viewport.top && rect.top < viewport.bottom
        && rect.right > viewport.left && rect.left < viewport.right;
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

function audioAnchorBounds(page, track, frame) {
    const document = frame?.contentDocument;
    const triggers = triggerAnchors(track);
    const anchors = triggers.length ? triggers : track.anchor ? [track.anchor] : [];
    if (!anchors.length) return [page.getBoundingClientRect()];
    const candidates = frame ? [] : [...page.querySelectorAll('[data-epub-anchor]')];
    const rects = anchors.flatMap(anchor => {
        const target = frame ? document?.getElementById(anchor) : candidates.find(node => node.dataset.epubAnchor === anchor);
        return target ? getEpubOriginalAnchorRects(target) : [];
    });
    if (!frame) return rects;
    const outer = frame.getBoundingClientRect();
    const scaleX = outer.width / Math.max(1, frame.clientWidth);
    const scaleY = outer.height / Math.max(1, frame.clientHeight);
    return rects.map(rect => ({
        left: outer.left + rect.left * scaleX,
        right: outer.left + rect.right * scaleX,
        top: outer.top + rect.top * scaleY,
        bottom: outer.top + rect.bottom * scaleY,
    }));
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
        const pageBounds = page.getBoundingClientRect();
        if (!isVisiblePage(page, root) || !intersects(pageBounds, viewport)) continue;
        const frame = page.querySelector('.viewer-epub-original-frame');
        if (frame && frame.dataset.originalReady !== 'true') continue;
        const candidates = frame
            ? mapping.byChapter.get(frame.dataset.originalEntry)
            : mapping.byPage.get(index);
        if (!candidates?.length) continue;
        const frameBounds = frame ? frame.getBoundingClientRect() : pageBounds;
        const visibleBounds = {
            left: Math.max(viewport.left, pageBounds.left, frameBounds.left),
            right: Math.min(viewport.right, pageBounds.right, frameBounds.right),
            top: Math.max(viewport.top, pageBounds.top, frameBounds.top),
            bottom: Math.min(viewport.bottom, pageBounds.bottom, frameBounds.bottom),
        };
        if (visibleBounds.right <= visibleBounds.left || visibleBounds.bottom <= visibleBounds.top) continue;
        for (const track of candidates) {
            if (added.has(track.id)) continue;
            const bounds = audioAnchorBounds(page, track, frame);
            if (!bounds.some(rect => intersects(rect, visibleBounds))) continue;
            added.add(track.id);
            result.push(track);
        }
    }
    return result.sort((first, second) => mapping.tracks.indexOf(first) - mapping.tracks.indexOf(second));
}
