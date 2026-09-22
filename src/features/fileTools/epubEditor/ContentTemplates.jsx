import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { getCurrentLanguage } from '../../../utils/i18n';
import { builtinContentTemplates, templateAssetIds, validateContentTemplate } from '../../../../electron/epubEditor/contentTemplates';
import { captureTemplate } from './templateInsertion';
import { editorExtensions } from './extensions';
import { editorText as l } from './labels';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import { CommandButton } from './FeatureToolbar';
import { ParagraphMenu, StyleMenu, HighlightMenu } from './FormattingMenus';
import { shortcutLabel } from './shortcuts';

const blank = () => ({ name: '', description: '', content: { type: 'doc', content: [{ type: 'paragraph' }] }, assets: [] });
const signature = item => JSON.stringify([item.name, item.description, item.content]);

function TemplateBody({ value, editable, urls, onChange, apiRef }) {
    const extensions = useMemo(() => editorExtensions(id => urls[id]), [urls]);
    const editor = useEditor({
        extensions, content: value, editable,
        editorProps: { attributes: { role: 'textbox', 'aria-label': l('templateBody'), 'aria-multiline': 'true' } },
        onUpdate: ({ editor }) => onChange(editor.getJSON()),
    });
    useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
    useEffect(() => { apiRef.current = editor; return () => { apiRef.current = null; }; }, [editor, apiRef]);
    if (!editor) return null;
    const actions = {
        paragraph: () => { if (editor.can().setParagraph()) editor.chain().focus().clearParagraphFormat().setParagraph().run(); }, blockquote: () => editor.chain().focus().toggleBlockquote().run(), codeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
        ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [`heading${level}`, () => { if (editor.can().setHeading({ level })) editor.chain().focus().clearParagraphFormat().setHeading({ level }).run(); }])),
    };
    return <div className="ee-template-body">
        {editable && <div className="ee-toolbar" role="toolbar" aria-label={l('templateFormat')} onMouseDown={event => { if (event.target.closest('button')) event.preventDefault(); }}>
            <CommandButton command="undo" disabled={!editor.can().undo()} action={() => editor.chain().focus().undo().run()} />
            <CommandButton command="redo" disabled={!editor.can().redo()} action={() => editor.chain().focus().redo().run()} />
            <ParagraphMenu editor={editor} actions={actions} /><StyleMenu editor={editor} /><HighlightMenu editor={editor} />
            {['bold', 'italic', 'underline', 'bulletList', 'orderedList'].map(command => <CommandButton key={command} command={command} active={editor.isActive(command)} action={() => editor.chain().focus()[`toggle${command[0].toUpperCase()}${command.slice(1)}`]().run()} />)}
            {['left', 'center', 'right'].map(command => <CommandButton key={command} command={command} active={editor.isActive({ textAlign: command })} action={() => editor.chain().focus().setTextAlign(command).run()} />)}
            <CommandButton command="addTable" action={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()} />
            {editor.isActive('table') && ['addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'mergeCells', 'splitCell'].map(command => <CommandButton key={command} command={command} disabled={!editor.can()[command]()} action={() => editor.chain().focus()[command]().run()} />)}
        </div>}
        <div className="ee-paper"><EditorContent editor={editor} /></div>
    </div>;
}

export default function ContentTemplates({ editor, chapterId, chapterTitle, projectAssets, projectUrls, request, onInsert, onClose }) {
    const builtins = useMemo(() => builtinContentTemplates(getCurrentLanguage()), []);
    const [library, setLibrary] = useState(null);
    const [draft, setDraft] = useState(builtins[0]);
    const [baseline, setBaseline] = useState(signature(builtins[0]));
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [busy, setBusy] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [confirm, setConfirm] = useState(null);
    const [generation, setGeneration] = useState(0);
    const [urls, setUrls] = useState(null);
    const alive = useRef(true);
    const nameRef = useRef(null);
    const bodyRef = useRef(null);
    const initialState = useRef(editor.state);
    const dirty = !draft.builtin && signature(draft) !== baseline;
    const editable = !draft.builtin && !!library && !busy && !conflict && !confirm;
    const fail = value => { setError(l(value.code || 'FILE_FAILED')); if (value.code === 'TEMPLATE_CONFLICT') setConflict(true); };
    const choose = (item, isNew = false) => {
        setDraft(structuredClone(item)); setBaseline(signature(isNew ? blank() : item));
        setError(''); setNotice(''); setConfirm(null); setGeneration(value => value + 1); setUrls(null);
        if (isNew) requestAnimationFrame(() => nameRef.current?.focus());
    };
    const guard = action => { if (busy) return; if (dirty) setConfirm({ kind: 'discard', action }); else action(); };
    const reload = async (reset = false) => {
        setBusy(true); setError('');
        try {
            const value = await request({ action: 'templateList' });
            if (!alive.current) return;
            setLibrary(value); setConflict(false);
            if (reset) choose(value.templates.find(item => item.id === draft.id) || builtins[0]);
        } catch (value) { if (alive.current) fail(value); }
        finally { if (alive.current) setBusy(false); }
    };
    useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, []);
    useEffect(() => {
        let active = true;
        const created = [];
        const item = draft;
        (async () => {
            try {
                const resolved = { ...projectUrls };
                for (const asset of item.assets) {
                    if (resolved[asset.id]) continue;
                    const result = await request({ action: 'templateAsset', templateId: item.sourceTemplateId || item.id, assetId: asset.id });
                    if (!active) return;
                    const url = URL.createObjectURL(new Blob([result.data], { type: result.mime }));
                    created.push(url); resolved[asset.id] = url;
                }
                if (active) setUrls(resolved);
            } catch (value) { if (active) fail(value); }
        })();
        return () => { active = false; created.forEach(url => URL.revokeObjectURL(url)); };
    }, [generation]);
    const items = [...builtins, ...(library?.templates || [])].filter(item => (filter === 'all' || (filter === 'builtin') === !!item.builtin) && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
    const capture = whole => guard(() => {
        try {
            const result = captureTemplate(initialState.current, chapterId, whole);
            const ids = templateAssetIds(result.content);
            const item = { ...blank(), name: whole ? chapterTitle.slice(0, 80) : '', content: result.content, assets: projectAssets.filter(asset => ids.has(asset.id)) };
            validateContentTemplate({ ...item, name: item.name || l('templates') });
            choose(item, true);
            if (result.removedLinks) setNotice(l('templateLinksRemoved'));
        } catch (value) { fail(value); }
    });
    const duplicate = () => {
        if (busy) return;
        const base = (draft.name || l('templates')).slice(0, 60);
        let name = `${base} (${l('presetCopy')})`;
        let index = 2;
        while (library.templates.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${l('presetCopy')} ${index++})`;
        choose({ ...draft, id: undefined, builtin: false, sourceTemplateId: draft.builtin ? undefined : draft.sourceTemplateId || draft.id, name }, true);
    };
    const save = async () => {
        if (!editable || !draft.name.trim()) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const content = bodyRef.current?.getJSON() || draft.content;
            validateContentTemplate({ ...draft, content });
            const value = await request({ action: 'templateSave', template: { id: draft.id, name: draft.name, description: draft.description, content }, revision: library.revision, sourceTemplateId: draft.sourceTemplateId });
            if (!alive.current) return;
            setLibrary(value); choose(value.templates.find(item => item.id === value.selectedId)); setNotice(l('templateSaved'));
        } catch (value) { if (alive.current) fail(value); }
        finally { if (alive.current) setBusy(false); }
    };
    const remove = async () => {
        setBusy(true); setError('');
        try {
            const value = await request({ action: 'templateDelete', templateId: draft.id, revision: library.revision });
            if (!alive.current) return;
            setLibrary(value); choose(builtins[0]); setNotice(l('templateDeleted'));
        } catch (value) { if (alive.current) fail(value); }
        finally { if (alive.current) { setBusy(false); setConfirm(null); } }
    };
    const insert = async () => {
        setBusy(true); setError('');
        try {
            const value = draft.builtin ? draft : await request({ action: 'templateImport', templateId: draft.id, revision: library.revision });
            await onInsert(value);
            onClose();
        } catch (value) { if (alive.current) fail(value); }
        finally { if (alive.current) setBusy(false); }
    };
    const canSave = editable && urls && draft.name.trim() && (!draft.id || dirty);
    return <EditorDialog title={l('templates')} className="ee-content-template-dialog ee-management-dialog" footer={<>
        <div className="ee-preset-actions">
            {!draft.builtin && <button className="ee-button ee-primary" disabled={!canSave} title={`${l('templateSave')} (${shortcutLabel('save')})`} onClick={save}><EditorIcon command="save" />{l('templateSave')}</button>}
            <button className="ee-button" disabled={!library || busy || conflict || !urls || !!confirm} onClick={duplicate}><EditorIcon command="saveAs" />{l('presetDuplicate')}</button>
            {!draft.builtin && draft.id && <button className="ee-button ee-danger" disabled={!editable} onClick={() => setConfirm({ kind: 'delete', action: remove })}><EditorIcon command="remove" />{l('templateDelete')}</button>}
        </div>
        {error && <p className="ee-code-error" role="alert">{error}</p>}
        {notice && <p className="ee-muted" role="status">{notice}</p>}
        {confirm ? <div className="ee-preset-confirm" role="alertdialog" aria-label={l('templates')}>
            <p>{l(confirm.kind === 'delete' ? 'templateDeleteConfirm' : 'templateDiscardConfirm')}</p>
            <button autoFocus className="ee-button ee-primary" disabled={busy} onClick={() => { const action = confirm.action; setConfirm(null); void action(); }}>{l(confirm.kind === 'delete' ? 'templateDelete' : 'presetDiscard')}</button>
            <button className="ee-button" disabled={busy} onClick={() => setConfirm(null)}>{l('cancel')}</button>
        </div> : <div className="ee-preset-apply">
            <details className="ee-apply-hint"><summary>{l(initialState.current.selection.empty ? 'templateInsertHint' : 'templateReplaceHint')}</summary><p className="ee-muted">{l('templateCssHint')}</p></details>
            <button className="ee-button ee-primary" disabled={busy || !urls || (!draft.builtin && (!library || !draft.id || dirty || conflict))} onClick={insert}><EditorIcon command="templates" />{l('templateInsert')}</button>
            {!draft.builtin && (!draft.id || dirty) && <span className="ee-muted">{l('templateSaveFirst')}</span>}
        </div>}
        {busy && <p role="status">{l('working')}</p>}
    </>} onClose={() => guard(onClose)} onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); if (canSave) void save(); }
    }}>
        <style>{urls && draft.assets.filter(asset => asset.kind === 'font').map(asset => `@font-face{font-family:font-${asset.id};src:url("${urls[asset.id]}");}`).join('\n')}</style>
        <p className="ee-muted">{l('templateLibraryHint')}</p>
        <div className="ee-preset-layout">
            <aside className="ee-preset-sidebar">
                <button className="ee-button" disabled={!library || busy || conflict} onClick={() => guard(() => choose(blank(), true))}><EditorIcon command="templates" />{l('templateNew')}</button>
                <button className="ee-button" disabled={!library || busy || conflict || initialState.current.selection.empty} onClick={() => capture(false)}>{l('templateFromSelection')}</button>
                <button className="ee-button" disabled={!library || busy || conflict} onClick={() => capture(true)}>{l('templateFromChapter')}</button>
                <input aria-label={l('templateSearch')} placeholder={l('templateSearch')} value={query} onChange={event => setQuery(event.target.value)} />
                <select aria-label={l('templateFilter')} value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'builtin', 'custom'].map(key => <option key={key} value={key}>{l(`templateFilter_${key}`)}</option>)}</select>
                <div className="ee-preset-list" aria-label={l('templateList')}>{items.map(item => <button type="button" key={item.id} className={draft.id === item.id ? 'is-active' : ''} aria-pressed={draft.id === item.id} disabled={busy} onClick={() => guard(() => choose(item))}><span>{item.name}</span><small>{l(item.builtin ? 'templateFilter_builtin' : 'templateFilter_custom')}</small></button>)}{!items.length && <p className="ee-muted">{l('templateNoResults')}</p>}</div>
                <button className="ee-button" disabled={busy} onClick={() => guard(() => reload(true))}>{l('presetReload')}</button>
            </aside>
            <section className="ee-preset-detail" aria-label={l('templateDetails')}>
                <label className="ee-field"><span>{l('templateName')}</span><input ref={nameRef} maxLength={80} value={draft.name} readOnly={!editable} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
                <label className="ee-field"><span>{l('presetDescription')}</span><input maxLength={240} value={draft.description} readOnly={!editable} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
                {urls ? <TemplateBody key={generation} value={draft.content} editable={editable} urls={urls} apiRef={bodyRef} onChange={content => setDraft(value => ({ ...value, content }))} /> : <p role="status">{l('working')}</p>}
                <p className="ee-muted">{l(draft.builtin ? 'templateBuiltinHint' : 'templateEditHint')}{dirty ? ` · ${l('unsaved')}` : ''}</p>
            </section>
        </div>
    </EditorDialog>;
}
