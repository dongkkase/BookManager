import React, { useMemo, useRef, useState } from 'react';
import EditorDialog from '../features/fileTools/epubEditor/EditorDialog';
import { editorText as l } from '../features/fileTools/epubEditor/labels';
import { SPECIAL_CHARACTERS, ALL_EMOJI_CHARACTERS, characterDisplay, filterCharacters } from '../features/fileTools/epubEditor/characters';
import { TEXT_CLEANER_QUOTE_PAIRS } from '../textCleanerInsertion';

export default function TextCleanerInsertDialog({ t, emoji, busy, onInsert, onClose }) {
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [last, setLast] = useState('');
    const gridRef = useRef(null);
    const catalog = emoji ? ALL_EMOJI_CHARACTERS : SPECIAL_CHARACTERS;
    const characters = useMemo(() => filterCharacters(catalog, query, category), [catalog, query, category]);
    const insert = (value, pair = false) => {
        if (onInsert(value, pair)) setLast(value);
    };
    const navigate = event => {
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const current = buttons.indexOf(event.target);
        if (current < 0) return;
        const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(' ').length;
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : offset == null ? null : Math.max(0, Math.min(buttons.length - 1, current + offset));
        if (next !== null) {
            event.preventDefault();
            buttons[next]?.focus();
        }
    };
    const resetScroll = () => { if (gridRef.current) gridRef.current.scrollTop = 0; };
    return (
        <EditorDialog title={l(emoji ? 'emoji' : 'specialCharacters')} className="text-cleaner-insert-dialog" onClose={onClose}
            footer={<>
                <span role="status">{last ? t('tools.text_cleaner.inserted_character', { value: last }) : t('tools.text_cleaner.insert_hint')}</span>
                <button type="button" onClick={onClose}>{l('close')}</button>
            </>}>
            {!emoji && <div className="text-cleaner-insert-quotes" role="group" aria-label={t('tools.text_cleaner.insert_quotes')}>
                {TEXT_CLEANER_QUOTE_PAIRS.map(pair => <button type="button" key={pair.open} disabled={busy}
                    title={t('tools.text_cleaner.wrap_quote', { pair: pair.open + pair.close })}
                    aria-label={t('tools.text_cleaner.wrap_quote', { pair: pair.open + pair.close })}
                    onClick={() => insert(pair.open, true)}>{pair.open}…{pair.close}</button>)}
            </div>}
            <div className="text-cleaner-character-filters">
                <input autoFocus type="search" aria-label={l('characterSearch')} placeholder={l(emoji ? 'characterSearch' : 'imeCharacterSearch')}
                    value={query} onChange={event => { setQuery(event.target.value); resetScroll(); }} />
                <select aria-label={l('characterCategory')} value={category} onChange={event => { setCategory(event.target.value); resetScroll(); }}>
                    <option value="all">{l('chars_all')}</option>
                    {[...new Set(catalog.flatMap(entry => entry.categories || [entry.category]))].map(value => (
                        <option key={value} value={value}>{l(`chars_${value}`)}</option>
                    ))}
                </select>
            </div>
            <div ref={gridRef} className="text-cleaner-character-grid" role="group" aria-label={l(emoji ? 'emoji' : 'specialCharacters')} onKeyDown={navigate}>
                {characters.map(entry => <button type="button" key={entry.value} disabled={busy}
                    title={`${entry.name} · U+${entry.value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`}
                    aria-label={`${characterDisplay(entry)} · ${entry.name}`} onClick={() => insert(entry.value)}>{characterDisplay(entry)}</button>)}
            </div>
            {!characters.length && <p>{l('noMatches')}</p>}
        </EditorDialog>
    );
}
