const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clampSize(value, minimum, fallback, maximum) {
    const number = toFiniteNumber(value) ?? fallback;
    return Math.min(Math.max(Math.round(number), minimum), Math.max(minimum, maximum));
}

function intersectsWorkArea(bounds, workArea) {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const workRight = workArea.x + workArea.width;
    const workBottom = workArea.y + workArea.height;

    return right > workArea.x
        && bounds.x < workRight
        && bottom > workArea.y
        && bounds.y < workBottom;
}

export function resolveWindowState(config = {}, displays = [], primaryWorkArea = {}) {
    const minWidth = Math.max(1, Math.round(toFiniteNumber(config.min_window_width) ?? 1200));
    const minHeight = Math.max(1, Math.round(toFiniteNumber(config.min_window_height) ?? 750));
    const workArea = {
        x: toFiniteNumber(primaryWorkArea.x) ?? 0,
        y: toFiniteNumber(primaryWorkArea.y) ?? 0,
        width: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.width) ?? DEFAULT_WIDTH)),
        height: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.height) ?? DEFAULT_HEIGHT)),
    };
    const maxWidth = Math.max(minWidth, workArea.width);
    const maxHeight = Math.max(minHeight, workArea.height);
    const width = clampSize(config.width, minWidth, DEFAULT_WIDTH, maxWidth);
    const height = clampSize(config.height, minHeight, DEFAULT_HEIGHT, maxHeight);
    const savedX = toFiniteNumber(config.x);
    const savedY = toFiniteNumber(config.y);
    const savedBounds = savedX === null || savedY === null
        ? null
        : { x: Math.round(savedX), y: Math.round(savedY), width, height };
    const availableWorkAreas = displays
        .map(display => display?.workArea)
        .filter(Boolean);
    const isVisible = savedBounds
        && availableWorkAreas.some(displayWorkArea => intersectsWorkArea(savedBounds, displayWorkArea));

    return {
        bounds: isVisible ? savedBounds : {
            x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
            y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2)),
            width,
            height,
        },
        minWidth,
        minHeight,
        isMaximized: Boolean(config.is_maximized),
    };
}

export function serializeWindowState(window) {
    const bounds = window.getNormalBounds();
    return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        is_maximized: window.isMaximized(),
    };
}
