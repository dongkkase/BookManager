import React, { useEffect, useId, useRef, useState } from 'react';
import EditorIcon from './EditorIcon';
import EditorTooltip from './EditorTooltip';
import { editorText as l } from './labels';
import { shortcutLabel } from './shortcuts';
import { BLOCK_STYLES, INLINE_STYLES, HIGHLIGHTS } from '../../../../electron/epubEditor/authoring';
import { applyBlockStyle, applyPresetMark, styledBlockPositions } from './richFormatting';
import { canApplyParagraphFormat, selectedParagraphFormat } from './paragraphFormats';
import { paragraphFormatStyle } from '../../../../electron/epubEditor/paragraphFormats';

function ToolbarMenu({ command, label, children, disabled = false, iconOnly = false }) {
    const id = useId();
    const trigger = useRef(null);
    const popup = useRef(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const element = popup.current;
        const toggle = event => setOpen(event.newState === 'open');
        element.addEventListener('toggle', toggle);
        return () => element.removeEventListener('toggle', toggle);
    }, []);
    const close = () => popup.current.hidePopover();
    const position = () => {
        if (!popup.current.matches(':popover-open')) return;
        const rect = trigger.current.getBoundingClientRect();
        const menu = popup.current;
        menu.style.maxHeight = `${Math.max(120, window.innerHeight - 24)}px`;
        const size = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, rect.left))}px`;
        menu.style.top = `${Math.max(8, Math.min(window.innerHeight - size.height - 8, rect.bottom + 5))}px`;
    };
    useEffect(() => {
        if (!open) return;
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
    }, [open]);
    const show = () => {
        if (popup.current.matches(':popover-open')) { close(); return; }
        popup.current.showPopover();
        position();
        (popup.current.querySelector('[aria-checked="true"]') || popup.current.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
    };
    const keydown = event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current.focus(); return; }
        if (event.key === 'Tab') { close(); trigger.current.focus(); return; }
        const buttons = [...popup.current.querySelectorAll('button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (current + 1) % buttons.length : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (current - 1 + buttons.length) % buttons.length : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
    };
    const choose = action => { close(); action(); };
    return <>
        <EditorTooltip label={`${l(command)}${shortcutLabel(command) ? ` (${shortcutLabel(command)})` : ''}`}><button ref={trigger} type="button" data-editor-menu={command} className={`ee-command ee-menu-trigger${iconOnly ? ' is-icon-only' : ''}`} aria-label={l(command)} aria-haspopup="menu" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={show} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); show(); } }}><EditorIcon command={command} />{!iconOnly && <span>{label || l(command)}</span>}<span aria-hidden="true">▾</span></button></EditorTooltip>
        <div id={id} ref={popup} popover="auto" className="ee-format-menu" role="menu" aria-label={l(command)} onKeyDown={keydown} onMouseDown={event => event.stopPropagation()}>{children(choose)}</div>
    </>;
}

export function ParagraphMenu({ editor, actions, formats = [], onApplyFormat }) {
    const selected = editor.isActive('heading') ? `heading${editor.getAttributes('heading').level}` : editor.isActive('codeBlock') ? 'codeBlock' : editor.isActive('blockquote') ? 'blockquote' : 'paragraph';
    const custom = selectedParagraphFormat(editor);
    return <ToolbarMenu command="paragraphFormat" label={custom?.name || l(selected)}>
        {choose => <>
            {['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'blockquote', 'codeBlock'].map(command => <button type="button" key={command} role="menuitemradio" aria-checked={!custom && selected === command} className={`ee-format-option is-${command}`} onClick={() => choose(actions[command])}><span>{l(command)}</span><kbd>{shortcutLabel(command)}</kbd></button>)}
            {formats.length > 0 && <div className="ee-menu-heading">{l('customParagraphFormats')}</div>}
            {formats.map(format => {
                const style = paragraphFormatStyle(format);
                return <button type="button" key={format.id} role="menuitemradio" aria-checked={custom?.id === format.id} disabled={!canApplyParagraphFormat(editor, format)} onClick={() => choose(() => onApplyFormat(format))}><span className="ee-format-name" style={{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle, fontSize: `${Math.min(24, format.fontSize || 14)}px` }}>{format.name}</span></button>;
            })}
            {actions.paragraphFormats && <div className="ee-format-management">
                <button type="button" role="menuitem" onClick={() => choose(actions.paragraphFormatCreate)}><EditorIcon command="paragraphFormatCreate" />{l('paragraphFormatCreate')}</button>
                <button type="button" role="menuitem" onClick={() => choose(actions.paragraphFormats)}><EditorIcon command="paragraphFormats" />{l('paragraphFormats')}</button>
            </div>}
        </>}
    </ToolbarMenu>;
}

export function StyleMenu({ editor }) {
    const block = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').blockStyle;
    const runBlock = preset => { editor.commands.focus(); applyBlockStyle(editor, preset); };
    const runInline = preset => { editor.commands.focus(); applyPresetMark(editor, 'inlineStyle', preset); };
    return <ToolbarMenu command="textStyles">{choose => <>
        <div className="ee-menu-heading">{l('blockStyles')}</div>
        <button type="button" role="menuitem" onClick={() => choose(() => runBlock(null))}>{l('clearBlockStyle')}</button>
        {Object.keys(BLOCK_STYLES).map(preset => <button type="button" role="menuitemcheckbox" key={preset} aria-checked={block === preset} disabled={!styledBlockPositions(editor.state).size} onClick={() => choose(() => runBlock(block === preset ? null : preset))}><span className={`ee-style-sample bm-style-${preset}`}>{l(`style_${preset}`)}</span></button>)}
        <div className="ee-menu-heading">{l('inlineStyles')}</div>
        <button type="button" role="menuitem" onClick={() => choose(() => runInline(null))}>{l('clearInlineStyle')}</button>
        {Object.keys(INLINE_STYLES).map(preset => <button type="button" role="menuitemcheckbox" key={preset} aria-checked={editor.isActive('inlineStyle', { preset })} disabled={!editor.can().setMark('inlineStyle', { preset })} onClick={() => choose(() => runInline(editor.isActive('inlineStyle', { preset }) ? null : preset))}><span className={`ee-style-sample bm-style-${preset}`}>{l(`style_${preset}`)}</span></button>)}
    </>}</ToolbarMenu>;
}

export function HighlightMenu({ editor }) {
    return <ToolbarMenu command="highlight" iconOnly disabled={!editor.can().setMark('highlight', { preset: 'yellowMarker' })}>{choose => <>
        {Object.entries(HIGHLIGHTS).map(([preset, style]) => <button type="button" role="menuitemradio" key={preset} aria-checked={editor.isActive('highlight', { preset })} onClick={() => choose(() => { editor.commands.focus(); applyPresetMark(editor, 'highlight', preset); })}><span className="ee-highlight-sample" aria-hidden="true" style={{ backgroundColor: style.background, color: style.color }}>Ab</span>{l(preset)}</button>)}
        <button type="button" role="menuitem" onClick={() => choose(() => { editor.commands.focus(); applyPresetMark(editor, 'highlight', null); })}><EditorIcon command="reset" />{l('clearHighlight')}</button>
    </>}</ToolbarMenu>;
}
