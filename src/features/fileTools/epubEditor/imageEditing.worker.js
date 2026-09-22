import { IMAGE_EDIT_LIMITS, IMAGE_FILTER_PRESETS, getTransformedImageDimensions, normalizeImageEditSettings } from './imageEditing.shared.js';

let source = null;
let queue = Promise.resolve();

function canvas(width, height) {
    return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function release(surface) {
    if (!surface) return;
    surface.width = 1;
    surface.height = 1;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function applyColor(surface, settings) {
    const preset = IMAGE_FILTER_PRESETS.find(item => item.id === settings.filter) || {};
    const brightness = clamp(settings.brightness + (preset.brightness || 0), -100, 100) * 2.55;
    const contrast = 2 ** (clamp(settings.contrast + (preset.contrast || 0), -100, 100) / 50);
    const saturation = clamp(settings.saturation + (preset.saturation || 0), -100, 100) / 100 + 1;
    const temperature = clamp(settings.temperature + (preset.temperature || 0), -100, 100) * 0.5;
    const tint = preset.tint || 0;
    const vignette = clamp(settings.vignette + (preset.vignette || 0), 0, 100) / 100;
    if (!brightness && contrast === 1 && saturation === 1 && !temperature && !tint && !vignette) return;
    const context = surface.getContext('2d', { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, surface.width, surface.height);
    const data = pixels.data;
    const horizontal = vignette ? new Float32Array(surface.width) : null;
    if (horizontal) for (let x = 0; x < surface.width; x++) horizontal[x] = ((x + 0.5) / surface.width - 0.5) ** 2 * 2;
    for (let y = 0; y < surface.height; y++) {
        const vertical = vignette ? ((y + 0.5) / surface.height - 0.5) ** 2 * 2 : 0;
        for (let x = 0; x < surface.width; x++) {
            const i = (y * surface.width + x) * 4;
            if (!data[i + 3]) continue;
            const red = (data[i] - 127.5) * contrast + 127.5 + brightness + temperature + tint * 0.3;
            const green = (data[i + 1] - 127.5) * contrast + 127.5 + brightness - tint * 0.6;
            const blue = (data[i + 2] - 127.5) * contrast + 127.5 + brightness - temperature + tint * 0.3;
            const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
            const shade = vignette ? 1 - (horizontal[x] + vertical) ** 1.4 * vignette * 0.85 : 1;
            data[i] = (luminance + (red - luminance) * saturation) * shade;
            data[i + 1] = (luminance + (green - luminance) * saturation) * shade;
            data[i + 2] = (luminance + (blue - luminance) * saturation) * shade;
        }
    }
    context.putImageData(pixels, 0, 0);
}

function applyRegions(surface, regions) {
    const context = surface.getContext('2d');
    for (const region of regions) {
        const x = region.x * surface.width;
        const y = region.y * surface.height;
        const width = region.width * surface.width;
        const height = region.height * surface.height;
        const strength = region.strength / 100;
        let temporary;
        context.save();
        try {
            context.beginPath();
            if (region.shape === 'ellipse') context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
            else context.rect(x, y, width, height);
            context.clip();
            if (region.mode === 'blur') {
                const radius = Math.max(0.5, Math.min(surface.width, surface.height) * (0.001 + strength * 0.035));
                const margin = Math.ceil(radius * 3);
                const left = Math.max(0, Math.floor(x) - margin);
                const top = Math.max(0, Math.floor(y) - margin);
                const right = Math.min(surface.width, Math.ceil(x + width) + margin);
                const bottom = Math.min(surface.height, Math.ceil(y + height) + margin);
                temporary = canvas(right - left, bottom - top);
                temporary.getContext('2d').drawImage(surface, left, top, temporary.width, temporary.height, 0, 0, temporary.width, temporary.height);
                context.clearRect(x, y, width, height);
                context.filter = `blur(${radius}px)`;
                context.drawImage(temporary, left, top);
            } else {
                const block = Math.max(2, Math.min(surface.width, surface.height) * (0.002 + strength * strength * 0.09));
                temporary = canvas(Math.ceil(width / block), Math.ceil(height / block));
                const small = temporary.getContext('2d');
                small.imageSmoothingEnabled = true;
                small.imageSmoothingQuality = 'high';
                small.drawImage(surface, x, y, width, height, 0, 0, temporary.width, temporary.height);
                context.clearRect(x, y, width, height);
                context.imageSmoothingEnabled = false;
                context.drawImage(temporary, 0, 0, temporary.width, temporary.height, x, y, width, height);
            }
        } finally {
            context.restore();
            release(temporary);
        }
    }
}

function roundedPath(context, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

function roughPath(context, width, height, thickness) {
    const inset = Math.min(thickness, width / 3, height / 3);
    const amplitude = inset * 0.45;
    const steps = 80;
    const noise = index => (Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1;
    context.beginPath();
    for (let i = 0; i <= steps; i++) {
        const x = inset + (width - 2 * inset) * i / steps;
        const y = inset + noise(i) * amplitude;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    for (let i = 0; i <= steps; i++) context.lineTo(width - inset + noise(i + steps) * amplitude, inset + (height - 2 * inset) * i / steps);
    for (let i = 0; i <= steps; i++) context.lineTo(width - inset - (width - 2 * inset) * i / steps, height - inset + noise(i + 2 * steps) * amplitude);
    for (let i = 0; i <= steps; i++) context.lineTo(inset + noise(i + 3 * steps) * amplitude, height - inset - (height - 2 * inset) * i / steps);
    context.closePath();
}

function addBorder(image, border, scale) {
    if (border.preset === 'none') return image;
    const result = canvas(image.width, image.height);
    const context = result.getContext('2d');
    const width = result.width;
    const height = result.height;
    const thickness = Math.min(Math.max(1, border.width * scale), Math.min(width, height) / 3);
    const radius = border.radius * scale;
    context.imageSmoothingQuality = 'high';
    if (border.preset === 'white') {
        context.fillStyle = border.color;
        context.fillRect(0, 0, width, height);
        context.drawImage(image, thickness, thickness, width - thickness * 2, height - thickness * 2);
    } else if (border.preset === 'rounded') {
        roundedPath(context, 0, 0, width, height, radius);
        context.clip();
        context.drawImage(image, 0, 0);
    } else if (border.preset === 'shadow') {
        const inset = Math.min(thickness * 1.5, Math.min(width, height) / 4);
        context.shadowColor = '#00000099';
        context.shadowBlur = thickness;
        context.shadowOffsetY = thickness * 0.35;
        context.fillStyle = '#ffffff';
        context.fillRect(inset, inset, width - inset * 2, height - inset * 2);
        context.shadowColor = 'transparent';
        context.drawImage(image, inset, inset, width - inset * 2, height - inset * 2);
    } else if (border.preset.startsWith('rough-')) {
        context.fillStyle = border.preset === 'rough-dark' ? '#111111' : '#ffffff';
        context.fillRect(0, 0, width, height);
        roughPath(context, width, height, thickness);
        context.clip();
        context.drawImage(image, 0, 0);
    } else {
        context.drawImage(image, 0, 0);
        context.strokeStyle = border.color;
        context.lineWidth = border.preset === 'double' ? thickness / 3 : thickness;
        const lineInset = context.lineWidth / 2;
        context.strokeRect(lineInset, lineInset, width - context.lineWidth, height - context.lineWidth);
        if (border.preset === 'double') context.strokeRect(thickness, thickness, width - thickness * 2, height - thickness * 2);
    }
    return result;
}

async function render(settings, options = {}) {
    if (!source) throw Object.assign(new Error('Image is not loaded'), { code: 'IMAGE_EDIT_CLOSED' });
    const value = normalizeImageEditSettings(settings, source.width, source.height);
    const dimensions = getTransformedImageDimensions(source.width, source.height, value.rotation);
    const cropPreview = options.cropPreview === true;
    const requestedMax = Number(options.maxDimension);
    const maximum = Number.isFinite(requestedMax) && requestedMax > 0 ? Math.min(IMAGE_EDIT_LIMITS.maxDimension, requestedMax) : cropPreview ? IMAGE_EDIT_LIMITS.previewDimension : IMAGE_EDIT_LIMITS.maxDimension;
    const outputWidth = cropPreview ? dimensions.width : value.width;
    const outputHeight = cropPreview ? dimensions.height : value.height;
    const outputScale = Math.min(1, maximum / outputWidth, maximum / outputHeight);
    const width = Math.max(1, Math.round(outputWidth * outputScale));
    const height = Math.max(1, Math.round(outputHeight * outputScale));
    const workScale = cropPreview ? outputScale : Math.min(1, Math.max(width / (dimensions.width * value.crop.width), height / (dimensions.height * value.crop.height)));
    const transformed = canvas(dimensions.width * workScale, dimensions.height * workScale);
    let cropped;
    let output;
    try {
        const context = transformed.getContext('2d', { willReadFrequently: true });
        context.save();
        context.translate(transformed.width / 2, transformed.height / 2);
        context.scale(transformed.width / dimensions.width * (value.flipX ? -1 : 1), transformed.height / dimensions.height * (value.flipY ? -1 : 1));
        context.rotate(value.rotation * Math.PI / 180);
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, -source.width / 2, -source.height / 2);
        context.restore();
        applyColor(transformed, value);
        applyRegions(transformed, value.regions);
        if (cropPreview) output = transformed;
        else {
            cropped = canvas(width, height);
            const croppedContext = cropped.getContext('2d');
            croppedContext.imageSmoothingQuality = 'high';
            croppedContext.drawImage(transformed, value.crop.x * transformed.width, value.crop.y * transformed.height, value.crop.width * transformed.width, value.crop.height * transformed.height, 0, 0, width, height);
            output = addBorder(cropped, value.border, outputScale);
        }
        const blob = await output.convertToBlob({ type: 'image/png' });
        return { blob, width: output.width, height: output.height };
    } finally {
        if (output !== transformed && output !== cropped) release(output);
        release(cropped);
        release(transformed);
    }
}

self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            let result;
            if (data.type === 'init') {
                if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw Object.assign(new Error('Image editing requires OffscreenCanvas'), { code: 'IMAGE_EDIT_UNSUPPORTED' });
                source?.close();
                source = await createImageBitmap(data.blob);
                if (source.width > IMAGE_EDIT_LIMITS.maxDimension || source.height > IMAGE_EDIT_LIMITS.maxDimension || source.width * source.height > IMAGE_EDIT_LIMITS.maxPixels) {
                    source.close();
                    source = null;
                    throw Object.assign(new Error('Image dimensions exceed editing limits'), { code: 'IMAGE_EDIT_TOO_LARGE' });
                }
                result = { width: source.width, height: source.height };
            } else if (data.type === 'render') result = await render(data.settings, data.options);
            else throw new Error('Unknown image editing request');
            self.postMessage({ id: data.id, result });
        } catch (error) {
            self.postMessage({ id: data.id, error: { code: error.code || 'IMAGE_EDIT_RENDER', message: error.message } });
        }
    });
};
