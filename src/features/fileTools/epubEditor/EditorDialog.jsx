import React, { useId, useLayoutEffect, useRef } from 'react';
import { editorText as l } from './labels';

const focusableSelector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"], audio[controls], video[controls]';
const textInputSelector = 'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([readonly])';

function canFocus(element) {
    return element?.isConnected && !element.matches(':disabled') && !element.closest('[hidden], [inert]')
        && element.getClientRects().length && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility);
}

function tabStops(dialog) {
    return [...dialog.querySelectorAll(focusableSelector)]
        .filter(element => canFocus(element) && (!element.hasAttribute('tabindex') || Number(element.getAttribute('tabindex')) >= 0))
        .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
}

export default function EditorDialog({ title, onClose, children, footer, className = '', onKeyDown, onSubmit }) {
    const titleId = useId();
    const ref = useRef(null);
    const closeButton = useRef(null);
    const close = useRef(onClose);
    close.current = onClose;
    useLayoutEffect(() => {
        const prior = document.activeElement;
        const dialog = ref.current;
        const editor = dialog.closest('.epub-editor-tool')?.querySelector('.tiptap');
        dialog.showModal();
        const focused = document.activeElement;
        if (!dialog.contains(focused) || focused === dialog || focused === closeButton.current) {
            const controls = tabStops(dialog);
            const initial = controls.find(element => element.hasAttribute('autofocus'))
                || controls.find(element => element.matches(textInputSelector))
                || controls.find(element => element !== closeButton.current)
                || closeButton.current;
            initial?.focus({ preventScroll: true });
        }
        const cancel = event => { event.preventDefault(); close.current?.(); };
        dialog.addEventListener('cancel', cancel);
        return () => {
            dialog.removeEventListener('cancel', cancel);
            dialog.close();
            const activeDialog = document.activeElement?.closest('dialog[open]');
            if (activeDialog && activeDialog !== dialog && !activeDialog.contains(prior)) return;
            const target = prior !== document.body && canFocus(prior) ? prior : editor;
            if (canFocus(target)) target.focus({ preventScroll: true });
        };
    }, []);
    const handleKeyDown = event => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== 'Tab' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target.closest('dialog') !== ref.current) return;
        const controls = tabStops(ref.current);
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first) { event.preventDefault(); ref.current.focus(); return; }
        if (event.shiftKey && (active === first || active === ref.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || active === ref.current)) {
            event.preventDefault();
            first.focus();
        }
    };
    const Content = onSubmit ? 'form' : 'div';
    return <dialog className={`ee-dialog ${className}`} ref={ref} aria-labelledby={titleId} aria-modal="true" onKeyDown={handleKeyDown}>
        <header><h2 id={titleId}>{title}</h2><button ref={closeButton} type="button" className="ee-dialog-close" aria-label={l('close')} aria-keyshortcuts="Escape" title={`${l('close')} (Esc)`} onClick={onClose}><span aria-hidden="true">×</span></button></header>
        <Content className="ee-dialog-content" onSubmit={onSubmit}>
            <div className="ee-dialog-body">{children}</div>
            {footer && <footer className="ee-dialog-footer">{footer}</footer>}
        </Content>
    </dialog>;
}
