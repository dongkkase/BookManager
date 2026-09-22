export const ZOOM_PRESETS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

export function clampZoom(value, minimum = 50) {
    return Math.min(200, Math.max(minimum, Math.round(value)));
}

export function zoomWheelPixels(event, pageHeight) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !Number.isFinite(event.deltaY) || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY)) return null;
    return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1);
}

export function createZoomWheel(minimum = 50) {
    let distance = 0;
    let lastTime = -Infinity;
    let direction = 0;
    return {
        reset() { distance = 0; lastTime = -Infinity; direction = 0; },
        next(current, delta, time) {
            if (!Number.isFinite(delta) || !delta) return current;
            const nextDirection = Math.sign(delta);
            if (time - lastTime > 220 || direction !== nextDirection) distance = 0;
            direction = nextDirection;
            lastTime = time;
            distance += Math.abs(delta);
            const steps = Math.min(4, Math.floor(distance / 40));
            distance %= 40;
            return steps ? clampZoom(current - direction * steps * 5, minimum) : current;
        },
    };
}
