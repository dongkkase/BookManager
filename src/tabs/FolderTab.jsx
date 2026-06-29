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
  groupFolderFiles,
  normalizeViewMode,
  normalizeViewScales,
} from '../folderViewState';
import { selectedFilesSize } from '../folderSelectionState';
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
  const [gotoPathDraft, setGotoPathDraft] = useState('');
  const [seriesMovePreview, setSeriesMovePreview] = useState(null);
  const [libraryMoveRequest, setLibraryMoveRequest] = useState(null);
  const [moveConflict, setMoveConflict] = useState(null);
  const [textInputDialog, setTextInputDialog] = useState(null);
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
    showLayoutDialog,
    showMissingDialog,
    showMultiRenameDialog,
  ]);

  // --- 검색 상태 ---
  const [searchQuery, setSearchQuery] = useState('');
  const [librarySearchResults, setLibrarySearchResults] = useState([]);
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false);
  const searchInputRef = useRef(null);
  const librarySearchRequestRef = useRef(0);
  const libraries = useMemo(() => (
    [...new Set([...(config?.libraries || []), ...(config?.dup_check_folders || [])])].filter(Boolean)
  ), [config?.libraries, config?.dup_check_folders]);
  const normalizedSearchQuery = searchQuery.trim();
  const isLibrarySearchActive = normalizedSearchQuery.length > 0 && libraries.length > 0;

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
      setLibrarySearchResults([]);
      setLibrarySearchLoading(false);
      return undefined;
    }

    let disposed = false;
    setLibrarySearchResults([]);
    setLibrarySearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await window.electronAPI?.searchLibraryFiles?.(normalizedSearchQuery, libraries, { limit: 3000 });
        if (disposed || librarySearchRequestRef.current !== requestId) return;
        setLibrarySearchResults(Array.isArray(rows) ? rows : []);
      } catch (error) {
        if (!disposed && librarySearchRequestRef.current === requestId) {
          console.error('라이브러리 검색 실패:', error);
          setLibrarySearchResults([]);
        }
      } finally {
        if (!disposed && librarySearchRequestRef.current === requestId) {
          setLibrarySearchLoading(false);
        }
      }
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isLibrarySearchActive, libraries, normalizedSearchQuery]);

  // 필터링된 파일 데이터
  const filteredFileData = useMemo(() => {
    const files = isLibrarySearchActive ? librarySearchResults : getCurrentFileData();
    return filterFolderFiles(files, {
      query: isLibrarySearchActive ? '' : searchQuery,
      metadataMissingOnly,
    });
  }, [getCurrentFileData, isLibrarySearchActive, librarySearchResults, metadataMissingOnly, searchQuery]);

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
    () => groupFolderFiles(filteredFileData, groupKey, sortKey, sortOrder),
    [filteredFileData, groupKey, sortKey, sortOrder],
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
  const selectedFileSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const displayedFileByPath = useMemo(() => {
    const map = new Map();
    displayedFileData.forEach(file => {
      if (file?.path) map.set(file.path, file);
    });
    return map;
  }, [displayedFileData]);
  const itemScale = itemScales[viewMode] || 50;

  useEffect(() => {
    if (isLibrarySearchActive) clearSelection();
  }, [clearSelection, isLibrarySearchActive, normalizedSearchQuery]);

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

  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return undefined;
    const updateWidth = () => {
      setRightPanelWidth(Math.max(320, Math.round(panel.clientWidth || 900)));
    };
    updateWidth();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isSidebarVisible]);

  useEffect(() => {
    const container = viewContainerRef.current;
    if (!container) return undefined;
    const updateWidth = () => {
      const width = Math.max(320, Math.round(container.clientWidth || 900));
      setViewContainerWidth(current => current === width ? current : width);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isSidebarVisible, viewMode]);

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
        const nextLibraries = [...libraries, folderPath];
        await saveConfig({
          libraries: nextLibraries,
          dup_check_folders: nextLibraries,
        });
        pendingInitialLibraryIndexRef.current = folderPath;
      }
    } catch (e) {
      console.error(e);
    }
  }, [libraries, saveConfig]);

  const removeLibrary = useCallback(async (path) => {
    if (saveConfig) {
      const nextLibraries = libraries.filter(l => l !== path);
      await saveConfig({
        libraries: nextLibraries,
        dup_check_folders: nextLibraries,
      });
    }
  }, [libraries, saveConfig]);

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
    if (!config || missingBackgroundKeyRef.current === backgroundKey) return undefined;
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

    const timer = window.setTimeout(analyze, 0);
    return () => {
      cancelled = true;
      if (backgroundLibraryScanCancelRef.current) backgroundLibraryScanCancelRef.current = null;
      window.clearTimeout(timer);
    };
  }, [config, getCurrentFileData, selectedFolderPath, showToast]);

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
    setSearchQuery('');
    if (nextFolderPath && config?.folder_last_path !== nextFolderPath) {
      saveConfig?.({ folder_last_path: nextFolderPath }).catch(error => {
        console.error('마지막 폴더 경로 저장 실패:', error);
      });
    }
    await window.electronAPI?.stopTask?.('folder:scan').catch(() => {});
    const files = await scanFolder(nextFolderPath, scanOptions);
    if (selectedFolderPathRef.current !== nextFolderPath) return;
    const localMissing = findMissingVolumes(files || []);
    scheduleLocalMissingToast(nextFolderPath, localMissing);
  }, [config?.folder_last_path, scanOptions, scanFolder, clearSelection, saveConfig, scheduleLocalMissingToast]);

  const handleSafeFolderNavigation = useCallback(async folderPath => {
    if (!folderPath) return false;
    const exists = await window.electronAPI?.exists?.(folderPath);
    if (!exists) return false;
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
    setSearchQuery('');
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
    if (!config?.viewer_path) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('dlg_warn_viewer'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const result = await window.electronAPI?.openWithViewer?.(config.viewer_path, target);
    if (!result?.success) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: result?.message || t('msg_failed'),
        language: config?.language || config?.lang || 'ko',
      });
    }
  }, [config?.language, config?.lang, config?.viewer_path, t]);

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
    if (Object.keys(configPatch).length > 0) {
      await saveConfig?.(configPatch);
    }

    const nextSelection = replaceTreePath(selectedFolderPath, folderPath, nextPath);
    setTreeRefreshToken(current => current + 1);
    if (nextSelection !== selectedFolderPath) {
      await handleFolderChange(nextSelection);
    }
  }, [config?.dup_check_folders, config?.libraries, favoriteEntries, handleFolderChange, requestTextInput, runInternalFileAction, saveConfig, selectedFolderPath, showFolderError, t]);

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
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const containerWidth = mainAreaRef.current?.clientWidth || 1200;

    const handleMove = (moveEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setLeftPanelWidth(clampSidebarWidth(nextWidth, containerWidth));
    };

    const handleUp = (upEvent) => {
      const nextWidth = startWidth + upEvent.clientX - startX;
      const savedWidth = clampSidebarWidth(nextWidth, containerWidth);
      setLeftPanelWidth(savedWidth);
      saveConfig?.({ folder_left_panel_width: savedWidth }).catch(error => {
        console.error('폴더 좌우 splitter 저장 실패:', error);
      });
      document.body.classList.remove('is-resizing-panel');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [leftPanelWidth, saveConfig]);

  const startVerticalResize = useCallback((event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = detailPanelHeight;
    const containerHeight = rightPanelRef.current?.clientHeight || 700;

    const handleMove = (moveEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      setDetailPanelHeight(clampDetailHeight(nextHeight, containerHeight));
    };

    const handleUp = (upEvent) => {
      const nextHeight = startHeight - (upEvent.clientY - startY);
      const savedHeight = clampDetailHeight(nextHeight, containerHeight);
      setDetailPanelHeight(savedHeight);
      saveConfig?.({ folder_detail_panel_height: savedHeight }).catch(error => {
        console.error('폴더 상하 splitter 저장 실패:', error);
      });
      document.body.classList.remove('is-resizing-panel');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [detailPanelHeight, saveConfig]);

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
    if (!activeSelectedFile || !contentHeight) return;
    const containerHeight = rightPanelRef.current?.clientHeight || 700;
    const nextHeight = clampDetailHeight(contentHeight, containerHeight);
    setDetailPanelHeight(current => Math.abs(current - nextHeight) > 2 ? nextHeight : current);
  }, [activeSelectedFile]);

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
              <div className="search-input-wrap">
                <input
                  type="text"
                  className="search-input"
                  ref={searchInputRef}
                  placeholder={libraries.length > 0 ? t('folder_search_library_ph') : t('folder_search_ph')}
                  value={searchQuery}
                  aria-busy={librarySearchLoading}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="search-clear-btn"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label={t('folder_search_clear')}
                  >
                    ×
                  </button>
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
              <div className="detail-panel-wrap" style={{ flexBasis: `${detailPanelHeight}px`, flexShrink: 0, height: `${detailPanelHeight}px` }}>
                <DetailPanel selectedFile={activeSelectedFile} onContentHeightChange={handleDetailContentHeightChange} t={t} />
              </div>
            </>
          )}

          <div className="right-bottom-bar">
            <div className="status-info">
              {librarySearchLoading && isLibrarySearchActive
                ? t('folder_searching_libraries')
                : formatStatus(t, selectedFiles, filteredFileData)}
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
                max="100"
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

function formatStatus(t, selectedFiles, files) {
  const selectedSize = formatBytes(selectedFilesSize(files, selectedFiles));
  return t('folder_status_sel', [selectedFiles.length, files.length, selectedSize]);
}

export { FolderTab };
