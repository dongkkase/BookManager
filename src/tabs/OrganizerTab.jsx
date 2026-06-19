import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { ResultLogDialog } from '../components/ResultLogDialog';
import { filterExistingResultPaths } from '../resultLog';
import { createToolbarState, emitToolbarState } from '../toolbarState';
import { emitStatusState } from '../statusState';
import '../styles/OrganizerTab.css';
import dragDropImage from '../images/draganddrop1.png';

function OrganizerTab({ config, t, showToast }) {
  const [fileList, setFileList] = useState([]);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [taskPhase, setTaskPhase] = useState('idle');

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

    try {
      const result = await window.electronAPI.analyzeOrganizer(cleanPaths, {
        lang: config?.language || config?.lang || 'ko',
      });
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, item]));
        for (const item of result.items || []) {
          byPath.set(item.filepath, item);
        }
        return [...byPath.values()];
      });
      setExpandedItems(prev => {
        const next = new Set(prev);
        for (const item of result.items || []) next.add(item.id);
        return next;
      });
      setIsAllExpanded(true);
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_unsupported_format')} ${result.skippedFiles.join(', ')}`);
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
  }, [config?.language, config?.lang, t]);

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

  const handleVolumeNameChange = (itemId, volumeId, newName) => {
    updateItem(itemId, item => ({
      ...item,
      volumes: item.volumes.map(volume => volume.id === volumeId ? { ...volume, new_name: newName } : volume),
    }));
  };

  const handleBatchDefault = () => {
    setFileList(prev => prev.map(item => ({
      ...item,
      out_path: item.filepath.replace(/[\\/][^\\/]+$/, ''),
    })));
  };

  const handleBatchTitle = () => {
    setFileList(prev => prev.map(item => ({
      ...item,
      out_path: `${item.filepath.replace(/[\\/][^\\/]+$/, '')}/${item.clean_title || item.name.replace(/\.[^.]+$/, '')}`,
    })));
  };

  const handleClear = () => {
    setFileList([]);
    setExpandedItems(new Set());
    setLastResult(null);
    setStatusMessage(t('status_wait'));
    setProgress(0);
  };

  const handleRemoveChecked = useCallback(() => {
    setFileList(prev => prev.filter(item => !item.checked));
  }, []);

  const handleToggleAllChecked = useCallback(() => {
    setFileList(prev => {
      const allChecked = prev.length > 0 && prev.every(item => item.checked);
      return prev.map(item => ({ ...item, checked: !allChecked }));
    });
  }, []);

  const handleExecute = async () => {
    if (selectedCount === 0) {
      setStatusMessage(t('msg_no_targets'));
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('msg_no_targets'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }

    setIsWorking(true);
    setTaskPhase('executing');
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_processing_overlay'));

    try {
      const result = await window.electronAPI.executeOrganizer(fileList, {
        lang: config?.language || config?.lang || 'ko',
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
      const message = t('msg_job_done', [success, result.stats?.skip?.length || 0, errors]);
      setStatusMessage(message);
      showToast?.(message);
      if (config?.play_sound !== false) {
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

  return (
    <div className="organizer-tab">
      <div className="org-local-toolbar">
        <button className="org-btn" onClick={handleSelectFolder} disabled={isWorking}><FaIcon name="folder" /> {t('add_folder')}</button>
        <button className="org-btn" onClick={handleSelectFiles} disabled={isWorking}><FaIcon name="file" /> {t('add_file')}</button>
        <button className="org-btn" onClick={handleToggleExpandAll} disabled={fileList.length === 0}>
          ↕ {t('organizer.expand_all')}
        </button>
        <button className="org-btn" onClick={handleBatchDefault} disabled={fileList.length === 0}>{t('batch_default')}</button>
        <button className="org-btn" onClick={handleBatchTitle} disabled={fileList.length === 0}>{t('batch_title')}</button>
        <button className="org-btn" onClick={handleClear} disabled={isWorking || fileList.length === 0}><FaIcon name="trash" /> {t('clear_all')}</button>
        <div className="org-toolbar-spacer" />
      </div>

      <div className="org-content-area">
        {fileList.length === 0 ? (
          <div className="org-empty-state">
            <img src={dragDropImage} alt="" className="org-empty-image" />
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

            <div className="org-tree-body">
              {fileList.map((item) => (
                <div key={item.id} className="org-tree-item-group">
                  <div className="org-tree-row org-root-row">
                    <div className="org-col-name" onClick={() => handleToggleExpand(item.id)}>
                      <span className="org-expand-icon">{expandedItems.has(item.id) ? '▼' : '▶'}</span>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => handleCheck(item.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span className="org-icon"><FaIcon name="archive" /></span>
                      <span className="org-title">{item.clean_title || item.name}</span>
                      <span className="org-original-name">({item.name})</span>
                    </div>
                    <div className="org-col-path org-path-widget">
                      <input
                        type="text"
                        className="org-path-input"
                        value={item.out_path || ''}
                        onChange={(event) => handleOutPathChange(item.id, event.target.value)}
                      />
                    </div>
                    <div className="org-col-count">{item.volumes?.length || 0}</div>
                    <div className="org-col-size">{Number(item.size_mb || 0).toFixed(1)} MB</div>
                  </div>

                  {expandedItems.has(item.id) && item.volumes.map((volume) => (
                    <div key={volume.id} className="org-tree-row org-child-row">
                      <div className="org-col-name org-child-name">
                        <span className="org-indent">↳</span>
                        <span className="org-icon"><FaIcon name={volume.type === 'archive' ? 'archive' : 'folder'} /></span>
                        <input
                          type="text"
                          className="org-volume-input"
                          value={volume.new_name}
                          onChange={(event) => handleVolumeNameChange(item.id, volume.id, event.target.value)}
                        />
                        <span className="org-original-name">({volume.original_basename}, {volume.image_count}p)</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="org-progress-row" />

      <div className="org-bottom-info">
        {t('organizer.total_files', { count: fileList.length })} / {selectedCount} checked
      </div>
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
