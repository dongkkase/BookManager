import React, { useEffect, useState } from 'react';
import { editorText as l } from './labels';
import { STYLE_PRESETS, coverSvg } from '../../../../electron/epubEditor/model';

export function Field({ label, children }) {
    return <label className="ee-field"><span>{label}</span>{children}</label>;
}

export function NumberField({ label, value, min, max, step = 1, onChange }) {
    return <Field label={label}><div className="ee-range"><input type="range" aria-label={label} value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} /><output>{value}</output></div></Field>;
}

export function ColorField({ label, value, onChange }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return <div className="ee-field"><span>{label}</span><div className="ee-color-field">
        <input type="color" aria-label={label} value={value} onInput={event => onChange(event.target.value)} />
        <input type="text" aria-label={`${label} HEX`} spellCheck={false} maxLength={7} value={draft} onChange={event => { setDraft(event.target.value); if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value); }} onBlur={() => setDraft(value)} />
    </div></div>;
}

export function FontSelect({ project, value, onChange }) {
    return <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="serif">{l('serif')}</option><option value="sans-serif">{l('sans')}</option><option value="monospace">{l('mono')}</option>
        {project.assets.filter(asset => asset.kind === 'font').map(asset => <option key={asset.id} value={`font-${asset.id}`}>{asset.name}</option>)}
    </select>;
}

export default function Inspector({ hidden, tab, setTab, project, update, editor, chapter, assetUrls, onAddAsset, onCss, onChapterCss, onFootnote, onMedia, onFormat, editing }) {
    const patchStyle = patch => update(current => ({ ...current, style: { ...current.style, ...patch } }));
    const patchCover = patch => update(current => ({ ...current, cover: { ...current.cover, ...patch } }));
    const patchChapter = patch => update(current => ({ ...current, chapters: current.chapters.map(item => item.id === chapter.id ? { ...item, ...patch } : item) }));
    const selectedImage = editing && editor?.isActive('image');
    const audio = editing && editor?.isActive('audio') ? editor.getAttributes('audio') : null;
    const media = editing && editor?.isActive('media') ? editor.getAttributes('media') : null;
    const footnote = editing && editor?.isActive('footnote') ? editor.getAttributes('footnote') : null;
    const image = selectedImage ? editor.getAttributes('image') : null;
    const setImage = patch => editor.chain().updateAttributes('image', patch).run();
    const cell = editor?.isActive('tableHeader') ? editor.getAttributes('tableHeader') : editor?.getAttributes('tableCell') || {};
    const table = editing && editor?.isActive('table');
    const hasElement = !!(image || audio || media || footnote || table);
    const coverUrl = project.cover.mode === 'image' ? assetUrls[project.cover.assetId] : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(coverSvg(project))}`;
    return <aside className="ee-inspector" aria-label={l('inspector')} hidden={hidden} onKeyDown={event => {
        if (editing && !event.isComposing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editor.commands.focus(); }
    }}>
        <div className="ee-panel-tabs" role="tablist" aria-label={l('inspector')}>
            {['properties', 'styles', 'book'].map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{l(name === 'properties' ? 'chapterAndElement' : name === 'styles' ? 'bookDefaults' : name)}</button>)}
        </div>
        <div className="ee-panel-body">
            {tab === 'properties' && <>
                {hasElement ? <section className="ee-element-properties" data-element-properties>
                    <h3>{l('selection')}<span>{l(media ? 'media' : audio ? 'audio' : footnote ? 'footnote' : image ? 'image' : 'table')}</span></h3>
                    {media ? <>
                        <p className="ee-note-text">{media.title || media.url}</p>
                        <p className="ee-muted">{l('mediaExportHint')}</p>
                        <button className="ee-button" onClick={onMedia}>{l('editMedia')}</button>
                        <button className="ee-button ee-danger" onClick={() => editor.commands.deleteSelection()}>{l('remove')}</button>
                    </> : audio ? <>
                        <Field label={l('audioTitle')}><input value={audio.title} onChange={event => editor.commands.updateAttributes('audio', { title: event.target.value })} /></Field>
                        <Field label={l('audioKind')}><select value={audio.kind} onChange={event => editor.commands.updateAttributes('audio', { kind: event.target.value })}><option value="effect">{l('effect')}</option><option value="background">{l('backgroundAudio')}</option></select></Field>
                        <label className="ee-check"><input type="checkbox" checked={audio.loop} onChange={event => editor.commands.updateAttributes('audio', { loop: event.target.checked })} />{l('loop')}</label>
                        <p className="ee-muted">{l('audioHint')}</p>
                        <button className="ee-button ee-danger" onClick={() => editor.commands.deleteSelection()}>{l('remove')}</button>
                    </> : footnote ? <>
                        <p className="ee-muted">{l('footnoteHint')}</p>
                        <p className="ee-note-text">{footnote.text}</p>
                        <button className="ee-button" onClick={onFootnote}>{l('footnoteText')}</button>
                        <button className="ee-button ee-danger" onClick={() => editor.commands.deleteSelection()}>{l('remove')}</button>
                    </> : image ? <>
                        <NumberField label={l('width')} value={image.width} min={10} max={100} onChange={width => setImage({ width })} />
                        <Field label={l('alt')}><textarea rows={3} value={image.alt} disabled={image.decorative} onChange={event => setImage({ alt: event.target.value })} /></Field>
                        <label className="ee-check"><input type="checkbox" checked={image.decorative} onChange={event => setImage({ decorative: event.target.checked })} />{l('decorative')}</label>
                        <Field label={l('caption')}><input value={image.caption} onChange={event => setImage({ caption: event.target.value })} /></Field>
                        <button className="ee-button ee-danger" onClick={() => editor.chain().deleteSelection().run()}>{l('remove')}</button>
                    </> : null}
                    {table && <>
                        <p className="ee-muted">{l('tableSelectionHint')}</p>
                        <ColorField label={l('cellBackground')} value={cell.backgroundColor || '#ffffff'} onChange={value => editor.commands.setCellAttribute('backgroundColor', value)} />
                        <button className="ee-button" onClick={() => editor.commands.setCellAttribute('backgroundColor', null)}>{l('clearCellBackground')}</button>
                        <Field label={l('verticalAlign')}><select value={cell.verticalAlign || 'top'} onChange={event => editor.commands.setCellAttribute('verticalAlign', event.target.value)}>{['top', 'middle', 'bottom'].map(key => <option value={key} key={key}>{l(key)}</option>)}</select></Field>
                        <NumberField label={l('cellPadding')} min={0} max={32} value={cell.cellPadding ?? 9} onChange={value => editor.commands.setCellAttribute('cellPadding', value)} />
                    </>}
                </section> : <div className="ee-inspector-guide">
                    <p>{l(editing ? 'textFormattingLocation' : 'elementEditingLocation')}</p>
                    {editing && <button type="button" className="ee-button" onClick={onFormat}>{l('focusTextFormatting')}</button>}
                </div>}
                <section className="ee-property-section"><h3>{l('currentChapterSettings')}</h3><p className="ee-inspector-chapter">{chapter.title || l('chapter')}</p>
                    <label className="ee-check"><input type="checkbox" checked={chapter.inToc} onChange={event => patchChapter({ inToc: event.target.checked })} />{l('inToc')}</label>
                    <Field label={l('tocTitle')}><input disabled={!chapter.inToc} value={chapter.tocTitle} placeholder={chapter.title} onChange={event => patchChapter({ tocTitle: event.target.value })} /></Field>
                    <button type="button" className="ee-button" onClick={onChapterCss}>{l('chapterCss')}</button>
                </section>
            </>}
            {tab === 'styles' && <>
                <h3>{l('bookDefaults')}</h3><p className="ee-muted">{l('bookDefaultsHint')}</p>
                <div className="ee-style-presets">{Object.entries(STYLE_PRESETS).map(([name, style]) => <button key={name} style={{ '--preset-color': style.accent, '--preset-bg': style.background }} onClick={() => patchStyle(style)}><strong>Aa</strong><span>{l(name)}</span></button>)}</div>
                <Field label={l('font')}><FontSelect project={project} value={project.style.font} onChange={font => patchStyle({ font })} /></Field>
                <button className="ee-button" onClick={() => onAddAsset('font')}>{l('addFont')}</button>
                {[['fontSize', 10, 32, 1], ['lineHeight', 1, 3, 0.05], ['paragraphGap', 0, 3, 0.1], ['indent', 0, 3, 0.1], ['headingScale', 1, 3, 0.1]].map(([key, min, max, step]) => <NumberField key={key} label={l(key)} value={project.style[key]} min={min} max={max} step={step} onChange={value => patchStyle({ [key]: value })} />)}
                {['color', 'accent', 'background'].map(key => <ColorField key={key} label={l(key)} value={project.style[key]} onChange={value => patchStyle({ [key]: value })} />)}
                <section className="ee-property-section"><h3>{l('commonCss')}</h3><p className="ee-muted">{l('commonCssScopeHint')}</p><button type="button" className="ee-button" onClick={onCss}>{l('commonCss')}</button></section>
            </>}
            {tab === 'book' && <>
                <h3>{l('book')}</h3>
                {['title', 'author', 'language', 'publisher', 'date', 'description', 'rights', 'isbn'].map(key => <Field key={key} label={l(key)}>{key === 'description' ? <textarea rows={3} value={project.metadata[key]} onChange={event => update(current => ({ ...current, metadata: { ...current.metadata, [key]: event.target.value } }))} /> : <input type={key === 'date' ? 'date' : 'text'} value={project.metadata[key]} onChange={event => update(current => ({ ...current, metadata: { ...current.metadata, [key]: event.target.value } }))} />}</Field>)}
                <section className="ee-property-section"><h3>{l('cover')}</h3>
                    <Field label={l('cover')}><select value={project.cover.mode} onChange={event => patchCover({ mode: event.target.value })}><option value="design">{l('coverDesign')}</option><option value="image">{l('coverImage')}</option><option value="none">{l('noCover')}</option></select></Field>
                    {project.cover.mode === 'design' && <>
                        <Field label={l('subtitle')}><input value={project.cover.subtitle} maxLength={300} onChange={event => patchCover({ subtitle: event.target.value })} /></Field>
                        {['background', 'color'].map(key => <ColorField key={key} label={l(key)} value={project.cover[key]} onChange={value => patchCover({ [key]: value })} />)}
                    </>}
                    {project.cover.mode === 'image' && <><Field label={l('coverImage')}><select value={project.cover.assetId} onChange={event => patchCover({ assetId: event.target.value })}><option value="">—</option>{project.assets.filter(asset => asset.kind === 'image').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field><button className="ee-button" onClick={() => onAddAsset('image', true)}>{l('addImage')}</button></>}
                    {project.cover.mode !== 'none' && coverUrl && <img className="ee-cover-preview" src={coverUrl} alt={l('cover')} />}
                </section>
            </>}
        </div>
    </aside>;
}
