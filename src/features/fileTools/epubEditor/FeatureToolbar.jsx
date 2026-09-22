import React, { useState } from 'react';
import { editorText as l } from './labels';
import { shortcutLabel } from './shortcuts';
import EditorDialog from './EditorDialog';
import EditorIcon from './EditorIcon';
import EditorTooltip from './EditorTooltip';
import { toolbarFocusIndex } from './contextTools';
import { indentSelectionState } from './paragraphIndent';
import { ParagraphMenu, StyleMenu, HighlightMenu } from './FormattingMenus';
import { canApplyScript } from './richFormatting';

export function CommandButton({ command, action, active, disabled, showLabel = false, ...props }) {
    const hint = shortcutLabel(command);
    return <EditorTooltip label={`${l(command)}${hint ? ` (${hint})` : ''}`}><button type="button" className={`ee-command${showLabel ? '' : ' is-icon-only'}${active ? ' is-active' : ''}`} aria-label={l(command)} aria-pressed={active == null ? undefined : active} disabled={disabled} onClick={action} {...props}><EditorIcon command={command} />{showLabel && <span>{l(command)}</span>}</button></EditorTooltip>;
}

export function IndentControls({ editor, actions }) {
    const state = indentSelectionState(editor.state);
    const choices = { inheritFirstLineIndent: null, noFirstLineIndent: 0, firstLineIndent: 1, hangingIndent: -1 };
    const selected = Object.keys(choices).find(key => choices[key] === state.firstLine) || 'custom';
    return <>
        <CommandButton command="decreaseIndent" action={actions.decreaseIndent} disabled={!state.canDecrease} />
        <CommandButton command="increaseIndent" action={actions.increaseIndent} disabled={!state.canIncrease} />
        <EditorTooltip label={l('paragraphIndentHint')}><select className="ee-indent-select" aria-label={l('firstLine')} disabled={!state.enabled} value={selected} onChange={event => actions[event.target.value]?.()}>
            {Object.keys(choices).map(key => <option key={key} value={key}>{l(key)}</option>)}
            {selected === 'custom' && <option value="custom" disabled>{state.firstLine === 'mixed' ? l('mixedIndent') : `${l('firstLine')}: ${state.firstLine}em`}</option>}
        </select></EditorTooltip>
    </>;
}

function FontControls({ editor, project }) {
    const textStyle = editor.getAttributes('textStyle');
    const fonts = [{ value: 'serif', name: l('serif') }, { value: 'sans-serif', name: l('sans') }, { value: 'monospace', name: l('mono') }, ...project.assets.filter(asset => asset.kind === 'font').map(asset => ({ value: `font-${asset.id}`, name: asset.name }))];
    const sizes = [...new Set([12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72].map(size => `${size}px`).concat(textStyle.fontSize || []))];
    return <div className="ee-command-group ee-font-controls" role="group" aria-label={l('font')}>
        <EditorTooltip label={l('selectionFontHint')}><select aria-label={l('font')} value={textStyle.fontFamily || ''} disabled={!editor.can().setFontFamily('serif')} onChange={event => event.target.value ? editor.chain().focus().setFontFamily(event.target.value).run() : editor.chain().focus().unsetFontFamily().run()}>
            <option value="">{l('defaultFont')}</option>
            {fonts.map(font => <option key={font.value} value={font.value}>{font.name}</option>)}
        </select></EditorTooltip>
        <EditorTooltip label={l('selectionFontHint')}><select className="ee-font-size" aria-label={l('fontSize')} value={textStyle.fontSize || ''} disabled={!editor.can().setFontSize('16px')} onChange={event => event.target.value ? editor.chain().focus().setFontSize(event.target.value).run() : editor.chain().focus().unsetFontSize().run()}>
            <option value="">{l('defaultFontSize')}</option>
            {sizes.map(size => <option key={size} value={size}>{size.replace('px', '')} px</option>)}
        </select></EditorTooltip>
    </div>;
}

export default function FeatureToolbar({ editor, actions, project, defaultColor = '#282923', canUndoStructure = false, canRedoStructure = false, canMergeChapters = false, paragraphFormats = [], onApplyParagraphFormat }) {
    const button = (command, active, showLabel = false) => <CommandButton key={command} command={command} action={actions[command]} active={active} showLabel={showLabel} />;
    const onKeyDown = event => {
        if (event.target.closest('[popover]')) return;
        if (event.target.tagName !== 'BUTTON' || event.altKey || event.metaKey || event.ctrlKey) return;
        const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), select:not(:disabled)')].filter(control => !control.closest('[popover], [hidden]'));
        const index = toolbarFocusIndex(controls.indexOf(event.target), event.key, controls.length);
        if (index >= 0) { event.preventDefault(); controls[index].focus(); }
    };
    return <div className="ee-toolbar ee-feature-toolbar" role="toolbar" aria-label={l('toolbarCategory')} onKeyDown={onKeyDown} onMouseDown={event => { if (event.target.closest('button')) event.preventDefault(); }}>
        <div className="ee-toolbar-section" role="group" aria-label={l('formatTools')}>
            <span className="ee-toolbar-label">{l('formatTools')}</span>
            <div className="ee-toolbar-panel">
                <div className="ee-command-group" role="group" aria-label={l('undo')}>
                    <CommandButton command="undo" action={actions.undo} disabled={!editor.can().undo() && !canUndoStructure} /><CommandButton command="redo" action={actions.redo} disabled={!editor.can().redo() && !canRedoStructure} />
                </div>
                <div className="ee-command-group" role="group" aria-label={l('format')}>
                    <ParagraphMenu editor={editor} actions={actions} formats={paragraphFormats} onApplyFormat={onApplyParagraphFormat} />
                    <StyleMenu editor={editor} />
                </div>
                <FontControls editor={editor} project={project} />
                <div className="ee-command-group" role="group" aria-label={l('format')}>
                    {['bold', 'italic', 'underline', 'strike'].map(key => button(key, editor.isActive(key)))}
                    {['superscript', 'subscript'].map(key => <CommandButton key={key} command={key} action={actions[key]} active={editor.isActive(key)} disabled={!canApplyScript(editor, key)} />)}
                    <CommandButton command="color" action={actions.color} disabled={!editor.can().setColor('#000000')} aria-haspopup="dialog" style={{ '--ee-text-color': editor.getAttributes('textStyle').color || defaultColor }} />
                    <CommandButton command="textBackground" action={actions.textBackground} disabled={!editor.can().setBackgroundColor('#fff176')} aria-haspopup="dialog" style={{ '--ee-text-color': editor.getAttributes('textStyle').backgroundColor || 'transparent' }} />
                    <HighlightMenu editor={editor} />
                    {button('reset')}
                </div>
                <div className="ee-command-group" role="group" aria-label={l('alignment')}>
                    {['left', 'center', 'right', 'justify'].map(key => button(key, editor.isActive({ textAlign: key })))}
                </div>
                <div className="ee-command-group" role="group" aria-label={l('paragraphIndent')}><IndentControls editor={editor} actions={actions} /></div>
                <div className="ee-command-group" role="group" aria-label={l('paragraph')}>
                    {['bulletList', 'orderedList', 'blockquote', 'codeBlock'].map(key => button(key, editor.isActive(key)))}
                </div>
            </div>
        </div>
        <div className="ee-toolbar-section" role="group" aria-label={l('insert')}>
            <span className="ee-toolbar-label">{l('insert')}</span>
            <div className="ee-toolbar-panel">
                <div className="ee-command-group" role="group" aria-label={l('insert')}>
                    {['templates', 'addImage', 'addTable', 'footnote', 'addAudio', 'media', 'specialCharacters', 'emoji', 'link', 'horizontalRule', 'columns'].map(key => button(key, undefined, ['templates', 'addImage', 'addTable', 'footnote', 'addAudio', 'media'].includes(key)))}
                </div>
                <div className="ee-command-group">{button('importText', undefined, true)}{button('splitChapter')}<CommandButton command="mergeChapters" action={actions.mergeChapters} disabled={!canMergeChapters} /></div>
                <div className="ee-command-group"><CommandButton command="search" action={actions.search} showLabel /><CommandButton command="shortcuts" action={actions.shortcuts} /></div>
            </div>
        </div>
    </div>;
}

export function ShortcutHelp({ actions, onClose }) {
    const [query, setQuery] = useState('');
    return <EditorDialog title={l('shortcuts')} onClose={onClose}>
        <p className="ee-muted">{l('shortcutHint')}</p>
        <details className="ee-tab-help" open>
            <summary>{l('tabHelp')}</summary>
            <ul>{['tabBodyHint', 'tabListHint', 'tabTableHint', 'tabCodeHint', 'tabSourceHint'].map(key => <li key={key}>{l(key)}</li>)}</ul>
        </details>
        <input className="ee-command-search" aria-label={l('findCommand')} placeholder={l('findCommand')} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="ee-shortcut-list">{Object.keys(actions).filter(key => key !== 'shortcuts' && l(key).toLowerCase().includes(query.toLowerCase())).map(command => <button className="ee-shortcut-item" key={command} onClick={() => { onClose(); requestAnimationFrame(() => actions[command]()); }}><span className="ee-shortcut-name"><EditorIcon command={command} />{l(command)}</span><kbd>{shortcutLabel(command)}</kbd></button>)}</div>
        <p className="ee-muted">{l('keyboardNavigation')}</p>
        <p className="ee-muted">{l('zoomHint')}</p>
        <p className="ee-muted">{l('autoformatHint')}</p>
    </EditorDialog>;
}
