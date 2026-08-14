import createPica from 'pica';

const comicImageResizer = createPica({
    concurrency: 2,
    features: ['js', 'wasm', 'ww'],
    idle: 10_000,
    tile: 1024,
});

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

export async function paintComicDownsample({
    source,
    canvas,
    target,
    createCanvas,
    cancelToken,
    resizer = comicImageResizer,
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

    if (targetWidth >= sourceWidth || targetHeight >= sourceHeight || !resizer?.resize) return false;

    const canvasFactory = typeof createCanvas === 'function'
        ? createCanvas
        : () => canvas.ownerDocument?.createElement?.('canvas') || null;
    const stagingCanvas = canvasFactory();
    if (!stagingCanvas) return false;

    try {
        stagingCanvas.width = targetWidth;
        stagingCanvas.height = targetHeight;
        let canceled = false;
        let cancellationReason = null;
        cancelToken?.then?.(
            value => {
                canceled = true;
                cancellationReason = value;
            },
            error => {
                canceled = true;
                cancellationReason = error;
            },
        );
        await resizer.init?.();
        if (canceled) {
            if (cancellationReason instanceof Error) throw cancellationReason;
            const error = new Error('Comic image resize canceled.');
            error.name = 'AbortError';
            throw error;
        }
        await resizer.resize(source, stagingCanvas, {
            cancelToken,
            filter: 'lanczos3',
            unsharpAmount: 0,
        });

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext?.('2d');
        if (!context) throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.');
        context.globalCompositeOperation = 'copy';
        context.drawImage(stagingCanvas, 0, 0);
    } finally {
        stagingCanvas.width = 1;
        stagingCanvas.height = 1;
    }

    return true;
}
