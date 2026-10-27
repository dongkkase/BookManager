import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import { RECOMMENDATION_FORMATS, normalizeRecommendationPreferences, recommendationSeries } from '../../recommendationPreferencesState';
import '../../styles/RecommendationPreferences.css';

export function RecommendationPreferences({ preferences, options = {}, libraries = [], currentFile, onApply, onClose, returnFocusElement, t }) {
    const dialogRef = useRef(null);
    const [draft, setDraft] = useState(() => normalizeRecommendationPreferences(preferences));
    const [query, setQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const label = key => t(`recommendation_preferences.${key}`);
    const currentPath = currentFile?.full_path || currentFile?.path;
    const currentSeries = recommendationSeries(currentFile);
    const currentTitle = currentFile?.title || currentFile?.name || currentPath?.split(/[\\/]/).pop();
    const bookExcluded = draft.excludedBooks.some(item => item.path === currentPath);
    const seriesExcluded = currentSeries && draft.excludedSeries.some(item => item.key === currentSeries.key);
    const libraryOptions = useMemo(() => {
        const entries = new Map(libraries.map(item => {
            const path = typeof item === 'string' ? item : item.path;
            return [path, { path, name: typeof item === 'string' ? path.split(/[\\/]/).filter(Boolean).pop() : item.name || path }];
        }).filter(([path]) => Boolean(path)));
        for (const path of draft.libraries) if (!entries.has(path)) entries.set(path, { path, name: path });
        return [...entries.values()];
    }, [libraries, draft.libraries]);
    const genreOptions = useMemo(() => {
        const entries = new Map((options.genres || []).map(item => [item.key, item]));
        for (const key of draft.genres) if (!entries.has(key)) entries.set(key, { key, title: key, count: 0 });
        const search = query.trim().normalize('NFKC').toLocaleLowerCase();
        return [...entries.values()].filter(item => !search || item.title.normalize('NFKC').toLocaleLowerCase().includes(search));
    }, [options.genres, draft.genres, query]);
    const toggle = (field, value) => setDraft(previous => ({
        ...previous,
        [field]: previous[field].includes(value) ? previous[field].filter(item => item !== value) : [...previous[field], value],
    }));
    const clear = field => setDraft(previous => ({ ...previous, [field]: [] }));
    const close = () => { if (!saving) onClose?.(); };

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const previousFocus = returnFocusElement || document.activeElement;
        if (!dialog.open) dialog.showModal();
        dialog.querySelector('button')?.focus({ preventScroll: true });
        return () => {
            dialog.close();
            queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
        };
    }, []);

    const apply = async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(false);
        try {
            await onApply?.(draft);
        } catch {
            setError(true);
        } finally {
            setSaving(false);
        }
    };

    return createPortal(<dialog ref={dialogRef} className="recommendation-preferences" data-folder-modal="true"
        aria-labelledby="recommendation-preferences-title" aria-describedby="recommendation-preferences-description"
        onCancel={event => { event.preventDefault(); close(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        <form onSubmit={apply}>
            <header className="recommendation-preferences-header">
                <div><span className="recommendation-preferences-eyebrow">{t('reading_lists.dashboard_recommendation')}</span>
                    <h2 id="recommendation-preferences-title">{label('title')}</h2>
                    <p id="recommendation-preferences-description">{label('description')}</p></div>
                <button type="button" className="recommendation-preferences-close" onClick={close} disabled={saving} aria-label={label('close')}><FaIcon name="xmark" /></button>
            </header>
            <div className="recommendation-preferences-content">
                <fieldset disabled={saving}>
                    <legend>{label('libraries')}</legend>
                    <div className="recommendation-preferences-field-heading"><span>{label('multiple_hint')}</span>
                        <button type="button" onClick={() => clear('libraries')} aria-pressed={!draft.libraries.length}>{label('all')}</button></div>
                    <div className="recommendation-preferences-options">
                        {libraryOptions.map(item => <label key={item.path} title={item.path}>
                            <input type="checkbox" checked={draft.libraries.includes(item.path)} onChange={() => toggle('libraries', item.path)} />
                            <span>{item.name}</span>
                        </label>)}
                        {!libraryOptions.length && <p className="recommendation-preferences-empty">{label('no_libraries')}</p>}
                    </div>
                </fieldset>
                <fieldset disabled={saving}>
                    <legend>{label('genres')}</legend>
                    <div className="recommendation-preferences-field-heading"><span>{label('genre_hint')}</span>
                        <button type="button" onClick={() => clear('genres')} aria-pressed={!draft.genres.length}>{label('all')}</button></div>
                    <input type="search" className="recommendation-preferences-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={label('search_genres')} aria-label={label('search_genres')} />
                    <div className="recommendation-preferences-options recommendation-preferences-genres">
                        {genreOptions.map(item => <label key={item.key}>
                            <input type="checkbox" checked={draft.genres.includes(item.key)} onChange={() => toggle('genres', item.key)} />
                            <span>{item.title}</span><small>{item.count.toLocaleString()}</small>
                        </label>)}
                        {!genreOptions.length && <p className="recommendation-preferences-empty">{label(query.trim() ? 'no_matches' : 'no_genres')}</p>}
                    </div>
                </fieldset>
                <fieldset disabled={saving}>
                    <legend>{label('formats')}</legend>
                    <div className="recommendation-preferences-field-heading"><span>{label('multiple_hint')}</span>
                        <button type="button" onClick={() => clear('formats')} aria-pressed={!draft.formats.length}>{label('all')}</button></div>
                    <div className="recommendation-preferences-options recommendation-preferences-formats">
                        {RECOMMENDATION_FORMATS.map(format => <label key={format}>
                            <input type="checkbox" checked={draft.formats.includes(format)} onChange={() => toggle('formats', format)} />
                            <span>{label(`format_${format}`)}</span><small>{(options.formatCounts?.[format] || 0).toLocaleString()}</small>
                        </label>)}
                    </div>
                </fieldset>
                <fieldset disabled={saving}>
                    <legend>{label('excluded')}</legend>
                    <p className="recommendation-preferences-hint">{label('excluded_hint')}</p>
                    {currentPath && <div className="recommendation-preferences-current">
                        <strong title={currentTitle}>{currentTitle}</strong>
                        <div>
                            <button type="button" disabled={bookExcluded} onClick={() => setDraft(previous => ({ ...previous, excludedBooks: [...previous.excludedBooks, { path: currentPath, title: currentTitle }] }))}>{label(bookExcluded ? 'book_excluded' : 'exclude_book')}</button>
                            {currentSeries && <button type="button" disabled={seriesExcluded} title={currentSeries.title} onClick={() => setDraft(previous => ({ ...previous, excludedSeries: [...previous.excludedSeries, currentSeries] }))}>{label(seriesExcluded ? 'series_excluded' : 'exclude_series')}</button>}
                        </div>
                    </div>}
                    <div className="recommendation-preferences-excluded">
                        {draft.excludedBooks.map(item => <div key={`book:${item.path}`}><span title={item.path}><small>{label('book')}</small>{item.title}</span>
                            <button type="button" aria-label={`${label('restore')}: ${item.title}`} onClick={() => setDraft(previous => ({ ...previous, excludedBooks: previous.excludedBooks.filter(book => book.path !== item.path) }))}>{label('restore')}</button></div>)}
                        {draft.excludedSeries.map(item => <div key={`series:${item.key}`}><span><small>{label('series')}</small>{item.title}</span>
                            <button type="button" aria-label={`${label('restore')}: ${item.title}`} onClick={() => setDraft(previous => ({ ...previous, excludedSeries: previous.excludedSeries.filter(series => series.key !== item.key) }))}>{label('restore')}</button></div>)}
                        {!draft.excludedBooks.length && !draft.excludedSeries.length && <p className="recommendation-preferences-empty">{label('no_exclusions')}</p>}
                    </div>
                </fieldset>
            </div>
            <footer className="recommendation-preferences-footer">
                {error && <p role="alert">{label('save_failed')}</p>}
                <button type="button" className="recommendation-preferences-reset" disabled={saving} onClick={() => setDraft(normalizeRecommendationPreferences())}>{label('reset')}</button>
                <div><button type="button" disabled={saving} onClick={close}>{label('cancel')}</button>
                    <button type="submit" className="recommendation-preferences-apply" disabled={saving}>{label(saving ? 'saving' : 'apply')}</button></div>
            </footer>
        </form>
    </dialog>, document.body);
}
