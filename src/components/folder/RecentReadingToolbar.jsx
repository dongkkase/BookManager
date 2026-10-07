import React from 'react';
import { defaultRecentListOptions, recentListDateKey } from '../../recentReadingListState.js';
import { FOLDER_COLUMNS } from '../../folderColumnLayout.js';

export function RecentReadingToolbar({ kind, options, extensions, onChange, count, total, t }) {
    const dateLabel = t(`reading_lists.${kind === 'recent-reading' ? 'read_at' : kind === 'recent-added' ? 'added_at' : 'updated_at'}`);
    const sortLabels = {
        [recentListDateKey(kind)]: dateLabel,
        name: t('col_name'),
        title: t('col_title'),
        author: t('col_writer'),
        series: t('col_series'),
        ext: t('col_ext'),
        size: t('col_size'),
        modified: t('col_mtime'),
        ...(kind === 'recent-reading' ? { progress: t('reading_lists.progress') } : {}),
    };
    if (!sortLabels[options.sortKey]) {
        const column = FOLDER_COLUMNS.find(item => item.key === options.sortKey);
        if (column) sortLabels[options.sortKey] = t(column.labelKey);
    }
    return (
        <div className="recent-list-toolbar" role="group" aria-label={t('reading_lists.filters')}>
            <label>
                <span>{dateLabel}</span>
                <select aria-label={dateLabel} value={options.days} onChange={event => onChange({ days: Number(event.target.value) })}>
                    {kind === 'recent-reading' && <option value={0}>{t('reading_lists.all_period')}</option>}
                    {[14, 7, 3, 1].map(days => <option key={days} value={days}>{t('reading_lists.last_days', [days])}</option>)}
                </select>
            </label>
            <label>
                <span>{t('reading_lists.file_type')}</span>
                <select aria-label={t('reading_lists.file_type')} value={options.extension} onChange={event => onChange({ extension: event.target.value })}>
                    <option value="">{t('reading_lists.all_types')}</option>
                    {extensions.map(extension => <option key={extension} value={extension}>{extension.replace(/^\./, '').toUpperCase()}</option>)}
                </select>
            </label>
            <label>
                <span>{t('reading_lists.reading_status')}</span>
                <select aria-label={t('reading_lists.reading_status')} value={options.status} onChange={event => onChange({ status: event.target.value })}>
                    {['', 'unread', 'reading', 'completed'].map(status => <option key={status} value={status}>{t(`reading_lists.status_${status || 'all'}`)}</option>)}
                </select>
            </label>
            <label>
                <span>{t('reading_lists.sort')}</span>
                <select aria-label={t('reading_lists.sort')} value={options.sortKey} onChange={event => onChange({
                    sortKey: event.target.value,
                    sortOrder: [recentListDateKey(kind), 'progress', 'size', 'modified'].includes(event.target.value) ? 'desc' : 'asc',
                })}>
                    {Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
            </label>
            <select aria-label={t('reading_lists.sort_order')} value={options.sortOrder} onChange={event => onChange({ sortOrder: event.target.value })}>
                <option value="desc">{t('reading_lists.descending')}</option>
                <option value="asc">{t('reading_lists.ascending')}</option>
            </select>
            <button type="button" onClick={() => onChange(defaultRecentListOptions(kind))}>{t('reading_lists.reset_filters')}</button>
            <span className="recent-list-result-count" role="status">{t('reading_lists.filtered_count', [count, total])}</span>
        </div>
    );
}
