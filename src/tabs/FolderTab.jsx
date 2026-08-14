import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FaIcon } from '../components/FaIcon';
import { FolderSidebar } from '../components/folder/FolderSidebar';
import { FileTableView } from '../components/folder/FileTableView';
import { ThumbnailView } from '../components/folder/ThumbnailView';
import { TileView } from '../components/folder/TileView';
import { DetailPanel } from '../components/folder/DetailPanel';
import { FolderToolbar } from '../components/folder/FolderToolbar';
import { MissingVolumesDialog } from '../components/folder/MissingVolumesDialog';
import { MultiRenameDialog } from '../components/MultiRenameDialog';
import { extractCoreTitle } from '../utils/folderUtils';
import {
  basename,
  joinPath,
  parentPath,
  replaceBasename,
} from '../utils/folderPath';
import { useFolderScan } from '../hooks/useFolderScan';
import { useFileSelection } from '../hooks/useFileSelection';
import {
  clampDetailHeight,
  clampSidebarWidth,
  resolveDetailHeight,
  resolveSidebarWidth,
} from '../folderLayout';
import {
  folderToggleLabelKey,
  shouldDisableFolderToggles,
} from '../folderToggleState';
import { isLibraryContext, resolveLastSelectedLibrary } from '../libraryState';
import {
  addFavoriteEntry,
  normalizeFavorites,
  removeFavoriteEntry,
  serializeFavorites,
} from '../favoriteState';
import {
  clampContextMenuPosition,
  isFavoriteFolder,
  replaceTreePath,
} from '../folderContextState';
import {
  resolveSelectionAfterDelete,
} from '../folderTreeState';
import {
  filterFolderFiles,
  normalizeSavedLayouts,
} from '../folderToolbarState';
import {
  createDefaultColumnLayout,
  normalizeColumnLayout,
  serializeColumnLayout,
} from '../folderColumnLayout';
import {
  attachViewerStatus,
  createViewerStatusReader,
  isViewerStatusStorageKey,
  viewerBookmarkStatusText,
  viewerReadingStatusText,
} from '../viewerStatusState';
import {
  MAX_VIEW_SCALE_BY_MODE,
  groupFolderFiles,
  normalizeViewMode,
  normalizeViewScales,
} from '../folderViewState';
import {
  fileOperationErrorKind,
  protectedRenameName,
} from '../fileActionPolicy';
import {
  buildRenameMap,
} from '../multiRenamePolicy';
import {
  findMissingVolumes,
} from '../missingVolumesPolicy';
import {
  applyConflictChoice,
  createLibraryMovePlans,
} from '../libraryMovePolicy';
import { normalizeLibraryKey } from '../folderLibraryStatus';
import {
  normalizeLibraryEntries,
  syncLibraryConfig,
} from '../settingsPolicy';
import {
  formatPrimaryShortcut,
  hasPrimaryModifier,
  isShortcutKey,
  shouldHandleGlobalShortcut,
} from '../interactionPolicy';
import { emitStatusState } from '../statusState';
import '../styles/FolderTab.css';

const VISIBLE_COVER_REQUEST_LIMIT = 32;
const COVER_PREVIEW_QUEUE_LIMIT = 96;
const COVER_PREVIEW_CONCURRENCY = 2;
const LIBRARY_SEARCH_RESULT_LIMIT = 3000;
const CONTENT_SEARCH_RESULT_LIMIT = 3000;
const FOLDER_SEARCH_SCOPES = new Set(['metadata', 'content', 'all']);
const MISSING_BACKGROUND_SCAN_DELAY_MS = 2500;
const EXTERNAL_VIEWER_EXTENSIONS = {
  comic: new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7']),
  epub: new Set(['.epub']),
  pdf: new Set(['.pdf']),
  text: new Set(['.txt', '.text', '.log', '.md']),
};

const coverPreviewFilePath = file => file?.full_path || file?.path || '';

const coverPreviewRequestKey = file => {
  const filePath = coverPreviewFilePath(file);
  if (!filePath) return '';
  const mtime = file?.mtime ?? file?.modified ?? '';
  const size = file?.size ?? '';
  return `${filePath}|${mtime}|${size}`;
};

const isPathInsideLibrary = (filePath = '', libraryPath = '') => {
  const pathKey = normalizeLibraryKey(filePath);
  const libraryKey = normalizeLibraryKey(libraryPath);
  return Boolean(pathKey && libraryKey && (pathKey === libraryKey || pathKey.startsWith(`${libraryKey}/`)));
};

const fileExtension = (filePath = '') => {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || '';
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
};

const viewerTypeForFile = (filePath = '') => {
  const extension = fileExtension(filePath);
  if (!extension) return '';
  for (const [viewerType, extensions] of Object.entries(EXTERNAL_VIEWER_EXTENSIONS)) {
    if (extensions.has(extension)) return viewerType;
  }
  return '';
};

const configuredViewerPath = (viewerPath = '') => String(viewerPath || '').trim();

const normalizeFolderSearchScope = value => (
  FOLDER_SEARCH_SCOPES.has(value) ? value : 'metadata'
);

const mergeLibrarySearchResults = (metadataRows = [], contentRows = []) => {
  const rows = [];
  const indexByPath = new Map();
  for (const row of [...metadataRows, ...contentRows]) {
    const filePath = row?.full_path || row?.path || '';
    const key = normalizeLibraryKey(filePath);
    if (!key) continue;
    const existingIndex = indexByPath.get(key);
    if (existingIndex === undefined) {
      indexByPath.set(key, rows.length);
      rows.push(row);
    } else {
      rows[existingIndex] = { ...row, ...rows[existingIndex] };
    }
  }
  return rows.slice(0, LIBRARY_SEARCH_RESULT_LIMIT);
};

const typeSpecificViewerPath = (config, filePath) => {
  const viewerType = viewerTypeForFile(filePath);
  return viewerType ? configuredViewerPath(config?.viewer_paths?.[viewerType]) : '';
};

const viewerErrorMessage = result => result?.message || result?.error || '';

function createFolderResizeGuide(axis, position) {
  if (typeof document === 'undefined') return null;
  const guide = document.createElement('div');
  guide.className = `folder-resize-guide is-${axis}`;
  document.body.appendChild(guide);
  updateFolderResizeGuide(guide, axis, position);
  return guide;
}

function updateFolderResizeGuide(guide, axis, position) {
  if (!guide) return;
  const rounded = Math.round(Number(position) || 0);
  if (axis === 'x') {
    guide.style.transform = `translate3d(${rounded}px, 0, 0)`;
  } else {
    guide.style.transform = `translate3d(0, ${rounded}px, 0)`;
  }
}

function SlidingSearchPlaceholder({ text }) {
  const viewportRef = useRef(null);
  const textRef = useRef(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const textNode = textRef.current;
    if (!viewport || !textNode) return undefined;

    let active = true;
    let frameId = null;
    const measureOverflow = () => {
      frameId = null;
      if (!active) return;
      const nextDistance = Math.max(0, Math.ceil(textNode.scrollWidth - viewport.clientWidth));
      setOverflowDistance(current => current === nextDistance ? current : nextDistance);
    };
    const scheduleMeasure = () => {
      if (!active) return;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureOverflow);
    };

    scheduleMeasure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleMeasure) : null;
    if (observer) {
      observer.observe(viewport);
      observer.observe(textNode);
    } else {
      window.addEventListener('resize', scheduleMeasure);
    }
    document.fonts?.ready?.then(scheduleMeasure);

    return () => {
      active = false;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [text]);

  const animationDuration = Math.max(7, 3 + overflowDistance / 22);
  return (
    <span
      className={`search-placeholder-viewport ${overflowDistance > 0 ? 'is-overflowing' : ''}`}
      ref={viewportRef}
      aria-hidden="true"
      style={{
        '--search-placeholder-offset': `${-overflowDistance}px`,
        '--search-placeholder-duration': `${animationDuration.toFixed(2)}s`,
      }}
    >
      <span className="search-placeholder-text" ref={textRef}>{text}</span>
    </span>
  );
}

const FolderSearchInput = React.memo(function FolderSearchInput({
    inputRef,
    onApplyQuery,
    onClearQuery,
    onSearchScopeChange,
    searchPlaceholder,
    librarySearchLoading,
    clearLabel,
    searchLabel,
    searchScope,
    searchScopeLabel,
    searchScopeMetadataLabel,
    searchScopeContentLabel,
    searchScopeAllLabel,
    showSearchScope,
}) {
    const [searchQuery, setSearchQuery] = useState('');
    const isComposingRef = useRef(false);

    const submitSearch = () => {
        if (isComposingRef.current) return;
        const inputValue = inputRef.current?.value ?? searchQuery;
        onApplyQuery(inputValue.trim());
    };

    const handleSubmit = event => {
        event.preventDefault();
        submitSearch();
    };

    const handleKeyDown = event => {
        if (event.key !== 'Enter') return;
        if (
            event.nativeEvent?.isComposing
            || event.nativeEvent?.keyCode === 229
            || isComposingRef.current
        ) {
            event.preventDefault();
        }
    };

    const clearSearch = () => {
        isComposingRef.current = false;
        setSearchQuery('');
        onClearQuery();
        inputRef.current?.focus();
    };

    return (
        <form
            className={`search-input-wrap ${showSearchScope ? 'has-search-scope' : ''}`}
            role="search"
            aria-label={searchLabel}
            onSubmit={handleSubmit}
        >
            {showSearchScope && (
                <select
                    className="folder-search-scope"
                    value={searchScope}
                    onChange={event => onSearchScopeChange(event.target.value)}
                    aria-label={searchScopeLabel}
                    title={searchScopeLabel}
                >
                    <option value="metadata">{searchScopeMetadataLabel}</option>
                    <option value="content">{searchScopeContentLabel}</option>
                    <option value="all">{searchScopeAllLabel}</option>
                </select>
            )}
            <input
                type="text"
                className="search-input"
                ref={inputRef}
                placeholder={searchPlaceholder}
                value={searchQuery}
                aria-label={searchPlaceholder}
                aria-busy={librarySearchLoading}
                onChange={event => setSearchQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                    isComposingRef.current = true;
                }}
                onCompositionEnd={event => {
                    isComposingRef.current = false;
                    setSearchQuery(event.currentTarget.value);
                }}
            />
            {!searchQuery && <SlidingSearchPlaceholder text={searchPlaceholder} />}
            {searchQuery && (
                <button
                    type="button"
                    className="search-clear-btn"
                    onClick={clearSearch}
                    aria-label={clearLabel}
                    title={clearLabel}
                >
                    ×
                </button>
            )}
            <button
                type="submit"
                className="search-submit-btn"
                aria-label={searchLabel}
                title={`${searchLabel} (Enter)`}
            >
                <FaIcon name="search" />
            </button>
        </form>
    );
});

function FolderTab({ config, saveConfig, t, showToast }) {
  const runtimePlatform = typeof navigator !== 'undefined' ? navigator.platform : '';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bookmanager:tab-ready', { detail: { tabId: 'folder' } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const { scanning, scanProgress, statusMessage, scanFolder, getCachedFiles, updateCachedFiles } = useFolderScan(t);
  const selectedFolderPathRef = useRef('');
  const mainAreaRef = useRef(null);
  const rightPanelRef = useRef(null);
  const viewContainerRef = useRef(null);
  const panelResizingRef = useRef(false);
  const viewScrollPositionsRef = useRef({ table: 0, tile: 0, thumbnail: 0 });
  const hasShownMissingToastRef = useRef(false);
  const missingBackgroundKeyRef = useRef('');
  const missingLocalTimerRef = useRef(null);
  const lastMissingLocalToastRef = useRef({ folderPath: '', timestamp: 0 });
  const backgroundLibraryScanCancelRef = useRef(null);
  const folderStatusItemRef = useRef({ currentItem: '', currentItemName: '' });
  const activeLibraryScanKeyRef = useRef('');
  const libraryScanUiHeartbeatRef = useRef(0);
  const preparingDuplicatesRef = useRef(false);
  const pendingInitialLibraryIndexRef = useRef('');
  const libraryPhaseRef = useRef('');
  const conflictResolverRef = useRef(null);
  const restoredLayoutRef = useRef(false);
  const initializedDetailHeightRef = useRef(false);
  const restoredColumnLayoutRef = useRef(false);
  const restoredViewSettingsRef = useRef(false);
  const restoredFolderPathRef = useRef(false);
  const internalFileActionRef = useRef(false);
  const watchedMtimeRef = useRef(null);
  const lastFolderPanelRef = useRef('list');
  const pendingMetadataRefreshRef = useRef(false);
  const coverPreviewQueueRef = useRef([]);
  const coverPreviewQueuedRef = useRef(new Set());
  const coverPreviewActivePathsRef = useRef(new Set());
  const coverPreviewAttemptedRef = useRef(new Set());
  const coverPreviewActiveCountRef = useRef(0);
  const coverPreviewFolderRef = useRef('');

  // --- UI 토글 상태 ---
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(240);
  const [rightPanelWidth, setRightPanelWidth] = useState(900);
  const [viewContainerWidth, setViewContainerWidth] = useState(900);
  const [detailPanelHeight, setDetailPanelHeight] = useState(245);

  // --- 뷰 상태 ---
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'thumbnail' | 'tile'
  const [sortKey, setSortKey] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [groupKey, setGroupKey] = useState('none');
  const [metadataMissingOnly, setMetadataMissingOnly] = useState(false);
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [enableDupCheck, setEnableDupCheck] = useState(false);
  const [preparingDuplicates, setPreparingDuplicates] = useState(false);
  const [duplicatePreparationStatus, setDuplicatePreparationStatus] = useState('');
  const [duplicatePreparationProgress, setDuplicatePreparationProgress] = useState(0);
  const [folderTaskCancelling, setFolderTaskCancelling] = useState(false);
  const [libraryTaskMode, setLibraryTaskMode] = useState(null);
  const [libraryScanStateMap, setLibraryScanStateMap] = useState({});
  const [missingData, setMissingData] = useState([]);
  const [isCheckingMissing, setIsCheckingMissing] = useState(false);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [itemScales, setItemScales] = useState({ table: 50, tile: 50, thumbnail: 50 });
  const [showLayoutDialog, setShowLayoutDialog] = useState(false);
  const [showDeleteLayoutDialog, setShowDeleteLayoutDialog] = useState(false);
  const [showMissingDialog, setShowMissingDialog] = useState(false);
  const [columnLayout, setColumnLayout] = useState(createDefaultColumnLayout);
  const [contextMenu, setContextMenu] = useState(null);
  const [showMultiRenameDialog, setShowMultiRenameDialog] = useState(false);
  const [showGotoDialog, setShowGotoDialog] = useState(false);
  const [showContentIndexDialog, setShowContentIndexDialog] = useState(false);
  const [gotoPathDraft, setGotoPathDraft] = useState('');
  const [seriesMovePreview, setSeriesMovePreview] = useState(null);
  const [libraryMoveRequest, setLibraryMoveRequest] = useState(null);
  const [moveConflict, setMoveConflict] = useState(null);
  const [textInputDialog, setTextInputDialog] = useState(null);
  const [viewerStatusVersion, setViewerStatusVersion] = useState(0);
  const textInputResolverRef = useRef(null);
  const closeTextInputDialog = useCallback((value = null) => {
    const resolver = textInputResolverRef.current;
    textInputResolverRef.current = null;
    setTextInputDialog(null);
    resolver?.(value);
  }, []);
  const requestTextInput = useCallback(options => new Promise(resolve => {
    textInputResolverRef.current?.(null);
    textInputResolverRef.current = resolve;
    setTextInputDialog({
      title: options?.title || '',
      message: options?.message || '',
      initialValue: options?.initialValue || '',
      inputId: options?.inputId || 'folder-text-input',
    });
  }), []);
  const closeTopOverlay = useCallback(() => {
    if (moveConflict) return true;
    if (textInputDialog) {
      closeTextInputDialog(null);
      return true;
    }
    if (showMultiRenameDialog) setShowMultiRenameDialog(false);
    else if (showGotoDialog) setShowGotoDialog(false);
    else if (showContentIndexDialog) setShowContentIndexDialog(false);
    else if (libraryMoveRequest) setLibraryMoveRequest(null);
    else if (seriesMovePreview) setSeriesMovePreview(null);
    else if (showDeleteLayoutDialog) setShowDeleteLayoutDialog(false);
    else if (showLayoutDialog) setShowLayoutDialog(false);
    else if (showMissingDialog) setShowMissingDialog(false);
    else if (contextMenu) setContextMenu(null);
    else return false;
    return true;
  }, [
    contextMenu,
    libraryMoveRequest,
    moveConflict,
    seriesMovePreview,
    textInputDialog,
    closeTextInputDialog,
    showDeleteLayoutDialog,
    showGotoDialog,
    showContentIndexDialog,
    showLayoutDialog,
    showMissingDialog,
    showMultiRenameDialog,
  ]);

  // --- 검색 상태 ---
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [searchSubmitToken, setSearchSubmitToken] = useState(0);
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [librarySearchResults, setLibrarySearchResults] = useState([]);
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false);
  const [showContentIndexSearchHint, setShowContentIndexSearchHint] = useState(false);
  const [searchScope, setSearchScope] = useState(() => normalizeFolderSearchScope(config?.folder_search_scope));
  const [contentIndexStatus, setContentIndexStatus] = useState(null);
  const [contentIndexActionLoading, setContentIndexActionLoading] = useState(false);
  const contentIndexProgress = contentIndexStatus?.progress || {};
  const contentIndexRunning = Boolean(contentIndexStatus?.running || contentIndexProgress.running);
  const contentIndexButtonLabel = contentIndexRunning
    ? t('folder_content_index_running', [
      Number(contentIndexProgress.processed) || 0,
      Number(contentIndexProgress.total) || 0,
    ])
    : t('folder_content_index_manage');
  const searchInputRef = useRef(null);
  const librarySearchRequestRef = useRef(0);
  const libraryEntries = useMemo(() => normalizeLibraryEntries(config || {}), [config]);
  const libraries = useMemo(() => libraryEntries.map(entry => entry.path), [libraryEntries]);
  const searchPlaceholder = libraries.length === 0
    ? t('folder_search_ph')
    : searchScope === 'content'
      ? t('folder_search_content_ph')
      : searchScope === 'all'
        ? t('folder_search_all_ph')
        : t('folder_search_library_ph');
  const normalizedSearchQuery = appliedSearchQuery.trim();
  const isLibrarySearchActive = normalizedSearchQuery.length > 0 && libraries.length > 0;
  const applySearchQuery = useCallback(query => {
    setAppliedSearchQuery(query);
    setSearchSubmitToken(token => token + 1);
    setShowContentIndexSearchHint(false);
  }, []);
  const clearAppliedSearchQuery = useCallback(() => {
    setShowContentIndexSearchHint(false);
    setAppliedSearchQuery('');
  }, []);
  const resetSearchQuery = useCallback(() => {
    setShowContentIndexSearchHint(false);
    setAppliedSearchQuery('');
    setSearchResetToken(token => token + 1);
  }, []);
  const handleSearchScopeChange = useCallback(value => {
    const nextScope = normalizeFolderSearchScope(value);
    setShowContentIndexSearchHint(false);
    setSearchScope(nextScope);
    setAppliedSearchQuery('');
    setLibrarySearchResults([]);
    saveConfig?.({ folder_search_scope: nextScope }).catch(error => {
      console.error('검색 범위 저장 실패:', error);
    });
  }, [saveConfig]);

  const refreshContentIndexStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI?.getContentIndexStatus?.(libraries);
      if (status) setContentIndexStatus(status);
      return status;
    } catch (error) {
      console.error('내용 인덱스 상태 조회 실패:', error);
      showToast?.(t('folder_content_index_error', [error?.message || t('msg_failed')]));
      return null;
    }
  }, [libraries, showToast, t]);

  const openContentIndexDialog = useCallback(() => {
    setShowContentIndexDialog(true);
    void refreshContentIndexStatus();
  }, [refreshContentIndexStatus]);

  const runContentIndexAction = useCallback(async force => {
    setContentIndexActionLoading(true);
    try {
      const status = await window.electronAPI?.startContentIndex?.(libraries, { force });
      if (status) setContentIndexStatus(status);
    } catch (error) {
      console.error('내용 인덱싱 실패:', error);
      showToast?.(t('folder_content_index_error', [error?.message || t('msg_failed')]));
    } finally {
      setContentIndexActionLoading(false);
      void refreshContentIndexStatus();
    }
  }, [libraries, refreshContentIndexStatus, showToast, t]);

  const stopContentIndex = useCallback(async () => {
    try {
      await window.electronAPI?.stopContentIndex?.();
    } catch (error) {
      console.error('내용 인덱싱 중지 실패:', error);
    }
  }, []);

  const clearContentIndex = useCallback(async () => {
    setContentIndexActionLoading(true);
    try {
      const status = await window.electronAPI?.clearContentIndex?.();
      if (status) {
        setContentIndexStatus(status);
        setSearchSubmitToken(token => token + 1);
      }
    } catch (error) {
      console.error('내용 인덱스 삭제 실패:', error);
      showToast?.(t('folder_content_index_error', [error?.message || t('msg_failed')]));
    } finally {
      setContentIndexActionLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => window.electronAPI?.onContentIndexProgress?.(progress => {
    setContentIndexStatus(current => ({
      ...(current || {}),
      progress,
      running: Boolean(progress?.running),
    }));
  }), []);

  useEffect(() => {
    preparingDuplicatesRef.current = preparingDuplicates;
  }, [preparingDuplicates]);

  const scanOptions = useMemo(() => ({
    includeSubfolders,
    enableDupCheck,
    dupFolders: config?.dup_check_folders || [],
    fastInitial: true,
  }), [includeSubfolders, enableDupCheck, config?.dup_check_folders]);

  const resetCoverPreviewQueue = useCallback(() => {
    coverPreviewQueueRef.current = [];
    coverPreviewQueuedRef.current.clear();
    coverPreviewActivePathsRef.current.clear();
    coverPreviewAttemptedRef.current.clear();
    coverPreviewActiveCountRef.current = 0;
  }, []);

  useEffect(() => {
    selectedFolderPathRef.current = selectedFolderPath;
    coverPreviewFolderRef.current = selectedFolderPath;
    resetCoverPreviewQueue();
  }, [resetCoverPreviewQueue, selectedFolderPath]);

  // 파일 데이터 가져오기 (캐시에서)
  const getCurrentFileData = useCallback(() => {
    if (!selectedFolderPath) return [];
    return getCachedFiles(selectedFolderPath, scanOptions) || [];
  }, [getCachedFiles, selectedFolderPath, scanOptions]);

  useEffect(() => {
    const requestId = librarySearchRequestRef.current + 1;
    librarySearchRequestRef.current = requestId;
    if (!isLibrarySearchActive) {
      setLibrarySearchResults(current => current.length === 0 ? current : []);
      setLibrarySearchLoading(false);
      setShowContentIndexSearchHint(false);
      return undefined;
    }

    let disposed = false;
    setLibrarySearchLoading(true);
    setShowContentIndexSearchHint(false);
    const search = async () => {
      try {
        const metadataPromise = searchScope === 'content'
          ? Promise.resolve([])
          : window.electronAPI?.searchLibraryFiles?.(
            normalizedSearchQuery,
            libraries,
            { limit: LIBRARY_SEARCH_RESULT_LIMIT },
          );
        const contentPromise = searchScope === 'metadata'
          ? Promise.resolve([])
          : window.electronAPI?.searchLibraryContent?.(
            normalizedSearchQuery,
            libraries,
            { limit: CONTENT_SEARCH_RESULT_LIMIT },
          );
        const contentIndexStatusPromise = searchScope === 'metadata'
          ? Promise.resolve(null)
          : window.electronAPI?.getContentIndexStatus?.(libraries);
        const [metadataResult, contentResult, contentIndexStatusResult] = await Promise.allSettled([
          metadataPromise || Promise.resolve([]),
          contentPromise || Promise.resolve([]),
          contentIndexStatusPromise || Promise.resolve(null),
        ]);
        if (
          (searchScope === 'metadata' && metadataResult.status === 'rejected')
          || (searchScope === 'content' && contentResult.status === 'rejected')
          || (metadataResult.status === 'rejected' && contentResult.status === 'rejected')
        ) {
          throw metadataResult.reason || contentResult.reason;
        }
        if (metadataResult.status === 'rejected') {
          console.warn('메타데이터 검색 실패:', metadataResult.reason);
        }
        if (contentResult.status === 'rejected') {
          console.warn('내용 검색 실패:', contentResult.reason);
        }
        const metadataRows = metadataResult.status === 'fulfilled' ? metadataResult.value : [];
        const contentRows = contentResult.status === 'fulfilled' ? contentResult.value : [];
        const rows = mergeLibrarySearchResults(
          Array.isArray(metadataRows) ? metadataRows : [],
          Array.isArray(contentRows) ? contentRows : [],
        );
        const resolvedContentIndexStatus = contentIndexStatusResult.status === 'fulfilled'
          ? contentIndexStatusResult.value
          : null;
        const contentIndexIsEmpty = Boolean(resolvedContentIndexStatus)
          && (
            Number(resolvedContentIndexStatus.totalCount || 0) === 0
            || Number(resolvedContentIndexStatus.tokenCount || 0) === 0
          );
        const shouldShowContentIndexHint = searchScope !== 'metadata'
          && contentResult.status === 'fulfilled'
          && (contentIndexIsEmpty || rows.length === 0);
        if (
          disposed
          || librarySearchRequestRef.current !== requestId
        ) return;
        React.startTransition(() => {
          setLibrarySearchResults(current => (
            librarySearchRequestRef.current === requestId
              ? (Array.isArray(rows) ? rows : [])
              : current
          ));
          setShowContentIndexSearchHint(current => (
            librarySearchRequestRef.current === requestId
              ? shouldShowContentIndexHint
              : current
          ));
        });
        setLibrarySearchLoading(false);
      } catch (error) {
        if (
          !disposed
          && librarySearchRequestRef.current === requestId
        ) {
          console.error('라이브러리 검색 실패:', error);
          if (searchScope !== 'metadata') {
            showToast?.(t('folder_content_index_error', [error?.message || t('msg_failed')]));
          }
          React.startTransition(() => {
            setLibrarySearchResults(current => (
              librarySearchRequestRef.current === requestId ? [] : current
            ));
            setShowContentIndexSearchHint(current => (
              librarySearchRequestRef.current === requestId ? false : current
            ));
          });
          setLibrarySearchLoading(false);
        }
      }
    };
    void search();

    return () => {
      disposed = true;
    };
  }, [isLibrarySearchActive, libraries, normalizedSearchQuery, searchScope, searchSubmitToken, showToast, t]);

  useEffect(() => {
    const refreshViewerStatus = () => {
      setViewerStatusVersion(version => version + 1);
    };
    const handleStorage = event => {
      if (isViewerStatusStorageKey(event.key)) refreshViewerStatus();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', refreshViewerStatus);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', refreshViewerStatus);
    };
  }, []);

  // 필터링된 파일 데이터
  const currentFolderFileData = useMemo(() => getCurrentFileData(), [getCurrentFileData]);
  const activeRawFileData = isLibrarySearchActive ? librarySearchResults : currentFolderFileData;
  const fileDataWithViewerStatus = useMemo(() => {
    if (activeRawFileData.length === 0) return activeRawFileData;
    const reader = createViewerStatusReader();
    return activeRawFileData.map(file => attachViewerStatus(file, reader));
  }, [activeRawFileData, viewerStatusVersion]);
  const localSearchQuery = isLibrarySearchActive ? '' : appliedSearchQuery;
  const filteredFileData = useMemo(() => filterFolderFiles(fileDataWithViewerStatus, {
    query: localSearchQuery,
    metadataMissingOnly,
  }), [fileDataWithViewerStatus, localSearchQuery, metadataMissingOnly]);

  const pumpCoverPreviewQueue = useCallback(() => {
    if (!selectedFolderPath || isLibrarySearchActive) return;
    const loadPreview = window.electronAPI?.getFilePreview;
    if (!loadPreview) return;

    while (
      coverPreviewActiveCountRef.current < COVER_PREVIEW_CONCURRENCY
      && coverPreviewQueueRef.current.length > 0
    ) {
      const file = coverPreviewQueueRef.current.shift();
      const filePath = coverPreviewFilePath(file);
      const requestKey = coverPreviewRequestKey(file);
      if (!filePath || !requestKey) continue;
      coverPreviewActiveCountRef.current += 1;
      coverPreviewActivePathsRef.current.add(requestKey);
      coverPreviewAttemptedRef.current.add(requestKey);

      loadPreview(filePath, { force: false })
        .then(result => {
          if (coverPreviewFolderRef.current !== selectedFolderPath) return;
          if (!result?.success || !result.file?.cover) return;
          updateCachedFiles(selectedFolderPath, scanOptions, [{
            ...file,
            ...result.file,
            path: file.path,
            full_path: file.full_path || result.file.full_path || result.file.path,
          }]);
        })
        .catch(() => {})
        .finally(() => {
          coverPreviewActivePathsRef.current.delete(requestKey);
          coverPreviewQueuedRef.current.delete(requestKey);
          coverPreviewActiveCountRef.current = Math.max(0, coverPreviewActiveCountRef.current - 1);
          pumpCoverPreviewQueue();
        });
    }
  }, [isLibrarySearchActive, scanOptions, selectedFolderPath, updateCachedFiles]);

  const handleVisibleFilesChange = useCallback((visibleFiles = []) => {
    if (!selectedFolderPath || isLibrarySearchActive) return;
    const nextItems = (Array.isArray(visibleFiles) ? visibleFiles : [])
      .filter(file => {
        const requestKey = coverPreviewRequestKey(file);
        return requestKey
          && !file.cover
          && !coverPreviewQueuedRef.current.has(requestKey)
          && !coverPreviewAttemptedRef.current.has(requestKey);
      })
      .slice(0, VISIBLE_COVER_REQUEST_LIMIT);
    if (nextItems.length === 0) return;

    const existing = coverPreviewQueueRef.current;
    const seen = new Set();
    const merged = [...nextItems, ...existing]
      .filter(file => {
        const requestKey = coverPreviewRequestKey(file);
        if (!requestKey || seen.has(requestKey)) return false;
        seen.add(requestKey);
        return true;
      })
      .slice(0, COVER_PREVIEW_QUEUE_LIMIT);

    coverPreviewQueuedRef.current = new Set([
      ...Array.from(coverPreviewActivePathsRef.current),
      ...merged.map(coverPreviewRequestKey).filter(Boolean),
    ]);
    coverPreviewQueueRef.current = merged;
    pumpCoverPreviewQueue();
  }, [isLibrarySearchActive, pumpCoverPreviewQueue, selectedFolderPath]);
  const savedLayouts = useMemo(
    () => normalizeSavedLayouts(config?.folder_saved_layouts),
    [config?.folder_saved_layouts],
  );
  const groupedFileData = useMemo(
    () => groupFolderFiles(filteredFileData, groupKey, sortKey, sortOrder, {
      fallbackGroupName: t('folder_group_uncategorized'),
    }),
    [filteredFileData, groupKey, sortKey, sortOrder, t],
  );
  const displayedFileData = useMemo(
    () => groupedFileData.flatMap(group => group.files),
    [groupedFileData],
  );

  // --- 선택 상태 ---
  const {
    selectedFiles,
    activeSelectedPath,
    selectedFileData,
    selectFile,
    toggleFile,
    rangeSelect,
    clearSelection,
    selectAll,
    deselectAll,
    invertSelection,
    selectPaths,
    moveActiveSelection,
  } = useFileSelection(displayedFileData);
  const activeSelectedFile = selectedFileData();
  const detailSelectedFile = activeSelectedFile || null;
  const selectedFileSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const fileSizeByPath = useMemo(() => {
    const sizes = new Map();
    filteredFileData.forEach(file => {
      if (file?.path) sizes.set(file.path, Number(file.size) || 0);
    });
    return sizes;
  }, [filteredFileData]);
  const selectedFilesTotalBytes = useMemo(() => (
    selectedFiles.reduce((total, filePath) => total + (fileSizeByPath.get(filePath) || 0), 0)
  ), [fileSizeByPath, selectedFiles]);
  const displayedFileByPath = useMemo(() => {
    const map = new Map();
    displayedFileData.forEach(file => {
      if (file?.path) map.set(file.path, file);
    });
    return map;
  }, [displayedFileData]);
  const itemScale = itemScales[viewMode] || 50;
  const scaleMax = MAX_VIEW_SCALE_BY_MODE[viewMode] || MAX_VIEW_SCALE_BY_MODE.table;

  useEffect(() => {
    if (isLibrarySearchActive) clearSelection();
  }, [clearSelection, isLibrarySearchActive, normalizedSearchQuery, searchSubmitToken]);

  useEffect(() => {
    if (!config || restoredLayoutRef.current) return;
    const mainWidth = mainAreaRef.current?.clientWidth || 1200;
    const rightHeight = rightPanelRef.current?.clientHeight || 700;
    setLeftPanelWidth(resolveSidebarWidth(config.folder_left_panel_width, mainWidth));
    setDetailPanelHeight(resolveDetailHeight(config.folder_detail_panel_height, rightHeight));
    initializedDetailHeightRef.current = config.folder_detail_panel_height !== undefined;
    restoredLayoutRef.current = true;
  }, [config]);

  useEffect(() => {
    if (!config || restoredColumnLayoutRef.current) return;
    setColumnLayout(normalizeColumnLayout(config.folder_column_layout));
    restoredColumnLayoutRef.current = true;
  }, [config]);

  useEffect(() => {
    if (!config || restoredViewSettingsRef.current) return;
    setViewMode(normalizeViewMode(config.folder_view_mode));
    setItemScales(normalizeViewScales(config.folder_item_scales));
    setSortKey(config.folder_sort_key || 'name');
    setSortOrder(config.folder_sort_order === 'desc' ? 'desc' : 'asc');
    setGroupKey(config.folder_group_key || 'none');
    restoredViewSettingsRef.current = true;
  }, [config]);

  useEffect(() => {
    if (!restoredViewSettingsRef.current) return undefined;
    const timer = window.setTimeout(() => {
      saveConfig?.({
        folder_view_mode: viewMode,
        folder_item_scales: normalizeViewScales(itemScales),
        folder_sort_key: sortKey,
        folder_sort_order: sortOrder,
        folder_group_key: groupKey,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [groupKey, itemScales, saveConfig, sortKey, sortOrder, viewMode]);

  useEffect(() => {
    if (!activeSelectedFile || initializedDetailHeightRef.current) return;
    const rightHeight = rightPanelRef.current?.clientHeight || 700;
    setDetailPanelHeight(resolveDetailHeight(undefined, rightHeight));
    initializedDetailHeightRef.current = true;
  }, [activeSelectedFile]);

  const updateRightPanelWidth = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    const width = Math.max(320, Math.round(panel.clientWidth || 900));
    setRightPanelWidth(current => current === width ? current : width);
  }, []);

  const updateViewContainerWidth = useCallback(() => {
    const container = viewContainerRef.current;
    if (!container) return;
    const width = Math.max(320, Math.round(container.clientWidth || 900));
    setViewContainerWidth(current => current === width ? current : width);
  }, []);

  useEffect(() => {
    const updateWidth = () => {
      if (!panelResizingRef.current) updateRightPanelWidth();
    };
    updateWidth();
    const panel = rightPanelRef.current;
    if (!panel) return undefined;
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isSidebarVisible, updateRightPanelWidth]);

  useEffect(() => {
    const updateWidth = () => {
      if (!panelResizingRef.current) updateViewContainerWidth();
    };
    updateWidth();
    const container = viewContainerRef.current;
    if (!container) return undefined;
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isSidebarVisible, updateViewContainerWidth, viewMode]);

  useEffect(() => {
    const removeProgress = window.electronAPI?.onTaskProgress?.(data => {
      if (data?.task === 'folder:scan') {
        return;
      }
      if (data?.task !== 'folder:updateIndex') return;
      const progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
      const activeLibraryScanKey = activeLibraryScanKeyRef.current;
      const nowMs = Date.now();
      if (activeLibraryScanKey && nowMs - libraryScanUiHeartbeatRef.current >= 5000) {
        libraryScanUiHeartbeatRef.current = nowMs;
        const checkedAt = new Date(nowMs).toISOString();
        setLibraryScanStateMap(prev => {
          const current = prev[activeLibraryScanKey];
          if (!current || current.status !== 'scanning') return prev;
          return {
            ...prev,
            [activeLibraryScanKey]: {
              ...current,
              status: 'scanning',
              needsScan: false,
              lastCheckedAt: checkedAt,
            },
          };
        });
      }
      const isMetadataOnlyMode = libraryTaskMode === 'metadata';
      const fallbackMessage = isMetadataOnlyMode
        ? t('folder_optimizing', [0, 0])
        : t('dup_scan_start');
      const message = data.message || fallbackMessage;
      const libraryPhase = isMetadataOnlyMode
        ? 'metadata'
        : data.libraryPhase || 'indexing';
      libraryPhaseRef.current = libraryPhase;
      setDuplicatePreparationStatus(message);
      setDuplicatePreparationProgress(progress);
      if (data.currentFile || data.currentFileName) {
        folderStatusItemRef.current = {
          currentItem: data.currentFile || folderStatusItemRef.current.currentItem,
          currentItemName: data.currentFileName || data.currentFile || folderStatusItemRef.current.currentItemName,
        };
      }
      emitStatusState('folder', {
        task: data.task,
        display: 'library-slide',
        message,
        progress,
        phase: data.phase || (folderTaskCancelling ? 'cancelling' : progress >= 100 ? 'idle' : 'executing'),
        libraryPhase,
        libraryTaskMode,
        currentItem: folderStatusItemRef.current.currentItem,
        currentItemName: folderStatusItemRef.current.currentItemName,
      });
    });
    return () => {
      if (typeof removeProgress === 'function') removeProgress();
    };
  }, [folderTaskCancelling, libraryTaskMode, t]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'folder', isWorking: preparingDuplicates },
    }));
    if (preparingDuplicates) {
      emitStatusState('folder', {
        task: 'folder:updateIndex',
        display: 'library-slide',
        message: duplicatePreparationStatus || t('dup_scan_start'),
        progress: duplicatePreparationProgress,
        phase: folderTaskCancelling ? 'cancelling' : 'executing',
        libraryPhase: libraryPhaseRef.current || (libraryTaskMode === 'metadata' ? 'metadata' : 'indexing'),
        libraryTaskMode,
        currentItem: folderStatusItemRef.current.currentItem,
        currentItemName: folderStatusItemRef.current.currentItemName,
      });
      return;
    }
  }, [duplicatePreparationProgress, duplicatePreparationStatus, folderTaskCancelling, libraryTaskMode, preparingDuplicates, t]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
        detail: { tabId: 'folder', isWorking: false },
      }));
      emitStatusState('folder', {
        message: t('status_wait'),
        progress: 0,
        phase: 'idle',
      });
    };
  }, [t]);

  // --- 사이드바 상태 ---
  const favoriteEntries = useMemo(() => normalizeFavorites(config || {}), [config]);

  const refreshLibraryScanStates = useCallback(async (targetFolders = libraries) => {
    const folders = [...new Set((targetFolders || []).filter(Boolean))];
    if (folders.length === 0) {
      setLibraryScanStateMap({});
      return;
    }
    try {
      const states = await window.electronAPI?.getLibraryScanStates?.(folders);
      if (!Array.isArray(states)) return;
      setLibraryScanStateMap(prev => {
        const next = { ...prev };
        const activeLibraryScanKey = preparingDuplicatesRef.current ? activeLibraryScanKeyRef.current : '';
        for (const state of states) {
          const key = normalizeLibraryKey(state.libraryPath || state.library_path);
          if (!key) continue;
          next[key] = activeLibraryScanKey === key && prev[key]?.status === 'scanning'
            ? {
                ...prev[key],
                ...state,
                status: 'scanning',
                needsScan: false,
                lastCheckedAt: state.lastCheckedAt || prev[key].lastCheckedAt,
              }
            : state;
        }
        for (const key of Object.keys(next)) {
          if (!folders.some(folder => normalizeLibraryKey(folder) === key)) delete next[key];
        }
        return next;
      });
    } catch (error) {
      console.error('라이브러리 스캔 상태 조회 실패:', error);
    }
  }, [libraries]);

  const markLibraryScanStatesCancelled = useCallback((targetFolders = null) => {
    const targetKeys = Array.isArray(targetFolders)
      ? new Set(targetFolders.filter(Boolean).map(normalizeLibraryKey))
      : null;
    const checkedAt = new Date().toISOString();
    setLibraryScanStateMap(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [key, state] of Object.entries(next)) {
        const shouldMark = targetKeys ? targetKeys.has(key) : state?.status === 'scanning';
        if (!shouldMark) continue;
        next[key] = {
          ...(state || {}),
          status: 'cancelled',
          needsScan: true,
          lastCheckedAt: checkedAt,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    refreshLibraryScanStates();
    const timer = window.setInterval(() => refreshLibraryScanStates(), 60000);
    return () => window.clearInterval(timer);
  }, [refreshLibraryScanStates]);

  const addLibrary = useCallback(async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder(t('dlg_sel_dup_folder'));
      if (folderPath && saveConfig && !libraries.includes(folderPath)) {
        await saveConfig(syncLibraryConfig({}, [
          ...libraryEntries,
          { path: folderPath, alias: '', group: '' },
        ]));
        pendingInitialLibraryIndexRef.current = folderPath;
      }
    } catch (e) {
      console.error(e);
    }
  }, [libraries, libraryEntries, saveConfig]);

  const removeLibrary = useCallback(async (path) => {
    if (saveConfig) {
      await saveConfig(syncLibraryConfig({}, libraryEntries.filter(entry => entry.path !== path)));
    }
  }, [libraryEntries, saveConfig]);

  const addFavorite = useCallback(async (path) => {
    if (saveConfig) {
      const nextFavorites = addFavoriteEntry(favoriteEntries, path);
      if (nextFavorites !== favoriteEntries) {
        await saveConfig(serializeFavorites(nextFavorites));
      }
    }
  }, [favoriteEntries, saveConfig]);

  const removeFavorite = useCallback(async (path) => {
    if (saveConfig) {
      await saveConfig(serializeFavorites(removeFavoriteEntry(favoriteEntries, path)));
    }
  }, [favoriteEntries, saveConfig]);

  // --- refs ---
  const fileTableRef = useRef(null);

  useEffect(() => {
    const libraryFolders = [...new Set([
      ...(config?.libraries || []),
      ...(config?.dup_check_folders || []),
    ])].filter(Boolean);
    const backgroundKey = JSON.stringify(libraryFolders);
    if (!config || missingBackgroundKeyRef.current === backgroundKey || scanning || preparingDuplicates) return undefined;
    let cancelled = false;
    backgroundLibraryScanCancelRef.current = () => {
      cancelled = true;
      setIsCheckingMissing(false);
      setFolderTaskCancelling(false);
    };

    const analyze = async () => {
      if (cancelled) return;
      if (preparingDuplicatesRef.current) return;
      setIsCheckingMissing(true);
      try {
        const libraryFiles = [];
        const prioritizedFolders = selectedFolderPath
          ? [
              ...libraryFolders.filter(folderPath => folderPath === selectedFolderPath),
              ...libraryFolders.filter(folderPath => folderPath !== selectedFolderPath),
            ]
          : libraryFolders;
        for (let index = 0; index < prioritizedFolders.length; index += 1) {
          const folderPath = prioritizedFolders[index];
          if (cancelled) return;
          if (preparingDuplicatesRef.current) return;
          const files = await window.electronAPI?.scanFolder?.(folderPath, {
            includeSubfolders: true,
            enableDupCheck: false,
            skipArchiveExtraction: true,
            suppressEvents: true,
            reportTaskProgress: false,
            reportFileReady: false,
          });
          if (Array.isArray(files)) libraryFiles.push(...files);
        }
        if (cancelled) return;
        const missing = findMissingVolumes(
          libraryFolders.length > 0 ? libraryFiles : getCurrentFileData(),
        );
        missingBackgroundKeyRef.current = backgroundKey;
        setMissingData(missing);
        if (missing.length > 0 && !hasShownMissingToastRef.current) {
          hasShownMissingToastRef.current = true;
          showToast?.({ key: 'tf_toast_missing', values: [missing.length] });
        }
      } finally {
        if (backgroundLibraryScanCancelRef.current) backgroundLibraryScanCancelRef.current = null;
        if (!cancelled) {
          setIsCheckingMissing(false);
        }
      }
    };

    const timer = window.setTimeout(analyze, MISSING_BACKGROUND_SCAN_DELAY_MS);
    return () => {
      cancelled = true;
      if (backgroundLibraryScanCancelRef.current) backgroundLibraryScanCancelRef.current = null;
      window.clearTimeout(timer);
    };
  }, [config, getCurrentFileData, preparingDuplicates, scanning, selectedFolderPath, showToast]);

  const scheduleLocalMissingToast = useCallback((folderPath, missing) => {
    if (missingLocalTimerRef.current) window.clearTimeout(missingLocalTimerRef.current);
    if (!folderPath || missing.length === 0) return;
    const now = Date.now();
    const previous = lastMissingLocalToastRef.current;
    if (previous.folderPath === folderPath && now - previous.timestamp < 5000) return;
    missingLocalTimerRef.current = window.setTimeout(() => {
      lastMissingLocalToastRef.current = { folderPath, timestamp: Date.now() };
      showToast?.({ key: 'tf_local_missing_alert', values: [missing.length] });
    }, 1000);
  }, [showToast]);

  // 폴더 변경 핸들러
  const handleFolderChange = useCallback(async (folderPath) => {
    const nextFolderPath = String(folderPath || '');
    selectedFolderPathRef.current = nextFolderPath;
    setSelectedFolderPath(nextFolderPath);
    clearSelection();
    resetSearchQuery();
    if (nextFolderPath && config?.folder_last_path !== nextFolderPath) {
      saveConfig?.({ folder_last_path: nextFolderPath }).catch(error => {
        console.error('마지막 폴더 경로 저장 실패:', error);
      });
    }
    const files = await scanFolder(nextFolderPath, scanOptions);
    if (selectedFolderPathRef.current !== nextFolderPath) return;
    const localMissing = findMissingVolumes(files || []);
    scheduleLocalMissingToast(nextFolderPath, localMissing);
  }, [config?.folder_last_path, scanOptions, scanFolder, clearSelection, resetSearchQuery, saveConfig, scheduleLocalMissingToast]);

  const handleSafeFolderNavigation = useCallback(async (folderPath, options = {}) => {
    if (!folderPath) return false;
    if (options.skipExistsCheck !== true) {
      const exists = await window.electronAPI?.exists?.(folderPath);
      if (!exists) return false;
    }
    await handleFolderChange(folderPath);
    return true;
  }, [handleFolderChange]);

  useEffect(() => {
    if (!config || restoredFolderPathRef.current || scanning || preparingDuplicates) return undefined;
    restoredFolderPathRef.current = true;
    let cancelled = false;
    const candidates = [
      config.folder_last_path,
      config.last_folder_path,
      config.last_selected_folder_path,
      config.last_selected_library,
      libraries[0],
    ].filter(Boolean);
    const uniqueCandidates = [...new Set(candidates)];
    if (uniqueCandidates.length === 0) return undefined;

    const restoreLastFolder = async () => {
      for (const folderPath of uniqueCandidates) {
        if (cancelled) return;
        if (await handleSafeFolderNavigation(folderPath)) return;
      }
    };
    restoreLastFolder();
    return () => {
      cancelled = true;
    };
  }, [config, handleSafeFolderNavigation, libraries, preparingDuplicates, scanning]);

  const handlePathNavigation = useCallback(async targetPathValue => {
    const targetPath = String(targetPathValue || '').trim();
    if (!targetPath) return;
    if (await handleSafeFolderNavigation(targetPath)) {
      setShowGotoDialog(false);
      return;
    }
    await window.electronAPI?.showMessage?.({
      type: 'warning',
      title: t('fm_error'),
      message: t('fm_error_desc'),
      language: config?.language || config?.lang || 'ko',
    });
  }, [config?.lang, config?.language, handleSafeFolderNavigation, t]);

  const runInternalFileAction = useCallback(async action => {
    internalFileActionRef.current = true;
    try {
      return await action();
    } finally {
      window.setTimeout(async () => {
        if (selectedFolderPath) {
          try {
            const stat = await window.electronAPI?.stat?.(selectedFolderPath);
            watchedMtimeRef.current = stat?.isDirectory ? stat.mtime : null;
          } catch {
            watchedMtimeRef.current = null;
          }
        }
        internalFileActionRef.current = false;
      }, 1500);
    }
  }, [selectedFolderPath]);

  useEffect(() => {
    watchedMtimeRef.current = null;
    if (!selectedFolderPath) return undefined;
    let disposed = false;

    const pollFolder = async () => {
      if (disposed || internalFileActionRef.current || scanning || preparingDuplicates) return;
      const stat = await window.electronAPI?.stat?.(selectedFolderPath);
      if (!stat?.isDirectory) return;
      if (watchedMtimeRef.current === null) {
        watchedMtimeRef.current = stat.mtime;
        return;
      }
      if (stat.mtime === watchedMtimeRef.current) return;
      watchedMtimeRef.current = stat.mtime;
      setTreeRefreshToken(current => current + 1);
      resetCoverPreviewQueue();
      await scanFolder(selectedFolderPath, { ...scanOptions, force: true });
    };

    pollFolder();
    const timer = window.setInterval(pollFolder, 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [preparingDuplicates, resetCoverPreviewQueue, scanFolder, scanOptions, scanning, selectedFolderPath]);

  // 누락 권수 확인
  const checkMissingVolumes = useCallback(async () => {
    if (isCheckingMissing) return;
    if (missingData.length > 0) {
      setShowMissingDialog(true);
      return;
    }
    setIsCheckingMissing(true);
    window.setTimeout(async () => {
      const libraryFolders = [...new Set([
        ...(config?.libraries || []),
        ...(config?.dup_check_folders || []),
      ])].filter(Boolean);
      const files = [];
      for (const folderPath of libraryFolders) {
        const scanned = await window.electronAPI?.scanFolder?.(folderPath, {
          includeSubfolders: true,
          enableDupCheck: false,
          skipArchiveExtraction: true,
          suppressEvents: true,
        });
        if (Array.isArray(scanned)) files.push(...scanned);
      }
      const missing = findMissingVolumes(libraryFolders.length > 0 ? files : filteredFileData);
      setMissingData(missing);
      setIsCheckingMissing(false);
      if (missing.length > 0) setShowMissingDialog(true);
      else {
        await window.electronAPI?.showMessage?.({
          type: 'info',
          title: t('tf_dlg_missing_title'),
          message: t('msg_no_missing_vols'),
          language: config?.language || config?.lang || 'ko',
        });
      }
    }, 0);
  }, [config?.dup_check_folders, config?.lang, config?.language, config?.libraries, filteredFileData, isCheckingMissing, missingData.length, t]);

  const isFolderTabVisible = useCallback(() => (
    !mainAreaRef.current?.closest?.('[hidden]')
  ), []);

  const handleRefresh = useCallback(async () => {
    if (!selectedFolderPath) return;
    resetCoverPreviewQueue();
    const files = await scanFolder(selectedFolderPath, { ...scanOptions, force: true });
    scheduleLocalMissingToast(selectedFolderPath, findMissingVolumes(files || []));
  }, [resetCoverPreviewQueue, selectedFolderPath, scanFolder, scanOptions, scheduleLocalMissingToast]);

  useEffect(() => {
    const handleMetadataSaved = event => {
      const paths = Array.isArray(event.detail?.paths) ? event.detail.paths : [];
      if (!selectedFolderPath || paths.length === 0) return;
      const folderKey = normalizeLibraryKey(selectedFolderPath);
      const hasCurrentFolderFile = paths.some(filePath => {
        const fileKey = normalizeLibraryKey(filePath);
        const parentKey = normalizeLibraryKey(parentPath(filePath));
        if (!folderKey || !fileKey) return false;
        if (includeSubfolders) return fileKey === folderKey || fileKey.startsWith(`${folderKey}/`);
        return parentKey === folderKey;
      });
      if (!hasCurrentFolderFile) return;
      pendingMetadataRefreshRef.current = true;
      if (!isFolderTabVisible()) return;
      pendingMetadataRefreshRef.current = false;
      handleRefresh();
    };
    window.addEventListener('bookmanager:metadata-saved', handleMetadataSaved);
    return () => window.removeEventListener('bookmanager:metadata-saved', handleMetadataSaved);
  }, [handleRefresh, includeSubfolders, isFolderTabVisible, selectedFolderPath]);

  useEffect(() => {
    const handleActiveTabChanged = event => {
      if (event.detail?.activeTab !== 'folder') return;
      if (!pendingMetadataRefreshRef.current) return;
      pendingMetadataRefreshRef.current = false;
      handleRefresh();
    };
    window.addEventListener('bookmanager:active-tab-changed', handleActiveTabChanged);
    return () => window.removeEventListener('bookmanager:active-tab-changed', handleActiveTabChanged);
  }, [handleRefresh]);

  const handleSmartRefresh = useCallback(async (force = false) => {
    if (!selectedFolderPath || scanning || preparingDuplicates) return;
    const stat = await window.electronAPI?.stat?.(selectedFolderPath);
    if (!force && stat?.isDirectory && watchedMtimeRef.current === stat.mtime) return;
    if (stat?.isDirectory) watchedMtimeRef.current = stat.mtime;
    await handleRefresh();
  }, [handleRefresh, preparingDuplicates, scanning, selectedFolderPath]);

  const handleIncludeSubfoldersChange = useCallback(async () => {
    if (shouldDisableFolderToggles(scanning, preparingDuplicates)) return;
    const nextValue = !includeSubfolders;
    setIncludeSubfolders(nextValue);
    clearSelection();
    if (!selectedFolderPath) return;
    const nextOptions = { ...scanOptions, includeSubfolders: nextValue, force: true };
    resetCoverPreviewQueue();
    const files = await scanFolder(selectedFolderPath, nextOptions);
    setMissingData(findMissingVolumes(files || []));
  }, [
    clearSelection,
    includeSubfolders,
    preparingDuplicates,
    resetCoverPreviewQueue,
    scanFolder,
    scanOptions,
    scanning,
    selectedFolderPath,
  ]);

  const handleDupCheckChange = useCallback(async () => {
    if (shouldDisableFolderToggles(scanning, preparingDuplicates)) return;
    const nextValue = !enableDupCheck;
    const dupFolders = config?.dup_check_folders || [];
    setEnableDupCheck(nextValue);
    clearSelection();

    if (!selectedFolderPath) return;
    const nextOptions = {
      ...scanOptions,
      enableDupCheck: nextValue,
      dupFolders,
      force: true,
    };
    resetCoverPreviewQueue();
    const files = await scanFolder(selectedFolderPath, nextOptions);
    setMissingData(findMissingVolumes(files || []));
  }, [
    clearSelection,
    config?.dup_check_folders,
    enableDupCheck,
    preparingDuplicates,
    resetCoverPreviewQueue,
    scanFolder,
    scanOptions,
    scanning,
    selectedFolderPath,
  ]);

  const handleRefreshTree = useCallback(async () => {
    if (scanning || preparingDuplicates) return;
    setTreeRefreshToken(current => current + 1);
    await handleRefresh();
  }, [handleRefresh, preparingDuplicates, scanning]);

  const handleLibrarySelect = useCallback(async folderPath => {
    if (!folderPath) return;
    await saveConfig?.({ last_selected_library: folderPath });
    await handleFolderChange(folderPath);
  }, [handleFolderChange, saveConfig]);

  const openLibrarySettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('bookmanager:open-settings', {
      detail: { tab: 'folder' },
    }));
  }, []);

  const runLibraryIndexAction = useCallback(async (folderPath, optimizeMetadata = false, options = {}) => {
    if (!folderPath || preparingDuplicates || scanning) return;
    let wasCancelled = false;
    let shouldRefreshIndexedFolder = false;
    let shouldShowSuccessToast = false;
    const choice = options.skipPrompt
      ? (options.mode === 'force' ? 'force' : 'smart')
      : await window.electronAPI?.chooseLibrarySyncMode?.({
          title: optimizeMetadata ? t('menu_optimize_meta') : t('setting_update_index'),
          message: t('msg_optimize_desc', [basename(folderPath)]),
          language: config?.language || config?.lang || 'ko',
        });
    if (!choice || choice === 'cancel') return;

    if (isCheckingMissing) {
      backgroundLibraryScanCancelRef.current?.();
      await window.electronAPI?.stopTask?.('folder:scan');
    }
    await saveConfig?.({ last_selected_library: folderPath });
    folderStatusItemRef.current = {
      currentItem: folderPath,
      currentItemName: basename(folderPath),
    };
    activeLibraryScanKeyRef.current = normalizeLibraryKey(folderPath);
    libraryScanUiHeartbeatRef.current = Date.now();
    const scanStartedAt = new Date().toISOString();
    setLibraryScanStateMap(prev => {
      const key = normalizeLibraryKey(folderPath);
      return {
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          libraryPath: folderPath,
          status: 'scanning',
          needsScan: false,
          lastCheckedAt: scanStartedAt,
        },
      };
    });
    preparingDuplicatesRef.current = true;
    libraryPhaseRef.current = optimizeMetadata && !options.showIndexingVisual ? 'metadata' : 'indexing';
    setPreparingDuplicates(true);
    setLibraryTaskMode(optimizeMetadata
      ? (options.showIndexingVisual ? 'metadata-initial' : 'metadata')
      : 'index');
    setDuplicatePreparationStatus(optimizeMetadata ? t('folder_optimizing', [0, 0]) : t('dup_scan_start'));
    setDuplicatePreparationProgress(0);
    try {
      const shouldForceMetadata = optimizeMetadata && (
        typeof options.forceMetadata === 'boolean'
          ? options.forceMetadata
          : choice === 'force'
      );
      const result = await window.electronAPI?.updateFolderIndex?.(
        [folderPath],
        {
          mode: choice,
          optimizeMetadata,
          metadataOnly: optimizeMetadata && !options.showIndexingVisual,
          forceMetadata: shouldForceMetadata,
          skipCoverExtraction: false,
          priorityFolder: selectedFolderPath,
          language: config?.language || config?.lang || 'ko',
        },
      );
      if (result?.success === false) throw new Error(result.message || t('msg_failed'));
      if (result?.cancelled) {
        wasCancelled = true;
        return;
      }
      shouldRefreshIndexedFolder = true;
      shouldShowSuccessToast = true;
    } catch (error) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: `${t('msg_failed')}:\n${error.message}`,
        language: config?.language || config?.lang || 'ko',
      });
    } finally {
      preparingDuplicatesRef.current = false;
      setPreparingDuplicates(false);
      setFolderTaskCancelling(false);
      setLibraryTaskMode(null);
      setDuplicatePreparationStatus('');
      setDuplicatePreparationProgress(0);
      folderStatusItemRef.current = { currentItem: '', currentItemName: '' };
      await refreshLibraryScanStates([folderPath]);
      if (wasCancelled) markLibraryScanStatesCancelled([folderPath]);
      activeLibraryScanKeyRef.current = '';
      libraryScanUiHeartbeatRef.current = 0;
      libraryPhaseRef.current = '';
      emitStatusState('folder', {
        message: t('status_wait'),
        progress: 0,
        phase: 'idle',
      });
    }
    if (!shouldRefreshIndexedFolder) return;
    const shouldResetIncludeSubfolders = options.resetIncludeSubfoldersOnComplete === true;
    const nextIncludeSubfolders = optimizeMetadata
      ? (shouldResetIncludeSubfolders ? false : true)
      : includeSubfolders;
    const refreshOptions = {
      ...scanOptions,
      includeSubfolders: nextIncludeSubfolders,
      force: true,
    };
    if (includeSubfolders !== nextIncludeSubfolders) setIncludeSubfolders(nextIncludeSubfolders);
    setSelectedFolderPath(folderPath);
    clearSelection();
    resetSearchQuery();
    const files = await scanFolder(folderPath, {
      ...refreshOptions,
      fastInitial: false,
      silent: true,
      suppressEvents: true,
      reportTaskProgress: false,
      reportFileReady: false,
    });
    setMissingData(findMissingVolumes(files || []));
    if (shouldShowSuccessToast) showToast?.({ key: 'setting_update_index_msg' });
  }, [
    config?.language,
    config?.lang,
    clearSelection,
    markLibraryScanStatesCancelled,
    preparingDuplicates,
    refreshLibraryScanStates,
    resetSearchQuery,
    saveConfig,
    scanFolder,
    scanOptions,
    scanning,
    selectedFolderPath,
    showToast,
    includeSubfolders,
    isCheckingMissing,
    t,
  ]);

  useEffect(() => {
    const folderPath = pendingInitialLibraryIndexRef.current;
    if (!folderPath || preparingDuplicates || scanning) return;
    if (!libraries.includes(folderPath)) return;
    pendingInitialLibraryIndexRef.current = '';
    runLibraryIndexAction(folderPath, true, {
      mode: 'smart',
      skipPrompt: true,
      showIndexingVisual: true,
      resetIncludeSubfoldersOnComplete: true,
      forceMetadata: false,
    });
  }, [libraries, preparingDuplicates, runLibraryIndexAction, scanning]);

  const handleCancelCurrentTask = useCallback(async () => {
    if (!preparingDuplicates && !scanning && !isCheckingMissing) return;
    setFolderTaskCancelling(true);
    setDuplicatePreparationStatus(t('cancel_wait'));
    const isLibraryScanTask = preparingDuplicates;
    emitStatusState('folder', {
      task: preparingDuplicates ? 'folder:updateIndex' : isCheckingMissing ? 'folder:libraryScan' : 'folder:scan',
      display: isLibraryScanTask ? 'library-slide' : '',
      message: t('cancel_wait'),
      progress: duplicatePreparationProgress || scanProgress,
      phase: 'cancelling',
      libraryPhase: isLibraryScanTask ? (libraryPhaseRef.current || (libraryTaskMode === 'metadata' ? 'metadata' : 'indexing')) : '',
      libraryTaskMode,
    });
    if (isCheckingMissing) backgroundLibraryScanCancelRef.current?.();
    await Promise.all([
      window.electronAPI?.stopTask?.('folder:updateIndex'),
      window.electronAPI?.stopTask?.('folder:scan'),
    ]);
    await refreshLibraryScanStates();
    markLibraryScanStatesCancelled();
  }, [duplicatePreparationProgress, isCheckingMissing, libraryTaskMode, markLibraryScanStatesCancelled, preparingDuplicates, refreshLibraryScanStates, scanProgress, scanning, t]);

  const handleAddFolderFromToolbar = useCallback(async () => {
    const folderPath = await window.electronAPI?.selectFolder?.(t('add_folder'));
    if (folderPath) await handleFolderChange(folderPath);
  }, [handleFolderChange, t]);

  const handleAddFileFromToolbar = useCallback(async () => {
    const paths = await window.electronAPI?.selectArchives?.(t('add_file'));
    const firstParent = parentPath(paths?.[0]);
    if (firstParent) await handleFolderChange(firstParent);
  }, [handleFolderChange, t]);

  const handleDroppedPaths = useCallback(async (paths) => {
    for (const droppedPath of paths || []) {
      const stat = await window.electronAPI?.stat?.(droppedPath);
      const targetFolder = stat?.isDirectory ? droppedPath : parentPath(droppedPath);
      if (!targetFolder) continue;
      await handleFolderChange(targetFolder);
      return;
    }
  }, [handleFolderChange]);

  const handleFileSelect = useCallback((filePath, event, index) => {
    if (Array.isArray(filePath)) {
      if (filePath.length > 0) selectFile(filePath[0]);
      else clearSelection();
      return;
    }
    if (!filePath) return;
    if (event?.shiftKey) {
      rangeSelect(filePath, null, index);
    } else if (hasPrimaryModifier(event, runtimePlatform)) {
      toggleFile(filePath, null, index);
    } else {
      selectFile(filePath, null, index);
    }
  }, [clearSelection, rangeSelect, runtimePlatform, selectFile, toggleFile]);

  const ensureActiveSelectionVisible = useCallback(() => {
    if (!activeSelectedPath) return;
    const container = viewContainerRef.current;
    if (!container) return;
    const targetPath = String(activeSelectedPath);
    const activeElement = Array.from(container.querySelectorAll('[data-file-path]'))
      .find(element => String(element?.dataset?.filePath || '') === targetPath);
    if (!activeElement) return;
    activeElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeSelectedPath]);

  useEffect(() => {
    if (!activeSelectedPath) return;
    let frame = 0;
    let nestedFrame = 0;
    frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(ensureActiveSelectionVisible);
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (nestedFrame) window.cancelAnimationFrame(nestedFrame);
    };
  }, [activeSelectedPath, detailPanelHeight, ensureActiveSelectionVisible, viewMode]);

  const selectedFileObjects = useMemo(() => (
    selectedFiles.map(filePath => displayedFileByPath.get(filePath)).filter(Boolean)
  ), [displayedFileByPath, selectedFiles]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleViewModeChange = useCallback(nextMode => {
    const currentScroller = viewContainerRef.current?.querySelector(
      '.file-table-container, .thumbnail-grid, .tile-grid',
    );
    if (currentScroller) viewScrollPositionsRef.current[viewMode] = currentScroller.scrollTop;
    setViewMode(nextMode);
    window.requestAnimationFrame(() => {
      const nextScroller = viewContainerRef.current?.querySelector(
        '.file-table-container, .thumbnail-grid, .tile-grid',
      );
      if (!nextScroller) return;
      nextScroller.scrollTop = viewScrollPositionsRef.current[nextMode]
        ?? viewScrollPositionsRef.current[viewMode]
        ?? 0;
    });
  }, [viewMode]);

  const openSelectedInExplorer = useCallback(async () => {
    const target = activeSelectedFile?.full_path || activeSelectedFile?.path || selectedFolderPath;
    if (target) await window.electronAPI?.showInFolder?.(target);
  }, [activeSelectedFile, selectedFolderPath]);

  const openFolderPath = useCallback(async (folderPath) => {
    if (folderPath) await window.electronAPI?.openInExplorer?.(folderPath);
  }, []);

  const openFileInViewer = useCallback(async (file) => {
    const target = typeof file === 'string' ? file : file?.full_path || file?.path;
    if (!target) return;
    const explicitViewerPath = typeSpecificViewerPath(config, target);
    let explicitViewerResult = null;
    if (explicitViewerPath) {
      try {
        explicitViewerResult = await window.electronAPI?.openWithViewer?.(explicitViewerPath, target);
      } catch (error) {
        explicitViewerResult = { success: false, message: error.message || String(error) };
      }
      if (explicitViewerResult?.success) return;
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: viewerErrorMessage(explicitViewerResult) || t('msg_failed'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }

    let internalResult = null;
    try {
      internalResult = await window.electronAPI?.openInternalViewer?.(target);
    } catch (error) {
      internalResult = { success: false, message: error.message || String(error) };
    }
    if (internalResult?.success) return;

    await window.electronAPI?.showMessage?.({
      type: 'error',
      title: t('dlg_err'),
      message: viewerErrorMessage(internalResult) || t('msg_failed'),
      language: config?.language || config?.lang || 'ko',
    });
  }, [config, t]);

  const openSelectedInViewer = useCallback(async () => {
    await openFileInViewer(activeSelectedFile);
  }, [activeSelectedFile, openFileInViewer]);

  const handleFileOpen = useCallback(async (file, event, index) => {
    if (!file?.path) return;
    selectFile(file.path, null, index);
    await openFileInViewer(file);
  }, [openFileInViewer, selectFile]);

  const deleteSelectedFiles = useCallback(async () => {
    const targets = selectedFileObjects.map(file => file.full_path || file.path).filter(Boolean);
    if (targets.length === 0) return;
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('dlg_warn'),
      message: t('dlg_del_file_msg', [targets.length]),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: config?.language || config?.lang || 'ko',
    });
    if (response !== 'yes') return;
    const result = await runInternalFileAction(
      () => window.electronAPI?.deleteFiles?.(targets),
    );
    if (result?.success === false) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: result.errors?.join('\n') || result.message || t('msg_failed'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    clearSelection();
    handleRefresh();
  }, [clearSelection, config?.language, config?.lang, handleRefresh, runInternalFileAction, selectedFileObjects, t]);

  const renameSelectedFile = useCallback(async () => {
    const target = activeSelectedFile?.full_path || activeSelectedFile?.path;
    if (!target) return;
    const oldName = String(target).split(/[\\/]/).pop() || '';
    const inputName = await requestTextInput({
      title: t('msg_rename_title'),
      message: t('msg_rename_desc'),
      initialValue: oldName,
      inputId: 'folder-file-rename-input',
    });
    if (inputName === null) return;
    const policy = protectedRenameName(oldName, inputName);
    if (!policy.valid) {
      if (policy.reason === 'empty' || policy.reason === 'same') return;
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('msg_rename_title'),
        message: t('msg_err_rename_fail', [t('msg_rename_dup')]),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const nextPath = replaceBasename(target, policy.name);
    if (await window.electronAPI?.exists?.(nextPath)) {
      showToast?.(t('msg_rename_dup'));
      return;
    }
    const result = await runInternalFileAction(
      () => window.electronAPI?.renameFile?.(target, nextPath),
    );
    if (!result?.success) {
      const kind = fileOperationErrorKind(result);
      const detail = kind === 'permission'
        ? `${t('dlg_err')}: ${result?.message || 'Permission denied'}`
        : result?.message || t('msg_failed');
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('msg_rename_title'),
        message: t('msg_err_rename_fail', [detail]),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    showToast?.({ key: 'msg_rename_success' });
    await handleRefresh();
    selectFile(nextPath);
  }, [activeSelectedFile, config?.language, config?.lang, handleRefresh, requestTextInput, runInternalFileAction, selectFile, showToast, t]);

  const undoLastRename = useCallback(async () => {
    const result = await window.electronAPI?.undoRename?.();
    if (!result?.success) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: result?.message || result?.errors?.join(' / ') || t('tf_undo_fail'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    showToast?.(`${t('tf_undo_success')} (${result.successCount || 0} files)`);
    clearSelection();
    handleRefresh();
  }, [clearSelection, config?.language, config?.lang, handleRefresh, showToast, t]);

  const groupSelectedBySeries = useCallback(async () => {
    const plans = selectedFileObjects.flatMap(file => {
      const source = file.full_path || file.path;
      const coreTitle = extractCoreTitle(file.name || basename(source));
      if (!source || !coreTitle || basename(parentPath(source)).toLowerCase() === coreTitle.toLowerCase()) return [];
      return [{ src: source, dest: joinPath(parentPath(source), coreTitle, basename(source)) }];
    });
    if (plans.length === 0) {
      showToast?.(t('tf_empty_no_data'));
      return;
    }
    setSeriesMovePreview(plans);
  }, [selectedFileObjects, showToast, t]);

  const forceUpdateSelectedFiles = useCallback(async contextFile => {
    if (!selectedFolderPath) return;
    const contextPath = contextFile?.full_path || contextFile?.path;
    const targets = selectedFileObjects.length > 0 && (!contextPath || selectedFileSet.has(contextPath))
      ? selectedFileObjects
      : [contextFile].filter(Boolean);
    if (targets.length === 0) return;

    const refreshed = [];
    for (const file of targets) {
      const filePath = file.full_path || file.path;
      if (!filePath) continue;
      const result = await window.electronAPI?.getFilePreview?.(filePath, { force: true });
      if (result?.success && result.file) {
        refreshed.push({
          ...file,
          ...result.file,
          path: file.path,
          full_path: file.full_path || result.file.full_path || result.file.path,
        });
      }
    }
    if (refreshed.length > 0) {
      updateCachedFiles(selectedFolderPath, scanOptions, refreshed);
      showToast?.(`${t('action_update_files')} (${refreshed.length})`);
    }
  }, [scanOptions, selectedFileObjects, selectedFileSet, selectedFolderPath, showToast, t, updateCachedFiles]);

  const executeSeriesMove = useCallback(async plans => {
    const result = await runInternalFileAction(
      () => window.electronAPI?.executeLibraryMove?.(plans),
    );
    setSeriesMovePreview(null);
    if (result?.successCount > 0) {
      showToast?.(t('msg_series_grouped', [result.successCount]));
      clearSelection();
      handleRefresh();
    } else {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: result?.errors?.join('\n') || t('tf_empty_no_data'),
        language: config?.language || config?.lang || 'ko',
      });
    }
  }, [clearSelection, config?.language, config?.lang, handleRefresh, runInternalFileAction, showToast, t]);

  const requestConflictChoice = useCallback(conflict => new Promise(resolve => {
    conflictResolverRef.current = resolve;
    setMoveConflict(conflict);
  }), []);

  const resolveConflictChoice = useCallback(choice => {
    const resolve = conflictResolverRef.current;
    conflictResolverRef.current = null;
    setMoveConflict(null);
    resolve?.(choice);
  }, []);

  const emitLibraryMoveProgress = useCallback((message, progress, itemPath = '', options = {}) => {
    const currentItem = itemPath || folderStatusItemRef.current.currentItem || '';
    const currentItemName = currentItem ? basename(currentItem) : folderStatusItemRef.current.currentItemName;
    folderStatusItemRef.current = { currentItem, currentItemName };
    emitStatusState('folder', {
      task: 'folder:libraryMove',
      display: 'library-slide',
      message,
      progress,
      phase: options.phase || 'analyzing',
      libraryPhase: options.libraryPhase || 'moving',
      libraryTaskMode: 'move',
      currentItem,
      currentItemName,
      slideItemReady: options.slideItemReady ?? Boolean(currentItem),
    });
  }, []);

  const clearLibraryMoveProgress = useCallback(() => {
    folderStatusItemRef.current = { currentItem: '', currentItemName: '' };
    emitStatusState('folder', {
      message: t('status_wait'),
      progress: 0,
      phase: 'idle',
    });
  }, [t]);

  const executeLibraryMovePlans = useCallback(async (plans, options = {}) => {
    options.onStage?.('conflicts', 8);
    const conflictResponse = await window.electronAPI?.findLibraryMoveConflicts?.(plans);
    const conflicts = conflictResponse?.success !== false && Array.isArray(conflictResponse?.conflicts)
      ? conflictResponse.conflicts
      : null;
    const resolvedPlans = [];
    const conflictsByIndex = new Map((conflicts || []).map(conflict => [conflict.index, conflict]));
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const conflict = conflicts ? conflictsByIndex.get(index) : await window.electronAPI?.exists?.(plan.dest);
      if (!conflict) {
        resolvedPlans.push(plan);
        continue;
      }
      options.onConflictWait?.(plan);
      const sourcePreview = await window.electronAPI?.getFilePreview?.(plan.src, { force: false });
      const destinationPreview = await window.electronAPI?.getFilePreview?.(plan.dest, { force: false });
      const choice = await requestConflictChoice({
        plan,
        source: sourcePreview?.file || { name: basename(plan.src), path: plan.src },
        destination: destinationPreview?.file || { name: basename(plan.dest), path: plan.dest },
      });
      options.onStage?.('conflicts', 12);
      resolvedPlans.push(applyConflictChoice(plan, choice || 'skip'));
    }

    options.onStage?.('moving', 25);
    return runInternalFileAction(
      () => window.electronAPI?.executeLibraryMove?.(resolvedPlans),
    );
  }, [requestConflictChoice, runInternalFileAction]);

  const moveSelectedToLibrary = useCallback(async plans => {
    if (!Array.isArray(plans) || plans.length === 0) return;
    if (libraries.length === 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('warn_no_library'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const targetLibrary = plans[0]?.targetLibrary;
    if (!targetLibrary) return;
    const firstMoveItem = plans[0]?.src || plans[0]?.full_path || plans[0]?.path || '';
    emitLibraryMoveProgress(t('library_move_status_prepare'), 2, firstMoveItem);
    try {
      setLibraryMoveRequest(null);
      await saveConfig?.({ last_selected_library: targetLibrary });
      const folderPlan = plans.find(plan => plan.folderMode);
      let executablePlans = plans;
      if (folderPlan) {
        const destinationExists = await window.electronAPI?.exists?.(folderPlan.dest);
        if (destinationExists) {
          emitLibraryMoveProgress(t('library_move_status_conflicts', [1]), 6, folderPlan.src);
          const expanded = await window.electronAPI?.expandFolderMove?.(folderPlan.src, folderPlan.dest);
          if (!expanded?.success) {
            await window.electronAPI?.showMessage?.({
              type: 'error',
              title: t('dlg_err'),
              message: t('dlg_err_occurred', [expanded?.message || t('msg_failed')]),
              language: config?.language || config?.lang || 'ko',
            });
            return;
          }
          executablePlans = expanded.plans.map(plan => ({ ...plan, targetLibrary }));
        } else {
          executablePlans = [folderPlan];
        }
      }
      const result = await executeLibraryMovePlans(executablePlans, {
        onStage: (stage, progress) => {
          const currentItem = executablePlans[0]?.src || firstMoveItem;
          if (stage === 'conflicts') {
            emitLibraryMoveProgress(t('library_move_status_conflicts', [executablePlans.length]), progress, currentItem);
          } else if (stage === 'moving') {
            emitLibraryMoveProgress(t('library_move_status_moving', [executablePlans.length]), progress, currentItem);
          }
        },
        onConflictWait: () => {
          clearLibraryMoveProgress();
        },
      });
      if (result?.successCount > 0) {
        emitLibraryMoveProgress(t('library_move_status_refreshing'), 70, executablePlans[0]?.src || firstMoveItem);
        let selectedFolderRemoved = false;
        if (folderPlan) {
          await window.electronAPI?.removeEmptyTree?.(folderPlan.src);
        } else if (selectedFolderPath) {
          await window.electronAPI?.removeEmptyTree?.(selectedFolderPath);
          selectedFolderRemoved = !(await window.electronAPI?.exists?.(selectedFolderPath));
        }
        showToast?.(t('msg_move_lib_done', [result.successCount]));
        clearSelection();
        const completedMoves = Array.isArray(result.completedMoves) ? result.completedMoves : [];
        const affectedLibraries = [...new Set([
          targetLibrary,
          ...libraries.filter(library => completedMoves.some(move => (
            isPathInsideLibrary(move.src, library) || isPathInsideLibrary(move.dest, library)
          ))),
        ])];
        emitLibraryMoveProgress(t('library_move_status_indexing'), 78, targetLibrary, {
          libraryPhase: 'indexing',
          slideItemReady: false,
        });
        const indexResult = await window.electronAPI?.applyLibraryMoveIndex?.({
          completedMoves,
          libraries,
        });
        if (indexResult?.success === false) throw new Error(indexResult.message || t('msg_failed'));
        await refreshLibraryScanStates(affectedLibraries);
        emitLibraryMoveProgress(t('library_move_status_refreshing'), 94, targetLibrary);
        if (folderPlan) {
          await handleFolderChange(folderPlan.dest);
        } else if (selectedFolderRemoved) {
          const fallbackFolder = parentPath(selectedFolderPath);
          if (fallbackFolder && await window.electronAPI?.exists?.(fallbackFolder)) {
            await handleFolderChange(fallbackFolder);
          } else {
            setSelectedFolderPath('');
            clearSelection();
          }
        } else {
          await handleRefresh();
        }
        setTreeRefreshToken(current => current + 1);
      }
      if (result?.errors?.length > 0) {
        await window.electronAPI?.showMessage?.({
          type: 'error',
          title: t('dlg_err'),
          message: result?.errors?.join('\n') || t('msg_failed'),
          language: config?.language || config?.lang || 'ko',
        });
      }
    } finally {
      clearLibraryMoveProgress();
    }
  }, [clearLibraryMoveProgress, clearSelection, config?.language, config?.lang, emitLibraryMoveProgress, executeLibraryMovePlans, handleFolderChange, handleRefresh, libraries, refreshLibraryScanStates, saveConfig, selectedFolderPath, showToast, t]);

  const openLibraryMoveDialog = useCallback(async () => {
    if (libraries.length === 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('warn_no_library'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    if (selectedFileObjects.length === 0) return;
    setLibraryMoveRequest({
      sources: selectedFileObjects,
      folderMode: false,
    });
  }, [config?.language, config?.lang, libraries.length, selectedFileObjects, t]);

  const sendSelectedFilesToTab = useCallback(tabId => {
    const paths = selectedFileObjects.map(file => file.full_path || file.path).filter(Boolean);
    if (paths.length === 0) return;
    window.dispatchEvent(new CustomEvent('bookmanager:navigate', {
      detail: { tabId, paths },
    }));
  }, [selectedFileObjects]);

  const executeMultiRename = useCallback(async rows => {
    const renameMap = buildRenameMap(rows);
    const targetCount = Object.keys(renameMap).length;
    if (targetCount === 0) return { success: false, successCount: 0, errors: [] };
    const result = await runInternalFileAction(
      () => window.electronAPI?.multiRenameFiles?.(renameMap),
    );
    await handleRefresh();
    if (result?.errors?.length > 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('msg_multi_rename_errors', [
          result.successCount || 0,
          result.errors.slice(0, 10).join('\n'),
        ]),
        language: config?.language || config?.lang || 'ko',
      });
    } else if (result?.successCount > 0) {
      showToast?.(t('msg_multi_rename_done', [result.successCount]));
    }
    return result;
  }, [config?.language, config?.lang, handleRefresh, runInternalFileAction, showToast, t]);

  const showFileContextMenu = useCallback((event, file, index) => {
    event.preventDefault();
    if (file?.path && !selectedFileSet.has(file.path)) {
      selectFile(file.path, null, index);
    }
    setContextMenu({ type: 'file', x: event.clientX, y: event.clientY, file });
  }, [selectFile, selectedFileSet]);

  const showFolderContextMenu = useCallback((event, folderPath, siblingPaths = []) => {
    event.preventDefault();
    setContextMenu({
      type: 'folder',
      x: event.clientX,
      y: event.clientY,
      folderPath,
      siblingPaths,
    });
  }, []);

  const showLibraryContextMenu = useCallback((event, folderPath) => {
    event.preventDefault();
    setContextMenu({ type: 'library', x: event.clientX, y: event.clientY, folderPath });
  }, []);

  const showFolderError = useCallback(async (messageKey, detail) => {
    await window.electronAPI?.showMessage?.({
      type: 'error',
      title: t('dlg_err'),
      message: t(messageKey, [detail]),
      language: config?.language || config?.lang || 'ko',
    });
  }, [config?.language, config?.lang, t]);

  const refreshContextFolder = useCallback(async folderPath => {
    if (!folderPath) return;
    setTreeRefreshToken(current => current + 1);
    if (folderPath === selectedFolderPath) {
      resetCoverPreviewQueue();
      await scanFolder(folderPath, { ...scanOptions, force: true });
    }
  }, [resetCoverPreviewQueue, scanFolder, scanOptions, selectedFolderPath]);

  const renameContextFolder = useCallback(async folderPath => {
    if (!folderPath) return;
    const oldName = basename(folderPath);
    const input = await requestTextInput({
      title: t('dlg_ren_folder_title'),
      message: t('dlg_ren_folder_msg'),
      initialValue: oldName,
      inputId: 'folder-tree-rename-input',
    });
    if (input === null) return;
    const nextName = input.trim();
    if (!nextName) return;
    if (nextName === oldName) {
      await showFolderError('dlg_err_ren_folder', t('msg_rename_dup'));
      return;
    }

    const nextPath = replaceBasename(folderPath, nextName);
    if (await window.electronAPI?.exists?.(nextPath)) {
      await showFolderError('dlg_err_ren_folder', t('msg_rename_dup'));
      return;
    }

    const result = await runInternalFileAction(
      () => window.electronAPI?.renameFile?.(folderPath, nextPath),
    );
    if (!result?.success) {
      await showFolderError('dlg_err_ren_folder', result?.message || t('msg_failed'));
      return;
    }

    const configPatch = {};
    if (isFavoriteFolder(favoriteEntries, folderPath)) {
      const withoutOldPath = removeFavoriteEntry(favoriteEntries, folderPath);
      Object.assign(configPatch, serializeFavorites(addFavoriteEntry(withoutOldPath, nextPath)));
    }
    if ((config?.libraries || []).includes(folderPath)) {
      configPatch.libraries = config.libraries.map(path => path === folderPath ? nextPath : path);
    }
    if ((config?.dup_check_folders || []).includes(folderPath)) {
      configPatch.dup_check_folders = config.dup_check_folders.map(path => path === folderPath ? nextPath : path);
    }
    if (libraryEntries.some(entry => entry.path === folderPath)) {
      Object.assign(configPatch, syncLibraryConfig({}, libraryEntries.map(entry => (
        entry.path === folderPath ? { ...entry, path: nextPath } : entry
      ))));
    }
    if (Object.keys(configPatch).length > 0) {
      await saveConfig?.(configPatch);
    }

    const nextSelection = replaceTreePath(selectedFolderPath, folderPath, nextPath);
    setTreeRefreshToken(current => current + 1);
    if (nextSelection !== selectedFolderPath) {
      await handleFolderChange(nextSelection);
    }
  }, [config?.dup_check_folders, config?.libraries, favoriteEntries, handleFolderChange, libraryEntries, requestTextInput, runInternalFileAction, saveConfig, selectedFolderPath, showFolderError, t]);

  const markFolderPanelFocus = useCallback(panel => {
    lastFolderPanelRef.current = panel;
  }, []);

  const isExplorerPanelActive = useCallback(() => {
    const activeElement = document.activeElement;
    return lastFolderPanelRef.current === 'explorer'
      || Boolean(activeElement?.closest?.('.folder-left-panel, .folder-sidebar'));
  }, []);

  const handleRefreshShortcut = useCallback(async () => {
    if (isExplorerPanelActive()) {
      await refreshContextFolder(selectedFolderPath);
      return;
    }
    await handleSmartRefresh(true);
  }, [handleSmartRefresh, isExplorerPanelActive, refreshContextFolder, selectedFolderPath]);

  const handleRenameShortcut = useCallback(async () => {
    if (isExplorerPanelActive()) {
      await renameContextFolder(selectedFolderPath);
      return;
    }
    if (selectedFileObjects.length > 0) {
      setShowMultiRenameDialog(true);
    }
  }, [isExplorerPanelActive, renameContextFolder, selectedFileObjects.length, selectedFolderPath]);

  const deleteContextFolder = useCallback(async menu => {
    const folderPath = menu?.folderPath;
    if (!folderPath) return;
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('dlg_del_folder_title'),
      message: t('dlg_del_folder_msg', [basename(folderPath)]),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: config?.language || config?.lang || 'ko',
    });
    if (response !== 'yes') return;

    const result = await runInternalFileAction(
      () => window.electronAPI?.deleteFiles?.([folderPath]),
    );
    if (!result?.success) {
      await showFolderError('dlg_del_err', result?.errors?.join('\n') || result?.message || t('msg_failed'));
      return;
    }

    if (isFavoriteFolder(favoriteEntries, folderPath)) {
      await removeFavorite(folderPath);
    }
    if (libraries.includes(folderPath)) {
      await removeLibrary(folderPath);
    }
    const nextSelection = resolveSelectionAfterDelete(folderPath, menu.siblingPaths);
    setTreeRefreshToken(current => current + 1);
    if (nextSelection && await window.electronAPI?.exists?.(nextSelection)) {
      await handleFolderChange(nextSelection);
    } else {
      setSelectedFolderPath('');
      clearSelection();
    }
  }, [clearSelection, config?.language, config?.lang, favoriteEntries, handleFolderChange, libraries, removeFavorite, removeLibrary, runInternalFileAction, showFolderError, t]);

  const moveContextFolderToLibrary = useCallback(async folderPath => {
    if (!folderPath) return;
    if (libraries.length === 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('warn_no_library'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const availableLibraries = libraries.filter(library => library !== folderPath);
    if (availableLibraries.length === 0) return;
    setLibraryMoveRequest({
      sources: [folderPath],
      folderMode: true,
      libraries: availableLibraries,
    });
  }, [config?.language, config?.lang, libraries, t]);

  const sendFolderToTab = useCallback((folderPath, tabId) => {
    if (!folderPath) return;
    window.dispatchEvent(new CustomEvent('bookmanager:navigate', {
      detail: { tabId, paths: [folderPath] },
    }));
  }, []);

  const handleContextAction = useCallback(async (action) => {
    const menu = contextMenu;
    closeContextMenu();
    if (!menu) return;

    if (action === 'sync-library' && isLibraryContext(menu)) {
      await runLibraryIndexAction(menu.folderPath, false);
    } else if (action === 'optimize-library' && isLibraryContext(menu)) {
      await runLibraryIndexAction(menu.folderPath, true);
    } else if (action === 'remove-library' && isLibraryContext(menu)) {
      await removeLibrary(menu.folderPath);
    } else if (action === 'open-folder') {
      handleFolderChange(menu.folderPath || selectedFolderPath);
    } else if (action === 'open-explorer') {
      await openFolderPath(menu.folderPath || selectedFolderPath);
    } else if (action === 'favorite-folder') {
      await addFavorite(menu.folderPath || selectedFolderPath);
    } else if (action === 'unfavorite-folder') {
      await removeFavorite(menu.folderPath || selectedFolderPath);
    } else if (action === 'refresh-folder') {
      await refreshContextFolder(menu.folderPath || selectedFolderPath);
    } else if (action === 'rename-folder') {
      await renameContextFolder(menu.folderPath);
    } else if (action === 'delete-folder') {
      await deleteContextFolder(menu);
    } else if (action === 'move-folder-library') {
      await moveContextFolderToLibrary(menu.folderPath);
    } else if (action === 'send-organizer') {
      sendFolderToTab(menu.folderPath, 'organizer');
    } else if (action === 'send-renamer') {
      sendFolderToTab(menu.folderPath, 'renamer');
    } else if (action === 'send-metadata') {
      sendFolderToTab(menu.folderPath, 'metadata');
    } else if (action === 'show-file') {
      const target = menu.file?.full_path || menu.file?.path;
      if (target) await window.electronAPI?.showInFolder?.(target);
    } else if (action === 'view-file') {
      await openSelectedInViewer();
    } else if (action === 'update-files') {
      await forceUpdateSelectedFiles(menu.file);
    } else if (action === 'delete-file') {
      await deleteSelectedFiles();
    } else if (action === 'rename-file') {
      await renameSelectedFile();
    } else if (action === 'undo-rename') {
      await undoLastRename();
    } else if (action === 'group-series') {
      await groupSelectedBySeries();
    } else if (action === 'move-library') {
      await openLibraryMoveDialog();
    } else if (action === 'multi-rename') {
      setShowMultiRenameDialog(true);
    } else if (action === 'send-file-organizer') {
      sendSelectedFilesToTab('organizer');
    } else if (action === 'send-file-renamer') {
      sendSelectedFilesToTab('renamer');
    } else if (action === 'send-file-metadata') {
      sendSelectedFilesToTab('metadata');
    } else if (action === 'select-all') {
      selectAll();
    } else if (action === 'invert-selection') {
      invertSelection();
    } else if (action === 'refresh-list') {
      await handleRefresh();
    }
  }, [addFavorite, closeContextMenu, contextMenu, deleteContextFolder, deleteSelectedFiles, forceUpdateSelectedFiles, groupSelectedBySeries, handleFolderChange, handleRefresh, invertSelection, moveContextFolderToLibrary, openFolderPath, openLibraryMoveDialog, openSelectedInViewer, refreshContextFolder, removeFavorite, removeLibrary, renameContextFolder, renameSelectedFile, runLibraryIndexAction, selectAll, selectedFolderPath, sendFolderToTab, sendSelectedFilesToTab, undoLastRename]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isFolderTabVisible()) return;
      if (event.key === 'Escape' && closeTopOverlay()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!shouldHandleGlobalShortcut(event)) return;

      if (event.key === 'F1') {
        event.preventDefault();
        sendSelectedFilesToTab('organizer');
      } else if (event.key === 'F2') {
        event.preventDefault();
        sendSelectedFilesToTab('renamer');
      } else if (event.key === 'F3') {
        event.preventDefault();
        sendSelectedFilesToTab('metadata');
      } else if (event.key === 'F5') {
        event.preventDefault();
        handleRefreshShortcut();
      } else if (hasPrimaryModifier(event, runtimePlatform) && isShortcutKey(event, 'a')) {
        event.preventDefault();
        selectAll();
      } else if (hasPrimaryModifier(event, runtimePlatform) && isShortcutKey(event, 'i')) {
        event.preventDefault();
        invertSelection();
      } else if (hasPrimaryModifier(event, runtimePlatform) && isShortcutKey(event, 'z')) {
        event.preventDefault();
        undoLastRename();
      } else if (hasPrimaryModifier(event, runtimePlatform) && isShortcutKey(event, 'f')) {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (hasPrimaryModifier(event, runtimePlatform) && isShortcutKey(event, 'g')) {
        event.preventDefault();
        setGotoPathDraft(selectedFolderPath);
        setShowGotoDialog(true);
      } else if (event.shiftKey && isShortcutKey(event, 'r')) {
        event.preventDefault();
        handleRenameShortcut();
      } else if (event.key === 'Escape') {
        clearSelection();
        closeContextMenu();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedFiles();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openSelectedInExplorer();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const nextPath = moveActiveSelection(event.key === 'ArrowUp' ? -1 : 1, event.shiftKey);
        if (nextPath) {
          window.requestAnimationFrame(() => {
            viewContainerRef.current
              ?.querySelector('.active-selection')
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
        }
      } else if (event.key === '1') {
        handleViewModeChange('table');
      } else if (event.key === '2') {
        handleViewModeChange('tile');
      } else if (event.key === '3') {
        handleViewModeChange('thumbnail');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', closeContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', closeContextMenu);
    };
  }, [clearSelection, closeContextMenu, closeTopOverlay, deleteSelectedFiles, handleRefreshShortcut, handleRenameShortcut, handleViewModeChange, invertSelection, isFolderTabVisible, moveActiveSelection, openSelectedInExplorer, runtimePlatform, selectAll, selectedFolderPath, sendSelectedFilesToTab, undoLastRename]);

  useEffect(() => {
    const handleAppAction = (event) => {
      if (event.detail?.activeTab !== 'folder') return;
      const action = event.detail?.action;
      if (action === 'cancel-current') {
        handleCancelCurrentTask();
        return;
      }
      if (preparingDuplicates || scanning) return;
      if (action === 'add-folder') handleAddFolderFromToolbar();
      else if (action === 'add-file') handleAddFileFromToolbar();
      else if (action === 'drop-paths') handleDroppedPaths(event.detail?.paths);
      else if (action === 'remove-selected') deleteSelectedFiles();
      else if (action === 'clear-all') clearSelection();
      else if (action === 'toggle-all') {
        if (selectedFiles.length >= filteredFileData.length && filteredFileData.length > 0) deselectAll();
        else selectAll();
      } else if (action === 'invert-selection') invertSelection();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [
    clearSelection,
    deleteSelectedFiles,
    deselectAll,
    filteredFileData.length,
    handleAddFileFromToolbar,
    handleAddFolderFromToolbar,
    handleCancelCurrentTask,
    handleDroppedPaths,
    invertSelection,
    preparingDuplicates,
    selectAll,
    selectedFiles.length,
    scanning,
  ]);

  const startHorizontalResize = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const containerWidth = mainAreaRef.current?.clientWidth || 1200;
    const containerLeft = mainAreaRef.current?.getBoundingClientRect?.().left || 0;
    const guide = createFolderResizeGuide('x', containerLeft + startWidth);
    let frameId = 0;
    let pendingGuidePosition = containerLeft + startWidth;

    const scheduleWidth = width => {
      pendingGuidePosition = containerLeft + width;
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateFolderResizeGuide(guide, 'x', pendingGuidePosition);
      });
    };

    const cleanup = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      guide?.remove();
      panelResizingRef.current = false;
      document.body.classList.remove('is-resizing-panel', 'is-resizing-folder-horizontal');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    const handleMove = (moveEvent) => {
      moveEvent.preventDefault();
      const nextWidth = startWidth + moveEvent.clientX - startX;
      scheduleWidth(clampSidebarWidth(nextWidth, containerWidth));
    };

    const handleUp = (upEvent) => {
      const nextWidth = startWidth + upEvent.clientX - startX;
      const savedWidth = clampSidebarWidth(nextWidth, containerWidth);
      cleanup();
      setLeftPanelWidth(current => current === savedWidth ? current : savedWidth);
      window.requestAnimationFrame(() => {
        updateRightPanelWidth();
        updateViewContainerWidth();
      });
      saveConfig?.({ folder_left_panel_width: savedWidth }).catch(error => {
        console.error('폴더 좌우 splitter 저장 실패:', error);
      });
    };

    panelResizingRef.current = true;
    document.body.classList.add('is-resizing-panel', 'is-resizing-folder-horizontal');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [leftPanelWidth, saveConfig, updateRightPanelWidth, updateViewContainerWidth]);

  const startVerticalResize = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = detailPanelHeight;
    const containerHeight = rightPanelRef.current?.clientHeight || 700;
    const rightPanelRect = rightPanelRef.current?.getBoundingClientRect?.();
    const bottomBarHeight = rightPanelRef.current?.querySelector?.('.right-bottom-bar')?.getBoundingClientRect?.().height || 0;
    const detailBottom = (rightPanelRect?.bottom || window.innerHeight) - bottomBarHeight;
    const guide = createFolderResizeGuide('y', detailBottom - startHeight);
    let frameId = 0;
    let pendingGuidePosition = detailBottom - startHeight;

    const scheduleHeight = height => {
      pendingGuidePosition = detailBottom - height;
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateFolderResizeGuide(guide, 'y', pendingGuidePosition);
      });
    };

    const cleanup = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      guide?.remove();
      panelResizingRef.current = false;
      document.body.classList.remove('is-resizing-panel', 'is-resizing-folder-vertical');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    const handleMove = (moveEvent) => {
      moveEvent.preventDefault();
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      scheduleHeight(clampDetailHeight(nextHeight, containerHeight));
    };

    const handleUp = (upEvent) => {
      const nextHeight = startHeight - (upEvent.clientY - startY);
      const savedHeight = clampDetailHeight(nextHeight, containerHeight);
      cleanup();
      setDetailPanelHeight(current => current === savedHeight ? current : savedHeight);
      window.requestAnimationFrame(updateViewContainerWidth);
      saveConfig?.({ folder_detail_panel_height: savedHeight }).catch(error => {
        console.error('폴더 상하 splitter 저장 실패:', error);
      });
    };

    panelResizingRef.current = true;
    document.body.classList.add('is-resizing-panel', 'is-resizing-folder-vertical');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [detailPanelHeight, saveConfig, updateViewContainerWidth]);

  const handleSort = useCallback((key, toggleSameKey = true) => {
    if (sortKey === key && toggleSameKey) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  }, [sortKey]);

  const handleToggleSortOrder = useCallback(() => {
    setSortOrder(current => current === 'asc' ? 'desc' : 'asc');
  }, []);

  const handleSaveLayout = useCallback(async () => {
    const name = (await requestTextInput({
      title: t('menu_save_layout'),
      message: t('dlg_save_lay_msg'),
      initialValue: '',
      inputId: 'folder-layout-save-input',
    }))?.trim();
    if (!name) return;
    const currentLayouts = config?.folder_saved_layouts && typeof config.folder_saved_layouts === 'object'
      ? { ...config.folder_saved_layouts }
      : {};
    if (currentLayouts[name]) {
      const response = await window.electronAPI?.showMessage?.({
        type: 'question',
        title: t('dlg_warn'),
        message: `${name}\n${t('lbl_conflict_desc')}`,
        buttons: 'yes-no',
        defaultChoice: 'no',
        language: config?.language || config?.lang || 'ko',
      });
      if (response !== 'yes') return;
    }
    currentLayouts[name] = {
      sortKey,
      sortOrder,
      groupKey,
      columns: serializeColumnLayout(columnLayout),
    };
    await saveConfig?.({ folder_saved_layouts: currentLayouts });
  }, [columnLayout, config?.folder_saved_layouts, config?.language, config?.lang, groupKey, requestTextInput, saveConfig, sortKey, sortOrder, t]);

  const handleDeleteLayout = useCallback(async name => {
    if (!name || !savedLayouts.includes(name)) return;
    const currentLayouts = { ...(config?.folder_saved_layouts || {}) };
    delete currentLayouts[name];
    await saveConfig?.({ folder_saved_layouts: currentLayouts });
    setShowDeleteLayoutDialog(false);
  }, [config?.folder_saved_layouts, saveConfig, savedLayouts]);

  const handleApplyLayout = useCallback(name => {
    const layout = config?.folder_saved_layouts?.[name];
    if (!layout || typeof layout !== 'object') return;
    if (layout.sortKey) setSortKey(layout.sortKey);
    if (layout.sortOrder) setSortOrder(layout.sortOrder);
    if (layout.groupKey) setGroupKey(layout.groupKey);
    if (layout.columns) {
      const nextColumns = normalizeColumnLayout(layout.columns);
      setColumnLayout(nextColumns);
      saveConfig?.({ folder_column_layout: serializeColumnLayout(nextColumns) });
    }
  }, [config?.folder_saved_layouts, saveConfig]);

  const handleApplyColumnLayout = useCallback(async nextLayout => {
    const normalized = normalizeColumnLayout(nextLayout);
    setColumnLayout(normalized);
    setShowLayoutDialog(false);
    await saveConfig?.({ folder_column_layout: serializeColumnLayout(normalized) });
  }, [saveConfig]);

  const handleDetailContentHeightChange = useCallback(contentHeight => {
    if (!contentHeight) return;
    const containerHeight = rightPanelRef.current?.clientHeight || 700;
    const nextHeight = clampDetailHeight(contentHeight, containerHeight);
    setDetailPanelHeight(current => Math.abs(current - nextHeight) > 2 ? nextHeight : current);
  }, []);

  const handleColumnLayoutChange = useCallback((nextLayout, persist = false) => {
    const normalized = normalizeColumnLayout(nextLayout);
    setColumnLayout(normalized);
    if (persist) {
      saveConfig?.({ folder_column_layout: serializeColumnLayout(normalized) }).catch(error => {
        console.error('폴더 컬럼 레이아웃 저장 실패:', error);
      });
    }
  }, [saveConfig]);

  const handleExportCsv = useCallback(async () => {
    if (filteredFileData.length === 0) {
      await window.electronAPI?.showMessage?.({
        type: 'info',
        title: t('dlg_exp_title'),
        message: t('dlg_exp_no_data'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const filePath = await window.electronAPI?.saveFile?.(t('dlg_exp_title'), [
      { name: 'CSV', extensions: ['csv'] },
    ], 'My_Library_Export.csv');
    if (!filePath) return;
    const exportColumns = columnLayout.filter(column => column.visible);
    const headers = exportColumns.map(column => t(column.labelKey));
    const rows = filteredFileData.map(file => exportColumns.map(column => {
      if (column.key === 'folder_path') return file.folder_path || parentPath(file.full_path || file.path);
      if (column.key === 'author') return file.author || file.writer || '';
      if (column.key === 'cover') return file.cover ? t('folder_cover_img') : '';
      if (column.key === 'viewer_reading_status') return viewerReadingStatusText(file.viewerStatus, t);
      if (column.key === 'viewer_bookmark_status') return viewerBookmarkStatusText(file.viewerStatus, t);
      return file[column.key] ?? '';
    }));
    const result = await window.electronAPI?.exportCsv?.(filePath, headers, rows);
    await window.electronAPI?.showMessage?.({
      type: result?.success ? 'info' : 'error',
      title: result?.success ? t('dlg_exp_title') : t('dlg_err'),
      message: result?.success ? t('dlg_exp_done') : t('dlg_err_occurred', [result?.message || t('msg_failed')]),
      language: config?.language || config?.lang || 'ko',
    });
  }, [columnLayout, config?.language, config?.lang, filteredFileData, t]);

  // View Stack
  const renderViewStack = () => {
    const props = {
      fileData: filteredFileData,
      groupedData: groupedFileData,
      selectedFiles,
      selectedFileSet,
      activeSelectedPath,
      sortKey,
      sortOrder,
      groupKey,
      onSelect: handleFileSelect,
      onOpenFile: handleFileOpen,
      onDragSelect: selectPaths,
      onContextMenu: showFileContextMenu,
      onClearSelection: clearSelection,
      onVisibleFilesChange: handleVisibleFilesChange,
      onScroll: event => {
        viewScrollPositionsRef.current[viewMode] = event.currentTarget.scrollTop;
      },
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} groupedData={groupedFileData} selectedFiles={selectedFiles} selectedFileSet={selectedFileSet} activeSelectedPath={activeSelectedPath} onSelect={handleFileSelect} onOpenFile={handleFileOpen} onDragSelect={selectPaths} onContextMenu={showFileContextMenu} onClearSelection={clearSelection} onVisibleFilesChange={handleVisibleFilesChange} onScroll={props.onScroll} onSort={handleSort} t={t} sortKey={sortKey} sortOrder={sortOrder} groupKey={groupKey} columnLayout={columnLayout} onColumnLayoutChange={handleColumnLayoutChange} scale={itemScale} />;
    }
  };

  return (
    <div className="folder-tab">
      <div
        className="folder-main-area"
        ref={mainAreaRef}
        style={{ '--folder-sidebar-width': isSidebarVisible ? `${leftPanelWidth}px` : '0px' }}
      >
        {/* Left Panel */}
        {isSidebarVisible && (
          <div
            className="folder-left-panel"
            style={{ flexBasis: `${leftPanelWidth}px`, width: `${leftPanelWidth}px` }}
            onMouseDownCapture={() => markFolderPanelFocus('explorer')}
            onFocusCapture={() => markFolderPanelFocus('explorer')}
          >
            <div className="left-toolbar">
              <div className="left-toolbar-row">
                <button
                  className={`folder-checkable-btn ${includeSubfolders ? 'checked' : ''}`}
                  type="button"
                  aria-pressed={includeSubfolders}
                  disabled={shouldDisableFolderToggles(scanning, preparingDuplicates)}
                  onClick={handleIncludeSubfoldersChange}
                >
                  {t(folderToggleLabelKey('subfolders', includeSubfolders))}
                </button>
                <button
                  className={`folder-checkable-btn ${enableDupCheck ? 'checked' : ''}`}
                  type="button"
                  aria-pressed={enableDupCheck}
                  disabled={shouldDisableFolderToggles(scanning, preparingDuplicates)}
                  onClick={handleDupCheckChange}
                >
                  {t(folderToggleLabelKey('duplicates', enableDupCheck))}
                </button>
              </div>
              <button
                className="full-btn"
                disabled={scanning || preparingDuplicates}
                onClick={handleRefreshTree}
              >
                {t('folder_refresh_tree')}
              </button>
            </div>
            
            <div className="sidebar-container">
              <FolderSidebar
                libraries={libraries}
                libraryEntries={libraryEntries}
                favorites={favoriteEntries}
                selectedFolderPath={selectedFolderPath}
                onSelectFolder={handleSafeFolderNavigation}
                onSelectLibraryFolder={handleLibrarySelect}
                onAddLibrary={addLibrary}
                onRemoveLibrary={removeLibrary}
                onAddFavorite={addFavorite}
                onRemoveFavorite={removeFavorite}
                onFolderContextMenu={showFolderContextMenu}
                onLibraryContextMenu={showLibraryContextMenu}
                onOpenLibrarySettings={openLibrarySettings}
                onSyncLibrary={runLibraryIndexAction}
                libraryScanStateMap={libraryScanStateMap}
                refreshToken={treeRefreshToken}
                t={t}
              />
            </div>
            
            <div className="left-bottom-bar">
              <button 
                className="warning-btn" 
                onClick={checkMissingVolumes} 
                disabled={isCheckingMissing}
              >
                {isCheckingMissing ? t('msg_analyzing') : (
                  <>
                    <span>{t('tf_btn_check_missing')}</span>
                    {missingData.length > 0 && (
                      <span className="missing-count-indicator">
                        <FaIcon name="circle" size={7} />
                        <span>{missingData.length}</span>
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {isSidebarVisible && (
          <div
            className="folder-resizer folder-resizer-vertical"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startHorizontalResize}
          />
        )}

        {/* Right Panel */}
        <div
          className="folder-right-panel"
          ref={rightPanelRef}
          style={{ '--folder-right-panel-width': `${rightPanelWidth}px` }}
          onMouseDownCapture={() => markFolderPanelFocus('list')}
          onFocusCapture={() => markFolderPanelFocus('list')}
        >
          <div className="right-toolbar">
            <div className="right-toolbar-left">
              <button 
                className={`toggle-btn ${isSidebarVisible ? 'active' : ''}`}
                onClick={() => setIsSidebarVisible(!isSidebarVisible)}
              >
                {t(isSidebarVisible ? 'folder_sidebar_on' : 'folder_sidebar_off')}
              </button>
              
              <FolderToolbar 
                t={t}
                sortKey={sortKey}
                sortOrder={sortOrder}
                onSort={handleSort}
                onToggleSortOrder={handleToggleSortOrder}
                groupKey={groupKey}
                setGroupKey={setGroupKey}
                metadataMissingOnly={metadataMissingOnly}
                setMetadataMissingOnly={setMetadataMissingOnly}
                savedLayouts={savedLayouts}
                onEditLayout={() => setShowLayoutDialog(true)}
                onSaveLayout={handleSaveLayout}
                onDeleteLayout={() => savedLayouts.length > 0 && setShowDeleteLayoutDialog(true)}
                onApplyLayout={handleApplyLayout}
                onExportCsv={handleExportCsv}
              />
            </div>
            
            <div className="right-toolbar-right">
              <div className="folder-search-control">
                <FolderSearchInput
                  key={searchResetToken}
                  inputRef={searchInputRef}
                  onApplyQuery={applySearchQuery}
                  onClearQuery={clearAppliedSearchQuery}
                  onSearchScopeChange={handleSearchScopeChange}
                  searchPlaceholder={searchPlaceholder}
                  librarySearchLoading={librarySearchLoading}
                  clearLabel={t('folder_search_clear')}
                  searchLabel={t('btn_search')}
                  searchScope={searchScope}
                  searchScopeLabel={t('folder_search_scope')}
                  searchScopeMetadataLabel={t('folder_search_scope_metadata')}
                  searchScopeContentLabel={t('folder_search_scope_content')}
                  searchScopeAllLabel={t('folder_search_scope_all')}
                  showSearchScope={libraries.length > 0}
                />
              </div>
              <div className="content-index-control">
                <button
                  type="button"
                  className={`content-index-btn ${contentIndexRunning ? 'is-running' : ''}`}
                  onClick={openContentIndexDialog}
                  title={contentIndexButtonLabel}
                  aria-label={contentIndexButtonLabel}
                  aria-busy={contentIndexRunning}
                >
                  {contentIndexRunning ? (
                    <span className="content-index-spinner" aria-hidden="true">
                      <FaIcon name="spinner" size={12} />
                    </span>
                  ) : (
                    <FaIcon name="fileLines" size={12} />
                  )}
                </button>
                {showContentIndexSearchHint && (
                  <div className="content-index-search-hint" role="status" aria-live="polite">
                    {t('folder_content_index_search_hint')}
                  </div>
                )}
              </div>
              <button
                className="refresh-btn"
                onClick={() => handleSmartRefresh(true)}
                title={t('folder_refresh_force_tip')}
              >
                {t('folder_refresh_list')}
              </button>
            </div>
          </div>

          <div
            className="view-container"
            ref={viewContainerRef}
            style={{ '--folder-view-width': `${viewContainerWidth}px` }}
          >
             {renderViewStack()}
          </div>
          
          {activeSelectedFile && (
            <>
              <div
                className="folder-resizer folder-resizer-horizontal"
                role="separator"
                aria-orientation="horizontal"
                onMouseDown={startVerticalResize}
              />
              <div
                className="detail-panel-wrap"
                style={{ flexBasis: `${detailPanelHeight}px`, flexShrink: 0, height: `${detailPanelHeight}px` }}
              >
                <DetailPanel selectedFile={detailSelectedFile} onContentHeightChange={handleDetailContentHeightChange} t={t} />
              </div>
            </>
          )}

          <div className="right-bottom-bar">
            <div className="status-info">
              {librarySearchLoading && isLibrarySearchActive
                ? t('folder_searching_libraries')
                : formatStatus(t, selectedFiles, filteredFileData, selectedFilesTotalBytes)}
            </div>
            <div className="view-controls">
              <button
                className={`view-icon-btn ${viewMode === 'table' ? 'active' : ''}`}
                title={t('menu_detail')}
                aria-pressed={viewMode === 'table'}
                onClick={() => handleViewModeChange('table')}
              >
                <span className="view-mode-glyph" aria-hidden="true"><FaIcon name="bars" size={13} /></span>
              </button>
              <button
                className={`view-icon-btn ${viewMode === 'thumbnail' ? 'active' : ''}`}
                title={t('menu_thumbnail')}
                aria-pressed={viewMode === 'thumbnail'}
                onClick={() => handleViewModeChange('thumbnail')}
              >
                <span className="view-mode-glyph" aria-hidden="true"><FaIcon name="microsoft" size={13} /></span>
              </button>
              <button
                className={`view-icon-btn ${viewMode === 'tile' ? 'active' : ''}`}
                title={t('menu_tile')}
                aria-pressed={viewMode === 'tile'}
                onClick={() => handleViewModeChange('tile')}
              >
                <span className="view-mode-glyph" aria-hidden="true"><FaIcon name="list" size={13} /></span>
              </button>
              <span className="scale-label">{t('folder_item_size')}</span>
              <input
                type="range"
                className="scale-slider"
                min="10"
                max={scaleMax}
                value={itemScale}
                onChange={e => setItemScales(prev => ({ ...prev, [viewMode]: Number(e.target.value) }))}
              />
            </div>
          </div>
        </div>
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          {contextMenu.type === 'library' ? (
            <>
              <ContextMenuItem onClick={() => handleContextAction('sync-library')} label={t('setting_update_index')} />
              <ContextMenuItem onClick={() => handleContextAction('optimize-library')} label={t('menu_optimize_meta')} />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('open-explorer')} icon="folderOpen" label={t('action_open_exp')} />
              <ContextMenuItem onClick={() => handleContextAction('remove-library')} label={t('folder.sidebar.remove_library')} />
            </>
          ) : contextMenu.type === 'folder' ? (
            <>
              <ContextMenuItem
                onClick={() => handleContextAction(
                  isFavoriteFolder(favoriteEntries, contextMenu.folderPath)
                    ? 'unfavorite-folder'
                    : 'favorite-folder'
                )}
                label={isFavoriteFolder(favoriteEntries, contextMenu.folderPath)
                  ? t('action_fav_rem')
                  : t('action_fav_add')}
                icon={isFavoriteFolder(favoriteEntries, contextMenu.folderPath) ? 'star' : 'pin'}
              />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('open-explorer')} icon="folderOpen" label={t('action_open_exp')} />
              <ContextMenuItem onClick={() => handleContextAction('rename-folder')} label={t('action_ren_folder')} shortcut="Shift+R" />
              {!libraries.includes(contextMenu.folderPath) && libraries.length > 0 && (
                <ContextMenuItem onClick={() => handleContextAction('move-folder-library')} label={t('action_move_folder_to_library')} />
              )}
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('send-organizer')} label={t('action_flatten_structure')} shortcut="F1" />
              <ContextMenuItem onClick={() => handleContextAction('send-renamer')} label={t('action_inner_ren')} shortcut="F2" />
              <ContextMenuItem onClick={() => handleContextAction('send-metadata')} label={t('action_meta_edit')} shortcut="F3" />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('delete-folder')} label={t('action_del_folder')} shortcut="Del" />
              <ContextMenuItem onClick={() => handleContextAction('refresh-folder')} label={t('action_refresh')} shortcut="F5" />
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => handleContextAction('view-file')} label={t('action_view')} />
              <ContextMenuItem onClick={() => handleContextAction('send-file-organizer')} label={t('action_flatten_structure')} shortcut="F1" />
              <ContextMenuItem onClick={() => handleContextAction('send-file-renamer')} label={t('action_inner_ren')} shortcut="F2" />
              <ContextMenuItem onClick={() => handleContextAction('send-file-metadata')} label={t('action_meta_edit')} shortcut="F3" />
              <ContextMenuItem onClick={() => handleContextAction('update-files')} label={t('action_update_files')} />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('group-series')} label={t('action_group_by_series')} />
              <ContextMenuItem onClick={() => handleContextAction('move-library')} label={t('action_move_file_to_library')} />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('delete-file')} label={t('action_del_files')} shortcut="Del" />
              <ContextMenuItem onClick={() => handleContextAction('multi-rename')} label={t('tf_menu_rename_multi')} shortcut="Shift+R" />
              <ContextMenuItem onClick={() => handleContextAction('undo-rename')} label={t('tf_undo_rename')} shortcut={formatPrimaryShortcut('Z', runtimePlatform)} />
              <ContextMenuItem onClick={() => handleContextAction('show-file')} icon="folderOpen" label={t('action_open_exp')} />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('select-all')} label={t('action_sel_all')} shortcut={formatPrimaryShortcut('A', runtimePlatform)} />
              <ContextMenuItem onClick={() => handleContextAction('invert-selection')} label={t('action_inv_sel')} />
              <ContextMenuItem onClick={() => handleContextAction('refresh-list')} label={t('action_refresh')} shortcut="F5" />
            </>
          )}
        </ContextMenu>
      )}
      
      {showMissingDialog && (
        <MissingVolumesDialog
          missingData={missingData}
          onClose={() => setShowMissingDialog(false)}
          onGoToFolder={(path) => {
            setShowMissingDialog(false);
            setGroupKey('folder');
            handleFolderChange(path);
          }}
          t={t}
        />
      )}
      {showLayoutDialog && (
        <LayoutEditDialog
          layout={columnLayout}
          onApply={handleApplyColumnLayout}
          onClose={() => setShowLayoutDialog(false)}
          t={t}
        />
      )}
      {showDeleteLayoutDialog && (
        <LayoutDeleteDialog
          layouts={savedLayouts}
          onDelete={handleDeleteLayout}
          onClose={() => setShowDeleteLayoutDialog(false)}
          t={t}
        />
      )}
      {showMultiRenameDialog && (
        <MultiRenameDialog
          files={selectedFileObjects}
          onExecute={executeMultiRename}
          onClose={() => setShowMultiRenameDialog(false)}
          t={t}
        />
      )}
      {showGotoDialog && (
        <GotoPathDialog
          value={gotoPathDraft}
          onChange={setGotoPathDraft}
          onConfirm={() => handlePathNavigation(gotoPathDraft)}
          onClose={() => setShowGotoDialog(false)}
          t={t}
        />
      )}
      {showContentIndexDialog && (
        <ContentIndexDialog
          status={contentIndexStatus}
          actionLoading={contentIndexActionLoading}
          libraryCount={libraries.length}
          onRefresh={refreshContentIndexStatus}
          onBuild={() => runContentIndexAction(false)}
          onRebuild={() => runContentIndexAction(true)}
          onStop={stopContentIndex}
          onClear={clearContentIndex}
          onClose={() => setShowContentIndexDialog(false)}
          t={t}
        />
      )}
      {textInputDialog && (
        <TextInputDialog
          {...textInputDialog}
          onConfirm={value => closeTextInputDialog(value)}
          onClose={() => closeTextInputDialog(null)}
          t={t}
        />
      )}
      {seriesMovePreview && (
        <MovePreviewDialog
          plans={seriesMovePreview}
          onConfirm={() => executeSeriesMove(seriesMovePreview)}
          onClose={() => setSeriesMovePreview(null)}
          t={t}
        />
      )}
      {libraryMoveRequest && (
        <LibraryMoveDialog
          sources={libraryMoveRequest.sources}
          folderMode={libraryMoveRequest.folderMode}
          libraries={libraryMoveRequest.libraries || libraries}
          initialValue={resolveLastSelectedLibrary(
            libraryMoveRequest.libraries || libraries,
            config?.last_selected_library,
          )}
          onConfirm={moveSelectedToLibrary}
          onClose={() => setLibraryMoveRequest(null)}
          t={t}
        />
      )}
      {moveConflict && (
        <MoveConflictDialog
          conflict={moveConflict}
          onChoose={resolveConflictChoice}
          t={t}
        />
      )}
    </div>
  );
}

function ContextMenu({ x, y, children }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    setPosition(clampContextMenuPosition(
      x,
      y,
      menu.offsetWidth,
      menu.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    ));
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="folder-context-menu"
      style={{ left: position.x, top: position.y }}
      onClick={event => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function ContextMenuItem({ label, shortcut = '', icon = '', onClick }) {
  return (
    <button type="button" className="folder-context-menu-item" onClick={onClick}>
      {icon && (
        <span className="folder-context-menu-icon">
          <FaIcon name={icon} size={12} />
        </span>
      )}
      <span className="folder-context-menu-label">{label}</span>
      <span className="folder-context-menu-shortcut">{shortcut}</span>
    </button>
  );
}

function ContentIndexDialog({
  status,
  actionLoading,
  libraryCount,
  onRefresh,
  onBuild,
  onRebuild,
  onStop,
  onClear,
  onClose,
  t,
}) {
  const [clearConfirm, setClearConfirm] = useState(false);
  const progress = status?.progress || {};
  const running = Boolean(status?.running || progress.running);
  const total = Number(progress.total) || 0;
  const processed = Number(progress.processed) || 0;
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const statusCounts = status?.statusCounts || {};
  const skippedDocumentCount = Number(statusCounts.ocr_required || 0)
    + Number(statusCounts.encrypted || 0)
    + Number(statusCounts.unsupported || 0);
  const searchableDocumentCount = Math.max(
    0,
    (Number(status?.readyCount) || 0) - Number(statusCounts.empty || 0),
  );
  const failedDocumentCount = Math.max(
    Number(status?.failedCount) || 0,
    Number(progress.failed) || 0,
  );

  const confirmClear = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    await onClear();
    setClearConfirm(false);
  };

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="content-index-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-index-dialog-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="dialog-titlebar">
          <span id="content-index-dialog-title">{t('folder_content_index_title')}</span>
          <button type="button" onClick={onClose} aria-label={t('btn_close')}>×</button>
        </div>
        <div className="content-index-dialog-body">
          <p className="content-index-description">{t('folder_content_index_description')}</p>
          <div className="content-index-path-row">
            <span>{t('folder_content_index_path')}</span>
            <code title={status?.dbPath || ''}>{status?.dbPath || '-'}</code>
          </div>
          <div className="content-index-summary">
            <div><span>{t('folder_content_index_documents')}</span><strong>{Number(status?.totalCount) || 0}</strong></div>
            <div><span>{t('folder_content_index_searchable')}</span><strong>{searchableDocumentCount}</strong></div>
            <div><span>{t('folder_content_index_tokens')}</span><strong>{Number(status?.tokenCount || 0).toLocaleString()}</strong></div>
            <div><span>{t('folder_content_index_size')}</span><strong>{formatBytes(Number(status?.totalBytes) || 0)}</strong></div>
            <div><span>{t('folder_content_index_skipped')}</span><strong>{skippedDocumentCount}</strong></div>
            <div><span>{t('folder_content_index_failed')}</span><strong>{failedDocumentCount}</strong></div>
          </div>
          {Number(status?.offlineLibraryCount) > 0 && (
            <div className="content-index-warning">
              {t('folder_content_index_offline', [status.offlineLibraryCount])}
            </div>
          )}
          {Number(statusCounts.truncated) > 0 && (
            <div className="content-index-warning">
              {t('folder_content_index_truncated', [statusCounts.truncated])}
            </div>
          )}
          {running && (
            <div className="content-index-progress" aria-live="polite">
              <div className="content-index-progress-label">
                <span>{t('folder_content_index_running', [processed, total])}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <progress max="100" value={progressPercent} />
              <div className="content-index-current" title={progress.currentPath || ''}>
                {progress.currentPath || t('folder_scan_prep')}
              </div>
            </div>
          )}
          {!running && Number(status?.totalCount || 0) === 0 && (
            <div className="content-index-hint">{t('folder_content_index_empty_hint')}</div>
          )}
          <div className="content-index-note">{t('folder_content_index_note')}</div>
        </div>
        <div className="layout-dialog-footer content-index-footer">
          <button type="button" onClick={onRefresh} disabled={actionLoading}>{t('folder_content_index_refresh')}</button>
          {!running ? (
            <>
              <button type="button" className="primary" onClick={onBuild} disabled={actionLoading || libraryCount === 0}>
                {t('folder_content_index_build')}
              </button>
              <button type="button" onClick={onRebuild} disabled={actionLoading || libraryCount === 0}>
                {t('folder_content_index_rebuild')}
              </button>
            </>
          ) : (
            <button type="button" className="danger" onClick={onStop}>{t('folder_content_index_stop')}</button>
          )}
          <button
            type="button"
            className={clearConfirm ? 'danger' : ''}
            onClick={confirmClear}
            disabled={actionLoading || running}
          >
            {clearConfirm ? t('folder_content_index_clear_confirm') : t('folder_content_index_clear')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>{t('btn_close')}</button>
        </div>
      </section>
    </div>
  );
}

function LayoutEditDialog({ layout, onApply, onClose, t }) {
  const [draft, setDraft] = useState(() => normalizeColumnLayout(layout));

  const updateColumn = (index, changes) => {
    setDraft(current => current.map((column, columnIndex) => (
      columnIndex === index ? { ...column, ...changes } : column
    )));
  };

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="layout-dialog layout-edit-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>▣ {t('dlg_edit_lay_title')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="layout-dialog-body">
          <div className="layout-dialog-label">{t('dlg_edit_lay_msg')}</div>
          <div className="layout-column-list">
            {draft.map((column, index) => (
              <div key={column.key} className="layout-column-row">
                <label className="layout-column-toggle">
                  <input
                    type="checkbox"
                    checked={column.visible}
                    onChange={event => updateColumn(index, { visible: event.target.checked })}
                  />
                  <span className="layout-column-name">
                    {column.key === 'dup_count'
                      ? t(column.labelKey).replace(/[☐☑]\s*/, '')
                      : t(column.labelKey)}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button className="primary" onClick={() => onApply(draft)}>{t('btn_ok')}</button>
          <button className="secondary" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function LayoutDeleteDialog({ layouts, onDelete, onClose, t }) {
  const [selected, setSelected] = useState(layouts[0] || '');

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="layout-delete-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>{t('menu_del_layout')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="layout-delete-body">
          <label htmlFor="layout-delete-select">{t('dlg_del_lay_msg')}</label>
          <select
            id="layout-delete-select"
            value={selected}
            onChange={event => setSelected(event.target.value)}
          >
            {layouts.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="layout-dialog-footer">
          <button onClick={() => onDelete(selected)}>{t('btn_ok')}</button>
          <button className="dialog-cancel-button" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function GotoPathDialog({ value, onChange, onConfirm, onClose, t }) {
  const inputRef = useRef(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const submit = event => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <form className="goto-path-dialog" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>{t('fm_title')}</span>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="goto-path-dialog-body">
          <label htmlFor="goto-path-input">{t('fm_dsc')}</label>
          <input
            id="goto-path-input"
            ref={inputRef}
            className="goto-path-input"
            type="text"
            value={value}
            onChange={event => onChange(event.target.value)}
          />
        </div>
        <div className="layout-dialog-footer">
          <button type="submit" className="goto-path-confirm">{t('btn_ok')}</button>
          <button type="button" className="goto-path-cancel" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </form>
    </div>
  );
}

function TextInputDialog({ title, message, initialValue = '', inputId = 'folder-text-input', onConfirm, onClose, t }) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const submit = event => {
    event.preventDefault();
    onConfirm(draft);
  };

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <form
        className="text-input-dialog"
        onSubmit={submit}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-titlebar">
          <span>{title}</span>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="text-input-dialog-body">
          <label htmlFor={inputId}>{message}</label>
          <input
            id={inputId}
            ref={inputRef}
            className="text-input-dialog-input"
            type="text"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
        </div>
        <div className="layout-dialog-footer">
          <button type="submit" className="text-input-confirm">{t('btn_ok')}</button>
          <button type="button" className="text-input-cancel" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </form>
    </div>
  );
}

function MovePreviewDialog({ plans, onConfirm, onClose, t }) {
  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="file-action-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>{t('action_group_by_series')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="file-action-dialog-body">
          <div>{t('msg_group_proceed', [plans.length])}</div>
          <div className="file-action-list">
            {plans.map(plan => (
              <div key={plan.src}>
                <strong>{basename(plan.src)}</strong>
                <span>→ {plan.dest}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button onClick={onConfirm}>{t('btn_ok')}</button>
          <button className="dialog-cancel-button" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function LibraryMoveDialog({ sources, folderMode, libraries, initialValue, onConfirm, onClose, t }) {
  const [selected, setSelected] = useState(initialValue || libraries[0] || '');
  const [createCurrentFolder, setCreateCurrentFolder] = useState(true);
  const plans = useMemo(
    () => createLibraryMovePlans(sources, selected, { createCurrentFolder, folderMode }),
    [createCurrentFolder, folderMode, selected, sources],
  );
  const modeLabel = folderMode ? t('library_move_mode_folder') : t('library_move_mode_file');

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="file-action-dialog library-move-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar library-move-titlebar">
          <span className="library-move-title"><FaIcon name="folderOpen" size={13} />{t('dlg_move_lib_title')}</span>
          <button className="library-move-close" onClick={onClose} aria-label={t('btn_cancel')}><FaIcon name="xmark" size={13} /></button>
        </div>
        <div className="file-action-dialog-body library-move-body">
          <div className="library-move-summary">
            <div className="library-move-summary-item">
              <span>{t('library_move_count')}</span>
              <strong>{t('library_move_count_value', [sources.length])}</strong>
            </div>
            <div className="library-move-summary-item">
              <span>{t('library_move_mode')}</span>
              <strong>{modeLabel}</strong>
            </div>
            <div className="library-move-summary-item">
              <span>{t('library_move_destination')}</span>
              <strong title={selected}>{selected || '-'}</strong>
            </div>
          </div>
          <section className="library-move-section library-move-target-section">
            <div className="library-move-section-title">
              <label className="library-move-section-label" htmlFor="library-move-select">
                <FaIcon name="folder" size={12} />
                <span>{t('lbl_select_lib')}</span>
              </label>
            </div>
            <select
              id="library-move-select"
              value={selected}
              onChange={event => setSelected(event.target.value)}
            >
              {libraries.map(library => <option key={library} value={library}>{library}</option>)}
            </select>
          </section>
          {!folderMode && (
            <label className="library-move-folder-option library-move-option-card">
              <input
                type="checkbox"
                checked={createCurrentFolder}
                onChange={event => setCreateCurrentFolder(event.target.checked)}
              />
              <span className="library-move-option-text">
                <strong>{t('library_move_option')}</strong>
                <span>{t('chk_create_folder')}</span>
              </span>
            </label>
          )}
          <section className="library-move-section library-move-preview-section">
            <div className="library-move-section-title">
              <strong className="library-move-section-label">
                <FaIcon name="list" size={12} />
                <span>{t('lbl_preview_move')}</span>
              </strong>
              <span className="library-move-preview-count">{t('library_move_preview_count', [plans.length])}</span>
            </div>
            <div className="library-move-preview">
              <div className="library-move-preview-head">
                <span>{t('col_source_path')}</span>
                <span>{t('col_dest_path')}</span>
              </div>
              {plans.map(plan => (
                <div className="library-move-preview-row" key={plan.src}>
                  <span className="library-move-path-text" title={plan.src}>{plan.src}</span>
                  <span className="library-move-path-text" title={plan.dest}>{plan.dest}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="layout-dialog-footer library-move-footer">
          <button className="library-move-confirm" disabled={!selected || plans.length === 0} onClick={() => onConfirm(plans)}>{t('btn_ok')}</button>
          <button className="library-move-cancel" onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function MoveConflictDialog({ conflict, onChoose, t }) {
  const { plan, source, destination } = conflict;
  return (
    <div className="folder-dialog-backdrop">
      <div className="file-action-dialog move-conflict-dialog">
        <div className="dialog-titlebar">
          <span>{t('dlg_conflict_title')}</span>
        </div>
        <div className="move-conflict-body">
          <strong className="move-conflict-warning">{t('lbl_conflict_desc')}</strong>
          <code title={plan.dest}>{plan.dest}</code>
          <div className="move-conflict-compare">
            <ConflictFileCard title={t('col_source')} file={source} t={t} />
            <ConflictFileCard title={t('col_dest')} file={destination} t={t} />
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button className="danger" onClick={() => onChoose('overwrite')}>{t('btn_overwrite')}</button>
          <button onClick={() => onChoose('rename')}>{t('btn_rename_new')}</button>
          <button onClick={() => onChoose('skip')}>{t('btn_skip')}</button>
        </div>
      </div>
    </div>
  );
}

function ConflictFileCard({ title, file, t }) {
  return (
    <section className="move-conflict-card">
      <strong>{title}</strong>
      <div className="move-conflict-cover">
        {file?.cover
          ? <img src={file.cover} alt={file.name || ''} />
          : <span>{t('folder_no_cover')}</span>}
      </div>
      <span>{formatBytes(file?.size || 0)} | {file?.resolution || '-'}</span>
    </section>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatStatus(t, selectedFiles, files, selectedSizeBytes = 0) {
  const selectedSize = formatBytes(selectedSizeBytes);
  return t('folder_status_sel', [selectedFiles.length, files.length, selectedSize]);
}

export { FolderTab };
