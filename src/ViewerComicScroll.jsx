import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const OVERSCAN_PAGE_LIMIT = 4;
const LARGE_ENCODED_PAGE_BYTES = 8 * 1024 * 1024;

function pixelSize(value) {
    const size = Number.parseFloat(value);
    return Number.isFinite(size) && size > 0 ? size : 0;
}

function sameIndexes(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function ViewerComicScroll({ pages = [], scrollRef, pageIndex = 0, layoutKey = '', getPageStyle, renderPage }) {
    const rootRef = useRef(null);
    const nodesRef = useRef([]);
    const measurementsRef = useRef(new Map());
    const anchorRef = useRef(null);
    const previousLayoutKeyRef = useRef(layoutKey);
    const [, setMeasurementVersion] = useState(0);
    const [nearbyIndexes, setNearbyIndexes] = useState(() => [Math.max(0, Math.min(pages.length - 1, pageIndex))]);
    const selectedIndex = Math.max(0, Math.min(pages.length - 1, Math.floor(Number(pageIndex) || 0)));
    const mountedIndexes = new Set([...nearbyIndexes, selectedIndex]);
    const viewport = scrollRef.current;
    const estimatedHeight = Math.max(120, viewport?.clientHeight || 700);
    const estimatedWidth = Math.max(120, (viewport?.clientWidth || 900) - 24);

    const viewportRange = useCallback(() => {
        const root = rootRef.current;
        const scroll = scrollRef.current;
        if (!root || !scroll || pages.length === 0) return null;
        const viewportTop = scroll.getBoundingClientRect().top + scroll.clientTop;
        const top = viewportTop - root.getBoundingClientRect().top;
        const bottom = top + scroll.clientHeight;
        const firstAfter = position => {
            let low = 0;
            let high = pages.length;
            while (low < high) {
                const middle = (low + high) >>> 1;
                const node = nodesRef.current[middle];
                if (node && node.offsetTop + node.offsetHeight <= position) low = middle + 1;
                else high = middle;
            }
            return Math.min(pages.length - 1, low);
        };
        const start = firstAfter(top + 1);
        const end = Math.max(start, firstAfter(bottom - 1));
        const overscanStart = Math.max(start - OVERSCAN_PAGE_LIMIT, firstAfter(top - scroll.clientHeight + 1));
        const overscanEnd = Math.min(end + OVERSCAN_PAGE_LIMIT, firstAfter(bottom + scroll.clientHeight - 1));
        return { start, end, overscanStart, overscanEnd, viewportTop, scroll };
    }, [pages.length, scrollRef]);

    const needsLargePageMeasurement = useCallback(index => {
        const page = pages[index];
        if (Number(page?.size) < LARGE_ENCODED_PAGE_BYTES || !Number.isFinite(Number(page?.size))) return false;
        if (pixelSize(getPageStyle?.(page, index)?.height)) return false;
        return measurementsRef.current.get(page.name)?.layoutKey !== layoutKey;
    }, [getPageStyle, layoutKey, pages]);

    const refreshRange = useCallback((preserveAnchor = false) => {
        const scroll = scrollRef.current;
        const anchor = anchorRef.current;
        if (preserveAnchor && scroll && anchor && Math.abs(scroll.scrollTop - anchor.scrollTop) < 1) {
            const node = nodesRef.current[anchor.index];
            if (node) {
                const offset = node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop;
                if (Math.abs(offset - anchor.offset) > 0.5) scroll.scrollTop += offset - anchor.offset;
            }
        }
        const range = viewportRange();
        if (!range) return;
        const indexes = [];
        if (needsLargePageMeasurement(selectedIndex)) {
            // Estimated heights must not trigger several large decodes before the selected page is measured.
            for (let index = range.start; index <= range.end; index += 1) {
                if (!needsLargePageMeasurement(index)) indexes.push(index);
            }
            indexes.push(selectedIndex);
        } else {
            const candidates = [];
            for (let index = range.overscanStart; index <= range.overscanEnd; index += 1) {
                candidates.push(index);
            }
            const pendingLargePages = candidates.filter(needsLargePageMeasurement);
            const pendingLargePage = pendingLargePages.find(index => index >= range.start) ?? pendingLargePages.at(-1);
            candidates.forEach(index => {
                if (!needsLargePageMeasurement(index) || index === pendingLargePage) indexes.push(index);
            });
        }
        indexes.sort((left, right) => left - right);
        setNearbyIndexes(current => sameIndexes(current, indexes) ? current : indexes);
        const node = nodesRef.current[range.start];
        anchorRef.current = node ? {
            index: range.start,
            offset: node.getBoundingClientRect().top - range.viewportTop,
            scrollTop: range.scroll.scrollTop,
        } : null;
    }, [needsLargePageMeasurement, scrollRef, selectedIndex, viewportRange]);

    useLayoutEffect(() => {
        const layoutChanged = previousLayoutKeyRef.current !== layoutKey;
        previousLayoutKeyRef.current = layoutKey;
        refreshRange(!layoutChanged);
    });

    useEffect(() => {
        const scroll = scrollRef.current;
        if (!scroll) return undefined;
        let frame = null;
        const schedule = () => {
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                refreshRange();
            });
        };
        scroll.addEventListener('scroll', schedule, { passive: true });
        const observer = new ResizeObserver(schedule);
        observer.observe(scroll);
        refreshRange();
        return () => {
            scroll.removeEventListener('scroll', schedule);
            observer.disconnect();
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [refreshRange, scrollRef]);

    useLayoutEffect(() => {
        const measure = entries => {
            let changed = false;
            entries.forEach(entry => {
                const index = Number(entry.target.parentElement?.dataset.pageIndex);
                const page = pages[index];
                if (!page) return;
                const images = entry.target.matches('img') ? [entry.target] : [...entry.target.querySelectorAll('img')];
                const failed = entry.target.matches('.viewer-comic-placeholder.is-error')
                    || entry.target.querySelector('.viewer-comic-placeholder.is-error');
                const tiledReady = entry.target.dataset.comicTiledReady === 'true';
                if (!failed && !tiledReady && (!images.length || images.some(image => !image.complete || image.naturalWidth <= 0))) return;
                const bounds = entry.target.getBoundingClientRect();
                if (bounds.width <= 0 || bounds.height <= 0) return;
                const current = measurementsRef.current.get(page.name);
                if (current?.layoutKey === layoutKey
                    && Math.abs(current.width - bounds.width) < 0.5
                    && Math.abs(current.height - bounds.height) < 0.5) return;
                measurementsRef.current.set(page.name, { width: bounds.width, height: bounds.height, layoutKey });
                changed = true;
            });
            if (changed) setMeasurementVersion(version => version + 1);
        };
        const observer = new ResizeObserver(measure);
        const listeners = [];
        mountedIndexes.forEach(index => {
            const content = nodesRef.current[index]?.firstElementChild;
            if (!content) return;
            observer.observe(content);
            const handleLoad = () => measure([{ target: content }]);
            content.addEventListener('load', handleLoad, true);
            listeners.push(() => content.removeEventListener('load', handleLoad, true));
        });
        return () => {
            observer.disconnect();
            listeners.forEach(remove => remove());
        };
    });

    return (
        <div ref={rootRef} className="viewer-comic-scroll" style={{ overflowAnchor: 'none' }}>
            {pages.map((page, index) => {
                const pageStyle = getPageStyle?.(page, index);
                const measurement = measurementsRef.current.get(page.name);
                const currentMeasurement = measurement?.layoutKey === layoutKey ? measurement : null;
                const width = pixelSize(pageStyle?.width) || currentMeasurement?.width || estimatedWidth;
                const height = pixelSize(pageStyle?.height) || currentMeasurement?.height || estimatedHeight;
                const mounted = mountedIndexes.has(index);
                return (
                    <div
                        key={page.name}
                        ref={node => { nodesRef.current[index] = node; }}
                        className="viewer-comic-scroll-page"
                        data-page-index={index}
                        data-comic-mounted={mounted ? 'true' : undefined}
                        style={{
                            width,
                            height,
                            flex: '0 0 auto',
                            position: 'relative',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'flex-start',
                            marginTop: index > 0 ? -1 : 0,
                            overflowAnchor: 'none',
                        }}
                    >
                        {mounted ? renderPage(page, index) : null}
                    </div>
                );
            })}
        </div>
    );
}
