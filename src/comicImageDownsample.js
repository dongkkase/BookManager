function positiveFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function positivePixelDimension(value) {
    const numericValue = positiveFiniteNumber(value);
    return numericValue == null ? null : Math.max(1, Math.floor(numericValue));
}

export function comicDownsampleTarget({
    naturalWidth,
    naturalHeight,
    displayWidth,
    displayHeight,
    devicePixelRatio,
    fitMode = 'contain',
    maxPixelCount = 8_000_000,
} = {}) {
    const sourceWidth = positivePixelDimension(naturalWidth);
    const sourceHeight = positivePixelDimension(naturalHeight);
    const renderedWidth = positiveFiniteNumber(displayWidth);
    const renderedHeight = positiveFiniteNumber(displayHeight);
    const pixelRatio = positiveFiniteNumber(devicePixelRatio);
    const pixelCountLimit = positiveFiniteNumber(maxPixelCount);
    if (
        sourceWidth == null
        || sourceHeight == null
        || renderedWidth == null
        || renderedHeight == null
        || pixelRatio == null
        || pixelCountLimit == null
    ) {
        return null;
    }

    const sourcePixelCount = sourceWidth * sourceHeight;
    if (!Number.isFinite(sourcePixelCount) || pixelCountLimit < 1) return null;

    const widthScale = (renderedWidth * pixelRatio) / sourceWidth;
    const heightScale = (renderedHeight * pixelRatio) / sourceHeight;
    const displayScale = fitMode === 'cover'
        ? Math.max(widthScale, heightScale)
        : Math.min(widthScale, heightScale);
    if (!Number.isFinite(displayScale) || displayScale >= 1) return null;

    const target = {
        width: Math.max(1, Math.ceil(sourceWidth * displayScale)),
        height: Math.max(1, Math.ceil(sourceHeight * displayScale)),
    };
    if (target.width * target.height > pixelCountLimit) return null;
    if (target.width >= sourceWidth || target.height >= sourceHeight) return null;
    return target;
}

export function comicDownsamplePasses({
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    maxPassScale = 0.5,
    maxIntermediatePixelCount = 8_000_000,
} = {}) {
    const initialWidth = positivePixelDimension(sourceWidth);
    const initialHeight = positivePixelDimension(sourceHeight);
    const finalWidth = positivePixelDimension(targetWidth);
    const finalHeight = positivePixelDimension(targetHeight);
    const passScaleLimit = positiveFiniteNumber(maxPassScale);
    const intermediatePixelLimit = positiveFiniteNumber(maxIntermediatePixelCount);
    if (
        initialWidth == null
        || initialHeight == null
        || finalWidth == null
        || finalHeight == null
        || passScaleLimit == null
        || passScaleLimit >= 1
        || intermediatePixelLimit == null
        || finalWidth >= initialWidth
        || finalHeight >= initialHeight
    ) {
        return [];
    }

    const passes = [];
    let currentWidth = initialWidth;
    let currentHeight = initialHeight;
    while (true) {
        const remainingWidthScale = finalWidth / currentWidth;
        const remainingHeightScale = finalHeight / currentHeight;
        if (Math.min(remainingWidthScale, remainingHeightScale) >= passScaleLimit) break;

        let nextWidth = Math.max(finalWidth, Math.floor(currentWidth * passScaleLimit));
        let nextHeight = Math.max(finalHeight, Math.floor(currentHeight * passScaleLimit));
        if (nextWidth * nextHeight > intermediatePixelLimit) {
            const pixelLimitScale = Math.sqrt(intermediatePixelLimit / (currentWidth * currentHeight));
            nextWidth = Math.max(finalWidth, Math.floor(currentWidth * pixelLimitScale));
            nextHeight = Math.max(finalHeight, Math.floor(currentHeight * pixelLimitScale));
        }
        if (
            nextWidth * nextHeight > intermediatePixelLimit
            || (nextWidth >= currentWidth && nextHeight >= currentHeight)
            || (nextWidth === finalWidth && nextHeight === finalHeight)
        ) {
            break;
        }

        passes.push({ width: nextWidth, height: nextHeight });
        currentWidth = nextWidth;
        currentHeight = nextHeight;
    }

    passes.push({ width: finalWidth, height: finalHeight });
    return passes;
}

export function paintComicDownsample({
    source,
    canvas,
    target,
    createCanvas,
    maxIntermediatePixelCount = 8_000_000,
} = {}) {
    const sourceWidth = positivePixelDimension(source?.naturalWidth || source?.width);
    const sourceHeight = positivePixelDimension(source?.naturalHeight || source?.height);
    const targetWidth = positivePixelDimension(target?.width);
    const targetHeight = positivePixelDimension(target?.height);
    if (
        sourceWidth == null
        || sourceHeight == null
        || targetWidth == null
        || targetHeight == null
        || !canvas
    ) {
        return false;
    }

    const passes = comicDownsamplePasses({
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        maxIntermediatePixelCount,
    });
    if (passes.length < 1) return false;

    const canvasFactory = typeof createCanvas === 'function'
        ? createCanvas
        : () => canvas.ownerDocument?.createElement?.('canvas') || null;
    const scratchCanvases = [];
    let input = source;
    let inputWidth = sourceWidth;
    let inputHeight = sourceHeight;

    try {
        passes.forEach((pass, index) => {
            const finalPass = index === passes.length - 1;
            const scratchIndex = index % 2;
            const output = finalPass
                ? canvas
                : (scratchCanvases[scratchIndex] ||= canvasFactory());
            if (!output) throw new Error('Canvas를 생성할 수 없습니다.');

            output.width = pass.width;
            output.height = pass.height;
            const context = output.getContext?.('2d');
            if (!context) throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = finalPass ? 'high' : 'medium';
            context.drawImage(
                input,
                0,
                0,
                inputWidth,
                inputHeight,
                0,
                0,
                pass.width,
                pass.height,
            );
            input = output;
            inputWidth = pass.width;
            inputHeight = pass.height;
        });
    } finally {
        scratchCanvases.forEach(scratch => {
            if (!scratch) return;
            scratch.width = 1;
            scratch.height = 1;
        });
    }

    return true;
}
