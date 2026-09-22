import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CommandButton, IndentControls } from './FeatureToolbar';
import { editorText as l } from './labels';
import { selectionContext, placeContextToolbar, toolbarFocusIndex } from './contextTools';
import { canApplyScript } from './richFormatting';
import { imageAlignmentPatch, imageTextWrapPatch } from './imageNode';

export default function ContextToolbar({ editor, stageRef, enabled, actions, defaultColor, linkOpen, linkForm, onCloseLink, apiRef }) {
    const shell = useRef(null);
    const trigger = useRef(null);
    const dismissed = useRef(null);
    const selecting = useRef(false);
    const previous = useRef('');
    const refresh = useRef(() => {});
    const [context, setContext] = useState(null);
    const [panel, setPanel] = useState(null);
    const [position, setPosition] = useState(null);
    const callbacks = useRef({ onCloseLink });
    callbacks.current = { onCloseLink };
    const focusFirst = () => requestAnimationFrame(() => {
        const area = shell.current?.querySelector('.ee-context-menu, .ee-link-form') || shell.current;
        area?.querySelector('input:not([type="color"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
    });
    useEffect(() => {
        let frame;
        const stage = stageRef.current;
        if (!enabled || !stage || editor.isDestroyed) { setContext(null); setPanel(null); return; }
        selecting.current = false;
        dismissed.current = null;
        const editorDom = editor.view.dom;
        const update = () => {
            frame = null;
            if (editor.isDestroyed || !editor.isEditable || editor.view.composing || selecting.current || !stage.getClientRects().length) { setContext(null); return; }
            const active = document.activeElement;
            if (editorDom.contains(active) && active?.matches('input, textarea, select')) { setContext(null); return; }
            const inTools = shell.current?.contains(active) || trigger.current?.contains(active);
            if (!linkOpen && (!editor.view.dom.contains(active) && !inTools)) { setContext(null); return; }
            if (!linkOpen && dismissed.current?.eq(editor.state.selection)) { setContext(null); return; }
            const selection = selectionContext(editor.state);
            const next = linkOpen ? { ...(selection || {}), kind: 'linkForm', from: editor.state.selection.from, to: editor.state.selection.to } : selection;
            if (!next) { setContext(null); return; }
            const key = `${next.kind}:${next.from}:${next.to}`;
            if (previous.current !== key) { previous.current = key; setPanel(null); }
            const stageRect = stage.getBoundingClientRect();
            const bounds = { left: Math.max(8, stageRect.left + 8), right: Math.min(window.innerWidth - 8, stageRect.right - 8), top: Math.max(8, stageRect.top + 8), bottom: Math.min(window.innerHeight - 8, stageRect.bottom - 8) };
            if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) { setContext(null); return; }
            let anchor;
            if (next.anchor != null && next.kind !== 'block') anchor = editor.view.nodeDOM(next.anchor)?.getBoundingClientRect();
            if (!anchor) {
                const start = editor.view.coordsAtPos(next.from);
                const end = editor.view.coordsAtPos(next.to);
                anchor = { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
                if (anchor.bottom - anchor.top > (bounds.bottom - bounds.top) / 2) anchor = editor.view.coordsAtPos(editor.state.selection.head);
            }
            if (!placeContextToolbar(anchor, bounds, { width: 1, height: 1 })) { setContext(null); return; }
            const gutter = Math.max(bounds.left, editor.view.dom.getBoundingClientRect().left - 38);
            setContext({ ...next, anchorRect: anchor, bounds, gutter });
        };
        const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
        refresh.current = schedule;
        const focus = () => { dismissed.current = null; schedule(); };
        const pointerDown = event => {
            if (editor.view.dom.contains(event.target)) { dismissed.current = null; selecting.current = true; setContext(null); }
            else if (!shell.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
                dismissed.current = editor.state.selection;
                setContext(null);
                setPanel(null);
                if (linkOpen && !event.target.closest('.ee-toolbar')) callbacks.current.onCloseLink();
            }
        };
        const pointerUp = () => { selecting.current = false; schedule(); };
        const dragStart = () => { selecting.current = true; setContext(null); };
        const compositionStart = () => { setContext(null); };
        editor.on('transaction', schedule).on('selectionUpdate', schedule).on('focus', focus).on('blur', schedule);
        document.addEventListener('focusin', schedule);
        document.addEventListener('pointerdown', pointerDown);
        document.addEventListener('pointerup', pointerUp);
        document.addEventListener('dragstart', dragStart);
        document.addEventListener('dragend', pointerUp);
        editor.view.dom.addEventListener('compositionstart', compositionStart);
        editor.view.dom.addEventListener('compositionend', schedule);
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule);
        observer.observe(stage);
        observer.observe(editor.view.dom);
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            editor.off('transaction', schedule).off('selectionUpdate', schedule).off('focus', focus).off('blur', schedule);
            document.removeEventListener('focusin', schedule);
            document.removeEventListener('pointerdown', pointerDown);
            document.removeEventListener('pointerup', pointerUp);
            document.removeEventListener('dragstart', dragStart);
            document.removeEventListener('dragend', pointerUp);
            editorDom.removeEventListener('compositionstart', compositionStart);
            editorDom.removeEventListener('compositionend', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            observer.disconnect();
        };
    }, [editor, stageRef, enabled, linkOpen]);
    useLayoutEffect(() => {
        if (!context || !shell.current) { setPosition(null); return; }
        const measure = () => {
            if (!shell.current) return;
            const next = placeContextToolbar(context.anchorRect, context.bounds, shell.current.getBoundingClientRect());
            setPosition(current => current?.left === next?.left && current?.top === next?.top ? current : next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(shell.current);
        return () => observer.disconnect();
    }, [context, panel, linkOpen]);
    useEffect(() => { if (linkOpen && context?.kind === 'linkForm') focusFirst(); }, [linkOpen, context?.kind]);
    useEffect(() => {
        apiRef.current = {
            focus: () => {
                const button = shell.current?.querySelector('button:not(:disabled)') || trigger.current;
                button?.focus();
                return !!button;
            },
            dismiss: () => {
                dismissed.current = editor.state.selection;
                setContext(null);
                setPanel(null);
                callbacks.current.onCloseLink();
            },
        };
        return () => { apiRef.current = null; };
    }, [apiRef, context, editor]);
    if (!context || !enabled) return null;
    const kind = context.kind;
    if (kind !== 'linkForm' && selectionContext(editor.state)?.kind !== kind) return null;
    const openPanel = name => {
        if (panel === name) {
            (name === 'block' ? trigger.current : shell.current?.querySelector('button[aria-expanded="true"]'))?.focus();
            setPanel(null);
        } else { setPanel(name); focusFirst(); }
    };
    const close = () => {
        if (linkOpen) onCloseLink();
        setPanel(null);
        editor.view.focus();
        dismissed.current = editor.state.selection;
        setContext(null);
    };
    const run = command => { editor.view.focus(); setPanel(null); actions[command]?.(); refresh.current(); };
    const button = (command, active, action, disabled) => <CommandButton key={command} command={command} active={active} disabled={disabled} action={action || (() => run(command))} />;
    const menuButton = (command, name) => <CommandButton command={command} action={() => openPanel(name)} aria-expanded={panel === name} aria-haspopup="true" />;
    const adjacent = where => {
        const at = context[where];
        editor.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).run();
        setPanel(null);
    };
    const image = editor.getAttributes('image');
    const remove = () => { editor.chain().focus().deleteSelection().run(); setPanel(null); };
    const onKeyDown = event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            if (panel && panel !== 'block') { setPanel(null); requestAnimationFrame(() => shell.current?.querySelector('button:not(:disabled)')?.focus()); }
            else close();
            return;
        }
        if (event.target.tagName !== 'BUTTON' || event.altKey || event.metaKey || event.ctrlKey) return;
        const row = event.target.closest('[role="toolbar"], .ee-context-menu');
        if (!row) return;
        const controls = [...row.querySelectorAll('button:not(:disabled), select:not(:disabled)')];
        const index = toolbarFocusIndex(controls.indexOf(event.target), event.key, controls.length);
        if (index >= 0) { event.preventDefault(); controls[index].focus(); }
    };
    const showToolbar = kind !== 'block' || panel === 'block';
    return <>
        {kind === 'block' && <button ref={trigger} type="button" className="ee-block-trigger" style={{ left: context.gutter, top: Math.max(context.bounds.top, Math.min(context.bounds.bottom - 30, context.anchorRect.top)) }} title={l('quickInsert')} aria-label={l('quickInsert')} aria-expanded={panel === 'block'} onMouseDown={event => event.preventDefault()} onClick={() => openPanel('block')} onKeyDown={onKeyDown}>+</button>}
        {showToolbar && <div ref={shell} className="ee-context-toolbar" style={{ left: position?.left ?? context.bounds.left, top: position?.top ?? context.bounds.top, maxWidth: context.bounds.right - context.bounds.left, maxHeight: context.bounds.bottom - context.bounds.top, visibility: position ? 'visible' : 'hidden' }} onKeyDown={onKeyDown} onMouseDown={event => { if (event.target.closest('button')) event.preventDefault(); }}>
            {kind === 'linkForm' ? linkForm : <div className="ee-context-actions" role="toolbar" aria-label={l(`${kind}Tools`)}>
                {kind === 'text' && <>{['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript'].map(key => button(key, editor.isActive(key), undefined, ['superscript', 'subscript'].includes(key) ? !canApplyScript(editor, key) : !editor.can().toggleMark(key)))}<CommandButton command="color" action={() => run('color')} disabled={!editor.can().setColor('#000000')} aria-haspopup="dialog" style={{ '--ee-text-color': editor.getAttributes('textStyle').color || defaultColor }} /><CommandButton command="textBackground" action={() => run('textBackground')} disabled={!editor.can().setBackgroundColor('#fff176')} aria-haspopup="dialog" style={{ '--ee-text-color': editor.getAttributes('textStyle').backgroundColor || 'transparent' }} />{button('highlight', editor.isActive('highlight'))}{button('textStyles')}<i />{button('link')}{button('footnote')}{button('reset')}<i /><IndentControls editor={editor} actions={actions} /></>}
                {kind === 'link' && <><span className="ee-context-link" title={context.href.startsWith('epub:') ? l('internal') : context.href}>{context.href.startsWith('epub:') ? l('internal') : context.href}</span>{button('editLink', undefined, () => run('link'))}{button('unlink', undefined, () => editor.chain().focus().extendMarkRange('link').unsetLink().run())}</>}
                {kind === 'image' && <>
                    {['left', 'center', 'right'].map(align => button(`image${align}`, image.align === align && (!image.textWrap || image.textWrap === 'none'), () => editor.chain().focus().updateAttributes('image', imageAlignmentPatch(align)).run()))}
                    {['left', 'right'].map(side => button(side === 'left' ? 'imageTextLeft' : 'imageTextRight', image.textWrap === side, () => editor.chain().focus().updateAttributes('image', imageTextWrapPatch(image, side)).run()))}
                    <i />{button('imageAlt')}{button('imageSize')}{button('imageEdit')}{button('imageProperties')}{button('remove', undefined, remove)}
                </>}
                {kind === 'audio' && <>{button('audioProperties')}{button('remove', undefined, remove)}</>}
                {kind === 'media' && <>{button('editMedia')}{button('openMedia')}{button('remove', undefined, remove)}</>}
                {kind === 'footnote' && <><span className="ee-context-note" title={editor.getAttributes('footnote').text}>{editor.getAttributes('footnote').text || l('footnote')}</span>{button('footnote', undefined, () => run('footnote'))}{button('remove', undefined, remove)}</>}
                {kind === 'table' && <>{menuButton('tableRows', 'rows')}{menuButton('tableColumns', 'columns')}{button('selectCells')}{button('mergeCells', undefined, undefined, !editor.can().mergeCells())}{button('splitCell', undefined, undefined, !editor.can().splitCell())}{button('cellProperties')}{button('deleteTable')}</>}
                {['image', 'audio', 'media', 'table'].includes(kind) && <><i />{button('paragraphBefore', undefined, () => adjacent('before'))}{button('paragraphAfter', undefined, () => adjacent('after'))}</>}
                {kind === 'block' && <>{['paragraph', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'blockquote', 'templates', 'addImage', 'addTable', 'addAudio', 'media', 'specialCharacters', 'emoji', 'footnote', 'horizontalRule', 'columns', 'splitChapter'].map(command => button(command))}<i /><IndentControls editor={editor} actions={actions} /></>}
            </div>}
            {['rows', 'columns'].includes(panel) && <div className="ee-context-menu" role="group" aria-label={l(panel === 'rows' ? 'tableRows' : 'tableColumns')}>
                {(panel === 'rows' ? ['addRowBefore', 'addRowAfter', 'toggleHeaderRow', 'deleteRow'] : ['addColumnBefore', 'addColumnAfter', 'toggleHeaderColumn', 'deleteColumn']).map(command => <CommandButton key={command} command={command} showLabel disabled={!editor.can()[command]()} action={() => run(command)} />)}
            </div>}
        </div>}
    </>;
}
