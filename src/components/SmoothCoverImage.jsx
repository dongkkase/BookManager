import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { acquireResampledCover, coverResamplingTarget } from '../coverImageResampling';

function loadCoverSource(src, signal) {
    return new Promise((resolve, reject) => {
        const source = new Image();
        const cleanup = () => {
            source.onload = null;
            source.onerror = null;
            signal.removeEventListener('abort', abort);
        };
        const abort = () => {
            cleanup();
            reject(new DOMException('Cover resize canceled', 'AbortError'));
        };
        source.onload = () => {
            cleanup();
            resolve(source);
        };
        source.onerror = () => {
            cleanup();
            reject(new Error('Cover source could not be loaded'));
        };
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener('abort', abort, { once: true });
        source.src = src;
    });
}

const SmoothCoverImageSource = forwardRef(function SmoothCoverImageSource({ src, onError, ...props }, forwardedRef) {
    const imageRef = useRef(null);
    const failedRef = useRef(false);
    const leasesRef = useRef(new Set());
    const mountedRef = useRef(false);
    const [lease, setLease] = useState(null);
    const attachRef = useCallback(image => {
        imageRef.current = image;
        if (typeof forwardedRef === 'function') forwardedRef(image);
        else if (forwardedRef) forwardedRef.current = image;
    }, [forwardedRef]);
    const clearLease = useCallback(() => {
        const displayedUrl = imageRef.current?.getAttribute('src');
        // A canceled state update may never commit, so release unpublished results here.
        for (const held of leasesRef.current) {
            if (held.url === displayedUrl) continue;
            held.release();
            leasesRef.current.delete(held);
        }
        setLease(null);
    }, []);

    useLayoutEffect(() => {
        for (const held of leasesRef.current) {
            if (held === lease) continue;
            held.release();
            leasesRef.current.delete(held);
        }
    }, [lease]);

    useLayoutEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            for (const held of leasesRef.current) held.release();
            leasesRef.current.clear();
        };
    }, []);

    useEffect(() => {
        const image = imageRef.current;
        if (!image || !src) return undefined;
        let disposed = false;
        let visible = typeof IntersectionObserver === 'undefined';
        let naturalWidth = 0;
        let naturalHeight = 0;
        let timer;
        let request;
        let appliedKey = '';
        let pendingKey = '';
        const originalUrl = image.src;

        const cancelRequest = () => {
            request?.abort();
            request = null;
            pendingKey = '';
        };
        const resize = async () => {
            if (disposed || !visible || failedRef.current || !naturalWidth) return;
            const bounds = image.getBoundingClientRect();
            const target = coverResamplingTarget({
                naturalWidth,
                naturalHeight,
                displayWidth: bounds.width,
                displayHeight: bounds.height,
                devicePixelRatio: window.devicePixelRatio,
                fitMode: window.getComputedStyle(image).objectFit,
            });
            const key = target ? `${target.width}x${target.height}` : '';
            if (key === appliedKey) {
                cancelRequest();
                return;
            }
            if (target && key === pendingKey) return;
            cancelRequest();
            if (!target) {
                appliedKey = '';
                clearLease();
                return;
            }
            const controller = new AbortController();
            request = controller;
            pendingKey = key;
            try {
                // Keep the source independent of the displayed, resized image.
                const source = await loadCoverSource(src, controller.signal);
                const nextLease = await acquireResampledCover(source, target, { signal: controller.signal });
                if (disposed || !mountedRef.current || controller.signal.aborted) {
                    nextLease.release();
                    return;
                }
                appliedKey = key;
                leasesRef.current.add(nextLease);
                setLease(nextLease);
            } catch (error) {
                if (!controller.signal.aborted && error?.name !== 'AbortError') {
                    failedRef.current = true;
                }
            } finally {
                if (request === controller) {
                    request = null;
                    pendingKey = '';
                }
            }
        };
        const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(resize, 120);
        };
        const loaded = () => {
            if (image.src === originalUrl && image.naturalWidth > 0) {
                naturalWidth = image.naturalWidth;
                naturalHeight = image.naturalHeight;
                schedule();
            }
        };
        image.addEventListener('load', loaded);
        if (image.complete) loaded();

        const visibilityObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
            visible = entries[0]?.isIntersecting === true;
            if (visible) schedule();
            else {
                window.clearTimeout(timer);
                cancelRequest();
                appliedKey = '';
                clearLease();
            }
        });
        visibilityObserver?.observe(image);
        const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        sizeObserver?.observe(image);
        window.addEventListener('resize', schedule);

        return () => {
            disposed = true;
            window.clearTimeout(timer);
            cancelRequest();
            visibilityObserver?.disconnect();
            sizeObserver?.disconnect();
            image.removeEventListener('load', loaded);
            window.removeEventListener('resize', schedule);
        };
    }, [src, clearLease]);

    return (
        <img
            {...props}
            ref={attachRef}
            src={lease?.url || src}
            onError={event => {
                if (lease) {
                    failedRef.current = true;
                    clearLease();
                } else {
                    onError?.(event);
                }
            }}
        />
    );
});

export const SmoothCoverImage = forwardRef(function SmoothCoverImage(props, ref) {
    return <SmoothCoverImageSource key={props.src || ''} {...props} ref={ref} />;
});
