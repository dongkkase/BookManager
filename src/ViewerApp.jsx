import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { FaIcon } from './components/FaIcon';
import fitWidthOrHeightIcon from './images/fit_width_or_height.svg';
import fitToPageIcon from './images/fit_to_page.svg';
import leftReadIcon from './images/left_read.svg';
import plusMinusIcon from './images/plus_minus.svg';
import readModeDoublePageIcon from './images/read_mode_double_page.svg';
import readModeOnePageIcon from './images/read_mode_one_page.svg';
import readModeScrollIcon from './images/read_mode_scroll.svg';
import showFullSizeIcon from './images/show_full_size.svg';
import slideNavigationIcon from './images/slide_navigation.svg';
import './styles/viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const VIEW_MODES = [
  { id: 'width', label: '가로 맞춤', key: '8', iconSrc: fitWidthOrHeightIcon },
  { id: 'height', label: '높이 맞춤', key: '7', iconSrc: fitWidthOrHeightIcon, rotate: 90 },
  { id: 'fit', label: '전체 크기 맞춤', key: '9', iconSrc: showFullSizeIcon },
  { id: 'actual', label: '원본 크기', key: '0', iconSrc: fitToPageIcon },
];
const FLOW_MODES = [
  { id: 'single', label: '한장보기모드', iconSrc: readModeOnePageIcon },
  { id: 'spread', label: '두장보기모드', iconSrc: readModeDoublePageIcon },
  { id: 'scroll', label: '스크롤모드', iconSrc: readModeScrollIcon },
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
  fontSize: 14,
  lineHeightStep: 4,
  wrapMode: 'word',
  pageEffect: 'none',
};
const LINE_HEIGHT_MAX_STEP = 16;
const WRAP_OPTIONS = [
  { id: 'word', label: '단어단위' },
  { id: 'char', label: '글자단위' },
];
const PAGE_EFFECT_OPTIONS = [
  { id: 'none', label: '효과없음' },
  { id: 'slide', label: '슬라이드' },
  { id: 'page', label: '책 넘김' },
];
const ZOOM_MIN = 10;
const ZOOM_MAX = 500;
const ZOOM_STEP = 10;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function storageKey(session, suffix) {
  return session?.filePath ? `bookmanager-viewer-${suffix}:${session.filePath}` : '';
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

function lineHeightPercentFromStep(step) {
  return Math.round(((clamp(Number(step) || 1, 1, LINE_HEIGHT_MAX_STEP) - 1) / (LINE_HEIGHT_MAX_STEP - 1)) * 200);
}

function normalizeReaderSettings(settings = {}) {
  const merged = { ...DEFAULT_READER_SETTINGS, ...settings };
  return {
    ...merged,
    fontSize: clamp(Number(merged.fontSize) || DEFAULT_READER_SETTINGS.fontSize, 9, 30),
    lineHeightStep: clamp(Number(merged.lineHeightStep) || DEFAULT_READER_SETTINGS.lineHeightStep, 1, LINE_HEIGHT_MAX_STEP),
    wrapMode: WRAP_OPTIONS.some(item => item.id === merged.wrapMode) ? merged.wrapMode : DEFAULT_READER_SETTINGS.wrapMode,
    pageEffect: PAGE_EFFECT_OPTIONS.some(item => item.id === merged.pageEffect) ? merged.pageEffect : DEFAULT_READER_SETTINGS.pageEffect,
  };
}

function splitSentences(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？]|다\.|요\.)\s+/u)
    .map(value => value.trim())
    .filter(Boolean);
}

function paginateText(text = '', maxChars = 1800) {
  const paragraphs = String(text || '').split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const pages = [];
  let current = '';
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [String(text || '')]) {
    if ((current.length + paragraph.length) > maxChars && current) {
      pages.push(current.trim());
      current = '';
    }
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length > 0 ? pages : [''];
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
  const selected = options.find(option => option.id === value) || options[0] || { id: '', label: '' };

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
        title={title || selected.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span>{selected.label}</span>
        <FaIcon name="caretDown" size={11} />
      </button>
      {open && (
        <div className="viewer-dropdown-menu" role="listbox">
          {options.map(option => (
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
              <span>{option.label}</span>
              {option.id === selected.id ? <FaIcon name="check" size={11} /> : null}
            </button>
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
        title="확대/축소"
        iconSrc={plusMinusIcon}
        active={open}
        onClick={() => setOpen(current => !current)}
      />
      {open && (
        <div className="viewer-zoom-menu" role="dialog" aria-label="확대/축소 조절">
          <span className="viewer-zoom-value">{zoom}%</span>
          <input
            className="viewer-zoom-range"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            title="확대/축소 배율"
            aria-label="확대/축소 배율"
            onChange={event => onZoomChange(Number(event.target.value))}
          />
          <button type="button" className="viewer-zoom-reset" title="확대/축소 리셋" onClick={onReset}>
            리셋
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
          <h2>책갈피 편집</h2>
          <button type="button" onClick={onClose} aria-label="닫기">
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
              <button type="button" onClick={() => onDelete(bookmark.id)}>삭제</button>
            </div>
          )) : <div className="viewer-state">저장된 책갈피가 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}

function PdfPageCanvas({ pdfDocument, pageNumber, containerWidth, containerHeight, pageSlots, viewMode, zoom, active }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [pageSize, setPageSize] = useState(null);

  useEffect(() => {
    setVisible(pageNumber <= 2);
    setStatus('idle');
    setError('');
    setPageSize(null);
  }, [pdfDocument, pageNumber]);

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
          renderTaskRef.current = null;
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
        <canvas ref={canvasRef} />
        {status !== 'ready' && (
          <div className="viewer-pdf-page-state">
            {status === 'error' ? error || 'PDF page unavailable' : 'Loading...'}
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
      aria-label={`${pageNumber} 페이지로 이동`}
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
      aria-label={`${pageNumber} 페이지로 이동`}
    >
      <span className="viewer-slide-thumb-canvas">
        {src ? (
          <img
            src={src}
            alt={page?.basename || `${pageNumber} 페이지`}
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
      aria-label={`${pageNumber} 페이지로 이동`}
    >
      <span className="viewer-slide-thumb-canvas">
        <span className="viewer-slide-thumb-reader-preview">
          <strong>{pageNumber}</strong>
          <small>{text || '내용 없음'}</small>
        </span>
      </span>
      <span>{pageNumber}</span>
    </button>
  );
}

function ReaderSettingsPanel({ open, settings, fonts, onChange, onReset, onClose }) {
  const theme = THEMES.find(item => item.id === settings.theme) || THEMES[0];
  const fontOptions = fonts.map(font => ({ id: font, label: font }));
  return (
    <aside className={`viewer-settings-panel ${open ? 'is-open' : ''}`}>
      <div className="viewer-settings-header">
        <h2>읽기 설정</h2>
        <button type="button" onClick={onClose} aria-label="닫기"><FaIcon name="xmark" /></button>
      </div>
      <label>
        <span>테마</span>
        <ViewerDropdown
          value={settings.theme}
          options={THEMES.map(item => ({ id: item.id, label: item.label }))}
          onChange={themeId => onChange({ theme: themeId })}
        />
      </label>
      <div className="viewer-theme-preview" style={{ background: theme.bg, color: theme.fg }}>
        Aa 가나다
      </div>
      <label>
        <span>글꼴</span>
        <ViewerDropdown
          value={settings.fontFamily}
          options={fontOptions}
          onChange={fontFamily => onChange({ fontFamily })}
        />
      </label>
      <div className="viewer-step-row">
        <span>글자크기</span>
        <button type="button" onClick={() => onChange({ fontSize: clamp(settings.fontSize - 1, 9, 30) })}>-</button>
        <strong>{settings.fontSize}px</strong>
        <button type="button" onClick={() => onChange({ fontSize: clamp(settings.fontSize + 1, 9, 30) })}>+</button>
      </div>
      <div className="viewer-step-row">
        <span>줄간격</span>
        <button type="button" onClick={() => onChange({ lineHeightStep: clamp(settings.lineHeightStep - 1, 1, LINE_HEIGHT_MAX_STEP) })}>-</button>
        <strong>{lineHeightPercentFromStep(settings.lineHeightStep)}%</strong>
        <button type="button" onClick={() => onChange({ lineHeightStep: clamp(settings.lineHeightStep + 1, 1, LINE_HEIGHT_MAX_STEP) })}>+</button>
      </div>
      <label>
        <span>줄바꿈</span>
        <ViewerDropdown
          value={settings.wrapMode}
          options={WRAP_OPTIONS}
          onChange={wrapMode => onChange({ wrapMode })}
        />
      </label>
      <label>
        <span>넘김효과</span>
        <ViewerDropdown
          value={settings.pageEffect}
          options={PAGE_EFFECT_OPTIONS}
          onChange={pageEffect => onChange({ pageEffect })}
        />
      </label>
      <button type="button" className="viewer-settings-reset" onClick={onReset}>초기화</button>
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
  const [flowMode, setFlowMode] = useState('single');
  const [viewMode, setViewMode] = useState('fit');
  const [zoom, setZoom] = useState(100);
  const [readingDirection, setReadingDirection] = useState('ltr');
  const [spreadCoverFirst, setSpreadCoverFirst] = useState(true);
  const [readerSettings, setReaderSettings] = useState(normalizeReaderSettings());
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarkMenuOpen, setBookmarkMenuOpen] = useState(false);
  const [bookmarkEditorOpen, setBookmarkEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slideNavOpen, setSlideNavOpen] = useState(true);
  const [fonts, setFonts] = useState(['Noto Sans KR', 'NanumGothic', 'Malgun Gothic', 'Segoe UI']);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [readerViewport, setReaderViewport] = useState({ width: 900, height: 700 });
  const [loading, setLoading] = useState(false);
  const [adjacentLoading, setAdjacentLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);
  const visibleReaderIndexRef = useRef(0);
  const loadingPagesRef = useRef(new Set());
  const loadSequenceRef = useRef(0);
  const adjacentLoadingRef = useRef(false);
  const documentAbortRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const pdfLoadingTaskRef = useRef(null);
  const pdfPendingScrollRef = useRef(null);
  const dragPanRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const isReaderDocument = session?.type === 'epub' || session?.type === 'text';
  const theme = THEMES.find(item => item.id === readerSettings.theme) || THEMES[0];
  const lineHeightPercent = lineHeightPercentFromStep(readerSettings.lineHeightStep);
  const lineHeight = 1 + (lineHeightPercent / 100);
  const readerFontSize = readerSettings.fontSize * ((Number(zoom) || 100) / 100);
  const readerPageChars = useMemo(() => {
    const pageColumns = flowMode === 'spread' ? 2 : 1;
    const stageGap = 0;
    const pageOuterPadding = 84;
    const availableWidth = Math.max(280, Math.min(980, readerViewport.width - 28));
    const pageWidth = Math.max(220, ((availableWidth - stageGap) / pageColumns) - pageOuterPadding);
    const charWidth = readerSettings.wrapMode === 'char'
      ? readerFontSize
      : readerFontSize * 0.62;
    const charsPerLine = Math.max(12, Math.floor(pageWidth / Math.max(6, charWidth)));
    const availableHeight = Math.max(260, readerViewport.height - 116);
    const linesPerPage = Math.max(8, Math.floor(availableHeight / Math.max(10, readerFontSize * lineHeight)));
    return clamp(Math.floor(charsPerLine * linesPerPage * 0.86), 320, 2600);
  }, [flowMode, lineHeight, readerFontSize, readerSettings.wrapMode, readerViewport.height, readerViewport.width]);
  const textPages = useMemo(() => paginateText(textContent, readerPageChars), [readerPageChars, textContent]);
  const epubPages = useMemo(() => (
    epubChapters.flatMap(chapter => paginateText(chapter.text, readerPageChars).map((text, index) => ({
      title: index === 0 ? chapter.title : `${chapter.title} (${index + 1})`,
      text,
    })))
  ), [epubChapters, readerPageChars]);
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
  const updateReaderSettings = patch => {
    setReaderSettings(current => normalizeReaderSettings({ ...current, ...patch }));
  };
  const setZoomValue = useCallback(value => {
    setZoom(clamp(Number(value) || 100, ZOOM_MIN, ZOOM_MAX));
  }, []);
  const adjustZoom = useCallback(delta => {
    setZoom(current => clamp((Number(current) || 100) + delta, ZOOM_MIN, ZOOM_MAX));
  }, []);
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

  const persistState = useCallback((patch = {}) => {
    if (!session) return;
    const key = storageKey(session, 'state');
    const current = readJson(key, {});
    saveJson(key, {
      ...current,
      flowMode,
      viewMode,
      zoom,
      readingDirection,
      spreadCoverFirst,
      readerSettings,
      pageIndex,
      scrollPercent,
      slideNavOpen,
      ...patch,
    });
  }, [flowMode, pageIndex, readerSettings, readingDirection, scrollPercent, session, slideNavOpen, spreadCoverFirst, viewMode, zoom]);

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

  const scrollPdfPageIntoView = useCallback(index => {
    const targetIndex = Math.max(0, Number(index) || 0);
    window.requestAnimationFrame(() => {
      const pageNode = scrollRef.current?.querySelector?.(`[data-pdf-page-index="${targetIndex}"]`);
      pageNode?.scrollIntoView?.({ block: 'start' });
    });
  }, []);

  const goPdfPage = useCallback(index => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pdfPageCount - 1));
    setPageIndex(targetIndex);
    scrollPdfPageIntoView(targetIndex);
  }, [pdfPageCount, scrollPdfPageIntoView]);
  const goPageIndex = useCallback(index => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(0, pageCount - 1));
    if (session?.type === 'pdf') {
      goPdfPage(targetIndex);
      return;
    }
    setPageIndex(targetIndex);
    if (session?.type === 'epub' || session?.type === 'text') {
      visibleReaderIndexRef.current = targetIndex;
    }
    window.requestAnimationFrame(() => {
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
    });
  }, [flowMode, goPdfPage, pageCount, session?.type]);

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
    setError('');
    setLoading(true);
    setScrollPercent(0);
    visibleReaderIndexRef.current = 0;
    loadingPagesRef.current.clear();
    scrollRef.current?.scrollTo?.({ top: 0 });

    const saved = readJson(storageKey(nextSession, 'state'), {});
    const savedPageIndex = Math.max(0, Number(saved.pageIndex) || 0);
    setFlowMode(saved.flowMode || 'single');
    setViewMode(saved.viewMode || 'fit');
    setZoom(clamp(Number(saved.zoom) || 100, ZOOM_MIN, ZOOM_MAX));
    setReadingDirection(saved.readingDirection || 'ltr');
    setSpreadCoverFirst(saved.spreadCoverFirst !== false);
    setSlideNavOpen(saved.slideNavOpen !== false);
    setReaderSettings(normalizeReaderSettings(saved.readerSettings || {}));
    setBookmarks(readJson(storageKey(nextSession, 'bookmarks'), []));
    setPageIndex(savedPageIndex);

    try {
      if (nextSession.type === 'comic') {
        const result = await window.viewerAPI.listComicPages(nextSession.id);
        if (!isCurrentLoad()) return;
        const listedPages = Array.isArray(result) ? result : (result.pages || []);
        setPages(listedPages);
        setReadingDirection(saved.readingDirection || result.readingDirection || 'ltr');
        setPageIndex(clamp(savedPageIndex, 0, Math.max(0, listedPages.length - 1)));
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
        setPageIndex(initialPageIndex);
      } else if (nextSession.type === 'epub') {
        const result = await window.viewerAPI.getEpubText(nextSession.id);
        if (!isCurrentLoad()) return;
        setEpubChapters(Array.isArray(result.chapters) ? result.chapters : []);
      } else if (nextSession.type === 'text') {
        const result = await window.viewerAPI.getText(nextSession.id, { encoding: 'auto' });
        if (!isCurrentLoad()) return;
        setTextContent(result.text || '');
      } else {
        setError('지원하지 않는 형식입니다.');
      }
      window.requestAnimationFrame(() => {
        const savedScrollPercent = Number(saved.scrollPercent) || 0;
        const node = scrollRef.current;
        if (node && saved.flowMode === 'scroll' && savedScrollPercent > 0) {
          node.scrollTop = ((node.scrollHeight - node.clientHeight) * savedScrollPercent) / 100;
        }
      });
    } catch (loadError) {
      if (isCurrentLoad() && loadError?.name !== 'AbortError') {
        setError(loadError.message || String(loadError));
      }
    } finally {
      if (isCurrentLoad()) documentAbortRef.current = null;
      if (isCurrentLoad()) setLoading(false);
    }
  }, [clearDocumentFrame]);

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

  useEffect(() => {
    window.viewerAPI?.getCurrentSession?.().then(loadSession).catch(() => {});
    const unsubscribe = window.viewerAPI?.onLoadSession?.(loadSession);
    window.viewerAPI?.listBundledFonts?.().then(bundled => {
      window.viewerAPI?.listSystemFonts?.().then(system => {
        const bundledNames = (bundled || []).map(font => font.family || font.name || font).filter(Boolean);
        const systemNames = (system || []).map(font => font.family || font.name || font).filter(Boolean);
        setFonts(current => [...new Set([...bundledNames, ...systemNames, ...current])].slice(0, 300));
      }).catch(() => {});
    }).catch(() => {});
    return () => unsubscribe?.();
  }, [loadSession]);

  useEffect(() => () => {
    clearDocumentFrame();
  }, [clearDocumentFrame]);

  useEffect(() => {
    if (session?.type !== 'pdf' || !pdfDocument || pdfPageCount <= 0) return;
    if (pdfPendingScrollRef.current == null) return;
    const pendingPageIndex = pdfPendingScrollRef.current;
    pdfPendingScrollRef.current = null;
    scrollPdfPageIntoView(pendingPageIndex);
  }, [pdfDocument, pdfPageCount, scrollPdfPageIntoView, session?.type]);

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
    if (pageCount > 0 && pageIndex >= pageCount) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex]);

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

  const stepSize = useMemo(() => {
    if (flowMode !== 'spread') return 1;
    if (session?.type !== 'comic') return 2;
    if (spreadCoverFirst && pageIndex === 0) return 1;
    const current = pages[pageIndex];
    if (!current || (pageRatios[current.name] || 0) > 1) return 1;
    const next = pages[pageIndex + 1];
    if (!next || (pageRatios[next.name] || 0) > 1) return 1;
    return 2;
  }, [flowMode, pageIndex, pageRatios, pages, session?.type, spreadCoverFirst]);

  const movePage = useCallback(delta => {
    if (session?.type === 'pdf') {
      const size = flowMode === 'spread' ? 2 : 1;
      const nextIndex = clamp(pageIndex + (delta > 0 ? size : -size), 0, Math.max(0, pageCount - 1));
      goPdfPage(nextIndex);
      return;
    }
    if (flowMode === 'scroll') {
      const node = scrollRef.current;
      if (node) node.scrollBy({ top: delta > 0 ? node.clientHeight * 0.85 : -node.clientHeight * 0.85, behavior: 'auto' });
      return;
    }
    const size = flowMode === 'spread' ? stepSize : 1;
    setPageIndex(current => clamp(current + (delta > 0 ? size : -size), 0, Math.max(0, pageCount - 1)));
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ top: 0 }));
  }, [flowMode, goPdfPage, pageCount, pageIndex, session?.type, stepSize]);

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
    setPageIndex(targetPageIndex);
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

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const max = Math.max(1, node.scrollHeight - node.clientHeight);
    const percent = clamp((node.scrollTop / max) * 100, 0, 100);
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
      if (Number.isFinite(index)) setPageIndex(clamp(index, 0, Math.max(0, pdfPageCount - 1)));
    } else if (flowMode === 'scroll' && session?.type === 'comic' && pages.length > 0) {
      const imageNodes = [...node.querySelectorAll('[data-page-index]')];
      const firstVisible = imageNodes.find(img => img.getBoundingClientRect().bottom > 48);
      const index = Number(firstVisible?.getAttribute('data-page-index'));
      if (Number.isFinite(index)) setPageIndex(index);
    } else if (flowMode === 'scroll' && (session?.type === 'epub' || session?.type === 'text')) {
      const readerNodes = [...node.querySelectorAll('[data-reader-index]')];
      const firstVisible = readerNodes.find(section => section.getBoundingClientRect().bottom > 48);
      const index = Number(firstVisible?.getAttribute('data-reader-index'));
      if (Number.isFinite(index)) {
        visibleReaderIndexRef.current = index;
        setPageIndex(index);
      }
    }
  };

  const handleWheel = event => {
    if (session?.type === 'pdf') {
      if (flowMode === 'scroll') return;
      event.preventDefault();
      if (event.deltaY > 0) movePage(1);
      else if (event.deltaY < 0) movePage(-1);
      return;
    }
    if (flowMode === 'scroll') return;
    event.preventDefault();
    if (event.deltaY > 0) movePage(1);
    else if (event.deltaY < 0) movePage(-1);
  };

  const isViewerInteractiveTarget = useCallback(target => {
    const targetName = target?.tagName?.toLowerCase();
    if (['input', 'select', 'textarea', 'button', 'a'].includes(targetName)) return true;
    if (target?.isContentEditable) return true;
    return Boolean(target?.closest?.(
      '.viewer-toolbar, .viewer-slide-nav, .viewer-dropdown, .viewer-bookmark-menu, .viewer-modal-backdrop, .viewer-settings-panel, .viewer-zoom-menu'
    ));
  }, []);

  const toggleFullscreen = useCallback(() => {
    window.viewerAPI?.toggleFullscreen?.().catch?.(() => {});
  }, []);

  const handleContentDoubleClick = useCallback(event => {
    if (isViewerInteractiveTarget(event.target)) return;
    event.preventDefault();
    toggleFullscreen();
  }, [isViewerInteractiveTarget, toggleFullscreen]);

  const isDragPanTarget = useCallback(target => {
    if (!(session?.type === 'comic' || session?.type === 'pdf')) return false;
    return Boolean(target?.closest?.('.viewer-comic-image, .viewer-pdf-canvas-wrap'));
  }, [session?.type]);

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
    const canPanX = node.scrollWidth > node.clientWidth + 1;
    const canPanY = node.scrollHeight > node.clientHeight + 1;
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
  }, [isDragPanTarget]);

  const handleDragPanPointerMove = useCallback(event => {
    const state = dragPanRef.current;
    if (!state.active || state.pointerId !== event.pointerId) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollLeft = state.scrollLeft - (event.clientX - state.startX);
    node.scrollTop = state.scrollTop - (event.clientY - state.startY);
    event.preventDefault();
  }, []);

  useEffect(() => {
    const handler = event => {
      if (isViewerInteractiveTarget(event.target)) return;
      if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault();
        toggleFullscreen();
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
      } else if (event.key === '9' && (session?.type === 'comic' || session?.type === 'pdf')) {
        setViewMode('fit');
      } else if (event.key === '8' && (session?.type === 'comic' || session?.type === 'pdf')) {
        setViewMode('width');
      } else if (event.key === '7' && (session?.type === 'comic' || session?.type === 'pdf')) {
        setViewMode('height');
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        addBookmark();
      } else if (event.key === 'Home') {
        if (session?.type === 'pdf') goPdfPage(0);
        else setPageIndex(0);
        if (session?.type !== 'pdf') scrollRef.current?.scrollTo?.({ top: 0 });
      } else if (event.key === 'End') {
        const lastPageIndex = Math.max(0, pageCount - 1);
        if (session?.type === 'pdf') goPdfPage(lastPageIndex);
        else {
          setPageIndex(lastPageIndex);
          if (flowMode === 'scroll') scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
        }
      } else if (event.key === 'Escape') {
        window.viewerAPI?.closeWindow?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addBookmark, adjustZoom, flowMode, goPdfPage, isViewerInteractiveTarget, moveAdjacentBook, movePage, pageCount, session?.type, toggleFullscreen]);

  const comicSpreadPages = useMemo(() => {
    if (pageCount === 0) return [];
    const current = pages[pageIndex];
    if (!current) return [];
    const currentRatio = pageRatios[current.name] || 0;
    if (flowMode !== 'spread' || (spreadCoverFirst && pageIndex === 0) || currentRatio > 1) return [current];
    const next = pages[pageIndex + 1];
    if (!next || (pageRatios[next.name] || 0) > 1) return [current];
    return readingDirection === 'rtl' ? [next, current] : [current, next];
  }, [flowMode, pageCount, pageIndex, pageRatios, pages, readingDirection, spreadCoverFirst]);

  const imageClassName = `viewer-comic-image view-${viewMode}`;
  const getComicImageStyle = (page, pageSlots = 1) => {
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
      zoom,
    });
    return {
      width: `${scaledSize.width}px`,
      height: `${scaledSize.height}px`,
      maxWidth: 'none',
      maxHeight: 'none',
      flex: '0 0 auto',
    };
  };
  const renderComicImage = (page, fallbackIndex = 0, pageSlots = 1) => {
    const index = Number.isFinite(page?.index) ? page.index : fallbackIndex;
    const src = pageData[page.name] || page?.pageUrl;
    const pageError = pageErrors[page.name];
    if (pageError && !pageData[page.name]) {
      return (
        <div key={page.name} className="viewer-comic-placeholder is-error" data-page-index={index}>
          {page.basename || page.name} 이미지를 불러오지 못했습니다.
        </div>
      );
    }
    if (!src) {
      return (
        <div key={page.name} className="viewer-comic-placeholder" data-page-index={index}>
          Loading...
        </div>
      );
    }
    return (
      <img
        key={page.name}
        data-page-index={index}
        className={imageClassName}
        src={src}
        alt={page.basename}
        style={getComicImageStyle(page, pageSlots)}
        onLoad={event => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          setPageRatios(prev => ({
            ...prev,
            [page.name]: naturalWidth / Math.max(1, naturalHeight),
          }));
          setPageSizes(prev => ({
            ...prev,
            [page.name]: {
              width: Math.max(1, naturalWidth),
              height: Math.max(1, naturalHeight),
            },
          }));
        }}
        onError={() => {
          if (page?.pageUrl && !pageData[page.name]) {
            loadComicPage(index, { force: true });
            return;
          }
          setPageErrors(prev => ({
            ...prev,
            [page.name]: `${page.basename || page.name} 이미지를 불러오지 못했습니다.`,
          }));
        }}
      />
    );
  };

  const renderComic = () => {
    if (loading) return <div className="viewer-state">Loading...</div>;
    if (pageCount === 0) return <div className="viewer-state">No pages</div>;
    if (flowMode === 'scroll') {
      return (
        <div className="viewer-comic-scroll">
          {pages.map((page, index) => renderComicImage(page, index, 1))}
        </div>
      );
    }
    const hasSpreadPair = flowMode === 'spread' && comicSpreadPages.length > 1;
    const pageSlots = hasSpreadPair ? 2 : 1;
    const comicStageClassName = `viewer-comic-stage is-${viewMode} ${flowMode === 'spread' ? 'is-spread' : ''} ${hasSpreadPair ? 'has-spread-pair' : ''}`.trim();
    const comicPages = comicSpreadPages.map((page, index) => renderComicImage(page, index, pageSlots));
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
    '--viewer-reader-word-break': readerSettings.wrapMode === 'char' ? 'break-all' : 'keep-all',
  };

  const renderReaderPages = items => {
    if (flowMode === 'scroll') {
      return (
        <article className="viewer-text-page is-scroll" style={readerStyle}>
          {items.map((item, index) => (
            <section key={`${item.title || 'page'}-${index}`} className="viewer-epub-chapter" data-reader-index={index}>
              {item.title ? <h2>{item.title}</h2> : null}
              <pre>{item.text || item}</pre>
            </section>
          ))}
        </article>
      );
    }
    const visible = flowMode === 'spread'
      ? [items[pageIndex], items[pageIndex + 1]].filter(Boolean)
      : [items[pageIndex]].filter(Boolean);
    const hasSpreadPair = flowMode === 'spread' && visible.length > 1;
    const readerStageClassName = `viewer-reader-stage ${flowMode === 'spread' ? 'is-spread' : ''} ${hasSpreadPair ? 'has-spread-pair' : ''}`.trim();
    const readerPages = visible.map((item, index) => (
      <article key={`${pageIndex}-${index}`} className="viewer-text-page" style={readerStyle}>
        {item.title ? <h2>{item.title}</h2> : null}
        <pre>{item.text || item}</pre>
      </article>
    ));
    return (
      <div className={readerStageClassName}>
        {hasSpreadPair ? <div className="viewer-spread-pair">{readerPages}</div> : readerPages}
      </div>
    );
  };

  const renderPdf = () => {
    if (!pdfDocument || pdfPageCount <= 0) {
      return <div className="viewer-state">{loading ? 'Loading...' : 'PDF unavailable'}</div>;
    }
    const pageIndexes = flowMode === 'scroll'
      ? Array.from({ length: pdfPageCount }, (_, index) => index)
      : flowMode === 'spread'
        ? [pageIndex, pageIndex + 1].filter(index => index >= 0 && index < pdfPageCount)
        : [pageIndex].filter(index => index >= 0 && index < pdfPageCount);
    const hasSpreadPair = flowMode === 'spread' && pageIndexes.length > 1;
    const pageSlots = hasSpreadPair ? 2 : 1;
    const pdfStageClassName = `viewer-pdf-stage is-${flowMode} is-${viewMode} ${hasSpreadPair ? 'has-spread-pair' : ''}`.trim();
    const pdfPages = pageIndexes.map(index => (
      <PdfPageCanvas
        key={`${session?.id || 'pdf'}-${index}`}
        pdfDocument={pdfDocument}
        pageNumber={index + 1}
        containerWidth={readerViewport.width}
        containerHeight={readerViewport.height}
        pageSlots={pageSlots}
        viewMode={viewMode}
        zoom={zoom}
        active={index === pageIndex}
      />
    ));
    return (
      <div className={pdfStageClassName}>
        {hasSpreadPair ? <div className="viewer-spread-pair">{pdfPages}</div> : pdfPages}
      </div>
    );
  };

  const renderContent = () => {
    if (error) return <div className="viewer-state viewer-error">{error}</div>;
    if (!session) return <div className="viewer-state">No book</div>;
    if (loading && (session.type === 'text' || session.type === 'epub')) return <div className="viewer-state">Loading...</div>;
    if (session.type === 'comic') return renderComic();
    if (session.type === 'pdf') return renderPdf();
    if (session.type === 'text') return renderReaderPages(textPages.map(text => ({ text })));
    if (session.type === 'epub') return renderReaderPages(epubPages);
    return <div className="viewer-state">Unsupported</div>;
  };
  const supportsFlowControls = session?.type === 'comic' || session?.type === 'pdf' || isReaderDocument;
  const supportsViewControls = session?.type === 'comic' || session?.type === 'pdf';
  const supportsZoomControls = session?.type === 'comic' || session?.type === 'pdf' || isReaderDocument;
  const supportsSettingsButton = session?.type === 'comic' || isReaderDocument;
  const settingsButtonTitle = session?.type === 'comic' ? '만화책 설정' : '읽기 설정';
  const previousPageDisabled = session?.type === 'pdf'
    ? pageCount <= 0 || pageIndex <= 0
    : flowMode !== 'scroll' && pageIndex <= 0;
  const nextPageDisabled = session?.type === 'pdf'
    ? pageCount <= 0 || pageIndex >= pageCount - (flowMode === 'spread' ? 2 : 1)
    : flowMode !== 'scroll' && pageIndex >= pageCount - 1;
  const slideNavAvailable = Boolean(session && pageCount > 0 && (session.type !== 'pdf' || pdfDocument));
  const appClassName = `viewer-app ${slideNavAvailable && slideNavOpen ? 'has-slide-nav-open' : ''}`.trim();
  const contentClassName = `viewer-content ${isReaderDocument && flowMode !== 'scroll' ? 'is-reader-paged' : ''}`.trim();
  const renderSlideThumbs = () => {
    if (!slideNavAvailable) return null;
    if (session?.type === 'pdf') {
      return Array.from({ length: pdfPageCount }, (_, index) => (
        <PdfThumbnailCanvas
          key={`${session?.id || 'pdf-thumb'}-${index}`}
          pdfDocument={pdfDocument}
          pageNumber={index + 1}
          active={index === pageIndex}
          onClick={() => goPageIndex(index)}
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
            onClick={() => goPageIndex(index)}
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
          onClick={() => goPageIndex(index)}
        />
      ));
    }
    return null;
  };

  return (
    <div className={appClassName}>
      <header className="viewer-toolbar">
        <div className="viewer-title" title={session?.filePath || ''}>
          <span>{session?.fileName || 'BookManager Viewer'}</span>
          <small>{progressText}</small>
        </div>
        <div className="viewer-tool-group">
          <div className="viewer-tool-cluster" aria-label="파일 이동">
            <ToolbarButton title="이전파일 ([)" icon="anglesLeft" disabled={!hasPreviousBook || adjacentLoading} onClick={() => moveAdjacentBook(-1)} />
            <ToolbarButton title="다음파일 (])" icon="anglesRight" disabled={!hasNextBook || adjacentLoading} onClick={() => moveAdjacentBook(1)} />
          </div>
          <div className="viewer-tool-cluster" aria-label="페이지 이동">
            <ToolbarButton title="이전장" icon="angleLeft" disabled={previousPageDisabled} onClick={() => movePage(-1)} />
            <ToolbarButton title="다음장" icon="angleRight" disabled={nextPageDisabled} onClick={() => movePage(1)} />
          </div>
          {supportsViewControls && (
            <div className="viewer-tool-cluster" aria-label="화면맞춤">
              {VIEW_MODES.map(option => (
                <ToolbarButton
                  key={option.id}
                  title={option.label}
                  iconSrc={option.iconSrc}
                  iconRotate={option.rotate || 0}
                  active={viewMode === option.id}
                  onClick={() => {
                    setViewMode(option.id);
                    if (option.id === 'actual') setZoom(100);
                  }}
                />
              ))}
            </div>
          )}
          {supportsZoomControls && (
            <div className="viewer-tool-cluster" aria-label="확대/축소">
              <ZoomControl
                zoom={zoom}
                onZoomChange={setZoomValue}
                onReset={() => setZoom(100)}
                onWheel={handleZoomWheel}
              />
            </div>
          )}
          {supportsFlowControls && (
            <div className="viewer-tool-cluster" aria-label="읽기모드">
              {FLOW_MODES.map(option => (
                <ToolbarButton
                  key={option.id}
                  title={option.label}
                  iconSrc={option.iconSrc}
                  active={flowMode === option.id}
                  onClick={() => setFlowMode(option.id)}
                />
              ))}
            </div>
          )}
          {session?.type === 'comic' && (
            <div className="viewer-tool-cluster" aria-label="읽기방향">
              <ToolbarButton
                title={readingDirection === 'ltr' ? '읽기방향: 왼쪽에서 오른쪽' : '읽기방향: 오른쪽에서 왼쪽'}
                iconSrc={leftReadIcon}
                active={readingDirection === 'rtl'}
                onClick={() => setReadingDirection(current => current === 'rtl' ? 'ltr' : 'rtl')}
              />
            </div>
          )}
          <div className="viewer-tool-cluster" aria-label="슬라이드 탐색 바">
            <ToolbarButton
              title={slideNavOpen ? '슬라이드 탐색 바 숨기기' : '슬라이드 탐색 바 표시'}
              iconSrc={slideNavigationIcon}
              active={slideNavOpen}
              disabled={!slideNavAvailable}
              onClick={() => setSlideNavOpen(current => !current)}
            />
          </div>
          {session?.type === 'comic' && (
            <div className="viewer-tool-cluster" aria-label="Cover">
              <ToolbarButton title="첫 장 단독 표시" active={spreadCoverFirst} onClick={() => setSpreadCoverFirst(current => !current)}>Cover</ToolbarButton>
            </div>
          )}
          <div className="viewer-tool-cluster" aria-label="책갈피">
            <div className="viewer-bookmark-menu-wrap">
              <ToolbarButton title="책갈피" icon="bookmark" active={bookmarkMenuOpen} onClick={() => setBookmarkMenuOpen(current => !current)} />
              {bookmarkMenuOpen && (
                <div className="viewer-bookmark-menu">
                  <button type="button" onClick={addBookmark}>책갈피 추가 (B)</button>
                  <button type="button" onClick={clearBookmarks}>책갈피 모두 삭제</button>
                  <button type="button" onClick={() => setBookmarkEditorOpen(true)}>책갈피 편집</button>
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
          {supportsSettingsButton && (
            <div className="viewer-tool-cluster" aria-label="설정">
              <ToolbarButton
                title={settingsButtonTitle}
                icon="gear"
                onClick={() => {
                  if (isReaderDocument) setSettingsOpen(true);
                }}
              />
            </div>
          )}
        </div>
      </header>
      <main
        className={contentClassName}
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onDoubleClick={handleContentDoubleClick}
        onPointerDown={handleDragPanPointerDown}
        onPointerMove={handleDragPanPointerMove}
        onPointerUp={endDragPan}
        onPointerCancel={endDragPan}
        onLostPointerCapture={endDragPan}
      >
        {renderContent()}
      </main>
      {slideNavAvailable && (
        <div className={`viewer-slide-nav ${slideNavOpen ? 'is-open' : 'is-closed'}`}>
          <button
            type="button"
            className="viewer-slide-toggle"
            aria-label={slideNavOpen ? '페이지 네비게이션 닫기' : '페이지 네비게이션 열기'}
            title={slideNavOpen ? '페이지 네비게이션 닫기' : '페이지 네비게이션 열기'}
            aria-expanded={slideNavOpen}
            onClick={() => setSlideNavOpen(current => !current)}
          >
            <FaIcon name={slideNavOpen ? 'angleDown' : 'angleUp'} />
          </button>
          {slideNavOpen && (
            <div className="viewer-slide-strip" aria-label="페이지 네비게이션" onWheel={handleSlideNavWheel}>
              {renderSlideThumbs()}
            </div>
          )}
        </div>
      )}
      <ReaderSettingsPanel
        open={settingsOpen}
        settings={readerSettings}
        fonts={fonts}
        onChange={updateReaderSettings}
        onReset={() => setReaderSettings(normalizeReaderSettings())}
        onClose={() => setSettingsOpen(false)}
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
