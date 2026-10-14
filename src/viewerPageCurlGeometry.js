// Fold, curved texture meshes and lighting adapted from Readive PageCurlView.
// Coordinates are CSS pixels; desktop uses the original high quality mesh.
const pageCurlPolygonMeshVertexCount = 9;
const pageCurlMaximumArcWidthRatio = 0.28;
const pageCurlArcDistanceRatio = 0.82;
const pageCurlSurfaceArcRatio = 0.8;
const pageCurlSurfaceHeightProjectionRatio = 0.3;
const pageCurlFrontSurfaceShadeStrength = 0.22;
const pageCurlHighQualityBackCurveStripCount = 10;
const pageCurlHighQualityBackFlatStripCount = 2;
const pageCurlBackCurveStripCount = pageCurlHighQualityBackCurveStripCount;
const pageCurlBackFlatStripCount = pageCurlHighQualityBackFlatStripCount;
const pageCurlBackStripCount = pageCurlBackCurveStripCount + pageCurlBackFlatStripCount;
const pageCurlHighQualityLongitudinalSectionCount = 4;
const pageCurlLongitudinalSectionCount = pageCurlHighQualityLongitudinalSectionCount;
const pageCurlExpandedBackStripVertexCount = (pageCurlLongitudinalSectionCount * 6) + 6;
const pageCurlBackStripVertexCount = pageCurlExpandedBackStripVertexCount;
const pageCurlBackMeshVertexCount = pageCurlBackStripCount * pageCurlBackStripVertexCount;
const pageCurlHighQualityReceiverSilhouetteSectionCount = 9;
const pageCurlReceiverShadowSectionCount = pageCurlHighQualityReceiverSilhouetteSectionCount;
const pageCurlReceiverShadowBandCount = 4;
const pageCurlReceiverShadowVertexCount = (pageCurlReceiverShadowSectionCount + 1)
    * (pageCurlReceiverShadowBandCount + 1);
const pageCurlReceiverShadowIndexCount = pageCurlReceiverShadowSectionCount
    * pageCurlReceiverShadowBandCount
    * 6;
const pageCurlStationaryCreaseShadowBandCount = 4;
const pageCurlStationaryCreaseShadowVertexCount = (pageCurlReceiverShadowSectionCount + 1)
    * (pageCurlStationaryCreaseShadowBandCount + 1);
const pageCurlStationaryCreaseShadowIndexCount = pageCurlReceiverShadowSectionCount
    * pageCurlStationaryCreaseShadowBandCount
    * 6;
const pageCurlMovingCreaseReflectionBandCount = 2;
const pageCurlMovingCreaseReflectionVertexCount = (pageCurlReceiverShadowSectionCount + 1)
    * (pageCurlMovingCreaseReflectionBandCount + 1);
const pageCurlMovingCreaseReflectionIndexCount = pageCurlReceiverShadowSectionCount
    * pageCurlMovingCreaseReflectionBandCount
    * 6;
const createPageCurlGridTriangleIndices = (sectionCount, bandCount, indexCount) => {
    const columnCount = bandCount + 1;
    const indices = new Array(indexCount);
    let indexOffset = 0;
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionOffset = sectionIndex * columnCount;
        const nextSectionOffset = (sectionIndex + 1) * columnCount;
        for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
            const startIndex = sectionOffset + bandIndex;
            const endIndex = nextSectionOffset + bandIndex;
            indices[indexOffset] = startIndex;
            indices[indexOffset + 1] = endIndex;
            indices[indexOffset + 2] = startIndex + 1;
            indices[indexOffset + 3] = endIndex;
            indices[indexOffset + 4] = endIndex + 1;
            indices[indexOffset + 5] = startIndex + 1;
            indexOffset += 6;
        }
    }
    return indices;
};
const pageCurlReceiverShadowIndices = createPageCurlGridTriangleIndices(pageCurlReceiverShadowSectionCount, pageCurlReceiverShadowBandCount, pageCurlReceiverShadowIndexCount);
const pageCurlStationaryCreaseShadowIndices = createPageCurlGridTriangleIndices(pageCurlReceiverShadowSectionCount, pageCurlStationaryCreaseShadowBandCount, pageCurlStationaryCreaseShadowIndexCount);
const pageCurlMovingCreaseReflectionIndices = createPageCurlGridTriangleIndices(pageCurlReceiverShadowSectionCount, pageCurlMovingCreaseReflectionBandCount, pageCurlMovingCreaseReflectionIndexCount);
const pageCurlSurfaceSeamOverlap = 0.75;
const pageCurlStripSeamOverlap = 1;
const pageCurlLandingStartProgress = 0.82;
const pageCurlFinishLandingStartProgress = 0.82;
const pageCurlFinishLandingEndProgress = 0.98;
const pageCurlReceiverShadowPositions = [
    0,
    0.1,
    0.34,
    0.68,
    1,
];
const pageCurlReceiverCastDirectionX = 0.6401843996644799;
const pageCurlReceiverCastDirectionY = 0.7682212795973759;
const pageCurlReceiverShadowBlurRatio = 0.037;
const pageCurlReceiverShadowOffsetRatio = 0.008;
const pageCurlReceiverShadowCasterInsetRatio = 0.055;
const pageCurlReceiverShadowHingeTaperRatio = 0.18;
const pageCurlReceiverShadowTipTaperRatio = 0.18;
const pageCurlReceiverLowerEdgeOffsetRatio = 0.015;
const pageCurlReceiverShadowFadeInProgress = 0.12;
const pageCurlReceiverShadowFadeOutStartProgress = 0.86;
const pageCurlMovingCreaseReflectionOverlap = 0;
const pageCurlMovingCreaseReflectionFadeStartRatio = 0;
const pageCurlMovingCreaseReflectionFadeEndRatio = 0.12;
const pageCurlStationaryCreaseShadowDepthPositions = [0, 0.006, 0.018, 0.038, 0.068];
const pageCurlMovingCreaseReflectionDepthPositions = [0, 0.008, 0.024];
const pageCurlStationaryCreaseShadowGradientColors = [
    'rgba(0, 0, 0, 0.42)',
    'rgba(0, 0, 0, 0.32)',
    'rgba(0, 0, 0, 0.2)',
    'rgba(0, 0, 0, 0.08)',
    'rgba(0, 0, 0, 0)',
];
const pageCurlStationaryCreaseShadowGradientPositions = [
    0,
    0.0882352941,
    0.2647058824,
    0.5588235294,
    1,
];
const pageCurlMovingCreaseReflectionGradientColors = [
    'rgba(255, 255, 255, 0)',
    'rgba(255, 255, 255, 0.36)',
    'rgba(255, 255, 255, 0)',
];
const pageCurlMovingCreaseReflectionGradientPositions = [0, 1 / 3, 1];
const pageCurlCurveShadeGradientColors = [
    'rgba(0, 0, 0, 0.28)',
    'rgba(0, 0, 0, 0.25)',
    'rgba(0, 0, 0, 0.17)',
    'rgba(0, 0, 0, 0.065)',
    'rgba(255, 255, 255, 0)',
    'rgba(255, 255, 255, 0.045)',
    'rgba(255, 255, 255, 0.10)',
    'rgba(255, 255, 255, 0.04)',
    'rgba(255, 255, 255, 0.01)',
    'rgba(255, 255, 255, 0)',
];
const pageCurlCurveShadeGradientPositions = [0, 0.08, 0.18, 0.30, 0.42, 0.56, 0.68, 0.82, 0.93, 1];
const pageCurlFrontSurfaceGrayColors = Array.from({ length: 256 }, (_, channel) => `rgb(${channel}, ${channel}, ${channel})`);
const clampWorklet = (value, minimum, maximum) => {
    return Math.max(minimum, Math.min(maximum, value));
};
const smoothStepWorklet = (value) => {
    return value * value * (3 - (2 * value));
};
const smootherStepWorklet = (value) => {
    return value * value * value * ((value * ((value * 6) - 15)) + 10);
};
const getPageCurlFinishLandingGeometryCurve = (value) => {
    const smootherProgress = smootherStepWorklet(clampWorklet(value, 0, 1));
    return 1 - Math.pow(1 - smootherProgress, 4);
};
const getPageCurlFinishLandingCurve = (value) => {
    const smootherProgress = smootherStepWorklet(clampWorklet(value, 0, 1));
    return smootherProgress * smootherProgress;
};
const getPageCurlReceiverShadowOnset = (progress) => {
    return smoothStepWorklet(clampWorklet(progress / pageCurlReceiverShadowFadeInProgress, 0, 1));
};
const getPageCurlReceiverShadowTerminalVisibility = (progress) => {
    return 1 - smoothStepWorklet(clampWorklet((progress - pageCurlReceiverShadowFadeOutStartProgress)
        / (1 - pageCurlReceiverShadowFadeOutStartProgress), 0, 1));
};
const createPageCurlFoldContext = ({ cornerSide, frame, landsOnTargetFrame = false, progress, sideSign, touchY, }) => {
    const normalizedProgress = clampWorklet(progress, 0, 1);
    const finishLandingRatio = landsOnTargetFrame
        ? clampWorklet((normalizedProgress - pageCurlFinishLandingStartProgress)
            / (pageCurlFinishLandingEndProgress
                - pageCurlFinishLandingStartProgress), 0, 1)
        : 0;
    const finishLandingProgress = getPageCurlFinishLandingGeometryCurve(finishLandingRatio);
    const geometryProgress = landsOnTargetFrame
        && finishLandingProgress > 0
        ? normalizedProgress
            + ((1 - normalizedProgress)
                * finishLandingProgress)
        : normalizedProgress;
    const cornerX = sideSign > 0 ? frame.x + frame.width : frame.x;
    const cornerY = cornerSide < 0 ? frame.y : frame.y + frame.height;
    const clampedTouchY = clampWorklet(touchY, frame.y, frame.y + frame.height);
    const verticalEngagement = smoothStepWorklet(clampWorklet(geometryProgress * 6, 0, 1));
    const verticalEnvelope = Math.sin(Math.PI * geometryProgress);
    const dragX = cornerX - (sideSign * frame.width * 2 * geometryProgress);
    const horizontalTravel = Math.abs(dragX - cornerX);
    const maximumVerticalTravel = Math.min(frame.height * 0.28, horizontalTravel * 0.55);
    const desiredVerticalTravel = (clampedTouchY - cornerY)
        * verticalEngagement
        * verticalEnvelope;
    const dragY = cornerY + clampWorklet(desiredVerticalTravel, -maximumVerticalTravel, maximumVerticalTravel);
    const deltaX = dragX - cornerX;
    const deltaY = dragY - cornerY;
    const distance = Math.max(0.001, Math.sqrt((deltaX * deltaX) + (deltaY * deltaY)));
    const dragNormalX = deltaX / distance;
    const dragNormalY = deltaY / distance;
    const curlEnvelope = Math.pow(Math.sin(Math.PI * geometryProgress), 0.65);
    const arcLength = Math.min(frame.width * pageCurlMaximumArcWidthRatio, distance * pageCurlArcDistanceRatio) * curlEnvelope;
    // Include the projected cylinder height when solving the fold direction,
    // so the raised back plane still meets the finger at the held corner.
    const projectedBackHeight = 2 * arcLength * pageCurlSurfaceArcRatio
        * pageCurlSurfaceHeightProjectionRatio / Math.PI;
    const planeDistance = Math.sqrt(Math.max(0, distance * distance - projectedBackHeight * projectedBackHeight));
    const hingeDirectionY = cornerY < frame.y + frame.height / 2 ? 1 : -1;
    const tangentSign = dragNormalX * hingeDirectionY >= 0 ? 1 : -1;
    const normalX = (dragNormalX * planeDistance + dragNormalY * tangentSign * projectedBackHeight) / distance;
    const normalY = (dragNormalY * planeDistance - dragNormalX * tangentSign * projectedBackHeight) / distance;
    const sourceDepth = (planeDistance + arcLength) / 2;
    return {
        arcLength,
        cornerX,
        cornerY,
        dragX,
        dragY,
        foldDepth: sourceDepth,
        midpointX: cornerX + (normalX * sourceDepth),
        midpointY: cornerY + (normalY * sourceDepth),
        normalX,
        normalY,
        progress: normalizedProgress,
    };
};
const getPageCurlFoldDistance = (point, fold) => {
    return ((point.x - fold.midpointX) * fold.normalX)
        + ((point.y - fold.midpointY) * fold.normalY);
};
const clipPageCurlPolygonByDistance = (polygon, fold, threshold, distanceSign) => {
    if (polygon.length === 0) {
        return [];
    }
    const clipped = [];
    let previous = polygon[polygon.length - 1];
    let previousDistance = (getPageCurlFoldDistance(previous, fold) - threshold) * distanceSign;
    let previousInside = previousDistance <= 0.01;
    for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const currentDistance = (getPageCurlFoldDistance(current, fold) - threshold) * distanceSign;
        const currentInside = currentDistance <= 0.01;
        if (currentInside !== previousInside) {
            const denominator = previousDistance - currentDistance;
            const ratio = Math.abs(denominator) <= 0.0001
                ? 0
                : clampWorklet(previousDistance / denominator, 0, 1);
            clipped.push({
                x: previous.x + ((current.x - previous.x) * ratio),
                y: previous.y + ((current.y - previous.y) * ratio),
            });
        }
        if (currentInside) {
            clipped.push(current);
        }
        previous = current;
        previousDistance = currentDistance;
        previousInside = currentInside;
    }
    return clipped;
};
const clipPageCurlFrameByFold = (frame, fold, distanceSign, distanceThreshold = 0) => {
    if (fold.progress <= 0.0001 && distanceSign > 0) {
        return [];
    }
    const rectangle = [
        { x: frame.x, y: frame.y },
        { x: frame.x + frame.width, y: frame.y },
        { x: frame.x + frame.width, y: frame.y + frame.height },
        { x: frame.x, y: frame.y + frame.height },
    ];
    return clipPageCurlPolygonByDistance(rectangle, fold, distanceThreshold, distanceSign);
};
const clipPageCurlFrameToStationarySide = (frame, fold, seamOverlap = 0) => {
    return clipPageCurlFrameByFold(frame, fold, -1, -Math.max(0, seamOverlap));
};
const getPageCurlLongitudinalRatio = (section) => {
    // Spend the existing vertex budget near the narrow curl endpoints.
    return (1 - Math.cos(Math.PI * section / pageCurlLongitudinalSectionCount)) / 2;
};
const createPageCurlStripTopology = (inputPolygon, fold) => {
    const polygon = [];
    for (let index = 0; index < inputPolygon.length; index += 1) {
        const point = inputPolygon[index];
        const previous = polygon[polygon.length - 1];
        if (previous
            && ((point.x - previous.x) ** 2) + ((point.y - previous.y) ** 2) <= 0.0001) {
            continue;
        }
        polygon.push(point);
    }
    if (polygon.length > 1) {
        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        if (((first.x - last.x) ** 2) + ((first.y - last.y) ** 2) <= 0.0001) {
            polygon.pop();
        }
    }
    if (polygon.length < 3) {
        return {
            points: polygon,
            triangleIndices: [],
        };
    }
    const longitudinalEdges = [];
    for (let index = 0; index < polygon.length; index += 1) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        if (Math.abs(getPageCurlFoldDistance(current, fold)
            - getPageCurlFoldDistance(next, fold)) <= 0.5) {
            longitudinalEdges.push({
                endIndex: (index + 1) % polygon.length,
                startIndex: index,
            });
        }
    }
    if (polygon.length === 4
        && longitudinalEdges.length === 2
        && longitudinalEdges[0].startIndex !== longitudinalEdges[1].startIndex
        && longitudinalEdges[0].startIndex !== longitudinalEdges[1].endIndex
        && longitudinalEdges[0].endIndex !== longitudinalEdges[1].startIndex
        && longitudinalEdges[0].endIndex !== longitudinalEdges[1].endIndex) {
        const firstEdge = longitudinalEdges[0];
        const secondEdge = longitudinalEdges[1];
        const firstStart = polygon[firstEdge.startIndex];
        const firstEnd = polygon[firstEdge.endIndex];
        let secondStart = polygon[secondEdge.startIndex];
        let secondEnd = polygon[secondEdge.endIndex];
        const alignedDistance = ((firstStart.x - secondStart.x) ** 2)
            + ((firstStart.y - secondStart.y) ** 2)
            + ((firstEnd.x - secondEnd.x) ** 2)
            + ((firstEnd.y - secondEnd.y) ** 2);
        const crossedDistance = ((firstStart.x - secondEnd.x) ** 2)
            + ((firstStart.y - secondEnd.y) ** 2)
            + ((firstEnd.x - secondStart.x) ** 2)
            + ((firstEnd.y - secondStart.y) ** 2);
        if (crossedDistance < alignedDistance) {
            const swap = secondStart;
            secondStart = secondEnd;
            secondEnd = swap;
        }
        const points = [];
        const triangleIndices = [];
        for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
            const ratio = getPageCurlLongitudinalRatio(section);
            points.push({
                x: firstStart.x + ((firstEnd.x - firstStart.x) * ratio),
                y: firstStart.y + ((firstEnd.y - firstStart.y) * ratio),
            });
        }
        const secondEdgeStartIndex = points.length;
        for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
            const ratio = getPageCurlLongitudinalRatio(section);
            points.push({
                x: secondStart.x + ((secondEnd.x - secondStart.x) * ratio),
                y: secondStart.y + ((secondEnd.y - secondStart.y) * ratio),
            });
        }
        for (let section = 0; section < pageCurlLongitudinalSectionCount; section += 1) {
            const firstIndex = section;
            const nextFirstIndex = section + 1;
            const secondIndex = secondEdgeStartIndex + section;
            const nextSecondIndex = secondIndex + 1;
            triangleIndices.push(firstIndex, secondIndex, nextSecondIndex, firstIndex, nextSecondIndex, nextFirstIndex);
        }
        return { points, triangleIndices };
    }
    if (polygon.length === 3 && longitudinalEdges.length === 1) {
        const edge = longitudinalEdges[0];
        const oppositeIndex = 3 - edge.startIndex - edge.endIndex;
        if (oppositeIndex >= 0 && oppositeIndex < polygon.length) {
            const edgeStart = polygon[edge.startIndex];
            const edgeEnd = polygon[edge.endIndex];
            const points = [];
            const triangleIndices = [];
            for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
                const ratio = getPageCurlLongitudinalRatio(section);
                points.push({
                    x: edgeStart.x + ((edgeEnd.x - edgeStart.x) * ratio),
                    y: edgeStart.y + ((edgeEnd.y - edgeStart.y) * ratio),
                });
            }
            const oppositePointIndex = points.length;
            points.push(polygon[oppositeIndex]);
            for (let section = 0; section < pageCurlLongitudinalSectionCount; section += 1) {
                triangleIndices.push(section, oppositePointIndex, section + 1);
            }
            return { points, triangleIndices };
        }
    }
    if (longitudinalEdges.length >= 2) {
        let firstRailEdgeIndex = -1;
        let secondRailEdgeIndex = -1;
        let maximumRailLength = -1;
        for (let firstEdgeIndex = 0; firstEdgeIndex < longitudinalEdges.length - 1; firstEdgeIndex += 1) {
            const firstEdge = longitudinalEdges[firstEdgeIndex];
            const firstStart = polygon[firstEdge.startIndex];
            const firstEnd = polygon[firstEdge.endIndex];
            const firstLength = ((firstEnd.x - firstStart.x) ** 2)
                + ((firstEnd.y - firstStart.y) ** 2);
            if (firstLength <= 0.0001) {
                continue;
            }
            for (let secondEdgeIndex = firstEdgeIndex + 1; secondEdgeIndex < longitudinalEdges.length; secondEdgeIndex += 1) {
                const secondEdge = longitudinalEdges[secondEdgeIndex];
                if (firstEdge.startIndex === secondEdge.startIndex
                    || firstEdge.startIndex === secondEdge.endIndex
                    || firstEdge.endIndex === secondEdge.startIndex
                    || firstEdge.endIndex === secondEdge.endIndex) {
                    continue;
                }
                const secondStart = polygon[secondEdge.startIndex];
                const secondEnd = polygon[secondEdge.endIndex];
                const secondLength = ((secondEnd.x - secondStart.x) ** 2)
                    + ((secondEnd.y - secondStart.y) ** 2);
                const railDistance = Math.abs(getPageCurlFoldDistance(firstStart, fold)
                    - getPageCurlFoldDistance(secondStart, fold));
                if (secondLength <= 0.0001 || railDistance <= 0.001) {
                    continue;
                }
                const combinedLength = firstLength + secondLength;
                if (combinedLength > maximumRailLength) {
                    firstRailEdgeIndex = firstEdgeIndex;
                    secondRailEdgeIndex = secondEdgeIndex;
                    maximumRailLength = combinedLength;
                }
            }
        }
        if (firstRailEdgeIndex >= 0 && secondRailEdgeIndex >= 0) {
            const firstEdge = longitudinalEdges[firstRailEdgeIndex];
            const secondEdge = longitudinalEdges[secondRailEdgeIndex];
            const firstStart = polygon[firstEdge.startIndex];
            const firstEnd = polygon[firstEdge.endIndex];
            const secondStart = polygon[secondEdge.endIndex];
            const secondEnd = polygon[secondEdge.startIndex];
            const points = [];
            const triangleIndices = [];
            for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
                const ratio = getPageCurlLongitudinalRatio(section);
                points.push({
                    x: firstStart.x + ((firstEnd.x - firstStart.x) * ratio),
                    y: firstStart.y + ((firstEnd.y - firstStart.y) * ratio),
                });
            }
            const secondRailStartIndex = points.length;
            for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
                const ratio = getPageCurlLongitudinalRatio(section);
                points.push({
                    x: secondStart.x + ((secondEnd.x - secondStart.x) * ratio),
                    y: secondStart.y + ((secondEnd.y - secondStart.y) * ratio),
                });
            }
            for (let section = 0; section < pageCurlLongitudinalSectionCount; section += 1) {
                const firstIndex = section;
                const nextFirstIndex = section + 1;
                const secondIndex = secondRailStartIndex + section;
                const nextSecondIndex = secondIndex + 1;
                triangleIndices.push(firstIndex, secondIndex, nextSecondIndex, firstIndex, nextSecondIndex, nextFirstIndex);
            }
            const capPolygonStartIndices = [
                firstEdge.endIndex,
                secondEdge.endIndex,
            ];
            const capPolygonEndIndices = [
                secondEdge.startIndex,
                firstEdge.startIndex,
            ];
            const capPointStartIndices = [
                pageCurlLongitudinalSectionCount,
                secondRailStartIndex,
            ];
            const capPointEndIndices = [
                secondRailStartIndex + pageCurlLongitudinalSectionCount,
                0,
            ];
            for (let capIndex = 0; capIndex < 2; capIndex += 1) {
                const capPointIndices = [capPointStartIndices[capIndex]];
                let polygonIndex = (capPolygonStartIndices[capIndex] + 1) % polygon.length;
                let traversedPointCount = 0;
                while (polygonIndex !== capPolygonEndIndices[capIndex]
                    && traversedPointCount < polygon.length) {
                    capPointIndices.push(points.length);
                    points.push(polygon[polygonIndex]);
                    polygonIndex = (polygonIndex + 1) % polygon.length;
                    traversedPointCount += 1;
                }
                capPointIndices.push(capPointEndIndices[capIndex]);
                for (let pointIndex = 1; pointIndex < capPointIndices.length - 1; pointIndex += 1) {
                    triangleIndices.push(capPointIndices[0], capPointIndices[pointIndex], capPointIndices[pointIndex + 1]);
                }
            }
            let polygonTwiceArea = 0;
            for (let index = 0; index < polygon.length; index += 1) {
                const current = polygon[index];
                const next = polygon[(index + 1) % polygon.length];
                polygonTwiceArea += (current.x * next.y) - (current.y * next.x);
            }
            for (let index = 0; index < triangleIndices.length; index += 3) {
                const first = points[triangleIndices[index]];
                const second = points[triangleIndices[index + 1]];
                const third = points[triangleIndices[index + 2]];
                const triangleTwiceArea = ((second.x - first.x) * (third.y - first.y))
                    - ((second.y - first.y) * (third.x - first.x));
                if (triangleTwiceArea * polygonTwiceArea < 0) {
                    const swap = triangleIndices[index + 1];
                    triangleIndices[index + 1] = triangleIndices[index + 2];
                    triangleIndices[index + 2] = swap;
                }
            }
            return { points, triangleIndices };
        }
    }
    if (longitudinalEdges.length > 0) {
        const selectedEdges = [];
        let longestEdgeIndex = -1;
        let secondLongestEdgeIndex = -1;
        let longestEdgeLength = -1;
        let secondLongestEdgeLength = -1;
        for (let index = 0; index < longitudinalEdges.length; index += 1) {
            const edge = longitudinalEdges[index];
            const start = polygon[edge.startIndex];
            const end = polygon[edge.endIndex];
            const edgeLength = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
            if (edgeLength > longestEdgeLength) {
                secondLongestEdgeIndex = longestEdgeIndex;
                secondLongestEdgeLength = longestEdgeLength;
                longestEdgeIndex = index;
                longestEdgeLength = edgeLength;
            }
            else if (edgeLength > secondLongestEdgeLength) {
                secondLongestEdgeIndex = index;
                secondLongestEdgeLength = edgeLength;
            }
        }
        if (longestEdgeIndex >= 0) {
            selectedEdges.push(longitudinalEdges[longestEdgeIndex]);
        }
        if (secondLongestEdgeIndex >= 0) {
            selectedEdges.push(longitudinalEdges[secondLongestEdgeIndex]);
        }
        let fanStartIndex = -1;
        for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
            let touchesSelectedEdge = false;
            for (let edgeIndex = 0; edgeIndex < selectedEdges.length; edgeIndex += 1) {
                const edge = selectedEdges[edgeIndex];
                if (edge.startIndex === polygonIndex || edge.endIndex === polygonIndex) {
                    touchesSelectedEdge = true;
                    break;
                }
            }
            if (!touchesSelectedEdge) {
                fanStartIndex = polygonIndex;
                break;
            }
        }
        if (fanStartIndex >= 0) {
            const points = [];
            for (let offset = 0; offset < polygon.length; offset += 1) {
                const currentIndex = (fanStartIndex + offset) % polygon.length;
                const nextIndex = (currentIndex + 1) % polygon.length;
                const current = polygon[currentIndex];
                const next = polygon[nextIndex];
                let subdividesEdge = false;
                points.push(current);
                for (let edgeIndex = 0; edgeIndex < selectedEdges.length; edgeIndex += 1) {
                    const edge = selectedEdges[edgeIndex];
                    if (edge.startIndex === currentIndex && edge.endIndex === nextIndex) {
                        subdividesEdge = true;
                        break;
                    }
                }
                if (!subdividesEdge) {
                    continue;
                }
                for (let section = 1; section < pageCurlLongitudinalSectionCount; section += 1) {
                    const ratio = getPageCurlLongitudinalRatio(section);
                    points.push({
                        x: current.x + ((next.x - current.x) * ratio),
                        y: current.y + ((next.y - current.y) * ratio),
                    });
                }
            }
            const triangleIndices = [];
            for (let index = 1; index < points.length - 1; index += 1) {
                triangleIndices.push(0, index, index + 1);
            }
            return { points, triangleIndices };
        }
    }
    const triangleIndices = [];
    for (let index = 1; index < polygon.length - 1; index += 1) {
        triangleIndices.push(0, index, index + 1);
    }
    return {
        points: polygon,
        triangleIndices,
    };
};
const padPageCurlMesh = (vertices, textures, vertexAnchor, textureAnchor, vertexCount = pageCurlPolygonMeshVertexCount) => {
    while (vertices.length < vertexCount) {
        vertices.push(vertexAnchor);
        textures.push(textureAnchor);
    }
    return { textures, vertices };
};
const createPageCurlFlatMesh = (frame) => {
    const topLeft = { x: frame.x, y: frame.y };
    const topRight = { x: frame.x + frame.width, y: frame.y };
    const bottomRight = {
        x: frame.x + frame.width,
        y: frame.y + frame.height,
    };
    const bottomLeft = { x: frame.x, y: frame.y + frame.height };
    return padPageCurlMesh([topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft], [topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft], topLeft, topLeft);
};
const createPageCurlLandedMesh = (frame) => {
    const anchor = { x: frame.x, y: frame.y };
    const vertices = [];
    const textures = [];
    for (let stripIndex = 0; stripIndex < pageCurlBackStripCount; stripIndex += 1) {
        const nearX = frame.x + (frame.width * stripIndex / pageCurlBackStripCount);
        const farX = frame.x + (frame.width * (stripIndex + 1) / pageCurlBackStripCount);
        for (let section = 0; section < pageCurlLongitudinalSectionCount; section += 1) {
            const topY = frame.y
                + (frame.height * section / pageCurlLongitudinalSectionCount);
            const bottomY = frame.y
                + (frame.height * (section + 1) / pageCurlLongitudinalSectionCount);
            const topLeft = { x: nearX, y: topY };
            const topRight = { x: farX, y: topY };
            const bottomRight = { x: farX, y: bottomY };
            const bottomLeft = { x: nearX, y: bottomY };
            vertices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
            textures.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
        }
    }
    return padPageCurlMesh(vertices, textures, anchor, anchor, pageCurlBackMeshVertexCount);
};
const createPageCurlEmptyPolygonMesh = (anchor) => {
    return padPageCurlMesh([], [], anchor, anchor);
};
const createPageCurlEmptyCurveMesh = (vertexAnchor, textureAnchor) => {
    const mesh = padPageCurlMesh([], [], vertexAnchor, textureAnchor, pageCurlBackMeshVertexCount);
    return mesh;
};
const getPageCurlSurfaceSeamOverlap = (arcLength) => {
    const normalizedArcLength = Math.max(0, arcLength);
    const radius = normalizedArcLength / Math.PI;
    if (radius <= 0.001) {
        return 0;
    }
    const maximumScreenOverlap = radius * (1 - Math.cos(Math.PI / 4));
    const screenOverlap = Math.min(pageCurlSurfaceSeamOverlap, maximumScreenOverlap);
    return radius * Math.acos(clampWorklet(1 - (screenOverlap / radius), 0, 1));
};
const createPageCurlFrontMesh = (frame, fold, landsOnTargetFrame = false) => {
    if (fold.progress <= 0.0001) {
        return createPageCurlFlatMesh(frame);
    }
    if ((landsOnTargetFrame && fold.progress >= pageCurlFinishLandingEndProgress)
        || fold.progress >= 0.9999) {
        return createPageCurlEmptyPolygonMesh({
            x: fold.cornerX,
            y: fold.cornerY,
        });
    }
    const polygon = clipPageCurlFrameToStationarySide(frame, fold, getPageCurlSurfaceSeamOverlap(fold.arcLength));
    const anchor = polygon[0] ?? { x: fold.cornerX, y: fold.cornerY };
    const vertices = [];
    const textures = [];
    for (let index = 1; index < polygon.length - 1; index += 1) {
        vertices.push(polygon[0], polygon[index], polygon[index + 1]);
        textures.push(polygon[0], polygon[index], polygon[index + 1]);
    }
    return padPageCurlMesh(vertices, textures, anchor, anchor);
};
const getPageCurlLocalArcLength = (_point, _frame, fold) => {
    // One cylinder keeps the edge and the printed surface on the same smooth roll.
    return Math.max(0, fold.arcLength) * pageCurlSurfaceArcRatio;
};
const mapPageCurlCurvedPoint = (point, activeFrame, fold) => {
    const depth = Math.max(0, -getPageCurlFoldDistance(point, fold));
    const arcLength = getPageCurlLocalArcLength(point, activeFrame, fold);
    // Center the circular interval on the shared front/back crease.
    const sourceDepth = Math.max(0, depth - (fold.arcLength - arcLength) / 2);
    const radius = arcLength / Math.PI;
    const projectedDepth = arcLength <= 0
        ? sourceDepth
        : sourceDepth < arcLength
            ? -radius * Math.sin(Math.PI * sourceDepth / arcLength)
            : sourceDepth - arcLength;
    const displacement = sourceDepth + projectedDepth;
    // The half-cylinder rises monotonically into one flat back plane. Fading
    // this height back to zero inside the roll would introduce an inward dent.
    const heightProgress = arcLength > 0
        ? clampWorklet(sourceDepth / arcLength, 0, 1)
        : 0;
    const elevation = radius * (1 - Math.cos(Math.PI * heightProgress));
    const hingeDirectionY = fold.cornerY < activeFrame.y + activeFrame.height / 2 ? 1 : -1;
    const tangentSign = fold.normalX * hingeDirectionY >= 0 ? 1 : -1;
    const projectedLift = elevation * pageCurlSurfaceHeightProjectionRatio;
    return {
        x: point.x + (fold.normalX * displacement) - fold.normalY * tangentSign * projectedLift,
        y: point.y + (fold.normalY * displacement) + fold.normalX * tangentSign * projectedLift,
    };
};
const getPageCurlLandingProgress = (fold, landsOnTargetFrame) => {
    return landsOnTargetFrame
        ? smoothStepWorklet(clampWorklet((fold.progress - pageCurlLandingStartProgress)
            / (1 - pageCurlLandingStartProgress), 0, 1))
        : 0;
};
const getPageCurlFinishLandingProgress = (fold, landsOnTargetFrame) => {
    return landsOnTargetFrame
        ? getPageCurlFinishLandingCurve(clampWorklet((fold.progress - pageCurlFinishLandingStartProgress)
            / (pageCurlFinishLandingEndProgress
                - pageCurlFinishLandingStartProgress), 0, 1))
        : 0;
};
const getPageCurlSurfaceLandingProgress = (fold, landsOnTargetFrame) => {
    const landingProgress = getPageCurlLandingProgress(fold, landsOnTargetFrame);
    const finishLandingProgress = getPageCurlFinishLandingProgress(fold, landsOnTargetFrame);
    return landingProgress + ((1 - landingProgress) * finishLandingProgress);
};
const getPageCurlReceiverShadowOpacity = (fold, landsOnTargetFrame) => {
    const landingVisibility = 1 - getPageCurlSurfaceLandingProgress(fold, landsOnTargetFrame);
    const terminalVisibility = getPageCurlReceiverShadowTerminalVisibility(fold.progress);
    return getPageCurlReceiverShadowOnset(fold.progress)
        * Math.min(landingVisibility, terminalVisibility);
};
const getPageCurlSurfaceElevation = (sourceDepth, arcLength) => {
    const normalizedArcLength = Math.max(0, arcLength);
    if (normalizedArcLength <= 0.001) {
        return 0;
    }
    const radius = normalizedArcLength / Math.PI;
    const normalizedDepth = Math.max(0, sourceDepth);
    if (normalizedDepth >= normalizedArcLength) {
        return radius * 2;
    }
    return radius * (1 - Math.cos(Math.PI * normalizedDepth / normalizedArcLength));
};
const projectPageCurlReceiverPoint = (vertex, projectionDistance, projectionDirection, projectionScale) => {
    const projectedDistance = Math.max(0, projectionDistance)
        * Math.max(0, projectionScale);
    return {
        x: vertex.x + (projectionDirection.x * projectedDistance),
        y: vertex.y + (projectionDirection.y * projectedDistance),
    };
};
const mapPageCurlBackPoint = (sourcePoint, activeFrame, backFrame, fold, landingProgress, reverseTextureX) => {
    const normalizedX = clampWorklet((sourcePoint.x - activeFrame.x) / Math.max(1, activeFrame.width), 0, 1);
    const normalizedY = clampWorklet((sourcePoint.y - activeFrame.y) / Math.max(1, activeFrame.height), 0, 1);
    const textureX = reverseTextureX ? 1 - normalizedX : normalizedX;
    const texturePoint = {
        x: backFrame.x + (textureX * backFrame.width),
        y: backFrame.y + (normalizedY * backFrame.height),
    };
    const curvedPoint = mapPageCurlCurvedPoint(sourcePoint, activeFrame, fold);
    const vertex = {
        x: curvedPoint.x + ((texturePoint.x - curvedPoint.x) * landingProgress),
        y: curvedPoint.y + ((texturePoint.y - curvedPoint.y) * landingProgress),
    };
    if (landingProgress > 0 && landingProgress < 1) {
        // A mirrored or differently sized target rotates the crease as it lands.
        // Keep the lifted paper on that same line throughout the interpolation.
        const tangentX = -fold.normalY;
        const tangentY = fold.normalX;
        const landedTangentX = tangentX * backFrame.width / Math.max(1, activeFrame.width)
            * (reverseTextureX ? -1 : 1);
        const landedTangentY = tangentY * backFrame.height / Math.max(1, activeFrame.height);
        const renderedTangentX = tangentX + (landedTangentX - tangentX) * landingProgress;
        const renderedTangentY = tangentY + (landedTangentY - tangentY) * landingProgress;
        const renderedTangentLength = Math.hypot(renderedTangentX, renderedTangentY);
        if (renderedTangentLength > 0.0001) {
            const projectedLift = ((curvedPoint.x - sourcePoint.x) * tangentX)
                + ((curvedPoint.y - sourcePoint.y) * tangentY);
            const remainingLift = projectedLift * (1 - landingProgress);
            vertex.x += (renderedTangentX / renderedTangentLength - tangentX) * remainingLift;
            vertex.y += (renderedTangentY / renderedTangentLength - tangentY) * remainingLift;
        }
    }
    return {
        texture: texturePoint,
        vertex,
    };
};
const normalizePageCurlDirection = (x, y, fallback) => {
    const length = Math.hypot(x, y);
    if (length <= 0.0001) {
        const fallbackLength = Math.max(0.0001, Math.hypot(fallback.x, fallback.y));
        return {
            x: fallback.x / fallbackLength,
            y: fallback.y / fallbackLength,
        };
    }
    return {
        x: x / length,
        y: y / length,
    };
};
const getPageCurlReceiverOutwardNormal = (boundaryVertex, interiorVertex, fallbackDirection) => {
    return normalizePageCurlDirection(boundaryVertex.x - interiorVertex.x, boundaryVertex.y - interiorVertex.y, fallbackDirection);
};
const mapPageCurlReceiverLowerEdgeCasterPoint = (sourcePoint, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame, shadowVisibility) => {
    const verticalInteriorDirection = fold.cornerY <= activeFrame.y + (activeFrame.height / 2)
        ? 1
        : -1;
    const interiorSampleDistance = Math.max(2, Math.min(activeFrame.width, activeFrame.height) * 0.012);
    const mappedBoundary = mapPageCurlBackPoint(sourcePoint, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
    const mappedInterior = mapPageCurlBackPoint({
        x: sourcePoint.x,
        y: sourcePoint.y + (verticalInteriorDirection * interiorSampleDistance),
    }, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
    const receiverNormal = getPageCurlReceiverOutwardNormal(mappedBoundary, mappedInterior, {
        x: -fold.normalX,
        y: -fold.normalY,
    });
    const localOffset = activeFrame.width
        * pageCurlReceiverLowerEdgeOffsetRatio
        * shadowVisibility;
    const globalOffset = activeFrame.width
        * pageCurlReceiverShadowOffsetRatio
        * shadowVisibility;
    return {
        x: mappedBoundary.x
            + (receiverNormal.x * localOffset)
            - (pageCurlReceiverCastDirectionX * globalOffset),
        y: mappedBoundary.y
            + (receiverNormal.y * localOffset)
            - (pageCurlReceiverCastDirectionY * globalOffset),
    };
};
const stabilizePageCurlDirection = (direction, referenceDirection) => {
    const normalizedReference = normalizePageCurlDirection(referenceDirection.x, referenceDirection.y, { x: 1, y: 0 });
    const normalizedDirection = normalizePageCurlDirection(direction.x, direction.y, normalizedReference);
    const alignment = (normalizedDirection.x * normalizedReference.x)
        + (normalizedDirection.y * normalizedReference.y);
    if (alignment <= 0.35) {
        return normalizedReference;
    }
    const localNormalWeight = smoothStepWorklet(clampWorklet((alignment - 0.35) / 0.65, 0, 1)) * 0.5;
    return normalizePageCurlDirection(normalizedReference.x
        + ((normalizedDirection.x - normalizedReference.x) * localNormalWeight), normalizedReference.y
        + ((normalizedDirection.y - normalizedReference.y) * localNormalWeight), normalizedReference);
};
const getPageCurlBackStripDepthRange = (stripIndex, minimumBackDepth, maximumBackCurveDepth, maximumDepth, creaseDepth = minimumBackDepth) => {
    if (stripIndex < pageCurlBackCurveStripCount) {
        const curveDepth = maximumBackCurveDepth - minimumBackDepth;
        if (curveDepth <= 0.001) {
            return null;
        }
        // Both paper faces and their lighting need the same explicit crease rail.
        if (creaseDepth > minimumBackDepth && creaseDepth < maximumBackCurveDepth) {
            if (stripIndex === 0) {
                return { nearDepth: minimumBackDepth, farDepth: creaseDepth };
            }
            const remainingDepth = maximumBackCurveDepth - creaseDepth;
            const remainingStrips = pageCurlBackCurveStripCount - 1;
            return {
                nearDepth: creaseDepth
                    + (remainingDepth * (stripIndex - 1) / remainingStrips),
                farDepth: creaseDepth + (remainingDepth * stripIndex / remainingStrips),
            };
        }
        return {
            nearDepth: minimumBackDepth
                + (curveDepth * stripIndex / pageCurlBackCurveStripCount),
            farDepth: minimumBackDepth
                + (curveDepth * (stripIndex + 1) / pageCurlBackCurveStripCount),
        };
    }
    const flatStripIndex = stripIndex - pageCurlBackCurveStripCount;
    const flatDepth = maximumDepth - maximumBackCurveDepth;
    if (flatDepth <= 0.001) {
        return null;
    }
    return {
        nearDepth: maximumBackCurveDepth
            + (flatDepth * flatStripIndex / pageCurlBackFlatStripCount),
        farDepth: maximumBackCurveDepth
            + (flatDepth * (flatStripIndex + 1) / pageCurlBackFlatStripCount),
    };
};
const getPageCurlStripOverlap = (arcLength) => {
    return Math.min(pageCurlStripSeamOverlap, Math.max(0, arcLength) / Math.max(1, pageCurlBackStripCount));
};
const expandPageCurlStripDepthRange = (depthRange, overlap, minimumDepth, maximumDepth) => {
    const stripDepth = Math.max(0, depthRange.farDepth - depthRange.nearDepth);
    const boundedOverlap = Math.min(Math.max(0, overlap), stripDepth * 0.25);
    return {
        farDepth: Math.min(maximumDepth, depthRange.farDepth + boundedOverlap),
        nearDepth: Math.max(minimumDepth, depthRange.nearDepth - boundedOverlap),
    };
};
const createPageCurlBackMesh = (activeFrame, backFrame, fold, landsOnTargetFrame, overlapStripSeams = true) => {
    const finishLandingProgress = getPageCurlFinishLandingProgress(fold, landsOnTargetFrame);
    const sourceAnchor = { x: fold.cornerX, y: fold.cornerY };
    if (finishLandingProgress >= 1) {
        return createPageCurlLandedMesh(backFrame);
    }
    if ((landsOnTargetFrame && fold.progress >= pageCurlFinishLandingEndProgress)
        || fold.progress >= 0.9999) {
        return createPageCurlEmptyCurveMesh(sourceAnchor, sourceAnchor);
    }
    const rectangle = [
        { x: activeFrame.x, y: activeFrame.y },
        { x: activeFrame.x + activeFrame.width, y: activeFrame.y },
        { x: activeFrame.x + activeFrame.width, y: activeFrame.y + activeFrame.height },
        { x: activeFrame.x, y: activeFrame.y + activeFrame.height },
    ];
    let maximumDepth = 0;
    let maximumStationaryDistance = 0;
    for (let index = 0; index < rectangle.length; index += 1) {
        const foldDistance = getPageCurlFoldDistance(rectangle[index], fold);
        maximumDepth = Math.max(maximumDepth, -foldDistance);
        maximumStationaryDistance = Math.max(maximumStationaryDistance, foldDistance);
    }
    const landingProgress = getPageCurlSurfaceLandingProgress(fold, landsOnTargetFrame);
    const indices = null;
    const vertices = [];
    const textures = [];
    // Opaque images need seam coverage, but transparent lighting must start at
    // the crest so the folded overlap does not composite the shade twice.
    const seamOverlap = overlapStripSeams
        ? getPageCurlSurfaceSeamOverlap(fold.arcLength)
        : 0;
    const stripOverlap = overlapStripSeams
        ? getPageCurlStripOverlap(fold.arcLength)
        : 0;
    const baseMinimumBackDepth = Math.min(maximumDepth, Math.max(0, (fold.arcLength / 2) - seamOverlap));
    const fullFrameMinimumBackDepth = -maximumStationaryDistance;
    const minimumBackDepth = baseMinimumBackDepth
        + ((fullFrameMinimumBackDepth - baseMinimumBackDepth)
            * finishLandingProgress);
    const maximumBackCurveDepth = Math.min(maximumDepth, fold.arcLength);
    if (maximumDepth - minimumBackDepth > 0.001 && fold.progress > 0.0001) {
        for (let stripIndex = 0; stripIndex < pageCurlBackStripCount; stripIndex += 1) {
            const depthRange = getPageCurlBackStripDepthRange(stripIndex, minimumBackDepth, maximumBackCurveDepth, maximumDepth, fold.arcLength / 2);
            if (!depthRange) {
                continue;
            }
            const expandedDepthRange = expandPageCurlStripDepthRange(depthRange, stripOverlap, minimumBackDepth, maximumDepth);
            const creaseDepth = fold.arcLength / 2;
            const nearDepth = Math.abs(depthRange.nearDepth - creaseDepth) < 0.0001
                ? creaseDepth
                : expandedDepthRange.nearDepth;
            const farDepth = Math.abs(depthRange.farDepth - creaseDepth) < 0.0001
                ? creaseDepth
                : expandedDepthRange.farDepth;
            let polygon = clipPageCurlPolygonByDistance(rectangle, fold, -nearDepth, 1);
            polygon = clipPageCurlPolygonByDistance(polygon, fold, -farDepth, -1);
            const topology = createPageCurlStripTopology(polygon, fold);
            if (indices) {
                if (topology.triangleIndices.length === 0) {
                    continue;
                }
                const vertexOffset = vertices.length;
                for (let index = 0; index < topology.points.length; index += 1) {
                    const mappedPoint = mapPageCurlBackPoint(topology.points[index], activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame);
                    vertices.push(mappedPoint.vertex);
                    textures.push(mappedPoint.texture);
                }
                for (let index = 0; index < topology.triangleIndices.length; index += 1) {
                    indices.push(vertexOffset + topology.triangleIndices[index]);
                }
                continue;
            }
            const mappedPolygon = [];
            for (let index = 0; index < topology.points.length; index += 1) {
                mappedPolygon.push(mapPageCurlBackPoint(topology.points[index], activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame));
            }
            for (let index = 0; index < topology.triangleIndices.length; index += 3) {
                const firstIndex = topology.triangleIndices[index];
                const secondIndex = topology.triangleIndices[index + 1];
                const thirdIndex = topology.triangleIndices[index + 2];
                vertices.push(mappedPolygon[firstIndex].vertex, mappedPolygon[secondIndex].vertex, mappedPolygon[thirdIndex].vertex);
                textures.push(mappedPolygon[firstIndex].texture, mappedPolygon[secondIndex].texture, mappedPolygon[thirdIndex].texture);
            }
        }
    }
    const mappedAnchor = mapPageCurlBackPoint(sourceAnchor, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame);
    const paddedMesh = padPageCurlMesh(vertices, textures, mappedAnchor.vertex, mappedAnchor.texture, pageCurlBackMeshVertexCount);
    if (!indices) {
        return paddedMesh;
    }
    return {
        indices,
        textures: paddedMesh.textures,
        vertices: paddedMesh.vertices,
    };
};
const mapPageCurlFrontCurvePoint = (sourcePoint, activeFrame, backFrame, fold, landingProgress, landingJoinDepth, landsOnTargetFrame) => {
    if (landingProgress <= 0) {
        return mapPageCurlCurvedPoint(sourcePoint, activeFrame, fold);
    }
    const sourceDepth = Math.max(0, -getPageCurlFoldDistance(sourcePoint, fold));
    const landingDepthRatio = landingJoinDepth > 0
        ? clampWorklet(sourceDepth / landingJoinDepth, 0, 1)
        : 0;
    const localLandingProgress = landingProgress
        * smoothStepWorklet(landingDepthRatio);
    return mapPageCurlBackPoint(sourcePoint, activeFrame, backFrame, fold, localLandingProgress, landsOnTargetFrame).vertex;
};
const createPageCurlFrontCurveMesh = (activeFrame, backFrame, fold, landsOnTargetFrame) => {
    const anchor = { x: fold.midpointX, y: fold.midpointY };
    if (fold.progress >= 0.9999) {
        return createPageCurlEmptyCurveMesh(anchor, anchor);
    }
    const rectangle = [
        { x: activeFrame.x, y: activeFrame.y },
        { x: activeFrame.x + activeFrame.width, y: activeFrame.y },
        { x: activeFrame.x + activeFrame.width, y: activeFrame.y + activeFrame.height },
        { x: activeFrame.x, y: activeFrame.y + activeFrame.height },
    ];
    let maximumDepth = 0;
    for (let index = 0; index < rectangle.length; index += 1) {
        maximumDepth = Math.max(maximumDepth, -getPageCurlFoldDistance(rectangle[index], fold));
    }
    const seamOverlap = getPageCurlSurfaceSeamOverlap(fold.arcLength);
    const stripOverlap = getPageCurlStripOverlap(fold.arcLength);
    const maximumFrontDepth = Math.min(maximumDepth, (fold.arcLength / 2) + seamOverlap);
    const landingJoinDepth = Math.max(0, (fold.arcLength / 2) - seamOverlap);
    const landingProgress = getPageCurlSurfaceLandingProgress(fold, landsOnTargetFrame);
    const indices = null;
    const vertices = [];
    const textures = [];
    if (maximumFrontDepth > 0.001 && fold.progress > 0.0001) {
        for (let stripIndex = 0; stripIndex < pageCurlBackStripCount; stripIndex += 1) {
            const creaseDepth = Math.min(maximumFrontDepth, fold.arcLength / 2);
            const curveStrips = pageCurlBackStripCount - 1;
            const nearDepth = stripIndex < curveStrips
                ? creaseDepth * stripIndex / curveStrips
                : creaseDepth;
            const farDepth = stripIndex < curveStrips
                ? creaseDepth * (stripIndex + 1) / curveStrips
                : maximumFrontDepth;
            const expandedDepthRange = expandPageCurlStripDepthRange({ farDepth, nearDepth }, stripOverlap, 0, maximumFrontDepth);
            let polygon = clipPageCurlPolygonByDistance(rectangle, fold, -(Math.abs(nearDepth - creaseDepth) < 0.0001
                ? creaseDepth
                : expandedDepthRange.nearDepth), 1);
            polygon = clipPageCurlPolygonByDistance(polygon, fold, -(Math.abs(farDepth - creaseDepth) < 0.0001
                ? creaseDepth
                : expandedDepthRange.farDepth), -1);
            const topology = createPageCurlStripTopology(polygon, fold);
            if (indices) {
                if (topology.triangleIndices.length === 0) {
                    continue;
                }
                const vertexOffset = vertices.length;
                for (let index = 0; index < topology.points.length; index += 1) {
                    vertices.push(mapPageCurlFrontCurvePoint(topology.points[index], activeFrame, backFrame, fold, landingProgress, landingJoinDepth, landsOnTargetFrame));
                    textures.push(topology.points[index]);
                }
                for (let index = 0; index < topology.triangleIndices.length; index += 1) {
                    indices.push(vertexOffset + topology.triangleIndices[index]);
                }
                continue;
            }
            const mappedPolygon = [];
            for (let index = 0; index < topology.points.length; index += 1) {
                mappedPolygon.push(mapPageCurlFrontCurvePoint(topology.points[index], activeFrame, backFrame, fold, landingProgress, landingJoinDepth, landsOnTargetFrame));
            }
            for (let index = 0; index < topology.triangleIndices.length; index += 3) {
                const firstIndex = topology.triangleIndices[index];
                const secondIndex = topology.triangleIndices[index + 1];
                const thirdIndex = topology.triangleIndices[index + 2];
                vertices.push(mappedPolygon[firstIndex], mappedPolygon[secondIndex], mappedPolygon[thirdIndex]);
                textures.push(topology.points[firstIndex], topology.points[secondIndex], topology.points[thirdIndex]);
            }
        }
    }
    const paddedMesh = padPageCurlMesh(vertices, textures, anchor, anchor, pageCurlBackMeshVertexCount);
    if (!indices) {
        return paddedMesh;
    }
    return {
        indices,
        textures: paddedMesh.textures,
        vertices: paddedMesh.vertices,
    };
};
const appendUniquePageCurlPoint = (points, point) => {
    for (let index = 0; index < points.length; index += 1) {
        if (Math.abs(points[index].x - point.x) < 0.5
            && Math.abs(points[index].y - point.y) < 0.5) {
            return;
        }
    }
    points.push(point);
};
const createPageCurlLineIntersections = (frame, fold, distanceThreshold = 0) => {
    const intersections = [];
    const lineMidpointX = fold.midpointX + (fold.normalX * distanceThreshold);
    const lineMidpointY = fold.midpointY + (fold.normalY * distanceThreshold);
    const minimumX = frame.x;
    const maximumX = frame.x + frame.width;
    const minimumY = frame.y;
    const maximumY = frame.y + frame.height;
    if (Math.abs(fold.normalY) > 0.0001) {
        const minimumXY = lineMidpointY
            - ((fold.normalX * (minimumX - lineMidpointX)) / fold.normalY);
        const maximumXY = lineMidpointY
            - ((fold.normalX * (maximumX - lineMidpointX)) / fold.normalY);
        if (minimumXY >= minimumY - 0.5 && minimumXY <= maximumY + 0.5) {
            appendUniquePageCurlPoint(intersections, {
                x: minimumX,
                y: clampWorklet(minimumXY, minimumY, maximumY),
            });
        }
        if (maximumXY >= minimumY - 0.5 && maximumXY <= maximumY + 0.5) {
            appendUniquePageCurlPoint(intersections, {
                x: maximumX,
                y: clampWorklet(maximumXY, minimumY, maximumY),
            });
        }
    }
    if (Math.abs(fold.normalX) > 0.0001) {
        const minimumYX = lineMidpointX
            - ((fold.normalY * (minimumY - lineMidpointY)) / fold.normalX);
        const maximumYX = lineMidpointX
            - ((fold.normalY * (maximumY - lineMidpointY)) / fold.normalX);
        if (minimumYX >= minimumX - 0.5 && minimumYX <= maximumX + 0.5) {
            appendUniquePageCurlPoint(intersections, {
                x: clampWorklet(minimumYX, minimumX, maximumX),
                y: minimumY,
            });
        }
        if (maximumYX >= minimumX - 0.5 && maximumYX <= maximumX + 0.5) {
            appendUniquePageCurlPoint(intersections, {
                x: clampWorklet(maximumYX, minimumX, maximumX),
                y: maximumY,
            });
        }
    }
    return intersections;
};
const getPageCurlOrderedLineEndpoints = (intersections, fold) => {
    if (intersections.length < 2) {
        return null;
    }
    let first = intersections[0];
    let second = intersections[1];
    let maximumDistance = ((first.x - second.x) ** 2) + ((first.y - second.y) ** 2);
    for (let firstIndex = 0; firstIndex < intersections.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < intersections.length; secondIndex += 1) {
            const candidateFirst = intersections[firstIndex];
            const candidateSecond = intersections[secondIndex];
            const candidateDistance = ((candidateFirst.x - candidateSecond.x) ** 2)
                + ((candidateFirst.y - candidateSecond.y) ** 2);
            if (candidateDistance > maximumDistance) {
                first = candidateFirst;
                second = candidateSecond;
                maximumDistance = candidateDistance;
            }
        }
    }
    const firstCornerDistance = ((first.x - fold.cornerX) ** 2)
        + ((first.y - fold.cornerY) ** 2);
    const secondCornerDistance = ((second.x - fold.cornerX) ** 2)
        + ((second.y - fold.cornerY) ** 2);
    return firstCornerDistance >= secondCornerDistance
        ? { cornerPoint: second, hingePoint: first }
        : { cornerPoint: first, hingePoint: second };
};
const createPageCurlReceiverLightingMesh = (activeFrame, backFrame, fold, landsOnTargetFrame) => {
    const landingProgress = getPageCurlSurfaceLandingProgress(fold, landsOnTargetFrame);
    const fallbackSource = {
        x: fold.cornerX,
        y: fold.cornerY,
    };
    if (fold.progress <= 0.0001) {
        const fallbackVertex = mapPageCurlBackPoint(fallbackSource, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
        const movingCreaseReflectionVertices = [];
        const receiverShadowVertices = [];
        const stationaryCreaseShadowVertices = [];
        while (receiverShadowVertices.length < pageCurlReceiverShadowVertexCount) {
            receiverShadowVertices.push(fallbackVertex);
        }
        while (stationaryCreaseShadowVertices.length
            < pageCurlStationaryCreaseShadowVertexCount) {
            stationaryCreaseShadowVertices.push(fallbackVertex);
        }
        while (movingCreaseReflectionVertices.length
            < pageCurlMovingCreaseReflectionVertexCount) {
            movingCreaseReflectionVertices.push(fallbackVertex);
        }
        return {
            movingCreaseReflectionVertices,
            receiverShadowProjectionDirection: {
                x: pageCurlReceiverCastDirectionX,
                y: pageCurlReceiverCastDirectionY,
            },
            receiverShadowVertices,
            receiverShadowVisibility: 0,
            stationaryCreaseShadowVertices,
        };
    }
    const hingeY = fold.cornerY <= activeFrame.y + (activeFrame.height / 2)
        ? activeFrame.y + activeFrame.height
        : activeFrame.y;
    const horizontalInteriorDirection = fold.cornerX <= activeFrame.x + (activeFrame.width / 2)
        ? 1
        : -1;
    const interiorSampleDistance = Math.max(2, Math.min(activeFrame.width, activeFrame.height) * 0.012);
    const cornerSourceDepth = Math.max(0, -getPageCurlFoldDistance({ x: fold.cornerX, y: fold.cornerY }, fold));
    const outerEdgeHingeDistance = getPageCurlFoldDistance({ x: fold.cornerX, y: hingeY }, fold);
    // Clip the edge by its endpoint distances so a fully folded edge stays
    // intact when the fold turns vertical and normalY changes sign.
    const outerEdgeStartRatio = outerEdgeHingeDistance > 0
        ? outerEdgeHingeDistance / (outerEdgeHingeDistance + cornerSourceDepth)
        : 0;
    const outerEdgeFoldIntersectionY = hingeY
        + ((fold.cornerY - hingeY) * outerEdgeStartRatio);
    const receiverReference = {
        x: -fold.normalX,
        y: -fold.normalY,
    };
    const cornerElevation = getPageCurlSurfaceElevation(cornerSourceDepth, fold.arcLength);
    const maximumCornerElevation = activeFrame.width
        * pageCurlMaximumArcWidthRatio
        * 2
        / Math.PI;
    const normalizedHeight = maximumCornerElevation <= 0.001
        ? 0
        : clampWorklet(cornerElevation / maximumCornerElevation, 0, 1);
    const heightVisibility = smoothStepWorklet(normalizedHeight);
    const landingVisibility = 1 - landingProgress;
    const shadowVisibility = heightVisibility * landingVisibility;
    const shadowCasterInset = activeFrame.width
        * pageCurlReceiverShadowCasterInsetRatio
        * shadowVisibility;
    const projectionDirection = {
        x: pageCurlReceiverCastDirectionX,
        y: pageCurlReceiverCastDirectionY,
    };
    const movingCreaseReflectionVertices = [];
    const receiverShadowVertices = [];
    const stationaryCreaseShadowVertices = [];
    for (let sectionIndex = 0; sectionIndex <= pageCurlReceiverShadowSectionCount; sectionIndex += 1) {
        const sectionRatio = sectionIndex / pageCurlReceiverShadowSectionCount;
        const surfaceRimSource = {
            x: fold.cornerX,
            y: outerEdgeFoldIntersectionY
                + ((fold.cornerY - outerEdgeFoldIntersectionY) * sectionRatio),
        };
        const mappedRimPoint = mapPageCurlBackPoint(surfaceRimSource, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
        const mappedRimInteriorPoint = mapPageCurlBackPoint({
            x: surfaceRimSource.x
                + (horizontalInteriorDirection * interiorSampleDistance),
            y: surfaceRimSource.y,
        }, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
        const outerEdgeReceiverNormal = stabilizePageCurlDirection(getPageCurlReceiverOutwardNormal(mappedRimPoint, mappedRimInteriorPoint, receiverReference), receiverReference);
        const localSourceDepth = Math.max(0, -getPageCurlFoldDistance(surfaceRimSource, fold));
        const localArcLength = getPageCurlLocalArcLength(surfaceRimSource, activeFrame, fold);
        const localElevation = getPageCurlSurfaceElevation(localSourceDepth - ((fold.arcLength - localArcLength) / 2), localArcLength);
        const localHeightVisibility = cornerElevation <= 0.001
            ? 0
            : smoothStepWorklet(clampWorklet(localElevation / cornerElevation, 0, 1));
        const shadowHingeVisibility = smoothStepWorklet(clampWorklet((sectionRatio - pageCurlReceiverShadowHingeTaperRatio)
            / (1 - pageCurlReceiverShadowHingeTaperRatio), 0, 1));
        const shadowTipVisibility = smoothStepWorklet(clampWorklet((1 - sectionRatio) / pageCurlReceiverShadowTipTaperRatio, 0, 1));
        const shadowSectionVisibility = localHeightVisibility
            * shadowHingeVisibility
            * shadowTipVisibility;
        for (let scaleIndex = 0; scaleIndex < pageCurlReceiverShadowPositions.length; scaleIndex += 1) {
            const scale = pageCurlReceiverShadowPositions[scaleIndex];
            const casterPoint = projectPageCurlReceiverPoint(mappedRimPoint, shadowCasterInset * shadowSectionVisibility, {
                x: -outerEdgeReceiverNormal.x,
                y: -outerEdgeReceiverNormal.y,
            }, scale);
            receiverShadowVertices.push(casterPoint);
        }
    }
    const creaseSourceDepth = fold.arcLength / 2;
    const creaseLineEndpoints = getPageCurlOrderedLineEndpoints(createPageCurlLineIntersections(activeFrame, fold, -creaseSourceDepth), fold);
    const creaseLandingJoinDepth = Math.max(0, creaseSourceDepth - getPageCurlSurfaceSeamOverlap(fold.arcLength));
    if (creaseLineEndpoints) {
        const creaseRail = [];
        // Shadow and reflection must follow the rendered polygonal rim, not a
        // separately sampled analytic curve that can expose a bright pixel gap.
        for (let section = 0; section <= pageCurlLongitudinalSectionCount; section += 1) {
            const ratio = getPageCurlLongitudinalRatio(section);
            creaseRail.push(mapPageCurlFrontCurvePoint({
                x: creaseLineEndpoints.hingePoint.x + ((creaseLineEndpoints.cornerPoint.x - creaseLineEndpoints.hingePoint.x) * ratio),
                y: creaseLineEndpoints.hingePoint.y + ((creaseLineEndpoints.cornerPoint.y - creaseLineEndpoints.hingePoint.y) * ratio),
            }, activeFrame, backFrame, fold, landingProgress, creaseLandingJoinDepth, landsOnTargetFrame));
        }
        for (let sectionIndex = 0; sectionIndex <= pageCurlReceiverShadowSectionCount; sectionIndex += 1) {
            // Include every rim corner; unused fixed-budget rows collapse at the tip.
            const sectionPosition = Math.min(pageCurlLongitudinalSectionCount, sectionIndex / 2);
            const railSection = Math.min(pageCurlLongitudinalSectionCount - 1, Math.floor(sectionPosition));
            const railRatio = sectionPosition - railSection;
            const startRatio = getPageCurlLongitudinalRatio(railSection);
            const endRatio = getPageCurlLongitudinalRatio(railSection + 1);
            const sectionRatio = startRatio + ((endRatio - startRatio) * railRatio);
            const mappedCreasePoint = {
                x: creaseRail[railSection].x + ((creaseRail[railSection + 1].x - creaseRail[railSection].x) * railRatio),
                y: creaseRail[railSection].y + ((creaseRail[railSection + 1].y - creaseRail[railSection].y) * railRatio),
            };
            const reflectionSectionVisibility = smoothStepWorklet(clampWorklet((sectionRatio
                - pageCurlMovingCreaseReflectionFadeStartRatio) / (pageCurlMovingCreaseReflectionFadeEndRatio
                - pageCurlMovingCreaseReflectionFadeStartRatio), 0, 1));
            const creaseSourcePoint = {
                x: creaseLineEndpoints.hingePoint.x + ((creaseLineEndpoints.cornerPoint.x - creaseLineEndpoints.hingePoint.x) * sectionRatio),
                y: creaseLineEndpoints.hingePoint.y + ((creaseLineEndpoints.cornerPoint.y - creaseLineEndpoints.hingePoint.y) * sectionRatio),
            };
            const localRadiusRatio = getPageCurlLocalArcLength(creaseSourcePoint, activeFrame, fold)
                / Math.max(0.001, fold.arcLength);
            for (let depthIndex = 0; depthIndex < pageCurlStationaryCreaseShadowDepthPositions.length; depthIndex += 1) {
                const shadowDepth = activeFrame.width
                    * localRadiusRatio
                    * pageCurlStationaryCreaseShadowDepthPositions[depthIndex]
                    * shadowVisibility;
                stationaryCreaseShadowVertices.push({
                    x: mappedCreasePoint.x - (fold.normalX * shadowDepth),
                    y: mappedCreasePoint.y - (fold.normalY * shadowDepth),
                });
            }
            for (let depthIndex = 0; depthIndex < pageCurlMovingCreaseReflectionDepthPositions.length; depthIndex += 1) {
                const reflectionVisibility = heightVisibility
                    * landingVisibility
                    * reflectionSectionVisibility;
                const reflectionDepth = depthIndex === 0
                    ? -pageCurlMovingCreaseReflectionOverlap * reflectionVisibility * localRadiusRatio
                    : activeFrame.width
                        * localRadiusRatio
                        * pageCurlMovingCreaseReflectionDepthPositions[depthIndex]
                        * reflectionVisibility;
                movingCreaseReflectionVertices.push({
                    x: mappedCreasePoint.x + (fold.normalX * reflectionDepth),
                    y: mappedCreasePoint.y + (fold.normalY * reflectionDepth),
                });
            }
        }
    }
    const creaseFallbackVertex = creaseLineEndpoints
        ? mapPageCurlFrontCurvePoint(creaseLineEndpoints.cornerPoint, activeFrame, backFrame, fold, landingProgress, creaseLandingJoinDepth, landsOnTargetFrame)
        : mapPageCurlBackPoint(fallbackSource, activeFrame, backFrame, fold, landingProgress, landsOnTargetFrame).vertex;
    while (stationaryCreaseShadowVertices.length
        < pageCurlStationaryCreaseShadowVertexCount) {
        stationaryCreaseShadowVertices.push(creaseFallbackVertex);
    }
    while (movingCreaseReflectionVertices.length
        < pageCurlMovingCreaseReflectionVertexCount) {
        movingCreaseReflectionVertices.push(creaseFallbackVertex);
    }
    return {
        movingCreaseReflectionVertices,
        receiverShadowProjectionDirection: projectionDirection,
        receiverShadowVertices,
        receiverShadowVisibility: shadowVisibility,
        stationaryCreaseShadowVertices,
    };
};
const getPageCurlLightingRadiusFactor = (arcLength, referenceRadius) => {
    return smoothStepWorklet(clampWorklet((Math.max(0, arcLength) / Math.PI) / Math.max(1, referenceRadius), 0, 1));
};
const getPageCurlTargetShadowOffset = (arcLength) => {
    return Math.max(0, arcLength) / Math.PI;
};
const createPageCurlSurfaceLightingTextures = (textures, activeFrame, backFrame, fold, reverseTextureX, vertices) => {
    const lightingTextures = [];
    const landingProgress = getPageCurlSurfaceLandingProgress(fold, reverseTextureX);
    const intersections = createPageCurlLineIntersections(activeFrame, fold, -fold.arcLength / 2);
    const ends = getPageCurlOrderedLineEndpoints(intersections, fold);
    const sourceStart = ends?.hingePoint ?? { x: fold.midpointX, y: fold.midpointY };
    const sourceEnd = ends?.cornerPoint ?? { x: sourceStart.x - fold.normalY, y: sourceStart.y + fold.normalX };
    const start = mapPageCurlBackPoint(sourceStart, activeFrame, backFrame, fold, landingProgress, reverseTextureX).vertex;
    const end = mapPageCurlBackPoint(sourceEnd, activeFrame, backFrame, fold, landingProgress, reverseTextureX).vertex;
    const tangentX = end.x - start.x;
    const tangentY = end.y - start.y;
    const length = Math.max(0.0001, Math.hypot(tangentX, tangentY));
    // Preserve the paper side when different page aspect ratios rotate the
    // rendered crease during landing.
    const alignment = (sourceStart.y - sourceEnd.y) * fold.normalX
        + (sourceEnd.x - sourceStart.x) * fold.normalY;
    const sign = alignment < 0 ? -1 : 1;
    const normalX = -tangentY / length * sign;
    const normalY = tangentX / length * sign;
    const lightingWidth = Math.max(1, fold.arcLength * 0.45 * (1 - landingProgress));
    for (let index = 0; index < textures.length; index += 1) {
        const point = vertices[index];
        const normalizedY = (textures[index].y - backFrame.y) / Math.max(1, backFrame.height);
        // An affine field from the rendered crease keeps triangle interpolation
        // from introducing corners into the highlight as the paper bends.
        lightingTextures.push({
            x: ((point.x - start.x) * normalX + (point.y - start.y) * normalY) / lightingWidth,
            y: normalizedY,
        });
    }
    return lightingTextures;
};
const createPageCurlFrontSurfaceColors = (mesh, activeFrame, backFrame, fold, landsOnTargetFrame, opacity) => {
    const lighting = createPageCurlSurfaceLightingTextures(mesh.textures, activeFrame, backFrame, fold, landsOnTargetFrame, mesh.vertices);
    const colors = [];
    for (let index = 0; index < mesh.textures.length; index += 1) {
        const source = mesh.textures[index];
        const depth = Math.max(0, -getPageCurlFoldDistance(source, fold));
        const localArc = getPageCurlLocalArcLength(source, activeFrame, fold);
        const centeredDepth = depth - (fold.arcLength - localArc) / 2;
        const curvedAmount = smoothStepWorklet(clampWorklet(2 * centeredDepth / Math.max(0.001, localArc), 0, 1));
        // Use the back surface's rendered crease while leaving the flat front
        // extension unlit. Opaque colors keep overlapping strips from darkening twice.
        const nearCrest = 1 - smoothStepWorklet(clampWorklet(lighting[index].x / 0.36, 0, 1));
        const shade = pageCurlFrontSurfaceShadeStrength * opacity * nearCrest * curvedAmount;
        const channel = Math.round(255 * (1 - shade));
        colors.push(pageCurlFrontSurfaceGrayColors[channel]);
    }
    return colors;
};
const getPageCurlReceiverShadowBlur = (pageWidth, fold, landsOnTargetFrame) => {
    const landingVisibility = 1 - getPageCurlSurfaceLandingProgress(fold, landsOnTargetFrame);
    const maximumHeight = pageWidth * pageCurlMaximumArcWidthRatio * 2 / Math.PI;
    const arcLength = Math.max(0, fold.arcLength);
    const height = getPageCurlSurfaceElevation(fold.foldDepth, arcLength) * landingVisibility;
    const heightRatio = clampWorklet(height / Math.max(1, maximumHeight), 0, 1);
    const contactBlur = Math.max(0.6, pageWidth * 0.002);
    return contactBlur + (pageWidth * pageCurlReceiverShadowBlurRatio * heightRatio);
};
const createPageCurlReceiverContactCasterMesh = (lighting, pageWidth, fold, landsOnTargetFrame) => {
    const points = lighting.stationaryCreaseShadowVertices;
    const columns = pageCurlStationaryCreaseShadowDepthPositions.length;
    const maximumDepth = pageCurlStationaryCreaseShadowDepthPositions[columns - 1];
    const blur = getPageCurlReceiverShadowBlur(pageWidth, fold, landsOnTargetFrame);
    const width = blur * 2.5;
    const hinge = points[0];
    const end = points[points.length - columns];
    const creaseLength = Math.hypot(end.x - hinge.x, end.y - hinge.y);
    const taperLength = Math.max(1, Math.min(creaseLength * 0.35, Math.max(pageWidth * 0.1, blur * 6)));
    const vertices = [];
    for (let index = 0; index < points.length; index += 1) {
        const column = index % columns;
        const base = points[index - column];
        // Narrow the caster at contact before blurring so the hinge does
        // not leave a round cap on the stationary page.
        const distanceFromHinge = Math.hypot(base.x - hinge.x, base.y - hinge.y);
        const hingeTaper = smoothStepWorklet(clampWorklet(distanceFromHinge / taperLength, 0, 1));
        const depth = width * hingeTaper * pageCurlStationaryCreaseShadowDepthPositions[column] / maximumDepth;
        vertices.push({
            x: base.x + fold.normalX * depth,
            y: base.y + fold.normalY * depth,
        });
    }
    return { vertices, indices: pageCurlStationaryCreaseShadowIndices };
};
export { createPageCurlReceiverContactCasterMesh, createPageCurlSurfaceLightingTextures, createPageCurlFrontSurfaceColors, getPageCurlReceiverShadowBlur, getPageCurlLocalArcLength, pageCurlStationaryCreaseShadowDepthPositions, createPageCurlFoldContext, createPageCurlFrontMesh, createPageCurlFrontCurveMesh, createPageCurlBackMesh, createPageCurlReceiverLightingMesh, createPageCurlLineIntersections, getPageCurlOrderedLineEndpoints, mapPageCurlReceiverLowerEdgeCasterPoint, getPageCurlSurfaceLandingProgress, getPageCurlReceiverShadowOpacity, getPageCurlReceiverShadowOnset, getPageCurlLightingRadiusFactor, getPageCurlTargetShadowOffset, mapPageCurlCurvedPoint, getPageCurlSurfaceElevation, pageCurlReceiverShadowSectionCount, pageCurlReceiverShadowIndices, pageCurlStationaryCreaseShadowIndices, pageCurlMovingCreaseReflectionIndices, pageCurlStationaryCreaseShadowGradientColors, pageCurlStationaryCreaseShadowGradientPositions, pageCurlMovingCreaseReflectionGradientColors, pageCurlMovingCreaseReflectionGradientPositions, pageCurlCurveShadeGradientColors, pageCurlCurveShadeGradientPositions };
