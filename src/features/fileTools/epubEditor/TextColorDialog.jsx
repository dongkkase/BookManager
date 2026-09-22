import React, { useEffect, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { BASIC_TEXT_COLORS, CUSTOM_COLOR_LIMIT, normalizeHexColor, readCustomColors, saveCustomColor, deleteCustomColor, applyTextColor } from './textColors';

export default function TextColorDialog({ editor, defaultColor, onClose, background = false }) {
    const label = background ? 'textBackground' : 'color';
    const initial = normalizeHexColor(editor.getAttributes('textStyle')[background ? 'backgroundColor' : 'color']) || (background ? '#fff176' : defaultColor);
    const [draft, setDraft] = useState(initial);
    const [colors, setColors] = useState(() => readCustomColors());
    const [slot, setSlot] = useState(null);
    const [notice, setNotice] = useState(null);
    const input = useRef(null);
    useEffect(() => { input.current?.focus(); }, []);
    const color = normalizeHexColor(draft);
    const count = colors.filter(Boolean).length;
    const apply = value => {
        editor.commands.focus();
        if (applyTextColor(editor, value, background)) onClose();
    };
    const save = () => {
        try {
            const next = saveCustomColor(window.localStorage, colors, color, slot);
            setColors(next.colors);
            setSlot(next.slot);
            setNotice(next.existing ? 'colorAlreadySaved' : 'colorSaved');
        } catch (error) { setNotice(['COLOR_LIMIT', 'COLOR_INVALID'].includes(error.message) ? error.message : 'COLOR_STORAGE_FAILED'); }
    };
    const remove = () => {
        try {
            setColors(deleteCustomColor(window.localStorage, colors, slot));
            setNotice('colorDeleted');
        } catch { setNotice('COLOR_STORAGE_FAILED'); }
    };
    const navigate = (event, columns) => {
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const current = buttons.indexOf(event.target);
        if (current < 0) return;
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : offsets[event.key] == null ? null : Math.max(0, Math.min(buttons.length - 1, current + offsets[event.key]));
        if (next != null) { event.preventDefault(); buttons[next].focus(); }
    };
    return <EditorDialog title={l(label)} onClose={onClose} className="ee-text-color-dialog" onSubmit={event => { event.preventDefault(); if (color) apply(color); else input.current?.focus(); }} footer={<>
        <div className="ee-color-draft">
            <input type="color" aria-label={l('chooseTextColor')} value={color || initial} onChange={event => { setDraft(event.target.value); setNotice(null); }} />
            <label className="ee-field"><span>{l(label)} HEX</span><input ref={input} type="text" value={draft} aria-invalid={!color} aria-describedby={!color ? 'ee-text-color-error' : undefined} spellCheck={false} maxLength={7} placeholder="#336699" onChange={event => { setDraft(event.target.value); setNotice(null); }} /></label>
            <span className="ee-color-preview" style={background ? { color: '#282923', backgroundColor: color || initial } : { color: color || initial }} aria-hidden="true">Aa</span>
        </div>
        {!color && <p id="ee-text-color-error" className="ee-text-error" role="status">{l('COLOR_INVALID')}</p>}
        <div className="ee-color-save-actions">
            <button type="button" className="ee-button" disabled={!color || (slot == null && count >= CUSTOM_COLOR_LIMIT && !colors.includes(color))} onClick={save}>{l(slot != null && colors[slot] ? 'replaceCustomColor' : 'saveCustomColor')}</button>
            <button type="button" className="ee-button" disabled={slot == null || !colors[slot]} onClick={remove}>{l('deleteCustomColor')}</button>
        </div>
        {notice && <p className={`ee-muted${notice.startsWith('COLOR_') ? ' ee-text-error' : ''}`} role="status">{l(notice)}</p>}
        <div className="ee-color-apply"><button type="submit" className="ee-button ee-primary" disabled={!color}>{l('apply')}</button></div>
    </>}>
        <p className="ee-muted">{l('textColorHint')}</p>
        <button type="button" className="ee-button ee-color-default" onClick={() => apply(null)}><span className="ee-color-sample" style={{ backgroundColor: background ? 'transparent' : defaultColor }} />{l(background ? 'clearTextBackground' : 'defaultTextColor')}</button>
        <h3>{l('basicColors')}</h3>
        <div className="ee-color-grid" role="group" aria-label={l('basicColors')} onKeyDown={event => navigate(event, 10)}>
            {BASIC_TEXT_COLORS.map(value => <button key={value} type="button" className="ee-color-swatch" style={{ backgroundColor: value }} title={value.toUpperCase()} aria-label={`${l(label)} ${value.toUpperCase()}`} aria-pressed={color === value} onClick={() => { setDraft(value); setSlot(null); setNotice(null); }} onDoubleClick={() => apply(value)} />)}
        </div>
        <div className="ee-color-section-heading"><h3>{l('customColors')}</h3><span>{count} / {CUSTOM_COLOR_LIMIT}</span></div>
        <div className="ee-color-grid" role="group" aria-label={l('customColors')} onKeyDown={event => navigate(event, 10)}>
            {colors.map((value, index) => <button key={index} type="button" className={`ee-color-swatch${value ? '' : ' is-empty'}`} style={value ? { backgroundColor: value } : undefined} title={`${index + 1} · ${value?.toUpperCase() || l('emptyColorSlot')}`} aria-label={`${l('customColorSlot')} ${index + 1}: ${value?.toUpperCase() || l('emptyColorSlot')}`} aria-pressed={slot === index} onClick={() => { setSlot(index); if (value) setDraft(value); setNotice(null); }} onDoubleClick={() => { if (value) apply(value); }}>{!value && '+'}</button>)}
        </div>
        <p className="ee-muted">{l('customColorsHint')}</p>
    </EditorDialog>;
}
