import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dropdownVerticalPlacement } from '../../interactionPolicy';
import { FaIcon } from '../FaIcon';
import MenuSurface from '../MenuSurface';

const OPEN_EVENT = 'bookmanager-toolbar-dropdown-open';

function menuItems(menu) {
    return Array.from(menu?.querySelectorAll('button:not(:disabled)') || [])
        .filter(item => item.getAttribute('aria-disabled') !== 'true');
}

function focusMenuItem(menu, item) {
    if (!menu || !item) return;
    item.focus({ preventScroll: true });
    const menuRect = menu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < menuRect.top) menu.scrollTop -= menuRect.top - itemRect.top;
    else if (itemRect.bottom > menuRect.bottom) menu.scrollTop += itemRect.bottom - menuRect.bottom;
}

export function ToolbarDropdown({
    buttonClassName = '',
    buttonLabel,
    children,
    open,
    setOpen,
    menuClassName = '',
    ariaLabel,
    value,
    className = '',
    disabled = false,
}) {
    const id = useId();
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const setOpenRef = useRef(setOpen);
    const openRef = useRef(open);
    const initialFocusRef = useRef('selected');
    const wasOpenRef = useRef(false);
    const [position, setPosition] = useState({ placement: 'down', left: 0, top: 0 });
    const isOpen = Boolean(open) && !disabled;
    const label = String(buttonLabel || '').replace(/\s*▼\s*$/u, '');
    setOpenRef.current = setOpen;
    openRef.current = isOpen;

    const updateOpen = useCallback(nextOpen => setOpenRef.current(nextOpen), []);
    const closeAndFocus = useCallback(() => {
        updateOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
    }, [updateOpen]);

    useEffect(() => {
        const closeOtherMenu = event => {
            if (event.detail !== id && openRef.current) updateOpen(false);
        };
        document.addEventListener(OPEN_EVENT, closeOtherMenu);
        return () => document.removeEventListener(OPEN_EVENT, closeOtherMenu);
    }, [id, updateOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const closeOutside = event => {
            if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
                updateOpen(false);
            }
        };
        const closeOnScroll = event => {
            if (!menuRef.current?.contains(event.target)) updateOpen(false);
        };
        const closeOnResize = () => updateOpen(false);
        const handleEscape = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeAndFocus();
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('scroll', closeOnScroll, true);
        document.addEventListener('keydown', handleEscape, true);
        window.addEventListener('resize', closeOnResize);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('scroll', closeOnScroll, true);
            document.removeEventListener('keydown', handleEscape, true);
            window.removeEventListener('resize', closeOnResize);
        };
    }, [closeAndFocus, isOpen, updateOpen]);

    useLayoutEffect(() => {
        if (!isOpen) {
            if (wasOpenRef.current && menuRef.current?.contains(document.activeElement)) {
                triggerRef.current?.focus({ preventScroll: true });
            }
            wasOpenRef.current = false;
            return;
        }
        wasOpenRef.current = true;
        const trigger = triggerRef.current;
        const menu = menuRef.current;
        if (!trigger || !menu) return;
        document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
        const triggerRect = trigger.getBoundingClientRect();
        const panelRect = trigger.closest('.folder-right-panel')?.getBoundingClientRect();
        const minLeft = Math.max(8, (panelRect?.left ?? 0) + 8);
        const maxRight = Math.min(window.innerWidth - 8, (panelRect?.right ?? window.innerWidth) - 8);
        const maxWidth = Math.max(0, maxRight - minLeft);
        const minWidth = Math.min(triggerRect.width, maxWidth);
        menu.style.maxWidth = `${maxWidth}px`;
        menu.style.minWidth = `${minWidth}px`;
        menu.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
        const placement = dropdownVerticalPlacement(triggerRect, menu.offsetHeight + 11, window.innerHeight);
        const maxHeight = Math.max(0, placement === 'up'
            ? triggerRect.top - 11
            : window.innerHeight - triggerRect.bottom - 11);
        menu.style.maxHeight = `${maxHeight}px`;
        const left = Math.max(minLeft, Math.min(triggerRect.left, maxRight - menu.offsetWidth));
        const top = placement === 'up'
            ? Math.max(8, triggerRect.top - menu.offsetHeight - 3)
            : triggerRect.bottom + 3;
        setPosition({ placement, left, top, maxWidth, minWidth, maxHeight });
        const items = menuItems(menu);
        const selected = items.find(item => item.getAttribute('aria-checked') === 'true' || item.classList.contains('active'));
        const initial = initialFocusRef.current === 'last' ? items.at(-1)
            : initialFocusRef.current === 'first' ? items[0] : selected || items[0];
        focusMenuItem(menu, initial);
        initialFocusRef.current = 'selected';
    }, [id, isOpen]);

    useEffect(() => {
        if (disabled && open) updateOpen(false);
    }, [disabled, open, updateOpen]);

    const handleTriggerKeyDown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
        if (isOpen) {
            const items = menuItems(menuRef.current);
            focusMenuItem(menuRef.current, event.key === 'ArrowUp' ? items.at(-1) : items[0]);
        } else updateOpen(true);
    };

    const handleMenuKeyDown = event => {
        event.stopPropagation();
        if (event.key === 'Tab') {
            closeAndFocus();
            return;
        }
        const items = menuItems(menuRef.current);
        const current = items.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
        else if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length];
        else if (event.key === 'Home') next = items[0];
        else if (event.key === 'End') next = items.at(-1);
        else if (event.key === 'Enter' || event.key === ' ') {
            if (current < 0) return;
            event.preventDefault();
            items[current].click();
            return;
        } else return;
        event.preventDefault();
        focusMenuItem(menuRef.current, next);
    };

    return (
        <div className={`toolbar-dropdown ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                className={`toolbar-btn ${buttonClassName}`}
                aria-label={ariaLabel || label}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={isOpen ? id : undefined}
                data-value={value === undefined ? undefined : String(value)}
                disabled={disabled}
                onClick={() => updateOpen(!isOpen)}
                onKeyDown={handleTriggerKeyDown}
            >
                <span className="toolbar-dropdown-label">{label}</span>
                <FaIcon name="caret-down" size={9} />
            </button>
            {typeof document !== 'undefined' && createPortal(
                <MenuSurface
                    id={id}
                    open={isOpen}
                    ref={menuRef}
                    role="menu"
                    aria-label={ariaLabel || label}
                    origin={position.placement === 'up' ? 'bottom left' : 'top left'}
                    className={`dropdown-menu folder-toolbar-menu dropdown-menu-${position.placement} ${menuClassName}`}
                    style={{
                        position: 'fixed',
                        left: position.left,
                        top: position.top,
                        bottom: 'auto',
                        maxWidth: position.maxWidth,
                        minWidth: position.minWidth,
                        maxHeight: position.maxHeight,
                    }}
                    onKeyDown={handleMenuKeyDown}
                >
                    {children}
                </MenuSurface>,
                document.body,
            )}
        </div>
    );
}

export function ToolbarSelect({ label, value, options, onChange, className = '', buttonClassName = '', disabled = false }) {
    const [open, setOpen] = useState(false);
    const selected = options.find(option => String(option.value) === String(value));
    return (
        <ToolbarDropdown
            className={`toolbar-select ${className}`}
            buttonClassName={buttonClassName}
            buttonLabel={selected?.label || label}
            ariaLabel={label}
            value={value}
            open={open}
            setOpen={setOpen}
            disabled={disabled}
        >
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    aria-checked={String(option.value) === String(value)}
                    data-value={String(option.value)}
                    disabled={option.disabled}
                    className={`dropdown-item${String(option.value) === String(value) ? ' active' : ''}`}
                    onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                    }}
                >
                    <span className="check-mark" aria-hidden="true">{String(option.value) === String(value) ? '✓' : ''}</span>
                    <span className="dropdown-item-label">{option.label}</span>
                </button>
            ))}
        </ToolbarDropdown>
    );
}

export default ToolbarDropdown;
