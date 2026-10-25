import React, { useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const DURATION = 0.22;

export function DetailPanelDisclosure({ open, position, size, onSettled, children }) {
    const reducedMotion = useReducedMotion();
    const [present, setPresent] = useState(open);
    const previousRef = useRef(null);
    const animatingRef = useRef(false);
    const onSettledRef = useRef(onSettled);
    onSettledRef.current = onSettled;
    const basis = useMotionValue('0px');
    const opacity = useMotionValue(0);
    const isRight = position === 'right';
    const visible = open || (!reducedMotion && present);

    useLayoutEffect(() => {
        const previous = previousRef.current;
        previousRef.current = { open, position };
        const targetSize = `${open ? size : 0}px`;
        const targetOpacity = open ? 1 : 0;
        const immediate = reducedMotion
            || (previous && previous.position !== position)
            || (previous && previous.open === open && !animatingRef.current);
        let disposed = false;
        let finished = false;
        let timer;
        let frame;
        let animations = [];
        const finish = () => {
            if (disposed || finished) return;
            finished = true;
            window.clearTimeout(timer);
            animations.forEach(animation => animation.stop());
            basis.set(targetSize);
            opacity.set(targetOpacity);
            animatingRef.current = false;
            setPresent(open);
            frame = window.requestAnimationFrame(() => onSettledRef.current?.());
        };

        if (open) setPresent(true);
        if (immediate || (basis.get() === targetSize && opacity.get() === targetOpacity)) {
            finish();
        } else {
            animatingRef.current = true;
            const transition = { duration: DURATION, ease: [0.22, 1, 0.36, 1] };
            animations = [
                animate(basis, targetSize, transition),
                animate(opacity, targetOpacity, transition),
            ];
            timer = window.setTimeout(finish, DURATION * 1000 + 100);
            Promise.all(animations).then(finish, finish);
        }

        return () => {
            disposed = true;
            window.clearTimeout(timer);
            window.cancelAnimationFrame(frame);
            animations.forEach(animation => animation.stop());
        };
    }, [basis, opacity, open, position, reducedMotion, size]);

    return (
        <motion.div
            id="folder-detail-panel"
            className={`detail-panel-wrap${isRight ? ' is-right' : ''}`}
            hidden={!visible}
            aria-hidden={!open}
            inert={open ? undefined : ''}
            style={{ flexBasis: basis, flexShrink: 0, opacity }}
        >
            {visible && (
                <div
                    className="detail-panel-disclosure-content"
                    style={isRight ? { width: `${size}px`, height: '100%' } : { height: `${size}px`, width: '100%' }}
                >
                    {children}
                </div>
            )}
        </motion.div>
    );
}
