import {
    createPageCurlBackMesh,
    createPageCurlFoldContext,
    createPageCurlFrontCurveMesh,
    createPageCurlFrontMesh,
    createPageCurlFrontSurfaceColors,
    createPageCurlLineIntersections,
    createPageCurlReceiverContactCasterMesh,
    createPageCurlReceiverLightingMesh,
    createPageCurlSurfaceLightingTextures,
    getPageCurlLightingRadiusFactor,
    getPageCurlOrderedLineEndpoints,
    getPageCurlReceiverShadowBlur,
    getPageCurlReceiverShadowOpacity,
    getPageCurlSurfaceLandingProgress,
    mapPageCurlReceiverLowerEdgeCasterPoint,
    pageCurlCurveShadeGradientColors,
    pageCurlCurveShadeGradientPositions,
    pageCurlReceiverShadowIndices,
    pageCurlReceiverShadowSectionCount,
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

function createScalarGradient(context, points, values) {
    const [first, second, third] = points;
    const dx1 = second.x - first.x;
    const dy1 = second.y - first.y;
    const dx2 = third.x - first.x;
    const dy2 = third.y - first.y;
    const determinant = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(determinant) < 0.000001) return null;
    const dv1 = values[1] - values[0];
    const dv2 = values[2] - values[0];
    const x = (dv1 * dy2 - dv2 * dy1) / determinant;
    const y = (dx1 * dv2 - dx2 * dv1) / determinant;
    const squaredLength = x * x + y * y;
    if (squaredLength < 1e-12) return null;
    const start = { x: first.x - x * values[0] / squaredLength, y: first.y - y * values[0] / squaredLength };
    const end = { x: start.x + x / squaredLength, y: start.y + y / squaredLength };
    return { start, end, gradient: context.createLinearGradient(start.x, start.y, end.x, end.y) };
}

function drawFrontSurface(context, mesh, entry, colors) {
    const canvas = context.canvas.ownerDocument.createElement('canvas');
    try {
        canvas.width = entry.image.width || entry.image.naturalWidth;
        canvas.height = entry.image.height || entry.image.naturalHeight;
        const surface = canvas.getContext('2d');
        surface.fillStyle = '#fff';
        surface.fillRect(0, 0, canvas.width, canvas.height);
        const scaleX = canvas.width / entry.frame.width;
        const scaleY = canvas.height / entry.frame.height;
        surface.setTransform(scaleX, 0, 0, scaleY, -entry.frame.x * scaleX, -entry.frame.y * scaleY);
        const channels = colors.map(color => Number(color.match(/\d+/)[0]) / 255);
        // Assemble opaque lighting before multiplying the image so overlapping
        // texture strips cannot apply the same shade twice.
        eachTriangle(mesh, (_first, _second, _third, a, b, c) => {
            const points = [a, b, c].map(index => mesh.textures[index]);
            const field = createScalarGradient(surface, points, [channels[a], channels[b], channels[c]]);
            if (field) {
                field.gradient.addColorStop(0, '#000');
                field.gradient.addColorStop(1, '#fff');
            }
            surface.fillStyle = field?.gradient || colors[a];
            surface.beginPath();
            traceTriangle(surface, ...expandTriangle(points, 0.65 / Math.max(scaleX, scaleY)));
            surface.fill();
        });
        surface.setTransform(1, 0, 0, 1, 0, 0);
        surface.globalCompositeOperation = 'multiply';
        surface.drawImage(entry.image, 0, 0, canvas.width, canvas.height);
        drawTexturedMesh(context, mesh, { ...entry, image: canvas });
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

function drawBackSurfaceLighting(context, mesh, active, back, fold, spread, opacity) {
    const textures = createPageCurlSurfaceLightingTextures(
        mesh.textures, active.frame, back.frame, fold, spread, mesh.vertices,
    );
    let field = null;
    eachTriangle(mesh, (first, second, third, a, b, c) => {
        if (!field) field = createScalarGradient(context, [first, second, third], [textures[a].x, textures[b].x, textures[c].x]);
    });
    if (!field) return;
    drawGradientMesh(
        context, mesh, field.start, field.end,
        pageCurlCurveShadeGradientColors, pageCurlCurveShadeGradientPositions, opacity * 0.92,
    );
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
    const canvas = context.canvas.ownerDocument.createElement('canvas');
    context.save();
    try {
        canvas.width = context.canvas.width;
        canvas.height = context.canvas.height;
        const caster = canvas.getContext('2d');
        const transform = context.getTransform();
        caster.setTransform(transform);
        caster.fillStyle = '#000';
        traceMesh(caster, createPageCurlReceiverContactCasterMesh(lighting, active.frame.width, fold, spread));
        caster.fill();
        traceMesh(caster, { vertices: lighting.receiverShadowVertices, indices: pageCurlReceiverShadowIndices });
        caster.fill();
        if (endpoints) {
            let edgeEnd = endpoints.cornerPoint;
            for (const point of intersections) {
                if (Math.abs(point.y - fold.cornerY) < Math.abs(edgeEnd.y - fold.cornerY)) edgeEnd = point;
            }
            if (Math.abs(edgeEnd.y - fold.cornerY) > 0.5) edgeEnd = endpoints.cornerPoint;
            caster.beginPath();
            for (let index = 0; index <= pageCurlReceiverShadowSectionCount; index += 1) {
                const ratio = index / pageCurlReceiverShadowSectionCount;
                const point = mapCaster({
                    x: fold.cornerX + (edgeEnd.x - fold.cornerX) * ratio,
                    y: fold.cornerY + (edgeEnd.y - fold.cornerY) * ratio,
                });
                if (index === 0) caster.moveTo(point.x, point.y);
                else caster.lineTo(point.x, point.y);
            }
            caster.lineWidth = Math.min(22, Math.max(8, active.frame.width * 0.032)) * opacity;
            caster.lineCap = 'round';
            caster.lineJoin = 'round';
            caster.strokeStyle = '#000';
            caster.stroke();
        }
        const tip = mapCaster({ x: fold.cornerX, y: fold.cornerY });
        caster.beginPath();
        caster.arc(tip.x, tip.y, active.frame.width * 0.026 * visibility, 0, Math.PI * 2);
        caster.fill();
        // Blur the union once, keeping contact, edge and tip shadows from stacking.
        clipFrames(context, receivers);
        const pixelRatio = Math.max(1, Math.hypot(transform.a, transform.b));
        const blur = getPageCurlReceiverShadowBlur(active.frame.width, fold, spread);
        const offset = active.frame.width * 0.008 * visibility;
        const dx = offset * lighting.receiverShadowProjectionDirection.x;
        const dy = offset * lighting.receiverShadowProjectionDirection.y;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha *= opacity * 0.5;
        context.filter = `blur(${blur * pixelRatio}px)`;
        context.drawImage(canvas, transform.a * dx + transform.c * dy, transform.b * dx + transform.d * dy);
    } finally {
        context.restore();
        canvas.width = 0;
        canvas.height = 0;
    }
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
        const lightingOpacity = getPageCurlLightingRadiusFactor(
            fold.arcLength, Math.min(14, Math.max(7, active.frame.width * 0.02)),
        ) * (1 - getPageCurlSurfaceLandingProgress(fold, spread));
        const frontCurve = createPageCurlFrontCurveMesh(active.frame, back.frame, fold, spread);
        drawFrontSurface(context, frontCurve, active, createPageCurlFrontSurfaceColors(
            frontCurve, active.frame, back.frame, fold, spread, lightingOpacity,
        ));
        drawReceiverShadow(context, active, back, [receiver, ...current], fold, lighting, spread, shadowOpacity);
        drawTexturedMesh(context, createPageCurlBackMesh(active.frame, back.frame, fold, spread), back);
        drawBackSurfaceLighting(
            context, createPageCurlBackMesh(active.frame, back.frame, fold, spread, false),
            active, back, fold, spread, lightingOpacity,
        );
    } finally {
        context.restore();
    }
}
