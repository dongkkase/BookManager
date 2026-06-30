import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { ResultLogDialog } from '../components/ResultLogDialog';
import { filterExistingResultPaths } from '../resultLog';
import { createToolbarState, emitToolbarState } from '../toolbarState';
import { emitStatusState } from '../statusState';
import {
  archiveChangeBadges,
  clampStartNumber,
  moveRenamerEntry,
  normalizeRenamerBatchOptionsFromConfig,
  normalizeRenamerOptionsFromConfig,
  refreshRenamerItem,
  renamerOptionsEqual,
  serializeRenamerBatchOptions,
  serializeRenamerOptions,
  toggleRenamerEntryDelete,
} from '../renamerPolicy';
import '../styles/RenamerTab.css';
import { DRAG_DROP_IMAGES, selectRandomResource } from '../resourcePolicy';
import { shouldPlayCompletionSound } from '../completionSoundPolicy';
import { isTextEntryTarget } from '../interactionPolicy';
import { partitionSkippedFiles } from '../notificationPolicy';
import noImage from '../images/noimage.png';

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function replaceBasename(filePath, nextName) {
  const value = String(filePath || '');
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${value.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

function shouldHandleTableNavigation(event) {
  return !event?.defaultPrevented && !isTextEntryTarget(event?.target);
}

function scrollTableRowIntoView(container, row) {
  if (!container || !row) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const headerHeight = Math.ceil(container.querySelector('thead')?.getBoundingClientRect().height || 0) + 1;
  const rowTop = rowRect.top - containerRect.top + container.scrollTop;
  const rowBottom = rowRect.bottom - containerRect.top + container.scrollTop;
  const visibleTop = container.scrollTop + headerHeight;
  const visibleBottom = container.scrollTop + container.clientHeight;

  if (rowTop < visibleTop) {
    container.scrollTop = Math.max(0, rowTop - headerHeight);
    return;
  }
  if (rowBottom > visibleBottom) {
    container.scrollTop = Math.max(0, rowBottom - container.clientHeight);
  }
}

function RenamerTab({ config, saveConfig, t, showToast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bookmanager:tab-ready', { detail: { tabId: 'renamer' } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dragDropImage = useMemo(() => selectRandomResource(DRAG_DROP_IMAGES), []);
  const initialRenamerOptions = normalizeRenamerOptionsFromConfig(config);
  const initialRenamerBatchOptions = normalizeRenamerBatchOptionsFromConfig(config);
  const [fileList, setFileList] = useState([]);
  const executeLockRef = useRef(false);
  const applyingConfigRef = useRef(false);
  const lastAppliedConfigOptionsRef = useRef(null);
  const lastAppliedBatchOptionsRef = useRef(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState(null);
  const [patternIndex, setPatternIndex] = useState(initialRenamerOptions.patternIndex);
  const [customText, setCustomText] = useState(initialRenamerOptions.customText);
  const [keepName, setKeepName] = useState(initialRenamerOptions.keepName);
  const [startNum, setStartNum] = useState(initialRenamerOptions.startNum);
  const [renamerBatchOptions, setRenamerBatchOptions] = useState(initialRenamerBatchOptions);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [taskPhase, setTaskPhase] = useState('idle');
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [innerPreview, setInnerPreview] = useState('');
  const [previewError, setPreviewError] = useState({ cover: false, inner: false });
  const [skippedFiles, setSkippedFiles] = useState([]);
  const customInputRef = useRef(null);
  const dragEntryIndexRef = useRef(-1);
  const archiveTableRef = useRef(null);
  const innerTableRef = useRef(null);
  const archiveRowRefs = useRef(new Map());
  const entryRowRefs = useRef(new Map());
  const previewRequestRef = useRef({ cover: 0, inner: 0 });

  const patternLabels = useMemo(() => {
    const labels = t('patterns');
    return Array.isArray(labels) && labels.length > 0
      ? labels
      : ['001.jpg', 'Page_001.jpg', 'Title_001.jpg', 'Title_Page_001.jpg', 'Custom_001.jpg'];
  }, [t]);

  const currentRenamerOptions = useMemo(() => ({
    patternIndex,
    customText,
    keepName,
    startNum,
  }), [customText, keepName, patternIndex, startNum]);

  const renameOptions = useMemo(() => ({
    ...currentRenamerOptions,
    webpConversion: Boolean(config?.webp_conversion),
  }), [config?.webp_conversion, currentRenamerOptions]);

  useEffect(() => {
    const removeProgress = window.electronAPI?.onTaskProgress?.((data) => {
      if (data?.task?.startsWith('renamer:')) {
        setProgress(data.progress ?? 0);
        if (data.message) setStatusMessage(data.message);
      }
    });
    return () => {
      if (typeof removeProgress === 'function') removeProgress();
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => () => {
    previewRequestRef.current.cover += 1;
    previewRequestRef.current.inner += 1;
  }, []);

  useEffect(() => {
    setFileList(prev => prev.map(item => refreshRenamerItem(item, renameOptions)));
  }, [renameOptions]);

  useEffect(() => {
    if (patternIndex === 4 && !keepName) customInputRef.current?.focus();
  }, [keepName, patternIndex]);

  useEffect(() => {
    if (!config) return;
    const configOptions = normalizeRenamerOptionsFromConfig(config);
    if (renamerOptionsEqual(lastAppliedConfigOptionsRef.current, configOptions)) return;
    lastAppliedConfigOptionsRef.current = configOptions;
    if (renamerOptionsEqual(currentRenamerOptions, configOptions)) return;

    applyingConfigRef.current = true;
    setPatternIndex(configOptions.patternIndex);
    setCustomText(configOptions.customText);
    setKeepName(configOptions.keepName);
    setStartNum(configOptions.startNum);
  }, [
    config?.custom_text,
    config?.keep_internal_name,
    config?.rename_pattern_idx,
    config?.start_num,
    currentRenamerOptions,
  ]);

  useEffect(() => {
    if (!config) return;
    if (applyingConfigRef.current) {
      applyingConfigRef.current = false;
      return;
    }
    const configOptions = normalizeRenamerOptionsFromConfig(config);
    if (renamerOptionsEqual(currentRenamerOptions, configOptions)) return;

    saveConfig?.(serializeRenamerOptions(currentRenamerOptions));
  }, [config, currentRenamerOptions, saveConfig]);

  useEffect(() => {
    if (!config) return;
    const configBatchOptions = normalizeRenamerBatchOptionsFromConfig(config);
    const lastApplied = lastAppliedBatchOptionsRef.current;
    if (lastApplied
      && lastApplied.capOpt === configBatchOptions.capOpt
      && lastApplied.exifOpt === configBatchOptions.exifOpt) {
      return;
    }
    lastAppliedBatchOptionsRef.current = configBatchOptions;
    setRenamerBatchOptions(configBatchOptions);
  }, [
    config?.renamer_default_cap_opt,
    config?.renamer_default_exif_opt,
  ]);

  const activeArchive = useMemo(
    () => fileList.find(file => file.id === selectedArchiveId) || fileList[0] || null,
    [fileList, selectedArchiveId]
  );
  const activeEntries = activeArchive?.entries || [];
  const activeEntry = activeEntries.find(entry => entry.id === selectedEntryId) || activeEntries[0] || null;
  const coverEntry = useMemo(
    () => activeEntries.find(entry => basename(entry.oldName).toLowerCase().startsWith('cover')) || activeEntries[0] || null,
    [activeEntries]
  );
  const checkedCount = useMemo(() => fileList.filter(file => file.checked).length, [fileList]);
  const allChecked = fileList.length > 0 && fileList.every(file => file.checked);
  const imageQualityLabel = config?.img_quality ?? config?.jpg_quality ?? 100;

  useEffect(() => {
    emitToolbarState('renamer', createToolbarState(fileList));
  }, [fileList]);
  useEffect(() => {
    emitStatusState('renamer', {
      message: statusMessage,
      progress,
      phase: taskPhase,
      canRun: checkedCount > 0,
    });
  }, [checkedCount, progress, statusMessage, taskPhase]);
  const capAllChecked = fileList.length > 0 && fileList.every(file => file.capOpt);
  const exifAllChecked = fileList.length > 0 && fileList.every(file => file.exifOpt);

  const updateFile = (id, updater, refreshNames = true) => {
    setFileList(prev => prev.map(file => {
      if (file.id !== id) return file;
      const nextFile = updater(file);
      return refreshNames ? refreshRenamerItem(nextFile, renameOptions) : nextFile;
    }));
  };

  const loadPreview = useCallback(async (target, archive, entry) => {
    const requestId = (previewRequestRef.current[target] || 0) + 1;
    previewRequestRef.current[target] = requestId;
    const isCurrentRequest = () => previewRequestRef.current[target] === requestId;

    if (!archive?.filepath || !entry?.originalPath) {
      if (target === 'cover') setCoverPreview('');
      else setInnerPreview('');
      return;
    }
    setPreviewError(current => ({ ...current, [target]: false }));
    let result = null;
    try {
      result = await window.electronAPI?.extractArchiveImage?.(
        archive.filepath,
        entry.originalPath,
      );
    } catch {
      result = null;
    }
    if (!isCurrentRequest()) return;
    const dataUrl = result?.success ? result.dataUrl : '';
    if (target === 'cover') setCoverPreview(dataUrl);
    else setInnerPreview(dataUrl);
    if (!dataUrl) setPreviewError(current => ({ ...current, [target]: true }));
  }, []);

  useEffect(() => {
    setSelectedEntryId(current => activeEntries.some(entry => entry.id === current) ? current : activeEntries[0]?.id || null);
  }, [activeArchive?.id, activeEntries]);

  useEffect(() => {
    loadPreview('cover', activeArchive, coverEntry);
  }, [activeArchive?.filepath, coverEntry?.originalPath, loadPreview]);

  useEffect(() => {
    loadPreview('inner', activeArchive, activeEntry);
  }, [activeArchive?.filepath, activeEntry?.originalPath, loadPreview]);

  const analyzePaths = useCallback(async (paths) => {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (cleanPaths.length === 0) return;
    let cancelled = false;

    setIsWorking(true);
    setTaskPhase('analyzing');
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_loading_list'));

    try {
      const result = await window.electronAPI.analyzeRenamer(cleanPaths, {
        lang: config?.language || config?.lang || 'ko',
        maxAnalysisThreads: config?.max_threads || 2,
        ...renameOptions,
      });
      if (result?.cancelled) {
        cancelled = true;
        setStatusMessage(t('msg_cancelled'));
        return;
      }

      const nextItems = (result.items || []).map(item => refreshRenamerItem({
        ...item,
        capOpt: renamerBatchOptions.capOpt,
        exifOpt: renamerBatchOptions.exifOpt,
      }, renameOptions));
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, item]));
        for (const item of nextItems) {
          if (!byPath.has(item.filepath)) byPath.set(item.filepath, item);
        }
        return [...byPath.values()];
      });
      setSkippedFiles(prev => [...new Set([...prev, ...(result.skippedFiles || [])])]);
      if (nextItems[0]) setSelectedArchiveId(nextItems[0].id);
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_unsupported_format')}: ${result.skippedFiles.join(', ')}`);
        const skipped = partitionSkippedFiles(result.skippedFiles);
        if (skipped.nested.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_nested_archive')}${skipped.nested.join('\n')}`,
            language: config?.language || config?.lang || 'ko',
          });
        }
        if (skipped.unsupported.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_unsupported_format')}${skipped.unsupported.join('\n')}`,
            language: config?.language || config?.lang || 'ko',
          });
        }
      } else {
        setStatusMessage(t('msg_done'));
      }
    } catch (error) {
      showToast?.(`${t('msg_failed')}: ${error.message}`);
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(cancelled ? 0 : 100);
      setIsWorking(false);
      setTaskPhase('idle');
    }
  }, [config?.language, config?.lang, renameOptions, renamerBatchOptions, t]);

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
      detail: { tabId: 'renamer', isWorking },
    }));
    return () => window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'renamer', isWorking: false },
    }));
  }, [isWorking]);

  const toggleAllChecked = () => {
    const nextChecked = !allChecked;
    setFileList(prev => prev.map(file => ({ ...file, checked: nextChecked })));
  };

  const persistRenamerBatchOptions = useCallback((updates) => {
    const nextOptions = {
      ...renamerBatchOptions,
      ...updates,
    };
    setRenamerBatchOptions(nextOptions);
    try {
      Promise.resolve(saveConfig?.(serializeRenamerBatchOptions(nextOptions))).catch(error => {
        console.error('내부 파일명 변경 일괄 설정 저장 실패:', error);
      });
    } catch (error) {
      console.error('내부 파일명 변경 일괄 설정 저장 실패:', error);
    }
  }, [renamerBatchOptions, saveConfig]);

  const toggleAllCap = () => {
    const nextChecked = !capAllChecked;
    setFileList(prev => prev.map(file => ({ ...file, capOpt: nextChecked })));
    persistRenamerBatchOptions({ capOpt: nextChecked });
  };

  const toggleAllExif = () => {
    const nextChecked = !exifAllChecked;
    setFileList(prev => prev.map(file => ({ ...file, exifOpt: nextChecked })));
    persistRenamerBatchOptions({ exifOpt: nextChecked });
  };

  const handleMoveEntry = (archiveId, entryIndex, mode) => {
    updateFile(archiveId, file => {
      let targetIndex = entryIndex;
      if (mode === 'top') targetIndex = 0;
      if (mode === 'up') targetIndex = Math.max(0, entryIndex - 1);
      if (mode === 'down') targetIndex = Math.min(file.entries.length - 1, entryIndex + 1);
      if (mode === 'bottom') targetIndex = file.entries.length - 1;
      return { ...file, entries: moveRenamerEntry(file.entries, entryIndex, targetIndex) };
    });
  };

  const handleToggleEntryDelete = (archiveId, entryId) => {
    updateFile(archiveId, file => ({
      ...file,
      entries: toggleRenamerEntryDelete(file.entries, entryId),
    }));
  };

  const handleStartNumChange = (delta) => {
    setStartNum(prev => clampStartNumber(Number(prev || 0) + delta));
  };

  const handleClear = () => {
    previewRequestRef.current.cover += 1;
    previewRequestRef.current.inner += 1;
    setFileList([]);
    setSelectedArchiveId(null);
    setLastResult(null);
    setSelectedEntryId(null);
    setCoverPreview('');
    setInnerPreview('');
    setSkippedFiles([]);
    setStatusMessage(t('status_wait'));
    setProgress(0);
  };

  useEffect(() => {
    const handleReset = event => {
      if (event.detail?.tabs?.includes('renamer') && !isWorking) handleClear();
    };
    window.addEventListener('bookmanager:reset-task-tabs', handleReset);
    return () => window.removeEventListener('bookmanager:reset-task-tabs', handleReset);
  }, [isWorking, t]);

  const handleRemoveChecked = useCallback(() => {
    setFileList(prev => {
      const next = prev.filter(file => !file.checked);
      if (!next.some(file => file.id === selectedArchiveId)) {
        setSelectedArchiveId(next[0]?.id || null);
      }
      return next;
    });
  }, [selectedArchiveId]);

  const selectArchiveAtIndex = useCallback((index) => {
    if (fileList.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, fileList.length - 1));
    setSelectedArchiveId(fileList[clampedIndex]?.id || null);
  }, [fileList]);

  const selectEntryAtIndex = useCallback((index) => {
    if (activeEntries.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, activeEntries.length - 1));
    setSelectedEntryId(activeEntries[clampedIndex]?.id || null);
  }, [activeEntries]);

  const handleRemoveSelectedArchive = useCallback(() => {
    const targetArchiveId = selectedArchiveId || activeArchive?.id;
    if (!targetArchiveId) return;

    setFileList(prev => {
      const index = prev.findIndex(file => file.id === targetArchiveId);
      if (index < 0) return prev;
      const next = prev.filter(file => file.id !== targetArchiveId);
      const nextArchiveId = next[Math.min(index, next.length - 1)]?.id || null;
      setSelectedArchiveId(nextArchiveId);
      if (!nextArchiveId) setSelectedEntryId(null);
      return next;
    });
  }, [activeArchive?.id, selectedArchiveId]);

  const handleArchiveTableKeyDown = useCallback((event) => {
    if (isWorking || !shouldHandleTableNavigation(event)) return;

    const currentArchiveId = selectedArchiveId || activeArchive?.id;
    const currentIndex = fileList.findIndex(file => file.id === currentArchiveId);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectArchiveAtIndex(currentIndex < 0 ? 0 : currentIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectArchiveAtIndex(currentIndex < 0 ? 0 : currentIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      selectArchiveAtIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectArchiveAtIndex(fileList.length - 1);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat) {
      event.preventDefault();
      handleRemoveSelectedArchive();
    }
  }, [activeArchive?.id, fileList, handleRemoveSelectedArchive, isWorking, selectedArchiveId, selectArchiveAtIndex]);

  const handleInnerTableKeyDown = useCallback((event) => {
    if (isWorking || !shouldHandleTableNavigation(event)) return;

    const currentEntryId = selectedEntryId || activeEntry?.id;
    const currentIndex = activeEntries.findIndex(entry => entry.id === currentEntryId);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectEntryAtIndex(currentIndex < 0 ? 0 : currentIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectEntryAtIndex(currentIndex < 0 ? 0 : currentIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      selectEntryAtIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      selectEntryAtIndex(activeEntries.length - 1);
    }
  }, [activeEntries, activeEntry?.id, isWorking, selectedEntryId, selectEntryAtIndex]);

  const handleArchiveContextAction = useCallback(async (action) => {
    const archive = contextMenu?.archive;
    setContextMenu(null);
    if (!archive?.filepath) return;

    if (action === 'show') {
      const result = await window.electronAPI?.showInFolder?.(archive.filepath);
      if (result?.success === false) showToast?.(t('msg_path_open_fail', [result.message || '']));
      return;
    }

    if (action === 'rename') {
      if (!await window.electronAPI?.exists?.(archive.filepath)) {
        await window.electronAPI?.showMessage?.({
          type: 'warning',
          title: t('dlg_warn'),
          message: t('msg_file_not_exist'),
          language: config?.language || config?.lang || 'ko',
        });
        return;
      }
      const oldName = basename(archive.filepath);
      const nextName = window.prompt(t('msg_rename_desc'), oldName)?.trim();
      if (!nextName || nextName === oldName) return;
      const nextPath = replaceBasename(archive.filepath, nextName);
      if (await window.electronAPI?.exists?.(nextPath)) {
        await window.electronAPI?.showMessage?.({
          type: 'warning',
          title: t('msg_rename_title'),
          message: t('msg_rename_dup'),
          language: config?.language || config?.lang || 'ko',
        });
        return;
      }
      const result = await window.electronAPI?.renameFile?.(archive.filepath, nextPath);
      if (!result?.success) {
        const permission = ['EACCES', 'EPERM'].includes(result?.code);
        await window.electronAPI?.showMessage?.({
          type: 'error',
          title: t('dlg_err'),
          message: t('msg_err_rename_fail', [
            permission ? `${t('dlg_err')}: ${result?.message}` : result?.message || t('msg_reload_fail'),
          ]),
          language: config?.language || config?.lang || 'ko',
        });
        return;
      }
      setFileList(prev => prev.map(item => item.id === archive.id
        ? refreshRenamerItem({ ...item, id: nextPath, filepath: nextPath, name: nextName }, renameOptions)
        : item));
      setSelectedArchiveId(nextPath);
      showToast?.({ key: 'msg_rename_success' });
      return;
    }

    if (action === 'reload') {
      try {
        if (!await window.electronAPI?.exists?.(archive.filepath)) {
          showToast?.(t('msg_file_not_exist'));
          return;
        }
        const result = await window.electronAPI.analyzeRenamer([archive.filepath], {
          lang: config?.language || config?.lang || 'ko',
          maxAnalysisThreads: config?.max_threads || 2,
          ...renameOptions,
        });
        const reloaded = result.items?.[0];
        if (!reloaded) {
          showToast?.(result.skippedFiles?.length ? t('msg_reload_nested') : t('msg_reload_fail'));
          return;
        }
        const nextItem = refreshRenamerItem({
          ...reloaded,
          checked: archive.checked,
          capOpt: archive.capOpt,
          exifOpt: archive.exifOpt,
        }, renameOptions);
        setFileList(prev => prev.map(item => item.id === archive.id ? nextItem : item));
        setSelectedArchiveId(nextItem.id);
        showToast?.(t('msg_reload_success'));
      } catch (error) {
        showToast?.(`${t('msg_reload_fail')} ${error.message}`);
      }
    }
  }, [config?.language, config?.lang, contextMenu, renameOptions, showToast, t]);

  const handleExecute = async () => {
    if (executeLockRef.current) return;
    if (checkedCount === 0) {
      setStatusMessage(t('msg_no_targets'));
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('msg_no_targets'),
        language: config?.language || config?.lang || 'ko',
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
        detail: { tabs: ['organizer', 'metadata'] },
      }));
      const result = await window.electronAPI.executeRenamer(fileList, {
        lang: config?.language || config?.lang || 'ko',
        target_format: config?.target_format || 'none',
        backup_on: config?.backup_on || false,
        flattenFolders: config?.flatten_folders || false,
        webp_conversion: config?.webp_conversion || false,
        img_quality: config?.img_quality ?? config?.jpg_quality ?? 100,
        renamer_archive_compression: config?.renamer_archive_compression || 'auto',
        max_threads: config?.max_threads || 1,
        ...renameOptions,
      });
      const outputFiles = await filterExistingResultPaths(
        result.outputFiles,
        filePath => window.electronAPI?.exists?.(filePath),
      );
      setLastResult({ ...result, outputFiles });
      if (result.cancelled) {
        setStatusMessage(t('msg_cancelled'));
        return;
      }
      const previousSelectedPath = activeArchive?.filepath;
      if (outputFiles.length > 0) {
        const reloaded = await window.electronAPI.analyzeRenamer(outputFiles, {
          lang: config?.language || config?.lang || 'ko',
          maxAnalysisThreads: config?.max_threads || 2,
          ...renameOptions,
        });
        const reloadedItems = (reloaded.items || []).map(item => refreshRenamerItem(item, renameOptions));
        setFileList(reloadedItems);
        const mappedPath = result.pathMap?.[previousSelectedPath] || outputFiles[0];
        setSelectedArchiveId(
          reloadedItems.find(item => item.filepath === mappedPath)?.id
          || reloadedItems[0]?.id
          || null,
        );
      }
      const success = result.stats?.success?.length || 0;
      const skip = result.stats?.skip?.length || 0;
      const error = result.stats?.error?.length || 0;
      const completed = success + skip + error;
      const message = t('msg_job_done', [success, skip, error]);
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
        language: config?.language || config?.lang || 'ko',
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
    if (!['analyzing', 'executing'].includes(taskPhase)) return;
    setTaskPhase('cancelling');
    setStatusMessage(t('cancel_wait'));
    await window.electronAPI?.stopTask?.('renamer');
  }, [taskPhase, t]);

  const handleContinueToMetadata = useCallback(() => {
    const paths = lastResult?.outputFiles || [];
    if (paths.length === 0 || lastResult?.cancelled) return;
    setLastResult(null);
    window.dispatchEvent(new CustomEvent('bookmanager:navigate', {
      detail: { tabId: 'metadata', paths },
    }));
  }, [lastResult]);

  useEffect(() => {
    const handleAppAction = (event) => {
      if (event.detail?.activeTab !== 'renamer') return;
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
      else if (action === 'toggle-all') toggleAllChecked();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [analyzePaths, handleCancel, handleExecute, handleRemoveChecked, handleSelectFiles, handleSelectFolder, isWorking, toggleAllChecked]);

  useEffect(() => {
    if (!selectedArchiveId) return;
    scrollTableRowIntoView(archiveTableRef.current, archiveRowRefs.current.get(selectedArchiveId));
  }, [selectedArchiveId]);

  useEffect(() => {
    if (!activeEntry?.id) return;
    scrollTableRowIntoView(innerTableRef.current, entryRowRefs.current.get(activeEntry.id));
  }, [activeArchive?.id, activeEntry?.id]);

  return (
    <div className="renamer-tab">
      <div className="renamer-left-panel">
        <div className="renamer-preview-title">{t('cover_preview')}</div>
        <div className="renamer-preview-img-box">
          {coverPreview && !previewError.cover
            ? <img src={coverPreview} alt="" onError={() => setPreviewError(current => ({ ...current, cover: true }))} />
            : <img src={noImage} alt={activeArchive ? t('no_preview') : t('tf_empty_no_data')} className="renamer-no-image" />}
        </div>

        <div className="renamer-divider" />

        <div className="renamer-preview-title">{t('inner_preview')}</div>
        <div className="renamer-preview-img-box">
          {innerPreview && !previewError.inner
            ? <img src={innerPreview} alt="" onError={() => setPreviewError(current => ({ ...current, inner: true }))} />
            : <img src={noImage} alt={activeEntry ? t('no_image') : t('tf_empty_no_data')} className="renamer-no-image" />}
        </div>
      </div>

      <div className="renamer-right-panel">
        <div className="renamer-options-bar">
          <label className="renamer-label" htmlFor="renamer-pattern-select">{t('pattern_lbl')}</label>
          <select
            id="renamer-pattern-select"
            className="renamer-select"
            value={patternIndex}
            onChange={(event) => setPatternIndex(Number(event.target.value))}
            disabled={keepName}
          >
            {patternLabels.map((label, index) => (
              <option key={`${label}-${index}`} value={index}>{label}</option>
            ))}
          </select>

          <input
            ref={customInputRef}
            type="text"
            className="renamer-input-custom"
            placeholder={t('custom_pattern_placeholder')}
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={keepName || patternIndex !== 4}
          />

          <label className="renamer-label renamer-start-label" htmlFor="renamer-start-num">{t('tab2_start_num')}</label>
          <input
            id="renamer-start-num"
            type="number"
            className="renamer-input-num"
            value={startNum}
            min="0"
            max="999999"
            onChange={(event) => setStartNum(clampStartNumber(event.target.value))}
            disabled={keepName}
          />
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(-1)} disabled={keepName}>-</button>
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(1)} disabled={keepName}>+</button>

          <label className="renamer-checkbox-label renamer-keep-name">
            <input
              type="checkbox"
              checked={keepName}
              onChange={(event) => setKeepName(event.target.checked)}
            />
            {t('tab2_keep_name')}
          </label>
        </div>

        <div className="renamer-content-area">
          {fileList.length === 0 ? (
            <div className="renamer-empty-state">
              <img src={dragDropImage} alt="" className="renamer-empty-image" />
              <p className="renamer-empty-text">{t('drag_drop')}</p>
            </div>
          ) : (
            <div className="renamer-split-view">
              <div className="renamer-section">
                <div className="renamer-section-title">{t('target_lbl')}</div>
                <div className="renamer-target-actions">
                  <button className={`renamer-btn-toggle ${allChecked ? 'active' : ''}`} onClick={toggleAllChecked} disabled={fileList.length === 0}>
                    <FaIcon name="checkSquare" /> {t('toggle_all')}
                  </button>
                  <div className="renamer-spacer" />
                  <button className={`renamer-btn-toggle renamer-batch-toggle ${capAllChecked ? 'active' : ''}`} onClick={toggleAllCap} disabled={fileList.length === 0} title={t('tt_cap_opt')}>
                    <FaIcon name="checkSquare" /> {t('btn_cap_all')} ({imageQualityLabel}%)
                  </button>
                  <button className={`renamer-btn-toggle renamer-batch-toggle ${exifAllChecked ? 'active' : ''}`} onClick={toggleAllExif} disabled={fileList.length === 0} title={t('tt_exif_rem')}>
                    <FaIcon name="checkSquare" /> {t('btn_exif_all')}
                  </button>
                </div>
                <div
                  ref={archiveTableRef}
                  className="renamer-table-wrapper top-table"
                  tabIndex={0}
                  aria-label={t('target_lbl')}
                  onKeyDown={handleArchiveTableKeyDown}
                >
                  <table className="renamer-table">
                    <thead>
                      <tr>
                        <th style={{ width: '46%' }}>{t('col_name')}</th>
                        <th style={{ width: '12%' }}>{t('col_missing_pages')}</th>
                        <th style={{ width: '8%' }}>{t('col_page_count')}</th>
                        <th style={{ width: '10%' }}>{t('col_size')}</th>
                        <th style={{ width: '12%' }}>{t('col_cap_opt')}</th>
                        <th style={{ width: '12%' }}>{t('col_exif_rem')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileList.map((file) => {
                        const changeBadges = archiveChangeBadges(file, config);
                        const badgeTitle = changeBadges.map(badge => badge.label).join('+');
                        return (
                          <tr
                            key={file.id}
                            ref={node => {
                              if (node) archiveRowRefs.current.set(file.id, node);
                              else archiveRowRefs.current.delete(file.id);
                            }}
                            className={activeArchive?.id === file.id ? 'selected' : ''}
                            onClick={() => {
                              setSelectedArchiveId(file.id);
                              archiveTableRef.current?.focus({ preventScroll: true });
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedArchiveId(file.id);
                              archiveTableRef.current?.focus({ preventScroll: true });
                              setContextMenu({ x: event.clientX, y: event.clientY, archive: file });
                            }}
                          >
                            <td>
                              <div className="renamer-file-cell">
                                <input
                                  type="checkbox"
                                  checked={file.checked}
                                  aria-label={file.name}
                                  onFocus={() => setSelectedArchiveId(file.id)}
                                  onClick={event => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    updateFile(file.id, current => ({ ...current, checked: !current.checked }));
                                  }}
                                />
                                <span className="renamer-file-name" title={file.name}>{file.name}</span>
                                {changeBadges.length > 0 && (
                                  <span className="renamer-format-badges" title={badgeTitle} aria-label={badgeTitle}>
                                    {changeBadges.map(badge => (
                                      <span key={badge.key} className={`renamer-format-badge ${badge.key}`}>{badge.label}</span>
                                    ))}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="renamer-cell-center renamer-missing-pages" title={file.missingPages || ''}>{file.missingPages || ''}</td>
                            <td className="renamer-cell-center">{file.count}</td>
                            <td className="renamer-cell-center">{Number(file.sizeMb || 0).toFixed(1)} MB</td>
                            <td className="renamer-cell-center">
                              <input
                                type="checkbox"
                                checked={file.capOpt}
                                aria-label={`${file.name} ${t('col_cap_opt')}`}
                                onFocus={() => setSelectedArchiveId(file.id)}
                                onClick={event => event.stopPropagation()}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  updateFile(file.id, current => ({ ...current, capOpt: !current.capOpt }));
                                }}
                              />
                            </td>
                            <td className="renamer-cell-center">
                              <input
                                type="checkbox"
                                checked={file.exifOpt}
                                aria-label={`${file.name} ${t('col_exif_rem')}`}
                                onFocus={() => setSelectedArchiveId(file.id)}
                                onClick={event => event.stopPropagation()}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  updateFile(file.id, current => ({ ...current, exifOpt: !current.exifOpt }));
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="renamer-table-count">{t('total_files', { count: fileList.length })}</div>
              </div>

              <div className="renamer-section renamer-inner-section">
                <div className="renamer-section-title">{t('inner_lbl')}</div>
                <div
                  ref={innerTableRef}
                  className="renamer-table-wrapper bottom-table"
                  tabIndex={0}
                  aria-label={t('inner_lbl')}
                  onKeyDown={handleInnerTableKeyDown}
                >
                  <table className="renamer-table">
                    <thead>
                      <tr>
                        <th style={{ width: '7%' }}>{t('renamer.delete_entry')}</th>
                        <th style={{ width: '34%' }}>{t('tf_col_old_name')}</th>
                        <th style={{ width: '34%' }}>{t('tf_col_new_name')}</th>
                        <th style={{ width: '8%' }}>{t('col_size')}</th>
                        <th style={{ width: '17%' }}>{t('col_order')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeArchive ? activeArchive.entries.map((entry, index) => (
                        <tr
                          key={entry.id}
                          ref={node => {
                            if (node) entryRowRefs.current.set(entry.id, node);
                            else entryRowRefs.current.delete(entry.id);
                          }}
                          className={[
                            activeEntry?.id === entry.id ? 'selected' : '',
                            entry.deleteChecked ? 'marked-delete' : '',
                          ].filter(Boolean).join(' ')}
                          draggable
                          onClick={() => {
                            setSelectedEntryId(entry.id);
                            innerTableRef.current?.focus({ preventScroll: true });
                          }}
                          onDragStart={() => {
                            dragEntryIndexRef.current = index;
                          }}
                          onDragOver={event => event.preventDefault()}
                          onDrop={event => {
                            event.preventDefault();
                            const sourceIndex = dragEntryIndexRef.current;
                            dragEntryIndexRef.current = -1;
                            if (sourceIndex < 0 || sourceIndex === index) return;
                            updateFile(activeArchive.id, file => ({
                              ...file,
                              entries: moveRenamerEntry(file.entries, sourceIndex, index),
                            }));
                          }}
                        >
                          <td className="renamer-cell-center">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.deleteChecked)}
                              aria-label={t('renamer.delete_entry_label', [entry.oldName])}
                              onFocus={() => setSelectedEntryId(entry.id)}
                              onClick={event => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation();
                                handleToggleEntryDelete(activeArchive.id, entry.id);
                              }}
                            />
                          </td>
                          <td title={entry.originalPath}>{entry.oldName}</td>
                          <td>
                            <input
                              className="renamer-entry-input"
                              value={entry.newName}
                              disabled={Boolean(entry.deleteChecked)}
                              aria-label={`${entry.oldName} ${t('tf_col_new_name')}`}
                              onFocus={() => setSelectedEntryId(entry.id)}
                              onClick={event => event.stopPropagation()}
                              onChange={(event) => {
                                const nextName = event.target.value;
                                updateFile(activeArchive.id, file => ({
                                  ...file,
                                  entries: file.entries.map(current => current.id === entry.id ? { ...current, newName: nextName } : current),
                                }), false);
                              }}
                            />
                          </td>
                          <td className="renamer-cell-center">{Number(entry.size_kb || 0).toFixed(1)} KB</td>
                          <td className="renamer-cell-center">
                            <div className="renamer-order-btns">
                              <button type="button" aria-label={t('move_top')} onClick={() => handleMoveEntry(activeArchive.id, index, 'top')} disabled={index === 0}>
                                <FaIcon name="anglesUp" size={10} />
                              </button>
                              <button type="button" aria-label={t('move_up')} onClick={() => handleMoveEntry(activeArchive.id, index, 'up')} disabled={index === 0}>
                                <FaIcon name="angleUp" size={10} />
                              </button>
                              <button type="button" aria-label={t('move_down')} onClick={() => handleMoveEntry(activeArchive.id, index, 'down')} disabled={index === activeArchive.entries.length - 1}>
                                <FaIcon name="angleDown" size={10} />
                              </button>
                              <button type="button" aria-label={t('move_bottom')} onClick={() => handleMoveEntry(activeArchive.id, index, 'bottom')} disabled={index === activeArchive.entries.length - 1}>
                                <FaIcon name="anglesDown" size={10} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="5" className="renamer-empty-row">{t('t3_msg_sel')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
      {skippedFiles.length > 0 && (
        <div className="renamer-skip-log">
          {skippedFiles.map(item => <div key={item}>{item}</div>)}
        </div>
      )}
      {lastResult && (
        <ResultLogDialog
          result={lastResult}
          outputPaths={lastResult.outputFiles}
          continueLabelKey="btn_continue_tab3"
          onClose={() => setLastResult(null)}
          onContinue={handleContinueToMetadata}
          t={t}
        />
      )}
      {contextMenu && (
        <div
          className="renamer-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={event => event.stopPropagation()}
        >
          <button onClick={() => handleArchiveContextAction('show')}>{t('action_find_path')}</button>
          <button onClick={() => handleArchiveContextAction('rename')}>{t('action_rename_file')}</button>
          <button onClick={() => handleArchiveContextAction('reload')}>{t('action_reload_file')}</button>
        </div>
      )}
    </div>
  );
}

export { RenamerTab };
export default RenamerTab;
