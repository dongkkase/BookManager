import React, { useCallback, useMemo, useRef, useState } from 'react';
import '../../styles/MetadataTagInput.css';

function splitTagValues(value = '') {
    return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
}

function joinTagValues(values = []) {
    const seen = new Set();
    const tags = [];
    for (const value of values) {
        const tag = String(value || '').trim();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
    }
    return tags.join(', ');
}

function TagInput({ className = '', value, placeholder = '', disabled = false, ariaLabel, onChange }) {
    const inputRef = useRef(null);
    const isComposingRef = useRef(false);
    const pendingBlurRef = useRef(false);
    const [draft, setDraft] = useState('');
    const tags = useMemo(() => splitTagValues(value), [value]);

    const updateTags = useCallback(nextTags => {
        onChange(joinTagValues(nextTags));
    }, [onChange]);

    const commitDraft = useCallback((nextDraft = inputRef.current?.value ?? draft) => {
        const additions = splitTagValues(nextDraft);
        if (additions.length === 0) return;
        updateTags([...tags, ...additions]);
        setDraft('');
    }, [draft, tags, updateTags]);

    const removeTag = useCallback(targetTag => {
        updateTags(tags.filter(tag => tag !== targetTag));
    }, [tags, updateTags]);

    return (
        <div className={`meta-tag-input ${className} ${disabled ? 'disabled' : ''}`.trim()}
            onClick={() => inputRef.current?.focus()}>
            {tags.map(tag => (
                <span className="meta-tag-chip" key={tag}>
                    <span className="meta-tag-chip-text">{tag}</span>
                    <button type="button" disabled={disabled}
                        onMouseDown={event => event.preventDefault()}
                        onClick={event => {
                            event.stopPropagation();
                            removeTag(tag);
                        }} aria-label={`Remove ${tag}`}>×</button>
                </span>
            ))}
            <input ref={inputRef} type="text" value={draft} disabled={disabled}
                placeholder={tags.length === 0 ? placeholder : ''} aria-label={ariaLabel}
                onChange={event => setDraft(event.target.value)}
                onCompositionStart={() => {
                    isComposingRef.current = true;
                    pendingBlurRef.current = false;
                }}
                onCompositionEnd={event => {
                    isComposingRef.current = false;
                    const nextDraft = event.currentTarget.value;
                    setDraft(nextDraft);
                    if (pendingBlurRef.current) {
                        pendingBlurRef.current = false;
                        commitDraft(nextDraft);
                    }
                }}
                onBlur={event => {
                    if (isComposingRef.current) {
                        pendingBlurRef.current = true;
                        return;
                    }
                    commitDraft(event.currentTarget.value);
                }}
                onKeyDown={event => {
                    if (isComposingRef.current || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) return;
                    if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        commitDraft();
                    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
                        event.preventDefault();
                        removeTag(tags[tags.length - 1]);
                    }
                }} />
        </div>
    );
}

export { TagInput, splitTagValues, joinTagValues };
