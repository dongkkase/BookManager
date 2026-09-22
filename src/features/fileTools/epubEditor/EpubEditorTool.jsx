import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { EditorState, Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { FaIcon } from '../../../components/FaIcon';
import { getCurrentLanguage } from '../../../utils/i18n';
import { isFilePathDrag, droppedPathsFromDataTransfer } from '../../../appShell';
import { createChapter, duplicateChapter, newId, paragraph, validateProject, inspectProject, textContent, chapterXhtml, safeLink, walkDocument } from '../../../../electron/epubEditor/model';
import { editorExtensions, findEditorMatches } from './extensions';
import { editorText as l } from './labels';
import Inspector from './Inspector';
import FeatureToolbar, { ShortcutHelp } from './FeatureToolbar';
import ContextToolbar from './ContextToolbar';
import EditorIcon from './EditorIcon';
import EditorDialog from './EditorDialog';
import TextColorDialog from './TextColorDialog';
import CharacterDialog from './CharacterDialog';
import MediaDialog from './MediaDialog';
import ContentTemplates from './ContentTemplates';
import ParagraphFormatsDialog from './ParagraphFormatsDialog';
import { applyParagraphFormat, paragraphFormatFromSelection, selectedParagraphFormat } from './paragraphFormats';
import { templateInsertionTransaction } from './templateInsertion';
import { authoringCss, parseMediaUrl } from '../../../../electron/epubEditor/authoring';
import { clearAuthorFormatting, toggleScript } from './richFormatting';
import { normalizePastedColor } from './textColors';
import TextImportDialog from './TextImportDialog';
import MergeChaptersDialog from './MergeChaptersDialog';
import { splitProjectChapter, importTextChapters, mergeProjectChapters, contentHistoryEntry, restoredChapters } from './chapterOperations';
import { TablePicker, TableRangeDialog, tableCommands } from './TableTools';
import { shortcuts, shortcutLabel, matchesShortcut } from './shortcuts';
import { ASSET_DRAG, readAssetDrag, assetDropTransaction } from './assetDrop';
import useChapterScroll from './useChapterScroll';
import useChapterDrag from './useChapterDrag';
import { CHAPTER_DRAG } from './chapterDrag';
import useEditorZoom from './useEditorZoom';
import { ZOOM_PRESETS } from './editorZoom';
import './epubEditor.css';

const SourceWorkspace = lazy(() => import('./SourceWorkspace'));

async function request(payload) {
    if (!window.electronAPI?.epubEditor) throw Object.assign(new Error(l('browserOnly')), { code: 'browserOnly' });
    const result = await window.electronAPI.epubEditor(payload);
    if (!result?.ok) throw Object.assign(new Error(result?.error?.message || l('error')), { code: result?.error?.code });
    return result;
}

function IconButton({ icon, label, active, children, ...props }) {
    return <button type="button" className={`ee-icon-button${active ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={active == null ? undefined : active} {...props}>{icon ? <FaIcon name={icon} size={14} /> : children}</button>;
}

function Notice({ value, onClose }) {
    return value ? <div className={`ee-notice is-${value.type || 'error'}`} role="status"><span>{value.text}</span><IconButton icon="xmark" label={l('close')} onClick={onClose} /></div> : null;
}

export default function EpubEditorTool({ onBack, showToast, registerBeforeLeave }) {
    const [session, setSession] = useState(null);
    const [recent, setRecent] = useState([]);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);
    const refresh = useCallback(() => {
        if (window.electronAPI?.epubEditor) request({ action: 'list' }).then(result => setRecent(result.projects)).catch(error => setNotice({ text: l(error.code) }));
    }, []);
    useEffect(() => { if (!session) refresh(); }, [session, refresh]);
    const open = async payload => {
        setBusy(true);
        setNotice(null);
        try {
            const result = await request({ ...payload, operationId: newId('op'), language: getCurrentLanguage() });
            if (!result.canceled) setSession(result);
        } catch (error) { setNotice({ text: l(error.code) }); }
        finally { setBusy(false); }
    };
    const rejectDrop = event => {
        if (event.defaultPrevented || event.dataTransfer.types.includes('application/x-prosemirror')) return;
        if (event.dataTransfer.types.includes(ASSET_DRAG) || event.dataTransfer.types.includes(CHAPTER_DRAG)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'none';
        if (event.type === 'drop') setNotice({ text: l('unsupportedDrop') });
    };
    return <section className="epub-editor-tool" onDragOver={rejectDrop} onDrop={rejectDrop}>
        {session ? <Workspace key={session.sessionId} initial={session} onHome={() => setSession(null)} onBack={onBack} showToast={showToast} registerBeforeLeave={registerBeforeLeave} /> : <>
            <header className="ee-welcome-header"><button className="ee-button" onClick={onBack}><FaIcon name="chevronLeft" />{l('back')}</button><span className="ee-brand"><FaIcon name="bookOpen" />{l('editor')}</span><button className="ee-button" disabled={busy} onClick={() => open({ action: 'open' })}><FaIcon name="folderOpen" />{l('open')}</button></header>
            <Notice value={notice} onClose={() => setNotice(null)} />
            <div className="ee-welcome-scroll"><div className="ee-welcome-intro"><span className="ee-eyebrow">BOOKMANAGER / EPUB STUDIO</span><h1>{l('welcome')}</h1><p>{l('introduction')}</p></div>
                <div className="ee-template-grid">{['blank', 'essay', 'guide'].map((template, index) => <button key={template} className={`ee-template is-${template}`} disabled={busy} onClick={() => open({ action: 'create', template })}>
                    <div className="ee-template-art"><div className="ee-template-cover"><span>0{index + 1} /</span><strong>{l(template)}</strong><div className="ee-template-lines" /><span>BOOKMANAGER</span></div></div>
                    <div className="ee-template-info"><div><h2>{l(template)}</h2><p>{l(`${template}Hint`)}</p></div><FaIcon name="plus" size={16} /></div>
                </button>)}</div>
                {busy && <p role="status" className="ee-loading">{l('working')}</p>}
                {recent.length > 0 && <section className="ee-recent"><h2>{l('recent')}</h2>{recent.map(item => <button disabled={busy} key={item.id} onClick={() => open({ action: 'restore', id: item.id })}><FaIcon name="book" /><span>{item.title}<small>{new Date(item.updatedAt).toLocaleString()}</small></span><FaIcon name="chevronRight" /></button>)}</section>}
                <p className="ee-local"><FaIcon name="desktop" />{l('local')}</p>
            </div>
        </>}
    </section>;
}

function Workspace({ initial, ...props }) {
    const urls = useRef({});
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);
    const loadAsset = useCallback(async asset => {
        const result = await request({ action: 'asset', sessionId: initial.sessionId, assetId: asset.id });
        const url = URL.createObjectURL(new Blob([result.data], { type: result.mime }));
        urls.current[asset.id] = url;
        return url;
    }, [initial.sessionId]);
    useEffect(() => {
        let disposed = false;
        (async () => {
            try {
                for (const asset of initial.project.assets) {
                    if (disposed) return;
                    const url = await loadAsset(asset);
                    if (disposed) { URL.revokeObjectURL(url); return; }
                }
                if (!disposed) setReady(true);
            } catch (e) { if (!disposed) setError(l(e.code)); }
        })();
        return () => { disposed = true; for (const url of Object.values(urls.current)) URL.revokeObjectURL(url); };
    }, [initial, loadAsset]);
    if (!ready) return <div className="ee-loading" role="status">{error || l('working')}{error && <button className="ee-button" onClick={async () => { await request({ action: 'close', sessionId: initial.sessionId }); props.onHome(); }}>{l('leave')}</button>}</div>;
    return <Studio initial={initial} assetUrls={urls} loadAsset={loadAsset} {...props} />;
}

function Studio({ initial, assetUrls, loadAsset, onHome, onBack, showToast, registerBeforeLeave }) {
    const [project, setProject] = useState(initial.project);
    const projectRef = useRef(project);
    const [chapterId, setChapterId] = useState(project.chapters[0].id);
    const chapterRef = useRef(chapterId);
    const [mode, setMode] = useState('design');
    const [sourceTab, setSourceTab] = useState('source');
    const [dialog, setDialog] = useState(null);
    const [paragraphFormats, setParagraphFormats] = useState([]);
    const [paragraphFormatSeed, setParagraphFormatSeed] = useState(null);
    const [footnoteText, setFootnoteText] = useState('');
    const [leftTab, setLeftTab] = useState('chapters');
    const [rightTab, setRightTab] = useState('properties');
    const [showStructure, setShowStructure] = useState(true);
    const [showInspector, setShowInspector] = useState(true);
    const [viewport, setViewport] = useState('medium');
    const [zoom, setZoom] = useState(100);
    const [dirty, setDirty] = useState(false);
    const [recoveryRevision, setRecoveryRevision] = useState(project.revision);
    const recoveryRef = useRef(project.revision);
    const [savedRevision, setSavedRevision] = useState(initial.savedRevision);
    const [busy, setBusy] = useState(null);
    const busyRef = useRef(null);
    const [progress, setProgress] = useState(0);
    const [notice, setNotice] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const pendingDrop = useRef(null);
    const textTarget = useRef(null);
    const [issues, setIssues] = useState(null);
    const [exportedPath, setExportedPath] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [replacement, setReplacement] = useState('');
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkValue, setLinkValue] = useState('https://');
    const [, setSelectionTick] = useState(0);
    const [, setHistoryTick] = useState(0);
    const editorRef = useRef(null);
    const pendingRef = useRef(false);
    const commitTimer = useRef(null);
    const states = useRef(new Map());
    const chapterSelection = useRef(0);
    const characterCounts = useRef(new WeakMap());
    const codeStates = useRef(new Map());
    const history = useRef({ undo: [], redo: [] });
    const stageRef = useRef(null);
    const contextToolbarRef = useRef(null);
    const previewAnchor = useRef(null);
    const operationRef = useRef(null);
    const taskRef = useRef(Promise.resolve());
    const chapter = project.chapters.find(item => item.id === chapterId) || project.chapters[0];
    const chapterIndex = project.chapters.findIndex(item => item.id === chapter.id);
    const chapterCharacters = content => {
        if (!characterCounts.current.has(content)) characterCounts.current.set(content, textContent(content).length);
        return characterCounts.current.get(content);
    };
    const report = useCallback(error => { if (error.code !== 'CANCELED') setNotice({ text: l(error.code) }); }, []);
    useEffect(() => {
        let active = true;
        request({ action: 'paragraphFormatList' }).then(result => { if (active) setParagraphFormats(result.formats); }).catch(error => { if (active) report(error); });
        return () => { active = false; };
    }, [report]);
    const install = useCallback(next => {
        projectRef.current = next;
        setProject(next);
        setIssues(null);
        setExportedPath(null);
    }, []);
    const commitEditor = useCallback(() => {
        clearTimeout(commitTimer.current);
        const currentEditor = editorRef.current;
        if (!pendingRef.current || !currentEditor || currentEditor.isDestroyed) return projectRef.current;
        if (currentEditor.view.composing) {
            commitTimer.current = setTimeout(commitEditor, 100);
            return projectRef.current;
        }
        pendingRef.current = false;
        setDirty(false);
        const current = projectRef.current;
        const content = currentEditor.getJSON();
        const next = { ...current, revision: current.revision + 1, chapters: current.chapters.map(item => item.id === chapterRef.current ? { ...item, content } : item) };
        install(next);
        return next;
    }, [install]);
    const flush = useCallback(async () => {
        const currentEditor = editorRef.current;
        while (currentEditor && !currentEditor.isDestroyed && currentEditor.view.composing) await new Promise(resolve => setTimeout(resolve, 30));
        return commitEditor();
    }, [commitEditor]);
    const extensions = useMemo(() => editorExtensions(id => assetUrls.current[id]), [assetUrls]);
    const editor = useEditor({
        extensions, content: project.chapters[0].content,
        immediatelyRender: true,
        onUpdate: () => {
            pendingRef.current = true;
            setDirty(true);
            clearTimeout(commitTimer.current);
            commitTimer.current = setTimeout(commitEditor, 350);
        },
        onSelectionUpdate: () => setSelectionTick(value => value + 1),
        onTransaction: ({ transaction }) => {
            if (pendingDrop.current?.chapterId === chapterRef.current) pendingDrop.current.position = transaction.mapping.map(pendingDrop.current.position, 1);
            setSelectionTick(value => value + 1);
        },
        editorProps: {
            attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': l('write'), spellcheck: 'false' },
            transformPastedHTML: html => {
                const document = new DOMParser().parseFromString(html, 'text/html');
                document.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove());
                document.querySelectorAll('*').forEach(node => {
                    const color = normalizePastedColor(node.style.color);
                    const background = normalizePastedColor(node.style.backgroundColor);
                    node.removeAttribute('style');
                    const colors = [color && `color:${color}`, background && `background-color:${background}`].filter(Boolean).join(';');
                    if (colors) node.setAttribute('style', colors);
                    for (const attr of Array.from(node.attributes)) if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
                    if (node.tagName === 'A' && !safeLink(node.getAttribute('href') || '')) node.removeAttribute('href');
                });
                return document.body.innerHTML;
            },
        },
    }, []);
    editorRef.current = editor;
    const recover = useCallback(async () => {
        const snapshot = await flush();
        const result = await request({ action: 'recover', sessionId: initial.sessionId, project: snapshot });
        recoveryRef.current = Math.max(recoveryRef.current, result.revision);
        setRecoveryRevision(recoveryRef.current);
        return snapshot;
    }, [flush, initial.sessionId]);
    useEffect(() => registerBeforeLeave?.(async () => {
        try {
            await taskRef.current;
            await recover();
            await request({ action: 'close', sessionId: initial.sessionId });
            return true;
        } catch (error) { report(error); return false; }
    }), [registerBeforeLeave, recover, initial.sessionId, report]);
    useEffect(() => {
        if (project.revision <= recoveryRef.current && !dirty) return undefined;
        const timer = setTimeout(() => { recover().catch(report); }, 900);
        return () => clearTimeout(timer);
    }, [project.revision, dirty, recover, report]);
    useEffect(() => () => clearTimeout(commitTimer.current), []);
    useEffect(() => window.electronAPI?.onEpubEditorProgress?.(event => {
        if (event.operationId === operationRef.current) setProgress(event.value);
    }), []);
    useEffect(() => {
        const beforeUnload = event => {
            if (pendingRef.current || projectRef.current.revision > recoveryRef.current || busyRef.current) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', beforeUnload);
        const unsubscribe = window.electronAPI?.onEpubEditorFlush?.(async () => {
            try {
                await taskRef.current;
                await recover();
                await request({ action: 'finishUnload' });
            } catch (error) { report(error); }
        });
        return () => { window.removeEventListener('beforeunload', beforeUnload); unsubscribe?.(); };
    }, [recover, report]);
    useEffect(() => { stageRef.current?.querySelectorAll('.ee-paper audio').forEach(audio => audio.pause()); editor?.emit('mediaPlaybackStop'); }, [mode, chapterId]);
    useEffect(() => { editor?.setEditable(!busy && ['write', 'design'].includes(mode), false); }, [editor, busy, mode]);
    useEffect(() => {
        const reset = () => setDropTarget(null);
        for (const name of ['dragend', 'drop', 'blur']) window.addEventListener(name, reset);
        return () => { for (const name of ['dragend', 'drop', 'blur']) window.removeEventListener(name, reset); };
    }, []);
    const update = useCallback(fn => {
        const current = commitEditor();
        install({ ...fn(current), revision: current.revision + 1 });
    }, [commitEditor, install]);
    const selectChapter = async (id, edge) => {
        const selection = ++chapterSelection.current;
        await flush();
        if (!editor || editor.isDestroyed || selection !== chapterSelection.current || id === chapterRef.current) return;
        const next = projectRef.current.chapters.find(item => item.id === id);
        if (!next) return;
        states.current.set(chapterRef.current, { state: editor.state, ...chapterScroll.capture() });
        const cached = states.current.get(id);
        let state = cached?.state || EditorState.create({ schema: editor.schema, doc: editor.schema.nodeFromJSON(next.content), plugins: editor.state.plugins });
        if (edge) state = state.apply(state.tr.setSelection(edge === 'end' ? Selection.atEnd(state.doc) : Selection.atStart(state.doc)).setMeta('addToHistory', false));
        chapterScroll.enter({ id, edge, scroll: cached?.scroll, previewScroll: cached?.previewScroll });
        editor.view.updateState(state);
        chapterRef.current = id;
        setChapterId(id);
        setSelectionTick(value => value + 1);
    };
    const navigateChapter = async direction => {
        if (busyRef.current || dialog || dropTarget || editor?.view.composing) return;
        const chapters = projectRef.current.chapters;
        const next = chapters[chapters.findIndex(item => item.id === chapterRef.current) + direction];
        if (next) {
            try { await selectChapter(next.id, direction > 0 ? 'start' : 'end'); }
            catch (error) { report(error); }
        }
    };
    const editorZoom = useEditorZoom({ stageRef, chapterId, mode, zoom, setZoom, disabled: !!busy || !!dialog || !!dropTarget });
    const chapterScroll = useChapterScroll({ stageRef, editor, chapterId, mode, disabled: !!busy || !!dialog || !!dropTarget, onNavigate: navigateChapter, onZoom: editorZoom.onWheel });
    const changeStructure = async fn => {
        await flush();
        const current = projectRef.current;
        const chapters = fn(current.chapters);
        if (chapters === current.chapters) return;
        history.current.undo.push(current.chapters);
        if (history.current.undo.length > 30) history.current.undo.shift();
        history.current.redo = [];
        install({ ...current, chapters, revision: current.revision + 1 });
        setHistoryTick(value => value + 1);
        if (!chapters.some(item => item.id === chapterRef.current)) await selectChapter(chapters[0].id);
    };
    const chapterDrag = useChapterDrag({ disabled: !!busy || !!dialog || leftTab !== 'chapters' || !showStructure, onMove: fn => { void changeStructure(fn).catch(report); } });
    const captureStates = () => new Map(states.current).set(chapterRef.current, { state: editor.state, scroll: stageRef.current?.scrollTop || 0 });
    const activateContent = (chapters, selectedId, affectedIds, savedStates) => {
        clearTimeout(commitTimer.current);
        pendingRef.current = false;
        setDirty(false);
        for (const id of affectedIds) {
            states.current.delete(id);
            codeStates.current.delete(`chapterCss-${id}`);
            const cached = savedStates?.get(id);
            const item = chapters.find(value => value.id === id);
            if (cached && item && cached.state.doc.eq(editor.schema.nodeFromJSON(item.content))) states.current.set(id, cached);
        }
        const target = chapters.find(item => item.id === selectedId) || chapters[0];
        const cached = states.current.get(target.id);
        editor.view.updateState(cached?.state || EditorState.create({ schema: editor.schema, doc: editor.schema.nodeFromJSON(target.content), plugins: editor.state.plugins }));
        chapterRef.current = target.id;
        setChapterId(target.id);
        setSelectionTick(value => value + 1);
        requestAnimationFrame(() => { if (stageRef.current) stageRef.current.scrollTop = cached?.scroll || 0; editor.view.focus(); });
    };
    const applyContentStructure = result => {
        const current = projectRef.current;
        const chapters = result.chapters.map(item => current.chapters.includes(item) ? item : { ...item, content: editor.schema.nodeFromJSON(item.content).toJSON() });
        const next = { ...current, chapters, revision: current.revision + 1 };
        validateProject(next);
        const savedStates = captureStates();
        const entry = contentHistoryEntry(current.chapters, chapters, chapterRef.current, savedStates);
        history.current.undo.push(entry);
        if (history.current.undo.length > 30) history.current.undo.shift();
        history.current.redo = [];
        states.current = savedStates;
        install(next);
        activateContent(chapters, result.selectedId, entry.ids);
        setHistoryTick(value => value + 1);
        setMode('design');
        setLeftTab('chapters');
        setShowStructure(true);
    };
    const restoreStructure = async direction => {
        try {
            await flush();
            const from = history.current[direction];
            if (!from.length) return;
            const current = projectRef.current;
            const entry = from.at(-1);
            const chapters = restoredChapters(current.chapters, entry);
            setNotice(null);
            const atomic = !Array.isArray(entry);
            const savedStates = captureStates();
            history.current[direction === 'undo' ? 'redo' : 'undo'].push(atomic ? contentHistoryEntry(current.chapters, chapters, chapterRef.current, savedStates) : current.chapters);
            from.pop();
            install({ ...current, chapters, revision: current.revision + 1 });
            setHistoryTick(value => value + 1);
            if (atomic) {
                states.current = savedStates;
                activateContent(chapters, entry.focusId, entry.ids, entry.editorStates);
            } else if (!chapters.some(item => item.id === chapterRef.current)) await selectChapter(chapters[0].id);
        } catch (error) { report(error); }
    };
    const atomicHistoryAvailable = direction => !!history.current[direction].length && !Array.isArray(history.current[direction].at(-1));
    const openTextImport = async () => {
        await flush();
        textTarget.current = { chapterId: chapterRef.current, position: editor.state.selection.from };
        setDialog('textImport');
    };
    const applyTextImport = async (document, title, placement) => {
        await flush();
        if (textTarget.current?.chapterId !== chapterRef.current) throw Object.assign(new Error(), { code: 'INVALID_PROJECT' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        applyContentStructure(importTextChapters(projectRef.current.chapters, chapterRef.current, editor.state, document, title, placement, textTarget.current.position));
        setDialog(null);
        setNotice({ type: 'success', text: l('textImported') });
    };
    const splitChapter = async () => {
        try {
            await flush();
            applyContentStructure(splitProjectChapter(projectRef.current.chapters, chapterRef.current, editor.state));
            setNotice({ type: 'success', text: l('chapterSplit') });
        } catch (error) { report(error); }
    };
    const openMergeChapters = async () => {
        await flush();
        if (projectRef.current.chapters.length < 2) { setNotice({ text: l('MERGE_RANGE_REQUIRED') }); return; }
        setDialog('mergeChapters');
    };
    const mergeChapters = async (startId, endId, options) => {
        await flush();
        applyContentStructure(mergeProjectChapters(projectRef.current.chapters, startId, endId, options));
        setDialog(null);
        setNotice({ type: 'success', text: l('chaptersMerged') });
    };
    const runTask = (name, fn) => {
        if (busyRef.current) return Promise.resolve();
        busyRef.current = name;
        setBusy(name);
        setProgress(0);
        setNotice(null);
        operationRef.current = newId('op');
        const task = (async () => {
            try { await fn(operationRef.current); } catch (error) { report(error); }
            finally { busyRef.current = null; setBusy(null); operationRef.current = null; }
        })();
        taskRef.current = task;
        return task;
    };
    const save = (saveAs = false) => runTask('save', async operationId => {
        const snapshot = await flush();
        const result = await request({ action: 'save', sessionId: initial.sessionId, project: snapshot, saveAs, operationId });
        if (!result.canceled) {
            setSavedRevision(result.revision);
            if (!result.recoveryWarning) { recoveryRef.current = result.revision; setRecoveryRevision(result.revision); }
            setNotice({ type: 'success', text: l('savedToast') });
            showToast?.(l('savedToast'), 'success');
        }
    });
    const exportBook = () => runTask('export', async operationId => {
        const snapshot = await recover();
        const checks = inspectProject(snapshot);
        setIssues(checks);
        if (checks.some(issue => issue.severity === 'error')) throw Object.assign(new Error(), { code: 'VALIDATION_FAILED' });
        const result = await request({ action: 'export', sessionId: initial.sessionId, project: snapshot, operationId });
        if (!result.canceled) { setExportedPath(result.filePath); setNotice({ type: 'success', text: l('exportedToast') }); }
    });
    const previewInViewer = () => runTask('previewViewer', async operationId => {
        const snapshot = await recover();
        const checks = inspectProject(snapshot);
        if (checks.some(issue => issue.severity === 'error')) {
            setIssues(checks);
            throw Object.assign(new Error(), { code: 'VALIDATION_FAILED' });
        }
        await request({ action: 'previewViewer', sessionId: initial.sessionId, project: snapshot, operationId });
        setNotice({ type: 'success', text: l('viewerPreviewOpened') });
    });
    const leave = destination => runTask('recover', async () => {
        await recover();
        await request({ action: 'close', sessionId: initial.sessionId });
        destination();
    });
    const addAsset = (kind, asCover = false) => runTask('addAsset', async () => {
        await flush();
        const result = await request({ action: 'addAsset', sessionId: initial.sessionId, kind });
        if (result.canceled) return;
        await loadAsset(result.asset);
        update(current => ({ ...current, assets: [...current.assets, result.asset], ...(asCover ? { cover: { ...current.cover, mode: 'image', assetId: result.asset.id } } : {}) }));
        if (kind === 'image' && !asCover) editor.chain().focus().insertContent({ type: 'image', attrs: { assetId: result.asset.id, width: 100, align: 'center', alt: '' } }).run();
        if (kind === 'audio') editor.chain().focus().insertContent({ type: 'audio', attrs: { assetId: result.asset.id, title: result.asset.name, kind: 'effect', loop: false } }).run();
        setLeftTab('assets');
    });
    const insertDroppedAssets = (assets, target) => {
        if (!target || target.chapterId !== chapterRef.current || editor.isDestroyed) return;
        const transaction = assetDropTransaction(editor.state, assets, target.position);
        if (transaction) { editor.view.dispatch(transaction); editor.view.focus(); }
    };
    const importDroppedAssets = (paths, target) => runTask('importAssets', async () => {
        pendingDrop.current = target;
        setImportResult(null);
        try {
            await flush();
            const result = await request({ action: 'importAssets', sessionId: initial.sessionId, paths });
            if (result.assets.length) update(current => ({ ...current, assets: [...current.assets, ...result.assets] }));
            const loaded = [];
            for (const asset of result.assets) {
                try { await loadAsset(asset); loaded.push(asset); }
                catch (error) { result.rejected.push({ name: asset.name, code: error.code || 'FILE_FAILED' }); }
            }
            insertDroppedAssets(loaded, pendingDrop.current);
            setLeftTab('assets');
            setShowStructure(true);
            setImportResult(result);
            await recover();
        } finally { pendingDrop.current = null; }
    });
    const isBodyDrop = event => ['write', 'design'].includes(mode) && !!event.target.closest?.('.ee-stage') && !event.target.closest?.('input, textarea, .ee-footnotes');
    const handleAssetDragOver = event => {
        const internal = event.dataTransfer.types.includes(ASSET_DRAG);
        if (!internal && !isFilePathDrag(event.dataTransfer)) {
            if (editor.view.dragging || event.dataTransfer.types.includes(CHAPTER_DRAG)) event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const target = isBodyDrop(event) ? 'body' : 'assets';
        const accepted = !busyRef.current && !dialog && (!internal || target === 'body');
        event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
        setDropTarget(accepted ? target : null);
    };
    const handleAssetDrop = event => {
        const internal = event.dataTransfer.types.includes(ASSET_DRAG);
        if (!internal && !isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDropTarget(null);
        if (busyRef.current || dialog) return;
        const target = isBodyDrop(event) ? {
            chapterId: chapterRef.current,
            position: editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.doc.content.size,
        } : null;
        if (internal) {
            const asset = readAssetDrag(event.dataTransfer, initial.sessionId, projectRef.current.assets);
            if (asset) insertDroppedAssets([asset], target);
            else setNotice({ text: l('ASSET_MISSING') });
        } else {
            const paths = droppedPathsFromDataTransfer(event.dataTransfer);
            if (!paths.length) { setNotice({ text: l('INVALID_ASSET_PATH') }); return; }
            void importDroppedAssets(paths, target);
        }
    };
    const switchMode = async next => { await flush(); setMode(next); };
    const checkBook = async () => { const snapshot = await flush(); setIssues(inspectProject(snapshot)); };
    const find = () => {
        const matches = findEditorMatches(editor, query);
        const next = matches.find(match => match.from >= editor.state.selection.to) || matches[0];
        if (!next) { setNotice({ text: l('noMatches') }); return; }
        editor.chain().focus().setTextSelection(next).scrollIntoView().run();
    };
    const replace = all => {
        const matches = findEditorMatches(editor, query);
        if (!matches.length) { setNotice({ text: l('noMatches') }); return; }
        if (all) {
            let transaction = editor.state.tr;
            for (const match of matches.reverse()) transaction = replacement ? transaction.insertText(replacement, match.from, match.to) : transaction.delete(match.from, match.to);
            editor.view.dispatch(transaction);
        } else {
            const match = matches.find(item => item.from === editor.state.selection.from && item.to === editor.state.selection.to);
            if (match) editor.view.dispatch(replacement ? editor.state.tr.insertText(replacement, match.from, match.to) : editor.state.tr.delete(match.from, match.to));
            else find();
        }
    };
    const openFootnote = () => { setFootnoteText(editor.getAttributes('footnote').text || ''); setDialog('footnote'); };
    const editAction = fn => () => { setMode('design'); fn(); };
    const useParagraphFormat = format => {
        editor.commands.focus();
        const applied = applyParagraphFormat(editor, format);
        if (!applied) setNotice({ text: l('paragraphFormatUnavailable') });
        return applied;
    };
    const actions = {
        save: () => save(), saveAs: () => save(true), export: exportBook, inspect: checkBook,
        undo: () => editor.can().undo() ? editor.chain().focus().undo().run() : atomicHistoryAvailable('undo') && restoreStructure('undo'),
        redo: () => editor.can().redo() ? editor.chain().focus().redo().run() : atomicHistoryAvailable('redo') && restoreStructure('redo'),
        importText: openTextImport, splitChapter, mergeChapters: openMergeChapters,
        ...Object.fromEntries(['bold', 'italic', 'underline', 'strike'].map(key => [key, editAction(() => editor.chain().focus().toggleMark(key).run())])),
        ...Object.fromEntries(['superscript', 'subscript'].map(key => [key, editAction(() => { editor.commands.focus(); toggleScript(editor, key); })])),
        color: editAction(() => { if (editor.can().setColor('#000000')) setDialog('textColor'); }),
        textBackground: editAction(() => { if (editor.can().setBackgroundColor('#fff176')) setDialog('textBackground'); }),
        ...Object.fromEntries(['paragraphFormat', 'textStyles', 'highlight'].map(key => [key, editAction(() => stageRef.current?.parentElement.querySelector(`[data-editor-menu="${key}"]`)?.click())])),
        paragraphFormats: editAction(() => { setParagraphFormatSeed(null); setDialog('paragraphFormats'); }),
        paragraphFormatCreate: editAction(() => { setParagraphFormatSeed(paragraphFormatFromSelection(editor)); setDialog('paragraphFormats'); }),
        specialCharacters: editAction(() => setDialog('characters')), emoji: editAction(() => setDialog('emoji')),
        media: editAction(() => setDialog('media')), editMedia: editAction(() => setDialog('media')),
        openMedia: () => { const media = parseMediaUrl(editor.getAttributes('media').url); if (media) window.electronAPI?.openExternal?.(media.url); },
        paragraph: editAction(() => { if (editor.can().setParagraph()) editor.chain().focus().clearParagraphFormat().setParagraph().run(); }),
        ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [`heading${level}`, editAction(() => { if (editor.can().setHeading({ level })) editor.chain().focus().clearParagraphFormat().setHeading({ level }).run(); })])),
        ...Object.fromEntries(['left', 'center', 'right', 'justify'].map(key => [key, editAction(() => editor.chain().focus().setTextAlign(key).run())])),
        increaseIndent: editAction(() => editor.chain().focus().increaseParagraphIndent().run()),
        decreaseIndent: editAction(() => editor.chain().focus().decreaseParagraphIndent().run()),
        firstLineIndent: editAction(() => editor.chain().focus().setFirstLineIndent(1).run()),
        hangingIndent: editAction(() => editor.chain().focus().setFirstLineIndent(-1).run()),
        noFirstLineIndent: editAction(() => editor.chain().focus().setFirstLineIndent(0).run()),
        inheritFirstLineIndent: editAction(() => editor.chain().focus().setFirstLineIndent(null).run()),
        bulletList: editAction(() => editor.chain().focus().toggleBulletList().run()), orderedList: editAction(() => editor.chain().focus().toggleOrderedList().run()),
        blockquote: editAction(() => editor.chain().focus().toggleBlockquote().run()), codeBlock: editAction(() => editor.chain().focus().toggleCodeBlock().run()),
        reset: editAction(() => { editor.commands.focus(); clearAuthorFormatting(editor); }),
        horizontalRule: editAction(() => editor.chain().focus().setHorizontalRule().run()),
        columns: editAction(() => editor.chain().focus().insertContent({ type: 'columns', content: [1, 2].map(() => ({ type: 'column', content: [paragraph()] })) }).run()),
        addImage: editAction(() => addAsset('image')), addAudio: editAction(() => addAsset('audio')), addTable: editAction(() => setDialog('table')),
        templates: editAction(() => { commitEditor(); setDialog('templates'); }),
        footnote: editAction(openFootnote), selectCells: () => { if (editor.isActive('table')) setDialog('range'); },
        ...Object.fromEntries(tableCommands.map(key => [key, () => { if (editor.can()[key]()) editor.chain().focus()[key]().run(); }])),
        link: editAction(() => { if (!linkOpen) editor.commands.scrollIntoView(); setLinkValue(editor.getAttributes('link').href || 'https://'); setLinkOpen(value => !value); }),
        search: editAction(() => { setSearchOpen(true); requestAnimationFrame(() => stageRef.current?.parentElement.querySelector('.ee-search input')?.focus()); }),
        commonCss: () => { setSourceTab('commonCss'); switchMode('source'); }, chapterCss: () => { setSourceTab('chapterCss'); switchMode('source'); },
        source: () => { setSourceTab('source'); switchMode('source'); }, preview: () => switchMode('preview'), previewViewer: previewInViewer,
        shortcuts: () => setDialog('shortcuts'), toolbar: () => { if (!contextToolbarRef.current?.focus()) stageRef.current?.parentElement.querySelector('.ee-toolbar button:not(:disabled)')?.focus(); },
    };
    useEffect(() => {
        const keydown = event => {
            if (!stageRef.current?.getClientRects().length || event.isComposing || editor?.view.composing || event.getModifierState?.('AltGraph') || busyRef.current || dialog || event.target.closest('dialog, [popover]')) return;
            if (event.key === 'Escape' && event.target.closest('.ee-context-toolbar, .ee-block-trigger')) return;
            if (event.key === 'Escape' && event.target.closest('.tiptap')) { contextToolbarRef.current?.dismiss(); return; }
            if (event.key === 'Escape' && event.target.closest('.ee-toolbar, .ee-table-toolbar, .ee-search')) { setSearchOpen(false); setLinkOpen(false); editor.commands.focus(); return; }
            const command = Object.keys(shortcuts).find(key => matchesShortcut(event, shortcuts[key]));
            if (!command || !actions[command]) return;
            const global = ['save', 'saveAs', 'shortcuts', 'toolbar', 'importText', 'mergeChapters', 'previewViewer'].includes(command);
            if (!global && (!['write', 'design'].includes(mode) || !event.target.closest('.tiptap, .ee-toolbar, .ee-table-toolbar, .ee-context-toolbar') || event.target.closest('input, textarea, select'))) return;
            event.preventDefault();
            event.stopPropagation();
            actions[command]();
        };
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    });
    const previewSource = useMemo(() => {
        const doc = chapterXhtml(chapter, project, { inlineStyles: true, resolveAsset: asset => assetUrls.current[asset.id] || '' });
        return doc.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src blob: data:; font-src blob:; media-src blob:; style-src \'unsafe-inline\';" />');
    }, [chapter, project, assetUrls]);
    const outline = [];
    const linkTargets = [];
    if (linkOpen) for (const item of project.chapters) {
        linkTargets.push({ href: `epub:${item.id}`, title: item.title });
        walkDocument(item.content, node => {
            if (node.type === 'heading' && node.attrs?.id) linkTargets.push({ href: `epub:${item.id}#${node.attrs.id}`, title: `${item.title} › ${textContent(node) || l('heading')}` });
        });
    }
    editor?.state.doc.descendants((node, position) => {
        if (['heading', 'image', 'table', 'columns', 'audio', 'media', 'footnote'].includes(node.type.name)) outline.push({ node, position });
    });
    const status = dirty || project.revision > recoveryRevision ? 'unsaved' : project.revision === savedRevision ? 'saved' : 'recovered';
    const s = project.style;
    const paperStyle = { '--book-font': s.font, '--book-size': `${s.fontSize}px`, '--book-line': s.lineHeight, '--book-gap': `${s.paragraphGap}em`, '--book-indent': `${s.indent}em`, '--book-color': s.color, '--book-accent': s.accent, '--book-bg': s.background, '--book-heading': `${s.headingScale}em`, zoom: zoom / 100 };
    if (!editor) return <div className="ee-loading">{l('working')}</div>;
    const linkForm = linkOpen ? <form className="ee-link-form" onSubmit={event => { event.preventDefault(); if (!safeLink(linkValue)) { setNotice({ text: l('INVALID_LINK') }); return; } const chain = editor.chain().focus().extendMarkRange('link'); if (editor.state.selection.empty && !editor.isActive('link')) chain.insertContent({ type: 'text', text: linkTargets.find(item => item.href === linkValue)?.title || linkValue, marks: [{ type: 'link', attrs: { href: linkValue } }] }); else chain.setLink({ href: linkValue }); chain.run(); setLinkOpen(false); }}><input aria-label={l('linkTarget')} placeholder={l('external')} value={linkValue.startsWith('epub:') ? '' : linkValue} onChange={event => setLinkValue(event.target.value)} /><select aria-label={l('internal')} value={linkValue.startsWith('epub:') ? linkValue : ''} onChange={event => setLinkValue(event.target.value)}><option value="">{l('internal')}</option>{linkTargets.map(item => <option key={item.href} value={item.href}>{item.title}</option>)}</select><button className="ee-button" type="submit">{l('apply')}</button><button type="button" className="ee-button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>{l('unlink')}</button><IconButton icon="xmark" label={l('close')} onClick={() => { setLinkOpen(false); editor.view.focus(); }} /></form> : null;
    return <div className={`ee-studio${dropTarget ? ` is-drop-${dropTarget}` : ''}`} onDragEnter={handleAssetDragOver} onDragOver={handleAssetDragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDropCapture={handleAssetDrop} onDrop={event => { if (event.defaultPrevented) event.stopPropagation(); }}>
        <style>{project.assets.filter(asset => asset.kind === 'font').map(asset => `@font-face{font-family:font-${asset.id};src:url("${assetUrls.current[asset.id]}");}`).join('\n') + authoringCss('.ee-paper .tiptap ') + authoringCss('.ee-format-menu ')}</style>
        <header className="ee-header">
            <IconButton icon="chevronLeft" label={l('back')} disabled={!!busy} onClick={() => leave(onBack)} />
            <div className="ee-book-identity"><span className="ee-book-mark"><FaIcon name="bookOpen" size={18} /></span><div><strong>{project.metadata.title || l('newBook')}</strong><small className={`ee-save-status is-${status}`}>{l(status)}</small></div></div>
            <div className="ee-header-actions"><button className="ee-button" title={shortcutLabel('shortcuts')} onClick={actions.shortcuts}><EditorIcon command="shortcuts" />{l('shortcuts')}</button><button className="ee-button" disabled={!!busy} onClick={() => leave(onHome)}>{l('leave')}</button><button className="ee-button" disabled={!!busy} title={shortcutLabel('save')} onClick={() => save()}><FaIcon name="floppy" />{l('save')}</button><IconButton icon="copy" label={`${l('saveAs')} (${shortcutLabel('saveAs')})`} disabled={!!busy} onClick={() => save(true)} /><button className="ee-button" disabled={!!busy} title={shortcutLabel('inspect')} onClick={checkBook}><FaIcon name="circleCheck" />{l('inspect')}</button><button className="ee-button ee-primary" disabled={!!busy} title={shortcutLabel('export')} onClick={exportBook}><FaIcon name="download" />{l('export')}</button></div>
        </header>
        <Notice value={notice} onClose={() => setNotice(null)} />
        {importResult && <section className="ee-import-result" role="status"><div className="ee-section-heading"><p>{importResult.assets.length} {l('assetsImported')}</p><IconButton icon="xmark" label={l('close')} onClick={() => setImportResult(null)} /></div>{importResult.rejected.length > 0 && <><p>{l('assetsRejected')}</p><ul>{importResult.rejected.map((item, index) => <li key={index}>{item.name || l('file')} — {l(item.code)}</li>)}</ul></>}</section>}
        <div className={`ee-workspace${showStructure ? '' : ' without-structure'}${showInspector ? '' : ' without-inspector'}`} inert={busy ? '' : undefined}>
            <aside className="ee-sidebar" hidden={!showStructure}><div className="ee-panel-tabs" role="tablist" aria-label={l('chapters')}>{['chapters', 'outline', 'assets'].map(tab => <button key={tab} role="tab" aria-selected={leftTab === tab} onClick={() => setLeftTab(tab)}>{l(tab)}</button>)}</div>
                <div className={`ee-panel-body${leftTab === 'chapters' ? ' is-chapters' : ''}`}>
                    {leftTab === 'chapters' && <>
                        <div className="ee-section-heading"><h3>{l('chapters')} <span>{project.chapters.length}</span></h3><IconButton icon="plus" label={l('addChapter')} onClick={async () => { const item = createChapter(`${l('chapter')} ${project.chapters.length + 1}`); await changeStructure(items => [...items, item]); await selectChapter(item.id); }} /></div>
                        <div className="ee-chapter-import-actions"><button className="ee-button" title={shortcutLabel('importText')} onClick={actions.importText}><EditorIcon command="importText" />{l('importText')}</button><button className="ee-button" title={shortcutLabel('splitChapter')} disabled={!['write', 'design'].includes(mode)} onMouseDown={event => event.preventDefault()} onClick={actions.splitChapter}><EditorIcon command="splitChapter" />{l('splitChapter')}</button><button className="ee-button" title={shortcutLabel('mergeChapters')} disabled={project.chapters.length < 2} onClick={actions.mergeChapters}><EditorIcon command="mergeChapters" />{l('mergeChapters')}</button></div>
                        <div className="ee-chapter-list" {...chapterDrag.listProps}>{project.chapters.map((item, index) => <button key={item.id} {...chapterDrag.rowProps(item.id)} className={`ee-chapter${chapter.id === item.id ? ' is-active' : ''}${chapterDrag.rowClass(item.id)}`} onClick={() => selectChapter(item.id)}><span className="ee-chapter-number">{String(index + 1).padStart(2, '0')}</span><span>{item.title || l('chapter')}<small>{chapterCharacters(item.content).toLocaleString()} {l('chars')}</small></span><FaIcon name="gripVertical" size={10} /></button>)}</div>
                        <div className="ee-chapter-actions"><IconButton icon="copy" label={l('duplicate')} onClick={async () => { await flush(); const original = projectRef.current.chapters.find(item => item.id === chapterRef.current); const copy = duplicateChapter(original); copy.title += ' (2)'; await changeStructure(items => { const next = [...items]; next.splice(items.findIndex(item => item.id === original.id) + 1, 0, copy); return next; }); await selectChapter(copy.id); }} />{[-1, 1].map(direction => <IconButton key={direction} icon={direction < 0 ? 'angleUp' : 'angleDown'} label={l(direction < 0 ? 'moveUp' : 'moveDown')} disabled={project.chapters.findIndex(item => item.id === chapter.id) + direction < 0 || project.chapters.findIndex(item => item.id === chapter.id) + direction >= project.chapters.length} onClick={() => changeStructure(items => { const next = [...items]; const index = next.findIndex(item => item.id === chapter.id); [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; })} />)}<IconButton icon="trash" label={l('remove')} disabled={project.chapters.length < 2} onClick={() => { if (window.confirm(l('deleteChapter'))) changeStructure(items => items.filter(item => item.id !== chapter.id)); }} /></div>
                        <div className="ee-chapter-actions"><IconButton icon="rotateLeft" label={l('undoBook')} disabled={!history.current.undo.length} onClick={() => restoreStructure('undo')} /><IconButton icon="rotateRight" label={l('redoBook')} disabled={!history.current.redo.length} onClick={() => restoreStructure('redo')} /></div>
                    </>}
                    {leftTab === 'outline' && <><h3>{chapter.title}</h3>{outline.map(({ node, position }) => <button className="ee-outline-item" key={position} onClick={() => { setMode('design'); editor.chain().focus().setNodeSelection(position).scrollIntoView().run(); }}><FaIcon name={node.type.name === 'image' ? 'image' : node.type.name === 'table' ? 'tableCells' : 'layers'} /><span>{node.type.name === 'heading' ? node.textContent || l('heading') : l(node.type.name)}</span></button>)}</>}
                    {leftTab === 'assets' && <>
                        <h3>{l('assets')}</h3>
                        <div className="ee-asset-actions">
                            <button className="ee-button" onClick={() => addAsset('image')}><FaIcon name="image" />{l('addImage')}</button>
                            <button className="ee-button" onClick={() => addAsset('font')}><FaIcon name="file" />{l('addFont')}</button>
                            <button className="ee-button" onClick={actions.addAudio}><EditorIcon command="addAudio" />{l('addAudio')}</button>
                        </div>
                        <div className="ee-asset-drop-zone"><FaIcon name="download" /><span>{l('dropIntoAssets')}</span><small>PNG · JPEG · MP3 · M4A · TTF · OTF · WOFF · WOFF2</small></div>
                        <p className="ee-muted">{l(project.assets.length ? 'assetHint' : 'noAssets')}</p>
                        <div className="ee-assets">{project.assets.map(asset => <button
                            key={asset.id}
                            aria-label={asset.name}
                            title={asset.kind === 'font' ? asset.name : `${asset.name} · ${l('assetDragHint')}`}
                            draggable={asset.kind === 'image' || asset.kind === 'audio'}
                            onDragStart={event => {
                                event.dataTransfer.setData(ASSET_DRAG, JSON.stringify({ sessionId: initial.sessionId, assetId: asset.id }));
                                event.dataTransfer.effectAllowed = 'copy';
                            }}
                            onClick={() => {
                                setMode('design');
                                if (asset.kind === 'image') editor.chain().focus().insertContent({ type: 'image', attrs: { assetId: asset.id, width: 100, align: 'center', alt: '' } }).run();
                                else if (asset.kind === 'audio') editor.chain().focus().insertContent({ type: 'audio', attrs: { assetId: asset.id, title: asset.name, kind: 'effect', loop: false } }).run();
                                else update(current => ({ ...current, style: { ...current.style, font: `font-${asset.id}` } }));
                            }}
                        >{asset.kind === 'image' ? <img draggable={false} src={assetUrls.current[asset.id]} alt="" /> : <strong style={{ fontFamily: `font-${asset.id}` }}>{asset.kind === 'audio' ? <EditorIcon command="addAudio" /> : 'Aa'}</strong>}<span>{asset.name}</span></button>)}</div>
                    </>}
                </div>
                <button className="ee-sidebar-book" onClick={() => setRightTab('book')}><FaIcon name="book" />{l('book')}<FaIcon name="chevronRight" size={10} /></button>
            </aside>
            <main className={`ee-main is-${mode}`}>
                <div className="ee-mode-bar">
                    <IconButton icon="list" label={l('toggleStructure')} active={showStructure} aria-expanded={showStructure} onClick={() => setShowStructure(value => !value)} />
                    <div className="ee-modes" role="tablist" aria-label={l('editor')}>{['write', 'design', 'preview', 'source'].map(value => <React.Fragment key={value}><button role="tab" aria-selected={mode === value} onClick={() => switchMode(value)}><EditorIcon command={value} />{l(value)}</button>{value === 'preview' && <button type="button" disabled={!!busy} title={`${l('viewerPreviewHint')} (${shortcutLabel('previewViewer')})`} onClick={previewInViewer}><EditorIcon command="previewViewer" />{l('previewViewer')}</button>}</React.Fragment>)}</div>
                    {mode === 'preview' && <div className="ee-preview-sizes" role="group" aria-label={`${l('preview')} ${l('width')}`}>
                        {['narrow', 'medium', 'wide'].map(value => <button type="button" key={value} aria-pressed={viewport === value} onClick={() => setViewport(value)}><EditorIcon command={value} /><span>{l(value)}</span></button>)}
                    </div>}
                    {mode !== 'source' && <select className="ee-zoom" aria-label={l('zoom')} title={l('zoomHint')} value={zoom} onChange={event => { chapterScroll.enter(null); editorZoom.change(Number(event.target.value)); }}>{[...new Set([...ZOOM_PRESETS, zoom])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}%</option>)}</select>}
                    <IconButton icon="sliders" label={l('toggleInspector')} active={showInspector} aria-expanded={showInspector} onClick={() => setShowInspector(value => !value)} />
                </div>
                {['write', 'design'].includes(mode) && <>
                    <FeatureToolbar editor={editor} actions={actions} defaultColor={editor.isActive('heading') ? project.style.accent : project.style.color} canMergeChapters={project.chapters.length > 1} canUndoStructure={atomicHistoryAvailable('undo')} canRedoStructure={atomicHistoryAvailable('redo')} paragraphFormats={paragraphFormats} onApplyParagraphFormat={useParagraphFormat} />
                    {searchOpen && <div className="ee-search"><input aria-label={l('find')} placeholder={l('find')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') find(); }} /><input aria-label={l('replacement')} placeholder={l('replacement')} value={replacement} onChange={event => setReplacement(event.target.value)} /><button className="ee-button" onClick={find}>{l('next')}</button><button className="ee-button" onClick={() => replace(false)}>{l('replace')}</button><button className="ee-button" onClick={() => replace(true)}>{l('replaceAll')}</button><IconButton icon="xmark" label={l('close')} onClick={() => setSearchOpen(false)} /></div>}
                </>}
                <div className="ee-stage" ref={stageRef}>
                    {mode !== 'source' && (chapterIndex > 0 || mode === 'preview') && <button type="button" className="ee-chapter-boundary is-previous" disabled={chapterIndex === 0} onClick={() => navigateChapter(-1)}><FaIcon name="angleUp" /><span><strong>{l('previousChapter')}{chapterIndex > 0 && ` · ${project.chapters[chapterIndex - 1].title || l('chapter')}`}</strong><small>{l('scrollPreviousChapter')}</small></span></button>}
                    <div className="ee-paper" hidden={!['write', 'design'].includes(mode)} style={paperStyle}>
                        <div className="ee-paper-label">{String(project.chapters.findIndex(item => item.id === chapter.id) + 1).padStart(2, '0')} / {l('chapter')}</div>
                        <input className="ee-chapter-title" aria-label={l('chapterTitle')} placeholder={l('chapterTitle')} value={chapter.title} onChange={event => update(current => ({ ...current, chapters: current.chapters.map(item => item.id === chapter.id ? { ...item, title: event.target.value } : item) }))} />
                        <EditorContent editor={editor} />
                        {outline.some(item => item.node.type.name === 'footnote') && <section className="ee-footnotes"><h3>{l('footnote')}</h3>{outline.filter(item => item.node.type.name === 'footnote').map(({ node, position }, index) => <button key={node.attrs.id} onClick={() => { editor.commands.setNodeSelection(position); setFootnoteText(node.attrs.text); setDialog('footnote'); }}><sup>{index + 1}</sup><span>{node.attrs.text || l('FOOTNOTE_EMPTY')}</span></button>)}</section>}

                    </div>
                    {mode === 'preview' && <div className={`ee-preview is-${viewport}`} style={{ zoom: zoom / 100 }}><iframe key={chapter.id} title={l('preview')} sandbox="allow-same-origin" srcDoc={previewSource} onLoad={event => {
                        const doc = event.currentTarget.contentDocument;
                        chapterScroll.onPreviewLoad(event.currentTarget);
                        if (previewAnchor.current) { doc?.getElementById(previewAnchor.current)?.scrollIntoView(); previewAnchor.current = null; }
                        doc?.addEventListener('click', click => {
                            const anchor = click.target.closest('a');
                            if (!anchor) return;
                            click.preventDefault();
                            const match = /^([^/]+)\.xhtml(?:#(.+))?$/.exec(anchor.getAttribute('href'));
                            const local = anchor.getAttribute('href');
                            if (local?.startsWith('#')) { doc.getElementById(local.slice(1))?.scrollIntoView(); return; }
                            if (!match) { const media = parseMediaUrl(local); if (media) window.electronAPI?.openExternal?.(media.url); return; }
                            if (match[1] === chapterRef.current) { if (match[2]) doc.getElementById(match[2])?.scrollIntoView(); else doc.documentElement.scrollTop = 0; }
                            else { previewAnchor.current = match[2]; selectChapter(match[1]); }
                        });
                    }} /><p className="ee-muted">{l('readingHint')}</p></div>}
                    {mode === 'source' && <Suspense fallback={<p className="ee-muted">{l('working')}</p>}><SourceWorkspace codeStates={codeStates.current} project={project} chapter={chapter} tab={sourceTab} setTab={setSourceTab} update={update} onPreview={() => switchMode('preview')} onViewerPreview={previewInViewer} busy={!!busy} /></Suspense>}
                    {mode !== 'source' && (chapterIndex < project.chapters.length - 1 || mode === 'preview') && <button type="button" className="ee-chapter-boundary is-next" disabled={chapterIndex === project.chapters.length - 1} onClick={() => navigateChapter(1)}><FaIcon name="angleDown" /><span><strong>{l('nextChapter')}{chapterIndex < project.chapters.length - 1 && ` · ${project.chapters[chapterIndex + 1].title || l('chapter')}`}</strong><small>{l('scrollNextChapter')}</small></span></button>}
                </div>
                <ContextToolbar editor={editor} stageRef={stageRef} enabled={!busy && !dialog && ['write', 'design'].includes(mode)} actions={actions} defaultColor={editor.isActive('heading') ? project.style.accent : project.style.color} linkOpen={linkOpen} linkForm={linkForm} onCloseLink={() => setLinkOpen(false)} apiRef={contextToolbarRef} />
                <footer className="ee-document-footer"><span aria-live="polite">{chapterIndex + 1} / {project.chapters.length} · {chapter.title}</span><span>{chapterCharacters(chapter.content).toLocaleString()} {l('chars')}<i />EPUB 3</span></footer>
            </main>
            <Inspector hidden={!showInspector} tab={rightTab} setTab={setRightTab} project={project} update={update} editor={editor} chapter={chapter} assetUrls={assetUrls.current} onAddAsset={addAsset} onCss={actions.commonCss} onFootnote={openFootnote} onMedia={actions.media} onReset={actions.reset} />
        </div>
        {issues && <section className="ee-checks"><div className="ee-section-heading"><h3>{l('inspect')}<small>{l('checkHint')}</small></h3><IconButton icon="xmark" label={l('close')} onClick={() => setIssues(null)} /></div>{issues.length ? <div className="ee-check-list">{issues.map((issue, index) => <button key={index} className={`is-${issue.severity}`} onClick={async () => { if (issue.chapterId) await selectChapter(issue.chapterId); if (issue.code.startsWith('CSS_')) { setSourceTab(issue.chapterId ? 'chapterCss' : 'commonCss'); setMode('source'); } else { setMode('design'); setRightTab(issue.chapterId ? 'properties' : 'book'); } if (issue.nodeId) editor.state.doc.descendants((node, pos) => { if (node.attrs.id === issue.nodeId) editor.chain().focus().setNodeSelection(pos).scrollIntoView().run(); }); }}><span>{l(issue.severity === 'error' ? 'failure' : 'warning')}</span>{l(issue.code)}</button>)}</div> : <p>{l('checked')}</p>}</section>}
        {exportedPath && <div className="ee-export-result"><span>{exportedPath}</span><button className="ee-button" onClick={() => window.electronAPI?.openInternalViewer?.(exportedPath)}>{l('openResult')}</button></div>}
        {dialog === 'mergeChapters' && <MergeChaptersDialog chapters={project.chapters} chapterId={chapterId} onMerge={mergeChapters} onClose={() => setDialog(null)} />}
        {dialog === 'textImport' && <TextImportDialog readText={options => request({ action: 'readText', sessionId: initial.sessionId, operationId: newId('op'), ...options })} onApply={applyTextImport} onClose={() => setDialog(null)} />}
        {dialog === 'table' && <TablePicker onClose={() => setDialog(null)} onInsert={(rows, cols, withHeaderRow) => { setDialog(null); editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run(); }} />}
        {dialog === 'range' && <TableRangeDialog editor={editor} onClose={() => setDialog(null)} />}
        {dialog === 'shortcuts' && <ShortcutHelp actions={actions} onClose={() => setDialog(null)} />}
        {dialog === 'textColor' && <TextColorDialog editor={editor} defaultColor={editor.isActive('heading') ? project.style.accent : project.style.color} onClose={() => setDialog(null)} />}
        {dialog === 'paragraphFormats' && <ParagraphFormatsDialog editor={editor} seed={paragraphFormatSeed} selectedId={selectedParagraphFormat(editor)?.id} request={request} onLibrary={setParagraphFormats} onApply={useParagraphFormat} onClose={() => setDialog(null)} />}
        {dialog === 'textBackground' && <TextColorDialog editor={editor} background defaultColor={project.style.color} onClose={() => setDialog(null)} />}
        {['characters', 'emoji'].includes(dialog) && <CharacterDialog editor={editor} emoji={dialog === 'emoji'} onClose={() => setDialog(null)} />}
        {dialog === 'media' && <MediaDialog editor={editor} onClose={() => setDialog(null)} />}
        {dialog === 'templates' && <ContentTemplates editor={editor} chapterId={chapterId} chapterTitle={chapter.title} projectAssets={project.assets} projectUrls={assetUrls.current} request={payload => request({ ...payload, sessionId: initial.sessionId })} onClose={() => setDialog(null)} onInsert={async value => {
            const transaction = templateInsertionTransaction(editor.state, value.content, chapterId);
            await Promise.all(value.assets.map(loadAsset));
            if (value.assets.length) update(current => ({ ...current, assets: [...current.assets, ...value.assets] }));
            editor.view.dispatch(transaction);
            editor.view.dispatch(closeHistory(editor.state.tr));
            editor.commands.focus();
        }} />}
        {dialog === 'footnote' && <EditorDialog title={l('footnote')} onClose={() => setDialog(null)} onSubmit={event => { event.preventDefault(); if (editor.isActive('footnote')) editor.chain().focus().updateAttributes('footnote', { text: footnoteText }).run(); else editor.chain().focus().insertContent({ type: 'footnote', attrs: { id: newId(), text: footnoteText } }).run(); setDialog(null); }} footer={<button className="ee-button ee-primary" type="submit">{l('apply')}</button>}><p className="ee-muted">{l('footnoteHint')}</p><label className="ee-field"><span>{l('footnoteText')}</span><textarea rows={6} maxLength={20000} value={footnoteText} onChange={event => setFootnoteText(event.target.value)} autoFocus /></label></EditorDialog>}
        {busy && <div className="ee-busy" role="status"><FaIcon name="spinner" /><span>{l(busy === 'previewViewer' ? 'viewerPreviewPreparing' : 'working')}</span>{['save', 'export', 'previewViewer'].includes(busy) && <><progress max="100" value={progress} /><button className="ee-button" onClick={() => request({ action: 'cancel', operationId: operationRef.current }).catch(report)}>{l('cancel')}</button></>}</div>}
        {dropTarget && <div className="ee-drop-hint" role="status"><FaIcon name="download" /><span>{l(dropTarget === 'body' ? 'dropIntoBody' : 'dropIntoAssets')}</span></div>}
    </div>;
}
