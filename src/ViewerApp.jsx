import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlipBook } from '@vuvandinh203/react-flipbook';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { FaIcon } from './components/FaIcon';
import fitWidthOrHeightIcon from './images/fit_width_or_height.svg';
import fitToPageIcon from './images/fit_to_page.svg';
import fullScreenIcon from './images/full_screen.svg';
import helpIcon from './images/help.svg';
import leftReadIcon from './images/left_read.svg';
import plusMinusIcon from './images/plus_minus.svg';
import readModeDoublePageIcon from './images/read_mode_double_page.svg';
import readModeOnePageIcon from './images/read_mode_one_page.svg';
import readModeScrollIcon from './images/read_mode_scroll.svg';
import showFullSizeIcon from './images/show_full_size.svg';
import listSearchIcon from './images/list_search.svg';
import slideNavigationIcon from './images/slide_navigation.svg';
import toolbarIcon from './images/toolbar.svg';
import { getCurrentLanguage, setLanguage, translate } from './utils/i18n';
import './styles/viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function viewerText(key, fallback, values) {
  if (!key) return fallback;
  const translated = translate(key, getCurrentLanguage(), values);
  return translated && translated !== key ? translated : fallback;
}

function isMacShortcutPlatform() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function viewerShortcutLabel(keys) {
  const isMac = isMacShortcutPlatform();
  return keys
    .map(key => key === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : key)
    .join(isMac ? '' : '+');
}

function isShortcutModifierEvent(event = {}) {
  return event.ctrlKey || event.metaKey;
}

const VIEW_MODES = [
  { id: 'width', label: '가로 맞춤', labelKey: 'viewer.fit.width', key: '7', iconSrc: fitWidthOrHeightIcon },
  { id: 'height', label: '높이 맞춤', labelKey: 'viewer.fit.height', key: '8', iconSrc: fitWidthOrHeightIcon, rotate: 90 },
  { id: 'fit', label: '전체 크기 맞춤', labelKey: 'viewer.fit.fit', key: '9', iconSrc: showFullSizeIcon },
  { id: 'actual', label: '원본 크기', labelKey: 'viewer.fit.actual', key: '0', iconSrc: fitToPageIcon },
];
const FLOW_MODES = [
  { id: 'single', label: '한장보기모드', labelKey: 'viewer.read_mode.single', iconSrc: readModeOnePageIcon },
  { id: 'spread', label: '두장보기모드', labelKey: 'viewer.read_mode.spread', iconSrc: readModeDoublePageIcon },
  { id: 'scroll', label: '스크롤모드', labelKey: 'viewer.read_mode.scroll', iconSrc: readModeScrollIcon },
];
const THEMES = [
  { id: 'dark', label: '다크', bg: '#181818', fg: '#ededed' },
  { id: 'black', label: '블랙', bg: '#050505', fg: '#f1f1f1' },
  { id: 'paper', label: '종이', bg: '#f2ead9', fg: '#252018' },
  { id: 'sepia', label: '세피아', bg: '#d8c3a0', fg: '#24190d' },
  { id: 'white', label: '화이트', bg: '#f7f7f7', fg: '#202020' },
  { id: 'green', label: '그린', bg: '#dfeedd', fg: '#162018' },
];
const DEFAULT_READER_SETTINGS = {
  theme: 'dark',
  fontFamily: 'Noto Sans KR',
  fontScale: 100,
  lineHeightPercent: 40,
  lineHeightStep: 4,
  letterSpacing: 0,
  verticalPadding: 36,
  horizontalPadding: 42,
  paragraphSpacing: 28,
  textAlign: 'left',
  textDirection: 'horizontal',
  showHeader: true,
  showFooter: true,
  wrapMode: 'word',
  pageEffect: 'none',
};
const DEFAULT_FONT_GROUPS = {
  epub: [],
  bundled: ['Noto Sans KR', 'Nanum Gothic', 'Nanum Gothic Coding', 'Jua'],
  system: ['Malgun Gothic', 'Segoe UI'],
};
const DEFAULT_VIEWER_BACKGROUND = {
  mode: 'solid',
  color: '#111111',
};
const VIEWER_BACKGROUND_COLORS = [
  { id: 'charcoal', label: '차콜', labelKey: 'viewer.background_color.charcoal', color: '#111111' },
  { id: 'black', label: '블랙', labelKey: 'viewer.background_color.black', color: '#050505' },
  { id: 'white', label: '화이트', labelKey: 'viewer.background_color.white', color: '#f7f7f7' },
  { id: 'gray', label: '그레이', labelKey: 'viewer.background_color.gray', color: '#2b2b2b' },
  { id: 'navy', label: '네이비', labelKey: 'viewer.background_color.navy', color: '#101927' },
  { id: 'green', label: '그린', labelKey: 'viewer.background_color.green', color: '#101d17' },
  { id: 'wine', label: '와인', labelKey: 'viewer.background_color.wine', color: '#241116' },
  { id: 'paper', label: '종이', labelKey: 'viewer.background_color.paper', color: '#d8c3a0' },
];
const IMMERSIVE_GRADIENTS = [
  ['rgba(52, 152, 219, 0.48)', 'rgba(18, 26, 38, 0.96)'],
  ['rgba(155, 89, 182, 0.44)', 'rgba(30, 18, 38, 0.96)'],
  ['rgba(46, 204, 113, 0.38)', 'rgba(14, 32, 22, 0.96)'],
  ['rgba(231, 76, 60, 0.34)', 'rgba(38, 16, 18, 0.96)'],
  ['rgba(241, 196, 15, 0.3)', 'rgba(40, 34, 16, 0.96)'],
];
const LINE_HEIGHT_MAX_STEP = 16;
const WRAP_OPTIONS = [
  { id: 'word', label: '단어단위', labelKey: 'viewer.option.wrap_word' },
  { id: 'char', label: '글자단위', labelKey: 'viewer.option.wrap_char' },
];
const PAGE_EFFECT_OPTIONS = [
  { id: 'none', label: '효과없음', labelKey: 'viewer.option.effect_none' },
  { id: 'slide', label: '슬라이드', labelKey: 'viewer.option.effect_slide' },
  { id: 'fade', label: '페이드', labelKey: 'viewer.option.effect_fade' },
  { id: 'page', label: '책 넘김', labelKey: 'viewer.option.effect_page' },
];
const TEXT_ALIGN_OPTIONS = [
  { id: 'left', label: '왼쪽 맞춤', labelKey: 'viewer.option.align_left' },
  { id: 'justify', label: '양쪽 맞춤', labelKey: 'viewer.option.align_justify' },
  { id: 'right', label: '오른쪽 맞춤', labelKey: 'viewer.option.align_right' },
];
const TEXT_DIRECTION_OPTIONS = [
  { id: 'horizontal', label: '수평', labelKey: 'viewer.option.direction_horizontal' },
  { id: 'vertical', label: '수직', labelKey: 'viewer.option.direction_vertical' },
];
const VISIBILITY_OPTIONS = [
  { id: 'show', label: '표시', labelKey: 'viewer.option.visibility_show' },
  { id: 'hide', label: '숨기기', labelKey: 'viewer.option.visibility_hide' },
];
const ZOOM_MIN = 10;
const ZOOM_MAX = 500;
const ZOOM_STEP = 10;
const WHEEL_ZOOM_BUTTON_MASK = 1 | 2;
const READER_ALLOWED_HTML_TAGS = new Set([
  'a', 'abbr', 'article', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'img', 'li', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'section', 'small',
  'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul',
]);
const READER_SINGLE_PAGE_MAX_WIDTH = 900;
const READER_SPREAD_PAGE_MAX_WIDTH = 680;
const READER_STAGE_PADDING = 14;
const READER_BASE_FONT_SIZE = 16;
const LEGACY_READER_BASE_FONT_SIZE = 14;
const READER_FONT_SCALE_MIN = 50;
const READER_FONT_SCALE_MAX = 200;
const READER_MIXED_IMAGE_HEIGHT_RATIO = 0.62;
const READER_MIXED_IMAGE_LINE_RATIO = 0.58;
const READER_INLINE_IMAGE_LINE_RATIO = 0.18;
const READER_FOOTER_SPACE = 56;
const READER_PAGE_BOTTOM_GUARD = 28;
const READER_PAGE_FIT_SCALE_MIN = 0.58;
const READER_PAGE_FIT_SCALE_DEFAULT = 1.16;
const READER_PAGE_FIT_SCALE_MAX = 1.42;
const READER_PAGE_FIT_SCALE_STEP = 0.88;
const READER_PAGE_FIT_SCALE_RECOVERY_STEP = 1.08;
const READER_RENDER_OVERFLOW_TOLERANCE = 3;
const READER_RENDER_UNDERFILL_THRESHOLD = 0.82;
const SWIPE_MIN_DISTANCE = 64;
const SWIPE_AXIS_LOCK_RATIO = 1.35;
const SWIPE_MAX_DURATION = 900;
const READER_TITLE_ONLY_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BOOK_PAGE_TURN_DURATION = 720;
const PAGE_EFFECT_DURATIONS = {
  slide: 180,
  fade: 180,
};
const EMPTY_PAGE_TURN = {
  format: '',
  effect: 'none',
  direction: 'next',
  sequence: 0,
  active: false,
  fromIndex: 0,
  toIndex: 0,
  progress: 0,
  duration: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback, min, max);
}

function fitScaleForViewMode(viewMode, widthScale, heightScale) {
  return viewMode === 'actual'
    ? 1
    : viewMode === 'height'
      ? heightScale
    : viewMode === 'fit'
      ? Math.min(widthScale, heightScale)
      : widthScale;
}

function getPageEffectDirection(targetIndex, currentIndex) {
  return targetIndex > currentIndex ? 'next' : 'previous';
}

function invertPageEffectDirection(direction) {
  return direction === 'next' ? 'previous' : 'next';
}

function getReadingAdjustedPageEffectDirection(direction, readingDirection) {
  return readingDirection === 'rtl' ? invertPageEffectDirection(direction) : direction;
}

function scaledPageSizeForViewMode({ viewMode, baseWidth, baseHeight, availableWidth, availableHeight, zoom }) {
  const widthScale = Math.max(0.02, Number(availableWidth) || 1) / Math.max(1, Number(baseWidth) || 1);
  const heightScale = Math.max(0.02, Number(availableHeight) || 1) / Math.max(1, Number(baseHeight) || 1);
  const fitScale = fitScaleForViewMode(viewMode, widthScale, heightScale);
  const scale = clamp(fitScale * ((Number(zoom) || 100) / 100), 0.02, 10);
  return {
    scale,
    width: Math.max(1, Math.floor((Number(baseWidth) || 1) * scale)),
    height: Math.max(1, Math.floor((Number(baseHeight) || 1) * scale)),
  };
}

function dragPanOverflowStateForTarget(node, panTarget) {
  if (!node || !panTarget) return { canPanX: false, canPanY: false };
  const targetRect = panTarget.getBoundingClientRect?.();
  const viewportRect = node.getBoundingClientRect?.();
  if (!targetRect || !viewportRect) return { canPanX: false, canPanY: false };
  return {
    canPanX: targetRect.width > viewportRect.width + 1 && node.scrollWidth > node.clientWidth + 1,
    canPanY: targetRect.height > viewportRect.height + 1 && node.scrollHeight > node.clientHeight + 1,
  };
}

function zoomAnchorSelectorForTarget(target) {
  const anchorNode = target?.closest?.('[data-page-index], [data-pdf-page-index], [data-reader-page-index], [data-reader-index]');
  if (!anchorNode) return null;
  const attributeName = ['data-page-index', 'data-pdf-page-index', 'data-reader-page-index', 'data-reader-index']
    .find(name => anchorNode.hasAttribute?.(name));
  const value = attributeName ? anchorNode.getAttribute?.(attributeName) : null;
  if (value == null) return null;
  const escapedValue = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[${attributeName}="${escapedValue}"]`;
}

function buildFlipBookGroups({ pageCount, spread, getStepSizeForIndex }) {
  if (!spread) {
    return Array.from({ length: Math.max(0, pageCount) }, (_, index) => ({
      startIndex: index,
      indexes: [index],
    }));
  }
  const groups = [];
  let index = 0;
  while (index < pageCount) {
    const rawStepSize = typeof getStepSizeForIndex === 'function'
      ? getStepSizeForIndex(index)
      : 2;
    const stepSize = clamp(Math.max(1, Number(rawStepSize) || 1), 1, Math.max(1, pageCount - index));
    const indexes = Array.from({ length: stepSize }, (_, offset) => index + offset)
      .filter(pageIndex => pageIndex >= 0 && pageIndex < pageCount);
    groups.push({ startIndex: index, indexes });
    index += stepSize;
  }
  return groups;
}

function flipBookLeafSourcesForGroup(group, { spread, readingDirection }) {
  const indexes = Array.isArray(group?.indexes) ? group.indexes.filter(Number.isInteger) : [];
  if (!spread) return [indexes[0] ?? null];
  if (indexes.length > 1) {
    const pair = indexes.slice(0, 2);
    return readingDirection === 'rtl' ? [pair[1], pair[0]] : pair;
  }
  const single = indexes[0] ?? null;
  if (group?.startIndex === 0) {
    return readingDirection === 'rtl' ? [single, null] : [null, single];
  }
  return readingDirection === 'rtl' ? [null, single] : [single, null];
}

function buildFlipBookPageModel({ pageCount, spread, readingDirection = 'ltr', getStepSizeForIndex }) {
  const groups = buildFlipBookGroups({ pageCount, spread, getStepSizeForIndex });
  const orderedGroups = spread && readingDirection === 'rtl'
    ? [...groups].reverse()
    : groups;
  const pageToBookIndex = new Map();
  const bookToPageIndex = new Map();
  const entries = [];
  orderedGroups.forEach(group => {
    const firstBookIndex = entries.length;
    const groupStartIndex = clamp(Number(group.startIndex) || 0, 0, Math.max(0, pageCount - 1));
    group.indexes.forEach(pageIndex => {
      pageToBookIndex.set(pageIndex, firstBookIndex);
    });
    const leafSources = flipBookLeafSourcesForGroup(group, { spread, readingDirection });
    leafSources.forEach((sourceIndex, leafOffset) => {
      const bookIndex = entries.length;
      bookToPageIndex.set(bookIndex, groupStartIndex);
      entries.push({
        bookIndex,
        groupStartIndex,
        sourceIndex,
        leafOffset,
        blank: sourceIndex == null,
        side: spread ? (leafOffset === 0 ? 'left' : 'right') : 'single',
      });
    });
  });
  return { entries, pageToBookIndex, bookToPageIndex };
}

function ViewerFlipBook({
  bookKey,
  className = '',
  pageClassName = '',
  pageCount,
  currentPageIndex,
  spread = false,
  readingDirection = 'ltr',
  pageSize,
  getStepSizeForIndex,
  navigationKey = 0,
  visualScale = 1,
  renderKey,
  renderPage,
  onPageIndexChange,
}) {
  const flipBookRef = useRef(null);
  const lastNavigationKeyRef = useRef(navigationKey);
  const renderPageRef = useRef(renderPage);
  renderPageRef.current = renderPage;
  const normalizedPageCount = Math.max(0, Number(pageCount) || 0);
  const normalizedPageSize = {
    width: Math.max(1, Math.round(Number(pageSize?.width) || 1)),
    height: Math.max(1, Math.round(Number(pageSize?.height) || 1)),
  };
  const normalizedVisualScale = Math.max(0.02, Number(visualScale) || 1);
  const model = useMemo(() => buildFlipBookPageModel({
    pageCount: normalizedPageCount,
    spread,
    readingDirection,
    getStepSizeForIndex,
  }), [getStepSizeForIndex, normalizedPageCount, readingDirection, spread]);
  const currentSourceIndex = clamp(Number(currentPageIndex) || 0, 0, Math.max(0, normalizedPageCount - 1));
  const currentBookIndex = model.pageToBookIndex.get(currentSourceIndex) ?? 0;
  const bookPixelWidth = normalizedPageSize.width * (spread ? 2 : 1);
  const bookPixelHeight = normalizedPageSize.height;
  const scaledBookPixelWidth = bookPixelWidth * normalizedVisualScale;
  const scaledBookPixelHeight = bookPixelHeight * normalizedVisualScale;
  const bookStyle = useMemo(() => ({
    width: `${bookPixelWidth}px`,
    height: `${bookPixelHeight}px`,
  }), [bookPixelHeight, bookPixelWidth]);
  const scaleStyle = useMemo(() => ({
    width: `${bookPixelWidth}px`,
    height: `${bookPixelHeight}px`,
    transform: normalizedVisualScale === 1 ? undefined : `scale(${normalizedVisualScale})`,
    transformOrigin: 'center center',
    willChange: normalizedVisualScale === 1 ? undefined : 'transform',
  }), [bookPixelHeight, bookPixelWidth, normalizedVisualScale]);
  const stageStyle = useMemo(() => ({
    minWidth: `${Math.ceil(scaledBookPixelWidth) + 24}px`,
    minHeight: `${Math.ceil(scaledBookPixelHeight) + 24}px`,
  }), [scaledBookPixelHeight, scaledBookPixelWidth]);
  const handlePageChange = useCallback(bookIndex => {
    if (typeof onPageIndexChange !== 'function') return;
    const normalizedBookIndex = Math.max(0, Number(bookIndex) || 0);
    const fallbackBookIndex = spread ? normalizedBookIndex - (normalizedBookIndex % 2) : normalizedBookIndex;
    const nextPageIndex = model.bookToPageIndex.get(normalizedBookIndex)
      ?? model.bookToPageIndex.get(fallbackBookIndex);
    if (Number.isInteger(nextPageIndex)) onPageIndexChange(nextPageIndex);
  }, [model, onPageIndexChange, spread]);
  useEffect(() => {
    if (lastNavigationKeyRef.current === navigationKey) return undefined;
    lastNavigationKeyRef.current = navigationKey;
    const frame = window.requestAnimationFrame(() => {
      flipBookRef.current?.flip?.(currentBookIndex);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentBookIndex, navigationKey]);
  const pageRenderDependency = renderKey ?? renderPage;
  const pageElements = useMemo(() => model.entries.map(entry => (
    <div
      key={`flipbook-page-${entry.bookIndex}-${entry.sourceIndex ?? 'blank'}`}
      className={viewerClassName(
        'viewer-flipbook-page',
        pageClassName,
        entry.blank && 'is-blank',
        `is-${entry.side}-page`,
      )}
      data-flipbook-index={entry.bookIndex}
      data-source-page-index={entry.sourceIndex ?? ''}
    >
      <div className={viewerClassName('viewer-flipbook-page-inner', `is-${entry.side}-page`)}>
        {entry.blank
          ? <div className="viewer-flipbook-blank-page" />
          : renderPageRef.current?.(entry.sourceIndex, entry)}
      </div>
    </div>
  )), [
    model.entries,
    normalizedPageSize.height,
    normalizedPageSize.width,
    pageClassName,
    pageRenderDependency,
  ]);
  if (normalizedPageCount <= 0 || pageElements.length < 1) return null;
  return (
    <div
      className={viewerClassName(className, 'viewer-flipbook-stage', spread ? 'is-spread' : 'is-single')}
      style={stageStyle}
    >
      <div className="viewer-flipbook-scale" style={scaleStyle}>
        <ReactFlipBook
          ref={flipBookRef}
          key={`${bookKey}-${spread ? 'spread' : 'single'}-${readingDirection}-${normalizedPageSize.width}x${normalizedPageSize.height}-${normalizedPageCount}`}
          className="viewer-flipbook"
          style={bookStyle}
          width={normalizedPageSize.width}
          height={normalizedPageSize.height}
          size="fixed"
          startPage={currentBookIndex}
          currentPage={currentBookIndex}
          flippingTime={BOOK_PAGE_TURN_DURATION}
          usePortrait={!spread}
          autoSize={false}
          showCover={false}
          drawShadow
          maxShadowOpacity={0.52}
          mobileScrollSupport={false}
          clickEventForward={false}
          useMouseEvents={false}
          showPageCorners={false}
          disableFlipByClick
          enableKeyboardNav={false}
          onPageChange={handlePageChange}
        >
          {pageElements}
        </ReactFlipBook>
      </div>
    </div>
  );
}

function storageKey(session, suffix) {
  return session?.filePath ? `bookmanager-viewer-${suffix}:${session.filePath}` : '';
}

function viewerPrefsKey(sessionOrType) {
  const type = typeof sessionOrType === 'string' ? sessionOrType : sessionOrType?.type;
  return type ? `bookmanager-viewer-prefs:${type}` : '';
}

function readJson(key, fallback) {
  if (!key) return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function isWebViewerMode() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('webViewer') === '1' || params.get('viewerApi') === 'web';
}

function fetchWebViewerJson(url, options = {}) {
  return fetch(url, { cache: 'no-store', ...options }).then(async response => {
    if (response.ok) return response.json();
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      try {
        const text = await response.text();
        if (text) message = text;
      } catch {
        message = `Request failed: ${response.status}`;
      }
    }
    throw new Error(message);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Blob conversion failed.'));
    reader.readAsDataURL(blob);
  });
}

function createWebViewerAPI() {
  const params = new URLSearchParams(window.location.search);
  let currentFilePath = params.get('file') || params.get('path') || '';
  let currentSession = null;
  let currentSessionPromise = null;

  const sessionQuery = () => {
    if (!currentFilePath) throw new Error('Viewer file path is required.');
    return `/api/viewer/session?file=${encodeURIComponent(currentFilePath)}`;
  };

  const ensureCurrentSession = async () => {
    if (currentSession) return currentSession;
    if (!currentSessionPromise) {
      currentSessionPromise = fetchWebViewerJson(sessionQuery()).then(session => {
        currentSession = session;
        return session;
      });
    }
    return currentSessionPromise;
  };

  const fullscreenState = () => ({ fullscreen: Boolean(document.fullscreenElement) });

  return {
    getConfig: async () => {
      const browserLanguage = (navigator.language || 'ko').split('-')[0];
      return { language: ['ko', 'en', 'ja'].includes(browserLanguage) ? browserLanguage : 'ko' };
    },
    onConfigChange: () => () => {},
    getFullscreenState: async () => fullscreenState(),
    onFullscreenChange: callback => {
      const handler = () => callback?.(fullscreenState());
      document.addEventListener('fullscreenchange', handler);
      return () => document.removeEventListener('fullscreenchange', handler);
    },
    toggleFullscreen: async () => {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else {
        await document.documentElement.requestFullscreen?.();
      }
      return fullscreenState();
    },
    closeWindow: () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.close();
      }
    },
    getCurrentSession: ensureCurrentSession,
    onLoadSession: () => () => {},
    listBundledFonts: async () => [],
    listSystemFonts: async () => [],
    openAdjacent: async (sessionId, direction) => {
      const result = await fetchWebViewerJson(`/api/viewer/adjacent/${encodeURIComponent(sessionId)}?direction=${encodeURIComponent(direction)}`);
      currentSession = result.session || result;
      currentSessionPromise = Promise.resolve(currentSession);
      if (currentSession?.filePath) {
        currentFilePath = currentSession.filePath;
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('file', currentFilePath);
        window.history.replaceState(null, '', nextUrl);
      }
      return { session: currentSession };
    },
    listComicPages: sessionId => fetchWebViewerJson(`/api/viewer/comic-pages/${encodeURIComponent(sessionId)}`),
    getComicPage: async (sessionId, entryName) => {
      const response = await fetch(`/api/viewer/comic-page/${encodeURIComponent(sessionId)}?entry=${encodeURIComponent(entryName)}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Comic page failed: ${response.status}`);
      return {
        name: entryName,
        dataUrl: await blobToDataUrl(await response.blob()),
      };
    },
    getDocumentData: sessionId => fetchWebViewerJson(`/api/viewer/document-data/${encodeURIComponent(sessionId)}`),
    getEpubText: sessionId => fetchWebViewerJson(`/api/viewer/epub/${encodeURIComponent(sessionId)}`),
    getText: (sessionId, options = {}) => fetchWebViewerJson(`/api/viewer/text/${encodeURIComponent(sessionId)}?encoding=${encodeURIComponent(options.encoding || 'auto')}`),
    openExternal: async url => {
      const safeUrl = String(url || '').trim();
      if (!/^https?:\/\//i.test(safeUrl)) throw new Error('External URL was blocked.');
      if (!window.confirm(viewerText('viewer.link.open_external_confirm', '브라우저에서 외부 링크를 열까요?', { url: safeUrl }))) {
        return { success: false, canceled: true };
      }
      window.open(safeUrl, '_blank', 'noopener,noreferrer');
      return { success: true };
    },
  };
}

if (typeof window !== 'undefined' && !window.viewerAPI && isWebViewerMode()) {
  window.viewerAPI = createWebViewerAPI();
}

function normalizeViewerBackgroundSettings(settings = {}) {
  const color = VIEWER_BACKGROUND_COLORS.some(item => item.color === settings.color)
    ? settings.color
    : DEFAULT_VIEWER_BACKGROUND.color;
  return {
    mode: settings.mode === 'immersive' ? 'immersive' : 'solid',
    color,
  };
}

function paintAmbientCanvasFromSource(targetCanvas, source) {
  if (!targetCanvas || !source) return false;
  const sourceWidth = source.naturalWidth || source.videoWidth || source.width || source.clientWidth || 1;
  const sourceHeight = source.naturalHeight || source.videoHeight || source.height || source.clientHeight || 1;
  const maxEdge = 360;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  const context = targetCanvas.getContext('2d');
  if (!context) return false;
  if (targetCanvas.width !== width) targetCanvas.width = width;
  if (targetCanvas.height !== height) targetCanvas.height = height;
  context.clearRect(0, 0, width, height);
  try {
    const edgeX = clamp(Math.round(sourceWidth * 0.04), 1, Math.max(1, Math.floor(sourceWidth / 4)));
    const edgeY = clamp(Math.round(sourceHeight * 0.04), 1, Math.max(1, Math.floor(sourceHeight / 4)));
    const horizontalGlowHeight = Math.max(1, Math.ceil(height * 0.55));
    const verticalGlowWidth = Math.max(1, Math.ceil(width * 0.55));
    context.fillStyle = '#050505';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, sourceWidth, edgeY, 0, 0, width, horizontalGlowHeight);
    context.drawImage(source, 0, sourceHeight - edgeY, sourceWidth, edgeY, 0, height - horizontalGlowHeight, width, horizontalGlowHeight);
    context.globalAlpha = 0.9;
    context.drawImage(source, 0, 0, edgeX, sourceHeight, 0, 0, verticalGlowWidth, height);
    context.drawImage(source, sourceWidth - edgeX, 0, edgeX, sourceHeight, width - verticalGlowWidth, 0, verticalGlowWidth, height);
    context.globalAlpha = 1;
    return true;
  } catch {
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    return false;
  }
}

function lineHeightPercentFromStep(step) {
  return Math.round(((clamp(Number(step) || 1, 1, LINE_HEIGHT_MAX_STEP) - 1) / (LINE_HEIGHT_MAX_STEP - 1)) * 200);
}

function normalizeReaderSettings(settings = {}) {
  const merged = { ...DEFAULT_READER_SETTINGS, ...settings };
  const hasLineHeightPercent = Object.prototype.hasOwnProperty.call(settings, 'lineHeightPercent');
  const hasFontScale = Object.prototype.hasOwnProperty.call(settings, 'fontScale');
  const legacyFontSize = Number(settings.fontSize);
  const migratedFontScale = Number.isFinite(legacyFontSize)
    ? Math.round((legacyFontSize / LEGACY_READER_BASE_FONT_SIZE) * 100)
    : DEFAULT_READER_SETTINGS.fontScale;
  const lineHeightPercent = hasLineHeightPercent
    ? settings.lineHeightPercent
    : lineHeightPercentFromStep(merged.lineHeightStep);
  const { fontSize: _legacyFontSize, ...readerSettings } = merged;
  return {
    ...readerSettings,
    fontScale: clampNumber(
      hasFontScale ? settings.fontScale : migratedFontScale,
      READER_FONT_SCALE_MIN,
      READER_FONT_SCALE_MAX,
      DEFAULT_READER_SETTINGS.fontScale,
    ),
    lineHeightPercent: clampNumber(lineHeightPercent, 0, 200, DEFAULT_READER_SETTINGS.lineHeightPercent),
    lineHeightStep: clampNumber(merged.lineHeightStep, 1, LINE_HEIGHT_MAX_STEP, DEFAULT_READER_SETTINGS.lineHeightStep),
    letterSpacing: clampNumber(merged.letterSpacing, 0, 20, DEFAULT_READER_SETTINGS.letterSpacing),
    verticalPadding: clampNumber(merged.verticalPadding, 0, 80, DEFAULT_READER_SETTINGS.verticalPadding),
    horizontalPadding: clampNumber(merged.horizontalPadding, 0, 80, DEFAULT_READER_SETTINGS.horizontalPadding),
    paragraphSpacing: clampNumber(merged.paragraphSpacing, 0, 120, DEFAULT_READER_SETTINGS.paragraphSpacing),
    textAlign: TEXT_ALIGN_OPTIONS.some(item => item.id === merged.textAlign) ? merged.textAlign : DEFAULT_READER_SETTINGS.textAlign,
    textDirection: TEXT_DIRECTION_OPTIONS.some(item => item.id === merged.textDirection) ? merged.textDirection : DEFAULT_READER_SETTINGS.textDirection,
    showHeader: merged.showHeader !== false,
    showFooter: merged.showFooter !== false,
    wrapMode: WRAP_OPTIONS.some(item => item.id === merged.wrapMode) ? merged.wrapMode : DEFAULT_READER_SETTINGS.wrapMode,
    pageEffect: PAGE_EFFECT_OPTIONS.some(item => item.id === merged.pageEffect) ? merged.pageEffect : DEFAULT_READER_SETTINGS.pageEffect,
  };
}

function uniqueFontNames(values = []) {
  return Array.from(new Set(
    values
      .map(value => String(value?.family || value?.name || value || '').trim())
      .filter(Boolean),
  ));
}

function normalizeFontGroups(groups = {}) {
  return {
    epub: uniqueFontNames(groups.epub || []),
    bundled: uniqueFontNames([...(groups.bundled || []), ...DEFAULT_FONT_GROUPS.bundled]),
    system: uniqueFontNames([...(groups.system || []), ...DEFAULT_FONT_GROUPS.system]),
  };
}

function fontOptionsFromGroups(fontGroups = {}, sessionType = '') {
  const normalizedGroups = normalizeFontGroups(fontGroups);
  const groups = [
    sessionType === 'epub'
      ? { id: 'epub', label: 'EPUB 폰트', labelKey: 'viewer.settings.font_group_epub', fonts: normalizedGroups.epub }
      : null,
    { id: 'bundled', label: '프로그램 제공 폰트', labelKey: 'viewer.settings.font_group_bundled', fonts: normalizedGroups.bundled },
    { id: 'system', label: '시스템 폰트', labelKey: 'viewer.settings.font_group_system', fonts: normalizedGroups.system },
  ].filter(Boolean);
  const options = [];
  const seenFonts = new Set();
  groups.forEach(group => {
    const fonts = group.fonts.filter(font => !seenFonts.has(font));
    if (fonts.length < 1) return;
    options.push({ id: `group:${group.id}`, kind: 'group', label: group.label, labelKey: group.labelKey });
    fonts.forEach(font => {
      seenFonts.add(font);
      options.push({ id: font, label: font });
    });
  });
  return options;
}

function normalizeEpubEntryPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC').toLowerCase();
}

function epubTargetKey(entryName = '', anchor = '') {
  const normalizedEntryName = normalizeEpubEntryPath(entryName);
  const normalizedAnchor = String(anchor || '').trim();
  return normalizedEntryName ? `${normalizedEntryName}#${normalizedAnchor}` : '';
}

function immersiveGradientForPage(pageIndex = 0) {
  const pair = IMMERSIVE_GRADIENTS[Math.abs(Number(pageIndex) || 0) % IMMERSIVE_GRADIENTS.length];
  return `radial-gradient(circle at 28% 24%, ${pair[0]}, transparent 42%), radial-gradient(circle at 78% 72%, ${pair[1]}, transparent 48%), linear-gradient(135deg, #101010, #191919)`;
}

function splitSentences(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？]|다\.|요\.)\s+/u)
    .map(value => value.trim())
    .filter(Boolean);
}

function readerTextLength(value = '') {
  return Array.from(String(value || '')).length;
}

function estimateReaderLineCount(line = '', charsPerLine = 60) {
  return Math.max(1, Math.ceil(readerTextLength(line) / Math.max(1, charsPerLine)));
}

function splitReaderLine(line = '', charsPerLine = 60, lines = 1, wrapMode = 'word') {
  const characters = Array.from(String(line || ''));
  const maxChars = Math.max(1, Math.floor(charsPerLine * Math.max(1, lines)));
  if (characters.length <= maxChars) return [line, ''];
  let splitAt = Math.min(characters.length, maxChars);
  if (wrapMode !== 'char') {
    const lowerBound = Math.max(1, splitAt - charsPerLine);
    for (let index = splitAt; index > lowerBound; index -= 1) {
      if (/\s/.test(characters[index - 1])) {
        splitAt = index;
        break;
      }
    }
  }
  return [
    characters.slice(0, splitAt).join('').trimEnd(),
    characters.slice(splitAt).join('').trimStart(),
  ];
}

function splitReaderLineForPage(line = '', charsPerLine = 60, lines = 1, metrics = {}) {
  const wrapMode = metrics.wrapMode || 'word';
  const [head, tail] = splitReaderLine(line, charsPerLine, lines, wrapMode);
  const widowLineTolerance = Math.max(0, Math.floor(Number(metrics.widowLineTolerance) || 0));
  if (!tail || widowLineTolerance < 1) return [head, tail];

  const tailLines = estimateReaderBlockLineCost(tail, {
    ...metrics,
    charsPerLine,
    paragraphLineCost: 0,
  });
  if (tailLines > widowLineTolerance) return [head, tail];

  const [expandedHead, expandedTail] = splitReaderLine(
    line,
    charsPerLine,
    Math.max(1, Number(lines) || 1) + widowLineTolerance,
    wrapMode,
  );
  if (!expandedTail) return [expandedHead, ''];

  const expandedTailLines = estimateReaderBlockLineCost(expandedTail, {
    ...metrics,
    charsPerLine,
    paragraphLineCost: 0,
  });
  return expandedTailLines < tailLines ? [expandedHead, expandedTail] : [head, tail];
}

function paginateText(text = '', options = 1800) {
  const settings = typeof options === 'number' ? { maxChars: options } : (options || {});
  const maxChars = Math.max(320, Math.floor(Number(settings.maxChars) || 1800));
  const charsPerLine = Math.max(12, Math.floor(Number(settings.charsPerLine) || 60));
  const titleLines = Math.max(0, Math.floor(Number(settings.titleLines) || 0));
  const paragraphLineCost = Math.max(0, Number(settings.paragraphLineCost) || 0);
  const linesPerPage = Math.max(
    8,
    Math.floor(Number(settings.linesPerPage) || Math.ceil(maxChars / charsPerLine)),
  );
  const lineBudget = Math.max(6, linesPerPage - titleLines);
  const wrapMode = settings.wrapMode || 'word';
  const widowLineTolerance = Math.max(0, Math.floor(Number(settings.widowLineTolerance) || 0));
  const metrics = {
    charsPerLine,
    lineBudget,
    paragraphLineCost,
    widowLineTolerance,
    wrapMode,
  };
  const sourceLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const pages = [];
  let currentLines = [];
  let usedLines = 0;

  const flushPage = () => {
    while (currentLines.length > 0 && currentLines[0] === '') currentLines.shift();
    while (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') currentLines.pop();
    const pageText = currentLines.join('\n').trim();
    if (pageText) pages.push(pageText);
    currentLines = [];
    usedLines = 0;
  };

  const addBlankLine = () => {
    if (currentLines.length === 0 || currentLines[currentLines.length - 1] === '') return;
    if (usedLines + paragraphLineCost > lineBudget) {
      flushPage();
      return;
    }
    currentLines.push('');
    usedLines += paragraphLineCost;
  };

  for (const sourceLine of sourceLines.length > 0 ? sourceLines : [String(text || '')]) {
    let line = String(sourceLine || '').trim();
    if (!line) {
      addBlankLine();
      continue;
    }

    while (line) {
      const estimatedLines = estimateReaderLineCount(line, charsPerLine);
      const remainingLines = lineBudget - usedLines;
      if (usedLines > 0 && estimatedLines > remainingLines) {
        if (
          remainingLines > 0
          && widowLineTolerance > 0
          && estimatedLines - remainingLines <= widowLineTolerance
        ) {
          currentLines.push(line);
          usedLines += estimatedLines;
          line = '';
          continue;
        }
        if (remainingLines <= 0) {
          flushPage();
          continue;
        }
        if (estimatedLines <= lineBudget) {
          flushPage();
          continue;
        }
        const [head, tail] = splitReaderLineForPage(line, charsPerLine, Math.max(1, remainingLines), metrics);
        if (head) currentLines.push(head);
        flushPage();
        line = tail;
        continue;
      }
      if (usedLines === 0 && estimatedLines > lineBudget) {
        const [head, tail] = splitReaderLineForPage(line, charsPerLine, lineBudget, metrics);
        if (head) currentLines.push(head);
        flushPage();
        line = tail;
        continue;
      }
      currentLines.push(line);
      usedLines += estimatedLines;
      line = '';
    }
  }
  flushPage();
  return pages.length > 0 ? pages : [''];
}

function normalizeReaderBlocks(item = {}) {
  if (Array.isArray(item.blocks) && item.blocks.length > 0) return item.blocks;
  const text = typeof item === 'string' ? item : item.text;
  return [{ type: 'text', text: normalizeReaderDisplayText(text) }];
}

function normalizeReaderDisplayText(value = '') {
  return String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/\bbr\s*\/>/gi, '\n');
}

function readerPaginationMetrics(options = {}) {
  const settings = typeof options === 'number' ? { maxChars: options } : (options || {});
  const maxChars = Math.max(320, Math.floor(Number(settings.maxChars) || 1800));
  const charsPerLine = Math.max(12, Math.floor(Number(settings.charsPerLine) || 60));
  const titleLines = Math.max(0, Math.floor(Number(settings.titleLines) || 0));
  const paragraphLineCost = Math.max(0, Number(settings.paragraphLineCost) || 0);
  const hasWidowLineTolerance = Object.prototype.hasOwnProperty.call(settings, 'widowLineTolerance');
  const linesPerPage = Math.max(
    8,
    Math.floor(Number(settings.linesPerPage) || Math.ceil(maxChars / charsPerLine)),
  );
  return {
    charsPerLine,
    lineBudget: Math.max(6, linesPerPage - titleLines),
    paragraphLineCost,
    mediaLineCost: Math.max(4, Math.ceil(Math.max(6, linesPerPage - titleLines) * READER_MIXED_IMAGE_LINE_RATIO)),
    lineAdvance: Math.max(10, Number(settings.lineAdvance) || 18),
    pageWidth: Math.max(160, Number(settings.pageWidth) || 560),
    fontSize: Math.max(10, Number(settings.fontSize) || 16),
    mixedImageMaxHeight: Math.max(0, Number(settings.mixedImageMaxHeight) || 0),
    widowLineTolerance: hasWidowLineTolerance
      ? Math.max(0, Math.floor(Number(settings.widowLineTolerance) || 0))
      : Math.max(2, Math.min(3, Math.floor(linesPerPage * 0.1))),
    wrapMode: settings.wrapMode || 'word',
  };
}

function estimateReaderBlockLineCost(text = '', metrics = {}) {
  const charsPerLine = Math.max(12, Math.floor(Number(metrics.charsPerLine) || 60));
  const paragraphLineCost = Math.max(0, Number(metrics.paragraphLineCost) || 0);
  const lines = normalizeReaderDisplayText(text).replace(/\r\n?/g, '\n').split('\n');
  let usedLines = 0;
  let hasContent = false;
  for (const sourceLine of lines) {
    const line = String(sourceLine || '').trim();
    if (!line) {
      if (hasContent) usedLines += paragraphLineCost;
      continue;
    }
    usedLines += estimateReaderLineCount(line, charsPerLine);
    hasContent = true;
  }
  return Math.max(1, usedLines);
}

function readerCssLengthToPixels(value = '', basePx = 0, fontPx = 16) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || /^(?:auto|none|inherit|initial|unset)$/.test(normalized)) return 0;
  const match = normalized.match(/^(\d+(?:\.\d+)?)(%|px|em|rem|pt|pc|cm|mm|in|vh|vw|vmin|vmax)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2] || 'px';
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (unit === '%') return basePx > 0 ? (basePx * amount) / 100 : 0;
  if (unit === 'em' || unit === 'rem') return amount * fontPx;
  if (unit === 'pt') return amount * (4 / 3);
  if (unit === 'pc') return amount * 16;
  if (unit === 'cm') return amount * 37.795;
  if (unit === 'mm') return amount * 3.7795;
  if (unit === 'in') return amount * 96;
  if (['vh', 'vw', 'vmin', 'vmax'].includes(unit)) return 0;
  return amount;
}

function readerImageNodesFromBlock(block = {}) {
  const imageNodes = [];
  const visit = node => {
    if (!node) return;
    if (node.tagName === 'img' || node.src) imageNodes.push(node);
    (node.children || []).forEach(visit);
  };
  if (block.type === 'image' || block.src) imageNodes.push(block);
  (block.nodes || []).forEach(visit);
  return imageNodes;
}

function cloneReaderNodeWithImagesOnly(node) {
  if (!node) return null;
  if (node.tagName === 'img' || node.src) {
    return {
      ...node,
      children: [],
    };
  }
  const children = (node.children || [])
    .map(cloneReaderNodeWithImagesOnly)
    .filter(Boolean);
  if (children.length < 1) return null;
  return {
    ...node,
    children,
  };
}

function readerImageOnlyNodesFromBlock(block = {}) {
  if (!Array.isArray(block.nodes)) return [];
  return block.nodes
    .map(cloneReaderNodeWithImagesOnly)
    .filter(Boolean);
}

function estimateReaderImageNodeLineCost(node = {}, metrics = {}, defaultLineCost = 0) {
  const lineAdvance = Math.max(10, Number(metrics.lineAdvance) || 18);
  const pageWidth = Math.max(160, Number(metrics.pageWidth) || 560);
  const maxHeightPx = Math.max(lineAdvance * 3, Number(metrics.mixedImageMaxHeight) || (lineAdvance * 12));
  const style = node.style || {};
  const fontPx = Math.max(10, Number(metrics.fontSize) || 16);
  const explicitHeight = readerCssLengthToPixels(style.height || style.maxHeight || '', maxHeightPx, fontPx);
  const explicitWidth = readerCssLengthToPixels(style.width || style.maxWidth || '', pageWidth, fontPx);
  const naturalWidth = Math.max(0, Number(node.naturalWidth) || Number(node.attributes?.['data-epub-image-width']) || 0);
  const naturalHeight = Math.max(0, Number(node.naturalHeight) || Number(node.attributes?.['data-epub-image-height']) || 0);
  const widthConstrainedHeight = naturalWidth > 0 && naturalHeight > 0
    ? (naturalHeight * Math.min(pageWidth, explicitWidth || naturalWidth)) / naturalWidth
    : 0;
  const estimatedHeight = explicitHeight || widthConstrainedHeight || explicitWidth;
  if (!estimatedHeight) return defaultLineCost;
  return Math.max(2, Math.ceil(Math.min(estimatedHeight, maxHeightPx) / lineAdvance) + 1);
}

function estimateReaderInlineImageLineCost(block = {}, metrics = {}) {
  const lineBudget = Math.max(6, Number(metrics.lineBudget) || 12);
  const defaultCost = Math.max(3, Math.ceil(lineBudget * READER_INLINE_IMAGE_LINE_RATIO));
  const maxInlineCost = Math.max(defaultCost, Math.ceil(lineBudget * 0.3));
  const imageCosts = readerImageNodesFromBlock(block)
    .map(node => estimateReaderImageNodeLineCost(node, metrics, 0))
    .filter(cost => cost > 0);
  const imageCost = imageCosts.length > 0 ? Math.max(...imageCosts) : defaultCost;
  return clamp(imageCost, 3, maxInlineCost);
}

function estimateReaderMediaLineCost(metrics = {}, block = {}) {
  const lineBudget = Math.max(6, Number(metrics.lineBudget) || 12);
  const mediaLineCost = Math.ceil(Number(metrics.mediaLineCost) || (lineBudget * READER_MIXED_IMAGE_LINE_RATIO));
  const explicitImageCosts = readerImageNodesFromBlock(block)
    .map(node => estimateReaderImageNodeLineCost(node, metrics, 0))
    .filter(cost => cost > 0);
  if (explicitImageCosts.length > 0) {
    return clamp(Math.max(...explicitImageCosts), 3, Math.max(4, lineBudget - 3));
  }
  return Math.max(4, Math.min(Math.max(4, lineBudget - 3), mediaLineCost));
}

function splitReaderTextForRemainingPage(text = '', metrics = {}, remainingLines = 0) {
  const lineBudget = Math.max(1, Math.floor(Number(remainingLines) || 0));
  if (lineBudget < 1) return ['', normalizeReaderDisplayText(text).trim()];
  const normalized = normalizeReaderDisplayText(text).replace(/[ \t\r\f\v]+/g, ' ').trim();
  const estimatedLines = estimateReaderBlockLineCost(normalized, metrics);
  if (!normalized || estimatedLines <= lineBudget) return [normalized, ''];
  return splitReaderLineForPage(
    normalized,
    Math.max(12, Number(metrics.charsPerLine) || 60),
    lineBudget,
    metrics,
  );
}

function cloneReaderBlockForPage(block = {}, text = '', preserveNodes = true, patch = {}) {
  return {
    type: block.type || 'text',
    text,
    src: block.src,
    alt: block.alt,
    name: block.name,
    tagName: block.tagName,
    style: block.style,
    className: block.className,
    nodes: preserveNodes ? block.nodes : undefined,
    attributes: block.attributes,
    anchors: block.anchors,
    hasImage: block.hasImage || block.type === 'image',
    mediaOnly: block.mediaOnly || false,
    ...patch,
  };
}

function plainTextFromReaderNode(node) {
  if (!node) return '';
  if (node.type === 'text') return normalizeReaderDisplayText(node.text || '');
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'img') return '';
  return (node.children || []).map(plainTextFromReaderNode).join('');
}

function plainTextFromReaderBlock(block = {}) {
  if (block?.type === 'image') return block.alt || '';
  if (Array.isArray(block?.nodes) && block.nodes.length > 0) {
    return block.nodes.map(plainTextFromReaderNode).join('').replace(/\s+/g, ' ').trim();
  }
  return String(block?.text || '').trim();
}

function plainTextFromReaderItem(item = {}) {
  return normalizeReaderBlocks(item)
    .map(plainTextFromReaderBlock)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function snippetForMatch(text = '', index = 0, length = 0, radius = 30) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const start = clamp(index - radius, 0, source.length);
  const end = clamp(index + length + radius, 0, source.length);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < source.length ? '...' : '';
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function collectExactMatches(text = '', query = '') {
  const source = String(text || '');
  const needle = String(query || '');
  if (!source || !needle) return [];
  const matches = [];
  let index = source.indexOf(needle);
  while (index >= 0) {
    matches.push(index);
    index = source.indexOf(needle, index + Math.max(1, needle.length));
  }
  return matches;
}

function renderMarkedText(text = '', pageIndex = 0, highlights = [], activeSearch = null) {
  const source = normalizeReaderDisplayText(text);
  const ranges = [];
  highlights
    .filter(item => Number(item.pageIndex) === pageIndex && item.text)
    .forEach(item => {
      collectExactMatches(source, item.text).forEach(index => {
        ranges.push({
          start: index,
          end: index + item.text.length,
          className: 'viewer-text-highlight',
          title: item.text,
        });
      });
    });
  if (activeSearch?.text && Number(activeSearch.pageIndex) === pageIndex) {
    collectExactMatches(source, activeSearch.text).forEach(index => {
      ranges.push({
        start: index,
        end: index + activeSearch.text.length,
        className: 'viewer-text-search-hit',
        title: activeSearch.text,
      });
    });
  }
  if (ranges.length < 1) return source;
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const parts = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor || range.start >= range.end) return;
    if (range.start > cursor) parts.push(source.slice(cursor, range.start));
    parts.push(
      <mark key={`mark-${pageIndex}-${range.start}-${range.end}-${index}`} className={range.className} title={range.title}>
        {source.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}

function firstImageSrcFromReaderBlocks(blocks = []) {
  const stack = [...blocks];
  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) continue;
    if (item.src) return item.src;
    if (Array.isArray(item.nodes)) stack.push(...item.nodes);
    if (Array.isArray(item.children)) stack.push(...item.children);
  }
  return '';
}

function readerPageNodeHasRenderedOverflow(pageNode, textDirection = 'horizontal') {
  return readerPageNodeRenderUsage(pageNode, textDirection).overflow;
}

function readerPageNodeRenderUsage(pageNode, textDirection = 'horizontal') {
  const body = pageNode?.querySelector?.('.viewer-reader-page-body');
  if (!body) return { fillRatio: 1, overflow: false };
  const tolerance = READER_RENDER_OVERFLOW_TOLERANCE;
  const bodyRect = body.getBoundingClientRect?.();
  if (!bodyRect || bodyRect.width <= 0 || bodyRect.height <= 0) {
    return { fillRatio: 1, overflow: false };
  }
  const contentRects = [...body.querySelectorAll('*')]
    .filter(node => !(node.matches?.('[data-epub-anchor]:empty')))
    .map(node => node.getBoundingClientRect?.())
    .filter(rect => rect && rect.width > 1 && rect.height > 1);
  const scrollOverflow = textDirection === 'vertical'
    ? body.scrollWidth > body.clientWidth + tolerance
    : body.scrollHeight > body.clientHeight + tolerance;
  if (contentRects.length < 1) return { fillRatio: 0, overflow: scrollOverflow };
  if (textDirection === 'vertical') {
    const minLeft = Math.min(...contentRects.map(rect => rect.left));
    const maxRight = Math.max(...contentRects.map(rect => rect.right));
    const contentWidth = Math.max(0, bodyRect.right - minLeft);
    return {
      fillRatio: clamp(contentWidth / Math.max(1, bodyRect.width), 0, 2),
      overflow: scrollOverflow || minLeft < bodyRect.left - tolerance || maxRight > bodyRect.right + tolerance,
    };
  }
  const maxBottom = Math.max(...contentRects.map(rect => rect.bottom));
  const minTop = Math.min(...contentRects.map(rect => rect.top));
  const contentHeight = Math.max(0, maxBottom - bodyRect.top);
  return {
    fillRatio: clamp(contentHeight / Math.max(1, bodyRect.height), 0, 2),
    overflow: scrollOverflow || minTop < bodyRect.top - tolerance || maxBottom > bodyRect.bottom + tolerance,
  };
}

function visibleRenderedEpubPages(rootNode) {
  return [...(rootNode?.querySelectorAll?.('.viewer-text-page.is-epub-reader:not(.is-scroll)') || [])]
    .filter(pageNode => !pageNode.closest?.('.viewer-flipbook-stage'));
}

function viewerClassName(...values) {
  return values
    .flatMap(value => String(value || '').split(/\s+/))
    .filter(Boolean)
    .join(' ');
}

function openReaderImagePreview(event, image) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!image?.src || typeof image.onOpen !== 'function') return;
  image.onOpen({
    src: image.src,
    alt: image.alt || '',
  });
}

function handleReaderImagePreviewKeyDown(event, image) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  openReaderImagePreview(event, image);
}

function renderEpubHtmlNode(node, key, markContext = {}, extraClassName = '', extraProps = {}) {
  if (!node) return null;
  if (node.type === 'text') {
    return renderMarkedText(node.text || '', markContext.pageIndex, markContext.highlights || [], markContext.activeSearch);
  }
  const tagName = String(node.tagName || '').toLowerCase();
  if (!READER_ALLOWED_HTML_TAGS.has(tagName)) {
    return (node.children || []).map((child, index) => renderEpubHtmlNode(child, `${key}-${index}`, markContext));
  }
  const anchorProps = node.id ? { 'data-epub-anchor': node.id } : {};
  if (tagName === 'br') return <br key={key} />;
  if (tagName === 'hr') {
    return <hr key={key} className={viewerClassName(extraClassName, 'viewer-reader-html-rule', node.className)} {...anchorProps} {...extraProps} />;
  }
  if (tagName === 'img') {
    const src = String(node.src || '');
    if (!src.startsWith('bookmanager-document://') && !src.startsWith('/api/viewer/epub-asset/')) return null;
    const previewable = Boolean(markContext.imagePreviewAllowed && !readerStylePreventsImageExpansion(node.style));
    const previewLabel = viewerText('viewer.common.image_preview', '이미지 크게 보기');
    const previewImage = {
      src,
      alt: node.alt || '',
      onOpen: markContext.onImagePreview,
    };
    return (
      <img
        key={key}
        {...(node.attributes || {})}
        {...anchorProps}
        {...extraProps}
        className={viewerClassName(extraClassName, 'viewer-reader-html-image', previewable && 'is-previewable', node.className)}
        src={src}
        alt={node.alt || ''}
        style={node.style || undefined}
        title={previewable ? previewLabel : undefined}
        role={previewable ? 'button' : undefined}
        tabIndex={previewable ? 0 : undefined}
        aria-label={previewable ? previewLabel : undefined}
        onClick={previewable ? event => openReaderImagePreview(event, previewImage) : undefined}
        onKeyDown={previewable ? event => handleReaderImagePreviewKeyDown(event, previewImage) : undefined}
      />
    );
  }
  const childMarkContext = {
    ...markContext,
    imagePreviewAllowed: Boolean(markContext.imagePreviewAllowed && !readerStylePreventsImageExpansion(node.style)),
  };
  const isInternalLink = tagName === 'a' && node.targetEntryName;
  const isExternalLink = tagName === 'a' && node.externalHref;
  const props = {
    key,
    className: viewerClassName(
      extraClassName,
      `viewer-reader-html-node viewer-reader-html-${tagName}`,
      (isInternalLink || isExternalLink) && 'viewer-reader-html-link',
      node.className,
    ),
    style: node.style || undefined,
    ...(node.attributes || {}),
    ...anchorProps,
    ...extraProps,
  };
  if (isInternalLink) {
    props.href = node.targetAnchor ? `#${node.targetAnchor}` : '#';
    props.onClick = event => {
      event.preventDefault();
      markContext.onInternalLink?.({
        entryName: node.targetEntryName,
        anchor: node.targetAnchor || '',
      });
    };
  } else if (isExternalLink) {
    props.href = node.externalHref;
    props.rel = 'noreferrer';
    props.onClick = event => {
      event.preventDefault();
      markContext.onExternalLink?.(node.externalHref);
    };
  }
  return React.createElement(
    tagName,
    props,
    (node.children || []).map((child, index) => renderEpubHtmlNode(child, `${key}-${index}`, childMarkContext)),
  );
}

function isReaderTitleOnlyBlock(block = {}) {
  const text = String(block.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  const tagName = String(block.tagName || '').toLowerCase();
  return READER_TITLE_ONLY_TAGS.has(tagName) && text.length <= 80;
}

function readerSizeValuePreventsImageExpansion(value, propertyName = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || /^(?:auto|none|inherit|initial|unset)$/.test(normalized)) return false;
  if (/^calc\(/.test(normalized)) return false;
  const match = normalized.match(/^(\d+(?:\.\d+)?)(%|px|em|rem|pt|pc|cm|mm|in|vh|vw|vmin|vmax)?$/);
  if (!match) return true;
  const amount = Number(match[1]);
  const unit = match[2] || 'px';
  if (!Number.isFinite(amount)) return false;
  if (unit === '%') {
    if ((propertyName === 'width' || propertyName === 'height') && amount >= 95) return false;
    if (propertyName === 'maxWidth' || propertyName === 'maxHeight') return amount < 95;
    return amount < 95;
  }
  if (['vh', 'vw', 'vmin', 'vmax'].includes(unit) && amount >= 70) return false;
  return amount > 0;
}

function readerStylePreventsImageExpansion(style = {}) {
  if (!style || typeof style !== 'object') return false;
  return ['width', 'maxWidth', 'height', 'maxHeight'].some(propertyName => (
    readerSizeValuePreventsImageExpansion(style[propertyName], propertyName)
  ));
}

function readerNodePreventsImageExpansion(node) {
  if (!node) return false;
  if (readerStylePreventsImageExpansion(node.style)) return true;
  return (node.children || []).some(readerNodePreventsImageExpansion);
}

function readerBlockPreventsImageExpansion(block = {}) {
  if (readerStylePreventsImageExpansion(block.style)) return true;
  return (block.nodes || []).some(readerNodePreventsImageExpansion);
}

function isReaderStandaloneImagePage(blocks = []) {
  const mediaBlocks = blocks.filter(block => block?.type === 'image' || block?.mediaOnly);
  if (mediaBlocks.length !== 1) return false;
  if (readerBlockPreventsImageExpansion(mediaBlocks[0])) return false;
  return blocks.every(block => block === mediaBlocks[0] || isReaderTitleOnlyBlock(block));
}

function readerMeasureBlocksFromPages(pages = []) {
  const blocks = [];
  pages.forEach((page, pageIndex) => {
    normalizeReaderBlocks(page).forEach((block, blockIndex) => {
      blocks.push({
        ...block,
        readerMeasureMeta: {
          pageIndex,
          blockIndex,
          name: page.name,
          chapterIndex: page.chapterIndex,
          title: page.title,
        },
      });
    });
  });
  return blocks;
}

function cleanReaderMeasureBlock(block = {}) {
  const { readerMeasureMeta: _readerMeasureMeta, ...cleanBlock } = block;
  return cleanBlock;
}

function buildMeasuredReaderPages(blocks = [], measurements = [], options = {}) {
  const pageContentHeight = Math.max(80, Number(options.pageContentHeight) || 0);
  const pages = [];
  let currentPage = null;
  let usedHeight = 0;

  const flushPage = () => {
    if (!currentPage || currentPage.blocks.length < 1) return;
    pages.push({
      ...currentPage,
      text: currentPage.blocks.map(block => block.text || '').filter(Boolean).join('\n\n'),
      hasImage: currentPage.blocks.some(block => block.hasImage),
      standaloneImage: isReaderStandaloneImagePage(currentPage.blocks),
    });
    currentPage = null;
    usedHeight = 0;
  };

  const startPage = meta => {
    currentPage = {
      blocks: [],
      name: meta.name,
      chapterIndex: Number.isInteger(meta.chapterIndex) ? meta.chapterIndex : undefined,
      title: meta.title || '',
    };
    usedHeight = 0;
  };

  measurements.forEach(measurement => {
    const block = blocks[measurement.index];
    if (!block) return;
    const meta = block.readerMeasureMeta || {};
    const cleanBlock = cleanReaderMeasureBlock(block);
    const normalizedChapterIndex = Number.isInteger(meta.chapterIndex) ? meta.chapterIndex : undefined;
    const sameChapter = currentPage
      && currentPage.name === meta.name
      && currentPage.chapterIndex === normalizedChapterIndex;
    if (!sameChapter) {
      flushPage();
      startPage(meta);
    }
    const firstHeight = Math.max(1, Number(measurement.firstHeight) || Number(measurement.outerHeight) || 1);
    const outerHeight = Math.max(firstHeight, Number(measurement.outerHeight) || firstHeight);
    let nextHeight = currentPage.blocks.length > 0 ? outerHeight : firstHeight;
    if (currentPage.blocks.length > 0 && usedHeight + nextHeight > pageContentHeight) {
      flushPage();
      startPage(meta);
      nextHeight = firstHeight;
    }
    currentPage.blocks.push(cleanBlock);
    usedHeight += nextHeight;
  });

  flushPage();
  return pages;
}

function paginateReaderChapter(chapter = {}, options = {}) {
  const blocks = normalizeReaderBlocks(chapter);
  const pages = [];
  const chapterTitle = chapter.title || chapter.name || '';
  const metrics = readerPaginationMetrics(options);
  let currentPageBlocks = [];
  let currentPageLineCost = 0;

  const flushTextPage = () => {
    if (currentPageBlocks.length < 1) return;
    pages.push({
      blocks: currentPageBlocks,
      text: currentPageBlocks.map(block => block.text || '').filter(Boolean).join('\n\n'),
      hasImage: currentPageBlocks.some(block => block.hasImage),
      standaloneImage: isReaderStandaloneImagePage(currentPageBlocks),
    });
    currentPageBlocks = [];
    currentPageLineCost = 0;
  };

  const addPackedBlock = (block, text, options = {}) => {
    const hasImage = options.hasImage || block.hasImage || block.type === 'image';
    if (hasImage && currentPageBlocks.some(pageBlock => pageBlock.hasImage)) {
      flushTextPage();
    }
    const lineCost = Math.max(1, Number(options.lineCost) || estimateReaderBlockLineCost(text, metrics));
    const spacingCost = currentPageBlocks.length > 0 ? metrics.paragraphLineCost : 0;
    const overflowTolerance = Math.max(0, Number(options.overflowTolerance) || 0);
    if (currentPageBlocks.length > 0 && currentPageLineCost + spacingCost + lineCost > metrics.lineBudget + overflowTolerance) {
      flushTextPage();
    }
    const nextSpacingCost = currentPageBlocks.length > 0 ? metrics.paragraphLineCost : 0;
    currentPageBlocks.push(cloneReaderBlockForPage(block, text, options.preserveNodes !== false, {
      hasImage,
      mediaOnly: options.mediaOnly || block.mediaOnly || (hasImage && (!String(text || '').trim() || block.type === 'image')),
    }));
    currentPageLineCost += nextSpacingCost + lineCost;
  };

  const addSplittableTextBlock = (block, text, preserveNodes = true) => {
    const lineCost = estimateReaderBlockLineCost(text, metrics);
    const spacingCost = currentPageBlocks.length > 0 ? metrics.paragraphLineCost : 0;
    const remainingLines = metrics.lineBudget - currentPageLineCost - spacingCost;
    if (currentPageBlocks.length === 0 && lineCost > metrics.lineBudget) {
      const pageTexts = paginateText(text, options);
      pageTexts.forEach((pageText, index) => {
        if (index < pageTexts.length - 1) {
          pages.push({
            blocks: [cloneReaderBlockForPage(block, pageText, false)],
            text: pageText,
          });
          return;
        }
        addPackedBlock(block, pageText, { preserveNodes: false });
      });
      return;
    }
    const overflowLines = lineCost - remainingLines;
    if (
      currentPageBlocks.length > 0
      && remainingLines > 0
      && overflowLines > 0
      && overflowLines <= metrics.widowLineTolerance
    ) {
      addPackedBlock(block, text, {
        preserveNodes,
        lineCost,
        overflowTolerance: metrics.widowLineTolerance,
      });
      return;
    }
    if (currentPageBlocks.length > 0 && lineCost > remainingLines && remainingLines >= 1) {
      const [head, tail] = splitReaderTextForRemainingPage(text, metrics, remainingLines);
      if (head && tail) {
        addPackedBlock(block, head, {
          preserveNodes: false,
          lineCost: estimateReaderBlockLineCost(head, metrics),
          overflowTolerance: metrics.widowLineTolerance,
        });
        flushTextPage();
        const tailPages = paginateText(tail, options);
        tailPages.forEach((pageText, index) => {
          if (index < tailPages.length - 1) {
            pages.push({
              blocks: [cloneReaderBlockForPage(block, pageText, false)],
              text: pageText,
            });
            return;
          }
          addPackedBlock(block, pageText, { preserveNodes: false });
        });
        return;
      }
    }
    addPackedBlock(block, text, { preserveNodes });
  };

  for (const block of blocks) {
    if (block?.type === 'image' && block.src) {
      addPackedBlock({
        ...block,
        hasImage: true,
      }, block.alt || '', {
        hasImage: true,
        mediaOnly: true,
        lineCost: estimateReaderMediaLineCost(metrics, block),
      });
      continue;
    }
    const rawText = String(block?.text || '');
    const hasPreservedBlankText = rawText.includes('\u00a0') && !rawText.replace(/[\s\u00a0]+/g, '');
    const text = hasPreservedBlankText ? '\u00a0' : rawText.trim();
    if (!text && String(block?.tagName || '').toLowerCase() === 'hr') {
      addPackedBlock(block, '', {
        preserveNodes: true,
        lineCost: 1,
      });
      continue;
    }
    if (!text && Array.isArray(block?.nodes) && block.hasImage) {
      addPackedBlock(block, '', {
        hasImage: true,
        mediaOnly: true,
        lineCost: estimateReaderMediaLineCost(metrics, block),
      });
      continue;
    }
    if (!text) continue;
    if (hasPreservedBlankText) {
      addPackedBlock(block, text, {
        preserveNodes: true,
        lineCost: 1,
      });
      continue;
    }
    const preserveNodes = Array.isArray(block?.nodes);
    if (block.hasImage) {
      const imageOnlyNodes = readerImageOnlyNodesFromBlock(block);
      const imageOnlyBlock = imageOnlyNodes.length > 0
        ? {
            ...block,
            text: '',
            nodes: imageOnlyNodes,
            hasImage: true,
            mediaOnly: true,
          }
        : null;
      const textOnlyBlock = {
        ...block,
        hasImage: false,
        mediaOnly: false,
        nodes: undefined,
      };
      const textLineCost = estimateReaderBlockLineCost(text, metrics);
      const mediaLineCost = imageOnlyBlock ? estimateReaderMediaLineCost(metrics, imageOnlyBlock) : 0;
      if (
        imageOnlyBlock
        && text
        && (
          mediaLineCost >= Math.ceil(metrics.lineBudget * 0.32)
          || textLineCost + mediaLineCost > metrics.lineBudget
        )
      ) {
        addSplittableTextBlock(textOnlyBlock, text, false);
        addPackedBlock(imageOnlyBlock, '', {
          hasImage: true,
          mediaOnly: true,
          lineCost: mediaLineCost,
        });
        continue;
      }
      addPackedBlock(block, text, {
        hasImage: true,
        mediaOnly: !text,
        lineCost: Math.min(
          metrics.lineBudget,
          estimateReaderInlineImageLineCost(block, metrics) + estimateReaderBlockLineCost(text, metrics),
        ),
        preserveNodes,
      });
      continue;
    }
    addSplittableTextBlock(block, text, preserveNodes);
  }
  flushTextPage();
  if (pages.length === 0) {
    pages.push({
      blocks: [{ type: 'text', text: '' }],
      text: '',
    });
  }
  return pages.map((page, index) => ({
    ...page,
    name: chapter.name,
    chapterIndex: Number.isInteger(chapter.chapterIndex) ? chapter.chapterIndex : undefined,
    title: chapterTitle,
  }));
}

function ToolbarButton({ title, disabled = false, onClick, icon, iconSrc, iconRotate = 0, children, active = false, className = '' }) {
  const hasText = Boolean(children);
  return (
    <button
      type="button"
      className={`viewer-tool-button ${hasText ? 'has-text' : ''} ${active ? 'is-active' : ''} ${className}`.trim()}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={event => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={onClick}
    >
      {icon ? <FaIcon name={icon} /> : null}
      {iconSrc ? (
        <img
          className="viewer-tool-icon-image"
          src={iconSrc}
          alt=""
          aria-hidden="true"
          style={iconRotate ? { transform: `rotate(${iconRotate}deg)` } : undefined}
        />
      ) : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

function ViewerDropdown({ value, options, onChange, title = '', className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectableOptions = options.filter(option => option.kind !== 'group');
  const selected = selectableOptions.find(option => option.id === value) || selectableOptions[0] || { id: '', label: '' };
  const selectedLabel = viewerText(selected.labelKey, selected.label);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`viewer-dropdown ${open ? 'is-open' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="viewer-dropdown-button"
        title={title || selectedLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span>{selectedLabel}</span>
        <FaIcon name="caretDown" size={11} />
      </button>
      {open && (
        <div className="viewer-dropdown-menu" role="listbox">
          {options.map(option => (
            option.kind === 'group' ? (
              <div key={option.id} className="viewer-dropdown-group">
                {viewerText(option.labelKey, option.label)}
              </div>
            ) : (
              <button
                key={option.id}
                type="button"
                className={`viewer-dropdown-option ${option.id === selected.id ? 'is-selected' : ''}`}
                role="option"
                aria-selected={option.id === selected.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span>{viewerText(option.labelKey, option.label)}</span>
                {option.id === selected.id ? <FaIcon name="check" size={11} /> : null}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function ZoomControl({ zoom, onZoomChange, onReset, onWheel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`viewer-zoom-control ${open ? 'is-open' : ''}`} ref={rootRef} onWheel={onWheel}>
      <ToolbarButton
        title={viewerText('viewer.zoom.title', '확대/축소')}
        iconSrc={plusMinusIcon}
        active={open}
        className="viewer-zoom-button"
        onClick={() => setOpen(current => !current)}
      >
        {`${zoom}%`}
      </ToolbarButton>
      {open && (
        <div className="viewer-zoom-menu" role="dialog" aria-label={viewerText('viewer.zoom.dialog', '확대/축소 조절')}>
          <span className="viewer-zoom-value">{zoom}%</span>
          <input
            className="viewer-zoom-range"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            title={viewerText('viewer.zoom.ratio', '확대/축소 배율')}
            aria-label={viewerText('viewer.zoom.ratio', '확대/축소 배율')}
            onChange={event => onZoomChange(Number(event.target.value))}
          />
          <button type="button" className="viewer-zoom-reset" title={viewerText('viewer.zoom.reset', '확대/축소 리셋')} onClick={onReset}>
            {viewerText('viewer.common.reset_short', '리셋')}
          </button>
        </div>
      )}
    </div>
  );
}

function BookmarkEditor({ bookmarks, onClose, onDelete }) {
  return (
    <div className="viewer-modal-backdrop" onMouseDown={onClose}>
      <div className="viewer-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="viewer-modal-header">
          <h2>{viewerText('viewer.bookmark.edit_title', '책갈피 편집')}</h2>
          <button type="button" onClick={onClose} aria-label={viewerText('viewer.common.close', '닫기')}>
            <FaIcon name="xmark" />
          </button>
        </div>
        <div className="viewer-bookmark-editor-list">
          {bookmarks.length > 0 ? bookmarks.map(bookmark => (
            <div key={bookmark.id} className="viewer-bookmark-editor-row">
              <div>
                <strong>{bookmark.label}</strong>
                <span>{bookmark.createdAt}</span>
              </div>
              <button type="button" onClick={() => onDelete(bookmark.id)}>{viewerText('viewer.common.delete', '삭제')}</button>
            </div>
          )) : <div className="viewer-state">{viewerText('viewer.bookmark.empty', '저장된 책갈피가 없습니다.')}</div>}
        </div>
      </div>
    </div>
  );
}

function ViewerHelpModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('shortcuts');

  useEffect(() => {
    if (open) setActiveTab('shortcuts');
  }, [open]);

  if (!open) return null;

  const shortcutRows = [
    { key: '[ / ]', description: viewerText('viewer.help.shortcut_file', '이전파일과 다음파일로 이동합니다.') },
    { keys: ['← / →', '↑ / ↓', 'PageUp / PageDown'], description: viewerText('viewer.help.shortcut_page_group', '이전장과 다음장으로 이동합니다.') },
    { key: viewerText('viewer.help.shortcut_wheel_key', '마우스 휠'), description: viewerText('viewer.help.shortcut_wheel', '한장보기와 두장보기에서는 페이지를 넘기고, 스크롤모드에서는 본문을 스크롤합니다.') },
    { key: viewerText('viewer.help.shortcut_swipe_key', '스와이프'), description: viewerText('viewer.help.shortcut_swipe', '터치 화면에서 좌우로 스와이프해 이전장과 다음장으로 이동합니다.') },
    { key: 'Home / End', description: viewerText('viewer.help.shortcut_home_end', '첫 페이지와 마지막 페이지로 이동합니다.') },
    {
      keys: [
        '+ / -',
        `${viewerShortcutLabel(['Mod'])}+${viewerText('viewer.help.shortcut_wheel_key', '마우스 휠')}`,
        viewerText('viewer.help.shortcut_zoom_left_wheel', '좌클릭+마우스 휠'),
        viewerText('viewer.help.shortcut_zoom_right_wheel', '우클릭+마우스 휠'),
      ],
      description: viewerText('viewer.help.shortcut_zoom', '확대/축소 배율을 조절합니다. 스크롤모드에서는 마우스 위치를 기준으로 확대/축소합니다.'),
    },
    { keys: ['0', '7', '8', '9'], description: viewerText('viewer.help.shortcut_fit_group', '원본 크기, 가로 맞춤, 높이 맞춤, 전체 크기 맞춤으로 전환합니다.') },
    { key: 'B', description: viewerText('viewer.help.shortcut_bookmark', '현재 페이지를 책갈피로 추가합니다.') },
    { keys: [viewerShortcutLabel(['Mod', 'F']), 'L'], description: viewerText('viewer.help.shortcut_navigation_group', '목차 및 검색 패널을 열고 검색 입력 또는 목차 탭으로 이동합니다.') },
    { keys: ['Enter', 'F11', viewerText('viewer.help.shortcut_double_click_key', '더블클릭')], description: viewerText('viewer.help.shortcut_fullscreen_group', '뷰어 본문 또는 창 전체화면을 전환합니다.') },
    { key: 'Esc', description: viewerText('viewer.help.shortcut_escape', '뷰어 창을 닫습니다.') },
  ];
  const toolbarRows = [
    { icon: 'anglesLeft', title: viewerText('viewer.toolbar.previous_file', '이전파일 ({shortcut})', { shortcut: '[' }), description: viewerText('viewer.help.toolbar_previous_file', '현재 파일과 같은 목록에서 이전 파일을 엽니다.') },
    { icon: 'anglesRight', title: viewerText('viewer.toolbar.next_file', '다음파일 ({shortcut})', { shortcut: ']' }), description: viewerText('viewer.help.toolbar_next_file', '현재 파일과 같은 목록에서 다음 파일을 엽니다.') },
    { icon: 'angleLeft', title: viewerText('viewer.toolbar.previous_page', '이전장'), description: viewerText('viewer.help.toolbar_previous_page', '현재 문서의 이전 페이지로 이동합니다.') },
    { icon: 'angleRight', title: viewerText('viewer.toolbar.next_page', '다음장'), description: viewerText('viewer.help.toolbar_next_page', '현재 문서의 다음 페이지로 이동합니다.') },
    { iconSrc: fitWidthOrHeightIcon, title: viewerText('viewer.fit.width', '가로 맞춤'), description: viewerText('viewer.help.toolbar_fit_width', '페이지를 뷰어의 가로 폭에 맞춥니다.') },
    { iconSrc: fitWidthOrHeightIcon, rotate: 90, title: viewerText('viewer.fit.height', '높이 맞춤'), description: viewerText('viewer.help.toolbar_fit_height', '페이지를 뷰어의 높이에 맞춥니다.') },
    { iconSrc: showFullSizeIcon, title: viewerText('viewer.fit.fit', '전체 크기 맞춤'), description: viewerText('viewer.help.toolbar_fit_page', '페이지 전체가 보이도록 크기를 맞춥니다.') },
    { iconSrc: fitToPageIcon, title: viewerText('viewer.fit.actual', '원본 크기'), description: viewerText('viewer.help.toolbar_actual', '원본 크기 기준으로 표시합니다.') },
    { iconSrc: plusMinusIcon, title: viewerText('viewer.zoom.title', '확대/축소'), description: viewerText('viewer.help.toolbar_zoom', '배율 슬라이더와 리셋 버튼을 열어 확대/축소를 조절합니다.') },
    { iconSrc: readModeOnePageIcon, title: viewerText('viewer.read_mode.single', '한장보기모드'), description: viewerText('viewer.help.toolbar_single', '한 페이지씩 읽습니다.') },
    { iconSrc: readModeDoublePageIcon, title: viewerText('viewer.read_mode.spread', '두장보기모드'), description: viewerText('viewer.help.toolbar_spread', '두 페이지를 펼침 형태로 읽습니다.') },
    { iconSrc: readModeScrollIcon, title: viewerText('viewer.read_mode.scroll', '스크롤모드'), description: viewerText('viewer.help.toolbar_scroll', '문서를 세로로 이어서 스크롤합니다.') },
    { iconSrc: leftReadIcon, title: viewerText('viewer.toolbar.reading_direction_group', '읽기방향'), description: viewerText('viewer.help.toolbar_direction', '만화책의 좌우 읽기 방향을 전환합니다.') },
    { iconSrc: slideNavigationIcon, title: viewerText('viewer.toolbar.slide_nav_group', '슬라이드 탐색 바'), description: viewerText('viewer.help.toolbar_slide_nav', '하단 페이지 슬라이드 탐색 바를 표시하거나 숨깁니다.') },
    { text: 'Cover', title: viewerText('viewer.toolbar.cover_group', 'Cover'), description: viewerText('viewer.help.toolbar_cover', '만화책 두장보기에서 첫 장을 단독 표지로 처리합니다.') },
    { iconSrc: listSearchIcon, title: viewerText('viewer.navigation.title', '목차 및 검색'), description: viewerText('viewer.help.toolbar_navigation', '목차, 하이라이트, 검색 결과 패널을 엽니다.') },
    { icon: 'bookmark', title: viewerText('viewer.toolbar.bookmark', '책갈피'), description: viewerText('viewer.help.toolbar_bookmark', '책갈피 추가, 삭제, 편집 메뉴를 엽니다.') },
    { iconSrc: fullScreenIcon, title: viewerText('viewer.toolbar.fullscreen', '전체화면 전환'), description: viewerText('viewer.help.toolbar_fullscreen', '뷰어 창 전체화면을 전환합니다.') },
    { iconSrc: helpIcon, title: viewerText('viewer.toolbar.help', '사용법'), description: viewerText('viewer.help.toolbar_help', '뷰어 사용법 도움말을 엽니다.') },
    { icon: 'gear', title: viewerText('viewer.toolbar.settings_group', '설정'), description: viewerText('viewer.help.toolbar_settings', '뷰어 배경, 읽기, 표시 옵션을 조정합니다.') },
  ];
  const settingsRows = [
    { title: viewerText('viewer.settings.background', '배경'), description: viewerText('viewer.help.settings_background', '단색 배경 또는 페이지 색을 반영하는 몰입형 배경을 선택합니다.') },
    { title: viewerText('viewer.settings.theme', '테마'), description: viewerText('viewer.help.settings_theme', '텍스트와 PDF 뷰어의 기본 배경과 글자 색을 선택합니다.') },
    { title: viewerText('viewer.settings.font_scale', '글자 배율'), description: viewerText('viewer.help.settings_font_scale', 'EPUB/TXT 글자 크기를 제작자 스타일 비율을 유지한 채 조절합니다.') },
    { title: viewerText('viewer.settings.line_height', '줄간격'), description: viewerText('viewer.help.settings_line_height', 'EPUB/TXT 본문의 줄 사이 간격을 조절합니다.') },
    { title: viewerText('viewer.settings.letter_spacing', '글씨 간격'), description: viewerText('viewer.help.settings_letter_spacing', 'EPUB/TXT 본문의 글자 사이 간격을 조절합니다.') },
    { title: viewerText('viewer.settings.padding_y', '상/하 여백'), description: viewerText('viewer.help.settings_padding_y', 'EPUB/TXT 페이지의 위아래 여백을 조절합니다.') },
    { title: viewerText('viewer.settings.padding_x', '좌/우 여백'), description: viewerText('viewer.help.settings_padding_x', 'EPUB/TXT 페이지의 좌우 여백을 조절합니다.') },
    { title: viewerText('viewer.settings.paragraph_spacing', '문단 간격'), description: viewerText('viewer.help.settings_paragraph_spacing', 'EPUB/TXT 문단 사이 간격을 조절합니다.') },
    { title: viewerText('viewer.settings.text_align', '글 정렬'), description: viewerText('viewer.help.settings_text_align', '본문을 왼쪽, 양쪽, 오른쪽 맞춤으로 표시합니다.') },
    { title: viewerText('viewer.settings.text_direction', '텍스트 방향'), description: viewerText('viewer.help.settings_text_direction', '텍스트를 수평 또는 수직 방향으로 표시합니다.') },
    { title: viewerText('viewer.settings.hide_header', '머릿글 숨기기'), description: viewerText('viewer.help.settings_header', '페이지 상단 제목 표시 여부를 조절합니다.') },
    { title: viewerText('viewer.settings.hide_footer', '바닥글 숨기기'), description: viewerText('viewer.help.settings_footer', '페이지 번호 표시 여부를 조절합니다.') },
    { title: viewerText('viewer.settings.wrap', '줄바꿈'), description: viewerText('viewer.help.settings_wrap', '텍스트 줄바꿈 기준을 단어 또는 글자 단위로 선택합니다.') },
    { title: viewerText('viewer.settings.page_effect', '넘김효과'), description: viewerText('viewer.help.settings_page_effect', '페이지 이동 시 효과없음, 슬라이드, 페이드, 책 넘김 효과를 선택합니다.') },
  ];
  const navigationRows = [
    { title: viewerText('viewer.navigation.toc', '목차'), description: viewerText('viewer.help.navigation_toc', '파일에 포함된 목차를 표시하고 항목을 클릭하면 해당 위치로 이동합니다.') },
    { title: viewerText('viewer.navigation.search_placeholder', '책에서 찾기'), description: viewerText('viewer.help.navigation_search', '검색어를 입력하고 Enter를 누르면 정확히 일치하는 문자열을 찾습니다.') },
    { title: viewerText('viewer.navigation.search_results', '검색결과'), description: viewerText('viewer.help.navigation_results', '검색 결과는 앞뒤 문맥과 함께 표시되며 클릭하면 해당 페이지로 이동합니다.') },
    { title: viewerText('viewer.navigation.highlights', '하이라이트'), description: viewerText('viewer.help.navigation_highlights', '본문에서 추가한 하이라이트를 확인하고 이동하거나 삭제합니다.') },
  ];
  const contextRows = [
    { title: viewerText('viewer.help.context_open_title', '컨텍스트 메뉴 열기'), description: viewerText('viewer.help.context_open', '페이지에서 우클릭하거나, 텍스트를 드래그하여 우클릭시 컨텍스트 메뉴가 나옵니다.') },
    { title: viewerText('viewer.context.add_highlight', '하이라이트 추가'), description: viewerText('viewer.help.context_highlight', '선택한 텍스트를 하이라이트로 저장하고 목차 및 검색 패널의 하이라이트 탭에서 확인합니다.') },
    { title: viewerText('viewer.context.comic_single_page', '이 페이지를 단독장으로 분리'), description: viewerText('viewer.help.context_comic_single_page', '만화책 두장보기에서 순서가 어긋난 페이지를 단독 페이지로 분리해 이후 펼침 흐름을 다시 맞춥니다.') },
  ];
  const tabs = [
    { id: 'shortcuts', label: viewerText('viewer.help.tab_shortcuts', '단축키') },
    { id: 'toolbar', label: viewerText('viewer.help.tab_toolbar', '툴바') },
    { id: 'settings', label: viewerText('viewer.help.tab_settings', '설정') },
    { id: 'navigation', label: viewerText('viewer.help.tab_navigation', '목차 및 검색') },
    { id: 'context', label: viewerText('viewer.help.tab_context', '컨텍스트 메뉴') },
  ];
  const renderHelpIcon = item => {
    if (item.icon) return <FaIcon name={item.icon} />;
    if (item.iconSrc) {
      return (
        <img
          className="viewer-help-icon-image"
          src={item.iconSrc}
          alt=""
          aria-hidden="true"
          style={item.rotate ? { transform: `rotate(${item.rotate}deg)` } : undefined}
        />
      );
    }
    return <span>{item.text || ''}</span>;
  };
  const renderRows = rows => (
    <div className="viewer-help-list">
      {rows.map(row => (
        <div key={`${row.title || row.key || row.keys?.join('|')}-${row.description}`} className="viewer-help-row">
          <div className="viewer-help-row-title">
            {row.keys ? (
              <span className="viewer-help-shortcut-keys">
                {row.keys.map(key => <kbd key={key}>{key}</kbd>)}
              </span>
            ) : row.key ? <kbd>{row.key}</kbd> : <span className="viewer-help-toolbar-icon">{renderHelpIcon(row)}</span>}
            {row.title ? <strong>{row.title}</strong> : null}
          </div>
          <p>{row.description}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="viewer-modal-backdrop viewer-help-backdrop" onMouseDown={onClose}>
      <div
        className="viewer-modal viewer-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-help-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="viewer-modal-header">
          <h2 id="viewer-help-title">{viewerText('viewer.help.title', '뷰어 사용법')}</h2>
          <button
            type="button"
            className="viewer-help-close"
            onClick={onClose}
            aria-label={viewerText('viewer.common.close', '닫기')}
            title={viewerText('viewer.common.close', '닫기')}
          >
            <FaIcon name="xmark" />
          </button>
        </div>
        <div className="viewer-help-tabs" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'is-active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="viewer-help-content" role="tabpanel">
          {activeTab === 'shortcuts' ? renderRows(shortcutRows) : null}
          {activeTab === 'toolbar' ? renderRows(toolbarRows) : null}
          {activeTab === 'settings' ? renderRows(settingsRows) : null}
          {activeTab === 'navigation' ? renderRows(navigationRows) : null}
          {activeTab === 'context' ? renderRows(contextRows) : null}
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({ image, onClose }) {
  if (!image?.src) return null;
  return (
    <div className="viewer-image-lightbox-backdrop" onMouseDown={onClose}>
      <div className="viewer-image-lightbox" onMouseDown={event => event.stopPropagation()}>
        <button
          type="button"
          className="viewer-image-lightbox-close"
          onClick={onClose}
          aria-label={viewerText('viewer.common.close', '닫기')}
          title={viewerText('viewer.common.close', '닫기')}
        >
          <FaIcon name="xmark" />
        </button>
        <img src={image.src} alt={image.alt || ''} />
        {image.alt ? <div className="viewer-image-lightbox-caption">{image.alt}</div> : null}
      </div>
    </div>
  );
}

function PdfPageCanvas({ pdfDocument, pageNumber, containerWidth, containerHeight, pageSlots, viewMode, zoom, active }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ambientCanvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [visible, setVisible] = useState(active || pageNumber <= 2);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [pageSize, setPageSize] = useState(null);
  const [textLayerItems, setTextLayerItems] = useState([]);

  useEffect(() => {
    setVisible(active || pageNumber <= 2);
    setStatus('idle');
    setError('');
    setPageSize(null);
    setTextLayerItems([]);
    const ambientCanvas = ambientCanvasRef.current;
    const context = ambientCanvas?.getContext('2d');
    if (ambientCanvas && context) context.clearRect(0, 0, ambientCanvas.width, ambientCanvas.height);
  }, [pdfDocument, pageNumber]);

  useEffect(() => {
    if (active) setVisible(true);
  }, [active]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return undefined;
    const root = node.closest('.viewer-content');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, {
      root,
      rootMargin: '1400px 0px',
      threshold: 0.01,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdfDocument, pageNumber, visible]);

  useEffect(() => {
    if (!pdfDocument || !visible) return undefined;
    let canceled = false;

    const renderPage = async () => {
      setStatus('loading');
      setError('');
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (canceled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const slots = Math.max(1, Number(pageSlots) || 1);
        const horizontalInset = slots > 1 ? 24 : 64;
        const availableWidth = Math.max(220, ((Number(containerWidth) || 900) - horizontalInset) / slots);
        const availableHeight = Math.max(220, (Number(containerHeight) || 700) - 80);
        const { scale } = scaledPageSizeForViewMode({
          viewMode,
          baseWidth: baseViewport.width,
          baseHeight: baseViewport.height,
          availableWidth,
          availableHeight,
          zoom,
        });
        const viewport = page.getViewport({ scale });
        const nextPageSize = {
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
        };
        const canvas = canvasRef.current;
        const canvasContext = canvas?.getContext('2d');
        if (!canvas || !canvasContext) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${nextPageSize.width}px`;
        canvas.style.height = `${nextPageSize.height}px`;
        setPageSize(nextPageSize);
        const renderContext = {
          canvasContext,
          viewport,
        };
        if (outputScale !== 1) {
          renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
        }
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!canceled) {
          const textContent = await page.getTextContent().catch(() => ({ items: [] }));
          if (canceled) return;
          const util = pdfjsLib.Util;
          setTextLayerItems((textContent.items || []).map((item, index) => {
            const transform = util?.transform
              ? util.transform(viewport.transform, item.transform)
              : item.transform;
            const fontSize = Math.max(6, Math.hypot(transform[2] || 0, transform[3] || 0) || Math.abs(transform[0] || 0) || 12);
            return {
              id: `${pageNumber}-${index}`,
              text: item.str || '',
              left: transform[4] || 0,
              top: Math.max(0, (transform[5] || 0) - fontSize),
              fontSize,
              width: Math.max(1, item.width ? item.width * scale : 1),
              height: Math.max(1, item.height ? item.height * scale : fontSize),
            };
          }).filter(item => item.text));
          renderTaskRef.current = null;
          paintAmbientCanvasFromSource(ambientCanvasRef.current, canvas);
          setStatus('ready');
        }
      } catch (renderError) {
        if (canceled || renderError?.name === 'RenderingCancelledException') return;
        renderTaskRef.current = null;
        setStatus('error');
        setError(renderError.message || String(renderError));
      }
    };

    renderPage();
    return () => {
      canceled = true;
      renderTaskRef.current?.cancel?.();
      renderTaskRef.current = null;
    };
  }, [containerHeight, containerWidth, pageNumber, pageSlots, pdfDocument, viewMode, visible, zoom]);

  const canvasWrapStyle = pageSize
    ? {
      width: `${pageSize.width}px`,
      minHeight: `${pageSize.height}px`,
    }
    : undefined;

  return (
    <section
      ref={containerRef}
      className={`viewer-pdf-page ${active ? 'is-active' : ''}`}
      data-pdf-page-index={pageNumber - 1}
    >
      <div
        className={`viewer-pdf-canvas-wrap is-${status} ${status === 'error' ? 'is-error' : ''}`}
        style={canvasWrapStyle}
      >
        <canvas ref={ambientCanvasRef} className="viewer-ambient-canvas" aria-hidden="true" />
        <canvas ref={canvasRef} className="viewer-pdf-canvas" />
        {textLayerItems.length > 0 && (
          <div
            className="viewer-pdf-text-layer"
            style={pageSize ? { width: `${pageSize.width}px`, height: `${pageSize.height}px` } : undefined}
          >
            {textLayerItems.map(item => (
              <span
                key={item.id}
                style={{
                  left: `${item.left}px`,
                  top: `${item.top}px`,
                  fontSize: `${item.fontSize}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                }}
              >
                {item.text}
              </span>
            ))}
          </div>
        )}
        {status !== 'ready' && (
          <div className="viewer-pdf-page-state">
            {status === 'error'
              ? error || viewerText('viewer.common.pdf_page_unavailable', 'PDF page unavailable')
              : viewerText('viewer.common.loading', 'Loading...')}
          </div>
        )}
      </div>
      <div className="viewer-pdf-page-number">{pageNumber}</div>
    </section>
  );
}

function PdfThumbnailCanvas({ pdfDocument, pageNumber, active, onClick }) {
  const itemRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 12);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    setVisible(pageNumber <= 12);
    setStatus('idle');
  }, [pdfDocument, pageNumber]);

  useEffect(() => {
    const node = itemRef.current;
    if (!node || visible) return undefined;
    const root = node.closest('.viewer-slide-strip');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, {
      root,
      rootMargin: '600px 0px',
      threshold: 0.01,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdfDocument, pageNumber, visible]);

  useEffect(() => {
    if (!active) return;
    itemRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [active]);

  useEffect(() => {
    if (!pdfDocument || !visible) return undefined;
    let canceled = false;

    const renderThumbnail = async () => {
      setStatus('loading');
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (canceled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const targetHeight = 70;
        const scale = targetHeight / Math.max(1, baseViewport.height);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const canvasContext = canvas?.getContext('2d');
        if (!canvas || !canvasContext) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderContext = {
          canvasContext,
          viewport,
        };
        if (outputScale !== 1) {
          renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
        }
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!canceled) {
          renderTaskRef.current = null;
          setStatus('ready');
        }
      } catch {
        if (!canceled) {
          renderTaskRef.current = null;
          setStatus('error');
        }
      }
    };

    renderThumbnail();
    return () => {
      canceled = true;
      renderTaskRef.current?.cancel?.();
      renderTaskRef.current = null;
    };
  }, [pdfDocument, pageNumber, visible]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`viewer-slide-thumb ${active ? 'is-active' : ''} is-${status}`}
      onClick={onClick}
      aria-label={viewerText('viewer.navigation.go_page', '{page} 페이지로 이동', { page: pageNumber })}
    >
      <span className="viewer-slide-thumb-canvas">
        <canvas ref={canvasRef} />
      </span>
      <span>{pageNumber}</span>
    </button>
  );
}

function ComicSlideThumb({ page, pageNumber, active, src, hasFallbackSrc, onClick, onFallback }) {
  const itemRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    itemRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`viewer-slide-thumb is-comic ${active ? 'is-active' : ''} ${src ? 'is-ready' : 'is-idle'}`}
      onClick={onClick}
      aria-label={viewerText('viewer.navigation.go_page', '{page} 페이지로 이동', { page: pageNumber })}
    >
      <span className="viewer-slide-thumb-canvas">
        {src ? (
          <img
            src={src}
            alt={page?.basename || viewerText('viewer.navigation.page_alt', '{page} 페이지', { page: pageNumber })}
            loading="lazy"
            onError={() => {
              if (page?.pageUrl && !hasFallbackSrc) onFallback?.();
            }}
          />
        ) : (
          <span className="viewer-slide-thumb-placeholder">{pageNumber}</span>
        )}
      </span>
      <span>{pageNumber}</span>
    </button>
  );
}

function ReaderSlideThumb({ item, pageNumber, active, onClick }) {
  const itemRef = useRef(null);
  const text = String(item?.title || item?.text || item || '').replace(/\s+/g, ' ').trim();

  useEffect(() => {
    if (!active) return;
    itemRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`viewer-slide-thumb is-reader ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-label={viewerText('viewer.navigation.go_page', '{page} 페이지로 이동', { page: pageNumber })}
    >
      <span className="viewer-slide-thumb-canvas">
        <span className="viewer-slide-thumb-reader-preview">
          <strong>{pageNumber}</strong>
          <small>{text || viewerText('viewer.common.no_content', '내용 없음')}</small>
        </span>
      </span>
      <span>{pageNumber}</span>
    </button>
  );
}

function ViewerNavigationPanel({
  open,
  session,
  thumbnailSrc,
  author,
  searchInputRef,
  query,
  onQueryChange,
  onSearch,
  activeTab,
  onTabChange,
  tocItems,
  activeTocId,
  highlights,
  searchResults,
  searchLoading,
  onClose,
  onTocClick,
  onHighlightClick,
  onHighlightDelete,
  onSearchClick,
}) {
  const tabs = [
    { id: 'toc', label: viewerText('viewer.navigation.toc', '목차') },
    { id: 'highlights', label: viewerText('viewer.navigation.highlights', '하이라이트') },
    { id: 'search', label: viewerText('viewer.navigation.search_results', '검색결과') },
  ];
  const renderSearchSnippet = result => {
    const snippet = String(result.snippet || '');
    const searchText = String(result.text || query || '');
    const index = searchText ? snippet.indexOf(searchText) : -1;
    if (index < 0) return snippet;
    return (
      <>
        {snippet.slice(0, index)}
        <mark>{snippet.slice(index, index + searchText.length)}</mark>
        {snippet.slice(index + searchText.length)}
      </>
    );
  };
  return (
    <aside className={`viewer-navigation-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="viewer-navigation-header">
        <div className="viewer-navigation-thumb">
          {thumbnailSrc ? <img src={thumbnailSrc} alt="" /> : <FaIcon name="bookOpen" />}
        </div>
        <div className="viewer-navigation-meta">
          <div className="viewer-navigation-title" title={session?.fileName || ''}>
            {session?.fileName || viewerText('viewer.navigation.no_file', '파일 없음')}
          </div>
          <div className="viewer-navigation-author">{author || '\u00a0'}</div>
          <form
            className="viewer-navigation-search"
            onSubmit={event => {
              event.preventDefault();
              onSearch(query);
            }}
          >
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              placeholder={viewerText('viewer.navigation.search_placeholder', '책에서 찾기')}
              onChange={event => onQueryChange(event.target.value)}
            />
          </form>
        </div>
        <button
          type="button"
          className="viewer-navigation-close"
          title={viewerText('viewer.common.close', '닫기')}
          aria-label={viewerText('viewer.common.close', '닫기')}
          onClick={onClose}
        >
          <FaIcon name="xmark" />
        </button>
      </div>
      <div className="viewer-navigation-tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="viewer-navigation-list">
        {activeTab === 'toc' && (
          tocItems.length > 0 ? tocItems.map(item => (
            <button
              key={item.id}
              type="button"
              className={`viewer-navigation-list-item ${activeTocId === item.id ? 'is-active' : ''}`.trim()}
              style={{ '--viewer-nav-depth': item.depth || 0 }}
              aria-current={activeTocId === item.id ? 'page' : undefined}
              onClick={() => onTocClick(item)}
            >
              <span>{item.title}</span>
              <small>{Number(item.pageIndex) + 1}p</small>
            </button>
          )) : <div className="viewer-navigation-empty">{viewerText('viewer.navigation.empty_toc', '목차가 없습니다.')}</div>
        )}
        {activeTab === 'highlights' && (
          highlights.length > 0 ? highlights.map(highlight => (
            <div key={highlight.id} className="viewer-navigation-list-row">
              <button type="button" className="viewer-navigation-list-item" onClick={() => onHighlightClick(highlight)}>
                <span>{highlight.snippet || highlight.text}</span>
                <small>{Number(highlight.pageIndex) + 1}p</small>
              </button>
              <button
                type="button"
                className="viewer-navigation-delete"
                title={viewerText('viewer.common.delete', '삭제')}
                aria-label={viewerText('viewer.common.delete', '삭제')}
                onClick={() => onHighlightDelete(highlight.id)}
              >
                <FaIcon name="xmark" />
              </button>
            </div>
          )) : <div className="viewer-navigation-empty">{viewerText('viewer.navigation.empty_highlights', '하이라이트가 없습니다.')}</div>
        )}
        {activeTab === 'search' && (
          searchLoading ? <div className="viewer-navigation-empty">{viewerText('viewer.navigation.searching', '검색 중...')}</div> : (
            searchResults.length > 0 ? searchResults.map(result => (
              <button
                key={result.id}
                type="button"
                className="viewer-navigation-list-item is-search-result"
                onClick={() => onSearchClick(result)}
              >
                <span>{renderSearchSnippet(result)}</span>
                <small>{Number(result.pageIndex) + 1}p</small>
              </button>
            )) : <div className="viewer-navigation-empty">{viewerText('viewer.navigation.empty_search', '검색 결과가 없습니다.')}</div>
          )
        )}
      </div>
    </aside>
  );
}

function ComicPageFrame({
  page,
  index,
  src,
  viewMode,
  imageClassName,
  frameStyle,
  imageStyle,
  onImageLoad,
  onImageError,
}) {
  const imageRef = useRef(null);
  const ambientCanvasRef = useRef(null);

  const paintAmbient = useCallback(image => {
    return paintAmbientCanvasFromSource(ambientCanvasRef.current, image);
  }, []);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      paintAmbient(image);
    }
  }, [paintAmbient, src]);

  return (
    <div
      key={page.name}
      data-page-index={index}
      className={`viewer-comic-page-frame view-${viewMode}`}
      style={frameStyle}
    >
      <span className="viewer-ambient-clip" aria-hidden="true">
        <canvas ref={ambientCanvasRef} className="viewer-ambient-canvas" />
      </span>
      <img
        ref={imageRef}
        className={imageClassName}
        src={src}
        alt={page.basename}
        draggable={false}
        style={imageStyle}
        onLoad={event => {
          paintAmbient(event.currentTarget);
          onImageLoad(event);
        }}
        onDragStart={event => event.preventDefault()}
        onError={onImageError}
      />
    </div>
  );
}

function ReaderRangeSetting({ label, value, min, max, step = 1, unit = '', onChange }) {
  const numericValue = clampNumber(value, min, max, min);
  return (
    <label className="viewer-range-setting">
      <span>{label}</span>
      <strong>{numericValue}{unit}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numericValue}
        onChange={event => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ReaderSegmentedSetting({ label, value, options, onChange }) {
  const shouldWrap = options.length > 4;
  return (
    <div className="viewer-setting-field">
      <span>{label}</span>
      <div
        className={`viewer-segmented-buttons ${shouldWrap ? 'is-wrapped' : ''}`.trim()}
        role="radiogroup"
        aria-label={label}
        style={{ '--viewer-segment-count': options.length }}
      >
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={value === option.id ? 'is-selected' : ''}
            onClick={() => onChange(option.id)}
          >
            {viewerText(option.labelKey, option.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReaderSettingsPanel({
  open,
  sessionType,
  settings,
  fontGroups,
  backgroundSettings,
  onBackgroundChange,
  onChange,
  onReset,
  onClose,
}) {
  const theme = THEMES.find(item => item.id === settings.theme) || THEMES[0];
  const fontOptions = fontOptionsFromGroups(fontGroups, sessionType);
  const showReaderSettings = sessionType === 'epub' || sessionType === 'text';
  const showComicSettings = sessionType === 'comic';
  const showPdfSettings = sessionType === 'pdf';
  const showBackgroundSettings = sessionType === 'comic' || sessionType === 'pdf' || sessionType === 'epub' || sessionType === 'text';
  return (
    <aside className={`viewer-settings-panel ${open ? 'is-open' : ''}`}>
      <div className="viewer-settings-header">
        <h2>{showBackgroundSettings ? viewerText('viewer.settings.viewer', '뷰어 설정') : viewerText('viewer.settings.reading', '읽기 설정')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={viewerText('viewer.common.close', '닫기')}
          title={viewerText('viewer.common.close', '닫기')}
        >
          <FaIcon name="xmark" />
        </button>
      </div>
      {showBackgroundSettings && (
        <section className="viewer-settings-section">
          <h3>{viewerText('viewer.settings.background', '배경')}</h3>
          <div className="viewer-background-mode" role="group" aria-label={viewerText('viewer.settings.background_mode', '배경 모드')}>
            <button
              type="button"
              className={backgroundSettings.mode === 'solid' ? 'is-selected' : ''}
              onClick={() => onBackgroundChange({ mode: 'solid' })}
            >
              {viewerText('viewer.settings.solid', '단색')}
            </button>
            <button
              type="button"
              className={backgroundSettings.mode === 'immersive' ? 'is-selected' : ''}
              onClick={() => onBackgroundChange({ mode: 'immersive' })}
            >
              {viewerText('viewer.settings.immersive', '몰입형')}
            </button>
          </div>
          {backgroundSettings.mode === 'solid' && (
            <div className="viewer-background-swatches" aria-label={viewerText('viewer.settings.background_color', '배경색')}>
              {VIEWER_BACKGROUND_COLORS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={backgroundSettings.color === item.color ? 'is-selected' : ''}
                  style={{ backgroundColor: item.color }}
                  title={viewerText(item.labelKey, item.label)}
                  aria-label={viewerText(item.labelKey, item.label)}
                  onClick={() => onBackgroundChange({ color: item.color })}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {showComicSettings && (
        <section className="viewer-settings-section">
          <h3>{viewerText('viewer.settings.display', '표시')}</h3>
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.page_effect', '넘김효과')}
            value={settings.pageEffect}
            options={PAGE_EFFECT_OPTIONS}
            onChange={pageEffect => onChange({ pageEffect })}
          />
          <button type="button" className="viewer-settings-reset" onClick={onReset}>{viewerText('viewer.settings.reset', '초기화')}</button>
        </section>
      )}
      {showPdfSettings && (
        <section className="viewer-settings-section">
          <h3>{viewerText('viewer.settings.display', '표시')}</h3>
          <div className="viewer-setting-field">
            <span>{viewerText('viewer.settings.theme', '테마')}</span>
            <div className="viewer-theme-swatches" aria-label={viewerText('viewer.settings.theme', '테마')}>
              {THEMES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={settings.theme === item.id && backgroundSettings.mode === 'solid' && backgroundSettings.color === item.bg ? 'is-selected' : ''}
                  style={{ '--viewer-theme-bg': item.bg, '--viewer-theme-fg': item.fg }}
                  title={viewerText(`viewer.theme.${item.id}`, item.label)}
                  aria-label={viewerText(`viewer.theme.${item.id}`, item.label)}
                  onClick={() => {
                    onChange({ theme: item.id });
                    onBackgroundChange({ mode: 'solid', color: item.bg });
                  }}
                >
                  <span>{viewerText(`viewer.theme.${item.id}`, item.label)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="viewer-theme-preview" style={{ background: theme.bg, color: theme.fg }}>
            {viewerText('viewer.settings.preview', 'Aa 가나다')}
          </div>
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.page_effect', '넘김효과')}
            value={settings.pageEffect}
            options={PAGE_EFFECT_OPTIONS}
            onChange={pageEffect => onChange({ pageEffect })}
          />
        </section>
      )}
      {showReaderSettings && (
        <section className="viewer-settings-section">
          <h3>{viewerText('viewer.settings.read', '읽기')}</h3>
          <div className="viewer-setting-field">
            <span>{viewerText('viewer.settings.theme', '테마')}</span>
            <div className="viewer-theme-swatches" aria-label={viewerText('viewer.settings.theme', '테마')}>
              {THEMES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={settings.theme === item.id ? 'is-selected' : ''}
                  style={{ '--viewer-theme-bg': item.bg, '--viewer-theme-fg': item.fg }}
                  title={viewerText(`viewer.theme.${item.id}`, item.label)}
                  aria-label={viewerText(`viewer.theme.${item.id}`, item.label)}
                  onClick={() => onChange({ theme: item.id })}
                >
                  <span>{viewerText(`viewer.theme.${item.id}`, item.label)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="viewer-theme-preview" style={{ background: theme.bg, color: theme.fg }}>
            {viewerText('viewer.settings.preview', 'Aa 가나다')}
          </div>
          <label>
            <span>{viewerText('viewer.settings.font', '글꼴')}</span>
            <ViewerDropdown
              value={settings.fontFamily}
              options={fontOptions}
              onChange={fontFamily => onChange({ fontFamily })}
            />
          </label>
          <ReaderRangeSetting
            label={viewerText('viewer.settings.font_scale', '글자 배율')}
            value={settings.fontScale}
            min={READER_FONT_SCALE_MIN}
            max={READER_FONT_SCALE_MAX}
            step={5}
            unit="%"
            onChange={fontScale => onChange({ fontScale })}
          />
          <ReaderRangeSetting
            label={viewerText('viewer.settings.line_height', '줄간격')}
            value={settings.lineHeightPercent}
            min={0}
            max={200}
            unit="%"
            onChange={lineHeightPercent => onChange({ lineHeightPercent })}
          />
          <ReaderRangeSetting
            label={viewerText('viewer.settings.letter_spacing', '글씨 간격')}
            value={settings.letterSpacing}
            min={0}
            max={20}
            unit="px"
            onChange={letterSpacing => onChange({ letterSpacing })}
          />
          <ReaderRangeSetting
            label={viewerText('viewer.settings.padding_y', '상/하 여백')}
            value={settings.verticalPadding}
            min={0}
            max={80}
            unit="px"
            onChange={verticalPadding => onChange({ verticalPadding })}
          />
          <ReaderRangeSetting
            label={viewerText('viewer.settings.padding_x', '좌/우 여백')}
            value={settings.horizontalPadding}
            min={0}
            max={80}
            unit="px"
            onChange={horizontalPadding => onChange({ horizontalPadding })}
          />
          <ReaderRangeSetting
            label={viewerText('viewer.settings.paragraph_spacing', '문단 간격')}
            value={settings.paragraphSpacing}
            min={0}
            max={120}
            unit="px"
            onChange={paragraphSpacing => onChange({ paragraphSpacing })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.text_align', '글 정렬')}
            value={settings.textAlign}
            options={TEXT_ALIGN_OPTIONS}
            onChange={textAlign => onChange({ textAlign })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.text_direction', '텍스트 방향')}
            value={settings.textDirection}
            options={TEXT_DIRECTION_OPTIONS}
            onChange={textDirection => onChange({ textDirection })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.hide_header', '머릿글 숨기기')}
            value={settings.showHeader ? 'show' : 'hide'}
            options={VISIBILITY_OPTIONS}
            onChange={value => onChange({ showHeader: value === 'show' })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.hide_footer', '바닥글 숨기기')}
            value={settings.showFooter ? 'show' : 'hide'}
            options={VISIBILITY_OPTIONS}
            onChange={value => onChange({ showFooter: value === 'show' })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.wrap', '줄바꿈')}
            value={settings.wrapMode}
            options={WRAP_OPTIONS}
            onChange={wrapMode => onChange({ wrapMode })}
          />
          <ReaderSegmentedSetting
            label={viewerText('viewer.settings.page_effect', '넘김효과')}
            value={settings.pageEffect}
            options={PAGE_EFFECT_OPTIONS}
            onChange={pageEffect => onChange({ pageEffect })}
          />
          <button type="button" className="viewer-settings-reset" onClick={onReset}>{viewerText('viewer.settings.reset', '초기화')}</button>
        </section>
      )}
    </aside>
  );
}

function ViewerApp() {
  const [session, setSession] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageData, setPageData] = useState({});
  const [pageErrors, setPageErrors] = useState({});
  const [pageRatios, setPageRatios] = useState({});
  const [pageSizes, setPageSizes] = useState({});
  const [pdfDocument, setPdfDocument] = useState(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [textContent, setTextContent] = useState('');
  const [epubChapters, setEpubChapters] = useState([]);
  const [epubToc, setEpubToc] = useState([]);
  const [epubMetadata, setEpubMetadata] = useState({});
  const [epubStylesheet, setEpubStylesheet] = useState('');
  const [measuredEpubPagination, setMeasuredEpubPagination] = useState(null);
  const [pdfToc, setPdfToc] = useState([]);
  const [flowMode, setFlowMode] = useState('single');
  const [viewMode, setViewMode] = useState('fit');
  const [zoom, setZoom] = useState(100);
  const [readingDirection, setReadingDirection] = useState('ltr');
  const [spreadCoverFirst, setSpreadCoverFirst] = useState(true);
  const [readerSettings, setReaderSettings] = useState(normalizeReaderSettings());
  const [viewerBackground, setViewerBackground] = useState(normalizeViewerBackgroundSettings());
  const [pageTurn, setPageTurn] = useState(EMPTY_PAGE_TURN);
  const [pageJumpSequence, setPageJumpSequence] = useState(0);
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const [bookmarkEditorOpen, setBookmarkEditorOpen] = useState(false);
  const [comicSinglePageNames, setComicSinglePageNames] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [selectionMenu, setSelectionMenu] = useState(null);
  const [navigationPanelOpen, setNavigationPanelOpen] = useState(false);
  const [navigationTab, setNavigationTab] = useState('toc');
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookSearchResults, setBookSearchResults] = useState([]);
  const [bookSearchLoading, setBookSearchLoading] = useState(false);
  const [activeSearch, setActiveSearch] = useState(null);
  const [imageLightbox, setImageLightbox] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewerToast, setViewerToast] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewerLanguage, setViewerLanguage] = useState(getCurrentLanguage());
  const [slideNavOpen, setSlideNavOpen] = useState(true);
  const [toolbarPinnedOpen, setToolbarPinnedOpen] = useState(true);
  const [toolbarPeekOpen, setToolbarPeekOpen] = useState(false);
  const [fontGroups, setFontGroups] = useState(() => normalizeFontGroups(DEFAULT_FONT_GROUPS));
  const [scrollPercent, setScrollPercent] = useState(0);
  const [readerViewport, setReaderViewport] = useState({ width: 900, height: 700 });
  const [readerPageFitScale, setReaderPageFitScale] = useState(READER_PAGE_FIT_SCALE_DEFAULT);
  const [toolbarHeight, setToolbarHeight] = useState(42);
  const [loading, setLoading] = useState(false);
  const [adjacentLoading, setAdjacentLoading] = useState(false);
  const [error, setError] = useState('');
  const toolbarRef = useRef(null);
  const scrollRef = useRef(null);
  const readerMeasureRef = useRef(null);
  const pageIndexRef = useRef(0);
  const visibleReaderIndexRef = useRef(0);
  const loadingPagesRef = useRef(new Set());
  const loadSequenceRef = useRef(0);
  const adjacentLoadingRef = useRef(false);
  const documentAbortRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const pdfLoadingTaskRef = useRef(null);
  const pdfPendingScrollRef = useRef(null);
  const pageTurnTimerRef = useRef(null);
  const viewerToastTimerRef = useRef(null);
  const toolbarPeekTimerRef = useRef(null);
  const lastPageHintRef = useRef('');
  const loadComicPageRef = useRef(null);
  const navigationSearchInputRef = useRef(null);
  const dragPanRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const swipeGestureRef = useRef(null);
  const wheelButtonStateRef = useRef(0);
  const suppressContextMenuRef = useRef(false);
  const scrollZoomAnchorSequenceRef = useRef(0);
  const scrollRestoreTokenRef = useRef(0);

  const restoreViewerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      scrollRef.current?.focus?.({ preventScroll: true });
    });
  }, []);

  const clearToolbarPeekTimer = useCallback(() => {
    if (!toolbarPeekTimerRef.current) return;
    window.clearTimeout(toolbarPeekTimerRef.current);
    toolbarPeekTimerRef.current = null;
  }, []);

  const showToolbarPeek = useCallback(() => {
    if (toolbarPinnedOpen) return;
    clearToolbarPeekTimer();
    setToolbarPeekOpen(true);
  }, [clearToolbarPeekTimer, toolbarPinnedOpen]);

  const scheduleToolbarPeekClose = useCallback((delay = 900) => {
    if (toolbarPinnedOpen) return;
    clearToolbarPeekTimer();
    toolbarPeekTimerRef.current = window.setTimeout(() => {
      toolbarPeekTimerRef.current = null;
      setToolbarPeekOpen(false);
    }, delay);
  }, [clearToolbarPeekTimer, toolbarPinnedOpen]);

  const toggleToolbarPinned = useCallback(() => {
    clearToolbarPeekTimer();
    setToolbarPeekOpen(false);
    setToolbarPinnedOpen(current => !current);
    restoreViewerFocus();
  }, [clearToolbarPeekTimer, restoreViewerFocus]);

  useEffect(() => () => {
    clearToolbarPeekTimer();
  }, [clearToolbarPeekTimer]);

  const setPageIndexSynced = useCallback(nextIndex => {
    const normalizedIndex = Math.max(0, Number(nextIndex) || 0);
    pageIndexRef.current = normalizedIndex;
    setPageIndex(normalizedIndex);
  }, []);

  useEffect(() => {
    pageIndexRef.current = pageIndex;
  }, [pageIndex]);

  const isReaderDocument = session?.type === 'epub' || session?.type === 'text';
  const supportsNavigationPanel = session?.type === 'epub' || session?.type === 'pdf' || session?.type === 'text';
  const theme = THEMES.find(item => item.id === readerSettings.theme) || THEMES[0];
  const lineHeightPercent = readerSettings.lineHeightPercent;
  const lineHeight = 1 + (lineHeightPercent / 100);
  const readerFontScale = (Number(readerSettings.fontScale) || 100) / 100;
  const readerFontSize = READER_BASE_FONT_SIZE * readerFontScale * ((Number(zoom) || 100) / 100);
  const readerPageMetrics = useMemo(() => {
    const pageColumns = flowMode === 'spread' ? 2 : 1;
    const stageGap = flowMode === 'spread' ? 0 : 10;
    const horizontalPadding = Number(readerSettings.horizontalPadding) || 0;
    const verticalPadding = Number(readerSettings.verticalPadding) || 0;
    const paragraphSpacing = Number(readerSettings.paragraphSpacing) || 0;
    const letterSpacing = Number(readerSettings.letterSpacing) || 0;
    const footerSpace = readerSettings.showFooter ? READER_FOOTER_SPACE : 0;
    const isVerticalText = readerSettings.textDirection === 'vertical';
    const pageOuterPadding = horizontalPadding * 2;
    const stageWidth = Math.max(280, (Number(readerViewport.width) || 900) - (READER_STAGE_PADDING * 2));
    const isReaderWidthFit = session?.type === 'epub' && viewMode === 'width';
    const defaultMaxPageWidth = flowMode === 'spread' ? READER_SPREAD_PAGE_MAX_WIDTH : READER_SINGLE_PAGE_MAX_WIDTH;
    const maxPageWidth = isReaderWidthFit
      ? Math.max(220, (stageWidth - stageGap) / pageColumns)
      : defaultMaxPageWidth;
    const pageFrameWidth = Math.min(maxPageWidth, Math.max(220, (stageWidth - stageGap) / pageColumns));
    const pageWidth = Math.max(160, pageFrameWidth - pageOuterPadding);
    const charAdvance = (readerSettings.wrapMode === 'char'
      ? readerFontSize
      : readerFontSize * 0.62) + letterSpacing;
    const lineAdvance = readerFontSize * lineHeight;
    const pageFrameHeight = Math.max(260, (Number(readerViewport.height) || 700) - (READER_STAGE_PADDING * 2));
    const availableHeight = Math.max(220, pageFrameHeight - (verticalPadding * 2) - footerSpace - READER_PAGE_BOTTOM_GUARD);
    const mixedImageMaxHeight = Math.max(140, Math.floor(availableHeight * READER_MIXED_IMAGE_HEIGHT_RATIO));
    const charsPerLine = isVerticalText
      ? Math.max(12, Math.floor(availableHeight / Math.max(6, charAdvance)))
      : Math.max(12, Math.floor(pageWidth / Math.max(6, charAdvance)));
    const linesPerPage = isVerticalText
      ? Math.max(8, Math.floor(pageWidth / Math.max(10, lineAdvance)))
      : Math.max(8, Math.floor(availableHeight / Math.max(10, lineAdvance)));
    const pageSafetyRatio = viewMode === 'height' ? 0.94 : 0.96;
    const renderFitScale = session?.type === 'epub' ? readerPageFitScale : 1;
    const safeLinesPerPage = Math.max(6, Math.floor(linesPerPage * pageSafetyRatio * renderFitScale));
    const maxCharRatio = (viewMode === 'height' ? 0.9 : 0.94) * renderFitScale;
    const widowLineTolerance = 0;
    return {
      charsPerLine,
      linesPerPage: safeLinesPerPage,
      maxChars: clamp(Math.floor(charsPerLine * safeLinesPerPage * maxCharRatio), 320, 2600),
      paragraphLineCost: paragraphSpacing / Math.max(10, lineAdvance),
      mediaLineCost: Math.max(4, Math.ceil(safeLinesPerPage * READER_MIXED_IMAGE_LINE_RATIO)),
      mixedImageMaxHeight,
      lineAdvance,
      pageWidth,
      pageFrameWidth,
      pageFrameHeight,
      fontSize: readerFontSize,
      widowLineTolerance,
      wrapMode: readerSettings.wrapMode,
    };
  }, [
    flowMode,
    lineHeight,
    readerFontSize,
    readerSettings.horizontalPadding,
    readerSettings.letterSpacing,
    readerSettings.paragraphSpacing,
    readerSettings.showFooter,
    readerSettings.textDirection,
    readerSettings.verticalPadding,
    readerSettings.wrapMode,
    readerPageFitScale,
    readerViewport.height,
    readerViewport.width,
    session?.type,
    viewMode,
  ]);
  const textPages = useMemo(() => paginateText(textContent, readerPageMetrics), [readerPageMetrics, textContent]);
  const estimatedEpubPages = useMemo(() => (
    epubChapters.flatMap((chapter, chapterIndex) => paginateReaderChapter({
      ...chapter,
      chapterIndex,
    }, {
      ...readerPageMetrics,
      titleLines: readerSettings.showHeader ? (viewMode === 'height' ? 2 : 1) : 0,
    }))
  ), [epubChapters, readerPageMetrics, readerSettings.showHeader, viewMode]);
  const epubMeasurementBlocks = useMemo(
    () => readerMeasureBlocksFromPages(estimatedEpubPages),
    [estimatedEpubPages],
  );
  const epubMeasurementKey = useMemo(() => [
    session?.id || '',
    session?.filePath || '',
    estimatedEpubPages.length,
    epubMeasurementBlocks.length,
    flowMode,
    viewMode,
    zoom,
    readerViewport.width,
    readerViewport.height,
    readerSettings.fontFamily,
    readerSettings.fontScale,
    readerSettings.horizontalPadding,
    readerSettings.letterSpacing,
    readerSettings.lineHeightPercent,
    readerSettings.paragraphSpacing,
    readerSettings.showFooter,
    readerSettings.showHeader,
    readerSettings.textAlign,
    readerSettings.textDirection,
    readerSettings.verticalPadding,
    readerSettings.wrapMode,
  ].join('|'), [
    estimatedEpubPages.length,
    epubMeasurementBlocks.length,
    flowMode,
    readerSettings.fontFamily,
    readerSettings.fontScale,
    readerSettings.horizontalPadding,
    readerSettings.letterSpacing,
    readerSettings.lineHeightPercent,
    readerSettings.paragraphSpacing,
    readerSettings.showFooter,
    readerSettings.showHeader,
    readerSettings.textAlign,
    readerSettings.textDirection,
    readerSettings.verticalPadding,
    readerSettings.wrapMode,
    readerViewport.height,
    readerViewport.width,
    session?.filePath,
    session?.id,
    viewMode,
    zoom,
  ]);
  const epubMeasurementReady = measuredEpubPagination?.key === epubMeasurementKey
    && Array.isArray(measuredEpubPagination.pages)
    && measuredEpubPagination.pages.length > 0;
  const epubPages = epubMeasurementReady ? measuredEpubPagination.pages : estimatedEpubPages;
  const epubPageIndexByTarget = useMemo(() => {
    const pageIndexByTarget = new Map();
    epubPages.forEach((page, index) => {
      const entryName = page.name || '';
      const entryKey = epubTargetKey(entryName, '');
      if (entryKey && !pageIndexByTarget.has(entryKey)) pageIndexByTarget.set(entryKey, index);
      (page.blocks || []).forEach(block => {
        (block.anchors || []).forEach(anchor => {
          const key = epubTargetKey(entryName, anchor);
          if (key && !pageIndexByTarget.has(key)) pageIndexByTarget.set(key, index);
        });
      });
    });
    return pageIndexByTarget;
  }, [epubPages]);
  const flowItems = session?.type === 'comic'
    ? pages
    : session?.type === 'epub'
      ? epubPages
      : session?.type === 'text'
        ? textPages.map(text => ({ text }))
        : [];
  const pageCount = session?.type === 'pdf' ? pdfPageCount : flowItems.length;
  const currentPercent = flowMode === 'scroll'
    ? Math.round(scrollPercent)
    : pageCount > 0
      ? Math.round(((pageIndex + 1) / pageCount) * 100)
      : 0;
  const progressText = useMemo(() => {
    if (!session) return '';
    if (session.type === 'pdf') return pdfPageCount > 0 ? `${pageIndex + 1} / ${pdfPageCount} · PDF` : 'PDF';
    if (flowMode === 'scroll') return `${currentPercent}%`;
    return pageCount > 0 ? `${pageIndex + 1} / ${pageCount} · ${currentPercent}%` : session.type.toUpperCase();
  }, [currentPercent, flowMode, pageCount, pageIndex, pdfPageCount, session]);
  const hasPreviousBook = Boolean(session?.adjacent?.hasPrevious);
  const hasNextBook = Boolean(session?.adjacent?.hasNext);
  const comicSinglePageNameSet = useMemo(() => new Set(comicSinglePageNames), [comicSinglePageNames]);
  const isComicSinglePage = useCallback(index => {
    const page = pages[index];
    return Boolean(page?.name && comicSinglePageNameSet.has(page.name));
  }, [comicSinglePageNameSet, pages]);
  const showViewerToast = useCallback(message => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return;
    if (viewerToastTimerRef.current) {
      window.clearTimeout(viewerToastTimerRef.current);
      viewerToastTimerRef.current = null;
    }
    setViewerToast({ id: Date.now(), message: normalizedMessage });
    viewerToastTimerRef.current = window.setTimeout(() => {
      setViewerToast(null);
      viewerToastTimerRef.current = null;
    }, 3200);
  }, []);
  const showNextBookHint = useCallback(() => {
    if (!hasNextBook) return;
    showViewerToast(viewerText(
      'viewer.toast.next_book_hint',
      '마지막 페이지입니다. 다음장 입력을 한 번 더 하면 다음 파일이 열립니다.'
    ));
  }, [hasNextBook, showViewerToast, viewerLanguage]);
  const updateReaderSettings = patch => {
    if (patch?.pageEffect === 'page') {
      setFlowMode('spread');
      showViewerToast(viewerText(
        'viewer.toast.page_turn_effect_notice',
        '책넘김 효과는 두장보기모드만 지원하며, 엠비라이트 효과가 비활성화됩니다'
      ));
    }
    setReaderSettings(current => normalizeReaderSettings({ ...current, ...patch }));
  };
  const updateFlowMode = nextFlowMode => {
    setFlowMode(nextFlowMode);
    if (nextFlowMode !== 'spread' && readerSettings.pageEffect === 'page') {
      setReaderSettings(current => normalizeReaderSettings({ ...current, pageEffect: 'slide' }));
    }
  };
  const updateViewerBackground = patch => {
    setViewerBackground(current => normalizeViewerBackgroundSettings({ ...current, ...patch }));
  };
  const setZoomValue = useCallback(value => {
    setZoom(clamp(Number(value) || 100, ZOOM_MIN, ZOOM_MAX));
  }, []);
  const adjustZoom = useCallback(delta => {
    setZoom(current => clamp((Number(current) || 100) + delta, ZOOM_MIN, ZOOM_MAX));
  }, []);
  const createScrollZoomAnchor = useCallback(event => {
    const node = scrollRef.current;
    if (!node || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
    const rect = node.getBoundingClientRect();
    const offsetX = clamp(event.clientX - rect.left, 0, Math.max(0, node.clientWidth));
    const offsetY = clamp(event.clientY - rect.top, 0, Math.max(0, node.clientHeight));
    const targetSelector = zoomAnchorSelectorForTarget(event.target);
    const targetNode = targetSelector ? node.querySelector?.(targetSelector) : null;
    const targetRect = targetNode?.getBoundingClientRect?.();
    return {
      offsetX,
      offsetY,
      ratioX: (node.scrollLeft + offsetX) / Math.max(1, node.scrollWidth),
      ratioY: (node.scrollTop + offsetY) / Math.max(1, node.scrollHeight),
      target: targetSelector && targetRect
        ? {
          selector: targetSelector,
          ratioX: clamp((event.clientX - targetRect.left) / Math.max(1, targetRect.width), 0, 1),
          ratioY: clamp((event.clientY - targetRect.top) / Math.max(1, targetRect.height), 0, 1),
        }
        : null,
    };
  }, []);
  const restoreScrollZoomAnchor = useCallback(anchor => {
    if (!anchor) return;
    const sequence = scrollZoomAnchorSequenceRef.current + 1;
    scrollZoomAnchorSequenceRef.current = sequence;
    const applyAnchor = attempt => {
      if (scrollZoomAnchorSequenceRef.current !== sequence) return;
      const node = scrollRef.current;
      if (!node) return;
      const nextScrollWidth = Math.max(1, node.scrollWidth);
      const nextScrollHeight = Math.max(1, node.scrollHeight);
      const maxScrollLeft = Math.max(0, nextScrollWidth - node.clientWidth);
      const maxScrollTop = Math.max(0, nextScrollHeight - node.clientHeight);
      const viewportRect = node.getBoundingClientRect();
      const targetNode = anchor.target?.selector ? node.querySelector?.(anchor.target.selector) : null;
      const targetRect = targetNode?.getBoundingClientRect?.();
      if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
        node.scrollLeft = clamp(
          node.scrollLeft + targetRect.left - viewportRect.left + (anchor.target.ratioX * targetRect.width) - anchor.offsetX,
          0,
          maxScrollLeft
        );
        node.scrollTop = clamp(
          node.scrollTop + targetRect.top - viewportRect.top + (anchor.target.ratioY * targetRect.height) - anchor.offsetY,
          0,
          maxScrollTop
        );
      } else {
        node.scrollLeft = clamp((anchor.ratioX * nextScrollWidth) - anchor.offsetX, 0, maxScrollLeft);
        node.scrollTop = clamp((anchor.ratioY * nextScrollHeight) - anchor.offsetY, 0, maxScrollTop);
      }
      if (attempt < 8) window.requestAnimationFrame(() => applyAnchor(attempt + 1));
    };
    window.requestAnimationFrame(() => applyAnchor(0));
  }, []);
  const adjustZoomAtPoint = useCallback((delta, event) => {
    const anchor = createScrollZoomAnchor(event);
    adjustZoom(delta);
    restoreScrollZoomAnchor(anchor);
  }, [adjustZoom, createScrollZoomAnchor, restoreScrollZoomAnchor]);
  const handleZoomWheel = useCallback(event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.deltaY < 0) adjustZoom(ZOOM_STEP);
    else if (event.deltaY > 0) adjustZoom(-ZOOM_STEP);
  }, [adjustZoom]);
  const handleSlideNavWheel = useCallback(event => {
    event.preventDefault();
    event.stopPropagation();
    const wheelDelta = event.deltaY || event.deltaX;
    if (!wheelDelta) return;
    event.currentTarget.scrollBy({ left: wheelDelta, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) return undefined;
    const updateToolbarHeight = () => {
      setToolbarHeight(Math.max(42, Math.ceil(element.getBoundingClientRect().height || 42)));
    };
    updateToolbarHeight();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateToolbarHeight);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateToolbarHeight);
    return () => window.removeEventListener('resize', updateToolbarHeight);
  }, []);

  useEffect(() => {
    let mounted = true;
    const applyViewerLanguage = config => {
      const nextLanguage = setLanguage(config?.language || config?.lang || 'ko');
      if (mounted) {
        setViewerLanguage(current => current === nextLanguage ? current : nextLanguage);
      }
    };
    window.viewerAPI?.getConfig?.()
      .then(applyViewerLanguage)
      .catch(() => {});
    const unsubscribeConfig = window.viewerAPI?.onConfigChange?.(applyViewerLanguage);
    window.viewerAPI?.getFullscreenState?.()
      .then(state => {
        if (mounted && typeof state?.fullscreen === 'boolean') {
          setIsFullscreen(state.fullscreen);
        }
      })
      .catch(() => {});
    const unsubscribe = window.viewerAPI?.onFullscreenChange?.(state => {
      if (typeof state?.fullscreen === 'boolean') {
        setIsFullscreen(state.fullscreen);
      }
    });
    return () => {
      mounted = false;
      unsubscribeConfig?.();
      unsubscribe?.();
    };
  }, []);

  const persistState = useCallback((patch = {}) => {
    if (!session) return;
    const fileState = {
      pageIndex: 'pageIndex' in patch ? patch.pageIndex : pageIndex,
      scrollPercent: 'scrollPercent' in patch ? patch.scrollPercent : scrollPercent,
      pageCount: 'pageCount' in patch ? patch.pageCount : pageCount,
    };
    const viewerPrefs = {
      flowMode: 'flowMode' in patch ? patch.flowMode : flowMode,
      viewMode: 'viewMode' in patch ? patch.viewMode : viewMode,
      zoom: 'zoom' in patch ? patch.zoom : zoom,
      readingDirection: 'readingDirection' in patch ? patch.readingDirection : readingDirection,
      spreadCoverFirst: 'spreadCoverFirst' in patch ? patch.spreadCoverFirst : spreadCoverFirst,
      readerSettings: 'readerSettings' in patch ? patch.readerSettings : readerSettings,
      viewerBackground: 'viewerBackground' in patch ? patch.viewerBackground : viewerBackground,
      slideNavOpen: 'slideNavOpen' in patch ? patch.slideNavOpen : slideNavOpen,
    };
    saveJson(storageKey(session, 'state'), fileState);
    saveJson(viewerPrefsKey(session), viewerPrefs);
  }, [flowMode, pageCount, pageIndex, readerSettings, readingDirection, scrollPercent, session, slideNavOpen, spreadCoverFirst, viewMode, viewerBackground, zoom]);

  const persistScrollState = useCallback((nextScrollPercent, nextPageIndex) => {
    if (!session || flowMode !== 'scroll') return;
    const currentState = readJson(storageKey(session, 'state'), {});
    saveJson(storageKey(session, 'state'), {
      ...currentState,
      pageIndex: clamp(Number(nextPageIndex) || 0, 0, Math.max(0, pageCount - 1)),
      scrollPercent: clamp(Number(nextScrollPercent) || 0, 0, 100),
      pageCount,
    });
  }, [flowMode, pageCount, session]);

  const restoreSavedScrollPosition = useCallback((targetSession, rawScrollPercent) => {
    const targetPercent = clamp(Number(rawScrollPercent) || 0, 0, 100);
    if (!targetSession || targetPercent <= 0) return;
    const restoreToken = scrollRestoreTokenRef.current + 1;
    scrollRestoreTokenRef.current = restoreToken;
    const applyRestore = attempt => {
      if (scrollRestoreTokenRef.current !== restoreToken) return;
      const node = scrollRef.current;
      if (!node) {
        if (attempt < 24) window.requestAnimationFrame(() => applyRestore(attempt + 1));
        return;
      }
      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      if (maxScrollTop <= 0 && attempt < 24) {
        window.requestAnimationFrame(() => applyRestore(attempt + 1));
        return;
      }
      node.scrollTop = (maxScrollTop * targetPercent) / 100;
      if (attempt < 6) {
        window.requestAnimationFrame(() => applyRestore(attempt + 1));
      }
    };
    window.requestAnimationFrame(() => applyRestore(0));
  }, []);

  const clearDocumentFrame = useCallback(() => {
    documentAbortRef.current?.abort();
    documentAbortRef.current = null;
    pdfLoadingTaskRef.current?.destroy?.();
    pdfLoadingTaskRef.current = null;
    pdfDocumentRef.current?.destroy?.();
    pdfDocumentRef.current = null;
    pdfPendingScrollRef.current = null;
    setPdfDocument(null);
    setPdfPageCount(0);
  }, []);

  const resetPageModeScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    node.scrollLeft = 0;
  }, []);

  useEffect(() => {
    if (readerSettings.pageEffect !== 'page' || flowMode === 'spread') return;
    setFlowMode('spread');
    resetPageModeScroll();
    window.requestAnimationFrame(resetPageModeScroll);
  }, [flowMode, readerSettings.pageEffect, resetPageModeScroll]);

  const rememberComicPageImageSize = useCallback((pageName, naturalWidth, naturalHeight) => {
    const width = Math.max(1, Number(naturalWidth) || 0);
    const height = Math.max(1, Number(naturalHeight) || 0);
    if (!pageName || width <= 1 || height <= 1) return;
    const ratio = width / height;
    setPageRatios(prev => (prev[pageName] === ratio ? prev : {
      ...prev,
      [pageName]: ratio,
    }));
    setPageSizes(prev => {
      const current = prev[pageName];
      if (current?.width === width && current?.height === height) return prev;
      return {
        ...prev,
        [pageName]: { width, height },
      };
    });
  }, []);

  const clearPageTurnRuntime = useCallback(() => {
    if (pageTurnTimerRef.current) {
      window.clearTimeout(pageTurnTimerRef.current);
      pageTurnTimerRef.current = null;
    }
  }, []);

  const triggerTimedPageEffect = useCallback((format, targetIndex, currentIndex, onComplete, direction) => {
    if (flowMode === 'scroll' || readerSettings.pageEffect === 'none' || targetIndex === currentIndex) return false;
    if (readerSettings.pageEffect === 'page') {
      clearPageTurnRuntime();
      setPageTurn(current => current.active ? { ...EMPTY_PAGE_TURN, sequence: current.sequence } : current);
      return false;
    }
    clearPageTurnRuntime();
    const duration = PAGE_EFFECT_DURATIONS[readerSettings.pageEffect] || 190;
    setPageTurn(current => ({
      format,
      effect: readerSettings.pageEffect,
      direction: direction || getPageEffectDirection(targetIndex, currentIndex),
      sequence: current.sequence + 1,
      active: true,
      fromIndex: currentIndex,
      toIndex: targetIndex,
      progress: 1,
      duration,
    }));
    pageTurnTimerRef.current = window.setTimeout(() => {
      setPageTurn(current => current.active ? { ...EMPTY_PAGE_TURN, sequence: current.sequence } : current);
      pageTurnTimerRef.current = null;
    }, duration);
    return false;
  }, [clearPageTurnRuntime, flowMode, readerSettings.pageEffect]);

  const triggerReaderPageEffect = useCallback((targetIndex, currentIndex = pageIndex, onComplete) => {
    if (!isReaderDocument) return false;
    return triggerTimedPageEffect('reader', targetIndex, currentIndex, onComplete);
  }, [isReaderDocument, pageIndex, triggerTimedPageEffect]);

  const triggerComicPageEffect = useCallback((targetIndex, currentIndex = pageIndex, onComplete) => {
    if (session?.type !== 'comic') return false;
    if (targetIndex === currentIndex) return false;
    const pageEffectDirection = getPageEffectDirection(targetIndex, currentIndex);
    const visualEffectDirection = getReadingAdjustedPageEffectDirection(pageEffectDirection, readingDirection);
    if (readerSettings.pageEffect === 'page' && typeof loadComicPageRef.current === 'function') {
      loadComicPageRef.current(targetIndex);
      loadComicPageRef.current(targetIndex + 1);
      return false;
    }
    return triggerTimedPageEffect('comic', targetIndex, currentIndex, onComplete, visualEffectDirection);
  }, [pageIndex, readerSettings.pageEffect, readingDirection, session?.type, triggerTimedPageEffect]);

  const triggerPdfPageEffect = useCallback((targetIndex, currentIndex = pageIndex, onComplete) => {
    if (session?.type !== 'pdf') return false;
    return triggerTimedPageEffect('pdf', targetIndex, currentIndex, onComplete, getPageEffectDirection(targetIndex, currentIndex));
  }, [pageIndex, session?.type, triggerTimedPageEffect]);

  const scrollPdfPageIntoView = useCallback(index => {
    const targetIndex = Math.max(0, Number(index) || 0);
    window.requestAnimationFrame(() => {
      const pageNode = scrollRef.current?.querySelector?.(`[data-pdf-page-index="${targetIndex}"]`);
      pageNode?.scrollIntoView?.({ block: 'start' });
    });
  }, []);

  const goPdfPage = useCallback(index => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pdfPageCount - 1));
    const currentIndex = clamp(pageIndexRef.current, 0, Math.max(0, pdfPageCount - 1));
    pageIndexRef.current = targetIndex;
    const commitPdfPage = () => {
      setPageIndexSynced(targetIndex);
      if (flowMode === 'scroll') {
        scrollPdfPageIntoView(targetIndex);
        return;
      }
      resetPageModeScroll();
      window.requestAnimationFrame(resetPageModeScroll);
    };
    const deferred = triggerPdfPageEffect(targetIndex, currentIndex, commitPdfPage);
    if (deferred) return;
    commitPdfPage();
  }, [flowMode, pdfPageCount, resetPageModeScroll, scrollPdfPageIntoView, setPageIndexSynced, triggerPdfPageEffect]);
  const goPageIndex = useCallback(index => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pageCount - 1));
    if (session?.type === 'pdf') {
      goPdfPage(targetIndex);
      return;
    }
    const commitPageIndex = () => {
      setPageIndexSynced(targetIndex);
      if (session?.type === 'epub' || session?.type === 'text') {
        visibleReaderIndexRef.current = targetIndex;
      }
      const node = scrollRef.current;
      if (!node) return;
      if (flowMode === 'scroll') {
        const selector = session?.type === 'comic'
          ? `[data-page-index="${targetIndex}"]`
          : `[data-reader-index="${targetIndex}"]`;
        const targetNode = node.querySelector?.(selector);
        targetNode?.scrollIntoView?.({ block: 'start' });
        return;
      }
      node.scrollTo?.({ top: 0 });
    };
    const currentIndex = clamp(pageIndexRef.current, 0, Math.max(0, pageCount - 1));
    pageIndexRef.current = targetIndex;
    const deferred = triggerReaderPageEffect(targetIndex, currentIndex, () => {
      commitPageIndex();
      window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ top: 0 }));
    }) || triggerComicPageEffect(targetIndex, currentIndex, () => {
      commitPageIndex();
      window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ top: 0 }));
    });
    if (deferred) return;
    commitPageIndex();
  }, [flowMode, goPdfPage, pageCount, session?.type, setPageIndexSynced, triggerComicPageEffect, triggerReaderPageEffect]);

  useEffect(() => {
    if (flowMode !== 'scroll' && readerSettings.pageEffect === 'slide') return;
    clearPageTurnRuntime();
    setPageTurn(current => current.active ? { ...EMPTY_PAGE_TURN, sequence: current.sequence } : current);
  }, [clearPageTurnRuntime, flowMode, readerSettings.pageEffect, session?.type]);

  const loadSession = useCallback(async nextSession => {
    if (!nextSession) return;
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    const isCurrentLoad = () => loadSequenceRef.current === loadSequence;
    setSession(nextSession);
    setPages([]);
    setPageData({});
    setPageErrors({});
    setPageRatios({});
    setPageSizes({});
    clearDocumentFrame();
    setTextContent('');
    setEpubChapters([]);
    setEpubToc([]);
    setEpubMetadata({});
    setEpubStylesheet('');
    setMeasuredEpubPagination(null);
    setFontGroups(current => normalizeFontGroups({ ...current, epub: [] }));
    setPdfToc([]);
    setHighlights([]);
    setComicSinglePageNames([]);
    setSelectionMenu(null);
    setBookSearchQuery('');
    setBookSearchResults([]);
    setBookSearchLoading(false);
    setActiveSearch(null);
    setImageLightbox(null);
    if (viewerToastTimerRef.current) {
      window.clearTimeout(viewerToastTimerRef.current);
      viewerToastTimerRef.current = null;
    }
    setViewerToast(null);
    lastPageHintRef.current = '';
    setError('');
    setLoading(true);
    setScrollPercent(0);
    clearPageTurnRuntime();
    setPageTurn(EMPTY_PAGE_TURN);
    visibleReaderIndexRef.current = 0;
    loadingPagesRef.current.clear();
    scrollRestoreTokenRef.current += 1;
    scrollRef.current?.scrollTo?.({ top: 0 });

    const savedFileState = readJson(storageKey(nextSession, 'state'), {});
    const savedViewerPrefs = readJson(viewerPrefsKey(nextSession), {});
    const savedPrefs = { ...savedFileState, ...savedViewerPrefs };
    const savedPageIndex = Math.max(0, Number(savedFileState.pageIndex) || 0);
    setFlowMode(savedPrefs.flowMode || 'single');
    setViewMode(savedPrefs.viewMode || 'fit');
    setZoom(clamp(Number(savedPrefs.zoom) || 100, ZOOM_MIN, ZOOM_MAX));
    setReadingDirection(savedPrefs.readingDirection || 'ltr');
    setSpreadCoverFirst(savedPrefs.spreadCoverFirst !== false);
    setSlideNavOpen(savedPrefs.slideNavOpen !== false);
    setReaderSettings(normalizeReaderSettings(savedPrefs.readerSettings || {}));
    setViewerBackground(normalizeViewerBackgroundSettings(savedPrefs.viewerBackground || {}));
    setBookmarks(readJson(storageKey(nextSession, 'bookmarks'), []));
    setHighlights(readJson(storageKey(nextSession, 'highlights'), []));
    setComicSinglePageNames(nextSession.type === 'comic' ? readJson(storageKey(nextSession, 'comic-flow'), []) : []);
    setPageIndexSynced(savedPageIndex);

    try {
      if (nextSession.type === 'comic') {
        const result = await window.viewerAPI.listComicPages(nextSession.id);
        if (!isCurrentLoad()) return;
        const listedPages = Array.isArray(result) ? result : (result.pages || []);
        setPages(listedPages);
        setReadingDirection(savedPrefs.readingDirection || result.readingDirection || 'ltr');
        setPageIndexSynced(clamp(savedPageIndex, 0, Math.max(0, listedPages.length - 1)));
      } else if (nextSession.type === 'pdf') {
        const result = await window.viewerAPI.getDocumentData(nextSession.id);
        if (!isCurrentLoad()) return;
        const controller = new AbortController();
        documentAbortRef.current = controller;
        const response = await fetch(result.documentUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`PDF load failed: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        if (!isCurrentLoad()) return;
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          disableAutoFetch: true,
          disableStream: true,
        });
        pdfLoadingTaskRef.current = loadingTask;
        const loadedPdfDocument = await loadingTask.promise;
        pdfLoadingTaskRef.current = null;
        if (!isCurrentLoad()) {
          loadedPdfDocument.destroy?.();
          return;
        }
        const initialPageIndex = clamp(savedPageIndex, 0, Math.max(0, loadedPdfDocument.numPages - 1));
        pdfDocumentRef.current = loadedPdfDocument;
        pdfPendingScrollRef.current = initialPageIndex;
        setPdfDocument(loadedPdfDocument);
        setPdfPageCount(loadedPdfDocument.numPages);
        setPageIndexSynced(initialPageIndex);
      } else if (nextSession.type === 'epub') {
        const result = await window.viewerAPI.getEpubText(nextSession.id);
        if (!isCurrentLoad()) return;
        const epubFontNames = uniqueFontNames(Array.isArray(result.fonts) ? result.fonts : []);
        setFontGroups(current => normalizeFontGroups({ ...current, epub: epubFontNames }));
        const savedReaderSettings = normalizeReaderSettings(savedPrefs.readerSettings || {});
        const savedFontFamily = String(savedPrefs.readerSettings?.fontFamily || '').trim();
        if (epubFontNames.length > 0 && (!savedFontFamily || savedFontFamily === DEFAULT_READER_SETTINGS.fontFamily)) {
          setReaderSettings(normalizeReaderSettings({
            ...savedReaderSettings,
            fontFamily: epubFontNames[0],
          }));
        }
        setEpubChapters(Array.isArray(result.chapters) ? result.chapters : []);
        setEpubToc(Array.isArray(result.toc) ? result.toc : []);
        setEpubMetadata(result.metadata && typeof result.metadata === 'object' ? result.metadata : {});
        setEpubStylesheet(typeof result.stylesheet === 'string' ? result.stylesheet : '');
      } else if (nextSession.type === 'text') {
        const result = await window.viewerAPI.getText(nextSession.id, { encoding: 'auto' });
        if (!isCurrentLoad()) return;
        setTextContent(result.text || '');
      } else {
        setError(viewerText('viewer.common.unsupported_format', '지원하지 않는 형식입니다.'));
      }
      if (savedPrefs.flowMode === 'scroll') {
        restoreSavedScrollPosition(nextSession, savedFileState.scrollPercent);
      }
    } catch (loadError) {
      if (isCurrentLoad() && loadError?.name !== 'AbortError') {
        setError(loadError.message || String(loadError));
      }
    } finally {
      if (isCurrentLoad()) documentAbortRef.current = null;
      if (isCurrentLoad()) setLoading(false);
    }
  }, [clearDocumentFrame, clearPageTurnRuntime, restoreSavedScrollPosition, setPageIndexSynced]);

  const loadComicPage = useCallback(async (index, options = {}) => {
    if (!session || session.type !== 'comic' || index < 0 || index >= pages.length) return;
    const page = pages[index];
    if (!options.force && page?.pageUrl) return;
    if (!page || pageData[page.name] || loadingPagesRef.current.has(page.name)) return;
    loadingPagesRef.current.add(page.name);
    try {
      const result = await window.viewerAPI.getComicPage(session.id, page.name);
      setPageData(prev => ({ ...prev, [page.name]: result.dataUrl }));
      setPageErrors(prev => {
        if (!prev[page.name]) return prev;
        const next = { ...prev };
        delete next[page.name];
        return next;
      });
    } catch (pageError) {
      setPageErrors(prev => ({
        ...prev,
        [page.name]: pageError.message || String(pageError),
      }));
    } finally {
      loadingPagesRef.current.delete(page.name);
    }
  }, [pageData, pages, session]);

  loadComicPageRef.current = loadComicPage;

  useEffect(() => {
    window.viewerAPI?.getCurrentSession?.().then(loadSession).catch(() => {});
    const unsubscribe = window.viewerAPI?.onLoadSession?.(loadSession);
    window.viewerAPI?.listBundledFonts?.().then(bundled => {
      window.viewerAPI?.listSystemFonts?.().then(system => {
        const bundledNames = (bundled || []).map(font => font.family || font.name || font).filter(Boolean);
        const systemNames = (system || []).map(font => font.family || font.name || font).filter(Boolean);
        setFontGroups(current => normalizeFontGroups({
          ...current,
          bundled: uniqueFontNames([...bundledNames, ...(current.bundled || [])]).slice(0, 120),
          system: uniqueFontNames([...systemNames, ...(current.system || [])]).slice(0, 240),
        }));
      }).catch(() => {});
    }).catch(() => {});
    return () => unsubscribe?.();
  }, [loadSession]);

  useEffect(() => () => {
    clearPageTurnRuntime();
    if (viewerToastTimerRef.current) {
      window.clearTimeout(viewerToastTimerRef.current);
      viewerToastTimerRef.current = null;
    }
    clearDocumentFrame();
  }, [clearDocumentFrame, clearPageTurnRuntime]);

  useEffect(() => {
    if (session?.type !== 'pdf' || !pdfDocument || pdfPageCount <= 0) return;
    if (pdfPendingScrollRef.current == null) return;
    const pendingPageIndex = pdfPendingScrollRef.current;
    pdfPendingScrollRef.current = null;
    scrollPdfPageIntoView(pendingPageIndex);
  }, [pdfDocument, pdfPageCount, scrollPdfPageIntoView, session?.type]);

  useEffect(() => {
    if (session?.type !== 'pdf' || !pdfDocument) {
      setPdfToc([]);
      return undefined;
    }
    let canceled = false;
    const loadOutline = async () => {
      try {
        const outline = await pdfDocument.getOutline();
        if (!Array.isArray(outline) || canceled) {
          if (!canceled) setPdfToc([]);
          return;
        }
        const resolveDestinationPage = async dest => {
          try {
            const destination = typeof dest === 'string'
              ? await pdfDocument.getDestination(dest)
              : dest;
            const pageRef = Array.isArray(destination) ? destination[0] : null;
            if (!pageRef) return null;
            const resolvedIndex = await pdfDocument.getPageIndex(pageRef);
            return Number.isFinite(resolvedIndex) ? resolvedIndex : null;
          } catch {
            return null;
          }
        };
        const flattenOutline = async (items, depth = 0) => {
          const flattened = [];
          for (const item of items || []) {
            const pageIndexForItem = await resolveDestinationPage(item.dest);
            flattened.push({
              id: `${depth}-${flattened.length}-${item.title || ''}`,
              title: item.title || viewerText('viewer.common.untitled', '제목 없음'),
              pageIndex: pageIndexForItem,
              depth,
            });
            if (Array.isArray(item.items) && item.items.length > 0) {
              flattened.push(...await flattenOutline(item.items, depth + 1));
            }
          }
          return flattened;
        };
        const flattened = await flattenOutline(outline);
        if (!canceled) setPdfToc(flattened.filter(item => Number.isInteger(item.pageIndex)));
      } catch {
        if (!canceled) setPdfToc([]);
      }
    };
    loadOutline();
    return () => {
      canceled = true;
    };
  }, [pdfDocument, session?.type]);

  useEffect(() => {
    const updateViewport = () => {
      const node = scrollRef.current;
      if (!node) return;
      setReaderViewport({
        width: node.clientWidth || 900,
        height: node.clientHeight || 700,
      });
    };
    updateViewport();
    const node = scrollRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && node
      ? new ResizeObserver(updateViewport)
      : null;
    observer?.observe(node);
    window.addEventListener('resize', updateViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [session?.type]);

  useEffect(() => {
    setReaderPageFitScale(READER_PAGE_FIT_SCALE_DEFAULT);
  }, [
    epubChapters,
    flowMode,
    readerSettings.fontFamily,
    readerSettings.fontScale,
    readerSettings.horizontalPadding,
    readerSettings.letterSpacing,
    readerSettings.lineHeightPercent,
    readerSettings.paragraphSpacing,
    readerSettings.showFooter,
    readerSettings.showHeader,
    readerSettings.textAlign,
    readerSettings.textDirection,
    readerSettings.verticalPadding,
    readerSettings.wrapMode,
    readerViewport.height,
    readerViewport.width,
    session?.id,
    session?.type,
    viewMode,
    zoom,
  ]);

  useEffect(() => {
    if (measuredEpubPagination?.key && measuredEpubPagination.key !== epubMeasurementKey) {
      setMeasuredEpubPagination(null);
    }
  }, [epubMeasurementKey, measuredEpubPagination?.key]);

  useLayoutEffect(() => {
    if (
      session?.type !== 'epub'
      || flowMode === 'scroll'
      || epubMeasurementReady
      || epubMeasurementBlocks.length < 1
    ) {
      return undefined;
    }
    let canceled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const measureActualReaderBlocks = () => {
      if (canceled) return;
      const root = readerMeasureRef.current;
      const body = root?.querySelector?.('.viewer-reader-page-body');
      if (!root || !body) return;
      const bodyRect = body.getBoundingClientRect?.();
      if (!bodyRect || bodyRect.height <= 0) return;
      const headerNode = root.querySelector('[data-reader-measure-header]');
      const headerRect = headerNode?.getBoundingClientRect?.();
      const headerStyle = headerNode ? window.getComputedStyle(headerNode) : null;
      const headerHeight = headerRect
        ? headerRect.height
          + (Number.parseFloat(headerStyle?.marginTop || '0') || 0)
          + (Number.parseFloat(headerStyle?.marginBottom || '0') || 0)
        : 0;
      const pageContentHeight = Math.max(
        readerPageMetrics.lineAdvance * 4,
        bodyRect.height - headerHeight - READER_PAGE_BOTTOM_GUARD,
      );
      const measurements = [...root.querySelectorAll('[data-reader-measure-block-index]')]
        .map(node => {
          const index = Number(node.dataset.readerMeasureBlockIndex);
          const rect = node.getBoundingClientRect?.();
          if (!Number.isInteger(index) || !rect || rect.height <= 0) return null;
          const style = window.getComputedStyle(node);
          const marginTop = Number.parseFloat(style.marginTop || '0') || 0;
          const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0;
          return {
            index,
            firstHeight: rect.height + marginBottom,
            outerHeight: rect.height + marginTop + marginBottom,
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.index - right.index);
      if (measurements.length < 1) return;
      const nextPages = buildMeasuredReaderPages(epubMeasurementBlocks, measurements, { pageContentHeight });
      if (nextPages.length < 1) return;
      setMeasuredEpubPagination(current => {
        if (current?.key === epubMeasurementKey && current.pages?.length === nextPages.length) return current;
        return { key: epubMeasurementKey, pages: nextPages };
      });
    };
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(measureActualReaderBlocks);
    });
    return () => {
      canceled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    epubMeasurementBlocks,
    epubMeasurementKey,
    epubMeasurementReady,
    flowMode,
    readerPageMetrics.lineAdvance,
    session?.type,
  ]);

  useLayoutEffect(() => {
    if (session?.type !== 'epub' || flowMode === 'scroll' || epubMeasurementReady || epubPages.length < 1) return undefined;
    let canceled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const measureRenderedPages = () => {
      if (canceled) return;
      const renderedPages = visibleRenderedEpubPages(scrollRef.current);
      if (renderedPages.length < 1) return;
      const pageUsages = renderedPages.map(pageNode => ({
        pageNode,
        sourceIndex: Number(pageNode.dataset.readerPageIndex),
        usage: readerPageNodeRenderUsage(pageNode, readerSettings.textDirection),
      }));
      const hasOverflow = pageUsages.some(entry => entry.usage.overflow);
      const hasRecoverableUnderfill = !hasOverflow && readerPageFitScale < READER_PAGE_FIT_SCALE_MAX && pageUsages.some(entry => {
        if (!Number.isInteger(entry.sourceIndex)) return false;
        if (entry.usage.fillRatio >= READER_RENDER_UNDERFILL_THRESHOLD) return false;
        const page = epubPages[entry.sourceIndex];
        const nextPage = epubPages[entry.sourceIndex + 1];
        if (!page || !nextPage || page.standaloneImage) return false;
        if (page.chapterIndex != null && nextPage.chapterIndex != null) {
          return page.chapterIndex === nextPage.chapterIndex;
        }
        return Boolean(page.name && nextPage.name && page.name === nextPage.name);
      });
      if (!hasOverflow && !hasRecoverableUnderfill) return;
      setReaderPageFitScale(current => {
        if (hasOverflow) {
          const nextScale = Math.max(READER_PAGE_FIT_SCALE_MIN, Number((current * READER_PAGE_FIT_SCALE_STEP).toFixed(3)));
          return nextScale < current ? nextScale : current;
        }
        const nextScale = Math.min(READER_PAGE_FIT_SCALE_MAX, Number((current * READER_PAGE_FIT_SCALE_RECOVERY_STEP).toFixed(3)));
        return nextScale > current ? nextScale : current;
      });
    };
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(measureRenderedPages);
    });
    return () => {
      canceled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    epubPages,
    epubMeasurementReady,
    flowMode,
    readerPageFitScale,
    readerSettings.textDirection,
    session?.type,
  ]);

  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) {
      setPageIndexSynced(pageCount - 1);
    }
  }, [pageCount, pageIndex, setPageIndexSynced]);

  useEffect(() => {
    if (!selectionMenu) return undefined;
    const closeSelectionMenu = event => {
      if (event.target?.closest?.('.viewer-context-menu')) return;
      setSelectionMenu(null);
    };
    document.addEventListener('pointerdown', closeSelectionMenu);
    return () => document.removeEventListener('pointerdown', closeSelectionMenu);
  }, [selectionMenu]);

  useEffect(() => {
    if (!imageLightbox) return undefined;
    const handleImageLightboxKeyDown = event => {
      if (event.key === 'Escape') setImageLightbox(null);
    };
    document.addEventListener('keydown', handleImageLightboxKeyDown);
    return () => document.removeEventListener('keydown', handleImageLightboxKeyDown);
  }, [imageLightbox]);

  useEffect(() => {
    if (!session || session.type !== 'comic' || pages.length === 0) return;
    loadComicPage(pageIndex);
    loadComicPage(pageIndex + 1);
    if (flowMode === 'scroll') {
      for (let index = pageIndex; index < Math.min(pageIndex + 8, pages.length); index += 1) {
        loadComicPage(index);
      }
    }
  }, [flowMode, loadComicPage, pageIndex, pages.length, session]);

  useEffect(() => {
    persistState();
  }, [persistState]);

  const moveAdjacentBook = useCallback(async direction => {
    const hasAdjacentBook = Number(direction) < 0 ? hasPreviousBook : hasNextBook;
    if (!session || !hasAdjacentBook || adjacentLoadingRef.current) return;
    adjacentLoadingRef.current = true;
    setAdjacentLoading(true);
    try {
      const result = await window.viewerAPI.openAdjacent(session.id, direction);
      if (result?.session) await loadSession(result.session);
    } catch (adjacentError) {
      const message = adjacentError.message || String(adjacentError);
      if (message === 'No adjacent book.') return;
      setError(message);
    } finally {
      adjacentLoadingRef.current = false;
      setAdjacentLoading(false);
    }
  }, [hasNextBook, hasPreviousBook, loadSession, session]);

  const getStepSizeForIndex = useCallback(index => {
    if (flowMode !== 'spread') return 1;
    if (session?.type !== 'comic') return 2;
    if (spreadCoverFirst && index === 0) return 1;
    if (isComicSinglePage(index) || isComicSinglePage(index + 1)) return 1;
    const current = pages[index];
    if (!current || (pageRatios[current.name] || 0) > 1) return 1;
    const next = pages[index + 1];
    if (!next || (pageRatios[next.name] || 0) > 1) return 1;
    return 2;
  }, [flowMode, isComicSinglePage, pageRatios, pages, session?.type, spreadCoverFirst]);

  const isForwardBoundaryIndex = useCallback(index => {
    if (pageCount <= 0) return false;
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pageCount - 1));
    if (flowMode !== 'spread') return targetIndex >= pageCount - 1;
    if (session?.type === 'comic') {
      const current = pages[targetIndex];
      if (!current) return targetIndex >= pageCount - 1;
      if (spreadCoverFirst && targetIndex === 0) return pageCount <= 1;
      if (isComicSinglePage(targetIndex) || isComicSinglePage(targetIndex + 1)) return targetIndex >= pageCount - 1;
      const currentRatio = pageRatios[current.name] || 0;
      if (currentRatio > 1) return targetIndex >= pageCount - 1;
      const next = pages[targetIndex + 1];
      const nextRatio = next ? (pageRatios[next.name] || 0) : 0;
      return targetIndex >= pageCount - 1 || Boolean(next && nextRatio <= 1 && targetIndex + 1 >= pageCount - 1);
    }
    return targetIndex >= Math.max(0, pageCount - 2);
  }, [flowMode, isComicSinglePage, pageCount, pageRatios, pages, session?.type, spreadCoverFirst]);

  useEffect(() => {
    if (!session || !hasNextBook || pageCount <= 0 || flowMode === 'scroll') return;
    const hintKey = `${session.id || session.filePath || ''}:${flowMode}:${pageCount}`;
    if (isForwardBoundaryIndex(pageIndex)) {
      if (lastPageHintRef.current !== hintKey) {
        lastPageHintRef.current = hintKey;
        showNextBookHint();
      }
      return;
    }
    if (lastPageHintRef.current === hintKey) lastPageHintRef.current = '';
  }, [flowMode, hasNextBook, isForwardBoundaryIndex, pageCount, pageIndex, session, showNextBookHint]);

  const resolveSpreadNavigationIndex = useCallback(targetPageIndex => {
    const targetIndex = clamp(Number(targetPageIndex) || 0, 0, Math.max(0, pageCount - 1));
    if (flowMode !== 'spread' || pageCount <= 1) return targetIndex;
    let startIndex = 0;
    while (startIndex < targetIndex) {
      const stepSize = session?.type === 'comic' ? getStepSizeForIndex(startIndex) : 2;
      const nextStartIndex = startIndex + Math.max(1, stepSize);
      if (targetIndex < nextStartIndex) return startIndex;
      if (nextStartIndex <= startIndex || nextStartIndex >= pageCount) break;
      startIndex = nextStartIndex;
    }
    return targetIndex;
  }, [flowMode, getStepSizeForIndex, pageCount, session?.type]);

  const movePage = useCallback(delta => {
    const currentIndex = clamp(pageIndexRef.current, 0, Math.max(0, pageCount - 1));
    if (delta > 0 && pageCount > 0 && flowMode !== 'scroll' && isForwardBoundaryIndex(currentIndex)) {
      moveAdjacentBook(1);
      return;
    }
    if (session?.type === 'pdf') {
      const size = flowMode === 'spread' ? 2 : 1;
      const nextIndex = clamp(currentIndex + (delta > 0 ? size : -size), 0, Math.max(0, pageCount - 1));
      if (nextIndex === currentIndex) return;
      goPdfPage(nextIndex);
      return;
    }
    if (flowMode === 'scroll') {
      const node = scrollRef.current;
      if (node) {
        const atScrollEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
        if (delta > 0 && atScrollEnd) {
          moveAdjacentBook(1);
          return;
        }
        node.scrollBy({ top: delta > 0 ? node.clientHeight * 0.85 : -node.clientHeight * 0.85, behavior: 'auto' });
        if (delta > 0 && hasNextBook) {
          window.requestAnimationFrame(() => {
            if (node.scrollTop + node.clientHeight >= node.scrollHeight - 2) showNextBookHint();
          });
        }
      }
      return;
    }
    const size = flowMode === 'spread' ? getStepSizeForIndex(currentIndex) : 1;
    const nextIndex = clamp(currentIndex + (delta > 0 ? size : -size), 0, Math.max(0, pageCount - 1));
    if (nextIndex === currentIndex) return;
    pageIndexRef.current = nextIndex;
    const commitPageIndex = () => {
      setPageIndexSynced(nextIndex);
      if (session?.type === 'epub' || session?.type === 'text') {
        visibleReaderIndexRef.current = nextIndex;
      }
      resetPageModeScroll();
      window.requestAnimationFrame(resetPageModeScroll);
    };
    const deferred = triggerReaderPageEffect(nextIndex, currentIndex, commitPageIndex)
      || triggerComicPageEffect(nextIndex, currentIndex, commitPageIndex);
    if (deferred) return;
    commitPageIndex();
  }, [flowMode, getStepSizeForIndex, goPdfPage, hasNextBook, isForwardBoundaryIndex, moveAdjacentBook, pageCount, resetPageModeScroll, session?.type, setPageIndexSynced, showNextBookHint, triggerComicPageEffect, triggerReaderPageEffect]);

  const handleFlipBookPageIndexChange = useCallback(nextIndex => {
    if (flowMode === 'scroll' || pageCount <= 0) return;
    const normalizedIndex = clamp(Number(nextIndex) || 0, 0, Math.max(0, pageCount - 1));
    if (pageIndexRef.current === normalizedIndex) return;
    setPageIndexSynced(normalizedIndex);
    if (session?.type === 'epub' || session?.type === 'text') {
      visibleReaderIndexRef.current = normalizedIndex;
    }
    resetPageModeScroll();
  }, [flowMode, pageCount, resetPageModeScroll, session?.type, setPageIndexSynced]);

  const getFlipBookPageSize = useCallback((slots = 1, minimumWidth = 180) => {
    const normalizedSlots = Math.max(1, Number(slots) || 1);
    const width = Math.max(
      minimumWidth,
      Math.floor(((Number(readerViewport.width) || 900) - (READER_STAGE_PADDING * 2)) / normalizedSlots),
    );
    const height = Math.max(
      260,
      Math.floor((Number(readerViewport.height) || 700) - (READER_STAGE_PADDING * 2)),
    );
    return { width, height };
  }, [readerViewport.height, readerViewport.width]);

  const addBookmark = useCallback(() => {
    if (!session) return;
    const bookmarkPageIndex = flowMode === 'scroll' && (session.type === 'epub' || session.type === 'text')
      ? clamp(visibleReaderIndexRef.current, 0, Math.max(0, pageCount - 1))
      : pageIndex;
    const visibleText = session.type === 'comic'
      ? pages[bookmarkPageIndex]?.basename || `Page ${bookmarkPageIndex + 1}`
      : splitSentences(
          session.type === 'epub'
            ? epubPages[bookmarkPageIndex]?.text || ''
            : session.type === 'text'
              ? textPages[bookmarkPageIndex] || ''
              : session.fileName,
        )[0] || session.fileName;
    const bookmark = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageIndex: bookmarkPageIndex,
      scrollPercent,
      flowMode,
      label: session.type === 'comic' || session.type === 'pdf'
        ? `${bookmarkPageIndex + 1}p - ${visibleText}`
        : visibleText.slice(0, 80),
      createdAt: new Date().toLocaleString(),
    };
    const next = [bookmark, ...bookmarks].slice(0, 30);
    setBookmarks(next);
    saveJson(storageKey(session, 'bookmarks'), next);
  }, [bookmarks, epubPages, flowMode, pageCount, pageIndex, pages, scrollPercent, session, textPages]);

  const deleteBookmark = id => {
    if (!session) return;
    const next = bookmarks.filter(bookmark => bookmark.id !== id);
    setBookmarks(next);
    saveJson(storageKey(session, 'bookmarks'), next);
  };

  const clearBookmarks = () => {
    if (!session) return;
    setBookmarks([]);
    saveJson(storageKey(session, 'bookmarks'), []);
  };

  const goBookmark = bookmark => {
    const targetPageIndex = clamp(Number(bookmark.pageIndex) || 0, 0, Math.max(0, pageCount - 1));
    if (session?.type === 'pdf') {
      goPdfPage(targetPageIndex);
      setBookmarkMenuOpen(false);
      return;
    }
    setFlowMode(bookmark.flowMode || flowMode);
    setPageIndexSynced(targetPageIndex);
    window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node && bookmark.flowMode === 'scroll') {
        node.scrollTop = ((node.scrollHeight - node.clientHeight) * (Number(bookmark.scrollPercent) || 0)) / 100;
      } else {
        node?.scrollTo?.({ top: 0 });
      }
    });
    setBookmarkMenuOpen(false);
  };

  const tocItems = useMemo(() => {
    if (session?.type === 'pdf') return pdfToc;
    if (session?.type === 'epub') {
      const pageIndexByChapterIndex = new Map();
      epubPages.forEach((page, index) => {
        if (Number.isInteger(page.chapterIndex) && !pageIndexByChapterIndex.has(page.chapterIndex)) {
          pageIndexByChapterIndex.set(page.chapterIndex, index);
        }
      });
      const sourceToc = epubToc.length > 0
        ? epubToc
        : epubChapters.map((chapter, index) => ({
          id: `epub-chapter-${index}`,
          title: chapter.title || chapter.name || `Page ${index + 1}`,
          chapterIndex: index,
        }));
      return sourceToc
        .map((item, index) => ({
          id: item.id || `epub-toc-${index}`,
          title: item.title || `Page ${index + 1}`,
          entryName: item.entryName || '',
          anchor: item.anchor || '',
          pageIndex: epubPageIndexByTarget.get(epubTargetKey(item.entryName, item.anchor || ''))
            ?? pageIndexByChapterIndex.get(item.chapterIndex),
          depth: item.depth || 0,
        }))
        .filter(item => Number.isInteger(item.pageIndex));
    }
    if (session?.type === 'text') {
      return textPages
        .map((text, index) => {
          const firstLine = String(text || '').split(/\n+/).map(line => line.trim()).find(Boolean);
          if (!firstLine || firstLine.length > 80) return null;
          return {
            id: `text-toc-${index}`,
            title: firstLine,
            pageIndex: index,
            depth: 0,
          };
        })
        .filter(Boolean)
        .slice(0, 80);
    }
    return [];
  }, [epubChapters, epubPageIndexByTarget, epubPages, epubToc, pdfToc, session?.type, textPages]);

  const activeTocId = useMemo(() => {
    if (tocItems.length === 0) return '';
    const currentPageIndex = clamp(pageIndex, 0, Math.max(0, pageCount - 1));
    const sortedItems = [...tocItems]
      .filter(item => Number.isFinite(Number(item.pageIndex)))
      .sort((a, b) => Number(a.pageIndex) - Number(b.pageIndex));
    let activeItem = sortedItems[0];
    for (const item of sortedItems) {
      if (Number(item.pageIndex) > currentPageIndex) break;
      activeItem = item;
    }
    return activeItem?.id || '';
  }, [pageCount, pageIndex, tocItems]);

  const navigationThumbnailSrc = useMemo(() => {
    if (session?.type === 'comic') {
      const firstPage = pages[0];
      return firstPage ? pageData[firstPage.name] || firstPage.pageUrl || '' : '';
    }
    if (session?.type === 'epub') {
      return firstImageSrcFromReaderBlocks(epubChapters.flatMap(chapter => chapter.blocks || []));
    }
    return '';
  }, [epubChapters, pageData, pages, session?.type]);

  const navigationAuthor = session?.type === 'epub' ? epubMetadata.author || '' : '';

  const performBookSearch = useCallback(async query => {
    const trimmedQuery = String(query || '').trim();
    setBookSearchQuery(trimmedQuery);
    setNavigationTab('search');
    setActiveSearch(null);
    if (!trimmedQuery || !session) {
      setBookSearchResults([]);
      return;
    }
    setBookSearchLoading(true);
    try {
      const nextResults = [];
      if (session.type === 'pdf' && pdfDocument) {
        for (let number = 1; number <= pdfPageCount; number += 1) {
          const page = await pdfDocument.getPage(number);
          const textContentForPage = await page.getTextContent();
          const text = textContentForPage.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
          collectExactMatches(text, trimmedQuery).forEach(matchIndex => {
            nextResults.push({
              id: `pdf-search-${number}-${matchIndex}`,
              pageIndex: number - 1,
              text: trimmedQuery,
              snippet: snippetForMatch(text, matchIndex, trimmedQuery.length),
            });
          });
          if (nextResults.length >= 200) break;
        }
      } else if (session.type === 'epub' || session.type === 'text') {
        const readerItems = session.type === 'epub'
          ? epubPages
          : textPages.map(text => ({ text }));
        readerItems.forEach((item, index) => {
          const text = plainTextFromReaderItem(item).replace(/\s+/g, ' ').trim();
          collectExactMatches(text, trimmedQuery).forEach(matchIndex => {
            nextResults.push({
              id: `${session.type}-search-${index}-${matchIndex}`,
              pageIndex: index,
              text: trimmedQuery,
              snippet: snippetForMatch(text, matchIndex, trimmedQuery.length),
            });
          });
        });
      }
      setBookSearchResults(nextResults.slice(0, 200));
    } catch {
      setBookSearchResults([]);
    } finally {
      setBookSearchLoading(false);
    }
  }, [epubPages, pdfDocument, pdfPageCount, session, textPages]);

  const goEpubInternalTarget = useCallback(target => {
    if (session?.type !== 'epub' || !target) return;
    const entryName = target.entryName || '';
    const anchor = target.anchor || '';
    const targetKey = epubTargetKey(entryName, anchor);
    const entryKey = epubTargetKey(entryName, '');
    const resolvedPageIndex = epubPageIndexByTarget.get(targetKey) ?? epubPageIndexByTarget.get(entryKey);
    if (!Number.isInteger(resolvedPageIndex)) return;
    goPageIndex(resolveSpreadNavigationIndex(resolvedPageIndex));
    if (flowMode !== 'scroll' || !anchor) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const escapedAnchor = String(anchor).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const anchorNode = scrollRef.current?.querySelector?.(`[data-epub-anchor="${escapedAnchor}"]`);
        anchorNode?.scrollIntoView?.({ block: 'start' });
      });
    });
  }, [epubPageIndexByTarget, flowMode, goPageIndex, resolveSpreadNavigationIndex, session?.type]);

  const goNavigationPage = useCallback(targetPageIndex => {
    if (session?.type === 'epub' && targetPageIndex && typeof targetPageIndex === 'object' && targetPageIndex.entryName) {
      goEpubInternalTarget(targetPageIndex);
      return;
    }
    const rawPageIndex = targetPageIndex && typeof targetPageIndex === 'object'
      ? targetPageIndex.pageIndex
      : targetPageIndex;
    const resolvedPageIndex = clamp(Number(rawPageIndex) || 0, 0, Math.max(0, pageCount - 1));
    goPageIndex(resolveSpreadNavigationIndex(resolvedPageIndex));
  }, [goEpubInternalTarget, goPageIndex, pageCount, resolveSpreadNavigationIndex, session?.type]);

  const goSlideNavPage = useCallback(targetPageIndex => {
    const resolvedPageIndex = clamp(Number(targetPageIndex) || 0, 0, Math.max(0, pageCount - 1));
    goPageIndex(resolveSpreadNavigationIndex(resolvedPageIndex));
  }, [goPageIndex, pageCount, resolveSpreadNavigationIndex]);

  const goSearchResult = useCallback(result => {
    goNavigationPage(result.pageIndex);
    setActiveSearch({ pageIndex: result.pageIndex, text: result.text });
  }, [goNavigationPage]);

  const saveHighlights = useCallback(nextHighlights => {
    setHighlights(nextHighlights);
    saveJson(storageKey(session, 'highlights'), nextHighlights);
  }, [session]);

  const addHighlightFromSelection = useCallback(() => {
    if (!session || !selectionMenu?.text) return;
    const highlight = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: selectionMenu.text,
      pageIndex: selectionMenu.pageIndex,
      snippet: selectionMenu.snippet || selectionMenu.text,
      createdAt: new Date().toLocaleString(),
    };
    saveHighlights([highlight, ...highlights].slice(0, 300));
    setNavigationTab('highlights');
    setNavigationPanelOpen(true);
    setSelectionMenu(null);
    window.getSelection?.()?.removeAllRanges?.();
  }, [highlights, saveHighlights, selectionMenu, session]);

  const toggleComicSinglePageFromSelection = useCallback(() => {
    if (!session || session.type !== 'comic' || selectionMenu?.kind !== 'comic-flow') return;
    const targetPage = pages[selectionMenu.pageIndex];
    if (!targetPage?.name) return;
    setComicSinglePageNames(current => {
      const currentSet = new Set(current);
      if (currentSet.has(targetPage.name)) currentSet.delete(targetPage.name);
      else currentSet.add(targetPage.name);
      const next = [...currentSet];
      saveJson(storageKey(session, 'comic-flow'), next);
      return next;
    });
    setPageIndexSynced(selectionMenu.pageIndex);
    pageIndexRef.current = selectionMenu.pageIndex;
    resetPageModeScroll();
    window.requestAnimationFrame(resetPageModeScroll);
    setSelectionMenu(null);
  }, [pages, resetPageModeScroll, selectionMenu, session, setPageIndexSynced]);

  const deleteHighlight = useCallback(id => {
    saveHighlights(highlights.filter(highlight => highlight.id !== id));
  }, [highlights, saveHighlights]);

  const goHighlight = useCallback(highlight => {
    goNavigationPage(highlight.pageIndex);
    setActiveSearch({ pageIndex: highlight.pageIndex, text: highlight.text });
  }, [goNavigationPage]);

  const openNavigationSearch = useCallback(() => {
    if (!supportsNavigationPanel) return false;
    setNavigationPanelOpen(true);
    setNavigationTab('search');
    window.requestAnimationFrame(() => {
      navigationSearchInputRef.current?.focus?.();
      navigationSearchInputRef.current?.select?.();
    });
    return true;
  }, [supportsNavigationPanel]);

  const openNavigationToc = useCallback(() => {
    if (!supportsNavigationPanel) return false;
    setNavigationPanelOpen(true);
    setNavigationTab('toc');
    return true;
  }, [supportsNavigationPanel]);

  const openImageLightbox = useCallback(image => {
    if (!image?.src) return;
    setImageLightbox({
      src: image.src,
      alt: image.alt || '',
    });
  }, []);

  const openExternalLink = useCallback(async url => {
    const safeUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(safeUrl)) return;
    try {
      if (typeof window.viewerAPI?.openExternal === 'function') {
        await window.viewerAPI.openExternal(safeUrl);
        return;
      }
      if (window.confirm(viewerText('viewer.link.open_external_confirm', '브라우저에서 외부 링크를 열까요?', { url: safeUrl }))) {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showViewerToast(viewerText('viewer.link.open_external_failed', '외부 링크를 열 수 없습니다.'));
    }
  }, [showViewerToast]);

  const isViewerInteractiveTarget = useCallback(target => {
    const targetName = target?.tagName?.toLowerCase();
    if (['input', 'select', 'textarea', 'button', 'a'].includes(targetName)) return true;
    if (target?.isContentEditable) return true;
    return Boolean(target?.closest?.(
      '.viewer-toolbar, .viewer-slide-nav, .viewer-dropdown, .viewer-bookmark-menu, .viewer-modal-backdrop, .viewer-image-lightbox-backdrop, .viewer-settings-panel, .viewer-navigation-panel, .viewer-context-menu, .viewer-zoom-menu'
    ));
  }, []);

  const isViewerShortcutBlockedTarget = useCallback(target => {
    const targetName = target?.tagName?.toLowerCase();
    if (['input', 'select', 'textarea'].includes(targetName)) return true;
    if (target?.isContentEditable) return true;
    return Boolean(target?.closest?.(
      '[contenteditable="true"], [role="textbox"], .viewer-slide-nav, .viewer-dropdown-menu, .viewer-bookmark-menu, .viewer-modal-backdrop, .viewer-image-lightbox-backdrop, .viewer-settings-panel, .viewer-navigation-panel, .viewer-context-menu, .viewer-zoom-menu'
    ));
  }, []);

  const handleContentContextMenu = useCallback(event => {
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      event.preventDefault();
      return;
    }
    if (isViewerInteractiveTarget(event.target)) return;
    if (session?.type === 'comic' && flowMode === 'spread') {
      const pageNode = event.target?.closest?.('[data-page-index]');
      const rawPageIndex = pageNode?.getAttribute?.('data-page-index');
      const selectedPageIndex = Number(rawPageIndex);
      const selectedPage = Number.isFinite(selectedPageIndex) ? pages[selectedPageIndex] : null;
      if (!selectedPage) return;
      event.preventDefault();
      setSelectionMenu({
        kind: 'comic-flow',
        x: event.clientX,
        y: event.clientY,
        pageIndex: clamp(selectedPageIndex, 0, Math.max(0, pageCount - 1)),
        pageName: selectedPage.name,
        isSinglePage: isComicSinglePage(selectedPageIndex),
      });
      return;
    }
    if (!(session?.type === 'epub' || session?.type === 'text' || session?.type === 'pdf')) return;
    const selectedText = String(window.getSelection?.()?.toString?.() || '').replace(/\s+/g, ' ').trim();
    if (!selectedText) {
      setSelectionMenu(null);
      return;
    }
    event.preventDefault();
    const pageNode = event.target?.closest?.('[data-reader-page-index], [data-reader-index], [data-pdf-page-index]');
    const rawPageIndex = pageNode?.getAttribute?.('data-reader-page-index')
      ?? pageNode?.getAttribute?.('data-reader-index')
      ?? pageNode?.getAttribute?.('data-pdf-page-index');
    const selectedPageIndex = Number.isFinite(Number(rawPageIndex))
      ? Number(rawPageIndex)
      : pageIndex;
    setSelectionMenu({
      x: event.clientX,
      y: event.clientY,
      text: selectedText,
      pageIndex: clamp(selectedPageIndex, 0, Math.max(0, pageCount - 1)),
      snippet: selectedText.slice(0, 120),
    });
  }, [flowMode, isComicSinglePage, isViewerInteractiveTarget, pageCount, pageIndex, pages, session?.type]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const max = Math.max(1, node.scrollHeight - node.clientHeight);
    const percent = clamp((node.scrollTop / max) * 100, 0, 100);
    let nextVisiblePageIndex = pageIndexRef.current;
    setScrollPercent(percent);
    if (session?.type === 'pdf' && pdfPageCount > 0) {
      const pageNodes = [...node.querySelectorAll('[data-pdf-page-index]')];
      const viewportTop = node.getBoundingClientRect().top;
      const probeY = viewportTop + Math.min(220, Math.max(80, node.clientHeight * 0.28));
      const visiblePage = pageNodes.find(pageNode => {
        const rect = pageNode.getBoundingClientRect();
        return rect.top <= probeY && rect.bottom >= probeY;
      }) || pageNodes.find(pageNode => pageNode.getBoundingClientRect().bottom > viewportTop + 48);
      const index = Number(visiblePage?.getAttribute('data-pdf-page-index'));
      if (Number.isFinite(index)) {
        nextVisiblePageIndex = clamp(index, 0, Math.max(0, pdfPageCount - 1));
        setPageIndexSynced(nextVisiblePageIndex);
      }
    } else if (flowMode === 'scroll' && session?.type === 'comic' && pages.length > 0) {
      const imageNodes = [...node.querySelectorAll('[data-page-index]')];
      const firstVisible = imageNodes.find(img => img.getBoundingClientRect().bottom > 48);
      const index = Number(firstVisible?.getAttribute('data-page-index'));
      if (Number.isFinite(index)) {
        nextVisiblePageIndex = index;
        setPageIndexSynced(index);
      }
    } else if (flowMode === 'scroll' && (session?.type === 'epub' || session?.type === 'text')) {
      const readerNodes = [...node.querySelectorAll('[data-reader-index]')];
      const firstVisible = readerNodes.find(section => section.getBoundingClientRect().bottom > 48);
      const index = Number(firstVisible?.getAttribute('data-reader-index'));
      if (Number.isFinite(index)) {
        nextVisiblePageIndex = index;
        visibleReaderIndexRef.current = index;
        setPageIndexSynced(index);
      }
    }
    if (flowMode === 'scroll' && hasNextBook && pageCount > 0) {
      const hintKey = `${session?.id || session?.filePath || ''}:scroll:${pageCount}`;
      const atScrollEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
      if (atScrollEnd && lastPageHintRef.current !== hintKey) {
        lastPageHintRef.current = hintKey;
        showNextBookHint();
      } else if (!atScrollEnd && lastPageHintRef.current === hintKey) {
        lastPageHintRef.current = '';
      }
    }
    if (flowMode === 'scroll') {
      persistScrollState(percent, nextVisiblePageIndex);
    }
  };

  const handleWheel = event => {
    const wheelDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!wheelDelta) return;
    const eventButtons = Number(event.buttons) || 0;
    const activeWheelButtons = eventButtons || wheelButtonStateRef.current;
    const zoomByWheelCombination = isShortcutModifierEvent(event) || Boolean(activeWheelButtons & WHEEL_ZOOM_BUTTON_MASK);
    if (zoomByWheelCombination) {
      event.preventDefault();
      event.stopPropagation();
      if (activeWheelButtons & 2) suppressContextMenuRef.current = true;
      adjustZoomAtPoint(wheelDelta < 0 ? ZOOM_STEP : -ZOOM_STEP, event);
      return;
    }
    if (flowMode === 'scroll') return;
    event.preventDefault();
    event.stopPropagation();
    resetPageModeScroll();
    if (wheelDelta > 0) movePage(1);
    else if (wheelDelta < 0) movePage(-1);
    window.requestAnimationFrame(resetPageModeScroll);
  };

  const toggleFullscreen = useCallback(() => {
    const fullscreenRequest = window.viewerAPI?.toggleFullscreen?.();
    fullscreenRequest?.then?.(state => {
      if (typeof state?.fullscreen === 'boolean') {
        setIsFullscreen(state.fullscreen);
      }
    })
      .catch?.(() => {});
  }, []);

  const handleContentDoubleClick = useCallback(event => {
    if (isViewerInteractiveTarget(event.target)) return;
    event.preventDefault();
    toggleFullscreen();
  }, [isViewerInteractiveTarget, toggleFullscreen]);

  const getDragPanTarget = useCallback(target => {
    if (!(session?.type === 'comic' || session?.type === 'pdf')) return null;
    if (target?.closest?.('.viewer-pdf-text-layer')) return null;
    return target?.closest?.('.viewer-comic-image, .viewer-pdf-canvas-wrap') || null;
  }, [session?.type]);

  const isDragPanTarget = useCallback(target => Boolean(getDragPanTarget(target)), [getDragPanTarget]);

  const endDragPan = useCallback(event => {
    const state = dragPanRef.current;
    if (!state.active) return;
    const node = scrollRef.current;
    state.active = false;
    state.pointerId = null;
    node?.classList.remove('is-drag-panning');
    if (event?.pointerId != null && node?.hasPointerCapture?.(event.pointerId)) {
      node.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleDragPanPointerDown = useCallback(event => {
    if (event.button !== 0 || !isDragPanTarget(event.target)) return;
    const node = scrollRef.current;
    if (!node) return;
    const panTarget = getDragPanTarget(event.target);
    const { canPanX, canPanY } = dragPanOverflowStateForTarget(node, panTarget);
    if (!canPanX && !canPanY) return;
    dragPanRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: node.scrollLeft,
      scrollTop: node.scrollTop,
    };
    node.classList.add('is-drag-panning');
    node.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [getDragPanTarget, isDragPanTarget]);

  const handleDragPanPointerMove = useCallback(event => {
    const state = dragPanRef.current;
    if (!state.active || state.pointerId !== event.pointerId) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollLeft = state.scrollLeft - (event.clientX - state.startX);
    node.scrollTop = state.scrollTop - (event.clientY - state.startY);
    event.preventDefault();
  }, []);

  const releaseSwipePointerCapture = useCallback(event => {
    if (event?.pointerId == null) return;
    try {
      if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture can already be released by the browser.
    }
  }, []);

  const cancelSwipeGesture = useCallback(event => {
    const state = swipeGestureRef.current;
    if (!state || state.pointerId !== event?.pointerId) return;
    swipeGestureRef.current = null;
    releaseSwipePointerCapture(event);
  }, [releaseSwipePointerCapture]);

  const handleSwipePointerDown = useCallback(event => {
    if (!event.isPrimary) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (swipeGestureRef.current?.active) return;
    if (dragPanRef.current.active || isViewerInteractiveTarget(event.target)) return;
    if (pageCount <= 1 && !hasNextBook) return;
    if (helpOpen || bookmarkEditorOpen || bookmarkMenuOpen || settingsOpen || navigationPanelOpen || selectionMenu || imageLightbox) return;
    swipeGestureRef.current = {
      active: true,
      source: 'pointer',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: window.performance?.now?.() || Date.now(),
      cancelled: false,
    };
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // Some embedded surfaces reject capture; swipe can still finish if pointerup reaches the content.
    }
  }, [bookmarkEditorOpen, bookmarkMenuOpen, hasNextBook, helpOpen, imageLightbox, isViewerInteractiveTarget, navigationPanelOpen, pageCount, selectionMenu, settingsOpen]);

  const handleSwipePointerMove = useCallback(event => {
    const state = swipeGestureRef.current;
    if (!state?.active || state.source !== 'pointer' || state.pointerId !== event.pointerId) return;
    if (dragPanRef.current.active) {
      state.cancelled = true;
      return;
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absY >= SWIPE_MIN_DISTANCE && absY > absX) {
      state.cancelled = true;
      return;
    }
    if (absX >= 12 && absX > absY * SWIPE_AXIS_LOCK_RATIO) {
      event.preventDefault();
    }
  }, []);

  const handleSwipePointerUp = useCallback(event => {
    const state = swipeGestureRef.current;
    if (!state?.active || state.source !== 'pointer' || state.pointerId !== event.pointerId) return;
    swipeGestureRef.current = null;
    releaseSwipePointerCapture(event);
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = (window.performance?.now?.() || Date.now()) - state.startedAt;
    if (state.cancelled || dragPanRef.current.active) return;
    if (elapsed > SWIPE_MAX_DURATION) return;
    if (absX < SWIPE_MIN_DISTANCE || absX <= absY * SWIPE_AXIS_LOCK_RATIO) return;
    event.preventDefault();
    event.stopPropagation();
    resetPageModeScroll();
    const visualDelta = dx < 0 ? 1 : -1;
    const navigationDelta = readingDirection === 'rtl' ? -visualDelta : visualDelta;
    movePage(navigationDelta);
    window.requestAnimationFrame(resetPageModeScroll);
  }, [movePage, readingDirection, releaseSwipePointerCapture, resetPageModeScroll]);

  const handleTouchSwipeStart = useCallback(event => {
    if (event.touches.length !== 1) return;
    if (swipeGestureRef.current?.active) return;
    if (dragPanRef.current.active || isViewerInteractiveTarget(event.target)) return;
    if (pageCount <= 1 && !hasNextBook) return;
    if (helpOpen || bookmarkEditorOpen || bookmarkMenuOpen || settingsOpen || navigationPanelOpen || selectionMenu || imageLightbox) return;
    const touch = event.touches[0];
    swipeGestureRef.current = {
      active: true,
      source: 'touch',
      touchId: touch.identifier,
      pointerId: `touch:${touch.identifier}`,
      startX: touch.clientX,
      startY: touch.clientY,
      startedAt: window.performance?.now?.() || Date.now(),
      cancelled: false,
    };
  }, [bookmarkEditorOpen, bookmarkMenuOpen, hasNextBook, helpOpen, imageLightbox, isViewerInteractiveTarget, navigationPanelOpen, pageCount, selectionMenu, settingsOpen]);

  const handleTouchSwipeMove = useCallback(event => {
    const state = swipeGestureRef.current;
    if (!state?.active || state.source !== 'touch') return;
    if (event.touches.length !== 1 || dragPanRef.current.active) {
      state.cancelled = true;
      return;
    }
    const touch = [...event.touches].find(item => item.identifier === state.touchId);
    if (!touch) {
      state.cancelled = true;
      return;
    }
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absY >= SWIPE_MIN_DISTANCE && absY > absX) {
      state.cancelled = true;
      return;
    }
    if (absX >= 12 && absX > absY * SWIPE_AXIS_LOCK_RATIO && event.cancelable) {
      event.preventDefault();
    }
  }, []);

  const handleTouchSwipeEnd = useCallback(event => {
    const state = swipeGestureRef.current;
    if (!state?.active || state.source !== 'touch') return;
    const changedTouches = [...event.changedTouches];
    const touch = changedTouches.find(item => item.identifier === state.touchId) || changedTouches[0];
    if (!touch) return;
    swipeGestureRef.current = null;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = (window.performance?.now?.() || Date.now()) - state.startedAt;
    if (state.cancelled || dragPanRef.current.active) return;
    if (elapsed > SWIPE_MAX_DURATION) return;
    if (absX < SWIPE_MIN_DISTANCE || absX <= absY * SWIPE_AXIS_LOCK_RATIO) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    resetPageModeScroll();
    const visualDelta = dx < 0 ? 1 : -1;
    const navigationDelta = readingDirection === 'rtl' ? -visualDelta : visualDelta;
    movePage(navigationDelta);
    window.requestAnimationFrame(resetPageModeScroll);
  }, [movePage, readingDirection, resetPageModeScroll]);

  const handleTouchSwipeCancel = useCallback(() => {
    const state = swipeGestureRef.current;
    if (state?.source !== 'touch') return;
    swipeGestureRef.current = null;
  }, []);

  const handleContentPointerDown = useCallback(event => {
    if (event.pointerType === 'mouse') {
      wheelButtonStateRef.current = Number(event.buttons) || 0;
    }
    handleDragPanPointerDown(event);
    handleSwipePointerDown(event);
  }, [handleDragPanPointerDown, handleSwipePointerDown]);

  const handleContentPointerMove = useCallback(event => {
    if (event.pointerType === 'mouse') {
      wheelButtonStateRef.current = Number(event.buttons) || 0;
    }
    handleDragPanPointerMove(event);
    handleSwipePointerMove(event);
  }, [handleDragPanPointerMove, handleSwipePointerMove]);

  const handleContentPointerUp = useCallback(event => {
    if (event.pointerType === 'mouse') {
      wheelButtonStateRef.current = Number(event.buttons) || 0;
    }
    handleSwipePointerUp(event);
    endDragPan(event);
  }, [endDragPan, handleSwipePointerUp]);

  const handleContentPointerCancel = useCallback(event => {
    if (event?.pointerType === 'mouse') {
      wheelButtonStateRef.current = 0;
    }
    cancelSwipeGesture(event);
    endDragPan(event);
  }, [cancelSwipeGesture, endDragPan]);

  useEffect(() => {
    const handler = event => {
      if (isShortcutModifierEvent(event) && !event.altKey && event.key.toLowerCase() === 'f') {
        if (openNavigationSearch()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const shortcutsBlockedByOverlay = Boolean(
        helpOpen
        || bookmarkEditorOpen
        || bookmarkMenuOpen
        || settingsOpen
        || navigationPanelOpen
        || selectionMenu
        || imageLightbox
      );
      if (shortcutsBlockedByOverlay || isViewerShortcutBlockedTarget(event.target)) return;
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) toggleToolbarPinned();
      } else if (event.key === 'F11') {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault();
        toggleFullscreen();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'l') {
        if (openNavigationToc()) {
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        movePage(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        movePage(-1);
      } else if (event.key === ']') {
        event.preventDefault();
        moveAdjacentBook(1);
      } else if (event.key === '[') {
        event.preventDefault();
        moveAdjacentBook(-1);
      } else if ((event.key === '+' || event.key === '=') && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub' || session?.type === 'text')) {
        event.preventDefault();
        adjustZoom(ZOOM_STEP);
      } else if (event.key === '-' && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub' || session?.type === 'text')) {
        event.preventDefault();
        adjustZoom(-ZOOM_STEP);
      } else if (event.key === '0' && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub' || session?.type === 'text')) {
        setViewMode('actual');
        setZoom(100);
      } else if (event.key === '9' && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub')) {
        setViewMode('fit');
      } else if (event.key === '8' && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub')) {
        setViewMode('height');
      } else if (event.key === '7' && (session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub')) {
        setViewMode('width');
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        addBookmark();
      } else if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        setPageJumpSequence(current => current + 1);
        goNavigationPage(0);
        if (flowMode === 'scroll') {
          window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ top: 0, left: 0 }));
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        const lastPageIndex = Math.max(0, pageCount - 1);
        setPageJumpSequence(current => current + 1);
        goNavigationPage(lastPageIndex);
        if (flowMode === 'scroll') {
          window.requestAnimationFrame(() => {
            const node = scrollRef.current;
            node?.scrollTo?.({ top: node.scrollHeight, left: 0 });
          });
        }
      } else if (event.key === 'Escape') {
        window.viewerAPI?.closeWindow?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addBookmark, adjustZoom, bookmarkEditorOpen, bookmarkMenuOpen, flowMode, goNavigationPage, helpOpen, imageLightbox, isViewerShortcutBlockedTarget, moveAdjacentBook, movePage, navigationPanelOpen, openNavigationSearch, openNavigationToc, pageCount, selectionMenu, session?.type, settingsOpen, toggleFullscreen, toggleToolbarPinned]);

  const getComicSpreadPagesForIndex = useCallback(index => {
    if (pageCount === 0) return [];
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pageCount - 1));
    const current = pages[targetIndex];
    if (!current) return [];
    const currentRatio = pageRatios[current.name] || 0;
    if (flowMode !== 'spread' || (spreadCoverFirst && targetIndex === 0) || isComicSinglePage(targetIndex) || currentRatio > 1) return [current];
    const next = pages[targetIndex + 1];
    if (!next || isComicSinglePage(targetIndex + 1) || (pageRatios[next.name] || 0) > 1) return [current];
    return readingDirection === 'rtl' ? [next, current] : [current, next];
  }, [flowMode, isComicSinglePage, pageCount, pageRatios, pages, readingDirection, spreadCoverFirst]);

  const comicSpreadPages = useMemo(() => getComicSpreadPagesForIndex(pageIndex), [getComicSpreadPagesForIndex, pageIndex]);

  const imageClassName = `viewer-comic-image view-${viewMode}`;
  const getComicImageStyle = (page, pageSlots = 1, renderZoom = zoom) => {
    const size = pageSizes[page?.name];
    if (!size) return undefined;
    const slots = Math.max(1, Number(pageSlots) || 1);
    const availableWidth = Math.max(120, ((Number(readerViewport.width) || 900) - 24) / slots);
    const availableHeight = Math.max(120, (Number(readerViewport.height) || 700) - 24);
    const scaledSize = scaledPageSizeForViewMode({
      viewMode,
      baseWidth: size.width,
      baseHeight: size.height,
      availableWidth,
      availableHeight,
      zoom: renderZoom,
    });
    return {
      width: `${scaledSize.width}px`,
      height: `${scaledSize.height}px`,
      maxWidth: 'none',
      maxHeight: 'none',
      flex: '0 0 auto',
    };
  };
  const getComicFlipBookPageSize = (pageSlots = 2, renderZoom = zoom) => {
    const fallbackSize = getFlipBookPageSize(pageSlots, 160);
    const stepSize = Math.max(1, Number(getStepSizeForIndex(pageIndex)) || 1);
    const visibleIndexes = Array.from({ length: stepSize }, (_, offset) => pageIndex + offset)
      .filter(index => index >= 0 && index < pages.length);
    const renderedSizes = visibleIndexes
      .map(index => getComicImageStyle(pages[index], pageSlots, renderZoom))
      .map(style => ({
        width: Number.parseFloat(style?.width || ''),
        height: Number.parseFloat(style?.height || ''),
      }))
      .filter(size => Number.isFinite(size.width) && Number.isFinite(size.height));
    if (renderedSizes.length < 1) return fallbackSize;
    return {
      width: Math.max(fallbackSize.width, ...renderedSizes.map(size => Math.ceil(size.width))),
      height: Math.max(fallbackSize.height, ...renderedSizes.map(size => Math.ceil(size.height))),
    };
  };
  const renderComicImage = (page, fallbackIndex = 0, pageSlots = 1, options = {}) => {
    const index = Number.isFinite(page?.index) ? page.index : fallbackIndex;
    const src = pageData[page.name] || page?.pageUrl;
    const pageError = pageErrors[page.name];
    const frameSizeStyle = options.frameStyle || getComicImageStyle(page, pageSlots);
    const frameStyle = frameSizeStyle;
    const fittedImageStyle = options.imageStyle || (frameSizeStyle
      ? { width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', objectFit: options.objectFit || 'cover' }
      : undefined);
    if (pageError && !pageData[page.name]) {
      return (
        <div key={page.name} className="viewer-comic-placeholder is-error" data-page-index={index}>
          {viewerText('viewer.common.image_load_failed', '{name} 이미지를 불러오지 못했습니다.', { name: page.basename || page.name })}
        </div>
      );
    }
    if (!src) {
      return (
        <div key={page.name} className="viewer-comic-placeholder" data-page-index={index}>
          {viewerText('viewer.common.loading', 'Loading...')}
        </div>
      );
    }
    return (
      <ComicPageFrame
        key={page.name}
        page={page}
        index={index}
        src={src}
        viewMode={viewMode}
        imageClassName={imageClassName}
        frameStyle={frameStyle}
        imageStyle={fittedImageStyle}
        onImageLoad={event => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          rememberComicPageImageSize(page.name, naturalWidth, naturalHeight);
        }}
        onImageError={() => {
          if (page?.pageUrl && !pageData[page.name]) {
            loadComicPage(index, { force: true });
            return;
          }
          setPageErrors(prev => ({
            ...prev,
            [page.name]: viewerText('viewer.common.image_load_failed', '{name} 이미지를 불러오지 못했습니다.', { name: page.basename || page.name }),
          }));
        }}
      />
    );
  };

  const renderComic = () => {
    if (loading) return <div className="viewer-state">{viewerText('viewer.common.loading', 'Loading...')}</div>;
    if (pageCount === 0) return <div className="viewer-state">{viewerText('viewer.common.no_pages', 'No pages')}</div>;
    if (flowMode === 'scroll') {
      return (
        <div className="viewer-comic-scroll">
          {pages.map((page, index) => renderComicImage(page, index, 1))}
        </div>
      );
    }
    const isBookPageEffect = readerSettings.pageEffect === 'page' && flowMode === 'spread';
    if (isBookPageEffect) {
      const spread = flowMode === 'spread';
      const pageSlots = spread ? 2 : 1;
      const flipBookRenderZoom = 100;
      const pageSize = getComicFlipBookPageSize(pageSlots, flipBookRenderZoom);
      const flipBookVisualScale = Math.max(0.02, (Number(zoom) || 100) / 100);
      const comicFlipBookRenderKey = [
        pageSize.width,
        pageSize.height,
        pages.length,
        Object.keys(pageData).length,
        Object.keys(pageErrors).length,
        Object.keys(pageSizes).length,
      ].join('|');
      return (
        <ViewerFlipBook
          bookKey={`comic-${session?.id || session?.filePath || 'comic'}-${viewMode}-${spreadCoverFirst}-${comicSinglePageNames.join('|')}`}
          className={`viewer-comic-stage is-${viewMode}`.trim()}
          pageClassName="is-comic"
          pageCount={pageCount}
          currentPageIndex={pageIndex}
          spread={spread}
          readingDirection={readingDirection}
          pageSize={pageSize}
          getStepSizeForIndex={getStepSizeForIndex}
          navigationKey={pageJumpSequence}
          visualScale={flipBookVisualScale}
          renderKey={comicFlipBookRenderKey}
          onPageIndexChange={handleFlipBookPageIndexChange}
          renderPage={(sourceIndex, entry) => {
            const page = pages[sourceIndex];
            return page ? renderComicImage(page, sourceIndex, pageSlots, {
              objectFit: 'contain',
              frameStyle: {
                ...getComicImageStyle(page, pageSlots, flipBookRenderZoom),
                maxWidth: '100%',
                maxHeight: '100%',
              },
            }) : null;
          }}
        />
      );
    }
    const displayStartIndex = pageIndex;
    const displayComicPages = comicSpreadPages;
    const hasSpreadPair = flowMode === 'spread' && displayComicPages.length > 1;
    const pageSlots = hasSpreadPair ? 2 : 1;
    const comicEffectClassName = pageTurn.active && pageTurn.format === 'comic' && pageTurn.effect !== 'none'
      ? `has-page-effect effect-${pageTurn.effect} effect-${pageTurn.direction}`
      : '';
    const comicStageClassName = `viewer-comic-stage is-${viewMode} ${flowMode === 'spread' ? 'is-spread' : ''} ${hasSpreadPair ? 'has-spread-pair' : ''} ${comicEffectClassName}`.trim();
    const comicPages = displayComicPages.map((page, index) => renderComicImage(page, Number.isFinite(page?.index) ? page.index : displayStartIndex + index, pageSlots));
    return (
      <div className={comicStageClassName}>
        {hasSpreadPair ? <div className="viewer-spread-pair">{comicPages}</div> : comicPages}
      </div>
    );
  };

  const readerStyle = {
    '--viewer-reader-bg': theme.bg,
    '--viewer-reader-fg': theme.fg,
    '--viewer-reader-font': readerSettings.fontFamily,
    '--viewer-reader-size': `${readerFontSize}px`,
    '--viewer-reader-line-height': lineHeight,
    '--viewer-reader-letter-spacing': `${readerSettings.letterSpacing}px`,
    '--viewer-reader-padding-y': `${readerSettings.verticalPadding}px`,
    '--viewer-reader-padding-x': `${readerSettings.horizontalPadding}px`,
    '--viewer-reader-paragraph-spacing': `${readerSettings.paragraphSpacing}px`,
    '--viewer-reader-mixed-image-max-height': `${readerPageMetrics.mixedImageMaxHeight || 280}px`,
    '--viewer-reader-footer-space': `${readerSettings.showFooter ? READER_FOOTER_SPACE : 0}px`,
    '--viewer-reader-footer-display': readerSettings.showFooter ? 'block' : 'none',
    '--viewer-reader-text-align': readerSettings.textAlign,
    '--viewer-reader-writing-mode': readerSettings.textDirection === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
    '--viewer-reader-text-orientation': readerSettings.textDirection === 'vertical' ? 'mixed' : 'initial',
    '--viewer-reader-word-break': readerSettings.wrapMode === 'char' ? 'break-all' : 'keep-all',
    ...(session?.type === 'epub' && viewMode === 'width' ? { maxWidth: 'none' } : {}),
  };

  const renderReaderPageBody = (item, sourceIndex = pageIndex, options = {}) => (
    normalizeReaderBlocks(item).map((block, index) => {
      const measureBlockIndex = Number.isInteger(options.measureBlockIndex) ? options.measureBlockIndex : null;
      const measureProps = measureBlockIndex !== null
        ? { 'data-reader-measure-block-index': measureBlockIndex }
        : {};
      const imagePreviewAllowed = Boolean(session?.type === 'epub' && block.hasImage && !readerBlockPreventsImageExpansion(block));
      const htmlBlockClassName = viewerClassName(
        'viewer-reader-html-block',
        block.hasImage && 'has-block-image',
        block.mediaOnly && 'is-media-only-block',
        imagePreviewAllowed && 'has-previewable-image',
      );
      if (block?.type === 'image' && block.src) {
        const blockAlt = Object.prototype.hasOwnProperty.call(block, 'alt') ? block.alt || '' : item.title || '';
        const previewImage = { src: block.src, alt: blockAlt, onOpen: openImageLightbox };
        return (
          <figure
            key={`${block.src}-${index}`}
            className={viewerClassName('viewer-epub-image', imagePreviewAllowed && 'is-previewable')}
            style={block.style || undefined}
            {...measureProps}
          >
            <img
              {...(block.attributes || {})}
              className={viewerClassName(block.className, imagePreviewAllowed && 'is-previewable')}
              src={block.src}
              alt={blockAlt}
              title={imagePreviewAllowed ? viewerText('viewer.common.image_preview', '이미지 크게 보기') : undefined}
              role={imagePreviewAllowed ? 'button' : undefined}
              tabIndex={imagePreviewAllowed ? 0 : undefined}
              aria-label={imagePreviewAllowed ? viewerText('viewer.common.image_preview', '이미지 크게 보기') : undefined}
              onClick={imagePreviewAllowed ? event => openReaderImagePreview(event, previewImage) : undefined}
              onKeyDown={imagePreviewAllowed ? event => handleReaderImagePreviewKeyDown(event, previewImage) : undefined}
            />
            {block.alt ? <figcaption>{block.alt}</figcaption> : null}
          </figure>
        );
      }
      const text = normalizeReaderDisplayText(block?.text || item.text || item || '');
      if (Array.isArray(block?.nodes) && block.nodes.length > 0) {
        if (block.nodes.length === 1 && block.nodes[0]?.type === 'element') {
          return renderEpubHtmlNode(block.nodes[0], `html-${index}-root`, {
            pageIndex: sourceIndex,
            highlights,
            activeSearch,
            imagePreviewAllowed,
            onImagePreview: openImageLightbox,
            onInternalLink: goEpubInternalTarget,
            onExternalLink: openExternalLink,
          }, htmlBlockClassName, measureProps);
        }
        return (
          <div key={`html-${index}`} className={htmlBlockClassName} {...measureProps}>
            {block.nodes.map((node, nodeIndex) => renderEpubHtmlNode(node, `${index}-${nodeIndex}`, {
              pageIndex: sourceIndex,
              highlights,
              activeSearch,
              imagePreviewAllowed,
              onImagePreview: openImageLightbox,
              onInternalLink: goEpubInternalTarget,
              onExternalLink: openExternalLink,
            }))}
          </div>
        );
      }
      const paragraphs = text.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
      return (
        <div
          key={`text-${index}`}
          className={viewerClassName('viewer-reader-text-block', block.className)}
          style={block.style || undefined}
          {...measureProps}
        >
          {(paragraphs.length > 0 ? paragraphs : ['']).map((paragraph, paragraphIndex) => (
            <p key={`${index}-${paragraphIndex}`}>
              {renderMarkedText(paragraph, sourceIndex, highlights, activeSearch)}
            </p>
          ))}
        </div>
      );
    })
  );

  const renderReaderMeasurementStage = () => {
    if (
      session?.type !== 'epub'
      || flowMode === 'scroll'
      || epubMeasurementReady
      || epubMeasurementBlocks.length < 1
    ) {
      return null;
    }
    const measurementStyle = {
      ...readerStyle,
      width: `${readerPageMetrics.pageFrameWidth || 640}px`,
      height: `${readerPageMetrics.pageFrameHeight || 760}px`,
      maxWidth: 'none',
    };
    const headerTitle = epubMeasurementBlocks.find(block => block.readerMeasureMeta?.title)?.readerMeasureMeta?.title || '';
    return (
      <div ref={readerMeasureRef} className="viewer-reader-measure-stage" aria-hidden="true">
        <article className="viewer-text-page viewer-reader-scope is-epub-reader" style={measurementStyle}>
          <div className="viewer-reader-page-body">
            {readerSettings.showHeader && headerTitle ? <h2 data-reader-measure-header="true">{headerTitle}</h2> : null}
            {epubMeasurementBlocks.map((block, index) => (
              <React.Fragment key={`measure-${index}`}>
                {renderReaderPageBody({ blocks: [block] }, 0, { measureBlockIndex: index })}
              </React.Fragment>
            ))}
          </div>
        </article>
      </div>
    );
  };

  const renderReaderPages = items => {
    const readerTypeClassName = session?.type === 'epub' ? 'is-epub-reader' : 'is-text-reader';
    if (flowMode === 'scroll') {
      return (
        <article className={`viewer-text-page viewer-reader-scope is-scroll ${readerTypeClassName}`.trim()} style={readerStyle}>
          {items.map((item, index) => (
            <section key={`${item.title || 'page'}-${index}`} className="viewer-epub-chapter" data-reader-index={index}>
              {renderReaderPageBody(item, index)}
            </section>
          ))}
        </article>
      );
    }
    const renderReaderArticle = (item, index, sourceIndex, extraClassName = '') => (
      <article
        key={`${sourceIndex}-${index}-${extraClassName || 'page'}`}
        className={`viewer-text-page viewer-reader-scope ${readerTypeClassName} ${item.hasImage ? 'has-reader-image' : ''} ${item.standaloneImage ? 'has-epub-image' : ''} ${extraClassName}`.trim()}
        data-reader-page-index={sourceIndex}
        style={readerStyle}
      >
        <div className="viewer-reader-page-body">
          {readerSettings.showHeader && item.title ? <h2>{item.title}</h2> : null}
          {renderReaderPageBody(item, sourceIndex)}
        </div>
        {readerSettings.showFooter ? <div className="viewer-reader-page-number">{sourceIndex + 1}</div> : null}
      </article>
    );
    const spread = flowMode === 'spread';
    if (readerSettings.pageEffect === 'page' && spread) {
      const pageSize = {
        width: Math.max(180, Math.round(readerPageMetrics.pageFrameWidth || getFlipBookPageSize(spread ? 2 : 1).width)),
        height: Math.max(260, Math.round(readerPageMetrics.pageFrameHeight || getFlipBookPageSize(spread ? 2 : 1).height)),
      };
      return (
        <ViewerFlipBook
          bookKey={`reader-${session?.id || session?.filePath || session?.type || 'reader'}-${viewMode}-${readerSettings.fontFamily}-${readerSettings.fontScale}`}
          className={`viewer-reader-stage is-${viewMode}`.trim()}
          pageClassName="is-reader"
          pageCount={items.length}
          currentPageIndex={pageIndex}
          spread={spread}
          pageSize={pageSize}
          navigationKey={pageJumpSequence}
          onPageIndexChange={handleFlipBookPageIndexChange}
          renderPage={(sourceIndex, entry) => renderReaderArticle(items[sourceIndex], entry.leafOffset, sourceIndex)}
        />
      );
    }
    const displayStartIndex = pageIndex;
    const basePageIndexes = spread
      ? [displayStartIndex, displayStartIndex + 1]
      : [displayStartIndex];
    const displayPageEntries = basePageIndexes
      .filter(index => index >= 0 && index < items.length)
      .map((sourceIndex, index) => ({ item: items[sourceIndex], sourceIndex, slotIndex: index }));
    const hasSpreadPair = spread && displayPageEntries.length > 1;
    const readerEffectClassName = pageTurn.active && pageTurn.format === 'reader' && pageTurn.effect !== 'none'
      ? `has-page-effect effect-${pageTurn.effect} effect-${pageTurn.direction}`
      : '';
    const readerStageClassName = `viewer-reader-stage is-${viewMode} ${spread ? 'is-spread' : ''} ${hasSpreadPair ? 'has-spread-pair' : ''} ${readerEffectClassName}`.trim();
    const readerPages = displayPageEntries.map(entry => renderReaderArticle(entry.item, entry.slotIndex, entry.sourceIndex));
    return (
      <div className={readerStageClassName}>
        {hasSpreadPair ? <div className="viewer-spread-pair">{readerPages}</div> : readerPages}
      </div>
    );
  };

  const renderPdf = () => {
    if (!pdfDocument || pdfPageCount <= 0) {
      return (
        <div className="viewer-state">
          {loading
            ? viewerText('viewer.common.loading', 'Loading...')
            : viewerText('viewer.common.pdf_unavailable', 'PDF unavailable')}
        </div>
      );
    }
    const getPdfPageIndexesForIndex = index => {
      const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pdfPageCount - 1));
      if (flowMode === 'scroll') return Array.from({ length: pdfPageCount }, (_, pageNumberIndex) => pageNumberIndex);
      if (flowMode === 'spread') return [targetIndex, targetIndex + 1].filter(pageNumberIndex => pageNumberIndex >= 0 && pageNumberIndex < pdfPageCount);
      return [targetIndex].filter(pageNumberIndex => pageNumberIndex >= 0 && pageNumberIndex < pdfPageCount);
    };
    const displayStartIndex = pageIndex;
    const pageIndexes = getPdfPageIndexesForIndex(displayStartIndex);
    const hasSpreadPair = flowMode === 'spread' && pageIndexes.length > 1;
    const pageSlots = hasSpreadPair ? 2 : 1;
    const pdfEffectClassName = pageTurn.active && pageTurn.format === 'pdf' && pageTurn.effect !== 'none'
      ? `has-page-effect effect-${pageTurn.effect} effect-${pageTurn.direction}`
      : '';
    const pdfStageClassName = `viewer-pdf-stage is-${flowMode} is-${viewMode} ${hasSpreadPair ? 'has-spread-pair' : ''} ${pdfEffectClassName}`.trim();
    const renderPdfPage = (index, slots, keyPrefix = 'page', activeIndex = displayStartIndex, forceActive = false, renderZoom = zoom) => (
      <PdfPageCanvas
        key={`${session?.id || 'pdf'}-${keyPrefix}-${index}`}
        pdfDocument={pdfDocument}
        pageNumber={index + 1}
        containerWidth={readerViewport.width}
        containerHeight={readerViewport.height}
        pageSlots={slots}
        viewMode={viewMode}
        zoom={renderZoom}
        active={forceActive || (keyPrefix !== 'flipbook' && flowMode !== 'scroll') || index === activeIndex}
      />
    );
    if (readerSettings.pageEffect === 'page' && flowMode === 'spread') {
      const spread = flowMode === 'spread';
      const slots = spread ? 2 : 1;
      const pageSize = getFlipBookPageSize(slots, 180);
      const flipBookVisualScale = Math.max(0.02, (Number(zoom) || 100) / 100);
      const flipBookRenderZoom = 100;
      const pdfFlipBookRenderKey = [
        pageIndex,
        pdfPageCount,
        readerViewport.width,
        readerViewport.height,
        viewMode,
      ].join('|');
      return (
        <ViewerFlipBook
          bookKey={`pdf-${session?.id || session?.filePath || 'pdf'}-${viewMode}`}
          className={`viewer-pdf-stage is-${flowMode} is-${viewMode}`.trim()}
          pageClassName="is-pdf"
          pageCount={pdfPageCount}
          currentPageIndex={pageIndex}
          spread={spread}
          pageSize={pageSize}
          navigationKey={pageJumpSequence}
          visualScale={flipBookVisualScale}
          renderKey={pdfFlipBookRenderKey}
          onPageIndexChange={handleFlipBookPageIndexChange}
          renderPage={sourceIndex => renderPdfPage(
            sourceIndex,
            slots,
            'flipbook',
            pageIndex,
            Math.abs(sourceIndex - pageIndex) <= slots + 1,
            flipBookRenderZoom,
          )}
        />
      );
    }
    const pdfPages = pageIndexes.map(index => renderPdfPage(index, pageSlots));
    return (
      <div className={pdfStageClassName}>
        {hasSpreadPair ? <div className="viewer-spread-pair">{pdfPages}</div> : pdfPages}
      </div>
    );
  };

  const renderContent = () => {
    if (error) return <div className="viewer-state viewer-error">{error}</div>;
    if (!session) return <div className="viewer-state">{viewerText('viewer.common.no_book', 'No book')}</div>;
    if (loading && (session.type === 'text' || session.type === 'epub')) return <div className="viewer-state">{viewerText('viewer.common.loading', 'Loading...')}</div>;
    if (session.type === 'comic') return renderComic();
    if (session.type === 'pdf') return renderPdf();
    if (session.type === 'text') return renderReaderPages(textPages.map(text => ({ text })));
    if (session.type === 'epub') return renderReaderPages(epubPages);
    return <div className="viewer-state">{viewerText('viewer.common.unsupported', 'Unsupported')}</div>;
  };
  const supportsFlowControls = session?.type === 'comic' || session?.type === 'pdf' || isReaderDocument;
  const supportsViewControls = session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub';
  const supportsZoomControls = session?.type === 'comic' || session?.type === 'pdf' || isReaderDocument;
  const supportsBackgroundSettings = session?.type === 'comic' || session?.type === 'pdf' || session?.type === 'epub' || session?.type === 'text';
  const supportsSettingsButton = supportsBackgroundSettings || isReaderDocument;
  const settingsButtonTitle = supportsBackgroundSettings
    ? viewerText('viewer.settings.viewer', '뷰어 설정')
    : viewerText('viewer.settings.reading', '읽기 설정');
  const translatedSettingsButtonTitle = supportsBackgroundSettings
    ? viewerText('viewer.settings.viewer', settingsButtonTitle)
    : viewerText('viewer.settings.reading', settingsButtonTitle);
  const searchShortcut = viewerShortcutLabel(['Mod', 'F']);
  const tocShortcut = viewerShortcutLabel(['L']);
  const fullscreenShortcut = viewerShortcutLabel(['F11']);
  const fullscreenTitle = `${viewerText('viewer.toolbar.fullscreen', '전체화면 전환')} (${fullscreenShortcut} / Enter)`;
  const atForwardBoundary = flowMode !== 'scroll' && isForwardBoundaryIndex(pageIndex);
  const previousPageDisabled = session?.type === 'pdf'
    ? pageCount <= 0 || pageIndex <= 0
    : flowMode !== 'scroll' && pageIndex <= 0;
  const nextPageDisabled = pageCount <= 0 || (atForwardBoundary && !hasNextBook);
  const slideNavAvailable = Boolean(session && pageCount > 0 && (session.type !== 'pdf' || pdfDocument));
  const backgroundMode = supportsBackgroundSettings && readerSettings.pageEffect !== 'page'
    ? viewerBackground.mode
    : 'solid';
  const toolbarVisible = toolbarPinnedOpen || toolbarPeekOpen;
  const toolbarToggleTitle = toolbarPinnedOpen
    ? viewerText('viewer.toolbar.hide_toolbar', '툴바 숨기기 (Tab)')
    : viewerText('viewer.toolbar.show_toolbar', '툴바 표시 (Tab)');
  const appClassName = `viewer-app is-background-${backgroundMode} lang-${viewerLanguage} ${slideNavAvailable && slideNavOpen ? 'has-slide-nav-open' : ''} ${toolbarPinnedOpen ? 'is-toolbar-pinned' : 'is-toolbar-unpinned'} ${toolbarVisible ? 'is-toolbar-visible' : 'is-toolbar-hidden'} ${toolbarPeekOpen && !toolbarPinnedOpen ? 'is-toolbar-peek' : ''}`.trim();
  const appStyle = {
    '--viewer-background-solid': viewerBackground.color,
    '--viewer-content-bg': viewerBackground.color,
    '--viewer-toolbar-height': `${toolbarHeight}px`,
  };
  const ambientTurnActive = backgroundMode === 'immersive'
    && pageTurn.active
    && pageTurn.effect !== 'none'
    && pageTurn.effect !== 'page';
  const ambientBackdropStyle = backgroundMode === 'immersive'
    ? {
      backgroundImage: immersiveGradientForPage(ambientTurnActive ? pageTurn.fromIndex : pageIndex),
      '--viewer-ambient-next-gradient': ambientTurnActive ? immersiveGradientForPage(pageTurn.toIndex) : 'none',
      '--viewer-ambient-turn-progress': ambientTurnActive ? 1 : 0,
      '--viewer-ambient-turn-texture-color': 'rgba(0, 0, 0, 0)',
      '--viewer-ambient-turn-duration': `${ambientTurnActive ? pageTurn.duration || 180 : 80}ms`,
    }
    : undefined;
  const isPageMode = flowMode !== 'scroll';
  const contentClassName = `viewer-content ${isPageMode ? 'is-page-mode' : ''} ${isReaderDocument && isPageMode ? 'is-reader-paged' : ''}`.trim();
  const runToolbarAction = useCallback(action => event => {
    action?.(event);
    restoreViewerFocus();
  }, [restoreViewerFocus]);
  const renderSlideThumbs = () => {
    if (!slideNavAvailable) return null;
    if (session?.type === 'pdf') {
      return Array.from({ length: pdfPageCount }, (_, index) => (
        <PdfThumbnailCanvas
          key={`${session?.id || 'pdf-thumb'}-${index}`}
          pdfDocument={pdfDocument}
          pageNumber={index + 1}
            active={index === pageIndex}
            onClick={runToolbarAction(() => goSlideNavPage(index))}
          />
      ));
    }
    if (session?.type === 'comic') {
      return pages.map((page, index) => {
        const fallbackSrc = pageData[page.name];
        const src = fallbackSrc || page?.pageUrl;
        return (
          <ComicSlideThumb
            key={page.name || index}
            page={page}
            pageNumber={index + 1}
            active={index === pageIndex}
            src={src}
            hasFallbackSrc={Boolean(fallbackSrc)}
            onClick={runToolbarAction(() => goSlideNavPage(index))}
            onFallback={() => loadComicPage(index, { force: true })}
          />
        );
      });
    }
    if (session?.type === 'epub' || session?.type === 'text') {
      const readerItems = session.type === 'epub' ? epubPages : textPages.map(text => ({ text }));
      return readerItems.map((item, index) => (
        <ReaderSlideThumb
          key={`${session.id || session.filePath || 'reader'}-${index}`}
          item={item}
          pageNumber={index + 1}
          active={index === pageIndex}
          onClick={runToolbarAction(() => goSlideNavPage(index))}
        />
      ));
    }
    return null;
  };

  return (
    <div className={appClassName} style={appStyle} lang={viewerLanguage}>
      {backgroundMode === 'immersive' && (
        <div
          className="viewer-ambient-backdrop has-gradient"
          style={ambientBackdropStyle}
          aria-hidden="true"
        />
      )}
      {!toolbarPinnedOpen && (
        <div
          className="viewer-toolbar-hover-zone"
          aria-hidden="true"
          onPointerEnter={showToolbarPeek}
          onPointerLeave={() => scheduleToolbarPeekClose()}
        />
      )}
      <header
        ref={toolbarRef}
        className="viewer-toolbar"
        onPointerEnter={showToolbarPeek}
        onPointerLeave={() => scheduleToolbarPeekClose()}
      >
        <div className="viewer-tool-cluster viewer-toolbar-toggle-cluster" aria-label={viewerText('viewer.toolbar.visibility_group', '툴바 표시')}>
          <ToolbarButton
            title={toolbarToggleTitle}
            iconSrc={toolbarIcon}
            active={toolbarVisible}
            className="viewer-toolbar-toggle"
            onClick={toggleToolbarPinned}
          />
        </div>
        <div className="viewer-title" title={session?.filePath || ''}>
          <span>{session?.fileName || 'BookManagerViewer'}</span>
          <small>{progressText}</small>
        </div>
        <div className="viewer-tool-group">
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.file_navigation', '파일 이동')}>
            <ToolbarButton
              title={viewerText('viewer.toolbar.previous_file', '이전파일 ({shortcut})', { shortcut: '[' })}
              icon="anglesLeft"
              disabled={!hasPreviousBook || adjacentLoading}
              onClick={runToolbarAction(() => moveAdjacentBook(-1))}
            />
            <ToolbarButton
              title={viewerText('viewer.toolbar.next_file', '다음파일 ({shortcut})', { shortcut: ']' })}
              icon="anglesRight"
              disabled={!hasNextBook || adjacentLoading}
              onClick={runToolbarAction(() => moveAdjacentBook(1))}
            />
          </div>
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.page_navigation', '페이지 이동')}>
            <ToolbarButton title={viewerText('viewer.toolbar.previous_page', '이전장')} icon="angleLeft" disabled={previousPageDisabled} onClick={runToolbarAction(() => movePage(-1))} />
            <ToolbarButton title={viewerText('viewer.toolbar.next_page', '다음장')} icon="angleRight" disabled={nextPageDisabled} onClick={runToolbarAction(() => movePage(1))} />
          </div>
          {supportsViewControls && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.fit_group', '화면맞춤')}>
              {VIEW_MODES.map(option => (
                <ToolbarButton
                  key={option.id}
                  title={viewerText(option.labelKey, option.label)}
                  iconSrc={option.iconSrc}
                  iconRotate={option.rotate || 0}
                  active={viewMode === option.id}
                  onClick={runToolbarAction(() => {
                    setViewMode(option.id);
                    if (option.id === 'actual') setZoom(100);
                  })}
                />
              ))}
            </div>
          )}
          {supportsZoomControls && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.zoom_group', '확대/축소')}>
              <ZoomControl
                zoom={zoom}
                onZoomChange={setZoomValue}
                onReset={() => setZoom(100)}
                onWheel={handleZoomWheel}
              />
            </div>
          )}
          {supportsFlowControls && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.read_mode_group', '읽기모드')}>
              {FLOW_MODES.map(option => (
                <ToolbarButton
                  key={option.id}
                  title={viewerText(option.labelKey, option.label)}
                  iconSrc={option.iconSrc}
                  active={flowMode === option.id}
                  onClick={runToolbarAction(() => updateFlowMode(option.id))}
                />
              ))}
            </div>
          )}
          {session?.type === 'comic' && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.reading_direction_group', '읽기방향')}>
              <ToolbarButton
                title={readingDirection === 'ltr'
                  ? viewerText('viewer.toolbar.reading_direction_ltr', '읽기방향: 왼쪽에서 오른쪽')
                  : viewerText('viewer.toolbar.reading_direction_rtl', '읽기방향: 오른쪽에서 왼쪽')}
                iconSrc={leftReadIcon}
                active={readingDirection === 'rtl'}
                onClick={runToolbarAction(() => setReadingDirection(current => current === 'rtl' ? 'ltr' : 'rtl'))}
              />
            </div>
          )}
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.slide_nav_group', '슬라이드 탐색 바')}>
            <ToolbarButton
              title={slideNavOpen
                ? viewerText('viewer.toolbar.hide_slide_nav', '슬라이드 탐색 바 숨기기')
                : viewerText('viewer.toolbar.show_slide_nav', '슬라이드 탐색 바 표시')}
              iconSrc={slideNavigationIcon}
              active={slideNavOpen}
              disabled={!slideNavAvailable}
              onClick={runToolbarAction(() => setSlideNavOpen(current => !current))}
            />
          </div>
          {session?.type === 'comic' && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.cover_group', 'Cover')}>
              <ToolbarButton title={viewerText('viewer.toolbar.cover_first', '첫 장 단독 표시')} active={spreadCoverFirst} onClick={runToolbarAction(() => setSpreadCoverFirst(current => !current))}>Cover</ToolbarButton>
            </div>
          )}
          {supportsNavigationPanel && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.navigation.title', '목차 및 검색')}>
              <ToolbarButton
                title={`${viewerText('viewer.navigation.title', '목차 및 검색')} (${searchShortcut} / ${tocShortcut})`}
                iconSrc={listSearchIcon}
                active={navigationPanelOpen}
                onClick={() => setNavigationPanelOpen(current => !current)}
              />
            </div>
          )}
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.bookmark_group', '책갈피')}>
            <div className="viewer-bookmark-menu-wrap">
              <ToolbarButton title={viewerText('viewer.toolbar.bookmark', '책갈피')} icon="bookmark" active={bookmarkMenuOpen} onClick={() => setBookmarkMenuOpen(current => !current)} />
              {bookmarkMenuOpen && (
                <div className="viewer-bookmark-menu">
                  <button type="button" onClick={addBookmark}>{viewerText('viewer.bookmark.add', '책갈피 추가 (B)')}</button>
                  <button type="button" onClick={clearBookmarks}>{viewerText('viewer.bookmark.clear_all', '책갈피 모두 삭제')}</button>
                  <button type="button" onClick={() => setBookmarkEditorOpen(true)}>{viewerText('viewer.bookmark.edit', '책갈피 편집')}</button>
                  <div className="viewer-bookmark-list">
                    {bookmarks.map(bookmark => (
                      <button key={bookmark.id} type="button" onClick={() => goBookmark(bookmark)}>
                        {bookmark.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.fullscreen', '전체화면 전환')}>
            <ToolbarButton
              title={fullscreenTitle}
              iconSrc={fullScreenIcon}
              active={isFullscreen}
              onClick={runToolbarAction(toggleFullscreen)}
            />
          </div>
          <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.help_group', '사용법')}>
            <ToolbarButton
              title={viewerText('viewer.toolbar.help', '사용법')}
              iconSrc={helpIcon}
              active={helpOpen}
              onClick={() => setHelpOpen(true)}
            />
          </div>
          {supportsSettingsButton && (
            <div className="viewer-tool-cluster" aria-label={viewerText('viewer.toolbar.settings_group', '설정')}>
              <ToolbarButton
                title={translatedSettingsButtonTitle}
                icon="gear"
                active={settingsOpen}
                onClick={() => setSettingsOpen(current => !current)}
              />
            </div>
          )}
        </div>
      </header>
      {session?.type === 'epub' && epubStylesheet ? (
        <style>{epubStylesheet}</style>
      ) : null}
      <main
        className={contentClassName}
        ref={scrollRef}
        tabIndex={-1}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onContextMenu={handleContentContextMenu}
        onDoubleClick={handleContentDoubleClick}
        onPointerDown={handleContentPointerDown}
        onPointerMove={handleContentPointerMove}
        onPointerUp={handleContentPointerUp}
        onPointerCancel={handleContentPointerCancel}
        onLostPointerCapture={handleContentPointerCancel}
        onTouchStart={handleTouchSwipeStart}
        onTouchMove={handleTouchSwipeMove}
        onTouchEnd={handleTouchSwipeEnd}
        onTouchCancel={handleTouchSwipeCancel}
      >
        {renderContent()}
      </main>
      {renderReaderMeasurementStage()}
      {viewerToast && (
        <div className="viewer-toast-layer" aria-live="polite" aria-atomic="true">
          <div key={viewerToast.id} className="viewer-toast" role="status">
            {viewerToast.message}
          </div>
        </div>
      )}
      {slideNavAvailable && (
        <div className={`viewer-slide-nav ${slideNavOpen ? 'is-open' : 'is-closed'}`}>
          <button
            type="button"
            className="viewer-slide-toggle"
            aria-label={slideNavOpen
              ? viewerText('viewer.navigation.close_page_nav', '페이지 네비게이션 닫기')
              : viewerText('viewer.navigation.open_page_nav', '페이지 네비게이션 열기')}
            title={slideNavOpen
              ? viewerText('viewer.navigation.close_page_nav', '페이지 네비게이션 닫기')
              : viewerText('viewer.navigation.open_page_nav', '페이지 네비게이션 열기')}
            aria-expanded={slideNavOpen}
            onClick={runToolbarAction(() => setSlideNavOpen(current => !current))}
          >
            <FaIcon name={slideNavOpen ? 'angleDown' : 'angleUp'} />
          </button>
          <div
            className="viewer-slide-strip"
            aria-label={viewerText('viewer.navigation.page_nav', '페이지 네비게이션')}
            aria-hidden={!slideNavOpen}
            onWheel={handleSlideNavWheel}
          >
            {renderSlideThumbs()}
          </div>
        </div>
      )}
      {supportsNavigationPanel && (
        <ViewerNavigationPanel
          open={navigationPanelOpen}
          session={session}
          thumbnailSrc={navigationThumbnailSrc}
          author={navigationAuthor}
          searchInputRef={navigationSearchInputRef}
          query={bookSearchQuery}
          onQueryChange={setBookSearchQuery}
          onSearch={performBookSearch}
          activeTab={navigationTab}
          onTabChange={setNavigationTab}
          tocItems={tocItems}
          activeTocId={activeTocId}
          highlights={highlights}
          searchResults={bookSearchResults}
          searchLoading={bookSearchLoading}
          onClose={runToolbarAction(() => setNavigationPanelOpen(false))}
          onTocClick={goNavigationPage}
          onHighlightClick={goHighlight}
          onHighlightDelete={deleteHighlight}
          onSearchClick={goSearchResult}
        />
      )}
      {selectionMenu && (
        <div
          className="viewer-context-menu"
          style={{ left: `${selectionMenu.x}px`, top: `${selectionMenu.y}px` }}
          onMouseDown={event => event.stopPropagation()}
        >
          {selectionMenu.kind === 'comic-flow' ? (
            <button type="button" onClick={toggleComicSinglePageFromSelection}>
              {selectionMenu.isSinglePage
                ? viewerText('viewer.context.comic_single_page_clear', '단독장 분리 해제')
                : viewerText('viewer.context.comic_single_page', '이 페이지를 단독장으로 분리')}
            </button>
          ) : (
            <button type="button" onClick={addHighlightFromSelection}>{viewerText('viewer.context.add_highlight', '하이라이트 추가')}</button>
          )}
        </div>
      )}
      <ImageLightbox image={imageLightbox} onClose={() => setImageLightbox(null)} />
      <ViewerHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ReaderSettingsPanel
        open={settingsOpen}
        sessionType={session?.type}
        settings={readerSettings}
        fontGroups={fontGroups}
        backgroundSettings={viewerBackground}
        onBackgroundChange={updateViewerBackground}
        onChange={updateReaderSettings}
        onReset={() => setReaderSettings(normalizeReaderSettings())}
        onClose={runToolbarAction(() => setSettingsOpen(false))}
      />
      {bookmarkEditorOpen && (
        <BookmarkEditor
          bookmarks={bookmarks}
          onClose={() => setBookmarkEditorOpen(false)}
          onDelete={deleteBookmark}
        />
      )}
    </div>
  );
}

export default ViewerApp;
