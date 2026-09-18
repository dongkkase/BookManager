import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import TextCleanerEditor from '../components/TextCleanerEditor';
import TextCleanerSearch from '../components/TextCleanerSearch';
import { DEFAULT_TEXT_SEARCH_OPTIONS } from '../textCleanerFindReplace';
import { runTextCleanerSearchJob } from '../textCleanerSearchJob';
import { droppedPathsFromDataTransfer } from '../appShell';
import { firstTextCleanerPath } from '../fileTools';
import {
    closestTextChangeIndex,
    editorScrollTopForTextOffset,
    mapTextOffsetByCanonical,
    mapTextOffsetThroughChanges,
    textOffsetForEditorScroll,
} from '../textCleanerNavigation';
import { DEFAULT_TEXT_CLEANER_OPTIONS } from '../textCleanerPolicy';
import { createTextCleanerInput } from '../textCleanerInput';

function formatBytes(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromPath(filePath = '') {
    return String(filePath).split(/[\\/]/).pop() || filePath;
}

function waitForRendererPaint() {
    return new Promise(resolve => {
        requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
}

function editorCanvasFont(style) {
    return `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize || '14px'} ${style.fontFamily || 'monospace'}`;
}

function editorWrapMetrics(editor) {
    if (!editor || typeof window === 'undefined') return { columns: 80 };
    const style = window.getComputedStyle(editor);
    const horizontalPadding = Number.parseFloat(style.paddingLeft || '0')
        + Number.parseFloat(style.paddingRight || '0');
    const contentWidth = Math.max(1, editor.clientWidth - horizontalPadding);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return { columns: 80 };
    context.font = editorCanvasFont(style);
    const referenceWidth = Math.max(1, context.measureText('가').width);
    return {
        columns: Math.max(1, Math.floor(contentWidth / referenceWidth)),
        wrapWidth: contentWidth,
        font: editorCanvasFont(style),
        tabSize: Math.max(1, Number.parseInt(style.tabSize || '4', 10) || 4),
    };
}

function measureEditorCharacters(editor, characters = []) {
    if (!editor || typeof document === 'undefined') return [];
    const style = window.getComputedStyle(editor);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return [];
    context.font = editorCanvasFont(style);
    return characters.map(character => [character, context.measureText(character).width]);
}

function centerEditorAtTextOffset(editor, requestedOffset) {
    if (!editor || typeof document === 'undefined') return false;
    if (editor.centerAtTextOffset) return editor.centerAtTextOffset(requestedOffset);
    const textLength = editor.value.length;
    const offset = Math.min(textLength, Math.max(0, Math.round(requestedOffset)));
    const activeElement = document.activeElement;
    const selectionStart = editor.selectionStart;
    const selectionEnd = editor.selectionEnd;
    const selectionDirection = editor.selectionDirection;
    const style = window.getComputedStyle(editor);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const bottomPadding = Number.parseFloat(style.paddingBottom) || 0;

    editor.scrollTop = 0;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(0, 0);
    editor.setSelectionRange(offset, offset);
    const revealedScrollTop = editor.scrollTop;
    const centeredScrollTop = revealedScrollTop
        + (editor.clientHeight / 2)
        - bottomPadding
        + lineHeight;
    const scrollRange = Math.max(0, editor.scrollHeight - editor.clientHeight);
    editor.scrollTop = Math.min(scrollRange, Math.max(0, centeredScrollTop));

    if (activeElement && activeElement !== editor && typeof activeElement.focus === 'function') {
        activeElement.focus({ preventScroll: true });
    } else if (activeElement !== editor) {
        editor.blur();
    }
    editor.setSelectionRange(selectionStart, selectionEnd, selectionDirection || 'none');
    return offset === 0 || revealedScrollTop > 0;
}

function visualRowIndexForOffset(layout, requestedOffset) {
    const offsets = layout?.visualRowOffsets;
    if (!offsets?.length) return 0;
    const offset = Math.max(0, Number(requestedOffset) || 0);
    let low = 0;
    let high = offsets.length - 1;
    let rowIndex = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (offsets[middle] <= offset) {
            rowIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return rowIndex;
}

function measureEditorText(editor, value, initialWidth = 0) {
    if (!editor || typeof document === 'undefined' || !value) return 0;
    const style = window.getComputedStyle(editor);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.font = editorCanvasFont(style);
    const tabSize = Math.max(1, Number.parseInt(style.tabSize || '4', 10) || 4);
    const tabWidth = Math.max(1, context.measureText(' ').width) * tabSize;
    let width = initialWidth;
    for (const character of value) {
        if (character === '\t') {
            const remainder = width % tabWidth;
            width += remainder === 0 ? tabWidth : tabWidth - remainder;
        } else {
            width += context.measureText(character).width;
        }
    }
    return width - initialWidth;
}

function editorWrappedRowPrefixWidth(editor, text, requestedOffset) {
    if (!editor || typeof document === 'undefined') return null;
    const offset = Math.min(text.length, Math.max(0, Math.round(requestedOffset)));
    const style = window.getComputedStyle(editor);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.font = editorCanvasFont(style);
    const horizontalPadding = Number.parseFloat(style.paddingLeft || '0')
        + Number.parseFloat(style.paddingRight || '0');
    const wrapWidth = Math.max(1, editor.clientWidth - horizontalPadding);
    const tabSize = Math.max(1, Number.parseInt(style.tabSize || '4', 10) || 4);
    const tabWidth = Math.max(1, context.measureText(' ').width) * tabSize;
    const lineFeed = text.lastIndexOf('\n', Math.max(0, offset - 1));
    const carriageReturn = text.lastIndexOf('\r', Math.max(0, offset - 1));
    let index = Math.max(lineFeed, carriageReturn) + 1;
    let rowWidth = 0;

    while (index < offset) {
        const codePoint = text.codePointAt(index);
        const character = String.fromCodePoint(codePoint);
        let characterWidth;
        if (character === '\t') {
            const remainder = rowWidth % tabWidth;
            characterWidth = remainder === 0 ? tabWidth : tabWidth - remainder;
        } else {
            characterWidth = context.measureText(character).width;
        }
        if (rowWidth > 0 && rowWidth + characterWidth > wrapWidth) {
            rowWidth = 0;
            if (character === '\t') characterWidth = tabWidth;
        }
        rowWidth += Math.min(characterWidth, wrapWidth);
        index += character.length;
    }
    return rowWidth;
}

function disposeSearchMirror(mirrorRef) {
    mirrorRef.current?.element?.remove();
    mirrorRef.current = null;
}

function searchMirrorGeometry(editor, text, match, mirrorRef) {
    if (!editor || !match || typeof document === 'undefined') return null;
    if (editor.setSearchMatch) return null;
    const style = window.getComputedStyle(editor);
    // clientWidth excludes borders and the scrollbar but rounds fractional CSS pixels.
    const mirrorWidth = editor.clientWidth + editor.getBoundingClientRect().width - editor.offsetWidth;
    const signature = [
        editor.clientWidth,
        mirrorWidth,
        editorCanvasFont(style),
        style.lineHeight,
        style.letterSpacing,
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
        style.tabSize,
        style.wordBreak,
        style.overflowWrap,
        style.textRendering,
    ].join('|');
    let cache = mirrorRef.current;
    if (!cache) {
        const element = document.createElement('div');
        element.setAttribute('aria-hidden', 'true');
        element.style.position = 'fixed';
        element.style.top = '0';
        element.style.left = '-100000px';
        element.style.height = 'auto';
        element.style.minHeight = '0';
        element.style.margin = '0';
        element.style.border = '0';
        element.style.visibility = 'hidden';
        element.style.pointerEvents = 'none';
        element.style.boxSizing = 'border-box';
        element.style.whiteSpace = 'pre-wrap';
        element.style.contain = 'layout style paint';
        document.body.appendChild(element);
        cache = { element, signature: '', text: null };
        mirrorRef.current = cache;
    }
    if (cache.signature !== signature) {
        cache.element.style.width = `${mirrorWidth}px`;
        cache.element.style.font = editorCanvasFont(style);
        cache.element.style.lineHeight = style.lineHeight;
        cache.element.style.letterSpacing = style.letterSpacing;
        cache.element.style.padding = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;
        cache.element.style.tabSize = style.tabSize;
        cache.element.style.wordBreak = style.wordBreak;
        cache.element.style.overflowWrap = style.overflowWrap || 'anywhere';
        cache.element.style.textRendering = style.textRendering;
        cache.signature = signature;
    }
    if (cache.text !== text) {
        cache.element.textContent = text;
        cache.text = text;
    }
    const textNode = cache.element.firstChild;
    if (!textNode) return null;
    const start = Math.min(text.length, Math.max(0, match.start));
    const end = Math.min(text.length, Math.max(start, match.end));
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const mirrorRect = cache.element.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({
            left: rect.left - mirrorRect.left,
            top: rect.top - mirrorRect.top,
            width: rect.width,
            height: rect.height,
        }));
    if (!rects.length) return null;
    return {
        editorWidth: editor.clientWidth,
        editorBoxWidth: editor.getBoundingClientRect().width,
        ...rects[0],
        rects,
    };
}

function centerEditorAtMirrorGeometry(editor, geometry) {
    if (!editor || !geometry) return false;
    const scrollRange = Math.max(0, editor.scrollHeight - editor.clientHeight);
    editor.scrollTop = Math.min(scrollRange, Math.max(
        0,
        geometry.top - ((editor.clientHeight - geometry.height) / 2),
    ));
    editor.scrollLeft = 0;
    return true;
}

function renderSearchHighlight(highlight, editor, rects) {
    const visibleRects = rects.map(rect => ({
        ...rect,
        left: rect.left - editor.scrollLeft,
        top: rect.top - editor.scrollTop,
    })).filter(rect => (
        rect.top + rect.height > 0 && rect.top < editor.clientHeight
        && rect.left + rect.width > 0 && rect.left < editor.clientWidth
    ));
    highlight.hidden = visibleRects.length === 0;
    highlight.style.width = `${editor.clientWidth}px`;
    highlight.style.height = `${editor.clientHeight}px`;
    while (highlight.children.length > visibleRects.length) highlight.lastElementChild.remove();
    visibleRects.forEach((rect, index) => {
        let segment = highlight.children[index];
        if (!segment) {
            segment = document.createElement('span');
            highlight.appendChild(segment);
        }
        segment.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        segment.style.width = `${Math.max(2, rect.width)}px`;
        segment.style.height = `${Math.max(1, rect.height)}px`;
    });
}

function positionSearchHighlight(highlight, editor, text, match, layout, mirrorRef) {
    if (editor?.setSearchMatch) {
        editor.setSearchMatch(match);
        if (highlight) highlight.hidden = true;
        return;
    }
    if (!highlight || !editor || !match) {
        if (highlight) highlight.hidden = true;
        return;
    }
    const mirrorGeometry = match.mirrorGeometry?.editorWidth === editor.clientWidth
        && match.mirrorGeometry.editorBoxWidth === editor.getBoundingClientRect().width
        ? match.mirrorGeometry
        : searchMirrorGeometry(editor, text, match, mirrorRef);
    if (mirrorGeometry) {
        match.mirrorGeometry = mirrorGeometry;
        renderSearchHighlight(highlight, editor, mirrorGeometry.rects);
        return;
    }
    if (!layout?.visualRowOffsets?.length) {
        highlight.hidden = true;
        return;
    }
    const style = window.getComputedStyle(editor);
    const rowIndex = visualRowIndexForOffset(layout, match.start);
    const paddingLeft = Number.parseFloat(style.paddingLeft || '0');
    const paddingTop = Number.parseFloat(style.paddingTop || '0');
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const rects = [];
    for (let index = rowIndex; index < layout.visualRowOffsets.length; index += 1) {
        const rowStart = layout.visualRowOffsets[index];
        if (rowStart >= match.end) break;
        const rowEnd = layout.visualRowOffsets[index + 1] ?? text.length;
        const start = Math.max(rowStart, match.start);
        const end = Math.min(rowEnd, match.end);
        const matchedText = text.slice(start, end).replace(/[\r\n]+$/u, '');
        if (!matchedText) continue;
        const measuredPrefixWidth = index === rowIndex
            ? editorWrappedRowPrefixWidth(editor, text, start)
            : 0;
        const prefixWidth = measuredPrefixWidth ?? measureEditorText(editor, text.slice(rowStart, start));
        rects.push({
            left: paddingLeft + prefixWidth,
            top: paddingTop + (index * lineHeight),
            width: measureEditorText(editor, matchedText, prefixWidth),
            height: lineHeight,
        });
    }
    renderSearchHighlight(highlight, editor, rects);
}

const EMPTY_SEARCH_RESULT = Object.freeze({
    query: '',
    matches: [],
    ends: [],
    error: null,
    totalCount: 0,
    truncated: false,
    pending: false,
    index: -1,
});

function errorMessage(t, error, fallbackKey) {
    const code = error?.code;
    const knownKey = {
        SOURCE_CHANGED: 'tools.text_cleaner.error_source_changed',
        FILE_TOO_LARGE: 'tools.text_cleaner.error_too_large',
        OUTPUT_TOO_LARGE: 'tools.text_cleaner.error_too_large',
        UNSUPPORTED_FILE: 'tools.text_cleaner.error_txt_only',
        ENCODING_UNDETECTED: 'tools.text_cleaner.error_encoding',
    }[code];
    if (knownKey) return t(knownKey);
    return error?.message || t(fallbackKey);
}

export default function TextCleanerTool({ t, onBack, openRequest = null, showToast }) {
    const [fileInfo, setFileInfo] = useState(null);
    const [options, setOptions] = useState(DEFAULT_TEXT_CLEANER_OPTIONS);
    const [backup, setBackup] = useState(true);
    const [analysisVersion, setAnalysisVersion] = useState(0);
    const [changes, setChanges] = useState([]);
    const [totalChangeCount, setTotalChangeCount] = useState(0);
    const [changesTruncated, setChangesTruncated] = useState(false);
    const [selectedChangeIndex, setSelectedChangeIndex] = useState(0);
    const [protectedLineCount, setProtectedLineCount] = useState(0);
    const [reviewPanel, setReviewPanel] = useState('changes');
    const [quoteReview, setQuoteReview] = useState({ issues: [], total: 0, truncated: false });
    const [quoteReviewPending, setQuoteReviewPending] = useState(false);
    const [quoteReviewError, setQuoteReviewError] = useState(false);
    const [selectedQuoteIndex, setSelectedQuoteIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [manualEdited, setManualEdited] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState('');
    const [sourceSearchQuery, setSourceSearchQuery] = useState('');
    const [resultSearchQuery, setResultSearchQuery] = useState('');
    const [sourceSearchOptions, setSourceSearchOptions] = useState(DEFAULT_TEXT_SEARCH_OPTIONS);
    const [resultSearchOptions, setResultSearchOptions] = useState(DEFAULT_TEXT_SEARCH_OPTIONS);
    const [replacement, setReplacement] = useState('');
    const [preserveCase, setPreserveCase] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [sourceSearchResult, setSourceSearchResult] = useState(EMPTY_SEARCH_RESULT);
    const [resultSearchResult, setResultSearchResult] = useState(EMPTY_SEARCH_RESULT);
    const [lineCounts, setLineCounts] = useState({ source: 1, result: 1 });
    const [resultTextVersion, setResultTextVersion] = useState(0);
    const sourceTextRef = useRef('');
    const resultTextRef = useRef('');
    const sourceAreaRef = useRef(null);
    const resultAreaRef = useRef(null);
    const sourceSearchHighlightRef = useRef(null);
    const resultSearchHighlightRef = useRef(null);
    const sourceSearchMirrorRef = useRef(null);
    const resultSearchMirrorRef = useRef(null);
    const activeSearchMatchRef = useRef({ source: null, result: null });
    const sourceLayoutRef = useRef(null);
    const resultLayoutRef = useRef(null);
    const workerRef = useRef(null);
    const syncingScrollRef = useRef(false);
    const scrollSyncFrameRef = useRef(null);
    const changeScrollFrameRef = useRef(null);
    const handledOpenRequestRef = useRef(null);
    const resizeTimerRef = useRef(null);
    const layoutRequestIdRef = useRef(0);
    const layoutStaleRef = useRef(false);
    const editorWidthRef = useRef(0);
    const viewAnchorOffsetsRef = useRef({ source: 0, result: 0 });
    const loadRequestIdRef = useRef(0);
    const quoteRequestIdRef = useRef(0);
    const searchJobsRef = useRef({ source: null, result: null, replace: null });
    const pendingSearchMoveRef = useRef({ source: null, result: null });
    const resultInput = useMemo(() => createTextCleanerInput({
        readText: () => resultAreaRef.current?.value ?? resultTextRef.current,
        onCommit: text => {
            resultTextRef.current = text;
            layoutRequestIdRef.current += 1;
            setResultTextVersion(version => version + 1);
        },
    }), []);

    const selectedChange = changes[selectedChangeIndex] || null;
    const selectedQuote = quoteReview.issues[selectedQuoteIndex] || null;
    const busy = loading || analyzing || saving || replacing;
    const ruleItems = useMemo(() => ([
        { key: 'trimLeadingWhitespace', label: t('tools.text_cleaner.rule_leading') },
        { key: 'collapseRepeatedSpaces', label: t('tools.text_cleaner.rule_spaces') },
        { key: 'joinBrokenLines', label: t('tools.text_cleaner.rule_line_breaks') },
    ]), [t]);

    const updateSearchHighlight = useCallback(side => {
        const isSource = side === 'source';
        positionSearchHighlight(
            isSource ? sourceSearchHighlightRef.current : resultSearchHighlightRef.current,
            isSource ? sourceAreaRef.current : resultAreaRef.current,
            isSource ? sourceTextRef.current : resultTextRef.current,
            activeSearchMatchRef.current[side],
            isSource ? sourceLayoutRef.current : resultLayoutRef.current,
            isSource ? sourceSearchMirrorRef : resultSearchMirrorRef,
        );
    }, []);

    const clearSearchHighlight = useCallback(side => {
        activeSearchMatchRef.current[side] = null;
        const editor = side === 'source' ? sourceAreaRef.current : resultAreaRef.current;
        editor?.setSearchMatch?.(null);
        const highlight = side === 'source'
            ? sourceSearchHighlightRef.current
            : resultSearchHighlightRef.current;
        if (highlight) highlight.hidden = true;
        disposeSearchMirror(side === 'source' ? sourceSearchMirrorRef : resultSearchMirrorRef);
    }, []);

    const refreshActiveSearches = useCallback(() => {
        syncingScrollRef.current = true;
        for (const side of ['source', 'result']) {
            const isSource = side === 'source';
            const editor = isSource ? sourceAreaRef.current : resultAreaRef.current;
            const activeMatch = activeSearchMatchRef.current[side];
            if (!editor || !activeMatch) continue;
            const text = isSource ? sourceTextRef.current : resultTextRef.current;
            const mirrorRef = isSource ? sourceSearchMirrorRef : resultSearchMirrorRef;
            disposeSearchMirror(mirrorRef);
            delete activeMatch.mirrorGeometry;
            const geometry = searchMirrorGeometry(editor, text, activeMatch, mirrorRef);
            if (geometry) {
                activeMatch.mirrorGeometry = geometry;
                centerEditorAtMirrorGeometry(editor, geometry);
            } else {
                centerEditorAtTextOffset(editor, activeMatch.start);
            }
            updateSearchHighlight(side);
        }
        if (scrollSyncFrameRef.current !== null) {
            cancelAnimationFrame(scrollSyncFrameRef.current);
        }
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
    }, [updateSearchHighlight]);

    const restoreEditorsAfterLayout = useCallback(() => {
        syncingScrollRef.current = true;
        for (const side of ['source', 'result']) {
            if (activeSearchMatchRef.current[side]) {
                updateSearchHighlight(side);
                continue;
            }
            const isSource = side === 'source';
            const editor = isSource ? sourceAreaRef.current : resultAreaRef.current;
            if (!editor) continue;
            const text = isSource ? sourceTextRef.current : resultTextRef.current;
            const layout = isSource ? sourceLayoutRef.current : resultLayoutRef.current;
            if (editor.centerAtTextOffset) {
                editor.centerAtTextOffset(viewAnchorOffsetsRef.current[side]);
            } else {
                editor.scrollTop = editorScrollTopForTextOffset(
                    editor,
                    text.length,
                    viewAnchorOffsetsRef.current[side],
                    layout,
                );
            }
            editor.scrollLeft = 0;
        }
        if (scrollSyncFrameRef.current !== null) {
            cancelAnimationFrame(scrollSyncFrameRef.current);
        }
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
    }, [updateSearchHighlight]);

    useEffect(() => () => {
        resultInput.cancel();
        for (const job of Object.values(searchJobsRef.current)) job?.abort();
        searchJobsRef.current = { source: null, result: null, replace: null };
        workerRef.current?.terminate();
        disposeSearchMirror(sourceSearchMirrorRef);
        disposeSearchMirror(resultSearchMirrorRef);
        if (scrollSyncFrameRef.current !== null) {
            cancelAnimationFrame(scrollSyncFrameRef.current);
        }
        if (changeScrollFrameRef.current !== null) {
            cancelAnimationFrame(changeScrollFrameRef.current);
            changeScrollFrameRef.current = null;
        }
        if (resizeTimerRef.current !== null) {
            window.clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = null;
        }
    }, [resultInput]);

    useEffect(() => {
        if (!fileInfo) return undefined;
        resultInput.cancel();
        clearSearchHighlight('result');
        workerRef.current?.terminate();
        const worker = new Worker(new URL('../workers/textCleanerWorker.js', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        setAnalyzing(true);
        quoteRequestIdRef.current += 1;
        setQuoteReviewPending(true);
        setQuoteReviewError(false);
        setError('');

        worker.onmessage = event => {
            if (workerRef.current !== worker) return;
            if (event.data?.type === 'resultReviewResult') {
                if (event.data.requestId !== quoteRequestIdRef.current) return;
                setQuoteReviewPending(false);
                setQuoteReviewError(!event.data.ok);
                if (event.data.ok) {
                    const { lineCount, review } = event.data;
                    setLineCounts(current => current.result === lineCount
                        ? current : { ...current, result: lineCount });
                    if (review) {
                        setQuoteReview(review);
                        setSelectedQuoteIndex(index => Math.min(index, Math.max(0, review.issues.length - 1)));
                    }
                }
                return;
            }
            if (event.data?.type === 'measureCharacters') {
                worker.postMessage({
                    type: 'characterWidths',
                    operation: event.data.operation,
                    analysisId: event.data.analysisId,
                    requestId: event.data.requestId,
                    widths: measureEditorCharacters(
                        sourceAreaRef.current,
                        event.data.characters,
                    ),
                });
                return;
            }
            if (event.data?.type === 'layoutResult') {
                if (event.data.requestId !== layoutRequestIdRef.current || resultInput.pending) return;
                layoutStaleRef.current = false;
                if (!event.data.ok) return;
                sourceLayoutRef.current = event.data.sourceLayout;
                resultLayoutRef.current = event.data.resultLayout;
                restoreEditorsAfterLayout();
                return;
            }
            setAnalyzing(false);
            setQuoteReviewPending(false);
            if (!event.data?.ok) {
                setQuoteReviewError(true);
                setError(event.data?.error || t('tools.text_cleaner.error_analysis'));
                return;
            }
            const result = event.data.result;
            resultTextRef.current = result.text;
            sourceLayoutRef.current = result.sourceLayout;
            resultLayoutRef.current = result.resultLayout;
            layoutStaleRef.current = false;
            if (resultAreaRef.current) resultAreaRef.current.value = result.text;
            setChanges(result.changes);
            setTotalChangeCount(result.changeCount);
            setChangesTruncated(result.changesTruncated);
            setSelectedChangeIndex(0);
            setProtectedLineCount(result.protectedLineCount);
            setQuoteReview(result.quoteReview);
            setSelectedQuoteIndex(0);
            setLineCounts({
                source: result.sourceLayout.lineStarts.length,
                result: result.resultLayout.lineStarts.length,
            });
            setResultTextVersion(version => version + 1);
            setManualEdited(false);
            setDirty(result.text !== sourceTextRef.current || fileInfo.encoding !== 'utf-8-bom');
        };
        worker.onerror = () => {
            if (workerRef.current !== worker) return;
            setAnalyzing(false);
            setQuoteReviewPending(false);
            setQuoteReviewError(true);
            setError(t('tools.text_cleaner.error_analysis'));
        };
        worker.postMessage({
            analysisId: analysisVersion,
            text: sourceTextRef.current,
            options,
            wrapMetrics: editorWrapMetrics(sourceAreaRef.current),
        });

        return () => {
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
        };
    }, [analysisVersion, clearSearchHighlight, options, restoreEditorsAfterLayout, resultInput, t]);

    useEffect(() => {
        const sourceEditor = sourceAreaRef.current;
        if (!fileInfo || !sourceEditor || typeof ResizeObserver === 'undefined') return undefined;
        editorWidthRef.current = sourceEditor.clientWidth;
        const observer = new ResizeObserver(() => {
            const width = sourceAreaRef.current?.clientWidth || 0;
            if (!width || Math.abs(width - editorWidthRef.current) < 1) return;
            editorWidthRef.current = width;
            layoutStaleRef.current = true;
            for (const side of ['source', 'result']) {
                const activeMatch = activeSearchMatchRef.current[side];
                if (activeMatch) delete activeMatch.mirrorGeometry;
                const highlight = side === 'source'
                    ? sourceSearchHighlightRef.current
                    : resultSearchHighlightRef.current;
                if (highlight) highlight.hidden = true;
                disposeSearchMirror(side === 'source'
                    ? sourceSearchMirrorRef
                    : resultSearchMirrorRef);
            }
            if (resizeTimerRef.current !== null) {
                window.clearTimeout(resizeTimerRef.current);
            }
            resizeTimerRef.current = window.setTimeout(() => {
                resizeTimerRef.current = null;
                refreshActiveSearches();
                const worker = workerRef.current;
                if (!worker) return;
                const requestId = layoutRequestIdRef.current + 1;
                layoutRequestIdRef.current = requestId;
                worker.postMessage({
                    type: 'layout',
                    requestId,
                    sourceText: sourceTextRef.current,
                    resultText: resultTextRef.current,
                    wrapMetrics: editorWrapMetrics(sourceAreaRef.current),
                });
            }, 180);
        });
        observer.observe(sourceEditor);
        return () => {
            observer.disconnect();
            if (resizeTimerRef.current !== null) {
                window.clearTimeout(resizeTimerRef.current);
                resizeTimerRef.current = null;
            }
        };
    }, [fileInfo, refreshActiveSearches]);

    useEffect(() => {
        if (!fileInfo) return;
        if (sourceAreaRef.current) sourceAreaRef.current.value = sourceTextRef.current;
        if (resultAreaRef.current) resultAreaRef.current.value = resultTextRef.current;
    }, [fileInfo]);

    const startSearch = useCallback((side, query, searchOptions) => {
        searchJobsRef.current[side]?.abort();
        const controller = new AbortController();
        searchJobsRef.current[side] = controller;
        const setResult = side === 'source' ? setSourceSearchResult : setResultSearchResult;
        setResult({ ...EMPTY_SEARCH_RESULT, query, options: searchOptions, pending: Boolean(query) });
        if (!query) return () => controller.abort();
        const text = side === 'source' ? sourceTextRef.current : resultTextRef.current;
        const timeoutId = window.setTimeout(() => {
            runTextCleanerSearchJob({ text, query, options: searchOptions }, { signal: controller.signal })
                .then(search => {
                    if (controller.signal.aborted) return;
                    const active = activeSearchMatchRef.current[side];
                    const index = active ? search.matches.findIndex((start, index) => (
                        start === active.start && search.ends[index] === active.end
                    )) : -1;
                    setResult({ ...search, query, options: searchOptions, index, pending: false, error: null });
                })
                .catch(error => {
                    if (controller.signal.aborted) return;
                    setResult({ ...EMPTY_SEARCH_RESULT, query, options: searchOptions, error: error.code || 'search_failed' });
                });
        }, 180);
        return () => { window.clearTimeout(timeoutId); controller.abort(); };
    }, []);

    useEffect(() => {
        return startSearch('source', sourceSearchQuery, sourceSearchOptions);
    }, [fileInfo, sourceSearchOptions, sourceSearchQuery, startSearch]);

    useEffect(() => {
        if (analyzing || resultInput.pending) return undefined;
        return startSearch('result', resultSearchQuery, resultSearchOptions);
    }, [analyzing, fileInfo, resultInput, resultSearchOptions, resultSearchQuery, resultTextVersion, startSearch]);

    useEffect(() => {
        const requestId = ++quoteRequestIdRef.current;
        if (!fileInfo || analyzing || resultInput.pending) return undefined;
        const timeoutId = window.setTimeout(() => {
            if (requestId !== quoteRequestIdRef.current || resultInput.pending) return;
            workerRef.current?.postMessage({
                type: 'resultReview', requestId, text: resultTextRef.current,
                query: '', inspectQuotes: manualEdited,
            });
        }, 180);
        return () => window.clearTimeout(timeoutId);
    }, [analyzing, fileInfo, manualEdited, resultInput, resultTextVersion]);

    const mappedEditorOffset = useCallback((side, offset) => {
        const isSource = side === 'source';
        const sourceText = isSource ? sourceTextRef.current : resultTextRef.current;
        const targetText = isSource ? resultTextRef.current : sourceTextRef.current;
        if (manualEdited || layoutStaleRef.current) {
            return Math.round((offset / Math.max(1, sourceText.length)) * targetText.length);
        }
        const canonicalOffset = mapTextOffsetByCanonical(
            sourceText,
            isSource ? sourceLayoutRef.current : resultLayoutRef.current,
            targetText,
            isSource ? resultLayoutRef.current : sourceLayoutRef.current,
            offset,
        );
        return canonicalOffset ?? (isSource
            ? mapTextOffsetThroughChanges(changes, offset)
            : mapTextOffsetThroughChanges(changes, offset, 'resultStart', 'resultEnd', 'sourceStart', 'sourceEnd'));
    }, [changes, manualEdited]);

    const alignPairedEditor = useCallback((side, offset) => {
        const isSource = side === 'source';
        const target = isSource ? resultAreaRef.current : sourceAreaRef.current;
        const targetSide = isSource ? 'result' : 'source';
        const targetOffset = mappedEditorOffset(side, offset);
        viewAnchorOffsetsRef.current[side] = offset;
        viewAnchorOffsetsRef.current[targetSide] = targetOffset;
        centerEditorAtTextOffset(target, targetOffset);
        const index = closestTextChangeIndex(changes, offset, isSource ? 'sourceStart' : 'resultStart');
        if (index >= 0) setSelectedChangeIndex(index);
    }, [changes, mappedEditorOffset]);

    const focusQuote = useCallback(index => {
        const issue = quoteReview.issues[index];
        const editor = resultAreaRef.current;
        if (!issue || !editor || quoteReviewPending || quoteReviewError || busy) return;
        setSelectedQuoteIndex(index);
        clearSearchHighlight('result');
        const geometry = searchMirrorGeometry(editor, resultTextRef.current, issue, resultSearchMirrorRef);
        syncingScrollRef.current = true;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(issue.start, issue.end);
        if (geometry) centerEditorAtMirrorGeometry(editor, geometry);
        else centerEditorAtTextOffset(editor, issue.start);
        alignPairedEditor('result', issue.start);
        if (scrollSyncFrameRef.current !== null) cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
    }, [alignPairedEditor, busy, clearSearchHighlight, quoteReview, quoteReviewError, quoteReviewPending]);

    const confirmDiscard = useCallback(() => {
        if (!dirty) return true;
        return window.confirm(t('tools.text_cleaner.confirm_discard'));
    }, [dirty, t]);

    const loadFile = useCallback(async filePath => {
        if (!filePath || !confirmDiscard()) return;
        const requestId = loadRequestIdRef.current + 1;
        loadRequestIdRef.current = requestId;
        for (const job of Object.values(searchJobsRef.current)) job?.abort();
        searchJobsRef.current = { source: null, result: null, replace: null };
        pendingSearchMoveRef.current = { source: null, result: null };
        setReplacing(false);
        resultInput.cancel();
        setLoading(true);
        setError('');
        workerRef.current?.terminate();
        workerRef.current = null;
        if (resizeTimerRef.current !== null) {
            window.clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = null;
        }
        clearSearchHighlight('source');
        clearSearchHighlight('result');
        if (sourceAreaRef.current) sourceAreaRef.current.value = '';
        if (resultAreaRef.current) resultAreaRef.current.value = '';
        sourceTextRef.current = '';
        resultTextRef.current = '';
        sourceLayoutRef.current = null;
        resultLayoutRef.current = null;
        viewAnchorOffsetsRef.current = { source: 0, result: 0 };
        setFileInfo(null);
        setChanges([]);
        setTotalChangeCount(0);
        setChangesTruncated(false);
        setProtectedLineCount(0);
        quoteRequestIdRef.current += 1;
        setQuoteReview({ issues: [], total: 0, truncated: false });
        setQuoteReviewPending(false);
        setQuoteReviewError(false);
        setSelectedQuoteIndex(0);
        setSourceSearchQuery('');
        setResultSearchQuery('');
        setSourceSearchResult(EMPTY_SEARCH_RESULT);
        setResultSearchResult(EMPTY_SEARCH_RESULT);
        try {
            await waitForRendererPaint();
            const response = await window.electronAPI?.loadTextCleanerFile?.(filePath);
            if (requestId !== loadRequestIdRef.current) return;
            if (!response?.ok) throw response?.error || new Error(t('tools.text_cleaner.error_load'));
            sourceTextRef.current = response.text;
            resultTextRef.current = response.text;
            setFileInfo({
                filePath: response.filePath,
                fileName: response.fileName || fileNameFromPath(response.filePath),
                encoding: response.encoding,
                byteLength: response.byteLength,
                snapshot: response.snapshot,
            });
            setChanges([]);
            setTotalChangeCount(0);
            setChangesTruncated(false);
            setManualEdited(false);
            setDirty(false);
            setSourceSearchQuery('');
            setResultSearchQuery('');
            setSourceSearchResult(EMPTY_SEARCH_RESULT);
            setResultSearchResult(EMPTY_SEARCH_RESULT);
            setAnalysisVersion(version => version + 1);
        } catch (loadError) {
            if (requestId !== loadRequestIdRef.current) return;
            setError(errorMessage(t, loadError, 'tools.text_cleaner.error_load'));
        } finally {
            if (requestId === loadRequestIdRef.current) setLoading(false);
        }
    }, [clearSearchHighlight, confirmDiscard, resultInput, t]);

    useEffect(() => {
        if (!openRequest?.path || handledOpenRequestRef.current === openRequest.token) return;
        handledOpenRequestRef.current = openRequest.token;
        loadFile(openRequest.path);
    }, [loadFile, openRequest]);

    const handleChooseFile = useCallback(async () => {
        try {
            const filePath = await window.electronAPI?.selectFile?.(
                t('tools.text_cleaner.choose_file'),
                [{ name: 'Text files', extensions: ['txt'] }],
            );
            if (filePath) await loadFile(filePath);
        } catch (selectError) {
            setError(errorMessage(t, selectError, 'tools.text_cleaner.error_load'));
        }
    }, [loadFile, t]);

    const handleDrop = useCallback(event => {
        event.preventDefault();
        event.stopPropagation();
        const filePath = firstTextCleanerPath(droppedPathsFromDataTransfer(event.dataTransfer));
        if (!filePath) {
            setError(t('tools.text_cleaner.error_txt_only'));
            return;
        }
        loadFile(filePath);
    }, [loadFile, t]);

    const handleDragOver = useCallback(event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleRuleChange = useCallback(key => {
        if (manualEdited && !window.confirm(t('tools.text_cleaner.confirm_reanalyze'))) return;
        setOptions(current => ({ ...current, [key]: !current[key] }));
    }, [manualEdited, t]);

    const handleReanalyze = useCallback(() => {
        if (manualEdited && !window.confirm(t('tools.text_cleaner.confirm_reanalyze'))) return;
        setAnalysisVersion(version => version + 1);
    }, [manualEdited, t]);

    const handleResultInput = useCallback(() => {
        searchJobsRef.current.result?.abort();
        searchJobsRef.current.replace?.abort();
        pendingSearchMoveRef.current.result = null;
        clearSearchHighlight('result');
        quoteRequestIdRef.current += 1;
        layoutRequestIdRef.current += 1;
        setQuoteReviewPending(true);
        setQuoteReviewError(false);
        resultInput.schedule();
        setResultSearchResult(current => !current.query || current.pending
            ? current : { ...current, pending: true, index: -1 });
        setManualEdited(true);
        setDirty(true);
    }, [clearSearchHighlight, resultInput]);

    const moveSearch = useCallback((side, direction, focusTarget = null) => {
        const isSource = side === 'source';
        const searchResult = isSource ? sourceSearchResult : resultSearchResult;
        const query = isSource ? sourceSearchQuery : resultSearchQuery;
        const searchOptions = isSource ? sourceSearchOptions : resultSearchOptions;
        if (query && (searchResult.pending || (!isSource && resultInput.pending))) {
            pendingSearchMoveRef.current[side] = { direction, focusTarget };
            if (!isSource && resultInput.pending) resultInput.flush();
            return;
        }
        if (searchResult.pending || searchResult.error || searchResult.query !== query
            || searchResult.options !== searchOptions || (!isSource && resultInput.pending)) return;
        const text = isSource ? sourceTextRef.current : resultTextRef.current;
        const effectiveResult = searchResult;
        if (!query || !effectiveResult.matches.length) return;
        const nextIndex = effectiveResult.index < 0
            ? (direction < 0 ? effectiveResult.matches.length - 1 : 0)
            : (effectiveResult.index + direction + effectiveResult.matches.length)
                % effectiveResult.matches.length;
        const matchOffset = effectiveResult.matches[nextIndex];
        const editor = isSource ? sourceAreaRef.current : resultAreaRef.current;
        const layout = isSource ? sourceLayoutRef.current : resultLayoutRef.current;
        const mirrorRef = isSource ? sourceSearchMirrorRef : resultSearchMirrorRef;
        const setSearchResult = isSource ? setSourceSearchResult : setResultSearchResult;
        setSearchResult({ ...effectiveResult, index: nextIndex });
        if (!editor) return;
        const activeMatch = {
            start: matchOffset,
            end: effectiveResult.ends[nextIndex],
        };
        const mirrorGeometry = searchMirrorGeometry(editor, text, activeMatch, mirrorRef);
        if (mirrorGeometry) activeMatch.mirrorGeometry = mirrorGeometry;
        activeSearchMatchRef.current[side] = activeMatch;
        viewAnchorOffsetsRef.current[side] = matchOffset;
        syncingScrollRef.current = true;
        if (!focusTarget) editor.focus({ preventScroll: true });
        editor.setSelectionRange(activeMatch.start, activeMatch.end);
        focusTarget?.focus({ preventScroll: true });
        updateSearchHighlight(side);
        if (mirrorGeometry) {
            centerEditorAtMirrorGeometry(editor, mirrorGeometry);
        } else if (editor.centerAtTextOffset) {
            editor.centerAtTextOffset(matchOffset);
        } else {
            editor.scrollTop = editorScrollTopForTextOffset(
                editor,
                text.length,
                matchOffset,
                layout,
            );
        }
        editor.scrollLeft = 0;
        alignPairedEditor(side, matchOffset);
        if (scrollSyncFrameRef.current !== null) cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
    }, [alignPairedEditor, resultInput, resultSearchOptions, resultSearchQuery, resultSearchResult, sourceSearchOptions, sourceSearchQuery, sourceSearchResult, updateSearchHighlight]);

    const handleSave = useCallback(async () => {
        if (!fileInfo || analyzing) return;
        setSaving(true);
        setError('');
        try {
            const text = resultInput.flush();
            const response = await window.electronAPI?.saveTextCleanerFile?.({
                filePath: fileInfo.filePath,
                snapshot: fileInfo.snapshot,
                text,
                backup,
            });
            if (!response?.ok) throw response?.error || new Error(t('tools.text_cleaner.error_save'));
            resultTextRef.current = text;
            setFileInfo(current => ({
                ...current,
                encoding: response.encoding,
                byteLength: response.byteLength,
                snapshot: response.snapshot,
            }));
            setDirty(false);
            showToast?.(response.backupPath
                ? { key: 'tools.text_cleaner.saved', values: { backup: response.backupPath } }
                : { key: 'tools.text_cleaner.saved_without_backup' });
        } catch (saveError) {
            setError(errorMessage(t, saveError, 'tools.text_cleaner.error_save'));
        } finally {
            setSaving(false);
        }
    }, [analyzing, backup, fileInfo, resultInput, showToast, t]);

    const handleReplace = useCallback(async all => {
        if (busy || !resultSearchQuery || searchJobsRef.current.replace) return;
        const controller = new AbortController();
        searchJobsRef.current.replace = controller;
        const text = resultInput.flush();
        const editor = resultAreaRef.current;
        const start = activeSearchMatchRef.current.result?.start ?? editor?.selectionStart ?? 0;
        setReplacing(true);
        try {
            const response = await runTextCleanerSearchJob({
                type: 'replace', text, query: resultSearchQuery, replacement,
                options: { ...resultSearchOptions, preserveCase }, all, start,
            }, { signal: controller.signal });
            if (controller.signal.aborted || resultAreaRef.current !== editor || editor.value !== text) return;
            searchJobsRef.current.replace = null;
            if (response.change && response.change.insert !== text.slice(response.change.from, response.change.to)) {
                editor.replaceText(response.change);
                resultInput.flush();
            }
            const search = response.search;
            let index = search.matches.findIndex(offset => offset >= response.nextOffset);
            if (index < 0 && search.matches.length) index = 0;
            setResultSearchResult({ ...search, query: resultSearchQuery, options: resultSearchOptions, index, pending: false, error: null });
            clearSearchHighlight('result');
            if (index >= 0) {
                const match = { start: search.matches[index], end: search.ends[index] };
                activeSearchMatchRef.current.result = match;
                editor.setSelectionRange(match.start, match.end);
                updateSearchHighlight('result');
                centerEditorAtTextOffset(editor, match.start);
                alignPairedEditor('result', match.start);
            }
            showToast?.({ key: 'tools.text_cleaner.replaced', values: { count: response.count.toLocaleString() } });
        } catch (error) {
            if (!controller.signal.aborted) {
                setResultSearchResult({ ...EMPTY_SEARCH_RESULT, query: resultSearchQuery, error: error.code || 'search_failed' });
            }
        } finally {
            if (searchJobsRef.current.replace === controller || !controller.signal.aborted) {
                searchJobsRef.current.replace = null;
                setReplacing(false);
            }
        }
    }, [alignPairedEditor, busy, clearSearchHighlight, preserveCase, replacement, resultInput, resultSearchOptions, resultSearchQuery, showToast, updateSearchHighlight]);

    const changeSearch = useCallback((side, query, searchOptions) => {
        searchJobsRef.current[side]?.abort();
        searchJobsRef.current.replace?.abort();
        pendingSearchMoveRef.current[side] = null;
        clearSearchHighlight(side);
        if (side === 'source') {
            setSourceSearchQuery(query);
            setSourceSearchOptions(searchOptions);
            setSourceSearchResult({ ...EMPTY_SEARCH_RESULT, query, pending: Boolean(query) });
        } else {
            setResultSearchQuery(query);
            setResultSearchOptions(searchOptions);
            setResultSearchResult({ ...EMPTY_SEARCH_RESULT, query, pending: Boolean(query) });
        }
    }, [clearSearchHighlight]);

    useEffect(() => {
        for (const [side, search] of [['source', sourceSearchResult], ['result', resultSearchResult]]) {
            const pending = pendingSearchMoveRef.current[side];
            if (!pending || search.pending) continue;
            pendingSearchMoveRef.current[side] = null;
            if (!search.error) moveSearch(side, pending.direction, pending.focusTarget);
        }
    }, [moveSearch, resultSearchResult, sourceSearchResult]);

    const handleBack = useCallback(() => {
        if (confirmDiscard()) onBack();
    }, [confirmDiscard, onBack]);

    const syncScroll = useCallback((source, target, direction) => {
        if (syncingScrollRef.current || !source || !target) return false;
        syncingScrollRef.current = true;
        const sourceIsOriginal = direction === 'source';
        const sourceLength = sourceIsOriginal
            ? sourceTextRef.current.length
            : resultTextRef.current.length;
        const targetLength = sourceIsOriginal
            ? resultTextRef.current.length
            : sourceTextRef.current.length;
        const sourceLayout = sourceIsOriginal ? sourceLayoutRef.current : resultLayoutRef.current;
        const targetLayout = sourceIsOriginal ? resultLayoutRef.current : sourceLayoutRef.current;
        const sourceOffset = textOffsetForEditorScroll(source, sourceLength, sourceLayout);
        if (manualEdited || layoutStaleRef.current) {
            const sourceRange = Math.max(1, source.scrollHeight - source.clientHeight);
            const targetRange = Math.max(0, target.scrollHeight - target.clientHeight);
            const scrollTop = (source.scrollTop / sourceRange) * targetRange;
            if (target.setScrollTop) target.setScrollTop(scrollTop);
            else target.scrollTop = scrollTop;
        } else {
            const targetOffset = mappedEditorOffset(direction, sourceOffset);
            const centeredNatively = centerEditorAtTextOffset(target, targetOffset);
            if (!centeredNatively) {
                target.scrollTop = editorScrollTopForTextOffset(
                    target,
                    targetLength,
                    targetOffset,
                    targetLayout,
                );
            }
        }
        target.scrollLeft = 0;
        if (!layoutStaleRef.current) {
            viewAnchorOffsetsRef.current[direction] = sourceOffset;
            const targetSide = sourceIsOriginal ? 'result' : 'source';
            viewAnchorOffsetsRef.current[targetSide] = textOffsetForEditorScroll(
                target,
                targetLength,
                targetLayout,
            );
        }
        if (scrollSyncFrameRef.current !== null) {
            cancelAnimationFrame(scrollSyncFrameRef.current);
        }
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
        return sourceOffset;
    }, [manualEdited, mappedEditorOffset]);

    const handleEditorScroll = useCallback((source, target, direction) => {
        updateSearchHighlight(direction);
        const offset = syncScroll(source, target, direction);
        if (offset === false) return;
        if (changeScrollFrameRef.current !== null) {
            cancelAnimationFrame(changeScrollFrameRef.current);
        }
        changeScrollFrameRef.current = requestAnimationFrame(() => {
            changeScrollFrameRef.current = null;
            const textLength = direction === 'source'
                ? sourceTextRef.current.length
                : resultTextRef.current.length;
            const layout = direction === 'source' ? sourceLayoutRef.current : resultLayoutRef.current;
            const visibleOffset = textOffsetForEditorScroll(source, textLength, layout);
            const offsetKey = direction === 'source' ? 'sourceStart' : 'resultStart';
            const index = closestTextChangeIndex(changes, visibleOffset, offsetKey);
            if (index >= 0) setSelectedChangeIndex(index);
        });
    }, [changes, syncScroll, updateSearchHighlight]);

    const focusChange = useCallback(index => {
        const change = changes[index];
        if (!change) return;
        const sourceArea = sourceAreaRef.current;
        const resultArea = resultAreaRef.current;
        setSelectedChangeIndex(index);
        viewAnchorOffsetsRef.current = {
            source: change.sourceStart,
            result: change.resultStart,
        };
        syncingScrollRef.current = true;
        sourceArea?.focus({ preventScroll: true });
        sourceArea?.setSelectionRange(change.sourceStart, change.sourceEnd);
        if (!manualEdited) {
            resultArea?.focus({ preventScroll: true });
            resultArea?.setSelectionRange(change.resultStart, change.resultEnd);
        }
        if (sourceArea) {
            const centeredNatively = centerEditorAtTextOffset(sourceArea, change.sourceStart);
            if (!centeredNatively) {
                sourceArea.scrollTop = editorScrollTopForTextOffset(
                    sourceArea,
                    sourceTextRef.current.length,
                    change.sourceStart,
                    sourceLayoutRef.current,
                );
            }
            sourceArea.scrollLeft = 0;
        }
        if (resultArea) {
            const centeredNatively = centerEditorAtTextOffset(resultArea, change.resultStart);
            if (!centeredNatively) {
                resultArea.scrollTop = editorScrollTopForTextOffset(
                    resultArea,
                    resultTextRef.current.length,
                    change.resultStart,
                    resultLayoutRef.current,
                );
            }
            resultArea.scrollLeft = 0;
        }
        if (changeScrollFrameRef.current !== null) {
            cancelAnimationFrame(changeScrollFrameRef.current);
            changeScrollFrameRef.current = null;
        }
        if (scrollSyncFrameRef.current !== null) {
            cancelAnimationFrame(scrollSyncFrameRef.current);
        }
        scrollSyncFrameRef.current = requestAnimationFrame(() => {
            scrollSyncFrameRef.current = null;
            syncingScrollRef.current = false;
        });
    }, [changes, manualEdited]);

    if (!fileInfo) {
        return (
            <section
                className="text-cleaner-tool is-empty"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <header className="text-cleaner-toolbar">
                    <button type="button" className="text-cleaner-back" onClick={handleBack}>
                        <FaIcon name="chevronLeft" size={12} />
                        {t('tools.back')}
                    </button>
                    <h1>{t('tools.item.text_cleaner')}</h1>
                </header>
                <div className="text-cleaner-empty-card">
                    <span className="text-cleaner-empty-icon"><FaIcon name="fileLines" size={28} /></span>
                    <h2>{t('tools.text_cleaner.empty_title')}</h2>
                    <p>{t('tools.text_cleaner.empty_description')}</p>
                    <button type="button" className="text-cleaner-primary" onClick={handleChooseFile} disabled={loading}>
                        <FaIcon name={loading ? 'spinner' : 'folderOpen'} className={loading ? 'fa-spin' : ''} size={14} />
                        {loading ? t('tools.text_cleaner.loading') : t('tools.text_cleaner.choose_file')}
                    </button>
                    <small>{t('tools.text_cleaner.empty_hint')}</small>
                    {error && <div className="text-cleaner-message is-error" role="alert">{error}</div>}
                </div>
            </section>
        );
    }

    return (
        <section
            className="text-cleaner-tool"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <header className="text-cleaner-toolbar">
                <button type="button" className="text-cleaner-back" onClick={handleBack}>
                    <FaIcon name="chevronLeft" size={12} />
                    {t('tools.back')}
                </button>
                <div className="text-cleaner-file-title">
                    <h1>{fileInfo.fileName}</h1>
                    <span>{fileInfo.encoding.toUpperCase()} · {formatBytes(fileInfo.byteLength)}</span>
                </div>
                <div className="text-cleaner-toolbar-actions">
                    <button type="button" onClick={handleChooseFile} disabled={busy}>
                        <FaIcon name="folderOpen" size={13} />
                        {t('tools.text_cleaner.open_another')}
                    </button>
                    <button type="button" onClick={handleReanalyze} disabled={busy}>
                        <FaIcon name="rotateLeft" size={13} />
                        {t('tools.text_cleaner.reanalyze')}
                    </button>
                    <label className="text-cleaner-backup-option">
                        <input
                            type="checkbox"
                            checked={backup}
                            disabled={busy}
                            onChange={event => setBackup(event.target.checked)}
                        />
                        {t('tools.text_cleaner.backup')}
                    </label>
                    <button type="button" className="text-cleaner-primary" onClick={handleSave} disabled={busy || !dirty}>
                        <FaIcon name={saving ? 'spinner' : 'floppy'} className={saving ? 'fa-spin' : ''} size={13} />
                        {saving ? t('tools.text_cleaner.saving') : t('tools.text_cleaner.save')}
                    </button>
                </div>
            </header>

            <div className="text-cleaner-options" aria-label={t('tools.text_cleaner.rules')}>
                <strong>{t('tools.text_cleaner.rules')}</strong>
                {ruleItems.map(rule => (
                    <label key={rule.key}>
                        <input
                            type="checkbox"
                            checked={options[rule.key]}
                            disabled={busy}
                            onChange={() => handleRuleChange(rule.key)}
                        />
                        {rule.label}
                    </label>
                ))}
                <button type="button" onClick={() => setReviewPanel('quotes')} className="text-cleaner-quote-summary">
                    {t('tools.text_cleaner.quote_review')}{' · '}{quoteReviewPending ? t('tools.text_cleaner.quote_checking') : quoteReview.total}
                </button>
                <span className="text-cleaner-coming">{t('tools.text_cleaner.rule_spelling')} · {t('tools.status.planned')}</span>
            </div>

            {error && (
                <div className="text-cleaner-message is-error" role="alert">
                    {error}
                </div>
            )}

            <div className="text-cleaner-workspace">
                <section className="text-cleaner-editor-pane">
                    <header>
                        <div className="text-cleaner-pane-heading"><strong>{t('tools.text_cleaner.original')}</strong><span>{t('tools.text_cleaner.read_only')}</span></div>
                        <TextCleanerSearch
                            t={t}
                            query={sourceSearchQuery}
                            result={sourceSearchResult}
                            options={sourceSearchOptions}
                            disabled={busy}
                            onQueryChange={query => changeSearch('source', query, sourceSearchOptions)}
                            onOptionsChange={options => changeSearch('source', sourceSearchQuery, options)}
                            onMove={(direction, focusTarget) => (
                                moveSearch('source', direction, focusTarget)
                            )}
                        />
                    </header>
                    <div className="text-cleaner-editor-frame">
                        <TextCleanerEditor
                            ref={sourceAreaRef}
                            readOnly
                            label={t('tools.text_cleaner.original')}
                            onScroll={() => handleEditorScroll(
                                sourceAreaRef.current,
                                resultAreaRef.current,
                                'source',
                            )}
                        />
                        <span ref={sourceSearchHighlightRef} className="text-cleaner-search-highlight" hidden />
                    </div>
                    <footer>{t('tools.text_cleaner.line_count', { count: lineCounts.source.toLocaleString() })}</footer>
                </section>
                <section className="text-cleaner-editor-pane">
                    <header>
                        <div className="text-cleaner-pane-heading">
                            <strong>{t('tools.text_cleaner.result')}</strong>
                            <span>{t('tools.text_cleaner.editable')}</span>
                            {manualEdited && <em>{t('tools.text_cleaner.manually_edited')}</em>}
                        </div>
                        <TextCleanerSearch
                            t={t}
                            query={resultSearchQuery}
                            result={resultSearchResult}
                            options={resultSearchOptions}
                            disabled={busy}
                            onQueryChange={query => changeSearch('result', query, resultSearchOptions)}
                            onOptionsChange={options => changeSearch('result', resultSearchQuery, options)}
                            replacement={replacement}
                            onReplacementChange={setReplacement}
                            preserveCase={preserveCase}
                            onPreserveCaseChange={setPreserveCase}
                            onReplace={handleReplace}
                            onMove={(direction, focusTarget) => (
                                moveSearch('result', direction, focusTarget)
                            )}
                        />
                    </header>
                    <div className="text-cleaner-editor-frame">
                        <TextCleanerEditor
                            ref={resultAreaRef}
                            label={t('tools.text_cleaner.result')}
                            readOnly={busy}
                            onInput={handleResultInput}
                            onCompositionStart={resultInput.compositionStart}
                            onCompositionEnd={resultInput.compositionEnd}
                            onScroll={() => handleEditorScroll(
                                resultAreaRef.current,
                                sourceAreaRef.current,
                                'result',
                            )}
                        />
                        <span ref={resultSearchHighlightRef} className="text-cleaner-search-highlight" hidden />
                        {analyzing && <div className="text-cleaner-analyzing"><FaIcon name="spinner" className="fa-spin" size={16} />{t('tools.text_cleaner.analyzing')}</div>}
                    </div>
                    <footer>{t('tools.text_cleaner.line_count', { count: lineCounts.result.toLocaleString() })}</footer>
                </section>
            </div>

            <section className="text-cleaner-change-panel" aria-label={t('tools.text_cleaner.review')}>
                <div className="text-cleaner-review-tabs">
                    <button type="button" aria-pressed={reviewPanel === 'changes'} onClick={() => setReviewPanel('changes')}>
                        {t('tools.text_cleaner.changes')}
                    </button>
                    <button type="button" aria-pressed={reviewPanel === 'quotes'} onClick={() => setReviewPanel('quotes')}>
                        {t('tools.text_cleaner.quote_review')}{' · '}{quoteReviewPending ? t('tools.text_cleaner.quote_checking') : quoteReview.total}
                    </button>
                </div>
                {reviewPanel === 'changes' ? <>
                <div className="text-cleaner-change-summary">
                    <div>
                        <strong>{t('tools.text_cleaner.changes')}</strong>
                        <span>{t('tools.text_cleaner.change_count', { count: totalChangeCount })}</span>
                        {changesTruncated && <span>{t('tools.text_cleaner.change_shown', { count: changes.length })}</span>}
                        <span>{t('tools.text_cleaner.protected_count', { count: protectedLineCount })}</span>
                    </div>
                    <div className="text-cleaner-change-nav">
                        <button type="button" disabled={selectedChangeIndex <= 0} onClick={() => focusChange(selectedChangeIndex - 1)} aria-label={t('tools.text_cleaner.previous_change')}>
                            <FaIcon name="chevronLeft" size={11} />
                        </button>
                        <span>{changes.length ? `${selectedChangeIndex + 1} / ${changes.length}` : '0 / 0'}</span>
                        <button type="button" disabled={selectedChangeIndex >= changes.length - 1} onClick={() => focusChange(selectedChangeIndex + 1)} aria-label={t('tools.text_cleaner.next_change')}>
                            <FaIcon name="chevronRight" size={11} />
                        </button>
                    </div>
                </div>
                {selectedChange ? (
                    <div className="text-cleaner-change-detail">
                        <span className="text-cleaner-change-type">
                            {selectedChange.type === 'lineBreak' ? t('tools.text_cleaner.type_line_break') : t('tools.text_cleaner.type_whitespace')}
                            {' · '}{t('tools.text_cleaner.line_number', { line: selectedChange.line })}
                        </span>
                        <label>
                            {t('tools.text_cleaner.before')}
                            <textarea readOnly value={selectedChange.before} />
                        </label>
                        <span className="text-cleaner-change-arrow">→</span>
                        <label>
                            {t('tools.text_cleaner.after')}
                            <textarea readOnly value={selectedChange.after || t('tools.text_cleaner.joined')} />
                        </label>
                    </div>
                ) : (
                    <p className="text-cleaner-no-changes">{t('tools.text_cleaner.no_changes')}</p>
                )}
                </> : <div className="text-cleaner-quote-review">
                    <div className="text-cleaner-change-summary">
                        <span>{t('tools.text_cleaner.quote_hint')}</span>
                        <div className="text-cleaner-change-nav">
                            <button type="button" disabled={busy || quoteReviewPending || quoteReviewError || selectedQuoteIndex <= 0} onClick={() => focusQuote(selectedQuoteIndex - 1)} aria-label={t('tools.text_cleaner.previous_quote')}>
                                <FaIcon name="chevronLeft" size={11} />
                            </button>
                            <span>{!quoteReviewPending && selectedQuote ? `${selectedQuoteIndex + 1} / ${quoteReview.issues.length}` : '0 / 0'}</span>
                            <button type="button" disabled={busy || quoteReviewPending || quoteReviewError || selectedQuoteIndex >= quoteReview.issues.length - 1} onClick={() => focusQuote(selectedQuoteIndex + 1)} aria-label={t('tools.text_cleaner.next_quote')}>
                                <FaIcon name="chevronRight" size={11} />
                            </button>
                        </div>
                    </div>
                    {quoteReviewPending ? <p role="status">{t('tools.text_cleaner.quote_checking')}</p>
                        : quoteReviewError ? <p role="alert">{t('tools.text_cleaner.error_analysis')}</p>
                            : selectedQuote ? <>
                                <button type="button" className="text-cleaner-quote-location" disabled={busy} onClick={() => focusQuote(selectedQuoteIndex)}>
                                    {t('tools.text_cleaner.line_number', { line: selectedQuote.line })}{' · '}
                                    {t(`tools.text_cleaner.quote_${selectedQuote.type}`, { expected: selectedQuote.expected, actual: selectedQuote.actual })}
                                    {' · '}{t('tools.text_cleaner.quote_go')}
                                </button>
                                <pre>{selectedQuote.preview}</pre>
                                {quoteReview.truncated && <span>{t('tools.text_cleaner.change_shown', { count: quoteReview.issues.length })}</span>}
                            </> : <p>{t('tools.text_cleaner.no_quote_issues')}</p>}
                </div>}
            </section>
        </section>
    );
}
