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
  moveColumn,
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
  inferRenamePattern,
  normalPatternToRegex,
  normalReplacementToRegex,
  previewRename,
  regexReplacementToNormal,
} from '../multiRenamePolicy';
import {
  findMissingVolumes,
} from '../missingVolumesPolicy';
import {
  applyConflictChoice,
  createLibraryMovePlans,
} from '../libraryMovePolicy';
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

function joinPath(base, ...parts) {
  const separator = String(base || '').includes('\\') ? '\\' : '/';
  return [String(base || '').replace(/[\\/]+$/, ''), ...parts.map(part => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter(Boolean)
    .join(separator);
}

function FolderTab({ config, saveConfig, t, showToast }) {
  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const { scanning, scanProgress, statusMessage, scanFolder, getCachedFiles } = useFolderScan(t);
  const mainAreaRef = useRef(null);
  const rightPanelRef = useRef(null);
  const viewContainerRef = useRef(null);
  const viewScrollPositionsRef = useRef({ table: 0, tile: 0, thumbnail: 0 });
  const hasShownMissingToastRef = useRef(false);
  const missingBackgroundKeyRef = useRef('');
  const missingLocalTimerRef = useRef(null);
  const lastMissingLocalToastRef = useRef({ folderPath: '', timestamp: 0 });
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
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [itemScales, setItemScales] = useState({ table: 50, tile: 50, thumbnail: 50 });
  const [showLayoutDialog, setShowLayoutDialog] = useState(false);
  const [showDeleteLayoutDialog, setShowDeleteLayoutDialog] = useState(false);
  const [columnLayout, setColumnLayout] = useState(createDefaultColumnLayout);
  const [contextMenu, setContextMenu] = useState(null);
  const [showMultiRenameDialog, setShowMultiRenameDialog] = useState(false);
  const [seriesMovePreview, setSeriesMovePreview] = useState(null);
  const [libraryMoveRequest, setLibraryMoveRequest] = useState(null);
  const [moveConflict, setMoveConflict] = useState(null);

  // --- 검색 상태 ---
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  const scanOptions = useMemo(() => ({
    includeSubfolders,
    enableDupCheck,
    dupFolders: config?.dup_check_folders || [],
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
    restoredViewSettingsRef.current = true;
  }, [config]);

  useEffect(() => {
    if (!restoredViewSettingsRef.current) return undefined;
    const timer = window.setTimeout(() => {
      saveConfig?.({
        folder_view_mode: viewMode,
        folder_item_scales: normalizeViewScales(itemScales),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [itemScales, saveConfig, viewMode]);

  useEffect(() => {
    if (!activeSelectedFile || initializedDetailHeightRef.current) return;
    const rightHeight = rightPanelRef.current?.clientHeight || 700;
    setDetailPanelHeight(resolveDetailHeight(undefined, rightHeight));
    initializedDetailHeightRef.current = true;
  }, [activeSelectedFile]);

  useEffect(() => {
    const removeProgress = window.electronAPI?.onTaskProgress?.(data => {
      if (data?.task !== 'folder:updateIndex') return;
      setDuplicatePreparationStatus(data.message || t('dup_scan_start'));
      setDuplicatePreparationProgress(Math.max(0, Math.min(100, Number(data.progress) || 0)));
    });
    return () => {
      if (typeof removeProgress === 'function') removeProgress();
    };
  }, [t]);

  // --- 사이드바 상태 ---
  const libraries = useMemo(() => (
    [...new Set([...(config?.libraries || []), ...(config?.dup_check_folders || [])])]
  ), [config?.libraries, config?.dup_check_folders]);
  const favoriteEntries = useMemo(() => normalizeFavorites(config || {}), [config]);

  const addLibrary = useCallback(async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder('라이브러리 폴더 선택');
      if (folderPath && saveConfig && !libraries.includes(folderPath)) {
        const nextLibraries = [...libraries, folderPath];
        await saveConfig({
          libraries: nextLibraries,
          dup_check_folders: nextLibraries,
        });
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

  // --- 누락 권수 상태 ---
  const [missingData, setMissingData] = useState([]);
  const [showMissingDialog, setShowMissingDialog] = useState(false);
  const [isCheckingMissing, setIsCheckingMissing] = useState(false);

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

    const analyze = async () => {
      if (cancelled) return;
      setIsCheckingMissing(true);
      try {
        const libraryFiles = [];
        for (const folderPath of libraryFolders) {
          if (cancelled) return;
          const files = await window.electronAPI?.scanFolder?.(folderPath, {
            includeSubfolders: true,
            enableDupCheck: false,
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
        if (!cancelled) setIsCheckingMissing(false);
      }
    };

    const timer = window.setTimeout(analyze, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [config, getCurrentFileData, showToast]);

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

    if (nextValue && dupFolders.length > 0) {
      setPreparingDuplicates(true);
      setDuplicatePreparationStatus(t('dup_scan_start'));
      setDuplicatePreparationProgress(0);
      try {
        const result = await window.electronAPI?.updateFolderIndex?.(dupFolders);
        if (result?.success === false) throw new Error(result.message || t('msg_failed'));
      } catch (error) {
        setEnableDupCheck(false);
        await window.electronAPI?.showMessage?.({
          type: 'error',
          title: t('dlg_err'),
          message: `${t('msg_failed')}:\n${error.message}`,
          language: config?.language || config?.lang || 'ko',
        });
        return;
      } finally {
        setPreparingDuplicates(false);
        setDuplicatePreparationStatus('');
        setDuplicatePreparationProgress(0);
      }
    }

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
    config?.language,
    config?.lang,
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

  const runLibraryIndexAction = useCallback(async (folderPath, optimizeMetadata = false) => {
    if (!folderPath || preparingDuplicates || scanning) return;
    const choice = await window.electronAPI?.chooseLibrarySyncMode?.({
      title: optimizeMetadata ? t('menu_optimize_meta') : t('setting_update_index'),
      message: t('msg_optimize_desc', [basename(folderPath)]),
      language: config?.language || config?.lang || 'ko',
    });
    if (!choice || choice === 'cancel') return;

    await saveConfig?.({ last_selected_library: folderPath });
    setPreparingDuplicates(true);
    setDuplicatePreparationStatus(t('dup_scan_start'));
    setDuplicatePreparationProgress(0);
    try {
      const result = await window.electronAPI?.updateFolderIndex?.(
        [folderPath],
        { mode: choice },
      );
      if (result?.success === false) throw new Error(result.message || t('msg_failed'));

      if (optimizeMetadata) {
        setIncludeSubfolders(true);
        const files = await scanFolder(folderPath, {
          ...scanOptions,
          includeSubfolders: true,
          force: true,
        });
        setMissingData(findMissingVolumes(files || []));
        setSelectedFolderPath(folderPath);
        clearSelection();
        setSearchQuery('');
      } else {
        await handleFolderChange(folderPath);
      }
      showToast?.({ key: 'setting_update_index_msg' });
    } catch (error) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: `${t('msg_failed')}:\n${error.message}`,
        language: config?.language || config?.lang || 'ko',
      });
    } finally {
      setPreparingDuplicates(false);
      setDuplicatePreparationStatus('');
      setDuplicatePreparationProgress(0);
    }
  }, [
    config?.language,
    config?.lang,
    clearSelection,
    handleFolderChange,
    preparingDuplicates,
    saveConfig,
    scanFolder,
    scanOptions,
    scanning,
    showToast,
    t,
  ]);

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
      await window.electronAPI?.updateFolderIndex?.(affectedLibraries, { mode: 'smart' });
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
  }, [clearSelection, config?.language, config?.lang, executeLibraryMovePlans, handleFolderChange, handleRefresh, libraries, saveConfig, showToast, t]);

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
    }
  }, [addFavorite, closeContextMenu, contextMenu, deleteContextFolder, deleteSelectedFiles, groupSelectedBySeries, handleFolderChange, moveContextFolderToLibrary, openFolderPath, openLibraryMoveDialog, openSelectedInViewer, refreshContextFolder, removeFavorite, renameContextFolder, renameSelectedFile, runLibraryIndexAction, selectedFolderPath, sendFolderToTab, sendSelectedFilesToTab, undoLastRename]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return;

      if (event.key === 'F5') {
        event.preventDefault();
        handleSmartRefresh(event.shiftKey);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        invertSelection();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        clearSelection();
        closeContextMenu();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedFiles();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openSelectedInExplorer();
      } else if (event.key === 'F2') {
        event.preventDefault();
        renameSelectedFile();
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
  }, [clearSelection, closeContextMenu, deleteSelectedFiles, handleSmartRefresh, handleViewModeChange, invertSelection, moveActiveSelection, openSelectedInExplorer, renameSelectedFile, selectAll]);

  useEffect(() => {
    const handleAppAction = (event) => {
      if (event.detail?.activeTab !== 'folder') return;
      const action = event.detail?.action;
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
    handleDroppedPaths,
    invertSelection,
    selectAll,
    selectedFiles.length,
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
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} activeSelectedPath={activeSelectedPath} onSelect={handleFileSelect} onContextMenu={showFileContextMenu} onClearSelection={clearSelection} onScroll={props.onScroll} onSort={handleSort} t={t} sortKey={sortKey} sortOrder={sortOrder} groupKey={groupKey} columnLayout={columnLayout} scale={itemScale} />;
    }
  };

  return (
    <div className="folder-tab">
      <div className="folder-main-area" ref={mainAreaRef}>
        
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
        <div className="folder-right-panel" ref={rightPanelRef}>
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
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                className="refresh-btn"
                onClick={event => handleSmartRefresh(event.shiftKey)}
                title="Shift+Click: Force refresh"
              >
                {t('folder_refresh_list')}
              </button>
            </div>
          </div>

          <div
            className="view-container"
            ref={viewContainerRef}
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
                <DetailPanel selectedFile={activeSelectedFile} t={t} />
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
              <button onClick={() => handleContextAction('sync-library')}>{t('setting_update_index')}</button>
              <button onClick={() => handleContextAction('optimize-library')}>{t('menu_optimize_meta')}</button>
              <button onClick={() => handleContextAction('open-explorer')}>{t('action_open_exp')}</button>
            </>
          ) : contextMenu.type === 'folder' ? (
            <>
              <button onClick={() => handleContextAction('open-folder')}>열기</button>
              <button onClick={() => handleContextAction('refresh-folder')}>{t('action_refresh')}</button>
              <button onClick={() => handleContextAction('rename-folder')}>{t('action_ren_folder')}</button>
              <button onClick={() => handleContextAction('delete-folder')}>{t('action_del_folder')}</button>
              <div className="folder-context-menu-separator" />
              <button onClick={() => handleContextAction(
                isFavoriteFolder(favoriteEntries, contextMenu.folderPath)
                  ? 'unfavorite-folder'
                  : 'favorite-folder'
              )}>
                {t(isFavoriteFolder(favoriteEntries, contextMenu.folderPath) ? 'action_fav_rem' : 'action_fav_add')}
              </button>
              <button onClick={() => handleContextAction('open-explorer')}>{t('action_open_exp')}</button>
              {!libraries.includes(contextMenu.folderPath) && libraries.length > 0 && (
                <button onClick={() => handleContextAction('move-folder-library')}>{t('action_move_folder_to_library')}</button>
              )}
              <div className="folder-context-menu-separator" />
              <button onClick={() => handleContextAction('send-organizer')}>{t('action_flatten_structure')}</button>
              <button onClick={() => handleContextAction('send-renamer')}>{t('action_inner_ren')}</button>
              <button onClick={() => handleContextAction('send-metadata')}>{t('action_meta_edit')}</button>
            </>
          ) : (
            <>
              <button onClick={() => handleContextAction('view-file')}>{t('action_view')}</button>
              <button onClick={() => handleContextAction('show-file')}>{t('action_open_exp')}</button>
              <button onClick={() => handleContextAction('rename-file')}>{t('action_rename_file')}</button>
              <button onClick={() => handleContextAction('undo-rename')}>{t('tf_undo_success')}</button>
              <button onClick={() => handleContextAction('multi-rename')}>{t('tf_menu_rename_multi')}</button>
              <button onClick={() => handleContextAction('group-series')}>{t('action_group_by_series')}</button>
              <button onClick={() => handleContextAction('move-library')}>{t('action_move_to_library')}</button>
              <div className="folder-context-menu-separator" />
              <button onClick={() => handleContextAction('send-file-organizer')}>{t('action_flatten_structure')}</button>
              <button onClick={() => handleContextAction('send-file-renamer')}>{t('action_inner_ren')}</button>
              <button onClick={() => handleContextAction('send-file-metadata')}>{t('action_meta_edit')}</button>
              <button onClick={() => {
                closeContextMenu();
                invertSelection();
              }}>{t('action_inv_sel')}</button>
              <button onClick={() => handleContextAction('delete-file')}>선택 삭제</button>
            </>
          )}
        </ContextMenu>
      )}
      
      {/* Global Bottom Status Bar */}
      <div className="global-status-bar">
        <span className="status-message">
          {preparingDuplicates
            ? `${duplicatePreparationStatus || t('dup_scan_start')} (${duplicatePreparationProgress}%)`
            : scanning
              ? `${statusMessage} (${scanProgress}%)`
              : statusMessage}
        </span>
      </div>
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

function LayoutEditDialog({ layout, onApply, onClose, t }) {
  const [draft, setDraft] = useState(() => normalizeColumnLayout(layout));

  const updateColumn = (index, changes) => {
    setDraft(current => current.map((column, columnIndex) => (
      columnIndex === index ? { ...column, ...changes } : column
    )));
  };

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="layout-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>▣ {t('dlg_edit_lay_title')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="layout-dialog-body">
          <div className="layout-dialog-label">{t('dlg_edit_lay_msg')}</div>
          <div className="layout-column-list">
            {draft.map((column, index) => (
              <div key={column.key} className="layout-column-row">
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
                <input
                  className="layout-column-width"
                  type="number"
                  min="40"
                  max="600"
                  value={column.width}
                  onChange={event => updateColumn(index, { width: Number(event.target.value) })}
                  aria-label={`${column.key} width`}
                />
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => setDraft(current => moveColumn(current, index, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === draft.length - 1}
                  onClick={() => setDraft(current => moveColumn(current, index, 1))}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button onClick={() => onApply(draft)}>{t('btn_ok')}</button>
          <button onClick={onClose}>{t('btn_cancel')}</button>
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
  const previewGenerationRef = useRef(0);

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
        folderNameMode,
        padNumbers: padNumbersEnabled,
        numberDigits,
        addSequence,
        sequenceStart,
        sequenceDigits,
        sequencePosition,
      };
      const previews = await Promise.all(files.map(async (file, index) => {
        const row = previewRename(file, options, index);
        const targetPath = replaceBasename(row.path, row.newName);
        if (row.status !== 'ok') return { ...row, targetPath };
        const duplicateInPreview = files.some((_, otherIndex) => (
          otherIndex !== index
          && previewRename(files[otherIndex], options, otherIndex).newName.toLowerCase() === row.newName.toLowerCase()
        ));
        const exists = await window.electronAPI?.exists?.(targetPath);
        return {
          ...row,
          targetPath,
          status: duplicateInPreview || exists ? 'conflict' : 'ok',
        };
      }));
      if (previewGenerationRef.current !== generation) return;
      setRows(previews);
      setPreviewing(false);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [
    addSequence,
    caseSensitive,
    files,
    folderNameMode,
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
      setOldPattern(inferred.oldPattern);
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
      setNewPattern(parts.pop() || newPattern);
    } else {
      setNewPattern(previousNewPattern);
    }
    setFolderNameMode(checked);
  };

  const execute = async () => {
    const targets = rows.filter(row => row.status === 'ok');
    if (targets.length === 0) return;
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
  })[status] || status;

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div className="file-action-dialog multi-rename-launch-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="dialog-titlebar">
          <span>{t('tf_menu_rename_multi')}</span>
          <button onClick={onClose} disabled={executing}>×</button>
        </div>
        <div className="multi-rename-body">
          <div className="multi-rename-patterns">
            <label>
              <span>기존 형식</span>
              <input value={oldPattern} onChange={event => setOldPattern(event.target.value)} disabled={folderNameMode || executing} />
            </label>
            <label>
              <span>새 형식</span>
              <input value={newPattern} onChange={event => setNewPattern(event.target.value)} disabled={folderNameMode || executing} />
            </label>
          </div>
          <div className="multi-rename-options">
            <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} /> 대소문자 구분</label>
            <label><input type="checkbox" checked={regexMode} onChange={event => toggleRegexMode(event.target.checked)} /> 정규식 모드</label>
            <label><input type="checkbox" checked={folderNameMode} onChange={event => toggleFolderNameMode(event.target.checked)} /> 폴더명으로 이름 바꾸기</label>
            <label>
              <input type="checkbox" checked={padNumbersEnabled} onChange={event => setPadNumbersEnabled(event.target.checked)} />
              숫자 자리수 맞추기
              <input type="number" min="1" max="4" value={numberDigits} disabled={!padNumbersEnabled} onChange={event => setNumberDigits(Number(event.target.value))} />
            </label>
            <label>
              <input type="checkbox" checked={addSequence} onChange={event => setAddSequence(event.target.checked)} />
              순번 추가
              <input type="number" min="0" max="99999" value={sequenceStart} disabled={!addSequence} onChange={event => setSequenceStart(Number(event.target.value))} />
              <input type="number" min="1" max="10" value={sequenceDigits} disabled={!addSequence} onChange={event => setSequenceDigits(Number(event.target.value))} />
              <select value={sequencePosition} disabled={!addSequence} onChange={event => setSequencePosition(event.target.value)}>
                <option value="before">앞</option>
                <option value="after">뒤</option>
              </select>
            </label>
          </div>
          <div className="multi-rename-preview">
            <table>
              <thead>
                <tr>
                  <th>이전 파일명</th>
                  <th>새 파일명</th>
                  <th>{t('tf_col_status')}</th>
                  <th>{t('col_path')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.path} className={`rename-status-${row.status}`}>
                    <td>{row.oldName}</td>
                    <td>{row.newName}</td>
                    <td>{statusText(row.status)}</td>
                    <td>{row.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(previewing || executing) && (
            <div className="multi-rename-progress">
              <progress max="100" value={executing ? progress : undefined} />
              <span>{executing ? `${progress}%` : '미리보기 갱신 중...'}</span>
            </div>
          )}
        </div>
        <div className="layout-dialog-footer">
          <button disabled={executing || previewing || !rows.some(row => row.status === 'ok')} onClick={execute}>{t('btn_ok')}</button>
          <button disabled={executing} onClick={onClose}>{t('btn_cancel')}</button>
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
