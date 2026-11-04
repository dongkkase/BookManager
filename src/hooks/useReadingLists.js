import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeFolderFileCacheUpdate } from './useFolderScan.js';
import { prepareAuthorCatalog } from '../authorCatalog.js';

const EMPTY_FILES = [];
const MANUAL_SNAPSHOT_LIMIT = 8;

export function useReadingLists(listId, t, localFiles = null, libraryPaths = [], language = 'ko') {
    const libraryScopeKey = JSON.stringify([...new Set(libraryPaths)].sort());
    const isRecentList = listId === 'recent-added' || listId === 'recent-updated';
    const [overview, setOverview] = useState({ collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0, previewRevision: 0 });
    const [overviewError, setOverviewError] = useState('');
    const [overviewLoading, setOverviewLoading] = useState(false);
    const [snapshot, setSnapshot] = useState({ id: '', files: EMPTY_FILES, previewRevision: 0 });
    const [recentSnapshots, setRecentSnapshots] = useState({});
    const [manualSnapshots, setManualSnapshots] = useState({});
    const [catalogSnapshot, setCatalogSnapshot] = useState(null);
    const catalogRef = useRef(null);
    const catalogScopeRef = useRef(libraryScopeKey);
    const catalogRequestRef = useRef(0);
    const catalogPendingRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestRef = useRef(0);
    const overviewRef = useRef(0);
    const listIdRef = useRef(listId);
    listIdRef.current = listId;
    const invalidateCatalog = useCallback((keepSnapshot = false) => {
        if (!keepSnapshot) catalogRef.current = null;
        catalogRequestRef.current += 1;
        catalogPendingRef.current = null;
    }, []);
    const refreshCatalog = useCallback(async ({ allowCached = false } = {}) => {
        if (catalogScopeRef.current !== libraryScopeKey) {
            catalogScopeRef.current = libraryScopeKey;
            invalidateCatalog();
            setCatalogSnapshot(null);
        }
        if (allowCached && catalogRef.current) return catalogRef.current;
        if (catalogPendingRef.current) return catalogPendingRef.current.promise;
        const sequence = ++catalogRequestRef.current;
        const pending = { sequence, promise: null };
        catalogPendingRef.current = pending;
        pending.promise = (async () => {
            try {
                const cached = catalogRef.current;
                const result = await window.electronAPI?.readingLists?.({
                    operation: 'list', id: 'library-catalog',
                    ...(cached?.catalogVersion ? { catalogVersion: cached.catalogVersion } : {}),
                });
                if (!result?.success) throw new Error(result?.error || 'unavailable');
                if (cached && result.unchanged) return cached;
                await prepareAuthorCatalog(result.files, language, {
                    isCurrent: () => sequence === catalogRequestRef.current && catalogScopeRef.current === libraryScopeKey,
                });
                const nextSnapshot = { id: 'library-catalog', files: result.files, previewRevision: sequence, libraryScopeKey, catalogVersion: result.catalogVersion };
                if (sequence === catalogRequestRef.current && catalogScopeRef.current === libraryScopeKey) {
                    catalogRef.current = nextSnapshot;
                    setCatalogSnapshot(nextSnapshot);
                }
                return nextSnapshot;
            } finally {
                if (catalogPendingRef.current?.sequence === sequence) catalogPendingRef.current = null;
            }
        })();
        return pending.promise;
    }, [invalidateCatalog, language, libraryScopeKey]);
    const invalidateInactiveLists = useCallback(() => {
        setRecentSnapshots(current => current[listIdRef.current]
            ? { [listIdRef.current]: current[listIdRef.current] }
            : {});
        setManualSnapshots(current => current[listIdRef.current]
            ? { [listIdRef.current]: current[listIdRef.current] }
            : {});
    }, []);
    const refreshOverview = useCallback(async () => {
        const sequence = ++overviewRef.current;
        setOverviewLoading(true);
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
        } finally {
            if (sequence === overviewRef.current) setOverviewLoading(false);
        }
    }, [libraryScopeKey, t]);
    const refresh = useCallback(async ({ allowCached = false } = {}) => {
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
        if (listId === 'library-catalog' && allowCached && catalogRef.current?.libraryScopeKey === libraryScopeKey) {
            setLoading(false);
            setError('');
            return;
        }
        setLoading(true);
        setError('');
        try {
            if (listId === 'library-catalog') {
                await refreshCatalog({ allowCached });
                return;
            }
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
                    setManualSnapshots(current => Object.fromEntries([
                        ...Object.entries(current).filter(([id, value]) => id !== listId && value.libraryScopeKey === libraryScopeKey)
                            .slice(-(MANUAL_SNAPSHOT_LIMIT - 1)),
                        [listId, nextSnapshot],
                    ]));
                }
            }
        } catch {
            if (sequence === requestRef.current) setError(t('reading_lists.load_failed'));
        } finally {
            if (sequence === requestRef.current) setLoading(false);
        }
    }, [isRecentList, libraryScopeKey, listId, localFiles, refreshCatalog, refreshOverview, t]);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        void refresh({ allowCached: true });
        return () => { requestRef.current += 1; };
    }, [refresh]);
    useEffect(() => {
        void refreshCatalog({ allowCached: true }).catch(() => {});
    }, [refreshCatalog]);
    useEffect(() => () => {
        catalogRequestRef.current += 1;
        catalogPendingRef.current = null;
    }, []);
    useEffect(() => {
        const reload = keepCatalogSnapshot => {
            invalidateInactiveLists();
            invalidateCatalog(keepCatalogSnapshot);
            if (listIdRef.current !== 'collections') void refreshOverview();
            void refreshRef.current();
            void refreshCatalog().catch(() => {});
        };
        const onFocus = () => reload(true);
        const onChange = () => reload(false);
        void refreshOverview();
        const unsubscribe = window.electronAPI?.onReadingListsChanged?.(onChange);
        const unsubscribeScan = window.electronAPI?.onScanComplete?.(onChange);
        const timer = window.setInterval(() => {
            invalidateInactiveLists();
            void refreshOverview();
            if (listIdRef.current.startsWith('recent-')) void refreshRef.current();
        }, 60000);
        window.addEventListener('focus', onFocus);
        window.addEventListener('bookmanager:metadata-saved', onChange);
        return () => {
            overviewRef.current += 1;
            unsubscribe?.();
            unsubscribeScan?.();
            window.clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('bookmanager:metadata-saved', onChange);
        };
    }, [invalidateCatalog, invalidateInactiveLists, refreshCatalog, refreshOverview]);
    const mutate = useCallback(async request => {
        const result = await window.electronAPI?.readingLists?.(request);
        if (!result?.success) {
            const key = ['duplicate_name', 'invalid_name', 'list_not_found'].includes(result?.error) ? result.error : 'save_failed';
            throw new Error(t(`reading_lists.${key}`));
        }
        invalidateInactiveLists();
        invalidateCatalog();
        await Promise.all([refreshOverview(), refreshRef.current(), refreshCatalog({ allowCached: true }).catch(() => {})]);
        return result;
    }, [invalidateCatalog, invalidateInactiveLists, refreshCatalog, refreshOverview, t]);
    const visibleSnapshot = listId === 'library-catalog' ? catalogSnapshot
        : isRecentList ? recentSnapshots[listId] : localFiles !== null ? snapshot : manualSnapshots[listId];
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
        const updateSnapshot = current => {
            if (current?.id !== listId || current.previewRevision !== previewRevision) return current;
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
        };
        if (localFiles !== null) setSnapshot(updateSnapshot);
        else setManualSnapshots(current => {
            const updated = updateSnapshot(current[listId]);
            return updated === current[listId] ? current : { ...current, [listId]: updated };
        });
    }, [listId, localFiles, previewRevision]);
    return {
        ...overview,
        recentAddedCount: overview.libraryScopeKey === libraryScopeKey ? overview.recentAddedCount : 0,
        recentUpdatedCount: overview.libraryScopeKey === libraryScopeKey ? overview.recentUpdatedCount : 0,
        catalogFiles: catalogSnapshot?.libraryScopeKey === libraryScopeKey ? catalogSnapshot.files : EMPTY_FILES,
        files: listId === 'collections' ? overview.collections
            : visibleSnapshot?.id === listId && (localFiles !== null || visibleSnapshot.libraryScopeKey === libraryScopeKey) ? visibleSnapshot.files : EMPTY_FILES,
        loading,
        error: listId === 'collections' ? overviewError : error,
        overviewError,
        overviewLoading,
        overviewLoaded: overview.previewRevision > 0,
        refresh,
        refreshOverview,
        mutate,
        previewRevision,
        updateFilePreview,
    };
}
