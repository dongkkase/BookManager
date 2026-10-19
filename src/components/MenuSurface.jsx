import React, { createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import '../styles/MenuSurface.css';

const MenuOpenContext = createContext(true);
const OPEN_DURATION = 170;
const CLOSE_DURATION = 140;
const OPEN_VISUAL = { opacity: '1', translate: '0px 0px', scale: '1' };

export function useMenuSurfaceOpen() {
    return useContext(MenuOpenContext);
}

function readVisual(node) {
    const computed = window.getComputedStyle(node);
    return {
        opacity: computed.opacity || '1',
        translate: computed.translate === 'none' ? '0px 0px' : computed.translate || '0px 0px',
        scale: computed.scale === 'none' ? '1' : computed.scale || '1',
    };
}

export const MenuSurface = forwardRef(function MenuSurface({ open, origin, children, className, style, ...props }, forwardedRef) {
    const reducedMotion = useReducedMotion();
    const parentOpen = useContext(MenuOpenContext);
    const effectiveOpen = Boolean(open) && parentOpen;
    const [present, setPresent] = useState(effectiveOpen);
    const nodeRef = useRef(null);
    const lastOpenProps = useRef(null);
    const lastVisual = useRef(null);
    const entrancePending = useRef(false);
    const shouldRender = effectiveOpen || present;
    const currentProps = { ...props, origin, children, className, style: style ? { ...style } : undefined };
    const renderedProps = effectiveOpen ? currentProps : lastOpenProps.current;
    const setNode = useCallback(node => {
        nodeRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);

    useLayoutEffect(() => {
        if (effectiveOpen) lastOpenProps.current = currentProps;
    });

    useLayoutEffect(() => {
        const node = nodeRef.current;
        if (!node) {
            lastVisual.current = null;
            lastOpenProps.current = null;
            entrancePending.current = false;
            return undefined;
        }
        if (reducedMotion) {
            entrancePending.current = false;
            lastVisual.current = effectiveOpen ? OPEN_VISUAL : null;
            setPresent(effectiveOpen);
            return undefined;
        }

        let animation;
        let frame;
        let closeTimer;
        let disposed = false;
        const animate = (keyframes, duration, easing) => {
            if (typeof node.animate !== 'function') return undefined;
            return node.animate(keyframes, { duration, easing, fill: 'both' });
        };

        if (effectiveOpen) {
            setPresent(true);
            const previous = entrancePending.current ? null : lastVisual.current;
            const from = previous || { opacity: '0', translate: '0px -4px', scale: '0.98' };
            // 최초 위치 측정에는 배율을 적용하지 않습니다.
            const waiting = previous || { opacity: '0' };
            entrancePending.current = true;
            animation = animate([waiting, waiting], 1, 'linear');
            frame = window.requestAnimationFrame(() => {
                if (disposed) return;
                entrancePending.current = false;
                animation?.cancel();
                animation = animate([from, OPEN_VISUAL], OPEN_DURATION, 'cubic-bezier(0.2, 0.7, 0.2, 1)');
            });
        } else {
            entrancePending.current = false;
            const from = lastVisual.current || readVisual(node);
            animation = animate([from, { opacity: '0', translate: '0px 2px', scale: '0.98' }], CLOSE_DURATION, 'ease-in');
            const finishClose = () => {
                if (!disposed) setPresent(false);
            };
            if (animation) animation.onfinish = finishClose;
            else closeTimer = window.setTimeout(finishClose, CLOSE_DURATION);
        }

        return () => {
            disposed = true;
            if (frame !== undefined) window.cancelAnimationFrame(frame);
            if (closeTimer !== undefined) window.clearTimeout(closeTimer);
            lastVisual.current = readVisual(node);
            if (animation) animation.onfinish = null;
            animation?.cancel();
        };
    }, [effectiveOpen, shouldRender, reducedMotion]);

    if (!shouldRender || !renderedProps) return null;

    const { origin: renderedOrigin, children: renderedChildren, className: renderedClassName, style: renderedStyle, ...divProps } = renderedProps;
    return (
        <MenuOpenContext.Provider value={effectiveOpen}>
            <div
                {...divProps}
                ref={setNode}
                className={`menu-surface${renderedClassName ? ` ${renderedClassName}` : ''}`}
                style={{ ...renderedStyle, transformOrigin: renderedOrigin || renderedStyle?.transformOrigin || 'top left' }}
                data-menu-state={effectiveOpen ? 'open' : 'closing'}
                inert={effectiveOpen ? divProps.inert : ''}
                aria-hidden={effectiveOpen ? divProps['aria-hidden'] : true}
            >
                {renderedChildren}
            </div>
        </MenuOpenContext.Provider>
    );
});

export default MenuSurface;
