import { sortFolderFiles } from './folderViewState.js';

export function recentListDateKey(kind) {
    return kind === 'recent-reading' ? 'lastReadAt' : 'readingListAddedAt';
}

export function defaultRecentListOptions(kind) {
    return {
        days: kind === 'recent-reading' ? 0 : 14,
        extension: '',
        status: '',
        sortKey: recentListDateKey(kind),
        sortOrder: 'desc',
    };
}

export function recentListExtension(file) {
    return String(file.ext || (file.name || file.path || '').match(/\.[^./\\]+$/)?.[0] || '').toLowerCase();
}

export function filterRecentListFiles(files, kind, options, now = Date.now()) {
    const cutoff = options.days ? now - options.days * 86400000 : null;
    return files.filter(file => {
        if (cutoff !== null) {
            const time = Date.parse(file[recentListDateKey(kind)] || '');
            if (!Number.isFinite(time) || time < cutoff) return false;
        }
        if (options.extension && recentListExtension(file) !== options.extension) return false;
        const status = file.viewerStatus?.isCompleted ? 'completed' : file.viewerStatus?.hasReadingProgress ? 'reading' : 'unread';
        return !options.status || status === options.status;
    });
}

export function sortRecentListFiles(files, options) {
    if (options.sortKey !== 'progress') return sortFolderFiles(files, options.sortKey, options.sortOrder);
    return [...files].sort((a, b) => {
        const progress = file => file.viewerStatus?.hasReadingProgress ? Number(file.viewerStatus.percent) || 0 : 0;
        const result = progress(a) - progress(b);
        return options.sortOrder === 'desc' ? -result : result;
    });
}
