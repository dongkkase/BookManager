import { useEffect, useRef, useState } from 'react';
import { createViewerScrollController } from './viewerScroll.js';
import { useReducedMotion } from './hooks/useReducedMotion';

export function useViewerScroll({ scrollRef, enabled, settings, sessionKey, blocked = false }) {
    const reducedMotion = useReducedMotion();
    const [autoScrolling, setAutoScrolling] = useState(false);
    const stateRef = useRef(null);
    stateRef.current = { scrollRef, enabled, settings, blocked, reducedMotion };
    const controllerRef = useRef(null);
    if (controllerRef.current === null) {
        controllerRef.current = createViewerScrollController({
            getElement: () => stateRef.current.scrollRef.current,
            getSettings: () => stateRef.current.settings,
            isEnabled: () => stateRef.current.enabled,
            isBlocked: () => stateRef.current.blocked || document.hidden,
            isMotionReduced: () => stateRef.current.reducedMotion,
            onAutoScrollChange: setAutoScrolling,
        });
    }
    const controller = controllerRef.current;

    useEffect(() => {
        if (reducedMotion) controller.finishMotion();
    }, [controller, reducedMotion]);

    useEffect(() => {
        controller.cancelMotion();
        const element = scrollRef.current;
        const cancelMotion = controller.cancelMotion;
        element?.addEventListener('pointerdown', cancelMotion, { passive: true });
        element?.addEventListener('touchstart', cancelMotion, { passive: true });
        return () => {
            element?.removeEventListener('pointerdown', cancelMotion);
            element?.removeEventListener('touchstart', cancelMotion);
            controller.cancelMotion();
        };
    }, [controller, scrollRef, enabled, sessionKey]);

    useEffect(() => {
        if (blocked) controller.cancelMotion();
    }, [blocked, controller]);

    useEffect(() => {
        const cancelMotion = controller.cancelMotion;
        const handleVisibilityChange = () => {
            if (document.hidden) cancelMotion();
        };
        window.addEventListener('blur', cancelMotion);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('blur', cancelMotion);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            controller.cancelMotion();
        };
    }, [controller]);

    return {
        autoScrolling,
        startAutoScroll: controller.startAutoScroll,
        stopAutoScroll: controller.stopAutoScroll,
        toggleAutoScroll: controller.toggleAutoScroll,
        scrollByKeyboard: controller.scrollByKeyboard,
        handleScrollWheel: controller.handleScrollWheel,
        cancelMotion: controller.cancelMotion,
    };
}
