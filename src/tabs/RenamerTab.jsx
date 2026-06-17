import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/RenamerTab.css';
import dragDropImage from '../images/draganddrop1.png';

const ARCHIVE_FILTERS = [
  { name: 'Archives', extensions: ['zip', 'cbz', 'cbr', '7z', 'rar'] },
];

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function stem(filePath) {
  const name = basename(filePath);
  return name.replace(/\.[^.]+$/, '');
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[._\-\s]+/, '')
    .trim() || 'Page';
}

function padFor(totalCount) {
  if (totalCount < 100) return 2;
  if (totalCount < 1000) return 3;
  return 4;
}

function generateEntryName(entry, index, totalCount, options) {
  const originalName = entry.oldName || basename(entry.originalPath);
  const ext = (originalName.match(/\.[^.]+$/)?.[0]) || '.jpg';
  if (options.keepName) return originalName;

  const n = Number(options.startNum || 0) + index;
  const padded = String(n).padStart(padFor(totalCount), '0');
  const archiveStem = safeName(options.archiveStem);
  const customText = safeName(options.customText || 'Custom');

  if (options.patternIndex === 1) return index === 0 ? `Cover${ext}` : `Page_${padded}${ext}`;
  if (options.patternIndex === 2) return `${archiveStem}_${padded}${ext}`;
  if (options.patternIndex === 3) return index === 0 ? `${archiveStem}_Cover${ext}` : `${archiveStem}_Page_${padded}${ext}`;
  if (options.patternIndex === 4) return `${customText}_${padded}${ext}`;
  return `${padded}${ext}`;
}

function refreshItemNames(item, options) {
  const archiveStem = stem(item.filepath || item.name);
  const entries = (item.entries || []).map((entry, index, source) => ({
    ...entry,
    newName: generateEntryName(entry, index, source.length, { ...options, archiveStem }),
  }));
  return { ...item, entries, count: entries.length };
}

function RenamerTab({ config, t }) {
  const [fileList, setFileList] = useState([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState(null);
  const [patternIndex, setPatternIndex] = useState(Number(config?.rename_pattern_idx || 0));
  const [customText, setCustomText] = useState(config?.custom_text || '');
  const [keepName, setKeepName] = useState(Boolean(config?.keep_internal_name || false));
  const [startNum, setStartNum] = useState(Number(config?.start_num || 0));
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const patternLabels = useMemo(() => {
    const labels = t('patterns');
    return Array.isArray(labels) && labels.length > 0
      ? labels
      : ['001.jpg', 'Page_001.jpg', 'Title_001.jpg', 'Title_Page_001.jpg', 'Custom_001.jpg'];
  }, [t]);

  const renameOptions = useMemo(() => ({
    patternIndex,
    customText,
    keepName,
    startNum,
  }), [patternIndex, customText, keepName, startNum]);

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
    setFileList(prev => prev.map(item => refreshItemNames(item, renameOptions)));
  }, [renameOptions]);

  const activeArchive = useMemo(
    () => fileList.find(file => file.id === selectedArchiveId) || fileList[0] || null,
    [fileList, selectedArchiveId]
  );
  const activeEntries = activeArchive?.entries || [];
  const checkedCount = useMemo(() => fileList.filter(file => file.checked).length, [fileList]);
  const allChecked = fileList.length > 0 && fileList.every(file => file.checked);
  const capAllChecked = fileList.length > 0 && fileList.every(file => file.capOpt);
  const exifAllChecked = fileList.length > 0 && fileList.every(file => file.exifOpt);

  const updateFile = (id, updater, refreshNames = true) => {
    setFileList(prev => prev.map(file => {
      if (file.id !== id) return file;
      const nextFile = updater(file);
      return refreshNames ? refreshItemNames(nextFile, renameOptions) : nextFile;
    }));
  };

  const analyzePaths = useCallback(async (paths) => {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (cleanPaths.length === 0) return;

    setIsWorking(true);
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_loading_list'));

    try {
      const result = await window.electronAPI.analyzeRenamer(cleanPaths, {
        lang: config?.language || config?.lang || 'ko',
        ...renameOptions,
      });

      const nextItems = (result.items || []).map(item => refreshItemNames(item, renameOptions));
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, item]));
        for (const item of nextItems) byPath.set(item.filepath, item);
        return [...byPath.values()];
      });
      if (nextItems[0]) setSelectedArchiveId(nextItems[0].id);
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_unsupported_format')}: ${result.skippedFiles.join(', ')}`);
      } else {
        setStatusMessage(t('msg_done'));
      }
    } catch (error) {
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  }, [config?.language, config?.lang, renameOptions, t]);

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

  const toggleAllChecked = () => {
    const nextChecked = !allChecked;
    setFileList(prev => prev.map(file => ({ ...file, checked: nextChecked })));
  };

  const toggleAllCap = () => {
    const nextChecked = !capAllChecked;
    setFileList(prev => prev.map(file => ({ ...file, capOpt: nextChecked })));
  };

  const toggleAllExif = () => {
    const nextChecked = !exifAllChecked;
    setFileList(prev => prev.map(file => ({ ...file, exifOpt: nextChecked })));
  };

  const handleMoveEntry = (archiveId, entryIndex, mode) => {
    updateFile(archiveId, file => {
      const entries = [...(file.entries || [])];
      const [entry] = entries.splice(entryIndex, 1);
      let targetIndex = entryIndex;
      if (mode === 'top') targetIndex = 0;
      if (mode === 'up') targetIndex = Math.max(0, entryIndex - 1);
      if (mode === 'down') targetIndex = Math.min(entries.length, entryIndex + 1);
      if (mode === 'bottom') targetIndex = entries.length;
      entries.splice(targetIndex, 0, entry);
      return { ...file, entries };
    });
  };

  const handleStartNumChange = (delta) => {
    setStartNum(prev => Math.max(0, Number(prev || 0) + delta));
  };

  const handleClear = () => {
    setFileList([]);
    setSelectedArchiveId(null);
    setLastResult(null);
    setStatusMessage(t('status_wait'));
    setProgress(0);
  };

  const handleExecute = async () => {
    if (checkedCount === 0) {
      setStatusMessage(t('msg_no_targets'));
      return;
    }

    setIsWorking(true);
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_processing_overlay'));

    try {
      const result = await window.electronAPI.executeRenamer(fileList, {
        lang: config?.language || config?.lang || 'ko',
        target_format: config?.target_format || 'none',
        backup_on: config?.backup_on || false,
        flattenFolders: config?.flatten_folders || false,
        ...renameOptions,
      });
      setLastResult(result);
      const success = result.stats?.success?.length || 0;
      const skip = result.stats?.skip?.length || 0;
      const error = result.stats?.error?.length || 0;
      setStatusMessage(t('msg_job_done', [success, skip, error]));
    } catch (error) {
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  };

  return (
    <div className="renamer-tab" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="renamer-left-panel">
        <div className="renamer-preview-title">{t('cover_preview')}</div>
        <div className="renamer-preview-img-box">
          <span className="renamer-no-image">{activeEntries[0]?.oldName || t('tf_empty_no_data')}</span>
        </div>

        <div className="renamer-divider" />

        <div className="renamer-preview-title">{t('inner_preview')}</div>
        <div className="renamer-preview-img-box">
          <span className="renamer-no-image">{activeEntries[1]?.oldName || activeEntries[0]?.newName || t('tf_empty_no_data')}</span>
        </div>
      </div>

      <div className="renamer-right-panel">
        <div className="renamer-local-toolbar">
          <button className="renamer-btn-toggle" onClick={handleSelectFolder} disabled={isWorking}><FaIcon name="folder" /> {t('add_folder')}</button>
          <button className="renamer-btn-toggle" onClick={handleSelectFiles} disabled={isWorking}><FaIcon name="file" /> {t('add_file')}</button>
          <button className="renamer-btn-toggle" onClick={handleClear} disabled={isWorking || fileList.length === 0}><FaIcon name="trash" /> {t('clear_all')}</button>
          <div className="renamer-spacer" />
          <button className="renamer-btn-toggle renamer-run-btn" onClick={handleExecute} disabled={isWorking || checkedCount === 0}>{t('run_btn')}</button>
        </div>

        <div className="renamer-options-bar">
          <button className={`renamer-btn-toggle ${allChecked ? 'active' : ''}`} onClick={toggleAllChecked} disabled={fileList.length === 0}>
            <FaIcon name="checkSquare" /> {t('toggle_all')}
          </button>
          <button className={`renamer-btn-toggle ${capAllChecked ? 'active' : ''}`} onClick={toggleAllCap} disabled={fileList.length === 0} title={t('tt_cap_opt')}>
            <FaIcon name="checkSquare" /> {t('btn_cap_all')} ({config?.quality || 85}%)
          </button>
          <button className={`renamer-btn-toggle ${exifAllChecked ? 'active' : ''}`} onClick={toggleAllExif} disabled={fileList.length === 0} title={t('tt_exif_rem')}>
            <FaIcon name="checkSquare" /> {t('btn_exif_all')}
          </button>

          <div className="renamer-spacer" />

          <label className="renamer-label">{t('tf_rename_mode')}:</label>
          <select
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
            type="text"
            className="renamer-input-custom"
            placeholder="Custom"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={keepName || patternIndex !== 4}
          />

          <label className="renamer-checkbox-label">
            <input
              type="checkbox"
              checked={keepName}
              onChange={(event) => setKeepName(event.target.checked)}
            />
            {t('tab2_keep_name')}
          </label>

          <label className="renamer-label">{t('tab2_start_num')}</label>
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(-1)} disabled={keepName}>-</button>
          <input
            type="number"
            className="renamer-input-num"
            value={startNum}
            onChange={(event) => setStartNum(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
            disabled={keepName}
          />
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(1)} disabled={keepName}>+</button>
        </div>

        <div className="renamer-content-area">
          {fileList.length === 0 ? (
            <div className="renamer-empty-state">
              <img src={dragDropImage} alt="" className="renamer-empty-image" />
              <p className="renamer-empty-text">{t('drag_drop')}</p>
            </div>
          ) : (
            <div className="renamer-split-view">
              <div className="renamer-table-wrapper top-table">
                <table className="renamer-table">
                  <thead>
                    <tr>
                      <th style={{ width: '44%' }}>{t('col_name')}</th>
                      <th style={{ width: '12%' }}>{t('col_page_count')}</th>
                      <th style={{ width: '14%' }}>{t('col_size')}</th>
                      <th style={{ width: '15%' }}>{t('col_cap_opt')}</th>
                      <th style={{ width: '15%' }}>{t('col_exif_rem')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileList.map((file) => (
                      <tr
                        key={file.id}
                        className={activeArchive?.id === file.id ? 'selected' : ''}
                        onClick={() => setSelectedArchiveId(file.id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={file.checked}
                            onChange={(event) => {
                              event.stopPropagation();
                              updateFile(file.id, current => ({ ...current, checked: !current.checked }));
                            }}
                          />
                          <span className="renamer-file-name">{file.name}</span>
                        </td>
                        <td className="renamer-cell-center">{file.count}</td>
                        <td className="renamer-cell-right">{Number(file.sizeMb || 0).toFixed(1)} MB</td>
                        <td className="renamer-cell-center">
                          <input
                            type="checkbox"
                            checked={file.capOpt}
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
                            onChange={(event) => {
                              event.stopPropagation();
                              updateFile(file.id, current => ({ ...current, exifOpt: !current.exifOpt }));
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="renamer-table-wrapper bottom-table">
                <table className="renamer-table">
                  <thead>
                    <tr>
                      <th style={{ width: '35%' }}>{t('tf_col_old_name')}</th>
                      <th style={{ width: '35%' }}>{t('tf_col_new_name')}</th>
                      <th style={{ width: '15%' }}>{t('col_size')}</th>
                      <th style={{ width: '15%' }}>{t('col_order')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeArchive ? activeArchive.entries.map((entry, index) => (
                      <tr key={entry.id}>
                        <td title={entry.originalPath}>{entry.oldName}</td>
                        <td>
                          <input
                            className="renamer-entry-input"
                            value={entry.newName}
                            onChange={(event) => {
                              const nextName = event.target.value;
                              updateFile(activeArchive.id, file => ({
                                ...file,
                                entries: file.entries.map(current => current.id === entry.id ? { ...current, newName: nextName } : current),
                              }), false);
                            }}
                          />
                        </td>
                        <td className="renamer-cell-right">{Number(entry.size_kb || 0).toFixed(1)} KB</td>
                        <td className="renamer-cell-center">
                          <div className="renamer-order-btns">
                            <button onClick={() => handleMoveEntry(activeArchive.id, index, 'top')} disabled={index === 0}>⇈</button>
                            <button onClick={() => handleMoveEntry(activeArchive.id, index, 'up')} disabled={index === 0}>↑</button>
                            <button onClick={() => handleMoveEntry(activeArchive.id, index, 'down')} disabled={index === activeArchive.entries.length - 1}>↓</button>
                            <button onClick={() => handleMoveEntry(activeArchive.id, index, 'bottom')} disabled={index === activeArchive.entries.length - 1}>⇊</button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="4" className="renamer-empty-row">{t('t3_msg_sel')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="renamer-bottom-info">
          <div>
            {t('total_files', { count: fileList.length })} / {checkedCount} checked
            {lastResult?.stats?.error?.length ? <span className="renamer-error-text"> · {lastResult.stats.error.join(' / ')}</span> : null}
          </div>
          <div className="renamer-progress-wrap">
            <span>{statusMessage}</span>
            <progress value={progress} max="100" />
          </div>
        </div>
      </div>
    </div>
  );
}

export { RenamerTab };
export default RenamerTab;
