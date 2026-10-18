import React, { useEffect, useRef, useState } from 'react';
import '../../styles/FolderCharacterIndex.css';

const SCROLLER_SELECTOR = '.file-table-container, .thumbnail-grid, .tile-grid';

function FolderCharacterIndex({ entries = [], onNavigate, scrollContainerRef, t }) {
    const railRef = useRef(null);
    const listRef = useRef(null);
    const buttonsRef = useRef(new Map());
    const dragRef = useRef(null);
    const [focusedKey, setFocusedKey] = useState('');
    const [rightOffset, setRightOffset] = useState(6);
    const tabStopKey = entries.some(entry => entry.key === focusedKey) ? focusedKey : entries[0]?.key;

    useEffect(() => {
        const parent = railRef.current?.parentElement;
        if (!parent) return undefined;
        let observedScroller = null;
        const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        function measure() {
            const container = scrollContainerRef?.current || parent;
            const scroller = container.matches(SCROLLER_SELECTOR) ? container : container.querySelector(SCROLLER_SELECTOR);
            if (!scroller) return;
            if (observedScroller !== scroller) {
                if (observedScroller) resizeObserver?.unobserve(observedScroller);
                observedScroller = scroller;
                resizeObserver?.observe(scroller);
            }
            const style = window.getComputedStyle(scroller);
            const leftBorder = parseFloat(style.borderLeftWidth) || 0;
            const rightBorder = parseFloat(style.borderRightWidth) || 0;
            const scrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth - leftBorder - rightBorder);
            const outsideSpace = Math.max(0, parent.getBoundingClientRect().right - scroller.getBoundingClientRect().right);
            setRightOffset(Math.ceil(outsideSpace + scrollbarWidth + rightBorder + 6));
        }
        measure();
        resizeObserver?.observe(parent);
        const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
        mutationObserver?.observe(parent, { childList: true });
        window.addEventListener('resize', measure);
        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [entries, scrollContainerRef]);

    function focusEntry(entry) {
        const button = buttonsRef.current.get(entry.key);
        setFocusedKey(entry.key);
        button?.focus({ preventScroll: true });
        if (!button || !listRef.current) return;
        const list = listRef.current;
        const buttonBounds = button.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        if (buttonBounds.top < listBounds.top) list.scrollTop -= listBounds.top - buttonBounds.top;
        else if (buttonBounds.bottom > listBounds.bottom) list.scrollTop += buttonBounds.bottom - listBounds.bottom;
    }

    function navigate(entry) {
        if (!entry) return;
        focusEntry(entry);
        onNavigate?.(entry);
    }

    function handleKeyDown(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.stopPropagation();
        const current = entries.findIndex(entry => buttonsRef.current.get(entry.key) === event.target);
        if (current < 0) return;
        let next = current;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(entries.length - 1, current + 1);
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = Math.max(0, current - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = entries.length - 1;
        else return;
        event.preventDefault();
        focusEntry(entries[next]);
    }

    function handlePointerDown(event) {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary) return;
        const button = event.target.closest('button[data-character-key]');
        const entry = entries.find(item => item.key === button?.dataset.characterKey);
        if (!entry) return;
        event.preventDefault();
        dragRef.current = { pointerId: event.pointerId, lastKey: entry.key };
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(entry);
    }

    function handlePointerMove(event) {
        const drag = dragRef.current;
        const list = listRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !list) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 12) list.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 12) list.scrollTop += 12;
        const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, event.clientY));
        const button = document.elementFromPoint(bounds.left + bounds.width / 2, y)?.closest('button[data-character-key]');
        if (!button || !list.contains(button) || button.dataset.characterKey === drag.lastKey) return;
        const entry = entries.find(item => item.key === button.dataset.characterKey);
        if (!entry) return;
        drag.lastKey = entry.key;
        navigate(entry);
    }

    function stopDrag(event) {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (entries.length === 0) return null;

    return (
        <nav
            ref={railRef}
            className="folder-character-index"
            style={{ right: rightOffset }}
            aria-label={t('folder.character_index.label')}
            onKeyDown={handleKeyDown}
            onKeyUp={event => event.stopPropagation()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onLostPointerCapture={() => { dragRef.current = null; }}
            onMouseDown={event => event.stopPropagation()}
            onMouseUp={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            onWheel={event => event.stopPropagation()}
        >
            <div ref={listRef} className="folder-character-index-list">
                {entries.map(entry => {
                    const label = t('folder.character_index.jump', { label: entry.label, count: entry.count });
                    return (
                        <button
                            key={entry.key}
                            ref={element => {
                                if (element) buttonsRef.current.set(entry.key, element);
                                else buttonsRef.current.delete(entry.key);
                            }}
                            type="button"
                            className="folder-character-index-letter"
                            data-character-key={entry.key}
                            tabIndex={entry.key === tabStopKey ? 0 : -1}
                            aria-label={label}
                            title={label}
                            onFocus={() => setFocusedKey(entry.key)}
                            onClick={event => {
                                event.stopPropagation();
                                if (event.detail === 0) navigate(entry);
                            }}
                        >
                            {entry.label}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

export { FolderCharacterIndex };
export default FolderCharacterIndex;
