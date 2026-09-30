import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { FaIcon } from '../../../components/FaIcon';
import { editorText as l } from './labels';
import useAssetDropIndicator from './useAssetDropIndicator';
import { ELEMENT_DRAG, movableElement, elementAtTarget, validElementDestination, moveElementTransaction, adjacentElementPosition } from './elementDrag';
import './elementDrag.css';

export default function ElementDragHandle({ editor, stageRef, chapterId, enabled }) {
    const buttonRef = useRef(null);
    const beginRef = useRef(() => {});
    const refreshRef = useRef(() => {});
    const active = useRef(null);
    const hovered = useRef(null);
    const [handle, setHandle] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [announcement, setAnnouncement] = useState('');
    const { indicator, show, clear, locate } = useAssetDropIndicator({ editor, stageRef, chapterId, mode: 'edit', disabled: !enabled, blockOnly: true });

    useEffect(() => {
        const stage = stageRef.current;
        if (!enabled || !editor || editor.isDestroyed || !stage) { setHandle(null); return; }
        let frame = null;
        let scrollFrame = null;
        let pointer = null;
        const reset = () => {
            active.current = null;
            pointer = null;
            cancelAnimationFrame(scrollFrame);
            scrollFrame = null;
            stage.classList.remove('is-element-dragging');
            if (!editor.isDestroyed) editor.view.dragging = null;
            setDragging(false);
            clear();
        };
        const update = () => {
            frame = null;
            if (active.current || editor.isDestroyed) return;
            const selection = editor.state.selection;
            let source = hovered.current?.doc === editor.state.doc ? hovered.current
                : selection instanceof NodeSelection ? movableElement(editor.state, selection.from) : null;
            if (!source && selection instanceof CellSelection) {
                for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
                    if (selection.$from.node(depth).type.name === 'table') { source = movableElement(editor.state, selection.$from.before(depth)); break; }
                }
            }
            const dom = source && editor.view.nodeDOM(source.from);
            if (!editor.isEditable || !dom?.getClientRects().length || !stage.getClientRects().length) { setHandle(null); return; }
            const rect = dom.getBoundingClientRect();
            const bounds = stage.getBoundingClientRect();
            const top = Math.max(bounds.top + 3, 3);
            const bottom = Math.min(bounds.bottom - 3, window.innerHeight - 3);
            if (rect.bottom < top || rect.top > bottom || bottom - top < 28) { setHandle(null); return; }
            const hit = document.elementFromPoint(Math.max(bounds.left + 1, rect.left + 1), Math.max(top, Math.min(bottom, rect.top + rect.height / 2)));
            if (hit && !editor.view.dom.contains(hit) && !buttonRef.current?.contains(hit)) { setHandle(null); return; }
            setHandle({ from: source.from, kind: source.node.type.name, left: Math.max(bounds.left + 4, Math.min(bounds.right - 32, rect.left - 34)), top: Math.max(top, Math.min(bottom - 28, rect.top + Math.min(rect.height, 28) / 2 - 14)) });
        };
        const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
        refreshRef.current = schedule;
        const destination = point => {
            const target = locate(point);
            return target && validElementDestination(editor.state, active.current, target.position) ? target : null;
        };
        const updateDrop = point => {
            const target = destination(point);
            if (target) show(point);
            else clear();
            return target;
        };
        const autoScroll = () => {
            scrollFrame = null;
            if (!active.current || !pointer) return;
            const bounds = stage.getBoundingClientRect();
            const hit = document.elementFromPoint(pointer.left, pointer.top);
            if (pointer.left >= bounds.left && pointer.left <= bounds.right && pointer.top >= bounds.top && pointer.top <= bounds.bottom && stage.contains(hit)) {
                const edge = Math.min(48, bounds.height / 4);
                const speed = pointer.top < bounds.top + edge ? -14 * (1 - (pointer.top - bounds.top) / edge)
                    : pointer.top > bounds.bottom - edge ? 14 * (1 - (bounds.bottom - pointer.top) / edge) : 0;
                if (speed) { stage.scrollTop += speed; updateDrop(pointer); }
            }
            scrollFrame = requestAnimationFrame(autoScroll);
        };
        const begin = (event, source) => {
            if (!event.dataTransfer || !editor.isEditable || editor.view.composing || !source || source.doc !== editor.state.doc) { event.preventDefault(); return; }
            editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, source.from)).setMeta('addToHistory', false));
            active.current = { ...source, doc: editor.state.doc };
            event.dataTransfer.clearData();
            event.dataTransfer.setData(ELEMENT_DRAG, chapterId);
            event.dataTransfer.effectAllowed = 'move';
            const dom = editor.view.nodeDOM(source.from);
            if (dom) event.dataTransfer.setDragImage(dom, 12, 12);
            stage.classList.add('is-element-dragging');
            setDragging(true);
            setAnnouncement('');
            pointer = { left: event.clientX, top: event.clientY };
            scrollFrame = requestAnimationFrame(autoScroll);
        };
        beginRef.current = begin;
        const nativeStart = event => {
            if (active.current || event.defaultPrevented || event.target.closest?.('input, textarea, audio, video, iframe, .ee-image-resize')) return;
            const source = elementAtTarget(editor.view, event.target);
            if (source?.node.isAtom) begin(event, source);
        };
        const dragOver = event => {
            if (!active.current && !event.dataTransfer?.types.includes(ELEMENT_DRAG)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!active.current) { event.dataTransfer.dropEffect = 'none'; return; }
            pointer = { left: event.clientX, top: event.clientY };
            event.dataTransfer.dropEffect = updateDrop(pointer) ? 'move' : 'none';
        };
        const drop = event => {
            if (!active.current && !event.dataTransfer?.types.includes(ELEMENT_DRAG)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!active.current) return;
            const target = destination({ left: event.clientX, top: event.clientY });
            const tr = target && moveElementTransaction(editor.state, active.current, target.position);
            reset();
            if (tr) {
                editor.view.dispatch(tr);
                editor.view.dispatch(closeHistory(editor.state.tr));
                editor.view.focus();
                setAnnouncement(l('elementMoved'));
            }
            hovered.current = null;
            schedule();
        };
        const pointerMove = event => {
            if (active.current || event.buttons || buttonRef.current?.contains(event.target)) return;
            const source = elementAtTarget(editor.view, event.target);
            const previous = hovered.current;
            const rect = previous?.doc === editor.state.doc && editor.view.nodeDOM(previous.from)?.getBoundingClientRect();
            const towardHandle = rect && event.clientX >= rect.left - 40 && event.clientX <= rect.left + 28 && event.clientY >= rect.top - 14 && event.clientY <= rect.top + Math.max(28, rect.height);
            hovered.current = source || (towardHandle ? previous : null);
            schedule();
        };
        const leave = event => {
            if (buttonRef.current?.contains(event.relatedTarget)) return;
            hovered.current = null;
            schedule();
        };
        const end = () => { reset(); hovered.current = null; schedule(); };
        const keyDown = event => {
            if (active.current && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end(); }
        };
        const transaction = () => {
            if (active.current && active.current.doc !== editor.state.doc) reset();
            schedule();
        };
        stage.addEventListener('pointermove', pointerMove);
        stage.addEventListener('pointerleave', leave);
        window.addEventListener('dragstart', nativeStart);
        window.addEventListener('dragover', dragOver, true);
        window.addEventListener('drop', drop, true);
        window.addEventListener('dragend', end);
        window.addEventListener('blur', end);
        window.addEventListener('keydown', keyDown, true);
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        editor.on('transaction', transaction);
        const observer = new ResizeObserver(schedule);
        observer.observe(stage);
        observer.observe(editor.view.dom);
        schedule();
        return () => {
            reset();
            hovered.current = null;
            beginRef.current = () => {};
            refreshRef.current = () => {};
            cancelAnimationFrame(frame);
            observer.disconnect();
            stage.removeEventListener('pointermove', pointerMove);
            stage.removeEventListener('pointerleave', leave);
            window.removeEventListener('dragstart', nativeStart);
            window.removeEventListener('dragover', dragOver, true);
            window.removeEventListener('drop', drop, true);
            window.removeEventListener('dragend', end);
            window.removeEventListener('blur', end);
            window.removeEventListener('keydown', keyDown, true);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            editor.off('transaction', transaction);
        };
    }, [editor, stageRef, enabled, chapterId, show, clear, locate]);

    const select = () => {
        const source = movableElement(editor.state, handle.from);
        if (source) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, source.from)).setMeta('addToHistory', false));
    };
    const keyDown = event => {
        if (event.key === 'Escape') { editor.view.focus(); return; }
        if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const destination = adjacentElementPosition(editor.state, handle.from, event.key === 'ArrowUp' ? -1 : 1);
        const tr = moveElementTransaction(editor.state, movableElement(editor.state, handle.from), destination);
        if (!tr) return;
        editor.view.dispatch(tr);
        editor.view.dispatch(closeHistory(editor.state.tr));
        hovered.current = null;
        setAnnouncement(l('elementMoved'));
        refreshRef.current();
    };
    if (!enabled) return null;
    return createPortal(<>
        {handle && <button ref={buttonRef} type="button" className={`ee-element-drag-handle${dragging ? ' is-dragging' : ''}`} style={{ left: handle.left, top: handle.top }} draggable title={l('moveElementHint')} aria-label={`${l('moveElement')}: ${l(handle.kind)}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onPointerDown={select} onClick={select} onKeyDown={keyDown} onDragStart={event => beginRef.current(event, movableElement(editor.state, handle.from))}>
            <FaIcon name="gripVertical" size={15} />
        </button>}
        {dragging && indicator && validElementDestination(editor.state, active.current, indicator.position) && <div aria-hidden="true" className={`ee-asset-drop-cursor${indicator.inline ? ' is-inline' : ' is-block'}${indicator.alignEnd ? ' align-end' : ''}${indicator.labelBelow ? ' label-below' : ''}`} style={indicator.rect}><span>{l('moveElementHere')}</span></div>}
        <span className="ee-element-drag-status" role="status">{announcement}</span>
    </>, document.body);
}
