export const DEFAULT_MAIN_SIDEBAR_RATIO = 0.2;
export const DEFAULT_DETAIL_PANEL_RATIO = 0.35;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;
export const MIN_CONTENT_WIDTH = 520;
export const MIN_DETAIL_HEIGHT = 112;
export const MAX_DETAIL_HEIGHT = 420;
export const MIN_FILE_LIST_HEIGHT = 64;
export const RIGHT_PANEL_FIXED_HEIGHT = 96;

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function clampSidebarWidth(width, containerWidth) {
    const availableWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(
            MAX_SIDEBAR_WIDTH,
            (finiteNumber(containerWidth) || 1200) - MIN_CONTENT_WIDTH,
        ),
    );
    return Math.min(
        availableWidth,
        Math.max(MIN_SIDEBAR_WIDTH, Math.round(finiteNumber(width) || MIN_SIDEBAR_WIDTH)),
    );
}

export function resolveSidebarWidth(savedWidth, containerWidth) {
    const width = finiteNumber(savedWidth)
        ?? (finiteNumber(containerWidth) || 1200) * DEFAULT_MAIN_SIDEBAR_RATIO;
    return clampSidebarWidth(width, containerWidth);
}

export function clampDetailHeight(height, containerHeight) {
    const availableHeight = Math.max(
        MIN_DETAIL_HEIGHT,
        (finiteNumber(containerHeight) || 700) - MIN_FILE_LIST_HEIGHT - RIGHT_PANEL_FIXED_HEIGHT,
    );
    return Math.min(
        MAX_DETAIL_HEIGHT,
        availableHeight,
        Math.max(MIN_DETAIL_HEIGHT, Math.round(finiteNumber(height) || MIN_DETAIL_HEIGHT)),
    );
}

export function resolveDetailHeight(savedHeight, containerHeight) {
    const height = finiteNumber(savedHeight)
        ?? (finiteNumber(containerHeight) || 700) * DEFAULT_DETAIL_PANEL_RATIO;
    return clampDetailHeight(height, containerHeight);
}
