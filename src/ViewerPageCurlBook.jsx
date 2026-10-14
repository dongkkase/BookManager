import React, { Children, cloneElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { drawPageCurlFrame } from './viewerPageCurlRenderer';
import { releasePageCurlSnapshots, snapshotPageCurlLeaf } from './viewerPageCurlSnapshot';

export const PAGE_CURL_SNAPSHOT_TIMEOUT = { reader: 3000, image: 800 };

const ViewerPageCurlBook = forwardRef(function ViewerPageCurlBook({
    children, startPage = 0, preparedPage = startPage, width, height, spread = true,
    duration = 600, onPageChange, canStartDrag, onTurnStart, onTurnCancel, className = '', style,
}, forwardedRef) {
    const rootRef = useRef(null);
    const canvasRef = useRef(null);
    const runtimeRef = useRef({ index: startPage, sequence: 0, frame: 0, snapshots: [], target: null });
    const interactionRef = useRef(null);
    const propsRef = useRef(null);
    const [displayedPage, setDisplayedPage] = useState(startPage);
    const [preparingPage, setPreparingPage] = useState(null);
    const pages = Children.toArray(children);
    propsRef.current = { width, height, spread, duration, onPageChange, canStartDrag, onTurnStart, onTurnCancel, pageCount: pages.length };

    useImperativeHandle(forwardedRef, () => {
        const normalize = value => {
            const count = propsRef.current.pageCount;
            const index = Math.max(0, Math.min(count - 1, Math.floor(Number(value) || 0)));
            return propsRef.current.spread ? index - index % 2 : index;
        };
        const cancel = ({ notify = true, updateState = true } = {}) => {
            const runtime = runtimeRef.current;
            const drag = runtime.drag;
            drag?.cleanup?.();
            runtime.drag = null;
            if (drag?.started) rootRef.current?.setAttribute('data-curl-suppress-click', String(Date.now() + 500));
            runtime.sequence += 1;
            cancelAnimationFrame(runtime.frame);
            runtime.frame = 0;
            runtime.target = null;
            runtime.scene = null;
            runtime.snapshotFailed = false;
            releasePageCurlSnapshots(runtime.snapshots);
            runtime.snapshots = [];
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.style.visibility = 'hidden';
                canvas.width = 0;
                canvas.height = 0;
            }
            rootRef.current?.removeAttribute('data-curl-animating');
            rootRef.current?.removeAttribute('data-curl-dragging');
            if (updateState) setPreparingPage(null);
            if (notify && drag?.started) propsRef.current.onTurnCancel?.();
        };
        const commit = target => {
            cancel({ notify: false });
            runtimeRef.current.index = target;
            setDisplayedPage(target);
            setPreparingPage(null);
            // Update the static leaves in the same paint that removes the animation surface.
            rootRef.current?.querySelectorAll('[data-flipbook-index]').forEach(node => {
                const index = Number(node.dataset.flipbookIndex);
                const visible = index >= target && index < target + (propsRef.current.spread ? 2 : 1);
                node.dataset.curlVisible = String(visible);
                node.style.visibility = visible ? 'visible' : 'hidden';
                node.style.opacity = visible ? '1' : '0';
                if (visible) node.style.display = 'flex';
            });
            propsRef.current.onPageChange?.(target);
        };
        const failPreparation = target => {
            const runtime = runtimeRef.current;
            if (!runtime.drag || runtime.drag.released) {
                if (!runtime.drag || runtime.drag.complete) commit(target);
                else cancel();
                return;
            }
            runtime.snapshotFailed = true;
            runtime.scene = null;
            releasePageCurlSnapshots(runtime.snapshots);
            runtime.snapshots = [];
            if (canvasRef.current) {
                canvasRef.current.style.visibility = 'hidden';
                canvasRef.current.width = 0;
                canvasRef.current.height = 0;
            }
            rootRef.current?.removeAttribute('data-curl-animating');
        };
        const paint = progress => {
            const runtime = runtimeRef.current;
            const canvas = canvasRef.current;
            if (!canvas || !runtime.scene) return false;
            const context = canvas.getContext('2d');
            const scene = runtime.scene;
            try {
                context.setTransform(canvas.width / scene.width, 0, 0, canvas.height / scene.height, 0, 0);
                context.clearRect(0, 0, scene.width, scene.height);
                drawPageCurlFrame(context, { ...scene, progress, ...(runtime.drag && {
                    touchY: runtime.drag.touchY, corner: runtime.drag.corner,
                }) });
            } catch (error) {
                console.warn('[Viewer] Page curl rendering failed:', error);
                failPreparation(runtime.target);
                return false;
            }
            runtime.progress = progress;
            canvas.style.visibility = 'visible';
            rootRef.current.dataset.curlAnimating = 'true';
            return true;
        };
        const animate = complete => {
            const runtime = runtimeRef.current;
            const sequence = runtime.sequence;
            const target = runtime.target;
            const fromProgress = runtime.progress || 0;
            const toProgress = complete ? 1 : 0;
            const duration = runtime.drag
                ? Math.max(120, propsRef.current.duration * Math.abs(toProgress - fromProgress))
                : propsRef.current.duration;
            let startedAt = null;
            cancelAnimationFrame(runtime.frame);
            const tick = now => {
                if (sequence !== runtime.sequence) return;
                if (startedAt === null) startedAt = now;
                const elapsed = Math.min(1, (now - startedAt) / Math.max(1, duration));
                const eased = elapsed < 0.5 ? 2 * elapsed ** 2 : 1 - (-2 * elapsed + 2) ** 2 / 2;
                if (!paint(fromProgress + (toProgress - fromProgress) * eased)) return;
                if (elapsed < 1) runtime.frame = requestAnimationFrame(tick);
                else if (complete) commit(target);
                else cancel();
            };
            runtime.frame = requestAnimationFrame(tick);
        };
        const prepare = async target => {
            const runtime = runtimeRef.current;
            const from = runtime.index;
            const sequence = ++runtime.sequence;
            runtime.target = target;
            runtime.progress = 0;
            setPreparingPage(target);
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (sequence !== runtime.sequence || !rootRef.current) return;
            const { width, height, spread } = propsRef.current;
            const slots = spread ? 2 : 1;
            const pixelRatio = Math.min(2, window.devicePixelRatio || 1, 4096 / Math.max(width * slots, height));
            const indexes = [from, target].flatMap(index => Array.from({ length: slots }, (_, offset) => index + offset));
            // Reader snapshots embed fonts and rasterize HTML, unlike ready image/canvas leaves.
            const prepareTimeout = indexes.some(index => rootRef.current
                .querySelector(`[data-flipbook-index="${index}"] .viewer-text-page`))
                ? PAGE_CURL_SNAPSHOT_TIMEOUT.reader : PAGE_CURL_SNAPSHOT_TIMEOUT.image;
            const pendingSnapshots = Promise.allSettled(indexes.map((index, offset) => snapshotPageCurlLeaf(
                rootRef.current.querySelector(`[data-flipbook-index="${index}"]`),
                { width, height, x: offset % slots * width, pixelRatio },
            )));
            let prepareTimer;
            const results = await Promise.race([
                pendingSnapshots,
                new Promise(resolve => { prepareTimer = setTimeout(() => resolve(null), prepareTimeout); }),
            ]);
            clearTimeout(prepareTimer);
            if (!results) {
                if (sequence === runtime.sequence && rootRef.current) console.warn('[Viewer] Page curl snapshot preparation timed out.');
                pendingSnapshots.then(lateResults => releasePageCurlSnapshots(
                    lateResults.filter(result => result.status === 'fulfilled').map(result => result.value),
                ));
                if (sequence === runtime.sequence && rootRef.current) failPreparation(target);
                return;
            }
            const snapshots = results.filter(result => result.status === 'fulfilled').map(result => result.value);
            if (sequence !== runtime.sequence || !canvasRef.current) {
                releasePageCurlSnapshots(snapshots);
                return;
            }
            if (snapshots.length !== indexes.length) {
                console.warn('[Viewer] Page curl snapshot failed:', results.filter(result => result.status === 'rejected').map(result => String(result.reason)).join('; '));
                releasePageCurlSnapshots(snapshots);
                failPreparation(target);
                return;
            }
            runtime.snapshots = snapshots;
            const canvas = canvasRef.current;
            canvas.width = Math.ceil(width * slots * pixelRatio);
            canvas.height = Math.ceil(height * pixelRatio);
            runtime.scene = {
                width: width * slots, height, spread,
                current: snapshots.slice(0, slots), target: snapshots.slice(slots),
                side: target > from ? 'right' : 'left',
            };
            if (runtime.drag) {
                if (!paint(runtime.drag.progress)) return;
                if (runtime.drag.released) animate(runtime.drag.complete);
            } else animate(true);
        };
        const flip = value => {
            const target = normalize(value);
            const runtime = runtimeRef.current;
            if (runtime.drag && !runtime.drag.started) cancel();
            if (runtime.target !== null || runtime.drag || target === runtime.index) return;
            return prepare(target);
        };
        const pointerDown = event => {
            const runtime = runtimeRef.current;
            const root = rootRef.current;
            if (event.defaultPrevented || event.button !== 0 || event.isPrimary === false || runtime.target !== null || runtime.drag || !root) return;
            if (event.target.closest?.('a, button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], video, audio, iframe:not(.viewer-epub-original-frame), .viewer-epub-inline-media')) return;
            const rect = root.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const startX = event.clientX - rect.left;
            const startY = event.clientY - rect.top;
            if (startX < 0 || startX > rect.width || startY < 0 || startY > rect.height) return;
            const side = startX < rect.width / 2 ? 'left' : 'right';
            const slots = propsRef.current.spread ? 2 : 1;
            const target = runtime.index + (side === 'right' ? slots : -slots);
            if (target < 0 || target >= propsRef.current.pageCount) return;
            if (event.target.closest?.('.viewer-text-page, .viewer-pdf-text-layer')) {
                const edge = Math.max(24, Math.min(48, rect.width / slots * 0.12));
                if (startX > edge && startX < rect.width - edge) return;
            }
            if (propsRef.current.canStartDrag?.(event) === false) return;
            const drag = {
                pointerId: event.pointerId, pointerType: event.pointerType, target, side, rect,
                startX: event.clientX, startY: event.clientY, progress: 0,
                touchY: startY / rect.height * propsRef.current.height,
                corner: startY < rect.height / 2 ? 'top' : 'bottom',
                started: false, released: false,
            };
            runtime.drag = drag;
            root.dataset.curlDragging = 'pending';
            const document = root.ownerDocument;
            const viewport = document.defaultView;
            const update = nativeEvent => {
                const distance = (nativeEvent.clientX - drag.startX) * (side === 'right' ? -1 : 1);
                drag.progress = Math.max(0, Math.min(1, distance / rect.width));
                drag.touchY = Math.max(0, Math.min(propsRef.current.height,
                    (nativeEvent.clientY - rect.top) / rect.height * propsRef.current.height));
                return distance;
            };
            const move = nativeEvent => {
                if (nativeEvent.pointerId !== drag.pointerId || runtime.drag !== drag || drag.released) return;
                const distance = update(nativeEvent);
                if (!drag.started) {
                    const vertical = Math.abs(nativeEvent.clientY - drag.startY);
                    if (Math.max(Math.abs(distance), vertical) < 8) return;
                    if (distance < 8 || vertical > distance) {
                        cancel();
                        return;
                    }
                    if (propsRef.current.onTurnStart?.(target) === false) {
                        cancel();
                        return;
                    }
                    drag.started = true;
                    root.dataset.curlDragging = 'true';
                    prepare(target);
                }
                nativeEvent.preventDefault();
                nativeEvent.stopPropagation();
                if (runtime.scene) paint(drag.progress);
            };
            const release = nativeEvent => {
                if (nativeEvent.pointerId !== drag.pointerId || runtime.drag !== drag || drag.released) return;
                update(nativeEvent);
                drag.released = true;
                drag.cleanup();
                if (!drag.started) {
                    cancel();
                    return;
                }
                nativeEvent.preventDefault();
                nativeEvent.stopPropagation();
                drag.complete = drag.progress >= 0.28;
                root.dataset.curlSuppressClick = String(Date.now() + 500);
                if (runtime.scene) {
                    if (paint(drag.progress)) animate(drag.complete);
                } else if (runtime.snapshotFailed && drag.complete) commit(target);
                else if (!drag.complete) cancel();
            };
            const abort = nativeEvent => {
                if (nativeEvent.pointerId !== undefined && nativeEvent.pointerId !== drag.pointerId) return;
                if (runtime.drag === drag) cancel();
            };
            drag.cleanup = () => {
                document.removeEventListener('pointermove', move, true);
                document.removeEventListener('pointerup', release, true);
                document.removeEventListener('pointercancel', abort, true);
                root.removeEventListener('lostpointercapture', abort);
                viewport?.removeEventListener('blur', abort);
                viewport?.removeEventListener('resize', abort);
                try {
                    if (root.hasPointerCapture?.(drag.pointerId)) root.releasePointerCapture(drag.pointerId);
                } catch {
                    // Bridged EPUB events may have no native pointer to release.
                }
            };
            document.addEventListener('pointermove', move, true);
            document.addEventListener('pointerup', release, true);
            document.addEventListener('pointercancel', abort, true);
            root.addEventListener('lostpointercapture', abort);
            viewport?.addEventListener('blur', abort);
            viewport?.addEventListener('resize', abort);
            try {
                root.setPointerCapture?.(drag.pointerId);
            } catch {
                // Document listeners also track synthetic events forwarded by EPUB frames.
            }
            event.preventDefault();
            event.stopPropagation();
        };
        interactionRef.current = {
            cancel, pointerDown,
            suppressClick: event => {
                if (Number(rootRef.current?.dataset.curlSuppressClick) > Date.now()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
        };
        const api = {
            getCurrentPageIndex: () => runtimeRef.current.index,
            flip,
            turnToPage: value => {
                cancel();
                commit(normalize(value));
            },
            getRender: () => ({ finishAnimation: () => cancel() }),
        };
        return { pageFlip: () => api };
    }, []);

    useLayoutEffect(() => {
        interactionRef.current?.cancel();
    }, [width, height, spread]);

    useLayoutEffect(() => () => {
        interactionRef.current?.cancel({ updateState: false });
    }, []);

    const slots = spread ? 2 : 1;
    const targetGroup = Math.floor((preparingPage ?? preparedPage) / slots);
    return (
        <div ref={rootRef} className={`${className} viewer-page-curl-book`.trim()} style={{ ...style, width: width * slots, height }}
            onPointerDown={event => interactionRef.current?.pointerDown(event)}
            onClickCapture={event => interactionRef.current?.suppressClick(event)}
            onDoubleClickCapture={event => interactionRef.current?.suppressClick(event)}
            onDragStart={event => { if (runtimeRef.current.drag) event.preventDefault(); }}
            onTouchStart={event => { if (runtimeRef.current.drag) event.stopPropagation(); }}
            onTouchMove={event => { if (runtimeRef.current.drag) event.stopPropagation(); }}
            onTouchEnd={event => { if (runtimeRef.current.drag) event.stopPropagation(); }}>
            {pages.map((page, index) => {
                const visible = index >= displayedPage && index < displayedPage + slots;
                const prepared = visible || Math.abs(Math.floor(index / slots) - targetGroup) <= 1;
                return cloneElement(page, {
                    'data-curl-visible': String(visible),
                    'aria-hidden': visible ? undefined : true,
                    style: {
                        ...page.props.style, position: 'absolute', top: 0, left: index % slots * width,
                        width, height, display: prepared ? 'flex' : 'none', visibility: visible ? 'visible' : 'hidden',
                        opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
                    },
                });
            })}
            <canvas ref={canvasRef} className="viewer-page-curl-canvas" aria-hidden="true" width="0" height="0" />
        </div>
    );
});

export default ViewerPageCurlBook;
