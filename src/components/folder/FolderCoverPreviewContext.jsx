import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

export const FolderCoverPreviewContext = createContext(null);

export function useFolderCoverPreview(file) {
    const store = useContext(FolderCoverPreviewContext);
    const key = store?.key(file) || '';
    const subscribe = useCallback(listener => store?.subscribe(key, listener) || (() => {}), [key, store]);
    const getSnapshot = useCallback(() => store?.snapshot(file) || null, [file, store]);
    const preview = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return useMemo(() => preview ? { ...file, ...preview } : file, [file, preview]);
}
