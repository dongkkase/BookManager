import React, { useEffect, useRef, useState } from 'react';
import { editorText as l } from './labels';
import { configureEditorSearch, moveEditorSearch, replaceEditorSearch, searchPluginKey } from './search';

export default function SearchPanel({ editor, chapterId, query, onQueryChange, replacement, onReplacementChange, disabled = false, onClose }) {
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [notice, setNotice] = useState('');
    const inputRef = useRef(null);
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        const sync = ({ transaction } = {}) => {
            setSnapshot(searchPluginKey.getState(editor.state));
            if (transaction?.docChanged) setNotice('');
        };
        editor.on('transaction', sync);
        sync();
        inputRef.current?.focus();
        inputRef.current?.select();
        return () => {
            editor.off('transaction', sync);
            configureEditorSearch(editor, '');
        };
    }, [editor]);
    useEffect(() => {
        configureEditorSearch(editor, query, caseSensitive);
        setNotice('');
    }, [editor, chapterId, query, caseSensitive]);
    const count = snapshot?.matches.length || 0;
    const index = (snapshot?.activeIndex ?? -1) + 1;
    const close = () => {
        onClose();
        editor?.commands.focus();
    };
    const composing = event => event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || editor?.view.composing;
    const move = direction => {
        if (!disabled) moveEditorSearch(editor, direction);
    };
    const replace = all => {
        if (disabled) return;
        const replaced = replaceEditorSearch(editor, replacement, all);
        if (replaced) setNotice(l('searchReplaced').replace('{count}', String(replaced)));
    };
    const searchStatus = !query ? l('searchChapterHint') : count ? l('searchResults').replace('{current}', String(index)).replace('{total}', String(count)) : l('noMatches');
    return <section className="ee-search" role="search" aria-label={l('search')} onKeyDown={event => {
        if (event.key === 'Escape' && !composing(event)) {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }}>
        <div className="ee-search-row">
            <label className="ee-search-field"><span>{l('find')}</span><input ref={inputRef} type="text" value={query} disabled={disabled} placeholder={l('find')} onChange={event => onQueryChange(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !composing(event)) {
                    event.preventDefault();
                    move(event.shiftKey ? -1 : 1);
                }
            }} /></label>
            <button type="button" className="ee-button" disabled={disabled || !count} title={`${l('searchPrevious')} · Shift+Enter`} onClick={() => move(-1)}>{l('searchPrevious')}</button>
            <button type="button" className="ee-button" disabled={disabled || !count} title={`${l('next')} · Enter`} onClick={() => move(1)}>{l('next')}</button>
            <button type="button" className="ee-button ee-search-close" title={`${l('close')} · Esc`} onClick={close}>{l('close')}</button>
        </div>
        <div className="ee-search-row">
            <label className="ee-search-field"><span>{l('replacement')}</span><input type="text" value={replacement} disabled={disabled} placeholder={l('replacement')} onChange={event => onReplacementChange(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !composing(event)) {
                    event.preventDefault();
                    replace(false);
                }
            }} /></label>
            <button type="button" className="ee-button" disabled={disabled || !count} onClick={() => replace(false)}>{l('replace')}</button>
            <button type="button" className="ee-button" disabled={disabled || !count} onClick={() => replace(true)}>{l('replaceAll')}</button>
        </div>
        <div className="ee-search-options">
            <label className="ee-search-case"><input type="checkbox" checked={caseSensitive} disabled={disabled} onChange={event => setCaseSensitive(event.target.checked)} />{l('searchCaseSensitive')}</label>
            <span className={`ee-search-status${query && !count ? ' is-empty' : ''}`} role="status" aria-live="polite" aria-atomic="true">{searchStatus}</span>
            {notice && <span className="ee-search-notice" role="status">{notice}</span>}
        </div>
    </section>;
}
