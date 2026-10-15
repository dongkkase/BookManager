const bounded = (value, fallback, minimum, maximum) => Number.isFinite(Number(value))
    ? Math.round(Math.max(minimum, Math.min(maximum, Number(value)))) : fallback;

export function defaultSettings() {
    return {
        mode: 'auto',
        images: true,
        fonts: true,
        recompress: true,
        removeUnusedFonts: false,
        removeUnusedImages: false,
        removeUnusedAudio: false,
        jpegQuality: 82,
        maxDimension: 2048,
        excludeCover: true,
        resources: {},
    };
}

const dimension = (value, fallback) => Number(value) === 0 ? 0 : bounded(value, fallback, 256, 8192);

export function normalizeSettings(input = {}) {
    if (!input || typeof input !== 'object') input = {};
    const defaults = defaultSettings();
    const settings = {
        ...defaults,
        mode: input.mode === 'manual' ? 'manual' : 'auto',
        jpegQuality: bounded(input.jpegQuality, defaults.jpegQuality, 40, 100),
        maxDimension: dimension(input.maxDimension, defaults.maxDimension),
        resources: {},
    };
    for (const name of ['images', 'fonts', 'recompress', 'excludeCover', 'removeUnusedFonts', 'removeUnusedImages', 'removeUnusedAudio']) {
        if (typeof input[name] === 'boolean') settings[name] = input[name];
    }
    if (input.resources && typeof input.resources === 'object' && !Array.isArray(input.resources)) {
        for (const [name, value] of Object.entries(input.resources).slice(0, 10000)) {
            if (!name || name.length > 4096 || !value || typeof value !== 'object') continue;
            const override = {};
            if (typeof value.enabled === 'boolean') override.enabled = value.enabled;
            if (typeof value.remove === 'boolean') override.remove = value.remove;
            if (value.quality !== undefined) override.quality = bounded(value.quality, settings.jpegQuality, 40, 100);
            if (value.maxDimension !== undefined) override.maxDimension = dimension(value.maxDimension, settings.maxDimension);
            Object.defineProperty(settings.resources, name, { value: override, enumerable: true, configurable: true });
        }
    }
    return settings;
}

export function resourceRemovalSelected(resource, input) {
    if (resource.canRemove !== true || resource.isCover || resource.encrypted || resource.name.startsWith('META-INF/')) return false;
    const setting = { font: 'removeUnusedFonts', image: 'removeUnusedImages', audio: 'removeUnusedAudio' }[resource.kind];
    if (!setting) return false;
    const settings = input || defaultSettings();
    const override = settings.mode === 'manual' ? settings.resources?.[resource.name]?.remove : undefined;
    return typeof override === 'boolean' ? override : settings[setting] === true;
}

export function resourceSettings(resource, input, analysis = {}) {
    const settings = input || defaultSettings();
    const override = settings.mode === 'manual' ? settings.resources?.[resource.name] || {} : {};
    const categoryEnabled = resource.kind === 'image' ? settings.images : resource.kind === 'font' ? settings.fonts : false;
    return {
        enabled: resource.canOptimize === true && !resourceRemovalSelected(resource, settings) && categoryEnabled !== false
            && override.enabled !== false && !(resource.isCover && settings.excludeCover !== false),
        quality: bounded(override.quality, settings.jpegQuality ?? 82, 40, 100),
        maxDimension: analysis.fixedLayout && settings.mode !== 'manual' ? 0
            : dimension(override.maxDimension, settings.maxDimension ?? 2048),
    };
}

export function estimateOptimization(analysis, input) {
    const settings = normalizeSettings(input);
    const originalSize = Math.max(0, Number(analysis?.size) || 0);
    let possibleSavings = 0;
    let removalSavings = 0;
    for (const resource of analysis?.resources || []) {
        const size = Math.max(0, Number(resource.compressedSize) || 0);
        if (resourceRemovalSelected(resource, settings)) {
            removalSavings += size;
            continue;
        }
        const options = resourceSettings(resource, settings, analysis);
        let reduction = 0;
        if (options.enabled && resource.kind === 'image') {
            const longest = Math.max(resource.width || 0, resource.height || 0);
            const scale = longest > 0 && options.maxDimension > 0 ? Math.min(1, options.maxDimension / longest) : 1;
            if (resource.mediaType === 'image/jpeg') {
                const qualityReduction = Math.min(0.55, Math.max(0, (100 - options.quality) / 90));
                reduction = 1 - scale * scale * (1 - qualityReduction);
            } else if (resource.mediaType === 'image/png') reduction = (1 - scale * scale) * 0.9;
        } else if (options.enabled && resource.kind === 'font') {
            reduction = 0.12;
        }
        if (settings.recompress && !resource.encrypted && resource.kind === 'text' && resource.canRecompress !== false
            && resource.originalSize <= 128 * 1024 * 1024 && size <= 128 * 1024 * 1024) {
            reduction = Math.max(reduction, resource.compressedSize === resource.originalSize ? 0.65 : 0.08);
        }
        possibleSavings += size * Math.min(0.95, Math.max(0, reduction));
    }
    const maxSavedBytes = Math.min(originalSize, Math.round(removalSavings + possibleSavings));
    const savedBytes = Math.min(originalSize, Math.round(removalSavings + possibleSavings / 2));
    return {
        originalSize,
        estimatedSize: originalSize - savedBytes,
        minSize: originalSize - maxSavedBytes,
        maxSize: originalSize,
        savedBytes,
        minSavedBytes: 0,
        maxSavedBytes,
    };
}
