import { useLayoutEffect, useRef } from 'react';
import { clampZoom, createZoomWheel, zoomWheelPixels } from './editorZoom';

function zoomAnchor(stage, preview, event) {
    const surface = preview || stage.querySelector('.ee-paper');
    if (!surface?.isConnected) return null;
    const doc = preview ? preview.contentDocument : stage.ownerDocument;
    const content = preview ? doc?.body : surface;
    if (!content) return null;
    const stageRect = stage.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const scale = () => preview ? preview.getBoundingClientRect().width / preview.clientWidth : 1;
    const insideFrame = event?.target?.ownerDocument === doc && !!preview;
    const screenX = event ? insideFrame ? surfaceRect.left + event.clientX * scale() : event.clientX : stageRect.left + stage.clientWidth / 2;
    const screenY = event ? insideFrame ? surfaceRect.top + event.clientY * scale() : event.clientY : stageRect.top + stage.clientHeight / 2;
    const x = preview ? (screenX - surfaceRect.left) / scale() : screenX;
    const y = preview ? (screenY - surfaceRect.top) / scale() : screenY;
    const caret = doc.caretRangeFromPoint?.(x, y);
    const range = caret && content.contains(caret.startContainer) && caret.startContainer.nodeType === 3 && caret.getBoundingClientRect().height ? caret.cloneRange() : null;
    const hit = doc.elementFromPoint(x, y);
    const element = hit && content.contains(hit) ? hit : content;
    const rect = element.getBoundingClientRect();
    const fractionX = Math.max(0, Math.min(1, (x - rect.left) / (rect.width || 1)));
    const fractionY = Math.max(0, Math.min(1, (y - rect.top) / (rect.height || 1)));
    const point = () => {
        if (!surface.isConnected || (range ? !range.startContainer.isConnected : !element.isConnected)) return null;
        const box = range ? range.getBoundingClientRect() : element.getBoundingClientRect();
        const local = { x: box.left + (range ? 0 : box.width * fractionX), y: box.top + (range ? 0 : box.height * fractionY) };
        if (!preview) return local;
        const frameRect = preview.getBoundingClientRect();
        return { x: frameRect.left + local.x * scale(), y: frameRect.top + local.y * scale() };
    };
    const before = point();
    return () => {
        const after = point();
        if (!before || !after) return;
        stage.scrollLeft += after.x - before.x;
        stage.scrollTop += after.y - before.y;
        // The iframe has its own scroll range when the outer stage reaches a boundary.
        const remainder = point();
        if (preview && remainder && doc.scrollingElement) {
            doc.scrollingElement.scrollLeft += (remainder.x - before.x) / scale();
            doc.scrollingElement.scrollTop += (remainder.y - before.y) / scale();
        }
    };
}

export default function useEditorZoom({ stageRef, chapterId, mode, zoom, setZoom, disabled }) {
    const currentZoom = useRef(zoom);
    currentZoom.current = zoom;
    const wheel = useRef(createZoomWheel());
    const pending = useRef(null);
    const restoreFrame = useRef(null);
    useLayoutEffect(() => {
        const anchor = pending.current;
        pending.current = null;
        if (anchor?.chapterId === chapterId && anchor.mode === mode) {
            anchor.restore?.();
            // An iframe may finish reflowing one frame after its outer zoom changes.
            if (mode === 'preview') restoreFrame.current = requestAnimationFrame(() => anchor.restore?.());
        }
        return () => cancelAnimationFrame(restoreFrame.current);
    }, [zoom, chapterId, mode]);

    const change = (value, event, preview) => {
        const next = clampZoom(value);
        if (disabled || mode === 'source' || next === currentZoom.current || !stageRef.current) return;
        if (!pending.current) pending.current = { chapterId, mode, restore: zoomAnchor(stageRef.current, mode === 'preview' ? preview || stageRef.current.querySelector('iframe') : null, event) };
        currentZoom.current = next;
        setZoom(next);
    };
    return {
        change: value => { wheel.current.reset(); change(value); },
        onWheel: (event, preview) => {
            const delta = zoomWheelPixels(event, stageRef.current?.clientHeight || 1);
            if (delta === null || mode === 'source' || event.defaultPrevented) { cancelAnimationFrame(restoreFrame.current); wheel.current.reset(); return false; }
            if (event.cancelable) event.preventDefault();
            if (!disabled) change(wheel.current.next(currentZoom.current, delta, event.timeStamp), event, preview);
            return true;
        },
    };
}
