import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyEpubOriginalTheme, buildEpubOriginalDocument, DEFAULT_EPUB_AUDIO_LABELS, epubOriginalViewportMetrics } from '../../epubOriginalDocument.js';
import '../../styles/epubOriginalDocument.css';

const EMPTY_HIGHLIGHTS = [];
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];

function collectTextRanges(document, queries) {
    const viewport = document.defaultView;
    const records = [];
    const walker = document.createTreeWalker(document.body, viewport.NodeFilter.SHOW_TEXT);
    let content = '';
    let node;
    let previousBlock;
    while ((node = walker.nextNode())) {
        if (!node.textContent || node.parentElement?.closest('style, script, [hidden], [data-epub-audio-id]')) continue;
        const block = node.parentElement.closest('p, div, h1, h2, h3, h4, h5, h6, li, td, th, section, blockquote');
        if (previousBlock && block !== previousBlock) content += '\n';
        records.push({ node, start: content.length, end: content.length + node.textContent.length });
        content += node.textContent;
        previousBlock = block;
    }
    const locate = position => {
        let low = 0;
        let high = records.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (records[middle].end <= position) low = middle + 1;
            else high = middle;
        }
        return records[low];
    };
    return queries.map(query => {
        const expression = String(query || '').trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        const ranges = [];
        if (!expression || !records.length) return ranges;
        const matcher = new RegExp(expression, 'gi');
        let match;
        while ((match = matcher.exec(content)) && ranges.length < 10000) {
            const start = locate(match.index);
            const end = locate(match.index + match[0].length - 1);
            if (!start || !end) continue;
            const range = document.createRange();
            range.setStart(start.node, Math.max(0, match.index - start.start));
            range.setEnd(end.node, Math.min(end.node.textContent.length, match.index + match[0].length - end.start));
            ranges.push(range);
        }
        return ranges;
    });
}

function waitForImages(document) {
    return Promise.all(Array.from(document.images).map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
    })));
}

function readLayout(document, pageSize, mode, fixed, includeContent) {
    const root = document.documentElement;
    const viewport = document.defaultView;
    const style = viewport.getComputedStyle(root);
    const vertical = style.writingMode.startsWith('vertical');
    const rtl = !vertical && style.direction === 'rtl';
    const pageExtent = vertical ? pageSize.height : pageSize.width;
    const scroll = vertical ? root.scrollTop : root.scrollLeft;
    const position = rect => vertical ? rect.top + scroll : rtl ? pageSize.width - rect.right - scroll : rect.left + scroll;
    const totalExtent = vertical ? root.scrollHeight : root.scrollWidth;
    const pageCount = fixed || mode === 'scroll' ? 1 : Math.max(1, Math.ceil((totalExtent - 1) / pageExtent));
    if (!includeContent) return { pageCount, anchors: {}, textByPage: [], vertical, rtl };
    const pageForRect = rect => Math.min(pageCount - 1, Math.max(0, Math.floor((position(rect) + 0.5) / pageExtent)));
    const anchors = {};
    document.querySelectorAll('[id], a[name]').forEach(node => {
        const id = node.id || node.getAttribute('name');
        if (!id) return;
        let rect = node.getBoundingClientRect();
        if (node.hasAttribute('data-epub-audio-anchor') && !rect.width && !rect.height) {
            let parent = node.parentElement;
            while (parent && !rect.width && !rect.height) {
                rect = parent.getBoundingClientRect();
                parent = parent.parentElement;
            }
        }
        anchors[id] = pageForRect(rect);
    });
    const textByPage = Array.from({ length: pageCount }, () => []);
    const walker = document.createTreeWalker(document.body, viewport.NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.textContent.trim() || node.parentElement?.closest('style, script, [hidden], svg, [data-epub-audio-id]')) return viewport.NodeFilter.FILTER_REJECT;
            return viewport.NodeFilter.FILTER_ACCEPT;
        },
    });
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
        const length = node.textContent.length;
        let start = 0;
        while (start < length) {
            range.setStart(node, start);
            range.setEnd(node, start + 1);
            const rect = range.getClientRects()[0];
            if (!rect || (!rect.width && !rect.height)) {
                start += 1;
                continue;
            }
            const page = pageForRect(rect);
            let low = start + 1;
            let high = length;
            while (low < high) {
                const middle = Math.floor((low + high + 1) / 2);
                range.setStart(node, middle - 1);
                range.setEnd(node, middle);
                const endRect = range.getClientRects()[0];
                if (!endRect || pageForRect(endRect) <= page) low = middle;
                else high = middle - 1;
            }
            textByPage[page].push(node.textContent.slice(start, low));
            start = low;
        }
    }
    range.detach();
    return { pageCount, anchors, textByPage: textByPage.map(parts => parts.join(' ').replace(/\s+/g, ' ').trim()), vertical, rtl };
}

export default function EpubOriginalDocument({
    chapter,
    mode = 'page',
    pageSize: suppliedPageSize,
    pageOffset = 0,
    scale = 1,
    appearance,
    onLayout,
    onReady,
    onInternalLink,
    onExternalLink,
    onImagePreview,
    onSelectionChange,
    onAudioRequest,
    audioState,
    audioLabels = DEFAULT_EPUB_AUDIO_LABELS,
    searchQuery = '',
    highlights = EMPTY_HIGHLIGHTS,
}) {
    const frameRef = useRef(null);
    const cleanupRef = useRef(() => {});
    const initializedFrameRef = useRef(null);
    const layoutRef = useRef(null);
    const callbacksRef = useRef({});
    const [ready, setReady] = useState(false);
    const { width, height, outerWidth, outerHeight, horizontalPadding, verticalPadding, displayScale } = epubOriginalViewportMetrics(suppliedPageSize, appearance, scale);
    const pageSize = useMemo(() => ({ width, height }), [width, height]);
    const original = chapter?.original;
    const fixed = original?.layout === 'pre-paginated' && original?.viewport?.width > 0 && original?.viewport?.height > 0;
    const fixedScale = fixed ? Math.min(width / original.viewport.width, height / original.viewport.height) : 1;
    const [contentHeight, setContentHeight] = useState(height);
    const [documentColors, setDocumentColors] = useState({ bg: '#fff', fg: '#000' });
    const srcDoc = useMemo(() => buildEpubOriginalDocument(chapter, { mode, pageSize }), [chapter, mode, pageSize]);
    callbacksRef.current = { onLayout, onReady, onInternalLink, onExternalLink, onImagePreview, onSelectionChange, onAudioRequest, audioState, audioLabels, mode, pageOffset, theme: appearance?.theme || null };

    const updateTheme = useCallback(() => {
        const colors = applyEpubOriginalTheme(frameRef.current?.contentDocument, callbacksRef.current.theme);
        if (colors) setDocumentColors(previous => previous.bg === colors.bg && previous.fg === colors.fg ? previous : colors);
    }, []);
    useEffect(updateTheme, [updateTheme, ready, appearance?.theme?.bg, appearance?.theme?.fg]);

    const updateAudioControls = useCallback(() => {
        const document = frameRef.current?.contentDocument;
        const { audioState: state, audioLabels: labels, onAudioRequest: requestAudio, mode: currentMode } = callbacksRef.current;
        document?.querySelectorAll('button[data-epub-audio-id]').forEach(button => {
            const active = state?.trackId === button.dataset.epubAudioId;
            const playing = active && state?.status === 'playing';
            const loading = active && state?.status === 'loading';
            const labelKey = loading ? 'loading' : playing ? 'pause' : 'play';
            const action = labels?.[labelKey] || DEFAULT_EPUB_AUDIO_LABELS[labelKey];
            const title = button.dataset.epubAudioTitle || '';
            const label = `${action}${title ? ` · ${title}` : ''}`;
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.setAttribute('aria-pressed', String(playing));
            button.setAttribute('aria-busy', String(loading));
            button.disabled = currentMode === 'measure' || typeof requestAudio !== 'function';
            button.querySelector('.bookmanager-epub-audio-icon').textContent = loading ? '…' : playing ? 'Ⅱ' : '▶';
            button.querySelector('.bookmanager-epub-audio-label').textContent = label;
        });
    }, []);
    useEffect(updateAudioControls, [updateAudioControls, ready, audioState?.trackId, audioState?.status, audioLabels?.play, audioLabels?.pause, audioLabels?.loading, mode, onAudioRequest]);

    const showOffset = useCallback(() => {
        const document = frameRef.current?.contentDocument;
        const layout = layoutRef.current;
        if (!document || !layout || fixed || mode === 'scroll') return;
        const offset = Math.max(0, Math.min(layout.pageCount - 1, Number(callbacksRef.current.pageOffset) || 0));
        document.documentElement.scrollLeft = layout.vertical ? 0 : offset * width * (layout.rtl ? -1 : 1);
        document.documentElement.scrollTop = layout.vertical ? offset * height : 0;
    }, [fixed, mode, width, height]);

    useEffect(() => {
        setReady(false);
        layoutRef.current = null;
        setContentHeight(height);
        return () => cleanupRef.current();
    }, [srcDoc, height]);
    useEffect(showOffset, [showOffset, pageOffset]);
    useEffect(() => {
        const document = frameRef.current?.contentDocument;
        const viewport = document?.defaultView;
        if (!ready || !viewport?.CSS?.highlights || !viewport.Highlight) return;
        const names = ['bookmanager-search', ...HIGHLIGHT_COLORS.map(color => `bookmanager-highlight-${color}`)];
        names.forEach(name => viewport.CSS.highlights.delete(name));
        const marks = [{ text: searchQuery, name: 'bookmanager-search' }, ...highlights.map(mark => ({
            text: mark.text,
            name: `bookmanager-highlight-${HIGHLIGHT_COLORS.includes(mark.color) ? mark.color : 'yellow'}`,
        }))].filter(mark => String(mark.text || '').trim());
        if (!marks.length) return;
        const ranges = collectTextRanges(document, marks.map(mark => mark.text));
        const groups = new Map();
        marks.forEach((mark, index) => {
            if (!groups.has(mark.name)) groups.set(mark.name, new viewport.Highlight());
            ranges[index].forEach(range => groups.get(mark.name).add(range));
        });
        groups.forEach((highlight, name) => {
            if (name === 'bookmanager-search') highlight.priority = 1;
            viewport.CSS.highlights.set(name, highlight);
        });
        return () => names.forEach(name => viewport.CSS.highlights.delete(name));
    }, [ready, srcDoc, searchQuery, highlights]);

    const handleLoad = useCallback(async () => {
        cleanupRef.current();
        const frame = frameRef.current;
        const document = frame?.contentDocument;
        const viewport = frame?.contentWindow;
        if (!document?.body || !viewport) return;
        initializedFrameRef.current = { document, srcDoc, initialize: handleLoad };
        let disposed = false;
        let observer;
        let timeout;
        let resizeFrame;
        const listeners = [];
        const listen = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            listeners.push(() => target.removeEventListener(type, handler, options));
        };
        cleanupRef.current = () => {
            disposed = true;
            observer?.disconnect();
            clearTimeout(timeout);
            cancelAnimationFrame(resizeFrame);
            listeners.forEach(remove => remove());
        };
        updateAudioControls();
        updateTheme();
        if (!fixed) {
            const root = document.documentElement;
            const writingMode = viewport.getComputedStyle(root).writingMode;
            const bodyWritingMode = viewport.getComputedStyle(document.body).writingMode;
            const verticalWritingMode = writingMode.startsWith('vertical') ? writingMode : bodyWritingMode.startsWith('vertical') ? bodyWritingMode : '';
            if (verticalWritingMode) {
                root.style.setProperty('writing-mode', verticalWritingMode, 'important');
                root.style.setProperty('column-width', `${height}px`, 'important');
                if (mode === 'scroll') {
                    root.style.setProperty('height', `${height}px`, 'important');
                    root.style.setProperty('column-gap', '0px', 'important');
                    root.style.setProperty('column-fill', 'auto', 'important');
                }
            }
        }
        const translatePoint = event => {
            const rect = frame.getBoundingClientRect();
            const scaleX = rect.width / (frame.clientWidth || width);
            const scaleY = rect.height / (frame.clientHeight || height);
            return { clientX: rect.left + event.clientX * scaleX, clientY: rect.top + event.clientY * scaleY };
        };
        const forwardPointer = event => {
            const audioButton = event.target.closest?.('button[data-epub-audio-id]');
            if (audioButton) {
                event.stopPropagation();
                if (event.type === 'click') {
                    event.preventDefault();
                    callbacksRef.current.onAudioRequest?.(audioButton.dataset.epubAudioId);
                }
                return;
            }
            if (event.type === 'click') {
                const link = event.target.closest?.('a');
                if (link) {
                    event.preventDefault();
                    if (link.hasAttribute('data-original-external-link')) callbacksRef.current.onExternalLink?.(link.getAttribute('data-original-external-link'));
                    else if (link.hasAttribute('data-original-entry')) callbacksRef.current.onInternalLink?.({ entryName: link.getAttribute('data-original-entry'), anchor: link.getAttribute('data-original-anchor') || '' });
                    return;
                }
                const image = event.target.closest?.('img');
                if (image && callbacksRef.current.onImagePreview) {
                    event.preventDefault();
                    callbacksRef.current.onImagePreview({ src: image.currentSrc || image.src, alt: image.alt || '' });
                    return;
                }
                if (viewport.getSelection()?.toString()) return;
            }
            const EventClass = event.type.startsWith('pointer') ? PointerEvent : MouseEvent;
            const forwarded = new EventClass(event.type, {
                bubbles: true, cancelable: true, composed: true,
                ...translatePoint(event),
                button: event.button, buttons: event.buttons, pointerId: event.pointerId,
                pointerType: event.pointerType, isPrimary: event.isPrimary,
                ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
            });
            frame.dispatchEvent(forwarded);
            if (forwarded.defaultPrevented && event.type !== 'pointerdown' && event.type !== 'mousedown') event.preventDefault();
        };
        const forwardWheel = event => {
            event.preventDefault();
            const fixedPage = fixed && frame.closest('.viewer-text-page.is-original-reader');
            if (fixedPage && !event.ctrlKey && !event.metaKey) {
                const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
                const delta = horizontal ? event.deltaX || event.deltaY : event.deltaY;
                const offset = horizontal ? fixedPage.scrollLeft : fixedPage.scrollTop;
                const extent = horizontal ? fixedPage.scrollWidth - fixedPage.clientWidth : fixedPage.scrollHeight - fixedPage.clientHeight;
                if ((delta > 0 && offset < extent - 1) || (delta < 0 && offset > 0)) {
                    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? fixedPage.clientHeight : 1;
                    fixedPage.scrollBy({ [horizontal ? 'left' : 'top']: delta * multiplier, behavior: 'instant' });
                    return;
                }
            }
            const forwarded = new WheelEvent('wheel', {
                bubbles: true, cancelable: true, composed: true,
                ...translatePoint(event),
                deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode,
                button: event.button, buttons: event.buttons,
                ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
            });
            frame.dispatchEvent(forwarded);
            if (!forwarded.defaultPrevented && !event.ctrlKey && !event.metaKey) {
                const container = frame.closest('.viewer-content');
                const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container?.clientHeight || height : 1;
                container?.scrollBy({ left: event.deltaX * multiplier, top: event.deltaY * multiplier, behavior: 'instant' });
            }
        };
        const forwardKey = event => {
            const audioButton = event.target.closest?.('button[data-epub-audio-id]');
            if (audioButton) {
                event.stopPropagation();
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (event.type === 'keydown' && !event.repeat) audioButton.click();
                }
                return;
            }
            if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'x'].includes(event.key.toLowerCase())) return;
            const forwarded = new KeyboardEvent(event.type, {
                bubbles: true, cancelable: true, composed: true,
                key: event.key, code: event.code, repeat: event.repeat,
                ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
            });
            frame.dispatchEvent(forwarded);
            if (forwarded.defaultPrevented) event.preventDefault();
        };
        if (mode !== 'measure') {
            listen(document, 'wheel', forwardWheel, { passive: false });
            ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(type => listen(document, type, forwardPointer));
            ['keydown', 'keyup'].forEach(type => listen(document, type, forwardKey));
            listen(document, 'selectionchange', () => {
                const selection = viewport.getSelection();
                const selectionElement = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement;
                if (selectionElement?.closest('button[data-epub-audio-id]')) return;
                const text = selection?.toString() || '';
                const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                const bounds = range?.getBoundingClientRect();
                const translated = bounds ? translatePoint({ clientX: bounds.left, clientY: bounds.top }) : null;
                const scale = frame.getBoundingClientRect().width / (frame.clientWidth || width);
                callbacksRef.current.onSelectionChange?.({
                    text,
                    entryName: chapter?.name || '',
                    pageOffset: callbacksRef.current.pageOffset,
                    rect: bounds ? { left: translated.clientX, top: translated.clientY, width: bounds.width * scale, height: bounds.height * scale } : null,
                });
            });
        }
        await Promise.race([
            Promise.all([document.fonts?.ready, waitForImages(document)]),
            new Promise(resolve => { timeout = setTimeout(resolve, 3000); }),
        ]);
        if (disposed || frame.contentDocument !== document || !document.defaultView) return;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (disposed || frame.contentDocument !== document || !document.defaultView) return;
        const measure = () => {
            if (disposed || frame.contentDocument !== document || !document.defaultView) return;
            if (mode === 'scroll') {
                const nextHeight = fixed ? original.viewport.height * fixedScale : Math.max(1, Math.ceil(Math.max(document.body.offsetHeight + document.body.offsetTop, document.documentElement.scrollHeight)));
                setContentHeight(previous => previous === nextHeight ? previous : nextHeight);
            }
            const nextLayout = readLayout(document, fixed ? original.viewport : pageSize, mode, fixed, Boolean(callbacksRef.current.onLayout || callbacksRef.current.onReady));
            const changed = JSON.stringify(nextLayout) !== JSON.stringify(layoutRef.current);
            layoutRef.current = nextLayout;
            showOffset();
            if (changed) callbacksRef.current.onLayout?.(nextLayout);
            return nextLayout;
        };
        const layout = measure();
        if (!layout) return;
        setReady(true);
        callbacksRef.current.onReady?.(layout);
        observer = new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(measure);
        });
        observer.observe(document.body);
        if (document.fonts) listen(document.fonts, 'loadingdone', () => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(measure);
        });
        listen(document, 'load', () => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(measure);
        }, true);
    }, [chapter?.name, fixed, fixedScale, original, mode, pageSize, width, height, showOffset, srcDoc, updateAudioControls, updateTheme]);

    useEffect(() => {
        const initialized = initializedFrameRef.current;
        if (!initialized || initialized.initialize === handleLoad || initialized.srcDoc !== srcDoc || initialized.document !== frameRef.current?.contentDocument) return;
        setReady(false);
        void handleLoad();
    }, [handleLoad, srcDoc]);

    const frameWidth = fixed ? original.viewport.width : width;
    const frameHeight = fixed ? original.viewport.height : mode === 'scroll' ? contentHeight : height;
    return (
        <div
            className={`viewer-epub-original-document is-${mode}${fixed ? ' is-fixed-layout' : ''}`}
            style={{
                width: outerWidth,
                height: mode === 'scroll' ? (fixed ? original.viewport.height * fixedScale : contentHeight) * displayScale + verticalPadding * 2 : outerHeight,
                padding: `${verticalPadding}px ${horizontalPadding}px`,
                backgroundColor: documentColors.bg,
                color: documentColors.fg,
            }}
            aria-hidden={mode === 'measure' ? true : undefined}
        >
            <iframe
                ref={frameRef}
                className="viewer-epub-original-frame"
                title={chapter?.title || chapter?.name || 'EPUB'}
                srcDoc={srcDoc}
                sandbox="allow-same-origin"
                scrolling="no"
                tabIndex={mode === 'measure' ? -1 : 0}
                data-original-ready={ready ? 'true' : 'false'}
                style={{ width: frameWidth, height: frameHeight, top: fixed ? verticalPadding : undefined, backgroundColor: documentColors.bg, transform: `scale(${fixedScale * displayScale})` }}
                onLoad={handleLoad}
            />
        </div>
    );
}
