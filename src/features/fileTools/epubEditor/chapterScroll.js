export function wheelPixels(event, pageHeight) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY)) return 0;
    return event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1);
}

export function atScrollEdge(element, direction) {
    return direction < 0 ? element.scrollTop <= 1 : element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
}

export function scrollPreviewBy(frame, delta) {
    const page = frame?.contentDocument?.scrollingElement;
    if (!page || !Number.isFinite(delta)) return false;
    const scale = frame.getBoundingClientRect().width / frame.clientWidth || 1;
    page.scrollTop = Math.max(0, Math.min(page.scrollHeight - page.clientHeight, page.scrollTop + delta / scale));
    return true;
}

export function scrollPreviewCanvasAtEdge(frame, delta, insideFrame = false) {
    const page = frame?.contentDocument?.scrollingElement;
    const canvas = frame?.closest?.('.ee-preview-canvas');
    if (!page || !canvas || !Number.isFinite(delta) || !delta) return false;
    const direction = Math.sign(delta);
    if (!atScrollEdge(page, direction) || atScrollEdge(canvas, direction)) return false;
    const scale = insideFrame ? frame.getBoundingClientRect().width / frame.clientWidth || 1 : 1;
    canvas.scrollTop = Math.max(0, Math.min(canvas.scrollHeight - canvas.clientHeight, canvas.scrollTop + delta * scale));
    return true;
}

// Only a new gesture starting at an edge may change chapters. Reaching the edge
// from inside the chapter consumes the gesture, including its inertial tail.
export function createChapterScrollGate() {
    let lastTime = -Infinity;
    let lastDirection = 0;
    let distance = 0;
    let locked = false;
    return {
        reset() { lastTime = -Infinity; lastDirection = 0; distance = 0; locked = false; },
        push(delta, time, boundary) {
            if (!Number.isFinite(delta) || !delta) return false;
            const direction = Math.sign(delta);
            if (time - lastTime > 220 || direction !== lastDirection) { distance = 0; locked = false; }
            lastTime = time;
            lastDirection = direction;
            if (!boundary) { distance = 0; locked = true; return false; }
            if (locked) return false;
            distance += Math.abs(delta);
            if (distance < 64) return false;
            distance = 0;
            locked = true;
            return true;
        },
    };
}
