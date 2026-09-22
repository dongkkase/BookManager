import React, { useEffect, useMemo, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { SPECIAL_CHARACTERS, EMOJI_CHARACTERS, ALL_EMOJI_CHARACTERS, SKIN_TONES, characterValue, characterDisplay, filterCharacters } from './characters';
import { IME_SYMBOL_GROUPS } from './imeSymbols';
import { insertCharacter } from './richFormatting';

export default function CharacterDialog({ editor, emoji = false, onClose }) {
    const catalog = emoji ? ALL_EMOJI_CHARACTERS : SPECIAL_CHARACTERS;
    const catalogIndex = useMemo(() => new Map(catalog.map(entry => [entry.value, entry])), [catalog]);
    const gridRef = useRef(null);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [tone, setTone] = useState('');
    const [last, setLast] = useState(null);
    const [recent, setRecent] = useState(() => {
        try { const data = JSON.parse(localStorage.getItem(`bookmanager.epub-editor.${emoji ? 'emoji' : 'symbols'}.recent`)); return Array.isArray(data) ? data.filter(value => catalogIndex.has(value)).slice(0, 20) : []; }
        catch { return []; }
    });
    const candidates = emoji && tone !== 'all' && category !== 'recent' ? EMOJI_CHARACTERS : catalog;
    const filtered = useMemo(() => filterCharacters(candidates, query, category === 'recent' ? 'all' : category), [candidates, query, category]);
    const values = category === 'recent' ? recent.flatMap(value => { const entry = filtered.find(item => item.value === value); return entry ? [{ ...entry, tones: false }] : []; }) : filtered;
    useEffect(() => { if (gridRef.current) gridRef.current.scrollTop = 0; }, [query, category, tone]);
    const insert = entry => {
        const value = characterValue(entry, tone);
        if (!insertCharacter(editor, value)) return;
        setLast({ ...entry, value });
        const next = [value, ...recent.filter(item => item !== value)].slice(0, 20);
        setRecent(next);
        try { localStorage.setItem(`bookmanager.epub-editor.${emoji ? 'emoji' : 'symbols'}.recent`, JSON.stringify(next)); } catch { /* Recent items remain available for this dialog. */ }
    };
    const navigate = event => {
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const current = buttons.indexOf(event.target);
        if (current < 0) return;
        const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length;
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : offset == null ? null : Math.max(0, Math.min(buttons.length - 1, current + offset));
        if (next != null) { event.preventDefault(); buttons[next]?.focus(); }
    };
    return <EditorDialog title={l(emoji ? 'emoji' : 'specialCharacters')} className="ee-character-dialog" onClose={onClose} footer={<div className="ee-character-footer"><span role="status">{`${values.length.toLocaleString()} ${l('characterCount')}`}{last && ` · ${characterDisplay(last)} ${l('characterInserted')}`}</span><button type="button" className="ee-button ee-primary" onClick={onClose}>{l('close')}</button></div>}>
        <p className="ee-muted">{l('charactersHint')}</p>
        {emoji && <p className="ee-muted">{l('emojiCatalogHint').replace('{base}', EMOJI_CHARACTERS.length.toLocaleString()).replace('{total}', ALL_EMOJI_CHARACTERS.length.toLocaleString())}</p>}
        {!emoji && <p className="ee-muted">{l('imeCharactersHint')}</p>}
        <div className="ee-character-filters"><input aria-label={l('characterSearch')} placeholder={l(emoji ? 'characterSearch' : 'imeCharacterSearch')} value={query} onChange={event => setQuery(event.target.value)} /><select aria-label={l('characterCategory')} value={category} onChange={event => setCategory(event.target.value)}>
            {['all', 'recent'].map(value => <option key={value} value={value}>{l(`chars_${value}`)}</option>)}
            {!emoji && <optgroup label={l('imeCharacters')}>{IME_SYMBOL_GROUPS.map(group => <option key={group.key} value={`ime:${group.key}`}>{group.key} · {l(group.key === 'ㄷ' ? 'imeMath' : `chars_${group.category}`)}</option>)}</optgroup>}
            <optgroup label={l('characterCategory')}>{[...new Set(catalog.flatMap(entry => entry.categories || [entry.category]))].map(value => <option key={value} value={value}>{l(`chars_${value}`)}</option>)}</optgroup>
        </select></div>
        {emoji && <label className="ee-field"><span>{l('skinTone')}</span><select value={tone} onChange={event => setTone(event.target.value)}>{SKIN_TONES.map((value, index) => <option key={index} value={value}>{l(`skinTone${index}`)}</option>)}<option value="all">{l('skinToneAll')}</option></select></label>}
        <div ref={gridRef} className={`ee-character-grid${emoji ? ' is-emoji' : ''}`} role="group" aria-label={l(emoji ? 'emoji' : 'specialCharacters')} onKeyDown={navigate}>
            {values.map(entry => <button type="button" key={entry.value} className={['\u3000', '\u00ad'].includes(entry.value) ? 'is-invisible-character' : undefined} title={[entry.name, entry.imeKeys?.map(key => `${key}+${l('hanjaKey')}`).join(' · ')].filter(Boolean).join(' · ')} aria-label={`${characterDisplay(entry, tone)} · ${entry.name}`} onClick={() => insert(entry)}>{characterDisplay(entry, tone)}</button>)}
        </div>
        {!values.length && <p className="ee-muted">{l('noMatches')}</p>}
    </EditorDialog>;
}
