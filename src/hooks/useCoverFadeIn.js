import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/mini';
import { useReducedMotion } from './useReducedMotion';

export function useCoverFadeIn(imageRef, src, loaded) {
    const reducedMotion = useReducedMotion();
    const revealedSource = useRef(null);

    useLayoutEffect(() => {
        const image = imageRef.current;
        if (!image) return undefined;
        if (!loaded) {
            revealedSource.current = null;
            image.style.opacity = '0';
            return undefined;
        }

        const shouldAnimate = !reducedMotion && revealedSource.current !== src;
        revealedSource.current = src;
        image.style.opacity = '1';
        if (!shouldAnimate) return undefined;

        const animation = animate(image, { opacity: [0, 1] }, { duration: 0.24, ease: 'easeOut' });
        return () => animation.stop();
    }, [imageRef, src, loaded, reducedMotion]);
}
