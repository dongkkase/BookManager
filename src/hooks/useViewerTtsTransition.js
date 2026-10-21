import { useLayoutEffect, useRef, useState } from 'react';
import { animate } from 'motion/mini';
import { useReducedMotion } from './useReducedMotion';

export function useViewerTtsTransition(open) {
    const reducedMotion = useReducedMotion();
    const controlRef = useRef(null);
    const menuRef = useRef(null);
    const savedControlsRef = useRef(new Map());
    const [retained, setRetained] = useState(false);
    const present = open || retained;
    const restoreControls = () => {
        for (const [node, saved] of savedControlsRef.current) {
            node.style.opacity = saved.opacity;
            node.style.translate = saved.translate;
            node.inert = saved.inert;
        }
        savedControlsRef.current.clear();
    };

    useLayoutEffect(() => {
        const menu = menuRef.current;
        const control = controlRef.current;
        const group = control?.closest('.viewer-tool-group');
        if (!present || !menu || !group) {
            restoreControls();
            return undefined;
        }
        const controls = [
            ...group.querySelectorAll(':scope > .viewer-tool-cluster:not(.viewer-tts-cluster)'),
            control.querySelector('.viewer-tts-toggle-button'),
        ].filter(Boolean);
        for (const node of controls) {
            if (!savedControlsRef.current.has(node)) {
                savedControlsRef.current.set(node, {
                    opacity: node.style.opacity,
                    translate: node.style.translate,
                    inert: node.inert,
                });
            }
            node.inert = true;
        }
        if (open) setRetained(true);
        const applyFinalStyles = () => {
            for (const node of controls) {
                node.style.opacity = open ? '0' : '1';
                node.style.translate = open ? '-6px 0px' : '0px 0px';
            }
            menu.style.opacity = open ? '1' : '0';
            menu.style.translate = open ? '0px 0px' : '6px 0px';
            if (!open) {
                restoreControls();
                setRetained(false);
            }
        };
        if (reducedMotion) {
            applyFinalStyles();
            return undefined;
        }
        if (open && !retained) {
            menu.style.opacity = '0';
            menu.style.translate = '6px 0px';
        }
        const animations = [
            animate(controls, { opacity: open ? 0 : 1, translate: open ? '-6px 0px' : '0px 0px' }, {
                duration: open ? 0.12 : 0.18,
                ease: [0.22, 1, 0.36, 1],
            }),
            animate(menu, { opacity: open ? 1 : 0, translate: open ? '0px 0px' : '6px 0px' }, {
                duration: open ? 0.2 : 0.14,
                ease: [0.22, 1, 0.36, 1],
            }),
        ];
        let disposed = false;
        let finished = false;
        const finish = () => {
            if (disposed || finished) return;
            finished = true;
            window.clearTimeout(fallback);
            animations.forEach(animation => animation.stop());
            applyFinalStyles();
        };
        const fallback = window.setTimeout(finish, 280);
        Promise.all(animations).then(finish);
        return () => {
            disposed = true;
            window.clearTimeout(fallback);
            animations.forEach(animation => animation.stop());
        };
    }, [open, present, reducedMotion]);

    useLayoutEffect(() => () => restoreControls(), []);

    return { present, controlRef, menuRef };
}
