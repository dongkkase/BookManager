import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import '../../styles/CoverEditorDialog.css';

export function CoverEditorDialog({ file, onExecute, onClose, t }) {
    const filePath = file.full_path || file.path;
    const [info, setInfo] = useState(null);
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
    const dialogRef = useRef(null);
    const imageRequestRef = useRef(0);
    const mountedRef = useRef(true);
    const savingRef = useRef(false);
    const busy = loading || imageLoading || saving;
    const titleId = React.useId();

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
            try {
                const value = await window.electronAPI.inspectCoverEditor(filePath);
                if (value?.error) throw new Error(value.error);
                if (cancelled) return;
                setInfo(value);
                setMode(value.canAdd && !value.coverDataUrl ? 'add' : 'replace');
                setRenumber(value.canRenumber && !value.coverDataUrl);
            } catch (error) {
                if (!cancelled) setError(error.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
            mountedRef.current = false;
            imageRequestRef.current += 1;
            document.removeEventListener('focusin', keepFocusInside, true);
            previousFocus?.focus?.();
        };
    }, [filePath]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    }, [saving, result]);

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
        if (!info || !image || busy || result || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            const saved = await onExecute({
                filePath: info.filePath,
                version: info.version,
                textContentHash: info.textContentHash,
                targetEntry: info.coverEntry,
                imagePath: image.imagePath,
                imageVersion: image.imageVersion,
                mode,
                renumber: info.canRenumber && renumber,
                backup,
            });
            if (!saved?.success) {
                throw new Error(saved?.code === 'COVER_SOURCE_CHANGED'
                    ? t('cover_editor_source_changed') : saved?.code === 'IMAGE_SOURCE_CHANGED'
                        ? t('cover_editor_image_changed') : saved?.code === 'COVER_VIEWER_OPEN'
                            ? t('cover_editor_viewer_open') : saved?.error || t('cover_editor_failed'));
            }
            if (mountedRef.current) setResult(saved);
        } catch (error) {
            if (mountedRef.current) setError(error.message);
        } finally {
            savingRef.current = false;
            if (mountedRef.current) setSaving(false);
        }
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
                    <div><h2 id={titleId}>{t('cover_editor_title')}</h2><p title={filePath}>{info?.name || file.name || filePath}</p></div>
                    <button type="button" onClick={close} disabled={saving} aria-label={t('cover_editor_close')}>×</button>
                </header>
                <div className="cover-editor-body">
                    {loading ? <p role="status">{t('cover_editor_loading')}</p> : info && <>
                        <div className="cover-editor-previews">
                            <div className="cover-editor-preview">
                                <h3>{t('cover_editor_current')}</h3>
                                <div className="cover-editor-image">
                                    {info.coverDataUrl ? <img src={info.coverDataUrl} alt={t('cover_editor_current')} /> : <span>{t('cover_editor_no_cover')}</span>}
                                </div>
                                <div className="cover-editor-preview-actions">
                                    <span title={info.coverEntry}>{info.coverEntry || t(`cover_editor_kind_${info.kind}`)}</span>
                                    {info.coverDataUrl && <button type="button" onClick={exportCurrentCover} disabled={busy}>{t('cover_editor_export')}</button>}
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
                            {info.canAdd ? <div className="cover-editor-modes">
                                <label><input type="radio" name={titleId} checked={mode === 'replace'} onChange={() => { setMode('replace'); setRenumber(false); }} />{t('cover_editor_replace')}<small>{t('cover_editor_replace_hint')}</small></label>
                                <label><input type="radio" name={titleId} checked={mode === 'add'} onChange={() => { setMode('add'); setRenumber(true); }} />{t('cover_editor_add')}<small>{t('cover_editor_add_hint')}</small></label>
                            </div> : <p>{t(`cover_editor_storage_${info.kind === 'audio' && info.storage === 'database' ? 'audio_local' : info.kind}`)}</p>}
                            {info.canRenumber && <>
                                <label className="cover-editor-check"><input type="checkbox" checked={renumber} onChange={event => setRenumber(event.target.checked)} />{t('cover_editor_renumber')}</label>
                                <p className="cover-editor-note">{t('cover_editor_renumber_hint')}</p>
                                {renumber && <details className="cover-editor-filenames"><summary>{t('cover_editor_filenames', [info.pageCount])}</summary>
                                    <ol>{info.pages.map((page, index) => <li key={page.name}><span title={page.name}>{page.name}</span><span>→ {String(index + (mode === 'add' ? 1 : 0)).padStart(numberWidth, '0')}{mode === 'replace' && index === 0 && image ? image.extension : page.name.match(/\.[^.\/]+$/)?.[0] || ''}</span></li>)}</ol>
                                    {mode === 'add' && <p>{t('cover_editor_new_first', ['0'.repeat(numberWidth)])}</p>}
                                </details>}
                            </>}
                            {info.conversion ? <p className="cover-editor-notice">{t('cover_editor_conversion')}</p> : info.storage === 'file' && <label className="cover-editor-check"><input type="checkbox" checked={backup} onChange={event => setBackup(event.target.checked)} />{t('cover_editor_backup')}</label>}
                        </fieldset>
                    </>}
                    {error && <div className="cover-editor-error" role="alert">{error}</div>}
                    {result && <div className="cover-editor-success" role="status"><strong>{t('cover_editor_saved')}</strong><p>{result.filePath}</p>{result.backupPath && <p>{t('cover_editor_backup_path')}: {result.backupPath}</p>}{result.warning && <p>{t('cover_editor_refresh_warning')}: {result.warning}</p>}{result.readingWarning && <p>{result.readingWarning}</p>}{result.readingAdjustmentUncertain && <p>{t('cover_editor_reading_check')}</p>}</div>}
                </div>
                <footer className="cover-editor-footer">
                    <span role="status">{saving ? t('cover_editor_saving') : info?.storage === 'file' && !info.conversion && backup ? t('cover_editor_backup_hint') : ''}</span>
                    <button type="button" onClick={close} disabled={saving}>{t(result ? 'cover_editor_close' : 'cover_editor_cancel')}</button>
                    {!result && <button type="button" className="cover-editor-save" onClick={save} disabled={busy || !info || !image}>{t(saving ? 'cover_editor_saving' : 'cover_editor_save')}</button>}
                </footer>
            </section>
        </div>
    );
}
