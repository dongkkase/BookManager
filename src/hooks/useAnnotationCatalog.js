import { useCallback, useEffect, useMemo, useState } from 'react';
import { ANNOTATION_STORAGE_PREFIX, deleteCatalogAnnotation, readAnnotationCatalog } from '../annotationCatalog';

const EMPTY_FILES = [];

export function useAnnotationCatalog(files = EMPTY_FILES) {
    const [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision(value => value + 1), []);
    const deleteAnnotation = useCallback(entry => {
        try {
            return deleteCatalogAnnotation(entry, window.localStorage);
        } finally {
            refresh();
        }
    }, [refresh]);
    const catalog = useMemo(() => {
        if (!files.length) return { entries: [], errors: [] };
        try {
            return readAnnotationCatalog(files, window.localStorage);
        } catch {
            return { entries: [], errors: ['storage'] };
        }
    }, [files, revision]);
    useEffect(() => {
        const onStorage = event => {
            if (!event.key || event.key.startsWith(ANNOTATION_STORAGE_PREFIX)) refresh();
        };
        const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh]);
    return { catalog, refresh, deleteAnnotation };
}
