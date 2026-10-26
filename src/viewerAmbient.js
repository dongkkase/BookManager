export function paintAmbientCanvasFromSource(targetCanvas, source) {
    if (!targetCanvas || !source) return false;
    const sourceWidth = source.naturalWidth || source.videoWidth || source.width || source.clientWidth || 1;
    const sourceHeight = source.naturalHeight || source.videoHeight || source.height || source.clientHeight || 1;
    const maxEdge = 360;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.floor(sourceWidth * scale));
    const height = Math.max(1, Math.floor(sourceHeight * scale));
    const context = targetCanvas.getContext('2d');
    if (!context) return false;
    if (targetCanvas.width !== width) targetCanvas.width = width;
    if (targetCanvas.height !== height) targetCanvas.height = height;
    context.clearRect(0, 0, width, height);
    try {
        const edgeX = Math.max(1, Math.min(Math.max(1, Math.floor(sourceWidth / 4)), Math.round(sourceWidth * 0.04)));
        const edgeY = Math.max(1, Math.min(Math.max(1, Math.floor(sourceHeight / 4)), Math.round(sourceHeight * 0.04)));
        const horizontalGlowHeight = Math.max(1, Math.ceil(height * 0.55));
        const verticalGlowWidth = Math.max(1, Math.ceil(width * 0.55));
        context.fillStyle = '#050505';
        context.fillRect(0, 0, width, height);
        context.drawImage(source, 0, 0, sourceWidth, edgeY, 0, 0, width, horizontalGlowHeight);
        context.drawImage(source, 0, sourceHeight - edgeY, sourceWidth, edgeY, 0, height - horizontalGlowHeight, width, horizontalGlowHeight);
        context.globalAlpha = 0.9;
        context.drawImage(source, 0, 0, edgeX, sourceHeight, 0, 0, verticalGlowWidth, height);
        context.drawImage(source, sourceWidth - edgeX, 0, edgeX, sourceHeight, width - verticalGlowWidth, 0, verticalGlowWidth, height);
        context.globalAlpha = 1;
        return true;
    } catch {
        context.globalAlpha = 1;
        context.clearRect(0, 0, width, height);
        return false;
    }
}
