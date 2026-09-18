import React, { useRef, useState } from 'react';
import { FaIcon } from './FaIcon';

export default function TextCleanerSearch({
    t, query, result, options, onOptionsChange, onQueryChange, onMove,
    replacement = '', onReplacementChange, preserveCase = false, onPreserveCaseChange,
    onReplace, disabled = false,
}) {
    const inputRef = useRef(null);
    const [expanded, setExpanded] = useState(true);
    const hasMatches = result.matches.length > 0 && !result.pending && !result.error;
    const status = result.pending ? '…' : query
        ? `${result.index >= 0 ? result.index + 1 : 0}/${result.totalCount}` : '';
    const label = name => t(`tools.text_cleaner.${name}`);
    const toggle = (key, content, title) => (
        <button type="button" className={`text-cleaner-search-toggle is-${key}`}
            aria-label={label(title)} title={label(title)} aria-pressed={options[key]}
            disabled={disabled} onClick={() => onOptionsChange({ ...options, [key]: !options[key] })}>
            {content}
        </button>
    );

    return (
        <div className="text-cleaner-search-panel">
            <div className={`text-cleaner-search${result.error ? ' has-error' : ''}`}>
                {onReplace ? (
                    <button type="button" aria-label={label('toggle_replace')} title={label('toggle_replace')}
                        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
                        <FaIcon name={expanded ? 'angleDown' : 'angleRight'} size={11} />
                    </button>
                ) : <FaIcon name="search" size={11} />}
                <input ref={inputRef} type="search" value={query} disabled={disabled}
                    placeholder={label('search')} aria-label={label('search')} aria-invalid={Boolean(result.error)}
                    onChange={event => onQueryChange(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        if (query && !result.error && !disabled) onMove(event.shiftKey ? -1 : 1, event.currentTarget);
                    }} />
                {toggle('caseSensitive', 'Aa', 'match_case')}
                {toggle('wholeWord', 'ab', 'whole_word')}
                {toggle('regex', '.*', 'use_regex')}
                <span className="text-cleaner-search-count" aria-live="polite">{status}</span>
                <button type="button" className="text-cleaner-search-clear" disabled={!query || disabled}
                    aria-label={label('clear_search')} title={label('clear_search')}
                    onClick={() => { onQueryChange(''); inputRef.current?.focus({ preventScroll: true }); }}>
                    <FaIcon name="xmark" size={10} />
                </button>
                {[-1, 1].map(direction => (
                    <button key={direction} type="button" disabled={!hasMatches || disabled}
                        aria-label={label(direction < 0 ? 'previous_match' : 'next_match')}
                        title={label(direction < 0 ? 'previous_match' : 'next_match')}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => onMove(direction, inputRef.current)}>
                        <FaIcon name={direction < 0 ? 'angleUp' : 'angleDown'} size={10} />
                    </button>
                ))}
            </div>
            {onReplace && expanded && (
                <div className="text-cleaner-search text-cleaner-search-replace">
                    <input type="text" value={replacement} disabled={disabled}
                        placeholder={label('replace')} aria-label={label('replacement')}
                        title={options.regex ? label('replacement_hint') : label('replacement')}
                        onChange={event => onReplacementChange(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            if (hasMatches && !disabled) onReplace(false);
                        }} />
                    <button type="button" className="text-cleaner-search-toggle" disabled={disabled}
                        aria-label={label('preserve_case')} title={label('preserve_case')} aria-pressed={preserveCase}
                        onClick={() => onPreserveCaseChange(!preserveCase)}>AB</button>
                    <button type="button" disabled={!hasMatches || disabled}
                        title={label('replace')} onClick={() => onReplace(false)}>{label('replace')}</button>
                    <button type="button" disabled={!hasMatches || disabled}
                        title={label('replace_all')} onClick={() => onReplace(true)}>{label('replace_all')}</button>
                </div>
            )}
            {result.error && <div className="text-cleaner-search-error" role="alert">{label(result.error)}</div>}
            {result.truncated && <div className="text-cleaner-search-hint">
                {t('tools.text_cleaner.search_limit', { count: result.matches.length.toLocaleString() })}
            </div>}
        </div>
    );
}
