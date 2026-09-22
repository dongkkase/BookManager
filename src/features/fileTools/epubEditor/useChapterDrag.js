import { useEffect, useRef, useState } from 'react';
import { CHAPTER_DRAG, chapterDropTarget, chapterDragScroll, reorderChapters } from './chapterDrag';

export default function useChapterDrag({ disabled, onMove }) {
    const listRef = useRef(null);
    const active = useRef(null);
    const pointer = useRef(null);
    const frame = useRef(null);
    const lastFrame = useRef(null);
    const [draggingId, setDraggingId] = useState(null);
    const [target, setTarget] = useState(null);
    const stopScroll = () => { cancelAnimationFrame(frame.current); frame.current = null; lastFrame.current = null; };
    const leave = () => { pointer.current = null; stopScroll(); setTarget(null); };
    const reset = () => { active.current = null; setDraggingId(null); leave(); };
    useEffect(() => {
        document.addEventListener('dragend', reset);
        window.addEventListener('blur', reset);
        return () => {
            document.removeEventListener('dragend', reset);
            window.removeEventListener('blur', reset);
            stopScroll();
        };
    }, []);
    useEffect(() => { if (disabled) reset(); }, [disabled]);
    const inside = point => {
        if (!point || !listRef.current) return false;
        const rect = listRef.current.getBoundingClientRect();
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    };
    const locate = () => {
        if (!active.current || !inside(pointer.current)) return null;
        const rows = [...listRef.current.querySelectorAll('[data-chapter-id]')].map(row => {
            const rect = row.getBoundingClientRect();
            return { id: row.dataset.chapterId, top: rect.top, bottom: rect.bottom };
        });
        return chapterDropTarget(rows, active.current, pointer.current.y);
    };
    const refresh = () => {
        const next = locate();
        setTarget(previous => previous?.id === next?.id && previous?.edge === next?.edge ? previous : next);
        return next;
    };
    const scroll = time => {
        frame.current = null;
        if (!active.current || !inside(pointer.current)) return;
        const list = listRef.current;
        const rect = list.getBoundingClientRect();
        const amount = chapterDragScroll(pointer.current.y, rect.top, rect.bottom);
        const elapsed = lastFrame.current == null ? 16 : Math.min(32, time - lastFrame.current);
        lastFrame.current = time;
        if (amount) {
            list.scrollTop += amount * elapsed / 16;
            refresh();
        }
        frame.current = requestAnimationFrame(scroll);
    };
    return {
        listProps: {
            ref: listRef,
            onDragOver: event => {
                if (disabled || !active.current || !event.dataTransfer.types.includes(CHAPTER_DRAG)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                pointer.current = { x: event.clientX, y: event.clientY };
                refresh();
                if (frame.current == null) frame.current = requestAnimationFrame(scroll);
            },
            onDragLeave: event => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                if (!inside({ x: event.clientX, y: event.clientY })) leave();
            },
            onScroll: () => { if (active.current) refresh(); },
            onDrop: event => {
                if (!active.current || !event.dataTransfer.types.includes(CHAPTER_DRAG)) return;
                event.preventDefault();
                event.stopPropagation();
                const source = active.current;
                pointer.current = { x: event.clientX, y: event.clientY };
                const destination = !disabled && event.dataTransfer.getData(CHAPTER_DRAG) === source ? locate() : null;
                reset();
                if (destination) onMove(chapters => reorderChapters(chapters, source, destination));
            },
        },
        rowProps: id => ({
            'data-chapter-id': id,
            draggable: !disabled,
            onDragStart: event => {
                if (disabled) { event.preventDefault(); return; }
                active.current = id;
                setDraggingId(id);
                event.dataTransfer.setData(CHAPTER_DRAG, id);
                event.dataTransfer.effectAllowed = 'move';
            },
            onDragEnd: reset,
        }),
        rowClass: id => `${draggingId === id ? ' is-dragging' : ''}${target?.id === id ? ` is-drop-${target.edge}` : ''}`,
    };
}
