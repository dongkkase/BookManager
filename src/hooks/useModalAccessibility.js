import { useEffect, useRef } from 'react';

const FOCUSABLE = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalAccessibility(isOpen, onEscape) {
    const dialogRef = useRef(null);
    const escapeRef = useRef(onEscape);

    useEffect(() => {
        escapeRef.current = onEscape;
    }, [onEscape]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusables = () => [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
        window.requestAnimationFrame(() => focusables()[0]?.focus());

        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                escapeRef.current?.();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) {
                event.preventDefault();
                dialogRef.current?.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            document.body.style.overflow = previousOverflow;
            previousFocus?.focus?.();
        };
    }, [isOpen]);

    return dialogRef;
}
