import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import '../../styles/CoverEditorDialog.css';

export function CoverEditorDialog({ file, files, onExecute, onClose, t }) {
    const targets = (files?.length ? files : [file]).filter(Boolean);
    const fileKey = JSON.stringify(targets.map(target => target.full_path || target.path));
    const isBatch = targets.length > 1;
    const [entries, setEntries] = useState([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [inspectedCount, setInspectedCount] = useState(0);
    const [currentCover, setCurrentCover] = useState({ filePath: '', dataUrl: '' });
    const [coverLoading, setCoverLoading] = useState(false);
    const [coverError, setCoverError] = useState('');
    const [image, setImage] = useState(null);
    const [mode, setMode] = useState('replace');
    const [renumber, setRenumber] = useState(false);
    const [backup, setBackup] = useState(true);
    const [loading, setLoading] = useState(true);
    const [imageLoading, setImageLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [progress, setProgress] = useState(null);
    const [fileResults, setFileResults] = useState({});
    const [cancelRequested, setCancelRequested] = useState(false);
    const dialogRef = useRef(null);
    const imageRequestRef = useRef(0);
    const coverRequestRef = useRef(0);
    const selectedPathRef = useRef('');
    const mountedRef = useRef(true);
    const savingRef = useRef(false);
    const cancelRef = useRef(false);
    const completedResultsRef = useRef({});
    const busy = loading || imageLoading || saving;
    const titleId = React.useId();
    const selectedEntry = entries[selectedIndex];
    const info = selectedEntry?.info && {
        ...selectedEntry.info,
        coverDataUrl: currentCover.filePath === selectedEntry.filePath ? currentCover.dataUrl : '',
    };
    const filePath = selectedEntry?.filePath || targets[0]?.full_path || targets[0]?.path || '';
    const readyEntries = entries.filter(entry => entry.info);
    const canAdd = readyEntries.length > 0 && readyEntries.every(entry => entry.info.canAdd);
    const canRenumber = readyEntries.some(entry => entry.info.canRenumber);
    const canBackup = readyEntries.some(entry => entry.info.storage === 'file' && !entry.info.conversion);
    const inspectionFailureCount = entries.filter(entry => entry.error).length;
    const storageText = value => t(value.conversion ? 'cover_editor_conversion'
        : `cover_editor_storage_${value.kind === 'audio' && value.storage === 'database' ? 'audio_local' : value.kind}`);
    const resultError = value => value?.code === 'COVER_SOURCE_CHANGED'
        ? t('cover_editor_source_changed') : value?.code === 'IMAGE_SOURCE_CHANGED'
            ? t('cover_editor_image_changed') : value?.code === 'COVER_VIEWER_OPEN'
                ? t('cover_editor_viewer_open') : value?.error || t('cover_editor_failed');

    useEffect(() => {
        let cancelled = false;
        mountedRef.current = true;
        const previousFocus = document.activeElement;
        const keepFocusInside = event => {
            const dialog = dialogRef.current;
            if (dialog && !dialog.contains(event.target)) {
                event.stopPropagation();
                dialog.focus();
            }
        };
        document.addEventListener('focusin', keepFocusInside, true);
        dialogRef.current?.focus();
        const load = async () => {
            const nextEntries = targets.map(target => ({
                filePath: target.full_path || target.path,
                name: target.name || target.full_path || target.path,
                info: null,
                error: '',
            }));
            setEntries(nextEntries);
            setSelectedIndex(0);
            selectedPathRef.current = nextEntries[0]?.filePath || '';
            setCurrentCover({ filePath: '', dataUrl: '' });
            setCoverError('');
            setInspectedCount(0);
            setLoading(true);
            setMode('replace');
            setRenumber(false);
            for (let index = 0; index < nextEntries.length; index += 1) {
                if (cancelled) return;
                try {
                    const value = await window.electronAPI.inspectCoverEditor(nextEntries[index].filePath);
                    if (cancelled) return;
                    if (!value || value.error) throw new Error(value?.error || t('cover_editor_failed'));
                    nextEntries[index] = { ...nextEntries[index], info: { ...value, coverDataUrl: '' } };
                    if (selectedPathRef.current === nextEntries[index].filePath) {
                        setCurrentCover({ filePath: nextEntries[index].filePath, dataUrl: value.coverDataUrl || '' });
                    }
                    if (!isBatch) {
                        setMode(value.canAdd && !value.coverDataUrl ? 'add' : 'replace');
                        setRenumber(value.canRenumber && !value.coverDataUrl);
                    }
                } catch (error) {
                    if (cancelled) return;
                    nextEntries[index] = { ...nextEntries[index], error: error.message };
                    if (!isBatch) setError(error.message);
                }
                setEntries([...nextEntries]);
                setInspectedCount(index + 1);
            }
            if (!cancelled) setLoading(false);
        };
        void load();
        return () => {
            cancelled = true;
            mountedRef.current = false;
            imageRequestRef.current += 1;
            coverRequestRef.current += 1;
            document.removeEventListener('focusin', keepFocusInside, true);
            previousFocus?.focus?.();
        };
    }, [fileKey]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    }, [saving, result]);

    const selectEntry = async (entry, index) => {
        const requestId = ++coverRequestRef.current;
        selectedPathRef.current = entry.filePath;
        setSelectedIndex(index);
        setCurrentCover({ filePath: entry.filePath, dataUrl: '' });
        setCoverError('');
        setCoverLoading(Boolean(entry.info));
        if (!entry.info) return;
        try {
            const value = await window.electronAPI.inspectCoverEditor(entry.filePath);
            if (!value || value.error) throw new Error(value?.error || t('cover_editor_failed'));
            if (mountedRef.current && coverRequestRef.current === requestId) {
                setCurrentCover({ filePath: entry.filePath, dataUrl: value.coverDataUrl || '' });
            }
        } catch (error) {
            if (mountedRef.current && coverRequestRef.current === requestId) setCoverError(error.message);
        } finally {
            if (mountedRef.current && coverRequestRef.current === requestId) setCoverLoading(false);
        }
    };

    const chooseImage = async imagePath => {
        if (savingRef.current || result) return;
        const requestId = ++imageRequestRef.current;
        setImageLoading(true);
        setError('');
        try {
            const value = await window.electronAPI.previewCoverEditorImage(imagePath);
            if (value?.error || !value?.dataUrl) throw new Error(value?.error || t('cover_editor_invalid_image'));
            if (mountedRef.current && imageRequestRef.current === requestId) setImage(value);
        } catch (error) {
            if (mountedRef.current && imageRequestRef.current === requestId) setError(error.message);
        } finally {
            if (mountedRef.current && imageRequestRef.current === requestId) setImageLoading(false);
        }
    };

    const browseImage = async () => {
        try {
            const selected = await window.electronAPI.selectFile(t('cover_editor_select'), [{
                name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
            }]);
            if (selected && mountedRef.current) await chooseImage(selected);
        } catch (error) {
            if (mountedRef.current) setError(error.message);
        }
    };

    const handleDrop = event => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (busy || result) return;
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length !== 1 || !files[0].path) {
            setError(t('cover_editor_drop_one'));
            return;
        }
        void chooseImage(files[0].path);
    };

    const close = () => {
        if (!savingRef.current) onClose();
    };

    const handleKeyDown = event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
        if (event.key !== 'Tab') return;
        const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) {
            event.preventDefault();
            return;
        }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            first.focus();
        }
    };

    const save = async () => {
        if (!readyEntries.length || !image || busy || result || savingRef.current) return;
        savingRef.current = true;
        cancelRef.current = false;
        completedResultsRef.current = {};
        setCancelRequested(false);
        setSaving(true);
        setError('');
        const requests = readyEntries.map(entry => ({
            filePath: entry.info.filePath,
            version: entry.info.version,
            textContentHash: entry.info.textContentHash,
            targetEntry: entry.info.coverEntry,
            imagePath: image.imagePath,
            imageVersion: image.imageVersion,
            mode: canAdd ? mode : 'replace',
            renumber: Boolean(entry.info.canRenumber && renumber),
            backup,
        }));
        if (isBatch) setProgress({ completed: 0, total: requests.length, filePath: '' });
        try {
            const saved = isBatch ? await onExecute(requests, {
                shouldCancel: () => cancelRef.current,
                onProgress: update => {
                    if (update.result) completedResultsRef.current[update.filePath] = update.result;
                    if (!mountedRef.current) return;
                    setProgress(update);
                    setFileResults({ ...completedResultsRef.current });
                },
            }) : await onExecute(requests[0]);
            if (isBatch) {
                if (!saved?.batch) throw new Error(saved?.error || t('cover_editor_failed'));
                if (mountedRef.current) {
                    const outcomes = { ...completedResultsRef.current };
                    saved.results.forEach((outcome, index) => {
                        const sourcePath = outcome.sourcePath || requests[index]?.filePath;
                        if (sourcePath) outcomes[sourcePath] = outcome;
                    });
                    setFileResults(outcomes);
                    setResult(saved);
                }
                return;
            }
            if (!saved?.success) {
                throw new Error(resultError(saved));
            }
            if (mountedRef.current) setResult(saved);
        } catch (error) {
            if (mountedRef.current) {
                setError(error.message);
                if (isBatch) {
                    const outcomes = requests.map(request => completedResultsRef.current[request.filePath]
                        || { filePath: request.filePath, success: false, error: error.message });
                    setFileResults(Object.fromEntries(requests.map((request, index) => [request.filePath, outcomes[index]])));
                    setResult({
                        batch: true,
                        results: outcomes,
                        successCount: outcomes.filter(outcome => outcome.success).length,
                        failureCount: outcomes.filter(outcome => !outcome.success && !outcome.cancelled).length,
                        cancelledCount: outcomes.filter(outcome => outcome.cancelled).length,
                    });
                }
            }
        } finally {
            savingRef.current = false;
            if (mountedRef.current) setSaving(false);
        }
    };

    const cancelRemaining = () => {
        cancelRef.current = true;
        setCancelRequested(true);
    };

    const exportCurrentCover = async () => {
        try {
            await window.electronAPI.exportMetadataCover({ filePath, coverDataUrl: info.coverDataUrl, title: t('cover_editor_export') });
        } catch (error) {
            if (mountedRef.current) setError(error.message);
        }
    };

    const numberWidth = Math.max(4, String((info?.pageCount || 0) + (mode === 'add' ? 1 : 0)).length);

    return (
        <div className="folder-dialog-backdrop cover-editor-backdrop"
            onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
            onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
            onDragLeave={event => event.stopPropagation()}
            onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
            onKeyDown={handleKeyDown}>
            <section ref={dialogRef} className="cover-editor-dialog" role="dialog" aria-modal="true"
                aria-labelledby={titleId} aria-busy={saving} tabIndex={-1}>
                <header className="cover-editor-header">
                    <div><h2 id={titleId}>{t('cover_editor_title')}</h2><p title={isBatch ? undefined : filePath}>{isBatch ? t('cover_editor_batch_title', [targets.length]) : info?.name || targets[0]?.name || filePath}</p></div>
                    <button type="button" onClick={close} disabled={saving} aria-label={t('cover_editor_close')}>×</button>
                </header>
                <div className="cover-editor-body">
                    {isBatch && <div className="cover-editor-batch">
                        <h3>{t('cover_editor_batch_files')}</h3>
                        <ul className="cover-editor-file-list" aria-label={t('cover_editor_batch_files')}>
                            {entries.map((entry, index) => {
                                const outcome = fileResults[entry.filePath];
                                const status = entry.error ? 'cover_editor_batch_inspect_failed'
                                    : outcome?.cancelled ? 'cover_editor_batch_cancelled'
                                        : outcome ? outcome.success ? 'cover_editor_saved' : 'cover_editor_failed'
                                            : entry.info ? 'cover_editor_batch_ready' : 'cover_editor_batch_pending';
                                return <li key={entry.filePath} className={entry.error || (outcome && !outcome.success && !outcome.cancelled) ? 'has-error' : ''}>
                                    <button type="button" className="cover-editor-file-choice" aria-pressed={selectedIndex === index}
                                        onClick={() => selectEntry(entry, index)} title={entry.filePath}>
                                        <span className="cover-editor-file-name">{entry.info?.name || entry.name}</span>
                                        <span className="cover-editor-file-status">{t(status)}</span>
                                        {entry.info && <small>{storageText(entry.info)}</small>}
                                    </button>
                                    {entry.error && <p className="cover-editor-file-error">{entry.error}</p>}
                                    {outcome && !outcome.success && !outcome.cancelled && <p className="cover-editor-file-error">{resultError(outcome)}</p>}
                                    {outcome?.success && <div className="cover-editor-file-result">
                                        <p>{outcome.filePath}</p>
                                        {outcome.backupPath && <p>{t('cover_editor_backup_path')}: {outcome.backupPath}</p>}
                                        {outcome.warning && <p>{t('cover_editor_refresh_warning')}: {outcome.warning}</p>}
                                        {outcome.readingWarning && <p>{outcome.readingWarning}</p>}
                                        {outcome.readingAdjustmentUncertain && <p>{t('cover_editor_reading_check')}</p>}
                                    </div>}
                                </li>;
                            })}
                        </ul>
                        {inspectionFailureCount > 0 && <p className="cover-editor-note">{t('cover_editor_batch_inspect_hint')}</p>}
                    </div>}
                    {loading && <p role="status">{isBatch ? t('cover_editor_batch_inspecting', [inspectedCount, targets.length]) : t('cover_editor_loading')}</p>}
                    {!loading && readyEntries.length > 0 && <>
                        <div className="cover-editor-previews">
                            <div className="cover-editor-preview">
                                <h3>{t('cover_editor_current')}{isBatch && <span className="cover-editor-preview-name" title={filePath}>{selectedEntry?.name}</span>}</h3>
                                <div className="cover-editor-image">
                                    {coverLoading ? <span role="status">{t('cover_editor_loading')}</span> : info?.coverDataUrl ? <img src={info.coverDataUrl} alt={t('cover_editor_current')} /> : <span>{selectedEntry?.error || coverError || t('cover_editor_no_cover')}</span>}
                                </div>
                                <div className="cover-editor-preview-actions">
                                    <span title={info?.coverEntry}>{info && (info.coverEntry || t(`cover_editor_kind_${info.kind}`))}</span>
                                    {info?.coverDataUrl && <button type="button" onClick={exportCurrentCover} disabled={busy}>{t('cover_editor_export')}</button>}
                                </div>
                            </div>
                            <div className="cover-editor-preview">
                                <h3>{t('cover_editor_new')}</h3>
                                <button type="button" className={`cover-editor-image cover-editor-drop ${dragging ? 'is-dragging' : ''}`}
                                    onClick={browseImage} disabled={busy || Boolean(result)}
                                    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); if (!busy) setDragging(true); }}
                                    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
                                    onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
                                    onDrop={handleDrop} aria-label={t('cover_editor_select')}>
                                    {imageLoading ? <span role="status">{t('cover_editor_loading')}</span> : image ? <img src={image.dataUrl} alt={t('cover_editor_new')} /> : <span><FaIcon name="image" size={26} /><strong>{t('cover_editor_drop')}</strong><small>JPEG · PNG · WebP · GIF · BMP<br />16 MiB</small></span>}
                                </button>
                                <div className="cover-editor-preview-actions">
                                    <span title={image?.imagePath}>{image ? `${image.width} × ${image.height} · ${Math.ceil(image.size / 1024)} KB` : t('cover_editor_select_hint')}</span>
                                    {image && <button type="button" disabled={busy || Boolean(result)} onClick={() => setImage(null)}>{t('cover_editor_clear')}</button>}
                                </div>
                            </div>
                        </div>
                        <fieldset className="cover-editor-options" disabled={busy || Boolean(result)}>
                            <legend>{t('cover_editor_operation')}</legend>
                            {canAdd ? <div className="cover-editor-modes">
                                <label><input type="radio" name={titleId} checked={mode === 'replace'} onChange={() => { setMode('replace'); setRenumber(false); }} />{t('cover_editor_replace')}<small>{t('cover_editor_replace_hint')}</small></label>
                                <label><input type="radio" name={titleId} checked={mode === 'add'} onChange={() => { setMode('add'); setRenumber(true); }} />{t('cover_editor_add')}<small>{t('cover_editor_add_hint')}</small></label>
                            </div> : <p>{isBatch ? t('cover_editor_batch_replace_only') : info && storageText(info)}</p>}
                            {canRenumber && <>
                                <label className="cover-editor-check"><input type="checkbox" checked={renumber} onChange={event => setRenumber(event.target.checked)} />{t('cover_editor_renumber')}</label>
                                {isBatch && <p className="cover-editor-note">{t('cover_editor_batch_renumber_hint')}</p>}
                                <p className="cover-editor-note">{t('cover_editor_renumber_hint')}</p>
                                {renumber && info?.canRenumber && <details className="cover-editor-filenames"><summary>{t('cover_editor_filenames', [info.pageCount])}</summary>
                                    <ol>{info.pages.map((page, index) => <li key={page.name}><span title={page.name}>{page.name}</span><span>→ {String(index + (mode === 'add' ? 1 : 0)).padStart(numberWidth, '0')}{mode === 'replace' && index === 0 && image ? image.extension : page.name.match(/\.[^.\/]+$/)?.[0] || ''}</span></li>)}</ol>
                                    {mode === 'add' && <p>{t('cover_editor_new_first', ['0'.repeat(numberWidth)])}</p>}
                                </details>}
                            </>}
                            {!isBatch && info?.conversion && <p className="cover-editor-notice">{t('cover_editor_conversion')}</p>}
                            {canBackup && <label className="cover-editor-check"><input type="checkbox" checked={backup} onChange={event => setBackup(event.target.checked)} />{t('cover_editor_backup')}</label>}
                        </fieldset>
                    </>}
                    {error && <div className="cover-editor-error" role="alert">{error}</div>}
                    {result?.batch ? <div className="cover-editor-batch-summary" role="status">{t('cover_editor_batch_summary', [result.successCount, result.failureCount + inspectionFailureCount, result.cancelledCount])}</div>
                        : result && <div className="cover-editor-success" role="status"><strong>{t('cover_editor_saved')}</strong><p>{result.filePath}</p>{result.backupPath && <p>{t('cover_editor_backup_path')}: {result.backupPath}</p>}{result.warning && <p>{t('cover_editor_refresh_warning')}: {result.warning}</p>}{result.readingWarning && <p>{result.readingWarning}</p>}{result.readingAdjustmentUncertain && <p>{t('cover_editor_reading_check')}</p>}</div>}
                </div>
                <footer className="cover-editor-footer">
                    <span role="status">{saving ? isBatch ? <>{t('cover_editor_batch_progress', [progress?.completed || 0, progress?.total || readyEntries.length])}{cancelRequested && <><br />{t('cover_editor_batch_cancelling')}</>}</> : t('cover_editor_saving') : canBackup && backup ? t('cover_editor_backup_hint') : ''}</span>
                    {saving && isBatch && <button type="button" onClick={cancelRemaining} disabled={cancelRequested}>{t('cover_editor_batch_cancel_remaining')}</button>}
                    <button type="button" onClick={close} disabled={saving}>{t(result ? 'cover_editor_close' : 'cover_editor_cancel')}</button>
                    {!result && <button type="button" className="cover-editor-save" onClick={save} disabled={busy || !readyEntries.length || !image}>{saving ? t('cover_editor_saving') : isBatch ? t('cover_editor_batch_save', [readyEntries.length]) : t('cover_editor_save')}</button>}
                </footer>
            </section>
        </div>
    );
}
