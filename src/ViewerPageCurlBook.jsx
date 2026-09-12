import React, { Children, cloneElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { drawPageCurlFrame } from './viewerPageCurlRenderer';
import { releasePageCurlSnapshots, snapshotPageCurlLeaf } from './viewerPageCurlSnapshot';

const ViewerPageCurlBook = forwardRef(function ViewerPageCurlBook({
    children, startPage = 0, preparedPage = startPage, width, height, spread = true,
    duration = 600, onPageChange, className = '', style,
}, forwardedRef) {
    const rootRef = useRef(null);
    const canvasRef = useRef(null);
    const runtimeRef = useRef({ index: startPage, sequence: 0, frame: 0, snapshots: [], target: null });
    const propsRef = useRef(null);
    const [displayedPage, setDisplayedPage] = useState(startPage);
    const [preparingPage, setPreparingPage] = useState(null);
    const pages = Children.toArray(children);
    propsRef.current = { width, height, spread, duration, onPageChange, pageCount: pages.length };

    useImperativeHandle(forwardedRef, () => {
        const normalize = value => {
            const count = propsRef.current.pageCount;
            const index = Math.max(0, Math.min(count - 1, Math.floor(Number(value) || 0)));
            return propsRef.current.spread ? index - index % 2 : index;
        };
        const cancel = () => {
            const runtime = runtimeRef.current;
            runtime.sequence += 1;
            cancelAnimationFrame(runtime.frame);
            runtime.frame = 0;
            runtime.target = null;
            releasePageCurlSnapshots(runtime.snapshots);
            runtime.snapshots = [];
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.style.visibility = 'hidden';
                canvas.width = 0;
                canvas.height = 0;
            }
            rootRef.current?.removeAttribute('data-curl-animating');
        };
        const commit = target => {
            cancel();
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
        const flip = async value => {
            const target = normalize(value);
            const runtime = runtimeRef.current;
            if (runtime.target !== null || target === runtime.index) return;
            const from = runtime.index;
            const sequence = ++runtime.sequence;
            runtime.target = target;
            setPreparingPage(target);
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (sequence !== runtime.sequence || !rootRef.current) return;
            const { width, height, spread, duration } = propsRef.current;
            const slots = spread ? 2 : 1;
            const pixelRatio = Math.min(2, window.devicePixelRatio || 1, 4096 / Math.max(width * slots, height));
            const indexes = [from, target].flatMap(index => Array.from({ length: slots }, (_, offset) => index + offset));
            const pendingSnapshots = Promise.allSettled(indexes.map((index, offset) => snapshotPageCurlLeaf(
                rootRef.current.querySelector(`[data-flipbook-index="${index}"]`),
                { width, height, x: offset % slots * width, pixelRatio },
            )));
            let prepareTimer;
            const results = await Promise.race([
                pendingSnapshots,
                new Promise(resolve => { prepareTimer = setTimeout(() => resolve(null), 800); }),
            ]);
            clearTimeout(prepareTimer);
            if (!results) {
                pendingSnapshots.then(lateResults => releasePageCurlSnapshots(
                    lateResults.filter(result => result.status === 'fulfilled').map(result => result.value),
                ));
                if (sequence === runtime.sequence && rootRef.current) commit(target);
                return;
            }
            const snapshots = results.filter(result => result.status === 'fulfilled').map(result => result.value);
            if (sequence !== runtime.sequence || !canvasRef.current) {
                releasePageCurlSnapshots(snapshots);
                return;
            }
            if (snapshots.length !== indexes.length) {
                releasePageCurlSnapshots(snapshots);
                commit(target);
                return;
            }
            runtime.snapshots = snapshots;
            const canvas = canvasRef.current;
            canvas.width = Math.ceil(width * slots * pixelRatio);
            canvas.height = Math.ceil(height * pixelRatio);
            const context = canvas.getContext('2d');
            const scene = {
                width: width * slots, height, spread,
                current: snapshots.slice(0, slots), target: snapshots.slice(slots),
                side: target > from ? 'right' : 'left',
            };
            let startedAt = null;
            const animate = now => {
                if (sequence !== runtime.sequence) return;
                if (startedAt === null) startedAt = now;
                const elapsed = Math.min(1, (now - startedAt) / Math.max(1, duration));
                const progress = elapsed < 0.5 ? 2 * elapsed ** 2 : 1 - (-2 * elapsed + 2) ** 2 / 2;
                context.setTransform(canvas.width / scene.width, 0, 0, canvas.height / height, 0, 0);
                context.clearRect(0, 0, scene.width, height);
                try {
                    drawPageCurlFrame(context, { ...scene, progress });
                } catch {
                    commit(target);
                    return;
                }
                canvas.style.visibility = 'visible';
                rootRef.current.dataset.curlAnimating = 'true';
                if (elapsed < 1) runtime.frame = requestAnimationFrame(animate);
                else commit(target);
            };
            runtime.frame = requestAnimationFrame(animate);
        };
        const api = {
            getCurrentPageIndex: () => runtimeRef.current.index,
            flip,
            turnToPage: value => commit(normalize(value)),
            getRender: () => ({ finishAnimation: cancel }),
        };
        return { pageFlip: () => api };
    }, []);

    useLayoutEffect(() => () => {
        const runtime = runtimeRef.current;
        runtime.sequence += 1;
        cancelAnimationFrame(runtime.frame);
        releasePageCurlSnapshots(runtime.snapshots);
        runtime.snapshots = [];
        if (canvasRef.current) {
            canvasRef.current.width = 0;
            canvasRef.current.height = 0;
        }
    }, []);

    const slots = spread ? 2 : 1;
    const targetGroup = Math.floor((preparingPage ?? preparedPage) / slots);
    return (
        <div ref={rootRef} className={`${className} viewer-page-curl-book`.trim()} style={{ ...style, width: width * slots, height }}>
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
