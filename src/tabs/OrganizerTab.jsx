import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/OrganizerTab.css';
import dragDropImage from '../images/draganddrop1.png';

const ARCHIVE_FILTERS = [
  { name: 'Archives', extensions: ['zip', 'cbz', 'cbr', '7z', 'rar'] },
];

function OrganizerTab({ config, t }) {
  const [fileList, setFileList] = useState([]);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);

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

  const analyzePaths = useCallback(async (paths) => {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (cleanPaths.length === 0) return;

    setIsWorking(true);
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
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  }, [config?.language, config?.lang, t]);

  const handleSelectFiles = useCallback(async () => {
    const paths = await window.electronAPI.selectFiles(t('add_file'), ARCHIVE_FILTERS);
    await analyzePaths(paths);
  }, [analyzePaths, t]);

  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder(t('add_folder'));
    if (folderPath) await analyzePaths([folderPath]);
  }, [analyzePaths, t]);

  const handleDrop = useCallback(async (event) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files || [])
      .map(file => file.path)
      .filter(Boolean);
    await analyzePaths(paths);
  }, [analyzePaths]);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
  }, []);

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
      return;
    }

    setIsWorking(true);
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
      setLastResult(result);
      const success = result.stats?.success?.length || 0;
      const errors = result.stats?.error?.length || 0;
      setStatusMessage(t('msg_job_done', [success, result.stats?.skip?.length || 0, errors]));
      if (config?.play_sound !== false) {
        window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav');
      }
    } catch (error) {
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  };

  useEffect(() => {
    const handleAppAction = (event) => {
      const action = event.detail?.action;
      if (isWorking) return;
      if (action === 'add-folder') handleSelectFolder();
      else if (action === 'add-file') handleSelectFiles();
      else if (action === 'remove-selected') handleRemoveChecked();
      else if (action === 'clear-all') handleClear();
      else if (action === 'toggle-all') handleToggleAllChecked();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [handleRemoveChecked, handleSelectFiles, handleSelectFolder, handleToggleAllChecked, isWorking]);

  return (
    <div className="organizer-tab" onDrop={handleDrop} onDragOver={handleDragOver}>
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
        <button className="org-btn org-run-btn" onClick={handleExecute} disabled={isWorking || selectedCount === 0}>{t('run_btn')}</button>
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

      <div className="org-progress-row">
        <div className="org-progress-track"><div className="org-progress-fill" style={{ width: `${progress}%` }} /></div>
        <span>{statusMessage}</span>
      </div>

      {lastResult?.stats?.error?.length > 0 && (
        <div className="org-result-errors">
          {lastResult.stats.error.slice(0, 5).map(error => <div key={error}>{error}</div>)}
        </div>
      )}

      <div className="org-bottom-info">
        {t('organizer.total_files', { count: fileList.length })} / {selectedCount} checked
      </div>
    </div>
  );
}

export { OrganizerTab };
export default OrganizerTab;
