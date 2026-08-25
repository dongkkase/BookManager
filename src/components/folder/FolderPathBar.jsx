import React, { useEffect, useId, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { basename } from '../../utils/folderPath';

export function FolderPathBar({
    value,
    history,
    inputRef,
    isOpen,
    onChange,
    onNavigate,
    onOpenChange,
    shortcutLabel,
    t,
}) {
    const containerRef = useRef(null);
    const listboxId = useId();
    const [activeIndex, setActiveIndex] = useState(-1);

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
        const selectedPath = activeIndex >= 0 ? history[activeIndex] : value;
        if (activeIndex >= 0) onChange(selectedPath);
        setActiveIndex(-1);
        void onNavigate(selectedPath);
    };

    const handleInputKeyDown = event => {
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
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
            }}
            ref={containerRef}
        >
            <label className="folder-goto-path-label" htmlFor="folder-goto-path-input">
                <FaIcon name="folderOpen" size={12} />
                <span>{t('fm_title')}</span>
                <kbd>{shortcutLabel}</kbd>
            </label>
            <div className="folder-goto-path-control">
                <input
                    id="folder-goto-path-input"
                    ref={inputRef}
                    className="goto-path-input"
                    type="text"
                    value={value}
                    placeholder={t('folder.goto.placeholder')}
                    aria-label={t('folder.goto.input_label')}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
                    autoComplete="off"
                    onFocus={() => {
                        setActiveIndex(-1);
                        onOpenChange(true);
                    }}
                    onClick={() => onOpenChange(true)}
                    onChange={event => {
                        onChange(event.target.value);
                        onOpenChange(true);
                        setActiveIndex(-1);
                    }}
                    onKeyDown={handleInputKeyDown}
                />
                <span className="folder-goto-path-arrow" aria-hidden="true">
                    <FaIcon name="angleDown" size={10} />
                </span>
                {isOpen && (
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
                className="folder-goto-path-submit"
                type="submit"
                onFocus={() => {
                    setActiveIndex(-1);
                    onOpenChange(false);
                }}
            >
                {t('folder.goto.go')}
            </button>
        </form>
    );
}
