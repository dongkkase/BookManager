import React, { useEffect, useId, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import { editorText as l } from './labels';
import { matchesShortcut, shortcuts, shortcutLabel } from './shortcuts';
import { DEFAULT_PARAGRAPH_FORMAT, PARAGRAPH_FORMAT_BASES, normalizeParagraphFormat, paragraphFormatStyle } from '../../../../electron/epubEditor/paragraphFormats';
import { canApplyParagraphFormat } from './paragraphFormats';

const signature = value => JSON.stringify(value);

export default function ParagraphFormatsDialog({ editor, seed, selectedId, request, onLibrary, onApply, onClose }) {
    const [library, setLibrary] = useState(null);
    const [draft, setDraft] = useState(() => ({ ...DEFAULT_PARAGRAPH_FORMAT, ...seed }));
    const [baseline, setBaseline] = useState(() => signature({ ...DEFAULT_PARAGRAPH_FORMAT, ...seed }));
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [conflict, setConflict] = useState(false);
    const [confirm, setConfirm] = useState(null);
    const alive = useRef(true);
    const nameInput = useRef(null);
    const confirmation = useRef(null);
    const hintId = useId();
    const dirty = signature(draft) !== baseline;
    let valid = true;
    try { normalizeParagraphFormat(draft); } catch { valid = false; }
    const editable = !!library && !busy && !conflict;
    const canSave = editable && valid && (!draft.id || dirty);
    const choose = value => {
        const next = { ...DEFAULT_PARAGRAPH_FORMAT, ...value };
        setDraft(next); setBaseline(signature(next)); setNotice(''); setConfirm(null);
        if (!conflict) setError('');
        if (!next.id) requestAnimationFrame(() => nameInput.current?.focus());
    };
    const publish = value => { setLibrary(value); onLibrary(value.formats); };
    const guard = action => {
        if (busy) return;
        if (dirty) setConfirm({ kind: 'discard', action });
        else action();
    };
    const fail = failure => {
        if (!alive.current) return;
        setError(failure.code || 'FILE_FAILED');
        if (failure.code === 'PARAGRAPH_FORMAT_CONFLICT') setConflict(true);
    };
    const load = async (reset = false) => {
        setBusy(true); setError('');
        try {
            const value = await request({ action: 'paragraphFormatList' });
            if (!alive.current) return;
            publish(value); setConflict(false);
            if (reset || !seed) choose(value.formats.find(item => item.id === (reset ? draft.id : selectedId)) || value.formats[0] || DEFAULT_PARAGRAPH_FORMAT);
        } catch (failure) { fail(failure); }
        finally { if (alive.current) setBusy(false); }
    };
    useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (!confirm) return;
        const previous = document.activeElement;
        const frame = requestAnimationFrame(() => confirmation.current?.querySelector('button')?.focus());
        return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); };
    }, [confirm]);
    const save = async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            const value = await request({ action: 'paragraphFormatSave', format: draft, revision: library.revision });
            if (!alive.current) return;
            publish(value); choose(value.formats.find(item => item.id === value.selectedId)); setNotice('paragraphFormatSaved');
        } catch (failure) { fail(failure); }
        finally { if (alive.current) setBusy(false); }
    };
    const remove = async () => {
        setConfirm(null); setBusy(true); setError('');
        try {
            const value = await request({ action: 'paragraphFormatDelete', formatId: draft.id, revision: library.revision });
            if (!alive.current) return;
            publish(value); choose(value.formats[0] || DEFAULT_PARAGRAPH_FORMAT); setNotice('paragraphFormatDeleted');
        } catch (failure) { fail(failure); }
        finally { if (alive.current) setBusy(false); }
    };
    const duplicate = () => {
        const base = draft.name.slice(0, 60) || l('paragraphFormat');
        let name = `${base} (${l('presetCopy')})`, index = 2;
        while (library.formats.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${l('presetCopy')} ${index++})`;
        const next = { ...draft, name };
        delete next.id;
        setDraft(next); setBaseline(signature(DEFAULT_PARAGRAPH_FORMAT)); setNotice('');
        requestAnimationFrame(() => nameInput.current?.focus());
    };
    const patch = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setNotice(''); };
    const numberField = (key, label, min, max, step) => <label className="ee-field" key={key}><span>{l(label)}</span><input type="number" min={min} max={max} step={step} placeholder={l('formatInherit')} value={draft[key] ?? ''} onChange={event => patch(key, event.target.value === '' ? null : Number(event.target.value))} /></label>;
    const colorField = (key, label) => <label className="ee-field"><span>{l(label)}</span><div className="ee-format-color"><input type="color" aria-label={l(label)} aria-describedby={`${hintId}-${key}`} className={!draft[key] ? 'is-unset' : ''} value={draft[key] || (key === 'color' ? '#282923' : '#ffffff')} onChange={event => patch(key, event.target.value)} /><input aria-label={`${l(label)} HEX`} aria-describedby={`${hintId}-${key}`} maxLength={7} placeholder={l('formatInherit')} value={draft[key] || ''} onChange={event => patch(key, event.target.value || null)} /><button type="button" className="ee-button" aria-label={`${l(label)} ${l('formatClearValue')}`} aria-describedby={`${hintId}-${key}`} disabled={!draft[key]} onClick={() => patch(key, null)}>{l('formatClearValue')}</button></div><small id={`${hintId}-${key}`} className="ee-format-field-hint">{l(key === 'color' ? 'formatColorHint' : 'formatBackgroundHint')}</small></label>;
    let sampleStyle;
    try { sampleStyle = paragraphFormatStyle(normalizeParagraphFormat({ ...draft, name: draft.name.trim() || l('paragraphFormatSample') })); }
    catch { sampleStyle = paragraphFormatStyle(DEFAULT_PARAGRAPH_FORMAT); }
    const Sample = draft.base === 'paragraph' ? 'p' : `h${draft.base.slice(-1)}`;
    return <EditorDialog title={l('paragraphFormats')} className="ee-preset-dialog ee-paragraph-formats-dialog ee-management-dialog" footer={<>
        <div className="ee-format-preview" aria-label={l('preview')}><Sample style={{ ...sampleStyle, textAlign: draft.alignment || undefined, textIndent: `${draft.firstLineIndent || 0}em`, marginLeft: `${draft.indentLevel * 2 + Math.max(0, -(draft.firstLineIndent || 0))}em` }}>{draft.name || l('paragraphFormatSample')}</Sample></div>
        <div className="ee-preset-actions">
            <button type="button" className="ee-button ee-primary" disabled={!canSave || !!confirm} title={`${l('presetSave')} (${shortcutLabel('save')})`} onClick={save}><EditorIcon command="save" />{l('presetSave')}</button>
            <button type="button" className="ee-button" disabled={!editable || !!confirm} onClick={() => guard(duplicate)}><EditorIcon command="saveAs" />{l('presetDuplicate')}</button>
            <button type="button" className="ee-button ee-danger" disabled={!editable || !draft.id || !!confirm} onClick={() => setConfirm({ kind: 'delete', action: remove })}><EditorIcon command="remove" />{l('presetDelete')}</button>
        </div>
        {busy && <p role="status" className="ee-muted">{l('working')}</p>}
        {error && <p role="alert" className="ee-code-error">{l(error)}</p>}
        {notice && <p role="status" className="ee-muted">{l(notice)}</p>}
        {confirm ? <div ref={confirmation} className="ee-preset-confirm" role="alert"><p>{l(confirm.kind === 'delete' ? 'paragraphFormatDeleteConfirm' : 'presetDiscardConfirm')}</p><button type="button" className="ee-button" onClick={() => setConfirm(null)}>{l('cancel')}</button><button type="button" className="ee-button ee-primary" onClick={() => { const action = confirm.action; setConfirm(null); action(); }}>{l(confirm.kind === 'delete' ? 'presetDelete' : 'presetDiscard')}</button></div> : <div className="ee-preset-apply"><span className="ee-muted">{l(dirty || !draft.id ? 'paragraphFormatSaveFirst' : 'paragraphFormatApplyHint')}</span><button type="button" className="ee-button ee-primary" disabled={!editable || dirty || !valid || !draft.id || !canApplyParagraphFormat(editor, draft)} onClick={() => { if (onApply(draft)) onClose(); }}>{l('apply')}</button></div>}
    </>} onClose={() => confirm ? setConfirm(null) : guard(onClose)} onKeyDown={event => {
        if (!event.isComposing && matchesShortcut(event, shortcuts.save)) { event.preventDefault(); event.stopPropagation(); if (canSave && !confirm) void save(); }
    }}>
        <p className="ee-muted">{l('paragraphFormatsHint')}</p>
        <div className="ee-preset-layout">
            <aside className="ee-preset-sidebar">
                <input aria-label={l('paragraphFormatSearch')} placeholder={l('paragraphFormatSearch')} value={query} onChange={event => setQuery(event.target.value)} />
                <button type="button" className="ee-button" disabled={!editable} onClick={() => guard(() => choose(DEFAULT_PARAGRAPH_FORMAT))}><EditorIcon command="paragraphFormatCreate" />{l('paragraphFormatNew')}</button>
                <div className="ee-preset-list" role="group" aria-label={l('paragraphFormatList')}>
                    {(library?.formats || []).filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => <button type="button" key={item.id} aria-pressed={draft.id === item.id} className={draft.id === item.id ? 'is-active' : ''} disabled={busy} onClick={() => guard(() => choose(item))}><span>{item.name}</span><small>{l(item.base)}</small></button>)}
                    {library && !library.formats.length && <p className="ee-muted">{l('paragraphFormatEmpty')}</p>}
                </div>
                <button type="button" className="ee-button" disabled={busy} onClick={() => guard(() => load(true))}>{l('presetReload')}</button>
            </aside>
            <section className="ee-preset-detail" aria-label={l('paragraphFormatDetails')}>
                <fieldset disabled={!editable || !!confirm} className="ee-format-fields">
                    <label className="ee-field ee-format-full"><span>{l('paragraphFormatName')}</span><input ref={nameInput} maxLength={80} value={draft.name} onChange={event => patch('name', event.target.value)} /></label>
                    <label className="ee-field ee-format-full"><span>{l('presetDescription')}</span><input maxLength={240} value={draft.description} onChange={event => patch('description', event.target.value)} /></label>
                    <label className="ee-field"><span>{l('paragraphFormatBase')}</span><select value={draft.base} onChange={event => patch('base', event.target.value)}>{PARAGRAPH_FORMAT_BASES.map(value => <option key={value} value={value}>{l(value)}</option>)}</select></label>
                    <label className="ee-field"><span>{l('font')}</span><select value={draft.font} onChange={event => patch('font', event.target.value)}><option value="inherit">{l('formatInherit')}</option>{['serif', 'sans-serif', 'monospace'].map(value => <option key={value} value={value}>{l(`formatFont_${value}`)}</option>)}</select></label>
                    {numberField('fontSize', 'formatFontSize', 10, 72, 1)}
                    {numberField('lineHeight', 'lineHeight', 1, 3, .05)}
                    {['bold', 'italic'].map(key => <label className="ee-field" key={key}><span>{l(key)}</span><select value={draft[key] === null ? 'inherit' : String(draft[key])} onChange={event => patch(key, event.target.value === 'inherit' ? null : event.target.value === 'true')}><option value="inherit">{l('formatInherit')}</option><option value="true">{l('formatEnabled')}</option><option value="false">{l('formatDisabled')}</option></select></label>)}
                    {colorField('color', 'color')}{colorField('backgroundColor', 'textBackground')}
                    <label className="ee-field"><span>{l('alignment')}</span><select aria-label={l('alignment')} aria-describedby={`${hintId}-alignment`} value={draft.alignment || 'inherit'} onChange={event => patch('alignment', event.target.value === 'inherit' ? null : event.target.value)}><option value="inherit">{l('formatInherit')}</option>{['left', 'center', 'right', 'justify'].map(value => <option key={value} value={value}>{l(value)}</option>)}</select><small id={`${hintId}-alignment`} className="ee-format-field-hint">{l('formatAlignmentHint')}</small></label>
                    {numberField('firstLineIndent', 'formatFirstLine', -3, 3, .1)}
                    {numberField('spaceBefore', 'formatSpaceBefore', 0, 5, .1)}
                    {numberField('spaceAfter', 'formatSpaceAfter', 0, 5, .1)}
                    <label className="ee-field"><span>{l('paragraphIndent')}</span><select value={draft.indentLevel} onChange={event => patch('indentLevel', Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index}>{index * 2}em</option>)}</select></label>
                </fieldset>
                <p className="ee-muted">{l('paragraphFormatSampleText')}</p>
                {!valid && draft.name.trim() && <p role="status" className="ee-code-error">{l('PARAGRAPH_FORMAT_INVALID')}</p>}
            </section>
        </div>
    </EditorDialog>;
}
