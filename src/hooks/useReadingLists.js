import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeFolderFileCacheUpdate } from './useFolderScan.js';

const EMPTY_FILES = [];

export function useReadingLists(listId, t, localFiles = null, libraryPaths = []) {
    const libraryScopeKey = JSON.stringify([...new Set(libraryPaths)].sort());
    const isRecentList = listId === 'recent-added' || listId === 'recent-updated';
    const [overview, setOverview] = useState({ collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0, previewRevision: 0 });
    const [overviewError, setOverviewError] = useState('');
    const [snapshot, setSnapshot] = useState({ id: '', files: EMPTY_FILES, previewRevision: 0 });
    const [recentSnapshots, setRecentSnapshots] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestRef = useRef(0);
    const overviewRef = useRef(0);
    const listIdRef = useRef(listId);
    listIdRef.current = listId;
    const invalidateInactiveRecentLists = useCallback(() => {
        setRecentSnapshots(current => current[listIdRef.current]
            ? { [listIdRef.current]: current[listIdRef.current] }
            : {});
    }, []);
    const refreshOverview = useCallback(async () => {
        const sequence = ++overviewRef.current;
        try {
            const result = await window.electronAPI?.readingLists?.({ operation: 'overview' });
            if (!result?.success) throw new Error(result?.error || 'unavailable');
            if (sequence === overviewRef.current) {
                setOverview({
                    ...result,
                    libraryScopeKey,
                    previewRevision: sequence,
                    collections: result.collections.map(collection => ({
                        ...collection,
                        collectionId: collection.id,
                        path: `collection://${collection.id}`,
                        folder_path: t('reading_lists.collections'),
                        title: collection.name,
                        isDirectory: true,
                        is_folder: true,
                        size: 0,
                        cover: '',
                        created: collection.created_at || '',
                        readingListAddedAt: collection.created_at || '',
                    })),
                });
                setOverviewError('');
            }
        } catch {
            if (sequence === overviewRef.current) setOverviewError(t('reading_lists.load_failed'));
        }
    }, [libraryScopeKey, t]);
    const refresh = useCallback(async () => {
        const sequence = ++requestRef.current;
        if (localFiles !== null) {
            setSnapshot({ id: listId, files: localFiles, previewRevision: sequence });
            setLoading(false);
            setError('');
            return;
        }
        if (!listId || listId === 'collections') {
            setLoading(false);
            setError('');
            if (listId === 'collections') await refreshOverview();
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await window.electronAPI?.readingLists?.({ operation: 'list', id: listId });
            if (!result?.success) throw new Error(result?.error || 'unavailable');
            if (sequence === requestRef.current) {
                const nextSnapshot = { id: listId, files: result.files, previewRevision: sequence, libraryScopeKey };
                if (isRecentList) {
                    setRecentSnapshots(current => ({
                        ...Object.fromEntries(Object.entries(current).filter(([, value]) => value.libraryScopeKey === libraryScopeKey)),
                        [listId]: nextSnapshot,
                    }));
                    const countKey = listId === 'recent-added' ? 'recentAddedCount' : 'recentUpdatedCount';
                    setOverview(current => ({
                        ...current,
                        ...(current.libraryScopeKey === libraryScopeKey ? {} : { recentAddedCount: 0, recentUpdatedCount: 0 }),
                        libraryScopeKey,
                        [countKey]: result.files.length,
                    }));
                } else {
                    setSnapshot(nextSnapshot);
                }
            }
        } catch {
            if (sequence === requestRef.current) setError(t('reading_lists.load_failed'));
        } finally {
            if (sequence === requestRef.current) setLoading(false);
        }
    }, [isRecentList, libraryScopeKey, listId, localFiles, refreshOverview, t]);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        void refresh();
        return () => { requestRef.current += 1; };
    }, [refresh]);
    useEffect(() => {
        const reload = () => {
            invalidateInactiveRecentLists();
            void refreshOverview();
            void refreshRef.current();
        };
        void refreshOverview();
        const unsubscribe = window.electronAPI?.onReadingListsChanged?.(reload);
        const unsubscribeScan = window.electronAPI?.onScanComplete?.(reload);
        const timer = window.setInterval(() => {
            invalidateInactiveRecentLists();
            void refreshOverview();
            if (listIdRef.current.startsWith('recent-')) void refreshRef.current();
        }, 60000);
        window.addEventListener('focus', reload);
        window.addEventListener('bookmanager:metadata-saved', reload);
        return () => {
            overviewRef.current += 1;
            unsubscribe?.();
            unsubscribeScan?.();
            window.clearInterval(timer);
            window.removeEventListener('focus', reload);
            window.removeEventListener('bookmanager:metadata-saved', reload);
        };
    }, [invalidateInactiveRecentLists, refreshOverview]);
    const mutate = useCallback(async request => {
        const result = await window.electronAPI?.readingLists?.(request);
        if (!result?.success) {
            const key = ['duplicate_name', 'invalid_name', 'list_not_found'].includes(result?.error) ? result.error : 'save_failed';
            throw new Error(t(`reading_lists.${key}`));
        }
        invalidateInactiveRecentLists();
        await Promise.all([refreshOverview(), refreshRef.current()]);
        return result;
    }, [invalidateInactiveRecentLists, refreshOverview, t]);
    const visibleSnapshot = isRecentList ? recentSnapshots[listId] : snapshot;
    const previewRevision = listId === 'collections' ? overview.previewRevision : visibleSnapshot?.previewRevision || 0;
    const updateFilePreview = useCallback(file => {
        if (listId === 'collections') {
            setOverview(current => current.previewRevision !== previewRevision ? current : ({
                ...current,
                collections: current.collections.map(collection => collection.collectionId === file.collectionId
                    ? { ...collection, cover: file.cover, thumb_path: file.thumb_path, cover_file_path: file.cover_file_path }
                    : collection),
            }));
            return;
        }
        setSnapshot(current => {
            if (current.id !== listId || current.previewRevision !== previewRevision) return current;
            let changed = false;
            const files = current.files.map(entry => {
                if (entry.path !== file.path) return entry;
                const updated = mergeFolderFileCacheUpdate(entry, localFiles !== null
                    ? { ...file, name: entry.name, title: entry.title }
                    : file);
                if (updated !== entry) changed = true;
                return updated;
            });
            return changed ? { ...current, files } : current;
        });
    }, [listId, localFiles, previewRevision]);
    return {
        ...overview,
        recentAddedCount: overview.libraryScopeKey === libraryScopeKey ? overview.recentAddedCount : 0,
        recentUpdatedCount: overview.libraryScopeKey === libraryScopeKey ? overview.recentUpdatedCount : 0,
        files: listId === 'collections' ? overview.collections
            : visibleSnapshot?.id === listId && (!isRecentList || visibleSnapshot.libraryScopeKey === libraryScopeKey) ? visibleSnapshot.files : EMPTY_FILES,
        loading,
        error: listId === 'collections' ? overviewError : error,
        refresh,
        mutate,
        previewRevision,
        updateFilePreview,
    };
}
