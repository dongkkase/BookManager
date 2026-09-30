import React, { useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import { editorText as l } from './labels';
import { droppedPathsFromDataTransfer, isFilePathDrag } from '../../../appShell';

export default function TextImportDialog({ readText, onApply, onClose }) {
    const [source, setSource] = useState(null);
    const [encoding, setEncoding] = useState('auto');
    const [placement, setPlacement] = useState('chapter');
    const [title, setTitle] = useState('');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const busyRef = useRef(false);
    const run = async fn => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try { await fn(); } catch (failure) { setError(failure.code || 'error'); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const load = (nextEncoding, choose = false, paths) => run(async () => {
        const result = await readText({ sourceId: choose ? undefined : source?.sourceId, encoding: nextEncoding, ...(paths ? { paths } : {}) });
        if (result.canceled) return;
        setSource(result);
        setEncoding(nextEncoding);
        if (result.chapterCount > 1) setPlacement('chapter');
        if (choose) setTitle(result.title);
    });
    const dragOver = event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'dragenter') dragDepth.current += 1;
        event.dataTransfer.dropEffect = busyRef.current ? 'none' : 'copy';
        setDragging(!busyRef.current);
    };
    const drop = event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (busyRef.current) return;
        const paths = droppedPathsFromDataTransfer(event.dataTransfer);
        if (paths.length > 1) { setError('TEXT_SINGLE_FILE_REQUIRED'); return; }
        if (paths.length !== 1 || !paths[0].toLowerCase().endsWith('.txt')) { setError('TEXT_FILE_REQUIRED'); return; }
        void load(encoding, true, paths);
    };
    return <EditorDialog title={l('importText')} onClose={() => { if (!busyRef.current) onClose(); }} className={`ee-text-import${dragging ? ' is-dragging' : ''}`} onDragEnter={dragOver} onDragOver={dragOver} onDragLeave={event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
    }} onDrop={drop} onSubmit={event => { event.preventDefault(); if (source?.document && !source.error && (placement === 'cursor' || title.trim())) void run(() => onApply(source.document, title.trim(), placement)); }} footer={<>
        <div className="ee-text-import-actions"><button type="button" className="ee-button" disabled={busy} onClick={onClose}>{l('cancel')}</button><button type="submit" className="ee-button ee-primary" disabled={busy || !source?.document || !!source?.error || (placement === 'chapter' && !title.trim())}>{l('importTextApply')}</button></div>
    </>}>
        <p className="ee-muted">{l('textImportHint')}</p>
        <fieldset disabled={busy} className="ee-text-import-fields">
            <div className="ee-text-import-drop">
                <p>{l('textImportDropHint')}</p>
                <button type="button" className="ee-button" onClick={() => load(encoding, true)}><EditorIcon command="importText" />{l('chooseTextFile')}</button>
            </div>
            {source && <>
                <p className="ee-text-file">{source.name}</p>
                <label className="ee-field"><span>{l('textEncoding')}</span><select value={encoding} onChange={event => load(event.target.value)}>{['auto', 'utf-8', 'utf-16le', 'utf-16be', 'euc-kr', 'shift_jis'].map(value => <option key={value} value={value}>{value === 'auto' ? l('encodingAuto') : value === 'euc-kr' ? 'EUC-KR / CP949' : value.toUpperCase()}</option>)}</select></label>
                {source.error ? <p className="ee-text-error" role="alert">{l(source.error)}</p> : <>
                    <p className="ee-muted">{source.encoding} · {source.characters.toLocaleString()} {l('chars')} · {source.paragraphs.toLocaleString()} {l('textParagraphs')}</p>
                    {source.chapterCount > 1 && <p className="ee-muted">{l('textImportSplitHint').replace('{count}', source.chapterCount.toLocaleString())}</p>}
                    <label className="ee-field"><span>{l('textPreview')}</span><textarea readOnly rows={8} value={source.preview} /></label>
                    <label className="ee-field"><span>{l('textPlacement')}</span><select value={placement} onChange={event => setPlacement(event.target.value)}><option value="chapter">{l(source.chapterCount > 1 ? 'textNewChapters' : 'textNewChapter')}</option><option value="cursor" disabled={source.chapterCount > 1}>{l('textAtCursor')}</option></select></label>
                    {placement === 'chapter' && <label className="ee-field"><span>{l('chapterTitle')}</span><input required maxLength={2000} value={title} onChange={event => setTitle(event.target.value)} /></label>}
                </>}
            </>}
            {error && <p className="ee-text-error" role="alert">{l(error)}</p>}
        </fieldset>
        {busy && <p role="status" className="ee-muted">{l('working')}</p>}
    </EditorDialog>;
}
