import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const HANDLE_HEIGHT = 8;
const MIN_TABLE_HEIGHT = 90;
const MIN_SOURCE_HEIGHT = 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function CoverEditorPanelSplit({ children, disabled, controlsId, t }) {
    const panels = React.Children.toArray(children);
    const hasSources = panels.length > 1;
    const containerRef = useRef(null);
    const dragRef = useRef(null);
    const frameRef = useRef(null);
    const pendingHeightRef = useRef(null);
    const [ratio, setRatio] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [bounds, setBounds] = useState({ available: 0, min: 0, max: 0, initial: 0 });
    const height = ratio === null ? bounds.initial : clamp(ratio * bounds.available, bounds.min, bounds.max);

    useLayoutEffect(() => {
        const files = containerRef.current?.firstElementChild;
        if (files) files.style.flexBasis = hasSources && ratio !== null ? `${height}px` : '';
    }, [hasSources, ratio, height]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const files = container?.firstElementChild;
        if (!hasSources || !files) return;
        const measure = () => {
            const table = files.querySelector('.cover-editor-file-table');
            const available = container.clientHeight - HANDLE_HEIGHT;
            if (!table || available <= 0) return;
            const initial = files.getBoundingClientRect().height;
            const min = Math.ceil(initial - table.getBoundingClientRect().height + MIN_TABLE_HEIGHT);
            setBounds(current => {
                const next = { available, min, max: Math.max(min, available - MIN_SOURCE_HEIGHT),
                    initial: container.classList.contains('has-split-size') ? current.initial : initial };
                return Object.keys(next).every(key => current[key] === next[key]) ? current : next;
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        observer.observe(files);
        for (const child of files.children) {
            if (!child.classList.contains('cover-editor-file-table')) observer.observe(child);
        }
        return () => observer.disconnect();
    }, [hasSources]);

    const flushHeight = () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        if (pendingHeightRef.current !== null) changeHeight(pendingHeightRef.current);
        pendingHeightRef.current = null;
    };

    const finishDrag = () => {
        flushHeight();
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
        setDragging(false);
    };

    useEffect(() => {
        if (disabled || !hasSources) finishDrag();
    }, [disabled, hasSources]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    const changeHeight = value => {
        if (bounds.available > 0) setRatio(clamp(value, bounds.min, bounds.max) / bounds.available);
    };

    return <div ref={containerRef} className={`cover-editor-tool-main${hasSources ? ' has-panel-split' : ''}${hasSources && ratio !== null ? ' has-split-size' : ''}${dragging ? ' is-resizing' : ''}`}>
        {panels[0]}
        {hasSources && <div className="cover-editor-panel-resizer" role="separator" aria-orientation="horizontal"
            aria-label={t('cover_editor_resize_panels')} aria-controls={controlsId} aria-disabled={disabled || undefined}
            aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(height)}
            title={t('cover_editor_resize_panels_hint')} tabIndex={disabled ? -1 : 0}
            onPointerDown={event => {
                if (disabled || event.button !== 0 || event.isPrimary === false || !bounds.available) return;
                event.preventDefault();
                event.currentTarget.focus();
                dragRef.current = { pointerId: event.pointerId, startY: event.clientY, height: containerRef.current.firstElementChild.getBoundingClientRect().height, target: event.currentTarget };
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
            }}
            onPointerMove={event => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId || disabled) return;
                event.preventDefault();
                pendingHeightRef.current = drag.height + event.clientY - drag.startY;
                if (frameRef.current === null) frameRef.current = requestAnimationFrame(flushHeight);
            }}
            onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
            onDoubleClick={() => { if (!disabled) setRatio(null); }}
            onKeyDown={event => {
                if (disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                changeHeight(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
                    : height + (event.key === 'ArrowDown' ? 24 : -24));
            }} />}
        {hasSources && panels[1]}
    </div>;
}
