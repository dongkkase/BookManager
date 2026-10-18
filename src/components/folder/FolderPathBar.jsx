import React, { useEffect, useId, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { basename } from '../../utils/folderPath';

export function FolderPathBar({
    value,
    virtualLocation = '',
    history,
    inputRef,
    isOpen,
    onChange,
    onNavigate,
    onOpenChange,
    canGoBack = false,
    canGoForward = false,
    canGoUp = false,
    onBack,
    onForward,
    onUp,
    onRefresh,
    refreshDisabled = false,
    canFavorite = false,
    isFavorite = false,
    favoriteDisabled = false,
    onToggleFavorite,
    shortcutLabel,
    t,
}) {
    const containerRef = useRef(null);
    const listboxId = useId();
    const [activeIndex, setActiveIndex] = useState(-1);
    const showFavorite = canFavorite && !virtualLocation;

    useEffect(() => {
        if (!isOpen) setActiveIndex(-1);
    }, [isOpen]);

    useEffect(() => {
        setActiveIndex(index => index < history.length ? index : -1);
    }, [history.length]);

    useEffect(() => {
        if (!isOpen || activeIndex < 0) return;
        containerRef.current
            ?.querySelector(`[data-goto-path-index="${activeIndex}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = event => {
            if (!containerRef.current?.contains(event.target)) onOpenChange(false);
        };
        window.addEventListener('pointerdown', handlePointerDown);
        return () => window.removeEventListener('pointerdown', handlePointerDown);
    }, [isOpen, onOpenChange]);

    const choosePath = path => {
        onChange(path);
        setActiveIndex(-1);
        void onNavigate(path);
    };

    const handleSubmit = event => {
        event.preventDefault();
        if (virtualLocation) return;
        const selectedPath = activeIndex >= 0 ? history[activeIndex] : value;
        if (activeIndex >= 0) onChange(selectedPath);
        setActiveIndex(-1);
        void onNavigate(selectedPath);
    };

    const handleInputKeyDown = event => {
        if (virtualLocation) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            onOpenChange(true);
            setActiveIndex(index => Math.min(index + 1, history.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            onOpenChange(true);
            setActiveIndex(index => index <= 0 ? Math.max(history.length - 1, -1) : index - 1);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            setActiveIndex(-1);
        }
    };

    return (
        <form
            className="folder-goto-path-bar"
            onSubmit={handleSubmit}
            onKeyDown={event => {
                if (event.key === 'Enter') event.stopPropagation();
            }}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
            }}
            ref={containerRef}
        >
            <div
                className="folder-goto-path-navigation"
                onFocus={() => {
                    setActiveIndex(-1);
                    onOpenChange(false);
                }}
            >
                <button
                    className="folder-goto-path-icon"
                    type="button"
                    title={t('folder.goto.back')}
                    aria-label={t('folder.goto.back')}
                    disabled={!canGoBack}
                    onClick={onBack}
                >
                    <FaIcon name="angleLeft" size={14} />
                </button>
                <button
                    className="folder-goto-path-icon"
                    type="button"
                    title={t('folder.goto.forward')}
                    aria-label={t('folder.goto.forward')}
                    disabled={!canGoForward}
                    onClick={onForward}
                >
                    <FaIcon name="angleRight" size={14} />
                </button>
                <button
                    className="folder-goto-path-icon"
                    type="button"
                    title={t('folder.goto.up')}
                    aria-label={t('folder.goto.up')}
                    disabled={!canGoUp}
                    onClick={onUp}
                >
                    <FaIcon name="angleUp" size={14} />
                </button>
            </div>
            <div className={`folder-goto-path-control${showFavorite ? ' has-favorite' : ''}`}>
                <label className="folder-goto-path-label" htmlFor="folder-goto-path-input">
                    <FaIcon name="folderOpen" size={12} />
                    <span>{t('fm_title')}</span>
                    <kbd>{shortcutLabel}</kbd>
                </label>
                <input
                    id="folder-goto-path-input"
                    ref={inputRef}
                    className="goto-path-input"
                    type="text"
                    value={virtualLocation || value}
                    readOnly={Boolean(virtualLocation)}
                    placeholder={t('folder.goto.placeholder')}
                    aria-label={t('folder.goto.input_label')}
                    role={virtualLocation ? undefined : 'combobox'}
                    aria-autocomplete={virtualLocation ? undefined : 'list'}
                    aria-expanded={virtualLocation ? undefined : isOpen}
                    aria-controls={virtualLocation ? undefined : listboxId}
                    aria-activedescendant={!virtualLocation && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                    autoComplete="off"
                    onFocus={() => {
                        setActiveIndex(-1);
                        if (!virtualLocation) onOpenChange(true);
                    }}
                    onClick={() => { if (!virtualLocation) onOpenChange(true); }}
                    onChange={event => {
                        onChange(event.target.value);
                        onOpenChange(true);
                        setActiveIndex(-1);
                    }}
                    onKeyDown={handleInputKeyDown}
                />
                {!virtualLocation && <kbd className="folder-goto-path-enter" aria-hidden="true">Enter</kbd>}
                {showFavorite && (
                    <button
                        className="folder-goto-path-favorite"
                        type="button"
                        title={t(isFavorite ? 'action_fav_rem' : 'action_fav_add')}
                        aria-label={t(isFavorite ? 'action_fav_rem' : 'action_fav_add')}
                        aria-pressed={isFavorite}
                        disabled={favoriteDisabled}
                        onClick={onToggleFavorite}
                        onFocus={() => {
                            setActiveIndex(-1);
                            onOpenChange(false);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                        }}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill={isFavorite ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z" />
                        </svg>
                    </button>
                )}
                {!virtualLocation && <span className="folder-goto-path-arrow" aria-hidden="true">
                    <FaIcon name="angleDown" size={10} />
                </span>}
                {!virtualLocation && isOpen && (
                    <div
                        className="folder-goto-path-history"
                        id={listboxId}
                        role="listbox"
                        aria-label={t('folder.goto.recent')}
                        onMouseLeave={() => setActiveIndex(-1)}
                    >
                        <div className="folder-goto-path-history-title" role="presentation">
                            {t('folder.goto.recent')}
                        </div>
                        {history.length > 0 ? history.map((path, index) => (
                            <button
                                id={`${listboxId}-option-${index}`}
                                type="button"
                                key={path}
                                className={`folder-goto-path-option ${index === activeIndex ? 'active' : ''}`}
                                role="option"
                                aria-selected={index === activeIndex}
                                tabIndex={-1}
                                data-goto-path-index={index}
                                title={path}
                                onMouseEnter={() => setActiveIndex(index)}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => choosePath(path)}
                            >
                                <strong>{basename(path) || path}</strong>
                                <span>{path}</span>
                            </button>
                        )) : (
                            <div className="folder-goto-path-empty" role="status">
                                {t('folder.goto.empty')}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <button
                className="folder-goto-path-icon"
                type="button"
                title={`${t('action_refresh')} (F5)`}
                aria-label={t('action_refresh')}
                disabled={refreshDisabled}
                onClick={onRefresh}
                onFocus={() => {
                    setActiveIndex(-1);
                    onOpenChange(false);
                }}
            >
                <FaIcon name="rotateRight" size={12} />
            </button>
        </form>
    );
}
