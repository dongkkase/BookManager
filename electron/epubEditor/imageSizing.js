export const IMAGE_MAX_WIDTH_PX = 8192;

export function imageWidthUnit(attrs) {
    return attrs.widthUnit === 'px' ? 'px' : '%';
}

export function imageWidthMaximum(unit) {
    return unit === 'px' ? IMAGE_MAX_WIDTH_PX : 100;
}

export function clampImageWidth(width, unit) {
    return Math.max(1, Math.min(imageWidthMaximum(unit), Number(width) || 100));
}

export function imageWidthCss(attrs) {
    const unit = imageWidthUnit(attrs);
    return `${clampImageWidth(attrs.width, unit)}${unit}`;
}

export function convertImageWidth(attrs, widthUnit, containerWidth) {
    let width = attrs.width;
    if (imageWidthUnit(attrs) !== widthUnit && containerWidth > 0) {
        width = widthUnit === 'px' ? width / 100 * containerWidth : width / containerWidth * 100;
    }
    return { width: clampImageWidth(Math.round(width * 100) / 100, widthUnit), widthUnit };
}
