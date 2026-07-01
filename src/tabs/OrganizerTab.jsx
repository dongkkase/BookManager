import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { MultiRenameDialog } from '../components/MultiRenameDialog';
import { ResultLogDialog } from '../components/ResultLogDialog';
import { filterExistingResultPaths } from '../resultLog';
import { createToolbarState, emitToolbarState } from '../toolbarState';
import { emitStatusState } from '../statusState';
import { useFileSelection } from '../hooks/useFileSelection';
import { useRafRubberSelection } from '../hooks/useRafRubberSelection';
import {
  applyImmediateSingleSelection,
  isPlainPrimaryClick,
} from '../selectionVisualFeedback';
import {
  changeOrganizerUnit,
  defaultOutputPath,
  filenameOutputPath,
  organizerExtractedTitleName,
  organizerOriginalFilenameName,
  preserveOrganizerExtractedTitle,
  removeOrganizerItems,
  sanitizeOrganizerName,
  targetExtension,
  titleOutputPath,
} from '../organizerPolicy';
import '../styles/OrganizerTab.css';
import { DRAG_DROP_IMAGES, selectRandomResource } from '../resourcePolicy';
import { shouldPlayCompletionSound } from '../completionSoundPolicy';
import { hasPrimaryModifier, isShortcutKey, shouldHandleGlobalShortcut } from '../interactionPolicy';
import { partitionSkippedFiles } from '../notificationPolicy';

function stripFilenameExtension(filename) {
  const value = String(filename || '');
  const index = value.lastIndexOf('.');
  return index > 0 ? value.slice(0, index) : value;
}

function organizerVolumeRenameFile(item, volume, config) {
  const extension = targetExtension(volume, config?.target_format || 'none');
  const name = `${volume.new_name}${extension}`;
  const itemKey = encodeURIComponent(String(item.id || item.filepath || item.name || 'item'));
  const volumeKey = encodeURIComponent(String(volume.id || volume.original_path || volume.new_name || 'volume'));
  return {
    path: `organizer://${itemKey}/${volumeKey}__${name}`,
    name,
    itemId: item.id,
    volumeId: volume.id,
    extension,
  };
}

function hydrateOrganizerItem(item) {
  return {
    ...item,
    volumes: (item.volumes || []).map(preserveOrganizerExtractedTitle),
  };
}

function OrganizerTab({ config, t, showToast }) {
  const runtimePlatform = typeof navigator !== 'undefined' ? navigator.platform : '';
  const language = config?.language || config?.lang || 'ko';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bookmanager:tab-ready', { detail: { tabId: 'organizer' } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [fileList, setFileList] = useState([]);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [taskPhase, setTaskPhase] = useState('idle');
  const [selectedItemId, setSelectedItemId] = useState('');
  const executeLockRef = useRef(false);
  const tabRootRef = useRef(null);
  const treeBodyRef = useRef(null);
  const volumeSelectionBoxRef = useRef(null);
  const volumeRubberSelectRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
  const [skippedFiles, setSkippedFiles] = useState([]);
  const [showVolumeRenameDialog, setShowVolumeRenameDialog] = useState(false);
  const [openFolderMenuId, setOpenFolderMenuId] = useState('');
  const [openBatchMenuId, setOpenBatchMenuId] = useState('');
  const emptyImage = useMemo(
    () => selectRandomResource(DRAG_DROP_IMAGES),
    [],
  );
  const visibleVolumeRows = useMemo(() => fileList.flatMap(item => (
    expandedItems.has(item.id)
      ? (item.volumes || []).map(volume => ({
          ...organizerVolumeRenameFile(item, volume, config),
          item,
          volume,
        }))
      : []
  )), [config, expandedItems, fileList]);
  const {
    selectedFiles: selectedVolumePaths,
    activeSelectedPath: activeVolumePath,
    selectFile: selectVolumeRow,
    toggleFile: toggleVolumeRow,
    rangeSelect: rangeSelectVolumeRows,
    clearSelection: clearVolumeSelection,
    selectPaths: selectVolumePaths,
  } = useFileSelection(visibleVolumeRows);
  const selectedVolumeRows = useMemo(() => (
    selectedVolumePaths
      .map(path => visibleVolumeRows.find(row => row.path === path))
      .filter(Boolean)
  ), [selectedVolumePaths, visibleVolumeRows]);

  const isOrganizerTabVisible = useCallback(() => (
    !tabRootRef.current?.closest?.('[hidden]')
  ), []);

  useEffect(() => {
    const removeProgress = window.electronAPI?.onTaskProgress?.((data) => {
      if (data?.task?.startsWith('organizer:')) {
        setProgress(data.progress ?? 0);
        if (data.message) setStatusMessage(data.message);
      }
    });
    return () => {
      if (typeof removeProgress === 'function') removeProgress();
    };
  }, []);

  useEffect(() => {
    if (!openFolderMenuId && !openBatchMenuId) return undefined;
    const closeRowMenus = event => {
      if (event.target?.closest?.('.org-row-menu-wrap')) return;
      setOpenFolderMenuId('');
      setOpenBatchMenuId('');
    };
    const closeRowMenusOnEscape = event => {
      if (event.key !== 'Escape') return;
      setOpenFolderMenuId('');
      setOpenBatchMenuId('');
    };
    document.addEventListener('pointerdown', closeRowMenus);
    document.addEventListener('keydown', closeRowMenusOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeRowMenus);
      document.removeEventListener('keydown', closeRowMenusOnEscape);
    };
  }, [openBatchMenuId, openFolderMenuId]);

  const selectedCount = useMemo(() => fileList.filter(item => item.checked).length, [fileList]);

  useEffect(() => {
    emitToolbarState('organizer', createToolbarState(fileList));
  }, [fileList]);

  useEffect(() => {
    emitStatusState('organizer', {
      message: statusMessage,
      progress,
      phase: taskPhase,
      canRun: selectedCount > 0,
    });
  }, [progress, selectedCount, statusMessage, taskPhase]);

  const analyzePaths = useCallback(async (paths) => {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (cleanPaths.length === 0) return;

    setIsWorking(true);
    setTaskPhase('analyzing');
    setProgress(0);
    setStatusMessage(t('msg_loading_list'));
    setLastResult(null);
    setSkippedFiles([]);

    try {
      const result = await window.electronAPI.analyzeOrganizer(cleanPaths, {
        lang: language,
        fastAnalyze: true,
        maxAnalysisThreads: config?.max_threads || 2,
      });
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, hydrateOrganizerItem(item)]));
        for (const item of result.items || []) {
          if (!byPath.has(item.filepath)) byPath.set(item.filepath, hydrateOrganizerItem(item));
        }
        return [...byPath.values()];
      });
      setExpandedItems(prev => {
        const next = new Set(prev);
        for (const item of result.items || []) next.add(item.id);
        return next;
      });
      setIsAllExpanded(true);
      setSkippedFiles(prev => [...new Set([...prev, ...(result.skippedFiles || [])])]);
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_failed')}: ${result.skippedFiles.join(', ')}`);
        const skipped = partitionSkippedFiles(result.skippedFiles);
        if (skipped.nested.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_nested_archive')}${skipped.nested.join('\n')}`,
            language,
          });
        }
        if (skipped.unsupported.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_failed')}\n${skipped.unsupported.join('\n')}`,
            language,
          });
        }
      } else {
        setStatusMessage(t('msg_done'));
      }
    } catch (error) {
      showToast?.(`${t('msg_failed')}: ${error.message}`);
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
      setTaskPhase('idle');
    }
  }, [language, t]);

  const handleSelectFiles = useCallback(async () => {
    const paths = await window.electronAPI.selectArchives(t('add_file'));
    await analyzePaths(paths);
  }, [analyzePaths, t]);

  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder(t('add_folder'));
    if (folderPath) await analyzePaths([folderPath]);
  }, [analyzePaths, t]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'organizer', isWorking },
    }));
    return () => window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'organizer', isWorking: false },
    }));
  }, [isWorking]);

  const handleToggleExpandAll = () => {
    if (isAllExpanded) {
      setExpandedItems(new Set());
    } else {
      setExpandedItems(new Set(fileList.map(item => item.id)));
    }
    setIsAllExpanded(!isAllExpanded);
  };

  const handleToggleExpand = (id) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateItem = (id, updater) => {
    setFileList(prev => prev.map(item => item.id === id ? updater(item) : item));
  };

  const handleCheck = (id) => {
    updateItem(id, item => ({ ...item, checked: !item.checked }));
  };

  const handleOutPathChange = (id, outPath) => {
    updateItem(id, item => ({ ...item, out_path: outPath }));
  };

  const handleFolderMenuAction = (item, mode) => {
    setOpenFolderMenuId('');
    if (mode === 'title') {
      handleOutPathChange(item.id, titleOutputPath(item));
      return;
    }
    if (mode === 'filename') {
      handleOutPathChange(item.id, filenameOutputPath(item));
      return;
    }
    handleOutPathChange(item.id, defaultOutputPath(item.filepath));
  };

  const openFolderRowMenu = useCallback((itemId) => {
    setOpenBatchMenuId('');
    setOpenFolderMenuId(itemId);
  }, []);

  const closeFolderRowMenu = useCallback((itemId) => {
    setOpenFolderMenuId(current => current === itemId ? '' : current);
  }, []);

  const openBatchRowMenu = useCallback((itemId) => {
    setOpenFolderMenuId('');
    setOpenBatchMenuId(itemId);
  }, []);

  const closeBatchRowMenu = useCallback((itemId) => {
    setOpenBatchMenuId(current => current === itemId ? '' : current);
  }, []);

  const handleBatchDefault = () => {
    setFileList(prev => prev.map(item => ({
      ...item,
      out_path: item.checked ? defaultOutputPath(item.filepath) : item.out_path,
    })));
  };

  const handleBatchTitle = () => {
    setFileList(prev => prev.map(item => ({
      ...item,
      out_path: item.checked ? titleOutputPath(item) : item.out_path,
    })));
  };

  const handleBatchUnit = (itemId, unit) => {
    updateItem(itemId, item => ({
      ...item,
      volumes: item.volumes.map(volume => {
        const preserved = preserveOrganizerExtractedTitle(volume);
        return {
          ...preserved,
          new_name: changeOrganizerUnit(
            preserved.new_name,
            unit,
            language,
          ),
        };
      }),
    }));
  };

  const handleBatchVolumeNames = (itemId, mode) => {
    updateItem(itemId, item => ({
      ...item,
      volumes: item.volumes.map(volume => {
        const preserved = preserveOrganizerExtractedTitle(volume);
        const nextName = mode === 'original'
          ? organizerOriginalFilenameName(preserved)
          : organizerExtractedTitleName(preserved);
        return nextName ? { ...preserved, new_name: nextName } : preserved;
      }),
    }));
  };

  const handleBatchMenuAction = (itemId, action) => {
    setOpenBatchMenuId('');
    if (action === 'volume') {
      handleBatchUnit(itemId, 'volume');
      return;
    }
    if (action === 'chapter') {
      handleBatchUnit(itemId, 'chapter');
      return;
    }
    handleBatchVolumeNames(itemId, action);
  };

  const handleClear = () => {
    setFileList([]);
    setExpandedItems(new Set());
    setLastResult(null);
    setSelectedItemId('');
    clearVolumeSelection();
    setSkippedFiles([]);
    setStatusMessage(t('status_wait'));
    setProgress(0);
  };

  useEffect(() => {
    const handleReset = event => {
      if (event.detail?.tabs?.includes('organizer') && !isWorking) handleClear();
    };
    window.addEventListener('bookmanager:reset-task-tabs', handleReset);
    return () => window.removeEventListener('bookmanager:reset-task-tabs', handleReset);
  }, [isWorking, t]);

  const removeByIds = useCallback((ids) => {
    setFileList(prev => {
      const result = removeOrganizerItems(prev, ids);
      setSelectedItemId(result.nextSelectedId);
      setExpandedItems(current => {
        const next = new Set(current);
        ids.forEach(id => next.delete(id));
        return next;
      });
      return result.items;
    });
  }, []);

  const handleRemoveChecked = useCallback(() => {
    removeByIds(fileList.filter(item => item.checked).map(item => item.id));
  }, [fileList, removeByIds]);

  const handleRemoveHighlighted = useCallback(() => {
    if (selectedVolumePaths.length > 0) return;
    if (selectedItemId) removeByIds([selectedItemId]);
  }, [removeByIds, selectedItemId, selectedVolumePaths.length]);

  const handleToggleAllChecked = useCallback(() => {
    setFileList(prev => {
      const allChecked = prev.length > 0 && prev.every(item => item.checked);
      return prev.map(item => ({ ...item, checked: !allChecked }));
    });
  }, []);

  const handleExecute = async () => {
    if (executeLockRef.current) return;
    if (selectedCount === 0) {
      setStatusMessage(t('msg_no_targets'));
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('msg_no_targets'),
        language,
      });
      return;
    }

    executeLockRef.current = true;
    setIsWorking(true);
    setTaskPhase('executing');
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_processing_overlay'));

    try {
      window.dispatchEvent(new CustomEvent('bookmanager:reset-task-tabs', {
        detail: { tabs: ['renamer', 'metadata'] },
      }));
      const result = await window.electronAPI.executeOrganizer(fileList, {
        lang: language,
        target_format: config?.target_format || 'none',
        backup_on: config?.backup_on || false,
        flatten_folders: config?.flatten_folders || false,
        webp_conversion: config?.webp_conversion || false,
        img_quality: config?.img_quality ?? config?.jpg_quality ?? 100,
        max_threads: config?.max_threads || 1,
      });
      const createdFiles = await filterExistingResultPaths(
        result.createdFiles,
        filePath => window.electronAPI?.exists?.(filePath),
      );
      setLastResult({ ...result, createdFiles });
      if (result.cancelled) {
        setStatusMessage(t('msg_cancelled'));
        return;
      }
      const success = result.stats?.success?.length || 0;
      const errors = result.stats?.error?.length || 0;
      const skip = result.stats?.skip?.length || 0;
      const completed = success + skip + errors;
      const message = t('msg_job_done', [success, skip, errors]);
      setStatusMessage(message);
      showToast?.(message);
      if (shouldPlayCompletionSound(config, completed, result.cancelled)) {
        window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav');
      }
    } catch (error) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: `${t('msg_failed')}:\n${error.message}`,
        language,
      });
    } finally {
      executeLockRef.current = false;
      setProgress(0);
      setStatusMessage(t('status_wait'));
      setIsWorking(false);
      setTaskPhase('idle');
    }
  };

  const handleCancel = useCallback(async () => {
    if (taskPhase !== 'executing') return;
    setTaskPhase('cancelling');
    setStatusMessage(t('cancel_wait'));
    await window.electronAPI?.stopTask?.('organizer');
  }, [taskPhase, t]);

  const handleVolumeRowSelect = useCallback((row, event, index) => {
    if (!row?.path) return;
    setSelectedItemId('');
    if (event?.shiftKey) rangeSelectVolumeRows(row.path, row, index);
    else if (hasPrimaryModifier(event, runtimePlatform)) toggleVolumeRow(row.path, row, index);
    else selectVolumeRow(row.path, row, index);
  }, [rangeSelectVolumeRows, runtimePlatform, selectVolumeRow, toggleVolumeRow]);

  const getVolumeRubberContainer = useCallback(() => treeBodyRef.current, []);
  const volumeRubberSelection = useRafRubberSelection({
    getContainer: getVolumeRubberContainer,
    stateRef: volumeRubberSelectRef,
    itemSelector: '[data-volume-path]',
    itemPath: element => element.dataset.volumePath,
    selectionBoxRef: volumeSelectionBoxRef,
    onSelectPaths: selectVolumePaths,
  });

  const handleVolumeRowMouseDown = useCallback((row, event, index) => {
    if (event.button !== 0) return;
    treeBodyRef.current?.focus({ preventScroll: true });
    volumeRubberSelection.begin();
    volumeRubberSelectRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    if (isPlainPrimaryClick(event)) {
      applyImmediateSingleSelection(treeBodyRef.current, event.currentTarget, '[data-volume-path]');
    }
    handleVolumeRowSelect(row, event, index);
  }, [handleVolumeRowSelect, volumeRubberSelection]);

  const startVolumeRubberSelection = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.closest('input, button, textarea, select, a')) return;
    if (event.target.closest('.org-tree-row')) return;
    treeBodyRef.current?.focus({ preventScroll: true });
    setSelectedItemId('');
    clearVolumeSelection();
    volumeRubberSelection.begin();
    volumeRubberSelectRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
  }, [clearVolumeSelection, volumeRubberSelection]);

  const stopVolumeRubberSelection = useCallback(() => {
    volumeRubberSelection.commit();
    volumeRubberSelectRef.current = { active: false, moved: false, startX: 0, startY: 0 };
  }, [volumeRubberSelection]);

  const executeVolumeMultiRename = useCallback(async rows => {
    const renameRows = rows.filter(row => row.status === 'ok' && row.oldName !== row.newName);
    if (renameRows.length === 0) return { success: false, successCount: 0, errors: [] };
    const rowByPath = new Map(renameRows.map(row => [row.path, row]));
    setFileList(prev => prev.map(item => ({
      ...item,
      volumes: (item.volumes || []).map(volume => {
        const renameFile = organizerVolumeRenameFile(item, volume, config);
        const row = rowByPath.get(renameFile.path);
        if (!row) return volume;
        const preserved = preserveOrganizerExtractedTitle(volume);
        const safeName = sanitizeOrganizerName(stripFilenameExtension(row.newName));
        return safeName ? { ...preserved, new_name: safeName } : preserved;
      }),
    })));
    clearVolumeSelection();
    showToast?.(t('msg_multi_rename_done', [renameRows.length]));
    return { success: true, successCount: renameRows.length, errors: [] };
  }, [clearVolumeSelection, config, showToast, t]);

  const handleContinueToRenamer = useCallback(() => {
    const paths = lastResult?.createdFiles || [];
    if (paths.length === 0 || lastResult?.cancelled) return;
    setLastResult(null);
    window.dispatchEvent(new CustomEvent('bookmanager:navigate', {
      detail: { tabId: 'renamer', paths },
    }));
  }, [lastResult]);

  useEffect(() => {
    const handleAppAction = (event) => {
      if (event.detail?.activeTab !== 'organizer') return;
      const action = event.detail?.action;
      if (action === 'cancel-current') {
        handleCancel();
        return;
      }
      if (isWorking) return;
      if (action === 'add-folder') handleSelectFolder();
      else if (action === 'add-file') handleSelectFiles();
      else if (action === 'drop-paths' || action === 'load-paths') analyzePaths(event.detail?.paths);
      else if (action === 'run-current') handleExecute();
      else if (action === 'remove-selected') handleRemoveChecked();
      else if (action === 'clear-all') handleClear();
      else if (action === 'toggle-all') handleToggleAllChecked();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [analyzePaths, handleCancel, handleExecute, handleRemoveChecked, handleSelectFiles, handleSelectFolder, handleToggleAllChecked, isWorking]);

  useEffect(() => {
    const handleKeyDown = event => {
      if (!isOrganizerTabVisible()) return;
      if (isWorking || showVolumeRenameDialog) return;
      if (!shouldHandleGlobalShortcut(event)) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        handleRemoveHighlighted();
      } else if (event.shiftKey && isShortcutKey(event, 'r') && selectedVolumeRows.length > 0) {
        event.preventDefault();
        setShowVolumeRenameDialog(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleRemoveHighlighted, isOrganizerTabVisible, isWorking, selectedVolumeRows.length, showVolumeRenameDialog]);

  return (
    <div className="organizer-tab" ref={tabRootRef}>
      <div className="org-local-toolbar">
        <button className="org-btn" onClick={handleToggleExpandAll} disabled={fileList.length === 0}>
          ↕ {t('org_expand_collapse_all')}
        </button>
        <button className="org-btn" onClick={handleBatchDefault} disabled={fileList.length === 0}>{t('batch_default')}</button>
        <button className="org-btn" onClick={handleBatchTitle} disabled={fileList.length === 0}>{t('batch_title')}</button>
        <button className="org-btn" onClick={() => setShowVolumeRenameDialog(true)} disabled={isWorking || selectedVolumeRows.length === 0}>
          <FaIcon name="fileSignature" /> {t('tf_menu_rename_multi')}
        </button>
        <div className="org-toolbar-spacer" />
      </div>

      <div className="org-content-area">
        {fileList.length === 0 ? (
          <div className="org-empty-state">
            <img src={emptyImage} alt="" className="org-empty-image" />
            <p className="org-empty-text">{t('drag_drop')}</p>
          </div>
        ) : (
          <div className="org-tree-container">
            <div className="org-tree-header">
              <div className="org-col-name">{t('col_org_name')}</div>
              <div className="org-col-path">{t('col_org_path')}</div>
              <div className="org-col-count">{t('col_org_count')}</div>
              <div className="org-col-size">{t('col_org_size')}</div>
            </div>

            <div
              ref={treeBodyRef}
              className="org-tree-body"
              tabIndex={0}
              onMouseDown={startVolumeRubberSelection}
              onMouseMove={volumeRubberSelection.update}
              onMouseLeave={() => {
                stopVolumeRubberSelection();
              }}
              onMouseUp={() => {
                stopVolumeRubberSelection();
              }}
            >
              {fileList.map((item) => (
                <div key={item.id} className={`org-tree-item-group ${selectedItemId === item.id ? 'selected' : ''}`}>
                  <div
                    className="org-tree-row org-root-row"
                    onClick={() => {
                      setSelectedItemId(item.id);
                      clearVolumeSelection();
                    }}
                  >
                    <div
                      className="org-col-name"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expandedItems.has(item.id)}
                      onClick={() => handleToggleExpand(item.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleToggleExpand(item.id);
                        }
                      }}
                    >
                      <span className="org-expand-icon">{expandedItems.has(item.id) ? '▼' : '▶'}</span>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => handleCheck(item.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span className="org-icon"><FaIcon name="cube" /></span>
                      <span className="org-title">{item.clean_title || item.name}</span>
                      <span className="org-original-name">({item.name})</span>
                    </div>
                    <div className="org-col-path org-path-widget">
                      <input
                        type="text"
                        className="org-path-input"
                        value={item.out_path || ''}
                        onChange={(event) => handleOutPathChange(item.id, event.target.value)}
                        onClick={event => event.stopPropagation()}
                      />
                      <div
                        className="org-row-menu-wrap org-folder-menu-wrap"
                        onMouseEnter={() => openFolderRowMenu(item.id)}
                        onMouseLeave={() => closeFolderRowMenu(item.id)}
                        onFocus={() => openFolderRowMenu(item.id)}
                        onClick={event => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`org-row-menu-button org-folder-menu-button ${openFolderMenuId === item.id ? 'active' : ''}`}
                          aria-haspopup="menu"
                          aria-expanded={openFolderMenuId === item.id}
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          {t('org_folder_menu')} <FaIcon name="angleDown" size={9} />
                        </button>
                        {openFolderMenuId === item.id && (
                          <div className="org-row-menu org-folder-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => handleFolderMenuAction(item, 'default')}>
                              {t('org_default_path')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleFolderMenuAction(item, 'title')}>
                              {t('org_title_path')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleFolderMenuAction(item, 'filename')}>
                              {t('org_filename_path')}
                            </button>
                          </div>
                        )}
                      </div>
                      <div
                        className="org-row-menu-wrap org-batch-menu-wrap"
                        onMouseEnter={() => openBatchRowMenu(item.id)}
                        onMouseLeave={() => closeBatchRowMenu(item.id)}
                        onFocus={() => openBatchRowMenu(item.id)}
                        onClick={event => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`org-row-menu-button org-batch-menu-button ${openBatchMenuId === item.id ? 'active' : ''}`}
                          aria-haspopup="menu"
                          aria-expanded={openBatchMenuId === item.id}
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          {t('org_batch_menu')} <FaIcon name="angleDown" size={9} />
                        </button>
                        {openBatchMenuId === item.id && (
                          <div className="org-row-menu org-batch-menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => handleBatchMenuAction(item.id, 'volume')}>
                              {t('org_batch_volume')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleBatchMenuAction(item.id, 'chapter')}>
                              {t('org_batch_chapter')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleBatchMenuAction(item.id, 'original')}>
                              {t('org_batch_original_name')}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleBatchMenuAction(item.id, 'extracted')}>
                              {t('org_batch_extracted_title')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="org-col-count">{item.volumes?.length || 0}</div>
                    <div className="org-col-size">{Number(item.size_mb || 0).toFixed(1)} MB</div>
                  </div>

                  {expandedItems.has(item.id) && item.volumes.map((volume) => {
                    const extension = targetExtension(volume, config?.target_format || 'none');
                    const volumeRow = organizerVolumeRenameFile(item, volume, config);
                    const volumeIndex = visibleVolumeRows.findIndex(row => row.path === volumeRow.path);
                    const isVolumeSelected = selectedVolumePaths.includes(volumeRow.path);
                    return (
                    <div
                      key={volume.id}
                      className={`org-tree-row org-child-row ${isVolumeSelected ? 'selected' : ''} ${activeVolumePath === volumeRow.path ? 'active-selection' : ''}`}
                      data-volume-path={volumeRow.path}
                      onMouseDown={event => handleVolumeRowMouseDown(volumeRow, event, volumeIndex)}
                    >
                      <div className="org-col-name org-child-name">
                        <span className="org-indent">↳</span>
                        <span className="org-icon"><FaIcon name="file-zipper" /></span>
                        <span className="org-volume-name">{volume.new_name}{extension}</span>
                        {volume.original_basename && <span className="org-original-name">({volume.original_basename})</span>}
                        {volume.spinoff_folder && <span className="org-spinoff">SPINOFF</span>}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ))}
                <div
                  ref={volumeSelectionBoxRef}
                  className="org-drag-selection-box"
                  style={{ display: 'none' }}
                />
            </div>
          </div>
        )}
      </div>

      <div className="org-progress-row" />

      <div className="org-bottom-info">
        {t('total_files', { count: fileList.length })} / {selectedCount} checked / {selectedVolumeRows.length} selected
      </div>
      {skippedFiles.length > 0 && (
        <div className="org-result-errors">
          {t('msg_failed')}
          {skippedFiles.map(file => <div key={file}>{file}</div>)}
        </div>
      )}
      {showVolumeRenameDialog && (
        <MultiRenameDialog
          files={selectedVolumeRows}
          exists={async () => false}
          onExecute={executeVolumeMultiRename}
          onClose={() => setShowVolumeRenameDialog(false)}
          t={t}
        />
      )}
      {lastResult && (
        <ResultLogDialog
          result={lastResult}
          outputPaths={lastResult.createdFiles}
          continueLabelKey="btn_continue_tab2"
          onClose={() => setLastResult(null)}
          onContinue={handleContinueToRenamer}
          t={t}
        />
      )}
    </div>
  );
}

export { OrganizerTab };
export default OrganizerTab;
