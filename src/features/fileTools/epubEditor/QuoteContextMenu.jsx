import React, { useEffect, useRef } from 'react';
import { editorText as l } from './labels';
import { QUOTE_PAIRS, canInsertQuotes } from './quotes';

export default function QuoteContextMenu({ editor, enabled, actions }) {
    const popup = useRef(null);
    const close = () => popup.current?.hidePopover();
    useEffect(() => {
        const menu = popup.current;
        if (!enabled) { menu.hidePopover(); return; }
        const dom = editor.view.dom;
        const show = event => {
            if (event.target.closest('input, textarea, select') || !canInsertQuotes(editor) || editor.state.selection.empty) return;
            event.preventDefault();
            event.stopPropagation();
            menu.showPopover();
            const caret = editor.view.coordsAtPos(editor.state.selection.head);
            const x = event.type === 'keydown' || (!event.clientX && !event.clientY) ? caret.left : event.clientX;
            const y = event.type === 'keydown' || (!event.clientX && !event.clientY) ? caret.bottom : event.clientY;
            const rect = menu.getBoundingClientRect();
            menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x))}px`;
            menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y))}px`;
            menu.querySelector('button')?.focus({ preventScroll: true });
        };
        const keyboard = event => {
            if (!event.isComposing && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey))) show(event);
        };
        const dismiss = () => menu.hidePopover();
        // Native right-click can immediately dismiss auto popovers, so close this manual menu explicitly.
        const outside = event => { if (!menu.contains(event.target)) dismiss(); };
        const changed = ({ transaction }) => { if (transaction.docChanged || transaction.selectionSet) dismiss(); };
        dom.addEventListener('contextmenu', show);
        dom.addEventListener('keydown', keyboard);
        dom.addEventListener('compositionstart', dismiss);
        editor.on('transaction', changed);
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        return () => {
            dismiss();
            dom.removeEventListener('contextmenu', show);
            dom.removeEventListener('keydown', keyboard);
            dom.removeEventListener('compositionstart', dismiss);
            editor.off('transaction', changed);
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('focusin', outside);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', dismiss, true);
        };
    }, [editor, enabled]);
    const keydown = event => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') event.preventDefault();
            close();
            editor.view.focus();
            return;
        }
        const buttons = [...popup.current.querySelectorAll('button')];
        const current = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length : -1;
        if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
    };
    return <div ref={popup} popover="manual" className="ee-format-menu ee-quote-context-menu" role="menu" aria-label={l('quoteCharacters')} onKeyDown={keydown} onMouseDown={event => event.preventDefault()}>
        {QUOTE_PAIRS.map(pair => <button key={pair.command} type="button" className="ee-format-option" role="menuitem" onClick={() => { close(); editor.view.focus(); actions[pair.command](); }}><span className="ee-quote-symbol" aria-hidden="true">{pair.display}</span><span>{l(pair.command)}</span></button>)}
    </div>;
}
