const VIEWER_ARROW_KEY_MODES = new Set(['reading-natural', 'ltr']);

export function normalizeViewerArrowKeyMode(value) {
    return VIEWER_ARROW_KEY_MODES.has(value) ? value : 'reading-natural';
}

export function viewerArrowKeyPageDelta(key, { mode, readingDirection } = {}) {
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
    const visualDelta = key === 'ArrowRight' ? 1 : -1;
    if (normalizeViewerArrowKeyMode(mode) === 'reading-natural' && readingDirection === 'rtl') {
        return -visualDelta;
    }
    return visualDelta;
}
