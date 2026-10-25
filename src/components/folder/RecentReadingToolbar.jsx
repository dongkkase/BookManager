import React from 'react';
import { recentListDateKey } from '../../recentReadingListState.js';
import { FOLDER_COLUMNS } from '../../folderColumnLayout.js';
import { ToolbarSelect } from './ToolbarDropdown';

export function RecentReadingToolbar({ kind, options, extensions, onChange, onReset, count, total, t, inline = false }) {
    const dateLabel = t(`reading_lists.${kind === 'recent-reading' ? 'read_at' : kind === 'recent-added' ? 'added_at' : 'updated_at'}`);
    const countLabel = ['recent-added', 'recent-updated'].includes(kind) && total >= 1000
        ? 'reading_lists.limited_filtered_count'
        : 'reading_lists.filtered_count';
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
    const controlClass = inline ? 'toolbar-btn' : undefined;
    const field = (label, control) => inline ? control : <label><span>{label}</span>{control}</label>;
    const controls = <>
        {field(dateLabel, <ToolbarSelect label={dateLabel} value={options.days} onChange={days => onChange({ days })} options={[
            ...(kind === 'recent-reading' ? [{ value: 0, label: t('reading_lists.all_period') }] : []),
            ...[14, 7, 3, 1].map(days => ({ value: days, label: t('reading_lists.last_days', [days]) })),
        ]} />)}
        {field(t('reading_lists.file_type'), <ToolbarSelect label={t('reading_lists.file_type')} value={options.extension} onChange={extension => onChange({ extension })} options={[
            { value: '', label: t('reading_lists.all_types') },
            ...extensions.map(extension => ({ value: extension, label: extension.replace(/^\./, '').toUpperCase() })),
        ]} />)}
        {field(t('reading_lists.reading_status'), <ToolbarSelect label={t('reading_lists.reading_status')} value={options.status} onChange={status => onChange({ status })}
            options={['', 'unread', 'reading', 'completed'].map(status => ({ value: status, label: t(`reading_lists.status_${status || 'all'}`) }))} />)}
        {field(t('reading_lists.sort'), <ToolbarSelect label={t('reading_lists.sort')} value={options.sortKey} onChange={sortKey => onChange({
            sortKey,
            sortOrder: [recentListDateKey(kind), 'progress', 'size', 'modified'].includes(sortKey) ? 'desc' : 'asc',
        })} options={Object.entries(sortLabels).map(([value, label]) => ({ value, label }))} />)}
        <ToolbarSelect label={t('reading_lists.sort_order')} value={options.sortOrder} onChange={sortOrder => onChange({ sortOrder })} options={[
            { value: 'desc', label: t('reading_lists.descending') },
            { value: 'asc', label: t('reading_lists.ascending') },
        ]} />
        <button className={controlClass} type="button" onClick={onReset}>{t('reading_lists.reset_filters')}</button>
    </>;
    return (
        <div key={kind} className={`recent-list-toolbar${inline ? ' is-inline' : ''}`} role="group" aria-label={t('reading_lists.filters')}>
            {inline ? <div className="folder-toolbar recent-list-toolbar-controls">{controls}</div> : controls}
            <span className="recent-list-result-count" role="status">{t(countLabel, [count, total])}</span>
        </div>
    );
}
