import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FolderSidebar } from '../components/folder/FolderSidebar';
import { FileTableView } from '../components/folder/FileTableView';
import { ThumbnailView } from '../components/folder/ThumbnailView';
import { TileView } from '../components/folder/TileView';
import { DetailPanel } from '../components/folder/DetailPanel';
import { FolderToolbar } from '../components/folder/FolderToolbar';
import { MissingVolumesDialog } from '../components/folder/MissingVolumesDialog';
import { extractCoreTitle, extractVolNumbers } from '../utils/folderUtils';
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
  normalizeViewMode,
  normalizeViewScales,
} from '../folderViewState';
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

function findMissingVolumes(files = []) {
  const seriesMap = {};
  files.forEach(file => {
    if (file.is_folder) return;
    const seriesName = file.series || extractCoreTitle(file.name) || 'Unknown';
    if (!seriesMap[seriesName]) seriesMap[seriesName] = [];
    seriesMap[seriesName].push({
      name: file.name,
      folder_path: file.full_path || file.path || file.folder_path,
      series_name: seriesName,
    });
  });

  const missing = [];
  for (const [series, items] of Object.entries(seriesMap)) {
    const volumes = new Set();
    let folderPath = '';
    items.forEach(item => {
      extractVolNumbers(item.name, item.series_name).forEach(volume => volumes.add(volume));
      if (!folderPath) folderPath = parentPath(item.folder_path) || item.folder_path;
    });
    if (volumes.size === 0) continue;
    const sorted = [...volumes].sort((a, b) => a - b);
    if (sorted[sorted.length - 1] - sorted[0] >= 150) continue;
    const missingVolumes = [];
    for (let volume = sorted[0]; volume <= sorted[sorted.length - 1]; volume += 1) {
      if (!volumes.has(volume)) missingVolumes.push(String(volume));
    }
    if (missingVolumes.length) missing.push({ series, missing: missingVolumes, folder_path: folderPath });
  }
  return missing.sort((a, b) => a.series.localeCompare(b.series));
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

  // --- 선택 상태 ---
  const {
    selectedFiles,
    selectedFileData,
    selectFile,
    toggleFile,
    rangeSelect,
    clearSelection,
    selectAll,
    deselectAll,
    invertSelection,
  } = useFileSelection(filteredFileData);
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

  // 폴더 변경 핸들러
  const handleFolderChange = useCallback(async (folderPath) => {
    setSelectedFolderPath(folderPath);
    clearSelection();
    setSearchQuery('');
    const files = await scanFolder(folderPath, scanOptions);
    const missing = findMissingVolumes(files || []);
    setMissingData(missing);
    if (missing.length > 0) {
      const messageKey = hasShownMissingToastRef.current ? 'tf_local_missing_alert' : 'tf_toast_missing';
      hasShownMissingToastRef.current = true;
      window.setTimeout(() => showToast?.({ key: messageKey, values: [missing.length] }), 1000);
    }
  }, [scanOptions, scanFolder, clearSelection, showToast, t]);

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
    setIsCheckingMissing(true);
    setTimeout(() => {
      const missing = findMissingVolumes(filteredFileData);
      setMissingData(missing);
      setIsCheckingMissing(false);
      if (missing.length > 0) setShowMissingDialog(true);
      else showToast?.(t('msg_no_missing_vols'));
    }, 100);
  }, [filteredFileData, showToast, t]);

  const handleRefresh = useCallback(async () => {
    if (!selectedFolderPath) return;
    const files = await scanFolder(selectedFolderPath, { ...scanOptions, force: true });
    const missing = findMissingVolumes(files || []);
    setMissingData(missing);
    if (missing.length > 0) showToast?.({ key: 'tf_local_missing_alert', values: [missing.length] });
  }, [selectedFolderPath, scanFolder, scanOptions, showToast, t]);

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

  const deleteSelectedFiles = useCallback(async () => {
    const targets = selectedFileObjects.map(file => file.full_path || file.path).filter(Boolean);
    if (targets.length === 0) return;
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('dlg_warn'),
      message: `${targets.length}개 항목을 휴지통으로 이동할까요?`,
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
    const nextName = window.prompt(t('msg_rename_desc'), oldName)?.trim();
    if (!nextName || nextName === oldName) return;
    const result = await runInternalFileAction(
      () => window.electronAPI?.renameFile?.(target, replaceBasename(target, nextName)),
    );
    if (!result?.success) {
      showToast?.(result?.message || t('msg_rename_dup'));
      return;
    }
    showToast?.({ key: 'msg_rename_success' });
    clearSelection();
    handleRefresh();
  }, [activeSelectedFile, clearSelection, handleRefresh, runInternalFileAction, showToast, t]);

  const undoLastRename = useCallback(async () => {
    const result = await window.electronAPI?.undoRename?.();
    if (!result?.success) {
      showToast?.(result?.message || result?.errors?.join(' / ') || t('tf_undo_fail'));
      return;
    }
    showToast?.(`${t('tf_undo_success')} (${result.successCount || 0} files)`);
    clearSelection();
    handleRefresh();
  }, [clearSelection, handleRefresh, showToast, t]);

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
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('dlg_warn'),
      message: `${plans.length}개 파일을 시리즈별 폴더로 이동할까요?`,
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: config?.language || config?.lang || 'ko',
    });
    if (response !== 'yes') return;
    const result = await runInternalFileAction(
      () => window.electronAPI?.executeLibraryMove?.(plans),
    );
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
  }, [clearSelection, config?.language, config?.lang, handleRefresh, runInternalFileAction, selectedFileObjects, showToast, t]);

  const moveSelectedToLibrary = useCallback(async () => {
    if (selectedFileObjects.length === 0) return;
    if (libraries.length === 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('warn_no_library'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }
    const restoredLibrary = resolveLastSelectedLibrary(libraries, config?.last_selected_library);
    const targetLibrary = libraries.length === 1
      ? libraries[0]
      : window.prompt(`이동할 라이브러리 경로를 입력하세요:\n${libraries.join('\n')}`, restoredLibrary)?.trim();
    if (!targetLibrary || !libraries.includes(targetLibrary)) return;
    await saveConfig?.({ last_selected_library: targetLibrary });
    const plans = selectedFileObjects.map(file => {
      const source = file.full_path || file.path;
      return {
        src: source,
        dest: joinPath(targetLibrary, basename(parentPath(source)), basename(source)),
      };
    }).filter(plan => plan.src);
    const result = await runInternalFileAction(
      () => window.electronAPI?.executeLibraryMove?.(plans),
    );
    if (result?.successCount > 0) {
      showToast?.(t('msg_move_lib_done', [result.successCount]));
      clearSelection();
      handleRefresh();
    } else {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: result?.errors?.join('\n') || t('msg_failed'),
        language: config?.language || config?.lang || 'ko',
      });
    }
  }, [clearSelection, config?.language, config?.lang, config?.last_selected_library, handleRefresh, libraries, runInternalFileAction, saveConfig, selectedFileObjects, showToast, t]);

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
    if (!folderPath || libraries.length === 0) return;
    const availableLibraries = libraries.filter(library => library !== folderPath);
    if (availableLibraries.length === 0) return;
    const restoredLibrary = resolveLastSelectedLibrary(availableLibraries, config?.last_selected_library);
    const targetLibrary = availableLibraries.length === 1
      ? availableLibraries[0]
      : window.prompt(`이동할 라이브러리 경로를 입력하세요:\n${availableLibraries.join('\n')}`, restoredLibrary)?.trim();
    if (!targetLibrary || !availableLibraries.includes(targetLibrary)) return;
    const destination = joinPath(targetLibrary, basename(folderPath));
    if (await window.electronAPI?.exists?.(destination)) {
      await showFolderError('dlg_err_occurred', t('msg_rename_dup'));
      return;
    }
    await saveConfig?.({ last_selected_library: targetLibrary });
    const result = await runInternalFileAction(
      () => window.electronAPI?.executeLibraryMove?.([{ src: folderPath, dest: destination }]),
    );
    if (result?.successCount !== 1) {
      await showFolderError('dlg_err_occurred', result?.errors?.join('\n') || t('msg_failed'));
      return;
    }
    setTreeRefreshToken(current => current + 1);
    await handleFolderChange(destination);
  }, [config?.last_selected_library, handleFolderChange, libraries, runInternalFileAction, saveConfig, showFolderError, t]);

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
    } else if (action === 'delete-file') {
      await deleteSelectedFiles();
    } else if (action === 'rename-file') {
      await renameSelectedFile();
    } else if (action === 'undo-rename') {
      await undoLastRename();
    } else if (action === 'group-series') {
      await groupSelectedBySeries();
    } else if (action === 'move-library') {
      await moveSelectedToLibrary();
    }
  }, [addFavorite, closeContextMenu, contextMenu, deleteContextFolder, deleteSelectedFiles, groupSelectedBySeries, handleFolderChange, moveContextFolderToLibrary, moveSelectedToLibrary, openFolderPath, refreshContextFolder, removeFavorite, renameContextFolder, renameSelectedFile, runLibraryIndexAction, selectedFolderPath, sendFolderToTab, undoLastRename]);

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
  }, [clearSelection, closeContextMenu, deleteSelectedFiles, handleSmartRefresh, handleViewModeChange, invertSelection, openSelectedInExplorer, selectAll]);

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
      }
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
      showToast?.(t('dlg_exp_no_data'));
      return;
    }
    const filePath = await window.electronAPI?.saveFile?.(t('dlg_exp_title'), [
      { name: 'CSV', extensions: ['csv'] },
    ]);
    if (!filePath) return;
    const headers = [
      t('col_name'),
      t('col_path'),
      t('col_size'),
      t('col_ext'),
      t('col_series'),
      t('col_title'),
      t('col_writer'),
      t('col_publisher'),
      t('col_genre'),
    ];
    const rows = filteredFileData.map(file => [
      file.name,
      file.full_path || file.path,
      file.size,
      file.ext,
      file.series,
      file.title,
      file.author || file.writer,
      file.publisher,
      file.genre,
    ]);
    const result = await window.electronAPI?.exportCsv?.(filePath, headers, rows);
    if (result?.success) showToast?.(t('dlg_exp_done'));
    else showToast?.(result?.message || t('msg_failed'));
  }, [filteredFileData, showToast, t]);

  // View Stack
  const renderViewStack = () => {
    const props = {
      fileData: filteredFileData,
      selectedFiles,
      sortKey,
      sortOrder,
      groupKey,
      onSelect: handleFileSelect,
      onContextMenu: showFileContextMenu,
      onScroll: event => {
        viewScrollPositionsRef.current[viewMode] = event.currentTarget.scrollTop;
      },
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} onSelect={handleFileSelect} onContextMenu={showFileContextMenu} onScroll={props.onScroll} onSort={handleSort} t={t} sortKey={sortKey} sortOrder={sortOrder} groupKey={groupKey} columnLayout={columnLayout} scale={itemScale} />;
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
              <button onClick={() => handleContextAction('show-file')}>파일 위치 열기</button>
              <button onClick={() => handleContextAction('rename-file')}>{t('action_rename_file')}</button>
              <button onClick={() => handleContextAction('undo-rename')}>{t('tf_undo_success')}</button>
              <button onClick={() => handleContextAction('group-series')}>{t('action_group_by_series')}</button>
              <button onClick={() => handleContextAction('move-library')}>{t('action_move_to_library')}</button>
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
  const totalSize = formatBytes(files.reduce((sum, file) => sum + (Number(file.size) || 0), 0));
  const selected = selectedFiles.length > 0 ? selectedFiles[0] : t('menu_none');
  return t('folder_status_sel', [selected, files.length, totalSize]);
}

export { FolderTab };
