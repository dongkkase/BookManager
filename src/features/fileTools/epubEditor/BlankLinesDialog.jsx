import React, { useEffect, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';

export default function BlankLinesDialog({ project, chapterId, onApply, onClose }) {
    const [scope, setScope] = useState('chapter');
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [applying, setApplying] = useState(false);
    const applyingRef = useRef(false);
    useEffect(() => {
        let active = true;
        setResult(null);
        setError(null);
        const worker = new Worker(new URL('./blankLinesWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
            if (!active) return;
            if (data.ok) setResult(data.result);
            else setError(l(data.code));
            worker.terminate();
        };
        worker.onerror = () => {
            if (active) setError(l('error'));
            worker.terminate();
        };
        worker.postMessage({ chapters: project.chapters, chapterId, scope });
        return () => { active = false; worker.terminate(); };
    }, [project.chapters, chapterId, scope]);
    const close = () => { if (!applyingRef.current) onClose(); };
    const submit = async event => {
        event.preventDefault();
        if (applyingRef.current || !result?.count || error) return;
        applyingRef.current = true;
        setApplying(true);
        try { await onApply(result, project.revision); }
        catch (failure) { setError(l(failure.code)); }
        finally { applyingRef.current = false; setApplying(false); }
    };
    return <EditorDialog title={l('removeBlankLines')} onClose={close} onSubmit={submit} footer={<button type="submit" className="ee-button ee-primary" disabled={applying || !result?.count || !!error}>{l('removeBlankLines')}</button>}>
        <p className="ee-muted">{l('blankLinesHint')}</p>
        <label className="ee-field"><span>{l('blankLinesScope')}</span><select value={scope} disabled={applying} onChange={event => { setResult(null); setError(null); setScope(event.target.value); }}>
            <option value="chapter">{l('blankLinesChapter')}</option>
            <option value="book">{l('blankLinesBook')}</option>
        </select></label>
        <p role="status">{error || (applying || !result ? l('working') : result.count
            ? l('blankLinesCount').replace('{count}', result.count.toLocaleString()).replace('{chapters}', result.updates.length.toLocaleString())
            : l('blankLinesNone'))}</p>
        <p className="ee-muted">{l('blankLinesProtected')}</p>
        <p className="ee-muted">{l('blankLinesUndo')}</p>
    </EditorDialog>;
}
