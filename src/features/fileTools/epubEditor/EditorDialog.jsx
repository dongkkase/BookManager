import React, { useEffect, useRef } from 'react';
import { editorText as l } from './labels';

export default function EditorDialog({ title, onClose, children, footer, className = '', onKeyDown, onSubmit }) {
    const ref = useRef(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const prior = document.activeElement;
        const dialog = ref.current;
        const editor = dialog.closest('.epub-editor-tool')?.querySelector('.tiptap');
        dialog.showModal();
        dialog.querySelector('textarea, input:not([type="checkbox"])')?.focus();
        const cancel = event => { event.preventDefault(); close.current(); };
        dialog.addEventListener('cancel', cancel);
        return () => {
            dialog.removeEventListener('cancel', cancel);
            dialog.close();
            const target = prior?.isConnected && prior !== document.body && prior.getClientRects().length ? prior : editor;
            if (target?.getClientRects().length) target.focus();
        };
    }, []);
    const Content = onSubmit ? 'form' : 'div';
    return <dialog className={`ee-dialog ${className}`} ref={ref} aria-label={title} onKeyDown={onKeyDown}>
        <header><h2>{title}</h2><button type="button" className="ee-button" onClick={onClose}>{l('close')} · Esc</button></header>
        <Content className="ee-dialog-content" onSubmit={onSubmit}>
            <div className="ee-dialog-body">{children}</div>
            {footer && <footer className="ee-dialog-footer">{footer}</footer>}
        </Content>
    </dialog>;
}
