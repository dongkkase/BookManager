import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import { MenuSurface } from '../MenuSurface';
import { clampContextMenuPosition } from '../../folderContextState';

export function DetailActionsMenu({ open, anchor, label, items, onAction, onClose }) {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!open || !anchor || !menu) return;
        const bounds = anchor.getBoundingClientRect();
        const below = bounds.bottom + 4;
        const y = below + menu.offsetHeight <= window.innerHeight - 8
            ? below : bounds.top - menu.offsetHeight - 4;
        setPosition(clampContextMenuPosition(
            bounds.right - menu.offsetWidth, y, menu.offsetWidth, menu.offsetHeight,
            window.innerWidth, window.innerHeight,
        ));
        menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    }, [open, anchor]);

    useEffect(() => {
        if (!open) return;
        const handleScroll = event => {
            if (!menuRef.current?.contains(event.target)) onClose();
        };
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [open, onClose]);

    const handleKeyDown = event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            anchor?.focus({ preventScroll: true });
        } else if (event.key === 'Tab') {
            onClose();
            anchor?.focus({ preventScroll: true });
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const buttons = Array.from(menuRef.current.querySelectorAll('button:not(:disabled)'));
            const current = buttons.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
        }
    };

    return createPortal(
        <MenuSurface
            open={open}
            ref={menuRef}
            id="folder-detail-actions-menu"
            className="folder-context-menu"
            role="menu"
            aria-label={label}
            style={{ left: position.x, top: position.y }}
            onClick={event => event.stopPropagation()}
            onKeyDown={handleKeyDown}
        >
            {items.map(item => (
                <React.Fragment key={item.action}>
                    {item.separator && <div className="folder-context-menu-separator" role="separator" />}
                    <button
                        type="button"
                        role="menuitem"
                        className={`folder-context-menu-item${item.danger ? ' is-danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => onAction(item.action)}
                    >
                        <span className="folder-context-menu-icon"><FaIcon name={item.icon} size={12} /></span>
                        <span className="folder-context-menu-label">{item.label}</span>
                    </button>
                </React.Fragment>
            ))}
        </MenuSurface>,
        document.body,
    );
}
