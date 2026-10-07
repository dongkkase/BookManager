import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeFolderFileCacheUpdate } from './useFolderScan.js';

const EMPTY_FILES = [];

export function useReadingLists(listId, t) {
    const [overview, setOverview] = useState({ collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0, previewRevision: 0 });
    const [overviewError, setOverviewError] = useState('');
    const [snapshot, setSnapshot] = useState({ id: '', files: EMPTY_FILES, previewRevision: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestRef = useRef(0);
    const overviewRef = useRef(0);
    const refreshOverview = useCallback(async () => {
        const sequence = ++overviewRef.current;
        try {
            const result = await window.electronAPI?.readingLists?.({ operation: 'overview' });
            if (!result?.success) throw new Error(result?.error || 'unavailable');
            if (sequence === overviewRef.current) {
                setOverview({
                    ...result,
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
    }, [t]);
    const refresh = useCallback(async () => {
        const sequence = ++requestRef.current;
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
                setSnapshot({ id: listId, files: result.files, previewRevision: sequence });
                if (listId === 'recent-added' || listId === 'recent-updated') {
                    const countKey = listId === 'recent-added' ? 'recentAddedCount' : 'recentUpdatedCount';
                    setOverview(current => ({ ...current, [countKey]: result.files.length }));
                }
            }
        } catch {
            if (sequence === requestRef.current) setError(t('reading_lists.load_failed'));
        } finally {
            if (sequence === requestRef.current) setLoading(false);
        }
    }, [listId, refreshOverview, t]);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        void refresh();
        return () => { requestRef.current += 1; };
    }, [refresh]);
    useEffect(() => {
        const reload = () => {
            void refreshOverview();
            void refresh();
        };
        void refreshOverview();
        const unsubscribe = window.electronAPI?.onReadingListsChanged?.(reload);
        const unsubscribeScan = window.electronAPI?.onScanComplete?.(reload);
        const timer = window.setInterval(() => {
            void refreshOverview();
            if (listId.startsWith('recent-')) void refresh();
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
    }, [listId, refresh, refreshOverview]);
    const mutate = useCallback(async request => {
        const result = await window.electronAPI?.readingLists?.(request);
        if (!result?.success) {
            const key = ['duplicate_name', 'invalid_name', 'list_not_found'].includes(result?.error) ? result.error : 'save_failed';
            throw new Error(t(`reading_lists.${key}`));
        }
        await Promise.all([refreshOverview(), refreshRef.current()]);
        return result;
    }, [refreshOverview, t]);
    const updateFilePreview = useCallback(file => {
        if (listId === 'collections') {
            setOverview(current => ({
                ...current,
                collections: current.collections.map(collection => collection.collectionId === file.collectionId
                    ? { ...collection, cover: file.cover, thumb_path: file.thumb_path, cover_file_path: file.cover_file_path }
                    : collection),
            }));
            return;
        }
        setSnapshot(current => {
            if (current.id !== listId) return current;
            let changed = false;
            const files = current.files.map(entry => {
                if (entry.path !== file.path) return entry;
                const updated = mergeFolderFileCacheUpdate(entry, file);
                if (updated !== entry) changed = true;
                return updated;
            });
            return changed ? { ...current, files } : current;
        });
    }, [listId]);
    return {
        ...overview,
        files: listId === 'collections' ? overview.collections : snapshot.id === listId ? snapshot.files : EMPTY_FILES,
        loading,
        error: listId === 'collections' ? overviewError : error,
        refresh,
        mutate,
        previewRevision: listId === 'collections' ? overview.previewRevision : snapshot.previewRevision,
        updateFilePreview,
    };
}
