import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion, useMotionValue, useSpring } from 'motion/react';
import { FaIcon } from '../FaIcon';
import { SmoothCoverImage } from '../SmoothCoverImage';
import { paintAmbientCanvasFromSource } from '../../viewerAmbient';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const OPEN_DURATION = 0.46;
const CLOSE_DURATION = 0.22;
const TILT_SPRING = { stiffness: 180, damping: 24, mass: 0.7 };

function coverOrigin(sourceElement, body) {
    const source = sourceElement?.isConnected && sourceElement.getBoundingClientRect();
    const target = body?.getBoundingClientRect();
    if (!source?.width || !source.height || !target?.width || !target.height
        || source.bottom <= 0 || source.right <= 0 || source.top >= window.innerHeight || source.left >= window.innerWidth) {
        return { x: 0, y: 12, scale: 0.94 };
    }
    const x = source.left + source.width / 2 - target.left - target.width / 2;
    const y = source.top + source.height / 2 - target.top - target.height / 2;
    const scale = Math.min(source.width / target.width, source.height / target.height);
    return { x, y, scale };
}

export function CoverPreviewDialog({ src, filePath, sourceElement, previewKey, returnFocusElement, alt = '', t, onClose, onNavigate }) {
    const reducedMotion = useReducedMotion();
    const resourceKey = JSON.stringify([previewKey ?? null, filePath ?? '', src ?? '']);
    const dialogRef = useRef(null);
    const bodyRef = useRef(null);
    const imageRef = useRef(null);
    const ambientCanvasRef = useRef(null);
    const onCloseRef = useRef(onClose);
    const returnFocusRef = useRef(returnFocusElement);
    const resourceRef = useRef(resourceKey);
    const closedRef = useRef(false);
    const closingRef = useRef(false);
    const enteredRef = useRef(false);
    onCloseRef.current = onClose;
    returnFocusRef.current = returnFocusElement;
    const initialImage = {
        key: resourceKey,
        src: src || '',
        error: !src,
        aspectRatio: sourceElement?.naturalWidth / sourceElement?.naturalHeight || 1,
    };
    const [imageState, setImageState] = useState(initialImage);
    const activeImage = imageState.key === resourceKey ? imageState : initialImage;
    const { src: imageSrc, error: imageError, aspectRatio } = activeImage;
    const [closing, setClosing] = useState(false);
    const [phase, setPhase] = useState(reducedMotion ? 'open' : 'opening');
    const previewX = useMotionValue(0);
    const previewY = useMotionValue(0);
    const previewScale = useMotionValue(1);
    const closeOpacity = useMotionValue(reducedMotion ? 1 : 0);
    const rotateX = useSpring(0, TILT_SPRING);
    const rotateY = useSpring(0, TILT_SPRING);
    const scale = useSpring(1, TILT_SPRING);

    const resetTilt = useCallback(() => {
        rotateX.set(0);
        rotateY.set(0);
        scale.set(1);
    }, [rotateX, rotateY, scale]);

    const finishClose = useCallback(() => {
        if (closedRef.current) return;
        closedRef.current = true;
        onCloseRef.current();
    }, []);

    const requestClose = () => {
        if (closedRef.current || closingRef.current) return;
        closingRef.current = true;
        if (reducedMotion) finishClose();
        else setClosing(true);
    };

    const requestNavigate = direction => {
        if (closedRef.current || closingRef.current) return;
        onNavigate?.(direction);
    };

    const updateTilt = event => {
        if (reducedMotion || closingRef.current || phase !== 'open' || event.pointerType === 'touch') return;
        if (event.target.closest('button')) {
            resetTilt();
            return;
        }
        const bounds = bodyRef.current.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
        const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
        rotateX.set(-y * 6);
        rotateY.set(x * 6);
        scale.set(1.02);
    };

    useLayoutEffect(() => {
        if (resourceRef.current === resourceKey) return;
        resourceRef.current = resourceKey;
        setImageState({
            key: resourceKey,
            src: src || '',
            error: !src,
            aspectRatio: sourceElement?.naturalWidth / sourceElement?.naturalHeight || 1,
        });
        const canvas = ambientCanvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        rotateX.jump(0);
        rotateY.jump(0);
        scale.jump(1);
        enteredRef.current = true;
    }, [resourceKey, src, sourceElement, rotateX, rotateY, scale]);

    useEffect(() => {
        const image = imageRef.current;
        if (!imageError && image?.complete && image.naturalWidth > 0) {
            paintAmbientCanvasFromSource(ambientCanvasRef.current, image);
        }
    }, [resourceKey, imageSrc, imageError]);

    useLayoutEffect(() => {
        const previousFocus = document.activeElement;
        const dialog = dialogRef.current;
        dialog.showModal();
        return () => {
            dialog.close();
            const focusTarget = returnFocusRef.current?.isConnected ? returnFocusRef.current : previousFocus;
            if (focusTarget?.isConnected) focusTarget.focus?.();
        };
    }, []);

    useLayoutEffect(() => {
        if (reducedMotion || closing) {
            rotateX.jump(0);
            rotateY.jump(0);
            scale.jump(1);
        }
    }, [closing, reducedMotion, rotateX, rotateY, scale]);

    useEffect(() => {
        window.addEventListener('blur', resetTilt);
        return () => window.removeEventListener('blur', resetTilt);
    }, [resetTilt]);

    useLayoutEffect(() => {
        let disposed = false;
        let finished = false;
        let timer;
        let animations = [];
        const finish = () => {
            if (disposed || finished) return;
            finished = true;
            window.clearTimeout(timer);
            animations.forEach(animation => animation.stop());
            if (closing) {
                finishClose();
            } else {
                previewX.jump(0);
                previewY.jump(0);
                previewScale.jump(1);
                closeOpacity.jump(1);
                enteredRef.current = true;
                setPhase('open');
            }
        };

        if (reducedMotion || imageError || (!closing && enteredRef.current)) {
            finish();
        } else {
            setPhase(closing ? 'closing' : 'opening');
            const duration = closing ? CLOSE_DURATION : OPEN_DURATION;
            const origin = coverOrigin(sourceElement, bodyRef.current);
            if (!closing) {
                previewX.jump(origin.x);
                previewY.jump(origin.y);
                previewScale.jump(origin.scale);
                closeOpacity.jump(0);
            }
            const transition = { duration, ease: [0.22, 1, 0.36, 1] };
            animations = [
                animate(previewX, closing ? origin.x : 0, transition),
                animate(previewY, closing ? origin.y : 0, transition),
                animate(previewScale, closing ? origin.scale : 1, transition),
                animate(closeOpacity, closing ? 0 : 1, { duration: closing ? 0.12 : 0.24 }),
            ];
            timer = window.setTimeout(finish, duration * 1000 + 100);
            Promise.all(animations).then(finish, finish);
        }

        // A resize changes the destination geometry; settle instead of keeping a stale flight path.
        window.addEventListener('resize', finish);
        return () => {
            disposed = true;
            window.clearTimeout(timer);
            window.removeEventListener('resize', finish);
            animations.forEach(animation => animation.stop());
        };
    }, [closing, reducedMotion, imageError, resourceKey, sourceElement, finishClose, previewX, previewY, previewScale, closeOpacity]);

    useEffect(() => {
        let disposed = false;
        if (filePath && window.electronAPI?.loadMetadataCover) {
            Promise.resolve().then(() => window.electronAPI.loadMetadataCover(filePath)).then(cover => {
                if (!disposed && resourceRef.current === resourceKey && typeof cover === 'string' && cover) {
                    setImageState(current => current.key === resourceKey ? { ...current, src: cover, error: false } : current);
                }
            }).catch(() => {});
        }
        return () => { disposed = true; };
    }, [resourceKey, filePath]);

    return createPortal(
        <dialog
            ref={dialogRef}
            className="detail-cover-preview-dialog"
            data-folder-modal
            data-phase={phase}
            aria-modal="true"
            aria-label={alt ? `${t('cover_preview')}: ${alt}` : t('cover_preview')}
            onCancel={event => {
                event.preventDefault();
                requestClose();
            }}
            onClose={() => { if (!dialogRef.current?.open) finishClose(); }}
            onKeyDown={event => {
                event.stopPropagation();
                const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1
                    : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0;
                if (!direction || !onNavigate || closingRef.current || closedRef.current
                    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
                    || event.isComposing || event.nativeEvent.isComposing) return;
                event.preventDefault();
                requestNavigate(direction);
            }}
            onClick={event => {
                event.stopPropagation();
                if (event.target === event.currentTarget) requestClose();
            }}
        >
            <div ref={bodyRef} className="detail-cover-preview-body" style={{ '--cover-preview-ratio': aspectRatio }}
                onPointerEnter={updateTilt} onPointerMove={updateTilt} onPointerLeave={resetTilt} onPointerCancel={resetTilt}>
                <motion.button type="button" className="detail-cover-preview-close" aria-label={t('btn_close')}
                    style={{ opacity: closeOpacity }} title={t('btn_close')} onClick={requestClose} autoFocus>
                    <FaIcon name="xmark" size={18} />
                </motion.button>
                {onNavigate && (
                    <>
                        <motion.button type="button" className="detail-cover-preview-nav detail-cover-preview-prev"
                            aria-label={t('folder.detail.preview_previous')} aria-keyshortcuts="ArrowLeft ArrowUp"
                            data-tooltip={t('folder.detail.preview_previous_hint')} disabled={closing}
                            style={{ opacity: closeOpacity }} onClick={() => requestNavigate(-1)}>
                            <FaIcon name="chevronLeft" size={20} />
                        </motion.button>
                        <motion.button type="button" className="detail-cover-preview-nav detail-cover-preview-next"
                            aria-label={t('folder.detail.preview_next')} aria-keyshortcuts="ArrowRight ArrowDown"
                            data-tooltip={t('folder.detail.preview_next_hint')} disabled={closing}
                            style={{ opacity: closeOpacity }} onClick={() => requestNavigate(1)}>
                            <FaIcon name="chevronRight" size={20} />
                        </motion.button>
                    </>
                )}
                {imageError ? <p role="status">{t('no_image')}</p> : (
                    <motion.div className="detail-cover-preview-transition" style={{ x: previewX, y: previewY, scale: previewScale }}>
                        <motion.div className="detail-cover-preview-tilt"
                            style={{ rotateX, rotateY, scale, transformPerspective: reducedMotion ? 0 : 1200 }}>
                            <canvas ref={ambientCanvasRef} className="detail-cover-preview-ambient" aria-hidden="true" />
                            <SmoothCoverImage key={`${resourceKey}:${imageSrc}`} ref={imageRef} className="detail-cover-preview-image" src={imageSrc} alt={alt} draggable={false}
                                onDragStart={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                                onLoad={event => {
                                    if (resourceRef.current !== resourceKey || event.currentTarget !== imageRef.current) return;
                                    const aspectRatio = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
                                    setImageState(current => current.key === resourceKey ? { ...current, aspectRatio } : current);
                                    paintAmbientCanvasFromSource(ambientCanvasRef.current, event.currentTarget);
                                }}
                                onError={event => {
                                    if (resourceRef.current !== resourceKey || event.currentTarget !== imageRef.current) return;
                                    const canvas = ambientCanvasRef.current;
                                    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                                    setImageState(current => {
                                        if (current.key !== resourceKey) return current;
                                        return imageSrc !== src && src ? { ...current, src, error: false } : { ...current, error: true };
                                    });
                                }} />
                        </motion.div>
                    </motion.div>
                )}
            </div>
        </dialog>,
        document.body,
    );
}
