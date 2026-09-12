import {
    createPageCurlBackMesh,
    createPageCurlFoldContext,
    createPageCurlFrontCurveMesh,
    createPageCurlFrontMesh,
    createPageCurlLineIntersections,
    createPageCurlReceiverLightingMesh,
    getPageCurlLightingRadiusFactor,
    getPageCurlOrderedLineEndpoints,
    getPageCurlReceiverShadowOnset,
    getPageCurlReceiverShadowOpacity,
    getPageCurlSurfaceLandingProgress,
    getPageCurlTargetShadowOffset,
    mapPageCurlReceiverLowerEdgeCasterPoint,
    pageCurlCurveShadeGradientColors,
    pageCurlCurveShadeGradientPositions,
    pageCurlMovingCreaseReflectionGradientColors,
    pageCurlMovingCreaseReflectionGradientPositions,
    pageCurlMovingCreaseReflectionIndices,
    pageCurlReceiverShadowIndices,
    pageCurlReceiverShadowSectionCount,
    pageCurlStationaryCreaseShadowGradientColors,
    pageCurlStationaryCreaseShadowGradientPositions,
    pageCurlStationaryCreaseShadowIndices,
} from './viewerPageCurlGeometry.js';

const hasPage = entry => entry?.image && entry.frame?.width > 0 && entry.frame?.height > 0;

function drawStaticPage(context, entry) {
    if (!hasPage(entry)) return;
    const { x, y, width, height } = entry.frame;
    context.drawImage(entry.image, x, y, width, height);
}

function eachTriangle(mesh, visit) {
    const { vertices, indices } = mesh;
    const count = indices ? indices.length : vertices.length;
    for (let index = 0; index + 2 < count; index += 3) {
        const a = indices ? indices[index] : index;
        const b = indices ? indices[index + 1] : index + 1;
        const c = indices ? indices[index + 2] : index + 2;
        const first = vertices[a];
        const second = vertices[b];
        const third = vertices[c];
        const area = (second.x - first.x) * (third.y - first.y)
            - (second.y - first.y) * (third.x - first.x);
        if (Math.abs(area) > 0.00001) visit(first, second, third, a, b, c);
    }
}

function traceTriangle(context, first, second, third) {
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
    context.lineTo(third.x, third.y);
    context.closePath();
}

function traceMesh(context, mesh) {
    context.beginPath();
    eachTriangle(mesh, (first, second, third) => traceTriangle(context, first, second, third));
}

function expandTriangle(points, overlap) {
    const center = {
        x: (points[0].x + points[1].x + points[2].x) / 3,
        y: (points[0].y + points[1].y + points[2].y) / 3,
    };
    return points.map(point => {
        const x = point.x - center.x;
        const y = point.y - center.y;
        const length = Math.max(0.001, Math.hypot(x, y));
        return { x: point.x + x * overlap / length, y: point.y + y * overlap / length };
    });
}

function drawTexturedMesh(context, mesh, entry, flat = false) {
    if (!hasPage(entry)) return;
    context.save();
    traceMesh(context, mesh);
    context.fillStyle = '#fff';
    context.fill();
    if (flat) {
        context.clip();
        drawStaticPage(context, entry);
        context.restore();
        return;
    }
    const imageWidth = entry.image.width || entry.image.naturalWidth || 1;
    const imageHeight = entry.image.height || entry.image.naturalHeight || 1;
    const sourceScaleX = imageWidth / entry.frame.width;
    const sourceScaleY = imageHeight / entry.frame.height;
    const transform = context.getTransform();
    const pixelRatio = Math.max(1, Math.hypot(transform.a, transform.b));
    const overlap = 0.65 / pixelRatio;
    eachTriangle(mesh, (first, second, third, a, b, c) => {
        const source = [a, b, c].map(index => ({
            x: (mesh.textures[index].x - entry.frame.x) * sourceScaleX,
            y: (mesh.textures[index].y - entry.frame.y) * sourceScaleY,
        }));
        const sourceX1 = source[1].x - source[0].x;
        const sourceY1 = source[1].y - source[0].y;
        const sourceX2 = source[2].x - source[0].x;
        const sourceY2 = source[2].y - source[0].y;
        const determinant = sourceX1 * sourceY2 - sourceY1 * sourceX2;
        if (Math.abs(determinant) < 0.000001) return;
        const destinationX1 = second.x - first.x;
        const destinationY1 = second.y - first.y;
        const destinationX2 = third.x - first.x;
        const destinationY2 = third.y - first.y;
        const xx = (destinationX1 * sourceY2 - destinationX2 * sourceY1) / determinant;
        const xy = (destinationY1 * sourceY2 - destinationY2 * sourceY1) / determinant;
        const yx = (destinationX2 * sourceX1 - destinationX1 * sourceX2) / determinant;
        const yy = (destinationY2 * sourceX1 - destinationY1 * sourceX2) / determinant;
        context.save();
        context.beginPath();
        traceTriangle(context, ...expandTriangle([first, second, third], overlap));
        context.clip();
        context.transform(
            xx, xy, yx, yy,
            first.x - xx * source[0].x - yx * source[0].y,
            first.y - xy * source[0].x - yy * source[0].y,
        );
        context.drawImage(entry.image, 0, 0);
        context.restore();
    });
    context.restore();
}

function drawGradientMesh(context, mesh, start, end, colors, stops, opacity) {
    if (opacity <= 0 || !start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 0.0001) return;
    context.save();
    context.globalAlpha *= opacity;
    const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
    colors.forEach((color, index) => gradient.addColorStop(stops[index], color));
    context.fillStyle = gradient;
    traceMesh(context, mesh);
    context.fill();
    context.restore();
}

function clipFrames(context, entries) {
    context.beginPath();
    entries.forEach(entry => {
        if (!hasPage(entry)) return;
        const { x, y, width, height } = entry.frame;
        context.rect(x, y, width, height);
    });
    context.clip();
}

function drawReceiverShadow(context, active, back, receivers, fold, lighting, spread, opacity) {
    if (opacity <= 0) return;
    const visibility = lighting.receiverShadowVisibility;
    const landingProgress = getPageCurlSurfaceLandingProgress(fold, spread);
    const mapCaster = source => mapPageCurlReceiverLowerEdgeCasterPoint(
        source, active.frame, back.frame, fold, landingProgress, spread, visibility,
    );
    const intersections = createPageCurlLineIntersections(active.frame, fold);
    const endpoints = getPageCurlOrderedLineEndpoints(intersections, fold);
    const onset = getPageCurlReceiverShadowOnset(fold.progress);
    context.save();
    clipFrames(context, receivers);
    context.globalAlpha *= opacity;
    const transform = context.getTransform();
    const pixelRatio = Math.max(1, Math.hypot(transform.a, transform.b));
    const blur = active.frame.width * 0.037 * (0.45 + 0.55 * onset);
    context.filter = `blur(${blur * pixelRatio}px)`;
    context.translate(
        active.frame.width * 0.008 * visibility * lighting.receiverShadowProjectionDirection.x,
        active.frame.width * 0.008 * visibility * lighting.receiverShadowProjectionDirection.y,
    );
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    traceMesh(context, { vertices: lighting.receiverShadowVertices, indices: pageCurlReceiverShadowIndices });
    context.fill();
    if (endpoints) {
        let edgeEnd = endpoints.cornerPoint;
        for (const point of intersections) {
            if (Math.abs(point.y - fold.cornerY) < Math.abs(edgeEnd.y - fold.cornerY)) edgeEnd = point;
        }
        context.beginPath();
        for (let index = 0; index <= pageCurlReceiverShadowSectionCount; index += 1) {
            const ratio = index / pageCurlReceiverShadowSectionCount;
            const point = mapCaster({
                x: fold.cornerX + (edgeEnd.x - fold.cornerX) * ratio,
                y: fold.cornerY + (edgeEnd.y - fold.cornerY) * ratio,
            });
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        }
        context.lineWidth = Math.min(22, Math.max(8, active.frame.width * 0.032)) * opacity;
        context.lineCap = 'round';
        context.strokeStyle = context.fillStyle;
        context.stroke();
    }
    const tip = mapCaster({ x: fold.cornerX, y: fold.cornerY });
    context.beginPath();
    context.arc(tip.x, tip.y, active.frame.width * 0.026 * visibility, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

/** Draws a complete curl scene in book-space CSS pixels. Entries are in visual order. */
export function drawPageCurlFrame(context, {
    current = [], target = [], side = 'right', progress = 0,
    width, height, spread = true, touchY = height * 0.86, corner = 'bottom',
}) {
    const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    context.save();
    try {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        if (normalizedProgress === 0 || !target.some(hasPage)) {
            current.forEach(entry => drawStaticPage(context, entry));
            return;
        }
        if (normalizedProgress === 1 || !current.some(hasPage)) {
            target.forEach(entry => drawStaticPage(context, entry));
            return;
        }
        const activeIndex = side === 'left' ? 0 : current.length - 1;
        const targetActiveIndex = side === 'left' ? 0 : target.length - 1;
        const active = current[activeIndex];
        const receiver = target[targetActiveIndex];
        const back = spread ? target[side === 'left' ? target.length - 1 : 0] : active;
        if (!hasPage(active) || !hasPage(receiver) || !hasPage(back)) {
            target.forEach(entry => drawStaticPage(context, entry));
            return;
        }
        const fold = createPageCurlFoldContext({
            frame: active.frame,
            progress: normalizedProgress,
            sideSign: side === 'left' ? -1 : 1,
            cornerSide: corner === 'top' ? -1 : 1,
            touchY,
            landsOnTargetFrame: spread,
        });
        drawStaticPage(context, receiver);
        current.forEach((entry, index) => {
            if (index !== activeIndex) drawStaticPage(context, entry);
        });
        if (spread && normalizedProgress >= 0.98) {
            drawStaticPage(context, back);
            return;
        }
        const lighting = createPageCurlReceiverLightingMesh(active.frame, back.frame, fold, spread);
        const shadowOpacity = getPageCurlReceiverShadowOpacity(fold, spread);
        const front = createPageCurlFrontMesh(active.frame, fold, spread);
        drawTexturedMesh(context, front, active, true);
        const shadowVertices = lighting.stationaryCreaseShadowVertices;
        const shadowOffset = Math.floor(pageCurlReceiverShadowSectionCount / 2) * 5;
        context.save();
        clipFrames(context, [active]);
        drawGradientMesh(
            context, { vertices: shadowVertices, indices: pageCurlStationaryCreaseShadowIndices },
            shadowVertices[shadowOffset], shadowVertices[shadowOffset + 4],
            pageCurlStationaryCreaseShadowGradientColors, pageCurlStationaryCreaseShadowGradientPositions,
            shadowOpacity,
        );
        context.restore();
        drawReceiverShadow(context, active, back, [receiver, ...current], fold, lighting, spread, shadowOpacity);
        drawTexturedMesh(context, createPageCurlFrontCurveMesh(active.frame, back.frame, fold, spread), active);
        drawTexturedMesh(context, createPageCurlBackMesh(active.frame, back.frame, fold, spread), back);
        const lightingOpacity = getPageCurlLightingRadiusFactor(
            fold.arcLength, Math.min(14, Math.max(7, active.frame.width * 0.02)),
        ) * (1 - getPageCurlSurfaceLandingProgress(fold, spread));
        const radius = getPageCurlTargetShadowOffset(fold.arcLength);
        drawGradientMesh(
            context, createPageCurlBackMesh(active.frame, back.frame, fold, spread, false),
            { x: fold.midpointX, y: fold.midpointY },
            { x: fold.midpointX - fold.normalX * radius, y: fold.midpointY - fold.normalY * radius },
            pageCurlCurveShadeGradientColors, pageCurlCurveShadeGradientPositions, lightingOpacity * 0.92,
        );
        const reflectionVertices = lighting.movingCreaseReflectionVertices;
        const reflectionOffset = Math.floor(pageCurlReceiverShadowSectionCount / 2) * 3;
        drawGradientMesh(
            context, { vertices: reflectionVertices, indices: pageCurlMovingCreaseReflectionIndices },
            reflectionVertices[reflectionOffset], reflectionVertices[reflectionOffset + 2],
            pageCurlMovingCreaseReflectionGradientColors, pageCurlMovingCreaseReflectionGradientPositions,
            lightingOpacity,
        );
    } finally {
        context.restore();
    }
}
