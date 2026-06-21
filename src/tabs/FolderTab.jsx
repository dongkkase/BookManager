import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FolderSidebar } from '../components/folder/FolderSidebar';
import { FileTableView } from '../components/folder/FileTableView';
import { ThumbnailView } from '../components/folder/ThumbnailView';
import { TileView } from '../components/folder/TileView';
import { DetailPanel } from '../components/folder/DetailPanel';
import { FolderToolbar } from '../components/folder/FolderToolbar';
import { MissingVolumesDialog } from '../components/folder/MissingVolumesDialog';
import { extractCoreTitle } from '../utils/folderUtils';
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
  folderNameRenamePattern,
  inferRenamePattern,
  normalPatternToRegex,
  normalReplacementToRegex,
  previewRename,
  regexPatternToNormal,
  regexReplacementToNormal,
  resolveRenamePreviewConflicts,
} from '../multiRenamePolicy';
import {
  findMissingVolumes,
} from '../missingVolumesPolicy';
import {
  applyConflictChoice,
  createLibraryMovePlans,
} from '../libraryMovePolicy';
import { hasPrimaryModifier, shouldHandleGlobalShortcut } from '../interactionPolicy';
import { emitStatusState } from '../statusState';
import '../styles/FolderTab.css';

function parentPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '';
}

function replaceBasename(filePath, nextName) {
  const value = String(filePath || '');
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${value.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function normalizeLibraryKey(folderPath = '') {
  return String(folderPath)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function joinPath(base, ...parts) {
  const separator = String(base || '').includes('\\') ? '\\' : '/';
  return [String(base || '').replace(/[\\/]+$/, ''), ...parts.map(part => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
}

function FolderTab({ config, saveConfig, t, showToast }) {
  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const { scanning, scanProgress, statusMessage, scanFolder, getCachedFiles, updateCachedFiles } = useFolderScan(t);
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
  const internalFileActionRef = useRef(false);
  const watchedMtimeRef = useRef(null);

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
  const closeTopOverlay = useCallback(() => {
    if (moveConflict) return true;
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
    showDeleteLayoutDialog,
    showGotoDialog,
    showLayoutDialog,
    showMissingDialog,
    showMultiRenameDialog,
  ]);

  // --- 검색 상태 ---
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  useEffect(() => {
    preparingDuplicatesRef.current = preparingDuplicates;
  }, [preparingDuplicates]);

  const scanOptions = useMemo(() => ({
    includeSubfolders,
    enableDupCheck,
    dupFolders: config?.dup_check_folders || [],
    fastInitial: true,
  }), [includeSubfolders, enableDupCheck, config?.dup_check_folders]);

  // 파일 데이터 가져오기 (캐시에서)
  const getCurrentFileData = useCallback(() => {
    if (!selectedFolderPath) return [];
    return getCachedFiles(selectedFolderPath, scanOptions) || [];
  }, [getCachedFiles, selectedFolderPath, scanOptions]);

  // 필터링된 파일 데이터
  const filteredFileData = useMemo(() => {
    const files = getCurrentFileData();
    return filterFolderFiles(files, {
      query: searchQuery,
      metadataMissingOnly,
    });
  }, [getCurrentFileData, metadataMissingOnly, searchQuery]);
  const savedLayouts = useMemo(
    () => normalizeSavedLayouts(config?.folder_saved_layouts),
    [config?.folder_saved_layouts],
  );
  const displayedFileData = useMemo(
    () => groupFolderFiles(filteredFileData, groupKey, sortKey, sortOrder)
      .flatMap(group => group.files),
    [filteredFileData, groupKey, sortKey, sortOrder],
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
  const itemScale = itemScales[viewMode] || 50;

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
  const libraries = useMemo(() => (
    [...new Set([...(config?.libraries || []), ...(config?.dup_check_folders || [])])]
  ), [config?.libraries, config?.dup_check_folders]);
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
    setSelectedFolderPath(folderPath);
    clearSelection();
    setSearchQuery('');
    const files = await scanFolder(folderPath, scanOptions);
    const localMissing = findMissingVolumes(files || []);
    scheduleLocalMissingToast(folderPath, localMissing);
  }, [scanOptions, scanFolder, clearSelection, scheduleLocalMissingToast]);

  const handleSafeFolderNavigation = useCallback(async folderPath => {
    if (!folderPath) return false;
    const exists = await window.electronAPI?.exists?.(folderPath);
    if (!exists) return false;
    await handleFolderChange(folderPath);
    return true;
  }, [handleFolderChange]);

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
      await scanFolder(selectedFolderPath, { ...scanOptions, force: true });
    };

    pollFolder();
    const timer = window.setInterval(pollFolder, 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [preparingDuplicates, scanFolder, scanOptions, scanning, selectedFolderPath]);

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

  const handleRefresh = useCallback(async () => {
    if (!selectedFolderPath) return;
    const files = await scanFolder(selectedFolderPath, { ...scanOptions, force: true });
    scheduleLocalMissingToast(selectedFolderPath, findMissingVolumes(files || []));
  }, [selectedFolderPath, scanFolder, scanOptions, scheduleLocalMissingToast]);

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
    const files = await scanFolder(selectedFolderPath, nextOptions);
    setMissingData(findMissingVolumes(files || []));
  }, [
    clearSelection,
    includeSubfolders,
    preparingDuplicates,
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
    const files = await scanFolder(selectedFolderPath, nextOptions);
    setMissingData(findMissingVolumes(files || []));
  }, [
    clearSelection,
    config?.dup_check_folders,
    enableDupCheck,
    preparingDuplicates,
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
      const result = await window.electronAPI?.updateFolderIndex?.(
        [folderPath],
        {
          mode: choice,
          optimizeMetadata,
          metadataOnly: optimizeMetadata && !options.showIndexingVisual,
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
    const refreshOptions = optimizeMetadata
      ? {
          ...scanOptions,
          includeSubfolders: true,
          force: true,
        }
      : {
          ...scanOptions,
          force: true,
        };
    if (optimizeMetadata) setIncludeSubfolders(true);
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
    } else if (event?.ctrlKey || event?.metaKey) {
      toggleFile(filePath, null, index);
    } else {
      selectFile(filePath, null, index);
    }
  }, [clearSelection, rangeSelect, selectFile, toggleFile]);

  const selectedFileObjects = useMemo(() => (
    selectedFiles.map(filePath => filteredFileData.find(file => file.path === filePath)).filter(Boolean)
  ), [filteredFileData, selectedFiles]);

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

  const openSelectedInViewer = useCallback(async () => {
    const target = activeSelectedFile?.full_path || activeSelectedFile?.path;
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
  }, [activeSelectedFile, config?.language, config?.lang, config?.viewer_path, t]);

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
    const inputName = window.prompt(t('msg_rename_desc'), oldName);
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
  }, [activeSelectedFile, config?.language, config?.lang, handleRefresh, runInternalFileAction, selectFile, showToast, t]);

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
    const targets = selectedFileObjects.length > 0 && (!contextPath || selectedFiles.includes(contextPath))
      ? selectedFileObjects
      : [contextFile].filter(Boolean);
    if (targets.length === 0) return;

    const refreshed = [];
    for (const file of targets) {
      const filePath = file.full_path || file.path;
      if (!filePath) continue;
      const result = await window.electronAPI?.getFilePreview?.(filePath);
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
  }, [scanOptions, selectedFileObjects, selectedFiles, selectedFolderPath, showToast, t, updateCachedFiles]);

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

  const executeLibraryMovePlans = useCallback(async plans => {
    const resolvedPlans = [];
    for (const plan of plans) {
      if (!await window.electronAPI?.exists?.(plan.dest)) {
        resolvedPlans.push(plan);
        continue;
      }
      const sourcePreview = await window.electronAPI?.getFilePreview?.(plan.src);
      const destinationPreview = await window.electronAPI?.getFilePreview?.(plan.dest);
      const choice = await requestConflictChoice({
        plan,
        source: sourcePreview?.file || { name: basename(plan.src), path: plan.src },
        destination: destinationPreview?.file || { name: basename(plan.dest), path: plan.dest },
      });
      resolvedPlans.push(applyConflictChoice(plan, choice || 'skip'));
    }

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
    setLibraryMoveRequest(null);
    await saveConfig?.({ last_selected_library: targetLibrary });
    const folderPlan = plans.find(plan => plan.folderMode);
    let executablePlans = plans;
    if (folderPlan) {
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
    }
    const result = await executeLibraryMovePlans(executablePlans);
    if (folderPlan) await window.electronAPI?.removeEmptyTree?.(folderPlan.src);
    if (result?.successCount > 0) {
      showToast?.(t('msg_move_lib_done', [result.successCount]));
      clearSelection();
      const affectedLibraries = [...new Set([
        targetLibrary,
        ...libraries.filter(library => executablePlans.some(plan => (
          plan.src === library
          || plan.src.startsWith(`${library}/`)
          || plan.src.startsWith(`${library}\\`)
        ))),
      ])];
      await window.electronAPI?.updateFolderIndex?.(affectedLibraries, {
        mode: 'smart',
        priorityFolder: selectedFolderPath,
        language: config?.language || config?.lang || 'ko',
      });
      await refreshLibraryScanStates(affectedLibraries);
      if (folderPlan) {
        await handleFolderChange(folderPlan.dest);
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
  }, [clearSelection, config?.language, config?.lang, executeLibraryMovePlans, handleFolderChange, handleRefresh, libraries, refreshLibraryScanStates, saveConfig, selectedFolderPath, showToast, t]);

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
    if (file?.path && !selectedFiles.includes(file.path)) {
      selectFile(file.path, null, index);
    }
    setContextMenu({ type: 'file', x: event.clientX, y: event.clientY, file });
  }, [selectFile, selectedFiles]);

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
      await scanFolder(folderPath, { ...scanOptions, force: true });
    }
  }, [scanFolder, scanOptions, selectedFolderPath]);

  const renameContextFolder = useCallback(async folderPath => {
    if (!folderPath) return;
    const oldName = basename(folderPath);
    const input = window.prompt(t('dlg_ren_folder_msg'), oldName);
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
  }, [config?.dup_check_folders, config?.libraries, favoriteEntries, handleFolderChange, runInternalFileAction, saveConfig, selectedFolderPath, showFolderError, t]);

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
  }, [addFavorite, closeContextMenu, contextMenu, deleteContextFolder, deleteSelectedFiles, forceUpdateSelectedFiles, groupSelectedBySeries, handleFolderChange, handleRefresh, invertSelection, moveContextFolderToLibrary, openFolderPath, openLibraryMoveDialog, openSelectedInViewer, refreshContextFolder, removeFavorite, renameContextFolder, renameSelectedFile, runLibraryIndexAction, selectAll, selectedFolderPath, sendFolderToTab, sendSelectedFilesToTab, undoLastRename]);

  useEffect(() => {
    const handleKeyDown = (event) => {
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
        handleSmartRefresh(event.shiftKey);
      } else if (hasPrimaryModifier(event, navigator.platform) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if (hasPrimaryModifier(event, navigator.platform) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        invertSelection();
      } else if (hasPrimaryModifier(event, navigator.platform) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoLastRename();
      } else if (hasPrimaryModifier(event, navigator.platform) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (hasPrimaryModifier(event, navigator.platform) && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setGotoPathDraft(selectedFolderPath);
        setShowGotoDialog(true);
      } else if (event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setShowMultiRenameDialog(true);
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
  }, [clearSelection, closeContextMenu, closeTopOverlay, deleteSelectedFiles, handleSmartRefresh, handleViewModeChange, invertSelection, moveActiveSelection, openSelectedInExplorer, selectAll, selectedFolderPath, sendSelectedFilesToTab, undoLastRename]);

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
    const name = window.prompt(t('dlg_save_lay_msg'))?.trim();
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
  }, [columnLayout, config?.folder_saved_layouts, config?.language, config?.lang, groupKey, saveConfig, sortKey, sortOrder, t]);

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
      selectedFiles,
      activeSelectedPath,
      sortKey,
      sortOrder,
      groupKey,
      onSelect: handleFileSelect,
      onDragSelect: selectPaths,
      onContextMenu: showFileContextMenu,
      onClearSelection: clearSelection,
      onScroll: event => {
        viewScrollPositionsRef.current[viewMode] = event.currentTarget.scrollTop;
      },
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} activeSelectedPath={activeSelectedPath} onSelect={handleFileSelect} onDragSelect={selectPaths} onContextMenu={showFileContextMenu} onClearSelection={clearSelection} onScroll={props.onScroll} onSort={handleSort} t={t} sortKey={sortKey} sortOrder={sortOrder} groupKey={groupKey} columnLayout={columnLayout} onColumnLayoutChange={handleColumnLayoutChange} scale={itemScale} />;
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
          <div className="folder-left-panel" style={{ flexBasis: `${leftPanelWidth}px`, width: `${leftPanelWidth}px` }}>
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
                {isCheckingMissing ? t('msg_analyzing') : (missingData.length > 0 ? `${t('tf_btn_check_missing')} 🔴 ${missingData.length}` : t('tf_btn_check_missing'))}
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
                  placeholder={t('folder_search_ph')}
                  value={searchQuery}
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
                onClick={event => handleSmartRefresh(event.shiftKey)}
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
              <div className="detail-panel-wrap" style={{ flexBasis: `${detailPanelHeight}px`, height: `${detailPanelHeight}px` }}>
                <DetailPanel selectedFile={activeSelectedFile} onContentHeightChange={handleDetailContentHeightChange} t={t} />
              </div>
            </>
          )}

          <div className="right-bottom-bar">
            <div className="status-info">
              {formatStatus(t, selectedFiles, filteredFileData)}
            </div>
            <div className="view-controls">
              <button
                className={`view-icon-btn ${viewMode === 'table' ? 'active' : ''}`}
                title={t('menu_detail')}
                aria-pressed={viewMode === 'table'}
                onClick={() => handleViewModeChange('table')}
              >
                ☰
              </button>
              <button
                className={`view-icon-btn ${viewMode === 'thumbnail' ? 'active' : ''}`}
                title={t('menu_thumbnail')}
                aria-pressed={viewMode === 'thumbnail'}
                onClick={() => handleViewModeChange('thumbnail')}
              >
                ▦
              </button>
              <button
                className={`view-icon-btn ${viewMode === 'tile' ? 'active' : ''}`}
                title={t('menu_tile')}
                aria-pressed={viewMode === 'tile'}
                onClick={() => handleViewModeChange('tile')}
              >
                ☷
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
              <ContextMenuItem onClick={() => handleContextAction('open-explorer')} label={`📂 ${t('action_open_exp')}`} />
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
                  : `📌 ${t('action_fav_add')}`}
              />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('open-explorer')} label={`📂 ${t('action_open_exp')}`} />
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
              <ContextMenuItem onClick={() => handleContextAction('undo-rename')} label={t('tf_undo_rename')} shortcut="Ctrl+Z" />
              <ContextMenuItem onClick={() => handleContextAction('show-file')} label={`📂 ${t('action_open_exp')}`} />
              <div className="folder-context-menu-separator" />
              <ContextMenuItem onClick={() => handleContextAction('select-all')} label={t('action_sel_all')} shortcut="Ctrl+A" />
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
        <MultiRenameLaunchDialog
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

function ContextMenuItem({ label, shortcut = '', onClick }) {
  return (
    <button type="button" className="folder-context-menu-item" onClick={onClick}>
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
          <button onClick={onClose}>{t('btn_cancel')}</button>
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

function MultiRenameLaunchDialog({ files, onExecute, onClose, t }) {
  const inferred = useMemo(
    () => inferRenamePattern(files.map(file => file.name || basename(file.path))),
    [files],
  );
  const [oldPattern, setOldPattern] = useState(inferred.oldPattern);
  const [newPattern, setNewPattern] = useState(inferred.newPattern);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [folderNameMode, setFolderNameMode] = useState(false);
  const [previousNewPattern, setPreviousNewPattern] = useState(inferred.newPattern);
  const [padNumbersEnabled, setPadNumbersEnabled] = useState(false);
  const [numberDigits, setNumberDigits] = useState(3);
  const [addSequence, setAddSequence] = useState(false);
  const [sequenceStart, setSequenceStart] = useState(1);
  const [sequenceDigits, setSequenceDigits] = useState(3);
  const [sequencePosition, setSequencePosition] = useState('before');
  const [rows, setRows] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [columnWidths, setColumnWidths] = useState([300, 300, 80, 300]);
  const previewGenerationRef = useRef(0);
  const tableResizeRef = useRef(null);

  useEffect(() => {
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    setPreviewing(true);
    const timer = window.setTimeout(async () => {
      const options = {
        oldPattern,
        newPattern,
        caseSensitive,
        regexMode,
        padNumbers: padNumbersEnabled,
        numberDigits,
        addSequence,
        sequenceStart,
        sequenceDigits,
        sequencePosition,
      };
      const previews = await resolveRenamePreviewConflicts(
        files.map((file, index) => previewRename(file, options, index)),
        targetPath => window.electronAPI?.exists?.(targetPath),
      );
      if (previewGenerationRef.current !== generation) return;
      setRows(previews);
      setPreviewing(false);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [
    addSequence,
    caseSensitive,
    files,
    newPattern,
    numberDigits,
    oldPattern,
    padNumbersEnabled,
    regexMode,
    sequenceDigits,
    sequencePosition,
    sequenceStart,
  ]);

  const toggleRegexMode = checked => {
    if (checked) {
      const converted = normalPatternToRegex(oldPattern);
      setOldPattern(converted.source.replace(/^\^|\$$/g, ''));
      setNewPattern(normalReplacementToRegex(newPattern));
    } else {
      setOldPattern(regexPatternToNormal(oldPattern));
      setNewPattern(regexReplacementToNormal(newPattern));
    }
    setRegexMode(checked);
  };

  const toggleFolderNameMode = checked => {
    if (checked) {
      setPreviousNewPattern(newPattern);
      const firstPath = files[0]?.full_path || files[0]?.path || '';
      const parts = firstPath.split(/[\\/]/);
      parts.pop();
      setNewPattern(folderNameRenamePattern(newPattern, parts.pop() || '', regexMode));
    } else {
      setNewPattern(previousNewPattern);
    }
    setFolderNameMode(checked);
  };

  const execute = async () => {
    const targets = rows.filter(row => row.status === 'ok' && row.oldName !== row.newName);
    if (targets.length === 0) {
      onClose();
      return;
    }
    setExecuting(true);
    setProgress(10);
    const result = await onExecute(targets);
    setProgress(100);
    setExecuting(false);
    if ((result?.errors?.length || 0) === 0 && result?.successCount > 0) onClose();
  };

  const statusText = status => ({
    ok: t('tf_status_ok'),
    conflict: t('tf_status_conflict'),
    unchanged: t('tf_status_invalid'),
    error: t('tf_status_invalid'),
    invalid: t('tf_status_invalid'),
  })[status] || status;

  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const previewColumnLabels = [t('tf_col_old_name'), t('tf_col_new_name'), t('tf_col_status'), t('col_path')];

  const measureColumnTextWidth = useCallback((text) => {
    const canvas = measureColumnTextWidth.canvas || document.createElement('canvas');
    measureColumnTextWidth.canvas = canvas;
    const context = canvas.getContext('2d');
    context.font = '800 12px sans-serif';
    return Math.ceil(context.measureText(String(text || '')).width);
  }, []);

  const autoResizeColumn = useCallback((columnIndex) => {
    const values = rows.map(row => ([
      row.oldName,
      row.newName,
      statusText(row.status),
      row.path,
    ][columnIndex]));
    const maxTextWidth = [previewColumnLabels[columnIndex], ...values]
      .reduce((max, value) => Math.max(max, measureColumnTextWidth(value)), 0);
    const nextWidth = Math.min(Math.max(maxTextWidth + 28, 60), 720);
    setColumnWidths(widths => widths.map((width, index) => (
      index === columnIndex ? nextWidth : width
    )));
  }, [measureColumnTextWidth, previewColumnLabels, rows, statusText]);

  const startColumnResize = (event, columnIndex) => {
    event.preventDefault();
    event.stopPropagation();
    tableResizeRef.current = {
      columnIndex,
      startX: event.clientX,
      startWidth: columnWidths[columnIndex],
    };
    document.body.classList.add('multi-rename-resizing');
  };

  useEffect(() => {
    const handleMouseMove = event => {
      const state = tableResizeRef.current;
      if (!state) return;
      event.preventDefault();
      const delta = event.clientX - state.startX;
      setColumnWidths(widths => widths.map((width, index) => (
        index === state.columnIndex ? Math.max(60, state.startWidth + delta) : width
      )));
    };
    const handleMouseUp = () => {
      tableResizeRef.current = null;
      document.body.classList.remove('multi-rename-resizing');
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.classList.remove('multi-rename-resizing');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const renderResizeHeader = (label, columnIndex, className = '') => (
    <th className={className}>
      <span>{label}</span>
      <span
        className="multi-rename-column-resizer"
        onMouseDown={event => startColumnResize(event, columnIndex)}
        onDoubleClick={event => {
          event.preventDefault();
          event.stopPropagation();
          autoResizeColumn(columnIndex);
        }}
        title={t('column_resize')}
      />
    </th>
  );

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="file-action-dialog multi-rename-launch-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar multi-rename-titlebar">
          <span className="multi-rename-title">
            <span className="multi-rename-title-icon">▣</span>
            {t('tf_menu_rename_multi')}
          </span>
          <button type="button" onClick={onClose} disabled={executing}>×</button>
        </div>
        <div className="multi-rename-body">
          <fieldset className="multi-rename-rules">
            <legend>{t('tf_rename_mode')}</legend>
            <div className="multi-rename-patterns">
              <label>
                <span>{t('tf_old_format')}</span>
                <input value={oldPattern} onChange={event => setOldPattern(event.target.value)} disabled={executing} />
              </label>
              <label>
                <span>{t('tf_new_format')}</span>
                <input value={newPattern} onChange={event => setNewPattern(event.target.value)} disabled={executing} />
              </label>
            </div>
            <div className="multi-rename-options multi-rename-options-primary">
              <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} /> {t('tf_case_sensitive')}</label>
              <label><input type="checkbox" checked={regexMode} onChange={event => toggleRegexMode(event.target.checked)} /> {t('tf_use_regex')}</label>
              <label><input type="checkbox" checked={folderNameMode} onChange={event => toggleFolderNameMode(event.target.checked)} /> {t('tf_use_folder_name')}</label>
              <label>
                <input type="checkbox" checked={padNumbersEnabled} onChange={event => setPadNumbersEnabled(event.target.checked)} />
                {t('tf_use_padding')}
                <input type="number" min="1" max="4" value={numberDigits} disabled={!padNumbersEnabled} onChange={event => setNumberDigits(Number(event.target.value))} />
              </label>
            </div>
            <div className="multi-rename-options multi-rename-options-sequence">
              <label>
                <input type="checkbox" checked={addSequence} onChange={event => setAddSequence(event.target.checked)} />
                {t('tf_rule_numbering')}
              </label>
              <label>
                {t('tf_num_start')}
                <input type="number" min="0" max="99999" value={sequenceStart} disabled={!addSequence} onChange={event => setSequenceStart(Number(event.target.value))} />
              </label>
              <label>
                {t('tf_num_digits')}
                <input type="number" min="1" max="10" value={sequenceDigits} disabled={!addSequence} onChange={event => setSequenceDigits(Number(event.target.value))} />
              </label>
              <label>
                {t('tf_num_pos')}
                <select value={sequencePosition} disabled={!addSequence} onChange={event => setSequencePosition(event.target.value)}>
                  <option value="before">{t('tf_pos_front')}</option>
                  <option value="after">{t('tf_pos_back')}</option>
                </select>
              </label>
            </div>
          </fieldset>
          <div className="multi-rename-preview">
            <table style={{ width: `${tableWidth}px` }}>
              <colgroup>
                <col style={{ width: `${columnWidths[0]}px` }} />
                <col style={{ width: `${columnWidths[1]}px` }} />
                <col style={{ width: `${columnWidths[2]}px` }} />
                <col style={{ width: `${columnWidths[3]}px` }} />
              </colgroup>
              <thead>
                <tr>
                  {renderResizeHeader(previewColumnLabels[0], 0)}
                  {renderResizeHeader(previewColumnLabels[1], 1)}
                  {renderResizeHeader(previewColumnLabels[2], 2, 'multi-rename-status-column')}
                  {renderResizeHeader(previewColumnLabels[3], 3)}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.path} className={`rename-status-${row.status}`}>
                    <td title={row.oldName}>{row.oldName}</td>
                    <td
                      className={row.oldName !== row.newName ? 'rename-new-name-changed' : ''}
                      title={row.newName}
                    >
                      {row.newName}
                    </td>
                    <td className="multi-rename-status-column" title={statusText(row.status)}>{statusText(row.status)}</td>
                    <td title={row.path}>{row.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(previewing || executing) && (
            <div className="multi-rename-progress">
              <progress max="100" value={executing ? progress : undefined} />
              <span>{executing ? `${progress}%` : t('tf_preview_updating')}</span>
            </div>
          )}
        </div>
        <div className="layout-dialog-footer multi-rename-footer">
          <button type="button" className="primary" disabled={executing || previewing || !rows.some(row => row.status === 'ok')} onClick={execute}>{t('btn_ok')}</button>
          <button type="button" disabled={executing} onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
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
          <button onClick={onClose}>{t('btn_cancel')}</button>
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

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="file-action-dialog library-move-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>{t('dlg_move_lib_title')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="file-action-dialog-body">
          <label htmlFor="library-move-select">{t('lbl_select_lib')}</label>
          <select
            id="library-move-select"
            value={selected}
            onChange={event => setSelected(event.target.value)}
          >
            {libraries.map(library => <option key={library} value={library}>{library}</option>)}
          </select>
          {!folderMode && (
            <label className="library-move-folder-option">
              <input
                type="checkbox"
                checked={createCurrentFolder}
                onChange={event => setCreateCurrentFolder(event.target.checked)}
              />
              <span>{t('chk_create_folder')}</span>
            </label>
          )}
          <strong>{t('lbl_preview_move')}</strong>
          <div className="library-move-preview">
            <div className="library-move-preview-head">
              <span>{t('col_source_path')}</span>
              <span>{t('col_dest_path')}</span>
            </div>
            {plans.map(plan => (
              <div className="library-move-preview-row" key={plan.src}>
                <span title={plan.src}>{plan.src}</span>
                <span title={plan.dest}>{plan.dest}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button disabled={!selected || plans.length === 0} onClick={() => onConfirm(plans)}>{t('btn_ok')}</button>
          <button onClick={onClose}>{t('btn_cancel')}</button>
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
