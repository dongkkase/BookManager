import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from './components/FaIcon';
import './styles/viewer.css';

const VIEW_MODES = [
  { id: 'actual', label: '원본 크기 (100%)', key: '0' },
  { id: 'fit', label: '꽉차게 보기', key: '9' },
  { id: 'width', label: '폭맞춤', key: '8' },
];
const FLOW_MODES = [
  { id: 'single', label: '한장보기' },
  { id: 'spread', label: '두장보기' },
  { id: 'scroll', label: '스크롤' },
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function nextAnimationFrame() {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => resolve());
  });
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

function ToolbarButton({ title, disabled = false, onClick, icon, children, active = false }) {
  return (
    <button
      type="button"
      className={`viewer-tool-button ${active ? 'is-active' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <FaIcon name={icon} /> : null}
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
  const [documentUrl, setDocumentUrl] = useState('');
  const [documentFrameKey, setDocumentFrameKey] = useState('');
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
  const documentBlobUrlRef = useRef('');
  const documentAbortRef = useRef(null);

  const isReaderDocument = session?.type === 'epub' || session?.type === 'text';
  const theme = THEMES.find(item => item.id === readerSettings.theme) || THEMES[0];
  const lineHeightPercent = lineHeightPercentFromStep(readerSettings.lineHeightStep);
  const lineHeight = 1 + (lineHeightPercent / 100);
  const readerPageChars = useMemo(() => {
    const pageColumns = flowMode === 'spread' ? 2 : 1;
    const stageGap = pageColumns === 2 ? 10 : 0;
    const pageOuterPadding = 84;
    const availableWidth = Math.max(280, Math.min(980, readerViewport.width - 28));
    const pageWidth = Math.max(220, ((availableWidth - stageGap) / pageColumns) - pageOuterPadding);
    const charWidth = readerSettings.wrapMode === 'char'
      ? readerSettings.fontSize
      : readerSettings.fontSize * 0.62;
    const charsPerLine = Math.max(12, Math.floor(pageWidth / Math.max(6, charWidth)));
    const availableHeight = Math.max(260, readerViewport.height - 116);
    const linesPerPage = Math.max(8, Math.floor(availableHeight / Math.max(10, readerSettings.fontSize * lineHeight)));
    return clamp(Math.floor(charsPerLine * linesPerPage * 0.86), 320, 2600);
  }, [flowMode, lineHeight, readerSettings.fontSize, readerSettings.wrapMode, readerViewport.height, readerViewport.width]);
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
  const pageCount = flowItems.length;
  const currentPercent = flowMode === 'scroll'
    ? Math.round(scrollPercent)
    : pageCount > 0
      ? Math.round(((pageIndex + 1) / pageCount) * 100)
      : 0;
  const progressText = useMemo(() => {
    if (!session) return '';
    if (session.type === 'pdf') return 'PDF';
    if (flowMode === 'scroll') return `${currentPercent}%`;
    return pageCount > 0 ? `${pageIndex + 1} / ${pageCount} · ${currentPercent}%` : session.type.toUpperCase();
  }, [currentPercent, flowMode, pageCount, pageIndex, session]);
  const hasPreviousBook = Boolean(session?.adjacent?.hasPrevious);
  const hasNextBook = Boolean(session?.adjacent?.hasNext);
  const updateReaderSettings = patch => {
    setReaderSettings(current => normalizeReaderSettings({ ...current, ...patch }));
  };

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
      ...patch,
    });
  }, [flowMode, pageIndex, readerSettings, readingDirection, scrollPercent, session, spreadCoverFirst, viewMode, zoom]);

  const clearDocumentFrame = useCallback(() => {
    documentAbortRef.current?.abort();
    documentAbortRef.current = null;
    if (documentBlobUrlRef.current) {
      URL.revokeObjectURL(documentBlobUrlRef.current);
      documentBlobUrlRef.current = '';
    }
    setDocumentUrl('');
    setDocumentFrameKey('');
  }, []);

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
    setZoom(Number(saved.zoom) || 100);
    setReadingDirection(saved.readingDirection || 'ltr');
    setSpreadCoverFirst(saved.spreadCoverFirst !== false);
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
        const blob = await response.blob();
        if (!isCurrentLoad()) return;
        const blobUrl = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
        await nextAnimationFrame();
        if (!isCurrentLoad()) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        await nextAnimationFrame();
        if (!isCurrentLoad()) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        documentBlobUrlRef.current = blobUrl;
        setDocumentFrameKey(`${nextSession.id}-${loadSequence}`);
        setDocumentUrl(blobUrl);
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
    if (flowMode === 'scroll') {
      const node = scrollRef.current;
      if (node) node.scrollBy({ top: delta > 0 ? node.clientHeight * 0.85 : -node.clientHeight * 0.85, behavior: 'auto' });
      return;
    }
    const size = flowMode === 'spread' ? stepSize : 1;
    setPageIndex(current => clamp(current + (delta > 0 ? size : -size), 0, Math.max(0, pageCount - 1)));
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ top: 0 }));
  }, [flowMode, pageCount, stepSize]);

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
      label: session.type === 'comic'
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
    setFlowMode(bookmark.flowMode || flowMode);
    setPageIndex(clamp(Number(bookmark.pageIndex) || 0, 0, Math.max(0, pageCount - 1)));
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
    if (flowMode === 'scroll' && session?.type === 'comic' && pages.length > 0) {
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
    if (flowMode === 'scroll') return;
    event.preventDefault();
    if (event.deltaY > 0) movePage(1);
    else if (event.deltaY < 0) movePage(-1);
  };

  useEffect(() => {
    const handler = event => {
      const targetName = event.target?.tagName?.toLowerCase();
      if (['input', 'select', 'textarea'].includes(targetName)) return;
      if (event.target?.closest?.('.viewer-dropdown')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
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
      } else if ((event.key === '+' || event.key === '=') && session?.type === 'comic') {
        event.preventDefault();
        setZoom(current => clamp(current + 10, 50, 240));
      } else if (event.key === '-' && session?.type === 'comic') {
        event.preventDefault();
        setZoom(current => clamp(current - 10, 50, 240));
      } else if (event.key === '0' && session?.type === 'comic') {
        setViewMode('actual');
        setZoom(100);
      } else if (event.key === '9' && session?.type === 'comic') {
        setViewMode('fit');
      } else if (event.key === '8' && session?.type === 'comic') {
        setViewMode('width');
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        addBookmark();
      } else if (event.key === 'Home') {
        setPageIndex(0);
        scrollRef.current?.scrollTo?.({ top: 0 });
      } else if (event.key === 'End') {
        setPageIndex(Math.max(0, pageCount - 1));
        if (flowMode === 'scroll') scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
      } else if (event.key === 'Escape') {
        window.viewerAPI?.closeWindow?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addBookmark, flowMode, moveAdjacentBook, movePage, pageCount, session?.type]);

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
  const imageStyle = viewMode === 'actual'
    ? { width: `${zoom}%` }
    : viewMode === 'width'
      ? { width: '100%' }
      : {};
  const renderComicImage = (page, fallbackIndex = 0) => {
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
        style={imageStyle}
        onLoad={event => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          setPageRatios(prev => ({
            ...prev,
            [page.name]: naturalWidth / Math.max(1, naturalHeight),
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
          {pages.map((page, index) => renderComicImage(page, index))}
        </div>
      );
    }
    return (
      <div className={`viewer-comic-stage is-${viewMode} ${flowMode === 'spread' ? 'is-spread' : ''}`}>
        {comicSpreadPages.map((page, index) => renderComicImage(page, index))}
      </div>
    );
  };

  const readerStyle = {
    '--viewer-reader-bg': theme.bg,
    '--viewer-reader-fg': theme.fg,
    '--viewer-reader-font': readerSettings.fontFamily,
    '--viewer-reader-size': `${readerSettings.fontSize}px`,
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
    return (
      <div className={`viewer-reader-stage ${flowMode === 'spread' ? 'is-spread' : ''}`}>
        {visible.map((item, index) => (
          <article key={`${pageIndex}-${index}`} className="viewer-text-page" style={readerStyle}>
            {item.title ? <h2>{item.title}</h2> : null}
            <pre>{item.text || item}</pre>
          </article>
        ))}
      </div>
    );
  };

  const renderPdf = () => (
    documentUrl
      ? (
        <div className="viewer-pdf-stage">
          <iframe
            key={documentFrameKey || documentUrl}
            className="viewer-document-frame"
            title={session?.fileName || 'PDF'}
            src={documentUrl}
          />
        </div>
      )
      : <div className="viewer-state">{loading ? 'Loading...' : 'PDF unavailable'}</div>
  );

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
  const supportsFlowControls = session?.type === 'comic' || isReaderDocument;
  const supportsComicViewControls = session?.type === 'comic';
  const contentClassName = `viewer-content ${isReaderDocument && flowMode !== 'scroll' ? 'is-reader-paged' : ''}`.trim();

  return (
    <div className="viewer-app">
      <header className="viewer-toolbar">
        <div className="viewer-title" title={session?.filePath || ''}>
          <span>{session?.fileName || 'BookManager Viewer'}</span>
          <small>{progressText}</small>
        </div>
        <div className="viewer-tool-group">
          <ToolbarButton title="이전권 ([)" icon="chevronLeft" disabled={!hasPreviousBook || adjacentLoading} onClick={() => moveAdjacentBook(-1)} />
          <ToolbarButton title="이전장" icon="angleUp" disabled={flowMode !== 'scroll' && pageIndex <= 0} onClick={() => movePage(-1)} />
          <ToolbarButton title="다음장" icon="angleDown" disabled={flowMode !== 'scroll' && pageIndex >= pageCount - 1} onClick={() => movePage(1)} />
          <ToolbarButton title="다음권 (])" icon="chevronRight" disabled={!hasNextBook || adjacentLoading} onClick={() => moveAdjacentBook(1)} />
          {supportsFlowControls && (
            <ViewerDropdown
              className="is-toolbar"
              value={flowMode}
              options={FLOW_MODES}
              onChange={setFlowMode}
            />
          )}
          {supportsComicViewControls && (
            <>
              <ViewerDropdown
                className="is-toolbar is-wide"
                value={viewMode}
                options={VIEW_MODES}
                onChange={nextViewMode => {
                  setViewMode(nextViewMode);
                  if (nextViewMode === 'actual') setZoom(100);
                }}
              />
              <ToolbarButton title="축소 (-)" icon="minus" onClick={() => setZoom(current => clamp(current - 10, 50, 240))} />
              <span className="viewer-zoom">{zoom}%</span>
              <ToolbarButton title="확대 (+)" icon="plus" onClick={() => setZoom(current => clamp(current + 10, 50, 240))} />
            </>
          )}
          {session?.type === 'comic' && (
            <>
              <ToolbarButton title="읽기방향" active={readingDirection === 'rtl'} onClick={() => setReadingDirection(current => current === 'rtl' ? 'ltr' : 'rtl')}>
                {readingDirection === 'rtl' ? 'RTL' : 'LTR'}
              </ToolbarButton>
              <ToolbarButton title="첫 장 단독 표시" active={spreadCoverFirst} onClick={() => setSpreadCoverFirst(current => !current)}>Cover</ToolbarButton>
            </>
          )}
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
          {(session?.type === 'epub' || session?.type === 'text') && (
            <ToolbarButton title="읽기 설정" icon="gear" onClick={() => setSettingsOpen(true)} />
          )}
        </div>
      </header>
      <main className={contentClassName} ref={scrollRef} onScroll={handleScroll} onWheel={handleWheel}>
        {renderContent()}
      </main>
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
