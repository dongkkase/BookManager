import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    FOLDER_TAG_CATEGORIES,
    folderTagSelectionKey,
    sortFolderTagValues,
} from '../../folderTagFilter';

const INITIAL_TAG_VALUE_LIMIT = 120;
const TAG_VALUE_LIMIT_INCREMENT = 120;

function normalizedSearchText(value = '') {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function FolderTagSearchDialog({
    categories,
    totalFileCount = 0,
    loading = false,
    selections,
    matchMode,
    onApply,
    onClose,
    t,
}) {
    const [draftSelections, setDraftSelections] = useState(() => [...selections]);
    const [draftMatchMode, setDraftMatchMode] = useState(matchMode === 'any' ? 'any' : 'all');
    const [query, setQuery] = useState('');
    const [activeCategoryId, setActiveCategoryId] = useState(() => categories[0]?.id || '');
    const [sortMode, setSortMode] = useState('frequency');
    const [visibleValueLimit, setVisibleValueLimit] = useState(INITIAL_TAG_VALUE_LIMIT);
    const searchInputRef = useRef(null);
    const valuesContainerRef = useRef(null);
    const selectionKeys = useMemo(
        () => new Set(draftSelections.map(folderTagSelectionKey)),
        [draftSelections],
    );
    const categoryLabels = useMemo(
        () => new Map(FOLDER_TAG_CATEGORIES.map(category => [category.id, t(category.labelKey)])),
        [t],
    );
    const categorySelectionCounts = useMemo(() => {
        const counts = new Map();
        draftSelections.forEach(selection => {
            counts.set(selection.categoryId, (counts.get(selection.categoryId) || 0) + 1);
        });
        return counts;
    }, [draftSelections]);
    const visibleCategories = useMemo(() => {
        const normalizedQuery = normalizedSearchText(query);
        return categories
            .map(category => {
                const categoryMatches = normalizedQuery
                    && normalizedSearchText(t(category.labelKey)).includes(normalizedQuery);
                const values = !normalizedQuery || categoryMatches
                    ? category.values
                    : category.values.filter(item => normalizedSearchText(item.value).includes(normalizedQuery));
                return {
                    ...category,
                    values: sortFolderTagValues(values, sortMode),
                };
            })
            .filter(category => category.values.length > 0);
    }, [categories, query, sortMode, t]);
    const activeCategory = visibleCategories.find(category => category.id === activeCategoryId)
        || visibleCategories[0]
        || null;
    const visibleValues = activeCategory?.values.slice(0, visibleValueLimit) || [];
    const hiddenValueCount = Math.max(0, (activeCategory?.values.length || 0) - visibleValues.length);

    useEffect(() => {
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }, []);

    useEffect(() => {
        if (visibleCategories.length === 0) return;
        if (!visibleCategories.some(category => category.id === activeCategoryId)) {
            setActiveCategoryId(visibleCategories[0].id);
        }
    }, [activeCategoryId, visibleCategories]);

    useEffect(() => {
        setVisibleValueLimit(INITIAL_TAG_VALUE_LIMIT);
        valuesContainerRef.current?.scrollTo({ top: 0 });
    }, [activeCategoryId, query, sortMode]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onClose();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose]);

    const toggleSelection = (categoryId, value) => {
        const selection = { categoryId, value };
        const key = folderTagSelectionKey(selection);
        setDraftSelections(current => (
            current.some(item => folderTagSelectionKey(item) === key)
                ? current.filter(item => folderTagSelectionKey(item) !== key)
                : [...current, selection]
        ));
    };

    return (
        <div className="folder-dialog-backdrop" onMouseDown={onClose}>
            <section
                className="folder-tag-search-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="folder-tag-search-title"
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="dialog-titlebar folder-tag-search-titlebar">
                    <span id="folder-tag-search-title">{t('folder_tag_search_title')}</span>
                    <button type="button" onClick={onClose} aria-label={t('btn_close')}>×</button>
                </div>

                <div className="folder-tag-search-toolbar">
                    <input
                        ref={searchInputRef}
                        type="search"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t('folder_tag_search_value_placeholder')}
                        aria-label={t('folder_tag_search_value_placeholder')}
                        disabled={loading}
                    />
                    <div className="folder-tag-match-mode" role="group" aria-label={t('folder_tag_match_mode')}>
                        <button
                            type="button"
                            className={draftMatchMode === 'all' ? 'active' : ''}
                            aria-pressed={draftMatchMode === 'all'}
                            disabled={loading}
                            onClick={() => setDraftMatchMode('all')}
                        >
                            {t('folder_tag_match_all')}
                        </button>
                        <button
                            type="button"
                            className={draftMatchMode === 'any' ? 'active' : ''}
                            aria-pressed={draftMatchMode === 'any'}
                            disabled={loading}
                            onClick={() => setDraftMatchMode('any')}
                        >
                            {t('folder_tag_match_any')}
                        </button>
                    </div>
                </div>

                <div className="folder-tag-database-note">{t('folder_tag_database_note')}</div>

                {draftSelections.length > 0 && (
                    <div className="folder-tag-selected" aria-label={t('folder_tag_selected')}>
                        <div className="folder-tag-selected-header">
                            <strong>{t('folder_tag_selected_count', [draftSelections.length])}</strong>
                            <button type="button" disabled={loading} onClick={() => setDraftSelections([])}>
                                {t('folder_tag_clear')}
                            </button>
                        </div>
                        <div className="folder-tag-selected-list">
                            {draftSelections.map(selection => (
                                <button
                                    type="button"
                                    key={folderTagSelectionKey(selection)}
                                    disabled={loading}
                                    onClick={() => toggleSelection(selection.categoryId, selection.value)}
                                    title={t('folder_tag_remove')}
                                >
                                    <span>{categoryLabels.get(selection.categoryId) || selection.categoryId}</span>
                                    <strong>{selection.value}</strong>
                                    <span aria-hidden="true">×</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="folder-tag-browser">
                    {loading ? (
                        <div className="folder-tag-empty" role="status">{t('folder_tag_loading')}</div>
                    ) : activeCategory ? (
                        <>
                            <nav className="folder-tag-category-nav" aria-label={t('folder_tag_categories')}>
                                <div className="folder-tag-category-nav-header">
                                    <strong>{t('folder_tag_categories')}</strong>
                                    <span>{visibleCategories.length}</span>
                                </div>
                                <div className="folder-tag-category-nav-list">
                                    {visibleCategories.map(category => {
                                        const selectedCount = categorySelectionCounts.get(category.id) || 0;
                                        const active = category.id === activeCategory.id;
                                        return (
                                            <button
                                                type="button"
                                                key={category.id}
                                                className={active ? 'active' : ''}
                                                aria-current={active ? 'page' : undefined}
                                                onClick={() => setActiveCategoryId(category.id)}
                                            >
                                                <span>{t(category.labelKey)}</span>
                                                <small>{category.values.length}</small>
                                                {selectedCount > 0 && (
                                                    <strong
                                                        title={t('folder_tag_category_selected', [selectedCount])}
                                                        aria-label={t('folder_tag_category_selected', [selectedCount])}
                                                    >
                                                        {selectedCount}
                                                    </strong>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </nav>

                            <section className="folder-tag-results">
                                <div className="folder-tag-results-header">
                                    <div>
                                        <h3>{t(activeCategory.labelKey)}</h3>
                                        <span>{t('folder_tag_value_count', [activeCategory.values.length])}</span>
                                    </div>
                                    <div
                                        className="folder-tag-sort-mode"
                                        role="group"
                                        aria-label={t('folder_tag_sort')}
                                    >
                                        <button
                                            type="button"
                                            className={sortMode === 'frequency' ? 'active' : ''}
                                            aria-pressed={sortMode === 'frequency'}
                                            onClick={() => setSortMode('frequency')}
                                        >
                                            {t('folder_tag_sort_frequency')}
                                        </button>
                                        <button
                                            type="button"
                                            className={sortMode === 'name' ? 'active' : ''}
                                            aria-pressed={sortMode === 'name'}
                                            onClick={() => setSortMode('name')}
                                        >
                                            {t('folder_tag_sort_name')}
                                        </button>
                                    </div>
                                </div>
                                <div className="folder-tag-values" ref={valuesContainerRef}>
                                    {visibleValues.map(item => {
                                        const selection = { categoryId: activeCategory.id, value: item.value };
                                        const selected = selectionKeys.has(folderTagSelectionKey(selection));
                                        return (
                                            <button
                                                type="button"
                                                key={item.normalized}
                                                className={selected ? 'active' : ''}
                                                aria-pressed={selected}
                                                onClick={() => toggleSelection(activeCategory.id, item.value)}
                                            >
                                                <span>{item.value}</span>
                                                <small>{item.count}</small>
                                            </button>
                                        );
                                    })}
                                    {hiddenValueCount > 0 && (
                                        <button
                                            type="button"
                                            className="folder-tag-show-more"
                                            onClick={() => setVisibleValueLimit(limit => (
                                                limit + TAG_VALUE_LIMIT_INCREMENT
                                            ))}
                                        >
                                            {t('folder_tag_show_more', [hiddenValueCount])}
                                        </button>
                                    )}
                                </div>
                            </section>
                        </>
                    ) : (
                        <div className="folder-tag-empty">
                            {categories.length > 0
                                ? t('folder_tag_no_search_results')
                                : t('folder_tag_no_metadata')}
                        </div>
                    )}
                </div>

                <div className="layout-dialog-footer folder-tag-search-footer">
                    <span aria-live="polite">
                        {t('folder_tag_database_files', [totalFileCount])}
                    </span>
                    <div>
                        <button type="button" className="secondary" onClick={onClose}>{t('btn_cancel')}</button>
                        <button
                            type="button"
                            className="primary"
                            disabled={loading}
                            onClick={() => onApply({ selections: draftSelections, matchMode: draftMatchMode })}
                        >
                            {t('folder_tag_apply')}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

export { FolderTagSearchDialog };
