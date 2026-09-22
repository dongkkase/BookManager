import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeEditor from './CodeEditor';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import { editorText as l } from './labels';
import { matchesShortcut, shortcuts, shortcutLabel } from './shortcuts';
import { inspectCss } from '../../../../electron/epubEditor/css';
import { BUILTIN_CSS_PRESETS, applyCssPreset, MAX_CSS_LENGTH } from '../../../../electron/epubEditor/cssPresets';

const blank = css => ({ name: '', description: '', css: css || '' });
const signature = value => JSON.stringify([value?.name, value?.description, value?.css]);

async function request(payload) {
    const result = await window.electronAPI.epubEditor(payload);
    if (!result.ok) throw Object.assign(new Error(result.error?.code || 'FILE_FAILED'), { code: result.error?.code || 'FILE_FAILED' });
    return result;
}

export default function CssPresets({ initialCss, currentCss, targetLabel, onApply, onClose }) {
    const builtins = useMemo(() => BUILTIN_CSS_PRESETS.map(item => ({ ...item, name: l(item.nameKey), description: l(item.descriptionKey), builtin: true })), []);
    const initial = initialCss == null ? builtins[0] : blank(initialCss);
    const [library, setLibrary] = useState(null);
    const [draft, setDraft] = useState(initial);
    const [baseline, setBaseline] = useState(signature(initialCss == null ? initial : blank()));
    const [editorKey, setEditorKey] = useState(0);
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [conflict, setConflict] = useState(false);
    const [mode, setMode] = useState('append');
    const [confirm, setConfirm] = useState(null);
    const alive = useRef(true);
    const nameInput = useRef(null);
    const confirmation = useRef(null);
    useEffect(() => {
        if (!confirm) return;
        const prior = document.activeElement;
        const frame = requestAnimationFrame(() => confirmation.current?.querySelector('button')?.focus());
        return () => { cancelAnimationFrame(frame); if (prior?.isConnected) prior.focus(); };
    }, [confirm]);
    const dirty = signature(draft) !== baseline;
    const cssError = useMemo(() => inspectCss(draft.css).error, [draft.css]);
    const valid = draft.css.trim() && !cssError && draft.css.length <= MAX_CSS_LENGTH;
    const items = [...(library?.presets || []), ...builtins].filter(item => (filter === 'all' || (filter === 'builtin') === !!item.builtin) && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
    const result = useMemo(() => {
        try { return { css: applyCssPreset(currentCss, draft.css, mode) }; }
        catch (failure) { return { error: failure.code }; }
    }, [currentCss, draft.css, mode]);
    const choose = item => {
        setDraft({ ...item }); setBaseline(signature(item)); setEditorKey(value => value + 1); setNotice(''); setError(value => !library || conflict ? value : ''); setConfirm(null);
        if (!item.id) requestAnimationFrame(() => nameInput.current?.focus());
    };
    const guard = action => {
        if (busy) return;
        if (dirty) setConfirm({ kind: 'discard', action });
        else { setConfirm(null); action(); }
    };
    const load = async (reset = false) => {
        setBusy(true); setError('');
        try {
            const value = await request({ action: 'cssPresetList' });
            if (!alive.current) return;
            setLibrary(value); setConflict(false);
            if (reset) choose(value.presets.find(item => item.id === draft.id) || builtins[0]);
            else if (initialCss != null) requestAnimationFrame(() => nameInput.current?.focus());
        } catch (failure) { if (alive.current) setError(failure.code || 'FILE_FAILED'); }
        finally { if (alive.current) setBusy(false); }
    };
    useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
    const save = async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            const value = await request({ action: 'cssPresetSave', revision: library.revision, preset: { ...(draft.id ? { id: draft.id } : {}), name: draft.name, description: draft.description, css: draft.css } });
            if (!alive.current) return;
            setLibrary(value); choose(value.presets.find(item => item.id === value.selectedId)); setNotice('presetSaved');
        } catch (failure) { if (alive.current) { setError(failure.code || 'FILE_FAILED'); if (failure.code === 'PRESET_CONFLICT') setConflict(true); } }
        finally { if (alive.current) setBusy(false); }
    };
    const remove = async () => {
        setConfirm(null); setBusy(true); setError('');
        try {
            const value = await request({ action: 'cssPresetDelete', revision: library.revision, presetId: draft.id });
            if (!alive.current) return;
            setLibrary(value); choose(value.presets[0] || builtins[0]); setNotice('presetDeleted');
        } catch (failure) { if (alive.current) { setError(failure.code || 'FILE_FAILED'); if (failure.code === 'PRESET_CONFLICT') setConflict(true); } }
        finally { if (alive.current) setBusy(false); }
    };
    const duplicate = () => {
        const base = draft.name.slice(0, 65) || l('cssPreset');
        let name = `${base} (${l('presetCopy')})`;
        let index = 2;
        while (library.presets.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${l('presetCopy')} ${index++})`;
        choose({ ...blank(draft.css), name, description: draft.description });
        setBaseline(signature(blank()));
    };
    const apply = () => {
        if (mode === 'replace' && currentCss.trim()) setConfirm({ kind: 'replace', action: () => onApply(result.css) });
        else onApply(result.css);
    };
    const editable = !draft.builtin && !!library && !busy && !conflict;
    const canSave = editable && valid && draft.name.trim() && (!draft.id || dirty);
    return <EditorDialog title={l('cssPresets')} className="ee-preset-dialog ee-management-dialog" footer={<>
        <div className="ee-preset-actions">
            {!draft.builtin && <button type="button" className="ee-button ee-primary" title={`${l('presetSave')} (${shortcutLabel('save')})`} disabled={!canSave || !!confirm} onClick={save}><EditorIcon command="save" />{l('presetSave')}</button>}
            <button type="button" className="ee-button" disabled={busy || !library || conflict || !!confirm} onClick={duplicate}><EditorIcon command="saveAs" />{l('presetDuplicate')}</button>
            {!draft.builtin && draft.id && <button type="button" className="ee-button ee-danger" disabled={!editable || !!confirm} onClick={() => setConfirm({ kind: 'delete', action: remove })}><EditorIcon command="remove" />{l('presetDelete')}</button>}
            {draft.builtin && <span className="ee-muted">{l('presetBuiltinHint')}</span>}
        </div>
        {busy && <p className="ee-muted" role="status">{l('working')}</p>}
        {error && <p className="ee-code-error" role="alert">{l(error)}</p>}
        {notice && <p className="ee-muted" role="status">{l(notice)}</p>}
        {confirm ? <div ref={confirmation} className="ee-preset-confirm" role="alert">
            <p>{confirm.kind === 'delete' ? `${draft.name} · ${l('presetDeleteConfirm')}` : l(confirm.kind === 'replace' ? 'presetReplaceConfirm' : 'presetDiscardConfirm')}</p>
            <button type="button" className="ee-button" onClick={() => setConfirm(null)}>{l('cancel')}</button>
            <button type="button" className="ee-button ee-primary" onClick={() => { const action = confirm.action; setConfirm(null); action(); }}>{l(confirm.kind === 'delete' ? 'presetDelete' : confirm.kind === 'replace' ? 'presetReplace' : 'presetDiscard')}</button>
        </div> : <div className="ee-preset-apply">
            <details className="ee-apply-hint"><summary>{l('presetTarget')}: {targetLabel}</summary><p className="ee-muted">{l('presetApplyHint')}</p></details>
            <label>{l('presetApplyMode')}<select value={mode} onChange={event => setMode(event.target.value)}><option value="append">{l('presetAppend')}</option><option value="replace">{l('presetReplace')}</option></select></label>
            <button type="button" className="ee-button ee-primary" disabled={busy || !valid || dirty || !!result.error} onClick={apply}>{l('apply')}</button>
            {dirty && <span className="ee-muted">{l('presetSaveFirst')}</span>}
            {valid && result.error && <span className="ee-code-error">{l(result.error)}</span>}
        </div>}
    </>} onClose={() => confirm ? setConfirm(null) : guard(onClose)} onKeyDown={event => {
        if (!event.isComposing && matchesShortcut(event, shortcuts.save)) { event.preventDefault(); event.stopPropagation(); if (canSave && !confirm) void save(); }
    }}>
        <p className="ee-muted">{l('presetLibraryHint')}</p>
        <div className="ee-preset-layout">
            <aside className="ee-preset-sidebar">
                <input aria-label={l('presetSearch')} placeholder={l('presetSearch')} value={query} onChange={event => setQuery(event.target.value)} />
                <select aria-label={l('presetFilter')} value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'custom', 'builtin'].map(value => <option key={value} value={value}>{l(`presetFilter_${value}`)}</option>)}</select>
                <button type="button" className="ee-button" disabled={busy || !library || conflict} onClick={() => guard(() => choose(blank()))}>{l('presetNew')}</button>
                <div className="ee-preset-list" role="group" aria-label={l('presetList')}>
                    {items.map(item => <button type="button" key={item.id} className={draft.id === item.id ? 'is-active' : ''} aria-pressed={draft.id === item.id} disabled={busy} onClick={() => guard(() => choose(item))}><span>{item.name}</span><small>{l(item.builtin ? 'presetBuiltin' : 'presetCustom')}</small></button>)}
                    {!items.length && <p className="ee-muted">{l('presetNoResults')}</p>}
                </div>
                <button type="button" className="ee-button" disabled={busy} onClick={() => guard(() => load(true))}>{l('presetReload')}</button>
            </aside>
            <section className="ee-preset-detail" aria-label={l('presetDetails')}>
                <label className="ee-field"><span>{l('presetName')}</span><input ref={nameInput} maxLength={80} value={draft.name} readOnly={!editable} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
                <label className="ee-field"><span>{l('presetDescription')}</span><input maxLength={240} value={draft.description} readOnly={!editable} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
                <CodeEditor key={editorKey} label={l('presetCode')} value={draft.css} readOnly={!editable} onChange={css => setDraft(value => ({ ...value, css }))} />
                {cssError && <p className="ee-code-error" role="status">{l(cssError.code)} · {cssError.line}:{cssError.column}</p>}
                {draft.css.length > MAX_CSS_LENGTH && <p className="ee-code-error" role="status">{l('CSS_TOO_LARGE')}</p>}
            </section>
        </div>
    </EditorDialog>;
}
