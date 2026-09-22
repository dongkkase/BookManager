import { useEffect, useLayoutEffect, useRef } from 'react';
import { atScrollEdge, createChapterScrollGate, scrollPreviewBy, scrollPreviewCanvasAtEdge, wheelPixels } from './chapterScroll';

export default function useChapterScroll({ stageRef, editor, chapterId, mode, disabled, onNavigate, onZoom }) {
    const options = useRef(null);
    options.current = { chapterId, mode, disabled, onNavigate, onZoom };
    const gate = useRef(createChapterScrollGate());
    const frame = useRef(null);
    const frameChapter = useRef(null);
    const frameCleanup = useRef(null);
    const entry = useRef(null);
    const stopAnchor = useRef(null);
    const moving = useRef(false);

    const stopFollowing = () => { stopAnchor.current?.(); stopAnchor.current = null; };
    const place = (element, value) => { element.scrollTop = value === 'end' ? element.scrollHeight : value === 'start' ? 0 : value || 0; };
    const restore = () => {
        const target = entry.current;
        const stage = stageRef.current;
        if (!target || !stage || target.id !== options.current.chapterId) return;
        stopFollowing();
        const preview = options.current.mode === 'preview';
        const doc = preview && frameChapter.current === target.id && frame.current?.isConnected && frame.current.contentDocument;
        const canvas = preview && stage.querySelector('.ee-preview-canvas');
        const position = () => {
            place(stage, preview ? 0 : target.edge || target.scroll);
            if (canvas) {
                place(canvas, target.edge || target.previewCanvasScroll);
                canvas.scrollLeft = target.edge ? 0 : target.previewCanvasLeft || 0;
            }
            if (doc?.scrollingElement) place(doc.scrollingElement, target.edge || target.previewScroll);
            if (target.edge === 'end') {
                if (!preview && !stage.querySelector('.ee-footnotes')) {
                    const body = editor.view.dom;
                    const last = body.lastElementChild;
                    // A short chapter can have a tall blank paper area below its final paragraph.
                    const blank = last ? Math.max(0, body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom) : 0;
                    stage.scrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight - blank);
                }
            }
        };
        position();
        // Keep an end entry attached while images/fonts settle, until the next user interaction.
        if (target.edge === 'end') {
            const observer = new ResizeObserver(position);
            const content = preview ? doc?.body : stage.querySelector('.ee-paper');
            if (content) observer.observe(content);
            stopAnchor.current = () => observer.disconnect();
        }
    };
    const attach = (root, scrollElement) => {
        let touch = null;
        const interact = () => { stopFollowing(); entry.current = null; };
        const move = (event, delta) => {
            const current = options.current;
            if (!delta || event.defaultPrevented) return;
            if (moving.current || (entry.current && entry.current.id !== current.chapterId) || (current.mode === 'preview' && (!frame.current?.isConnected || frameChapter.current !== current.chapterId))) {
                gate.current.push(delta, event.timeStamp, false);
                if (event.cancelable) event.preventDefault();
                return;
            }
            interact();
            if (current.disabled || current.mode === 'source' || editor?.view.composing) { gate.current.reset(); return; }
            const stage = stageRef.current;
            const direction = Math.sign(delta);
            const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
            if (target?.closest('input, textarea, select, audio, video, [role="slider"]')) { gate.current.reset(); return; }
            // Nested scroll areas (including wide tables) retain their native scrolling.
            for (let node = target; node && node !== scrollElement && node !== root; node = node.parentElement) {
                if (node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(node.ownerDocument.defaultView.getComputedStyle(node).overflowY) && !atScrollEdge(node, direction)) {
                    gate.current.push(delta, event.timeStamp, false);
                    return;
                }
            }
            const previewScroll = current.mode === 'preview' ? frame.current?.contentDocument?.scrollingElement : null;
            if (previewScroll && scrollPreviewCanvasAtEdge(frame.current, delta, root !== stage)) {
                gate.current.push(delta, event.timeStamp, false);
                if (event.cancelable) event.preventDefault();
                return;
            }
            const boundary = atScrollEdge(previewScroll || stage, direction);
            const navigate = gate.current.push(delta, event.timeStamp, boundary);
            if (!boundary) {
                // The preview has one vertical scroll surface, even over its surrounding margin.
                if (previewScroll && root === stage && event.cancelable) {
                    event.preventDefault();
                    scrollPreviewBy(frame.current, delta);
                }
                return;
            }
            // Contain overscroll even while loading the adjacent chapter.
            if (event.cancelable) event.preventDefault();
            if (!navigate || moving.current) return;
            moving.current = true;
            Promise.resolve(current.onNavigate(direction)).finally(() => { moving.current = false; });
        };
        const wheel = event => {
            const current = options.current;
            if (moving.current || (entry.current && entry.current.id !== current.chapterId) || (current.mode === 'preview' && (!frame.current?.isConnected || frameChapter.current !== current.chapterId))) {
                gate.current.push(wheelPixels(event, scrollElement.clientHeight), event.timeStamp, false);
                if (event.cancelable) event.preventDefault();
                return;
            }
            if (current.onZoom?.(event, frame.current)) { gate.current.reset(); interact(); return; }
            move(event, wheelPixels(event, scrollElement.clientHeight));
        };
        const touchStart = event => {
            interact();
            gate.current.reset();
            touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
        };
        const touchMove = event => {
            if (!touch || event.touches.length !== 1) { touch = null; return; }
            const next = { x: event.touches[0].clientX, y: event.touches[0].clientY };
            const delta = touch.y - next.y;
            if (Math.abs(delta) > Math.abs(touch.x - next.x)) move(event, delta);
            touch = next;
        };
        root.addEventListener('wheel', wheel, { passive: false });
        root.addEventListener('touchstart', touchStart, { passive: true });
        root.addEventListener('touchmove', touchMove, { passive: false });
        root.addEventListener('pointerdown', interact);
        root.addEventListener('keydown', interact);
        return () => {
            root.removeEventListener('wheel', wheel);
            root.removeEventListener('touchstart', touchStart);
            root.removeEventListener('touchmove', touchMove);
            root.removeEventListener('pointerdown', interact);
            root.removeEventListener('keydown', interact);
        };
    };
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage || !editor) return undefined;
        return attach(stage, stage);
    }, [editor]);
    useLayoutEffect(() => { restore(); }, [chapterId]);
    useEffect(() => {
        gate.current.reset();
        stopFollowing();
        entry.current = null;
        frameCleanup.current?.();
        frameCleanup.current = null;
        frame.current = null;
    }, [mode]);
    useEffect(() => () => { stopFollowing(); frameCleanup.current?.(); }, []);

    return {
        capture: () => {
            const canvas = stageRef.current?.querySelector('.ee-preview-canvas');
            return { scroll: stageRef.current?.scrollTop || 0, previewScroll: frame.current?.contentDocument?.scrollingElement?.scrollTop || 0, previewCanvasScroll: canvas?.scrollTop || 0, previewCanvasLeft: canvas?.scrollLeft || 0 };
        },
        enter: target => { stopFollowing(); entry.current = target; },
        onPreviewLoad: element => {
            if (!element.isConnected) return;
            frameCleanup.current?.();
            frame.current = element;
            frameChapter.current = options.current.chapterId;
            const doc = element.contentDocument;
            if (doc?.scrollingElement) {
                doc.documentElement.style.overscrollBehaviorY = 'contain';
                frameCleanup.current = attach(doc, doc.scrollingElement);
            }
            restore();
        },
    };
}
