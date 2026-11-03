import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { paintAmbientCanvasFromSource } from './viewerAmbient';

const TILE_HEIGHT = 2048;

export function comicTiledPageRange({ sourceHeight, visibleStart = 0, visibleEnd = 0, overscanPixels = 0, tileHeight = 2048, maxMounted = 8 }) {
    const height = Math.max(0, Number(sourceHeight) || 0);
    const tileSize = Math.max(1, Math.floor(Number(tileHeight) || 2048));
    const count = Math.ceil(height / tileSize);
    if (!count) return { start: 0, end: -1, visibleStart: 0, visibleEnd: -1 };
    const clamp = value => Math.max(0, Math.min(count - 1, value));
    const top = Math.max(0, Math.min(height, Number(visibleStart) || 0));
    const bottom = Math.max(top, Math.min(height, Number(visibleEnd) || 0));
    const first = clamp(Math.floor(top / tileSize));
    const last = Math.max(first, clamp(Math.ceil(bottom / tileSize) - 1));
    const margin = Math.max(0, Number(overscanPixels) || 0);
    const desiredBefore = first - clamp(Math.floor((top - margin) / tileSize));
    const desiredAfter = clamp(Math.ceil((bottom + margin) / tileSize) - 1) - last;
    const remaining = Math.max(0, Math.floor(Number(maxMounted) || 8) - (last - first + 1));
    let before = Math.min(desiredBefore, Math.floor(remaining / 2));
    const after = Math.min(desiredAfter, remaining - before);
    before = Math.min(desiredBefore, remaining - after);
    return { start: first - before, end: last + after, visibleStart: first, visibleEnd: last };
}

function cpuCanvasContext(canvas) {
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!context || context.getContextAttributes?.().willReadFrequently === false) {
        throw new Error('A CPU canvas is required to render this comic page.');
    }
    return context;
}

function ComicCanvasTile({ bitmap, sourceWidth, sourceHeight, tileIndex, onPainted }) {
    const canvasRef = useRef(null);
    const onPaintedRef = useRef(onPainted);
    onPaintedRef.current = onPainted;
    const sourceTop = tileIndex * TILE_HEIGHT;
    const height = Math.min(TILE_HEIGHT, sourceHeight - sourceTop);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bitmap || height <= 0) return undefined;
        try {
            canvas.width = sourceWidth;
            canvas.height = height;
            const context = cpuCanvasContext(canvas);
            context.drawImage(bitmap, 0, sourceTop, sourceWidth, height, 0, 0, sourceWidth, height);
            canvas.dataset.comicTileReady = 'true';
            onPaintedRef.current(tileIndex, true);
        } catch (error) {
            delete canvas.dataset.comicTileReady;
            canvas.width = canvas.height = 1;
            onPaintedRef.current(tileIndex, false, error);
        }
        return () => {
            delete canvas.dataset.comicTileReady;
            canvas.width = canvas.height = 1;
        };
    }, [bitmap, height, sourceTop, sourceWidth, tileIndex]);

    return <canvas
        ref={canvasRef}
        className="viewer-comic-tile"
        data-comic-tile-index={tileIndex}
        aria-hidden="true"
        style={{
            position: 'absolute',
            display: 'block',
            zIndex: 2,
            cursor: 'grab',
            userSelect: 'none',
            left: 0,
            top: `${sourceTop / sourceHeight * 100}%`,
            width: '100%',
            height: `${height / sourceHeight * 100}%`,
        }}
    />;
}

export default function ViewerComicTiledPage({
    bitmap,
    width,
    height,
    page = {},
    index,
    frameStyle,
    scrollRef,
    viewMode = 'width',
    renderAmbientCanvas = false,
    onReady,
    onError,
}) {
    const frameRef = useRef(null);
    const ambientCanvasRef = useRef(null);
    const callbacksRef = useRef({ onReady, onError });
    callbacksRef.current = { onReady, onError };
    const sourceWidth = Math.max(1, Math.floor(Number(width || bitmap?.width) || 1));
    const sourceHeight = Math.max(1, Math.floor(Number(height || bitmap?.height) || 1));
    const [range, setRange] = useState(() => comicTiledPageRange({ sourceHeight }));
    const [painted, setPainted] = useState(() => ({ bitmap, indexes: new Set() }));
    const handlePainted = useCallback((tileIndex, ready, error) => {
        setPainted(current => {
            const indexes = current.bitmap === bitmap ? current.indexes : new Set();
            if (indexes.has(tileIndex) === ready && current.bitmap === bitmap) return current;
            const next = new Set(indexes);
            if (ready) next.add(tileIndex);
            else next.delete(tileIndex);
            return { bitmap, indexes: next };
        });
        if (error) callbacksRef.current.onError?.(error);
    }, [bitmap]);
    const refreshRange = useCallback(() => {
        const frame = frameRef.current;
        const scroll = scrollRef?.current;
        if (!frame || !scroll) return;
        const bounds = frame.getBoundingClientRect();
        if (bounds.height <= 0) return;
        const viewportTop = scroll.getBoundingClientRect().top + scroll.clientTop;
        const viewportBottom = viewportTop + scroll.clientHeight;
        const scale = bounds.height / sourceHeight;
        const outside = bounds.bottom <= viewportTop || bounds.top >= viewportBottom;
        const next = comicTiledPageRange({
            sourceHeight,
            visibleStart: (viewportTop - bounds.top) / scale,
            visibleEnd: (viewportBottom - bounds.top) / scale,
            overscanPixels: outside ? 0 : scroll.clientHeight / scale,
        });
        setRange(current => current.start === next.start && current.end === next.end
            && current.visibleStart === next.visibleStart && current.visibleEnd === next.visibleEnd ? current : next);
    }, [scrollRef, sourceHeight]);

    useLayoutEffect(() => refreshRange());
    useEffect(() => {
        const scroll = scrollRef?.current;
        const frame = frameRef.current;
        const viewport = frame?.ownerDocument.defaultView;
        if (!scroll || !frame || !viewport) return undefined;
        let scheduled = null;
        const schedule = () => {
            if (scheduled !== null) return;
            scheduled = viewport.requestAnimationFrame(() => {
                scheduled = null;
                refreshRange();
            });
        };
        scroll.addEventListener('scroll', schedule, { passive: true });
        viewport.addEventListener('resize', schedule);
        const observer = new ResizeObserver(schedule);
        observer.observe(scroll);
        observer.observe(frame);
        refreshRange();
        return () => {
            scroll.removeEventListener('scroll', schedule);
            viewport.removeEventListener('resize', schedule);
            observer.disconnect();
            if (scheduled !== null) viewport.cancelAnimationFrame(scheduled);
        };
    }, [refreshRange, scrollRef]);

    useLayoutEffect(() => {
        const canvas = ambientCanvasRef.current;
        if (!canvas || !bitmap || !renderAmbientCanvas) return undefined;
        try {
            cpuCanvasContext(canvas);
            paintAmbientCanvasFromSource(canvas, bitmap);
        } catch (error) {
            callbacksRef.current.onError?.(error);
        }
        return () => { canvas.width = canvas.height = 1; };
    }, [bitmap, renderAmbientCanvas]);

    const tileIndexes = Array.from({ length: Math.max(0, range.end - range.start + 1) }, (_, offset) => range.start + offset);
    const ready = Boolean(bitmap) && painted.bitmap === bitmap && tileIndexes.length > 0
        && tileIndexes.every(tileIndex => painted.indexes.has(tileIndex));
    useEffect(() => {
        if (ready) callbacksRef.current.onReady?.({ width: sourceWidth, height: sourceHeight });
    }, [bitmap, ready, range.start, range.end, sourceHeight, sourceWidth]);

    return <div
        ref={frameRef}
        className={`viewer-comic-page-frame viewer-comic-tiled-page view-${viewMode}`}
        data-page-index={index}
        data-comic-tiled-ready={ready ? 'true' : undefined}
        data-comic-source-width={sourceWidth}
        data-comic-source-height={sourceHeight}
        role="img"
        aria-label={page.basename || page.name || ''}
        style={{ width: sourceWidth, height: sourceHeight, ...frameStyle, position: 'relative' }}
    >
        {renderAmbientCanvas && <span className="viewer-ambient-clip" aria-hidden="true">
            <canvas ref={ambientCanvasRef} className="viewer-ambient-canvas" />
        </span>}
        {bitmap && tileIndexes.map(tileIndex => <ComicCanvasTile
            key={tileIndex}
            bitmap={bitmap}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            tileIndex={tileIndex}
            onPainted={handlePainted}
        />)}
    </div>;
}
