export const MIN_PREVIEW_DIMENSION = 240;
export const MAX_PREVIEW_DIMENSION = 3840;

export const PREVIEW_DEVICES = [
    { id: 'phoneSmall', label: 'previewPhoneSmall', width: 375, height: 667 },
    { id: 'phoneLarge', label: 'previewPhoneLarge', width: 430, height: 932 },
    { id: 'tablet', label: 'previewTablet', width: 768, height: 1024 },
    { id: 'laptop', label: 'previewLaptop', width: 1366, height: 768 },
    { id: 'desktop', label: 'previewDesktop', width: 1920, height: 1080 },
];

export const PREVIEW_ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200];

export function normalizePreviewDimension(value, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && !value.trim()) return fallback;
    const dimension = Number(value);
    if (!Number.isFinite(dimension)) return fallback;
    return Math.max(MIN_PREVIEW_DIMENSION, Math.min(MAX_PREVIEW_DIMENSION, Math.round(dimension)));
}

export function previewFitScale(viewport, available) {
    const dimensions = [viewport.width, viewport.height, available.width, available.height];
    if (dimensions.some(value => !Number.isFinite(value) || value <= 0)) return 1;
    return Math.min(1, available.width / viewport.width, available.height / viewport.height);
}
