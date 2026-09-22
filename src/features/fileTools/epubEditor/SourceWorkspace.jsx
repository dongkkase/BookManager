import React, { useMemo, useRef, useState } from 'react';
import CodeEditor from './CodeEditor';
import EditorIcon from './EditorIcon';
import CssPresets from './CssPresets';
import { editorText as l } from './labels';
import { chapterXhtml } from '../../../../electron/epubEditor/model';
import { inspectCss } from '../../../../electron/epubEditor/css';

export default function SourceWorkspace({ codeStates, project, chapter, tab, setTab, update, onPreview, onViewerPreview, busy }) {
    const code = useRef(null);
    const [presets, setPresets] = useState(null);
    const [applied, setApplied] = useState(false);
    const value = tab === 'commonCss' ? project.commonCss || '' : tab === 'chapterCss' ? chapter.css || '' : chapterXhtml(chapter, project);
    const error = useMemo(() => tab === 'source' ? null : inspectCss(value).error, [tab, value]);
    return <div className="ee-source">
        <div className="ee-source-tabs" role="tablist" aria-label={l('source')}>
            {['source', 'commonCss', 'chapterCss'].map(key => <button className="ee-button" key={key} role="tab" aria-selected={tab === key} onClick={() => { setApplied(false); setTab(key); }}><EditorIcon command={key} />{l(key)}</button>)}
            <button className="ee-button" onClick={onPreview}><EditorIcon command="preview" />{l('preview')}</button>
            <button className="ee-button" disabled={busy} title={l('viewerPreviewHint')} onClick={onViewerPreview}><EditorIcon command="previewViewer" />{l('previewViewer')}</button>
        </div>
        <p className="ee-muted">{l(tab === 'source' ? 'sourceHint' : 'cssHint')}</p>
        {tab !== 'source' && <div className="ee-preset-launchers">
            <button type="button" className="ee-button" onClick={() => setPresets({})}><EditorIcon command="commonCss" />{l('cssPresets')}</button>
            <button type="button" className="ee-button" disabled={!value.trim()} onClick={() => setPresets({ css: code.current?.selectedText() || value })}><EditorIcon command="save" />{l('presetRegister')}</button>
            <span className="ee-muted">{l('presetRegisterHint')}</span>
        </div>}
        {applied && <p className="ee-muted" role="status">{l('presetApplied')}</p>}
        {error ? <p className="ee-code-error" role="status">{l(error.code)} · {error.line}:{error.column}</p> : tab !== 'source' && <p className="ee-muted">{l('cssReady')}</p>}
        <CodeEditor apiRef={code} states={codeStates} stateKey={`${tab}-${tab === 'commonCss' ? project.id : chapter.id}`} key={`${tab}-${tab === 'commonCss' ? project.id : chapter.id}`} label={l(tab)} language={tab === 'source' ? 'html' : 'css'} readOnly={tab === 'source'} value={value} onChange={tab === 'source' ? undefined : css => update(current => tab === 'commonCss' ? { ...current, commonCss: css } : { ...current, chapters: current.chapters.map(item => item.id === chapter.id ? { ...item, css } : item) })} />
        {presets && <CssPresets initialCss={presets.css} currentCss={value} targetLabel={tab === 'commonCss' ? l('commonCss') : `${l('chapterCss')} · ${chapter.title}`} onClose={() => setPresets(null)} onApply={css => { code.current?.replace(css); setPresets(null); setApplied(true); requestAnimationFrame(() => code.current?.focus()); }} />}
    </div>;
}
