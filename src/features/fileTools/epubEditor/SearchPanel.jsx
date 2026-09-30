import React, { useEffect, useRef, useState } from 'react';
import { editorText as l } from './labels';
import { configureEditorSearch, moveEditorSearch, replaceEditorSearch, searchPluginKey, selectedSearchIndex, selectEditorSearchMatch } from './search';
import { adjacentBookMatch, bookSearchPosition } from './bookSearch';
import useBookSearch from './useBookSearch';

export default function SearchPanel({ editor, chapters, chapterId, scope, onScopeChange, onSelectChapter, onReplaceBook, query, onQueryChange, replacement, onReplacementChange, disabled = false, onClose }) {
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [snapshot, setSnapshot] = useState(null);
    const [notice, setNotice] = useState('');
    const [moving, setMoving] = useState(false);
    const movingRef = useRef(false);
    const inputRef = useRef(null);
    const book = scope === 'book';
    const bookSearch = useBookSearch({ editor, chapters, query, caseSensitive, enabled: book });
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
        const current = editor && searchPluginKey.getState(editor.state);
        if (current?.query !== query || current?.caseSensitive !== caseSensitive) configureEditorSearch(editor, query, caseSensitive);
        setSnapshot(editor && searchPluginKey.getState(editor.state));
    }, [editor, chapters, chapterId, query, caseSensitive]);
    useEffect(() => {
        setNotice('');
    }, [query, caseSensitive, scope]);
    const position = book && bookSearch.counts ? bookSearchPosition(bookSearch.counts, chapterId, snapshot?.matches || [], editor.state.selection) : null;
    const count = book ? position?.total || 0 : snapshot?.matches.length || 0;
    const index = book ? position?.current || 0 : (snapshot?.activeIndex ?? -1) + 1;
    const unavailable = disabled || moving || bookSearch.searching || !!bookSearch.error;
    const close = () => {
        onClose();
        editor?.commands.focus();
    };
    const composing = event => event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || editor?.view.composing;
    const moveBook = async direction => {
        const matches = searchPluginKey.getState(editor.state)?.matches || [];
        const target = adjacentBookMatch(bookSearch.counts || [], chapterId, matches, editor.state.selection, direction);
        if (!target) return;
        if (target.chapterId !== chapterId && !await onSelectChapter(target.chapterId)) return;
        configureEditorSearch(editor, query, caseSensitive);
        selectEditorSearchMatch(editor, target.index);
    };
    const perform = async fn => {
        if (unavailable || movingRef.current || editor?.view.composing) return;
        movingRef.current = true;
        setMoving(true);
        try { await fn(); }
        catch (error) { if (error.code !== 'CANCELED') setNotice(l(error.code || 'error')); }
        finally { movingRef.current = false; setMoving(false); }
    };
    const move = direction => perform(() => book ? moveBook(direction) : moveEditorSearch(editor, direction));
    const replace = all => perform(async () => {
        if (book && all) {
            await onReplaceBook(currentChapters => bookSearch.replaceAll(currentChapters, replacement));
            return;
        }
        const selected = selectedSearchIndex(searchPluginKey.getState(editor.state)?.matches || [], editor.state.selection);
        if (book && selected < 0) { await moveBook(1); return; }
        const replaced = replaceEditorSearch(editor, replacement, all, { wrap: !book });
        if (book && selectedSearchIndex(searchPluginKey.getState(editor.state)?.matches || [], editor.state.selection) < 0) await moveBook(1);
        if (replaced) setNotice(l('searchReplaced').replace('{count}', String(replaced)));
    });
    const searchStatus = bookSearch.error ? l(bookSearch.error.code || 'error') : bookSearch.searching ? l('searchingBook') : !query ? l(book ? 'searchBookHint' : 'searchChapterHint') : count
        ? l(book ? 'searchBookResults' : 'searchResults').replace('{current}', String(index)).replace('{total}', String(count)).replace('{chapters}', String(position?.chapters || 0)) : l('noMatches');
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
            <button type="button" className="ee-button" disabled={unavailable || !count} title={`${l('searchPrevious')} · Shift+Enter`} onClick={() => move(-1)}>{l('searchPrevious')}</button>
            <button type="button" className="ee-button" disabled={unavailable || !count} title={`${l('next')} · Enter`} onClick={() => move(1)}>{l('next')}</button>
            <button type="button" className="ee-button ee-search-close" title={`${l('close')} · Esc`} onClick={close}>{l('close')}</button>
        </div>
        <div className="ee-search-row">
            <label className="ee-search-field"><span>{l('replacement')}</span><input type="text" value={replacement} disabled={disabled} placeholder={l('replacement')} onChange={event => onReplacementChange(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !composing(event)) {
                    event.preventDefault();
                    replace(false);
                }
            }} /></label>
            <button type="button" className="ee-button" disabled={unavailable || !count} onClick={() => replace(false)}>{l('replace')}</button>
            <button type="button" className="ee-button" disabled={unavailable || !count} onClick={() => replace(true)}>{l(book ? 'replaceAllBook' : 'replaceAll')}</button>
        </div>
        <div className="ee-search-options">
            <label className="ee-search-scope"><span>{l('searchScope')}</span><select value={scope} disabled={disabled || moving} onChange={event => onScopeChange(event.target.value)}><option value="chapter">{l('searchCurrentChapter')}</option><option value="book">{l('searchBook')}</option></select></label>
            <label className="ee-search-case"><input type="checkbox" checked={caseSensitive} disabled={disabled || moving} onChange={event => setCaseSensitive(event.target.checked)} />{l('searchCaseSensitive')}</label>
            <span className={`ee-search-status${query && !count && !bookSearch.searching ? ' is-empty' : ''}`} role="status" aria-live="polite" aria-atomic="true">{searchStatus}</span>
            {notice && <span className="ee-search-notice" role="status">{notice}</span>}
        </div>
    </section>;
}
