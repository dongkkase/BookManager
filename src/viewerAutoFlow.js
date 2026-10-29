export function normalizeViewerFlowMode(value) {
    return ['auto', 'single', 'spread', 'scroll'].includes(value) ? value : 'single';
}

export function resolveViewerFlowMode(preference, viewport, isWebtoon = false) {
    const mode = normalizeViewerFlowMode(preference);
    if (mode !== 'auto') return mode;
    if (isWebtoon) return 'scroll';

    const width = viewport?.width;
    const height = viewport?.height;
    return Number.isFinite(width) && Number.isFinite(height)
        && width > 0 && height > 0 && width > height
        ? 'spread'
        : 'single';
}

export function webtoonZoomForWidth(currentZoom, displayedWidth, minimumZoom = 10) {
    if (!Number.isFinite(currentZoom) || currentZoom <= 0
        || !Number.isFinite(displayedWidth) || displayedWidth <= 800) return currentZoom;
    const minimum = Number.isFinite(minimumZoom) && minimumZoom >= 0 ? minimumZoom : 10;
    const fittedZoom = Math.floor(currentZoom * 800 / displayedWidth * 100) / 100;
    return Math.min(currentZoom, Math.max(minimum, fittedZoom));
}

export function webtoonWidthReference(pages = [], pageSizes = {}) {
    let reference = null;
    for (const page of Array.isArray(pages) ? pages : []) {
        if (!page?.name) continue;
        const size = pageSizes?.[page.name];
        if (!Number.isFinite(size?.width) || size.width <= 1
            || !Number.isFinite(size?.height) || size.height <= 1) continue;
        if (!reference || size.width < reference.width) reference = { width: size.width, height: size.height };
    }
    return reference;
}

export function webtoonPageSize(size, commonWidth) {
    if (!Number.isFinite(commonWidth) || commonWidth <= 1
        || !Number.isFinite(size?.width) || size.width <= 1
        || !Number.isFinite(size?.height) || size.height <= 1) return null;
    const height = Math.max(1, Math.round(commonWidth * size.height / size.width));
    return Number.isFinite(height) ? { width: commonWidth, height } : null;
}

export function textPageOffsets(pages = []) {
    let offset = 0;
    return pages.map(page => {
        const start = offset;
        offset += String(page ?? '').replace(/\s/g, '').length;
        return start;
    });
}

export function textPageIndexAtOffset(offsets = [], offset = 0) {
    const target = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    let left = 0;
    let right = offsets.length;
    while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (offsets[middle] <= target) left = middle + 1;
        else right = middle;
    }
    return Math.max(0, left - 1);
}
