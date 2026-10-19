import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/Tooltip.css';

export function TooltipPopup({ target, label, id }) {
    const popup = useRef(null);
    const [position, setPosition] = useState(null);

    useLayoutEffect(() => {
        if (!target?.isConnected || !popup.current) return;
        const font = getComputedStyle(target);
        popup.current.style.fontFamily = font.fontFamily;
        popup.current.style.fontSize = font.getPropertyValue('--font-xs') || '11px';
        const anchor = target.getBoundingClientRect();
        const box = popup.current.getBoundingClientRect();
        const margin = 8;
        const center = anchor.left + anchor.width / 2;
        const left = Math.max(margin, Math.min(center - box.width / 2, window.innerWidth - box.width - margin));
        const top = Math.max(margin, anchor.top - box.height - margin);
        setPosition({
            left,
            top,
            arrow: Math.max(10, Math.min(center - left, box.width - 10)),
            showArrow: top + box.height < anchor.top,
        });
    }, [target, label]);

    useEffect(() => {
        const descriptions = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        target.setAttribute('aria-describedby', [...new Set([...descriptions, id])].join(' '));
        return () => {
            const remaining = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(value => value && value !== id);
            if (remaining.length) target.setAttribute('aria-describedby', remaining.join(' '));
            else target.removeAttribute('aria-describedby');
        };
    }, [target, id]);

    return createPortal(
        <span
            ref={popup}
            id={id}
            role="tooltip"
            className="app-tooltip"
            data-arrow={position?.showArrow ? 'true' : undefined}
            style={{ left: position?.left, top: position?.top, '--tooltip-arrow-left': `${position?.arrow || 0}px`, visibility: position ? 'visible' : 'hidden' }}
        >
            {label}
        </span>,
        target.closest('dialog[open]') || document.body,
    );
}

export function TooltipLayer() {
    const id = useId();
    const [tooltip, setTooltip] = useState(null);

    useEffect(() => {
        let activeTarget = null;
        const hide = () => {
            activeTarget = null;
            setTooltip(null);
        };
        const findTarget = node => node instanceof Element ? node.closest('[data-tooltip]') : null;
        const show = target => {
            const label = target?.getAttribute('data-tooltip');
            if (!label) {
                hide();
                return;
            }
            if (target === activeTarget) return;
            activeTarget = target;
            setTooltip({ target, label });
        };
        const handlePointerOver = event => {
            if (event.pointerType !== 'touch') show(findTarget(event.target));
        };
        const handlePointerOut = event => {
            if (activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
        };
        const handleFocus = event => {
            const target = findTarget(event.target);
            if (target?.matches(':focus-visible')) show(target);
        };
        document.addEventListener('pointerover', handlePointerOver);
        document.addEventListener('pointerout', handlePointerOut);
        document.addEventListener('focusin', handleFocus);
        document.addEventListener('focusout', hide);
        const dismissEvents = ['scroll', 'resize', 'pointerdown', 'keydown', 'blur'];
        for (const name of dismissEvents) window.addEventListener(name, hide, true);
        return () => {
            document.removeEventListener('pointerover', handlePointerOver);
            document.removeEventListener('pointerout', handlePointerOut);
            document.removeEventListener('focusin', handleFocus);
            document.removeEventListener('focusout', hide);
            for (const name of dismissEvents) window.removeEventListener(name, hide, true);
        };
    }, []);

    return tooltip ? <TooltipPopup target={tooltip.target} label={tooltip.label} id={id} /> : null;
}
