export const IMAGE_EDIT_LIMITS = Object.freeze({ maxDimension: 8192, maxPixels: 32 * 1024 * 1024, previewDimension: 1000, maxRegions: 100 });

export const IMAGE_CROP_PRESETS = Object.freeze([
    { id: 'original', label: '원본', ratio: null },
    { id: 'free', label: '자유', ratio: null },
    { id: '1:1', label: '1:1', ratio: 1 },
    { id: '4:3', label: '4:3', ratio: 4 / 3 },
    { id: '3:2', label: '3:2', ratio: 3 / 2 },
    { id: '16:8', label: '16:8', ratio: 2 },
    { id: '2:3', label: '2:3', ratio: 2 / 3 },
    { id: '3:4', label: '3:4', ratio: 3 / 4 },
]);

export const IMAGE_FILTER_PRESETS = Object.freeze([
    { id: 'original', label: '원본' },
    { id: 'soft', label: '부드러운', brightness: 6, contrast: -12, saturation: -12 },
    { id: 'clean', label: '깨끗한', brightness: 9, contrast: 5, saturation: -14, temperature: -8 },
    { id: 'sunset', label: '노을', brightness: 2, contrast: 12, saturation: -10, temperature: 20 },
    { id: 'warm', label: '따스한', brightness: 4, saturation: 9, temperature: 26 },
    { id: 'glow', label: '빛나는', brightness: 12, contrast: -8, saturation: 10 },
    { id: 'moonlight', label: '달빛', brightness: 3, contrast: -10, saturation: -18, temperature: -24 },
    { id: 'champagne', label: '샴페인', brightness: 8, contrast: -5, saturation: -8, temperature: 14 },
    { id: 'vivid', label: '선명', contrast: 20, saturation: 28 },
    { id: 'calm', label: '단아함', brightness: 3, contrast: -6, saturation: -22 },
    { id: 'everyday', label: '일상', brightness: 3, contrast: 10, saturation: 10, temperature: 6 },
    { id: 'faded', label: '아련한', brightness: 7, contrast: -22, saturation: -20, temperature: -7 },
    { id: 'sweet', label: '달콤', brightness: 6, saturation: 19, temperature: 8, tint: 7 },
    { id: 'grayscale', label: '그레이', saturation: -100 },
    { id: 'elegant', label: '우아한', brightness: 3, contrast: 8, saturation: -15, temperature: -12, tint: 5 },
    { id: 'cozy', label: '따뜻함', brightness: 2, contrast: -8, saturation: -8, temperature: 35 },
    { id: 'radiant', label: '화사', brightness: 10, contrast: 8, saturation: 16, tint: 4 },
    { id: 'cotton', label: '솜사탕', brightness: 12, contrast: -20, saturation: -7, temperature: -10, tint: 12 },
    { id: 'memories', label: '회상', contrast: -12, saturation: -100, vignette: 18 },
    { id: 'film', label: '필름', contrast: -8, saturation: -25, temperature: 18, tint: -8, vignette: 22 },
    { id: 'autumn', label: '가을날', contrast: 10, saturation: -14, temperature: 34, vignette: 12 },
    { id: 'romantic', label: '로맨틱', brightness: 6, contrast: -9, saturation: -6, temperature: 8, tint: 10 },
].map(preset => ({
    ...preset,
    cssFilter: `brightness(${1 + (preset.brightness || 0) / 100}) contrast(${2 ** ((preset.contrast || 0) / 50)}) saturate(${1 + (preset.saturation || 0) / 100}) sepia(${Math.max(0, preset.temperature || 0) / 200}) hue-rotate(${Math.min(0, preset.temperature || 0)}deg)`,
})));

export const IMAGE_BORDER_PRESETS = Object.freeze([
    { id: 'none', label: '없음' },
    { id: 'white', label: '여백' },
    { id: 'rounded', label: '둥근 모서리' },
    { id: 'outline', label: '선 테두리' },
    { id: 'double', label: '이중 테두리' },
    { id: 'shadow', label: '그림자' },
    { id: 'rough-dark', label: '검은 거친 테두리' },
    { id: 'rough-white', label: '흰 거친 테두리' },
]);

function number(value, fallback) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function limitedDimensions(width, height) {
    const requestedWidth = Math.max(1, number(width, 1));
    const requestedHeight = Math.max(1, number(height, 1));
    const scale = Math.min(1, IMAGE_EDIT_LIMITS.maxDimension / requestedWidth, IMAGE_EDIT_LIMITS.maxDimension / requestedHeight, Math.sqrt(IMAGE_EDIT_LIMITS.maxPixels / requestedWidth / requestedHeight));
    return { width: Math.max(1, Math.floor(requestedWidth * scale)), height: Math.max(1, Math.floor(requestedHeight * scale)) };
}

export function getTransformedImageDimensions(width, height, rotation = 0) {
    const quarterTurns = ((Math.round(number(rotation, 0) / 90) % 4) + 4) % 4;
    return quarterTurns % 2 ? { width: height, height: width } : { width, height };
}

export function clampImageRect(rect = {}) {
    if (!rect || typeof rect !== 'object') rect = {};
    const width = clamp(number(rect.width, 1), 0.000001, 1);
    const height = clamp(number(rect.height, 1), 0.000001, 1);
    return { x: clamp(number(rect.x, 0), 0, 1 - width), y: clamp(number(rect.y, 0), 0, 1 - height), width, height };
}

export function fitImageCrop(rect, ratio, imageWidth, imageHeight) {
    const value = clampImageRect(rect);
    if (!(ratio > 0) || !Number.isFinite(ratio) || !(imageWidth > 0) || !(imageHeight > 0)) return value;
    const normalizedRatio = ratio * imageHeight / imageWidth;
    let width = value.width;
    let height = value.height;
    if (width / height > normalizedRatio) width = height * normalizedRatio;
    else height = width / normalizedRatio;
    return clampImageRect({ x: value.x + (value.width - width) / 2, y: value.y + (value.height - height) / 2, width, height });
}

export function createImageEditSettings(width, height) {
    return {
        rotation: 0, flipX: false, flipY: false,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        ...limitedDimensions(width, height),
        filter: 'original', brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0,
        regions: [], border: { preset: 'none', width: 12, color: '#ffffff', radius: 24 },
    };
}

export function normalizeImageEditSettings(settings = {}, width, height) {
    if (!settings || typeof settings !== 'object') settings = {};
    const rotation = (((Math.round(number(settings.rotation, 0) / 90) % 4) + 4) % 4) * 90;
    const transformed = getTransformedImageDimensions(width, height, rotation);
    const crop = clampImageRect(settings.crop);
    const border = settings.border || {};
    return {
        rotation, flipX: settings.flipX === true, flipY: settings.flipY === true, crop,
        ...limitedDimensions(number(settings.width, transformed.width * crop.width), number(settings.height, transformed.height * crop.height)),
        filter: IMAGE_FILTER_PRESETS.some(preset => preset.id === settings.filter) ? settings.filter : 'original',
        brightness: clamp(number(settings.brightness, 0), -100, 100),
        contrast: clamp(number(settings.contrast, 0), -100, 100),
        saturation: clamp(number(settings.saturation, 0), -100, 100),
        temperature: clamp(number(settings.temperature, 0), -100, 100),
        vignette: clamp(number(settings.vignette, 0), 0, 100),
        regions: (Array.isArray(settings.regions) ? settings.regions : []).slice(0, IMAGE_EDIT_LIMITS.maxRegions).filter(region => region && typeof region === 'object').map((region, index) => ({
            ...clampImageRect(region), id: typeof region.id === 'string' ? region.id.slice(0, 100) : String(index),
            shape: region.shape === 'ellipse' ? 'ellipse' : 'rectangle', mode: region.mode === 'blur' ? 'blur' : 'mosaic',
            strength: clamp(number(region.strength, 50), 1, 100),
        })),
        border: {
            preset: IMAGE_BORDER_PRESETS.some(preset => preset.id === border.preset) ? border.preset : 'none',
            width: clamp(number(border.width, 12), 0, 512),
            color: typeof border.color === 'string' && /^#[0-9a-f]{6}$/i.test(border.color) ? border.color : '#ffffff',
            radius: clamp(number(border.radius, 24), 0, 2048),
        },
    };
}

export function getImageEditDimensions(settings, width, height) {
    const normalized = normalizeImageEditSettings(settings, width, height);
    return { width: normalized.width, height: normalized.height };
}

function transformRect(rect, operation) {
    const value = clampImageRect(rect);
    if (operation === 'rotate') return { x: 1 - value.y - value.height, y: value.x, width: value.height, height: value.width };
    if (operation === 'flipX') return { ...value, x: 1 - value.x - value.width };
    if (operation === 'flipY') return { ...value, y: 1 - value.y - value.height };
    return value;
}

export function transformImageEditSettings(settings, operation) {
    if (!['rotate', 'flipX', 'flipY'].includes(operation)) return settings;
    const next = {
        ...settings,
        crop: transformRect(settings.crop, operation),
        regions: (settings.regions || []).map(region => ({ ...region, ...transformRect(region, operation) })),
    };
    if (operation === 'rotate') {
        next.rotation = (number(settings.rotation, 0) + 90) % 360;
        next.flipX = settings.flipY === true;
        next.flipY = settings.flipX === true;
        next.width = settings.height;
        next.height = settings.width;
    } else next[operation] = !settings[operation];
    return next;
}
