import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from './FaIcon';
import {
  folderNameRenamePattern,
  inferRenamePattern,
  normalPatternToRegex,
  normalReplacementToRegex,
  previewRename,
  regexPatternToNormal,
  regexReplacementToNormal,
  resolveRenamePreviewConflicts,
} from '../multiRenamePolicy';
import '../styles/MultiRenameDialog.css';

function basename(filePath = '') {
  return String(filePath || '').split(/[\\/]/).pop() || '';
}

function MultiRenameDialog({ files, onExecute, onClose, t, exists }) {
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
        exists || (targetPath => window.electronAPI?.exists?.(targetPath)),
      );
      if (previewGenerationRef.current !== generation) return;
      setRows(previews);
      setPreviewing(false);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [
    addSequence,
    caseSensitive,
    exists,
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

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.defaultPrevented || event.key !== 'Escape' || executing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [executing, onClose]);

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
            <span className="multi-rename-title-icon"><FaIcon name="tableCells" size={9} /></span>
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
          <button type="button" className="multi-rename-cancel" disabled={executing} onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

export { MultiRenameDialog };
export default MultiRenameDialog;
