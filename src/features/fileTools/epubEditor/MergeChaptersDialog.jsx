import React, { useRef, useState } from 'react';
import { textContent } from '../../../../electron/epubEditor/model';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import { editorText as l } from './labels';

export default function MergeChaptersDialog({ chapters, chapterId, onMerge, onClose }) {
    const currentIndex = Math.max(0, chapters.findIndex(item => item.id === chapterId));
    const initialStart = Math.min(currentIndex, chapters.length - 2);
    const [start, setStart] = useState(initialStart);
    const [end, setEnd] = useState(initialStart + 1);
    const [title, setTitle] = useState(chapters[initialStart].title);
    const [keepTitles, setKeepTitles] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const selected = chapters.slice(start, end + 1);
    const hasCss = selected.some(chapter => chapter.css?.trim());
    const changeStart = index => {
        if (title === chapters[start].title) setTitle(chapters[index].title);
        setStart(index);
        if (end <= index) setEnd(index + 1);
        setError(null);
    };
    const close = () => { if (!busyRef.current) onClose(); };
    const submit = async event => {
        event.preventDefault();
        if (busyRef.current || !title.trim() || selected.length < 2) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try { await onMerge(chapters[start].id, chapters[end].id, { title: title.trim(), keepTitles }); }
        catch (failure) { setError(l(failure.code)); }
        finally { busyRef.current = false; setBusy(false); }
    };
    return <EditorDialog title={l('mergeChapters')} onClose={close} className="ee-merge-dialog" onSubmit={submit} footer={<>
        <div className="ee-merge-actions"><button type="button" className="ee-button" disabled={busy} onClick={close}>{l('cancel')}</button><button type="submit" className="ee-button ee-primary" disabled={busy || !title.trim() || selected.length < 2}><EditorIcon command="mergeChapters" />{l('mergeApply')}</button></div>
    </>}>
        <p className="ee-muted">{l('mergeChaptersHint')}</p>
        <fieldset disabled={busy} className="ee-merge-fields">
            <div className="ee-merge-range">
                <label className="ee-field"><span>{l('mergeStart')}</span><select value={start} onChange={event => changeStart(Number(event.target.value))}>{chapters.slice(0, -1).map((chapter, index) => <option key={chapter.id} value={index}>{index + 1}. {chapter.title || l('chapter')}</option>)}</select></label>
                <label className="ee-field"><span>{l('mergeEnd')}</span><select value={end} onChange={event => { setEnd(Number(event.target.value)); setError(null); }}>{chapters.map((chapter, index) => index > start && <option key={chapter.id} value={index}>{index + 1}. {chapter.title || l('chapter')}</option>)}</select></label>
            </div>
            <label className="ee-field"><span>{l('mergeTitle')}</span><input required maxLength={2000} value={title} onChange={event => setTitle(event.target.value)} /></label>
            <label className="ee-merge-option"><input type="checkbox" checked={keepTitles} onChange={event => setKeepTitles(event.target.checked)} /><span>{l('mergeKeepTitles')}</span></label>
            <p className="ee-muted">{l('mergeSelection')} · {selected.length} {l('chapter')}</p>
            <ol className="ee-merge-list" start={start + 1} aria-label={l('mergeSelection')}>{selected.map(chapter => <li key={chapter.id}><span>{chapter.title || l('chapter')}</span><small>{textContent(chapter.content).length.toLocaleString()} {l('chars')}</small></li>)}</ol>
            <p className="ee-muted">{l('mergeTocHint')}</p>
            {hasCss && <p className="ee-merge-css-hint">{l('mergeCssHint')}</p>}
            {error && <p className="ee-merge-error" role="alert">{error}</p>}
        </fieldset>
        {busy && <p role="status" className="ee-muted">{l('working')}</p>}
    </EditorDialog>;
}
