import { useCallback, useEffect, useRef, useState } from 'react';
import { addSearchHistory, normalizeSearchHistory, removeSearchHistory } from '../folderSearchHistory.js';

function sameHistory(left, right) {
    return left.length === right.length && left.every((query, index) => query === right[index]);
}

export function useFolderSearchHistory(config, saveConfig, onSaveError) {
    const [searchHistory, setSearchHistory] = useState(() => normalizeSearchHistory(config?.folder_search_history));
    const historyRef = useRef(searchHistory);
    const initializedRef = useRef(Boolean(config));
    const pendingChangesRef = useRef([]);
    const saveQueueRef = useRef(Promise.resolve());
    const saveConfigRef = useRef(saveConfig);
    const onSaveErrorRef = useRef(onSaveError);
    const mountedRef = useRef(true);
    saveConfigRef.current = saveConfig;
    onSaveErrorRef.current = onSaveError;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const persistHistory = useCallback(nextHistory => {
        saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {
            try {
                if (typeof saveConfigRef.current !== 'function') return;
                const savedConfig = await saveConfigRef.current({ folder_search_history: nextHistory });
                if (savedConfig && typeof savedConfig === 'object'
                    && !sameHistory(normalizeSearchHistory(savedConfig.folder_search_history), nextHistory)) {
                    throw new Error('최근 검색어가 설정에 저장되지 않았습니다.');
                }
            } catch (error) {
                if (mountedRef.current) onSaveErrorRef.current?.(error);
            }
        });
        return saveQueueRef.current;
    }, []);

    useEffect(() => {
        // 최초 설정만 복원하여 이전 저장 응답이 새 검색이나 삭제를 되돌리지 않게 합니다.
        if (initializedRef.current || !config) return;
        initializedRef.current = true;
        const changes = pendingChangesRef.current;
        pendingChangesRef.current = [];
        const nextHistory = changes.reduce((history, change) => change(history), normalizeSearchHistory(config.folder_search_history));
        historyRef.current = nextHistory;
        setSearchHistory(nextHistory);
        if (changes.length > 0) void persistHistory(nextHistory);
    }, [config, persistHistory]);

    const updateHistory = useCallback(change => {
        const nextHistory = change(historyRef.current);
        if (initializedRef.current && sameHistory(historyRef.current, nextHistory)) return saveQueueRef.current;
        historyRef.current = nextHistory;
        setSearchHistory(nextHistory);
        if (!initializedRef.current) {
            pendingChangesRef.current.push(change);
            return Promise.resolve();
        }
        return persistHistory(nextHistory);
    }, [persistHistory]);

    const rememberSearchQuery = useCallback(query => {
        if (typeof query !== 'string' || !query.trim()) return saveQueueRef.current;
        return updateHistory(history => addSearchHistory(history, query));
    }, [updateHistory]);

    const removeSearchQuery = useCallback(query => {
        if (typeof query !== 'string' || !query.trim()) return saveQueueRef.current;
        return updateHistory(history => removeSearchHistory(history, query));
    }, [updateHistory]);

    const clearSearchHistory = useCallback(() => updateHistory(() => []), [updateHistory]);

    return { searchHistory, rememberSearchQuery, removeSearchQuery, clearSearchHistory };
}
