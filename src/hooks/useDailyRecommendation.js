import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DAILY_RECOMMENDATION_STORAGE_KEY,
    dailyRecommendationDay,
    findDailyRecommendations,
    isDailyRecommendationEntryVolume,
    nextRecommendationDelay,
    readDailyRecommendation,
} from '../dailyRecommendationState.js';
import { readingStatePathKey } from '../folderReadingStates.js';
import { createViewerStatusReader, isViewerStatusStorageKey } from '../viewerStatusState.js';
import {
    DEFAULT_RECOMMENDATION_PREFERENCES_KEY,
    RECOMMENDATION_PREFERENCES_STORAGE_KEY,
    normalizeRecommendationPreferences,
    readRecommendationPreferences,
    recommendationPreferencesKey,
    recommendationSeries,
} from '../recommendationPreferencesState.js';
import { dashboardRecommendationIndex, dashboardRecommendationOptions } from '../dashboardCatalogCache.js';

const EMPTY_FILES = [];

function recommendationStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function randomSeed() {
    return globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
        : Math.floor(Math.random() * 0x100000000);
}

function visibleSnapshot(snapshot, catalog, day) {
    if (!snapshot || snapshot.day !== day) return null;
    const path = snapshot.file?.full_path || snapshot.file?.path;
    if (!path && snapshot.source === catalog.source) return snapshot;
    return path && catalog.candidates.has(readingStatePathKey(path, catalog.platform)) ? snapshot : null;
}

function matchingRecord(record, preferencesKey) {
    return (record?.preferencesKey || DEFAULT_RECOMMENDATION_PREFERENCES_KEY) === preferencesKey ? record : null;
}

function mergeRecommendationPreview(file, preview) {
    return {
        ...file,
        ...preview,
        path: file.path,
        full_path: file.full_path || file.path,
        readingState: file.readingState,
        viewerStatus: file.viewerStatus,
        cover: preview?.cover || file.cover || '',
        thumb_path: preview?.thumb_path || file.thumb_path || '',
    };
}

export function useDailyRecommendation(files = EMPTY_FILES) {
    const [preferences, setPreferences] = useState(() => readRecommendationPreferences(recommendationStorage()));
    const preferencesRef = useRef(preferences);
    const [snapshot, setSnapshot] = useState(null);
    const snapshotRef = useRef(null);
    const filesRef = useRef(files);
    const requestRef = useRef(0);
    const mountedRef = useRef(false);
    const recordRef = useRef(null);
    const seedRef = useRef(null);
    const previewsRef = useRef(new Map());
    const catalogRef = useRef(null);
    const newRecommendationRef = useRef(null);
    const newRecommendationSequenceRef = useRef(0);
    const [newRecommendationLoading, setNewRecommendationLoading] = useState(false);
    filesRef.current = files;
    const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
    if (catalogRef.current?.source !== files || catalogRef.current.platform !== platform || catalogRef.current.preferences !== preferencesRef.current) {
        catalogRef.current = {
            source: files, platform, preferences: preferencesRef.current,
            preferencesKey: recommendationPreferencesKey(preferencesRef.current),
            candidates: dashboardRecommendationIndex(files, platform, preferencesRef.current),
        };
    }

    const saveRecord = useCallback(record => {
        recordRef.current = record;
        try {
            const storage = recommendationStorage();
            const serialized = JSON.stringify(record);
            if (storage?.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) !== serialized) {
                storage?.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, serialized);
            }
        } catch {
            // Keep the current recommendations in memory when storage is unavailable.
        }
    }, []);

    const loadPreview = useCallback((file, day) => {
        const catalog = catalogRef.current;
        const path = file.full_path || file.path;
        const key = readingStatePathKey(path, catalog.platform);
        const sourceFile = catalog.candidates.get(key)?.file;
        const cached = previewsRef.current.get(key);
        if (cached?.sourceFile === sourceFile && cached.day === day) return cached.promise;
        const entry = {
            sourceFile,
            day,
            promise: Promise.resolve().then(() => window.electronAPI?.getFilePreview?.(path, { force: false }))
                .then(response => response?.success && response.file ? response.file : null).catch(() => null),
        };
        previewsRef.current.set(key, entry);
        void entry.promise.then(preview => {
            if (!preview && previewsRef.current.get(key) === entry) previewsRef.current.delete(key);
        });
        return entry.promise;
    }, []);

    const selectRecommendation = useCallback(path => {
        if (!mountedRef.current || newRecommendationRef.current) return;
        const catalog = catalogRef.current;
        const day = dailyRecommendationDay();
        const current = visibleSnapshot(snapshotRef.current, catalog, day);
        const key = readingStatePathKey(path, catalog.platform);
        const file = current?.recommendations?.find(candidate => readingStatePathKey(candidate.full_path || candidate.path, catalog.platform) === key);
        if (!file || !catalog.candidates.has(key)) return;
        const next = { ...current, file };
        snapshotRef.current = next;
        setSnapshot(next);
        const record = matchingRecord(recordRef.current, catalog.preferencesKey);
        if (record?.day === day) saveRecord({ ...record, path: file.full_path || file.path });
        if (!window.electronAPI?.getFilePreview) return;
        void loadPreview(file, day).then(preview => {
            const latest = snapshotRef.current;
            if (!preview || !mountedRef.current || newRecommendationRef.current || catalogRef.current !== catalog || latest?.source !== current.source
                || latest.day !== day || day !== dailyRecommendationDay()) return;
            const updated = latest.recommendations.map(candidate => readingStatePathKey(candidate.full_path || candidate.path, catalog.platform) === key
                ? mergeRecommendationPreview(candidate, preview) : candidate);
            const selected = updated.find(candidate => (candidate.full_path || candidate.path) === (latest.file?.full_path || latest.file?.path));
            const hydrated = { ...latest, recommendations: updated, file: selected || latest.file };
            snapshotRef.current = hydrated;
            setSnapshot(hydrated);
        });
    }, [loadPreview, saveRecord]);

    const refresh = useCallback(async () => {
        if (!mountedRef.current) return;
        if (newRecommendationRef.current) {
            newRecommendationRef.current.revision += 1;
            return;
        }
        const source = filesRef.current;
        const day = dailyRecommendationDay();
        const sequence = ++requestRef.current;
        const storage = recommendationStorage();
        const catalog = catalogRef.current;
        const record = matchingRecord(readDailyRecommendation(storage), catalog.preferencesKey)
            || matchingRecord(recordRef.current, catalog.preferencesKey);
        const seed = record?.seed ?? seedRef.current ?? randomSeed();
        seedRef.current = seed;
        const { platform } = catalog;
        const isCurrent = () => mountedRef.current && sequence === requestRef.current
            && source === filesRef.current && day === dailyRecommendationDay();
        const publish = next => {
            snapshotRef.current = next;
            setSnapshot(next);
        };
        const previous = visibleSnapshot(snapshotRef.current, catalog, day);
        const retained = previous && !previous.loading && !previous.error ? previous : null;
        if (retained) {
            if (retained.source !== source) publish({ ...retained, source });
        } else {
            publish({ source, day, file: null, loading: Boolean(source?.length), error: null });
        }
        try {
            const result = await findDailyRecommendations({
                files: source,
                day,
                record,
                seed,
                request: window.electronAPI?.getReadingStates,
                readStatus: createViewerStatusReader(storage),
                platform,
                candidates: catalog.candidates,
                isCurrent,
            });
            if (!isCurrent() || !result) return;
            const latest = visibleSnapshot(snapshotRef.current, catalog, day);
            const previousFiles = new Map((latest?.recommendations || []).map(file => [readingStatePathKey(file.full_path || file.path, platform), file]));
            const recommendations = result.files.map(file => {
                const retainedFile = previousFiles.get(readingStatePathKey(file.full_path || file.path, platform));
                return retainedFile ? mergeRecommendationPreview(file, retainedFile) : file;
            });
            const latestPath = latest?.file?.full_path || latest?.file?.path;
            const file = recommendations.find(candidate => readingStatePathKey(candidate.full_path || candidate.path, platform) === readingStatePathKey(latestPath, platform))
                || recommendations.find(candidate => (candidate.full_path || candidate.path) === result.record?.path)
                || recommendations[0] || null;
            if (result.record) {
                result.record.preferencesKey = catalog.preferencesKey;
                result.record.path = file?.full_path || file?.path || '';
                saveRecord(result.record);
            }
            const keys = new Set(recommendations.map(candidate => readingStatePathKey(candidate.full_path || candidate.path, platform)));
            for (const key of previewsRef.current.keys()) {
                if (!keys.has(key)) previewsRef.current.delete(key);
            }
            const nextSnapshot = { source, day, file, recommendations, loading: false, error: null };
            publish(nextSnapshot);
            if (!file || !window.electronAPI?.getFilePreview) return;
            const preview = await loadPreview(file, day);
            if (!isCurrent() || !preview) return;
            const current = snapshotRef.current;
            const key = readingStatePathKey(file.full_path || file.path, platform);
            const updated = current.recommendations.map(candidate => readingStatePathKey(candidate.full_path || candidate.path, platform) === key
                ? mergeRecommendationPreview(candidate, preview) : candidate);
            const selected = updated.find(candidate => (candidate.full_path || candidate.path) === (current.file?.full_path || current.file?.path));
            publish({ ...current, recommendations: updated, file: selected || current.file });
        } catch (error) {
            if (isCurrent() && !retained?.file) {
                publish({ source, day, file: null, loading: false, error: error || new Error('reading_state_unavailable') });
            }
        }
    }, [loadPreview, saveRecord]);

    const finishNewRecommendation = useCallback((pending, revalidate = true) => {
        if (newRecommendationRef.current !== pending) return;
        newRecommendationRef.current = null;
        if (!mountedRef.current) return;
        setNewRecommendationLoading(false);
        if (revalidate) void refresh();
    }, [refresh]);

    const cancelNewRecommendation = useCallback(() => {
        const pending = newRecommendationRef.current;
        if (pending) finishNewRecommendation(pending);
    }, [finishNewRecommendation]);

    const updatePreferences = useCallback(nextValue => {
        const next = normalizeRecommendationPreferences(nextValue);
        if (recommendationPreferencesKey(next) === recommendationPreferencesKey(preferencesRef.current)) return;
        next.revision = `${Date.now()}-${randomSeed()}`;
        const preferencesKey = recommendationPreferencesKey(next);
        const storage = recommendationStorage();
        if (!storage) throw new Error('recommendation_preferences_save_failed');
        storage.setItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
        preferencesRef.current = next;
        setPreferences(next);
        newRecommendationRef.current = null;
        setNewRecommendationLoading(false);
        requestRef.current += 1;
        recordRef.current = null;
        seedRef.current = randomSeed();
        previewsRef.current.clear();
        const currentCatalog = catalogRef.current;
        catalogRef.current = {
            source: filesRef.current, platform: currentCatalog.platform, preferences: next, preferencesKey,
            candidates: dashboardRecommendationIndex(filesRef.current, currentCatalog.platform, next),
        };
        void refresh();
    }, [refresh]);

    const excludeRecommendation = useCallback((kind = 'book') => {
        const file = snapshotRef.current?.file;
        if (!file) return;
        const current = preferencesRef.current;
        const series = recommendationSeries(file);
        if (kind === 'series' && series) {
            updatePreferences({ ...current, excludedSeries: [...current.excludedSeries, series] });
        } else if (kind === 'book') {
            const path = file.full_path || file.path;
            updatePreferences({ ...current, excludedBooks: [...current.excludedBooks, { path, title: file.title || file.name }] });
        }
    }, [updatePreferences]);

    const prepareNewRecommendation = useCallback(async () => {
        const cancelled = { status: 'cancelled', file: null, token: null };
        if (!mountedRef.current || newRecommendationRef.current) return cancelled;
        const day = dailyRecommendationDay();
        const catalog = catalogRef.current;
        const storage = recommendationStorage();
        const record = matchingRecord(readDailyRecommendation(storage), catalog.preferencesKey)
            || matchingRecord(recordRef.current, catalog.preferencesKey);
        const current = visibleSnapshot(snapshotRef.current, catalog, day);
        const currentPath = current?.file?.full_path || current?.file?.path || (record?.day === day ? record.path : '');
        const currentPaths = current?.recommendations?.map(file => file.full_path || file.path)
            || (record?.day === day ? record.paths || [record.path] : []);
        const seed = randomSeed();
        const pending = {
            token: ++newRecommendationSequenceRef.current,
            day,
            snapshot: current,
            seed: seed === record?.seed ? (seed + 1) >>> 0 : seed,
            revision: 0,
            prepared: null,
            result: null,
            committing: false,
        };
        newRecommendationRef.current = pending;
        requestRef.current += 1;
        setNewRecommendationLoading(true);
        const isCurrent = () => mountedRef.current && newRecommendationRef.current === pending
            && day === dailyRecommendationDay();
        try {
            const result = await findDailyRecommendations({
                day,
                record: { ...record, day, path: currentPath, paths: currentPaths,
                    previousPath: record?.day === day ? record.previousPath || '' : record?.path || '' },
                seed: pending.seed,
                request: window.electronAPI?.getReadingStates,
                readStatus: createViewerStatusReader(storage),
                platform: catalog.platform,
                candidates: catalog.candidates,
                redraw: true,
                isCurrent,
            });
            if (!isCurrent() || !result) {
                finishNewRecommendation(pending);
                return cancelled;
            }
            let file = result.file;
            if (result.record) result.record.preferencesKey = catalog.preferencesKey;
            const sameBook = file && readingStatePathKey(result.record.path, catalog.platform)
                === readingStatePathKey(currentPath, catalog.platform);
            const same = file && result.files.length === currentPaths.length
                && result.files.every((candidate, index) => readingStatePathKey(candidate.full_path || candidate.path, catalog.platform)
                    === readingStatePathKey(currentPaths[index], catalog.platform));
            if (file && !sameBook && window.electronAPI?.getFilePreview) {
                const preview = await Promise.resolve().then(() => window.electronAPI.getFilePreview(result.record.path, { force: false }))
                    .then(response => response?.success && response.file ? response.file : null).catch(() => null);
                if (preview) file = mergeRecommendationPreview(file, preview);
            } else if (sameBook && current?.file) {
                file = mergeRecommendationPreview(file, current.file);
            }
            const latest = catalogRef.current;
            if (!isCurrent() || result.files.some(candidate => !latest.candidates.has(readingStatePathKey(candidate.full_path || candidate.path, latest.platform)))
                || (file && !isDailyRecommendationEntryVolume(file))) {
                finishNewRecommendation(pending);
                return cancelled;
            }
            const prepared = { status: file ? same ? 'same' : 'ready' : 'empty', file, token: pending.token };
            pending.result = result;
            pending.prepared = prepared;
            return prepared;
        } catch (error) {
            if (!isCurrent()) {
                finishNewRecommendation(pending);
                return cancelled;
            }
            finishNewRecommendation(pending);
            throw error || new Error('reading_state_unavailable');
        }
    }, [finishNewRecommendation]);

    const commitNewRecommendation = useCallback(async prepared => {
        const pending = newRecommendationRef.current;
        if (!pending?.prepared || pending.prepared.token !== prepared?.token || pending.prepared.status !== 'ready' || pending.committing) return false;
        pending.committing = true;
        const isCurrent = () => mountedRef.current && newRecommendationRef.current === pending
            && pending.day === dailyRecommendationDay();
        try {
            if (!isCurrent()) return false;
            const catalog = catalogRef.current;
            const paths = pending.result.record.paths;
            if (paths.some(path => !catalog.candidates.has(readingStatePathKey(path, catalog.platform)))) return false;
            const revision = pending.revision;
            const rows = await window.electronAPI?.getReadingStates?.(paths);
            if (!isCurrent() || revision !== pending.revision) return false;
            if (!Array.isArray(rows)) throw new Error('reading_state_unavailable');
            const latest = catalogRef.current;
            const states = new Map(rows.filter(row => row && !row.deletedAt && typeof row.filePath === 'string')
                .map(row => [readingStatePathKey(row.filePath, latest.platform), row]));
            const readStatus = createViewerStatusReader(recommendationStorage());
            const recommendations = [];
            for (let index = 0; index < paths.length; index += 1) {
                const key = readingStatePathKey(paths[index], latest.platform);
                const candidate = latest.candidates.get(key);
                if (!candidate) return false;
                const file = {
                    ...(index === 0 ? pending.prepared.file : pending.result.files[index]),
                    ...(candidate.file === pending.result.sourceFiles[index] ? {} : candidate.file),
                    path: candidate.file.path,
                    full_path: candidate.path,
                    readingState: states.get(key) || null,
                };
                file.viewerStatus = readStatus(file);
                if (!isDailyRecommendationEntryVolume(file) || file.viewerStatus.isCompleted || file.viewerStatus.hasReadingProgress) return false;
                recommendations.push(file);
            }
            const file = recommendations[0];
            const record = { ...pending.result.record, path: file.full_path, paths: recommendations.map(candidate => candidate.full_path) };
            seedRef.current = record.seed;
            saveRecord(record);
            const key = readingStatePathKey(file.full_path, latest.platform);
            previewsRef.current.set(key, { sourceFile: latest.candidates.get(key).file, day: pending.day, promise: Promise.resolve(file) });
            const retainedKeys = new Set(record.paths.map(path => readingStatePathKey(path, latest.platform)));
            for (const previewKey of previewsRef.current.keys()) {
                if (!retainedKeys.has(previewKey)) previewsRef.current.delete(previewKey);
            }
            const next = { source: latest.source, day: pending.day, file, recommendations, loading: false, error: null };
            snapshotRef.current = next;
            setSnapshot(next);
            finishNewRecommendation(pending, false);
            return true;
        } finally {
            finishNewRecommendation(pending);
        }
    }, [finishNewRecommendation, saveRecord]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
            newRecommendationRef.current = null;
        };
    }, []);
    useEffect(() => {
        void refresh();
        return () => { requestRef.current += 1; };
    }, [files, refresh]);
    useEffect(() => {
        let midnightTimer;
        const scheduleMidnight = () => {
            window.clearTimeout(midnightTimer);
            midnightTimer = window.setTimeout(() => {
                void refresh();
                scheduleMidnight();
            }, nextRecommendationDelay() + 20);
        };
        const onFocus = () => {
            void refresh();
            scheduleMidnight();
        };
        const onVisibility = () => { if (document.visibilityState === 'visible') onFocus(); };
        const onStorage = event => {
            if (!event.key || event.key === RECOMMENDATION_PREFERENCES_STORAGE_KEY) {
                const next = readRecommendationPreferences(recommendationStorage());
                if (recommendationPreferencesKey(next) !== recommendationPreferencesKey(preferencesRef.current)) {
                    preferencesRef.current = next;
                    setPreferences(next);
                    requestRef.current += 1;
                    newRecommendationRef.current = null;
                    setNewRecommendationLoading(false);
                    const catalog = catalogRef.current;
                    catalogRef.current = {
                        ...catalog, preferences: next, preferencesKey: recommendationPreferencesKey(next),
                        candidates: dashboardRecommendationIndex(filesRef.current, catalog.platform, next),
                    };
                    void refresh();
                    return;
                }
            }
            if (!event.key || event.key === DAILY_RECOMMENDATION_STORAGE_KEY || isViewerStatusStorageKey(event.key)) void refresh();
        };
        const unsubscribe = window.electronAPI?.onRecentReadingChanged?.(() => { void refresh(); });
        window.addEventListener('focus', onFocus);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisibility);
        scheduleMidnight();
        return () => {
            unsubscribe?.();
            window.clearTimeout(midnightTimer);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh]);

    const current = newRecommendationRef.current
        ? newRecommendationRef.current.snapshot : visibleSnapshot(snapshot, catalogRef.current, dailyRecommendationDay());
    return {
        file: current?.file || null,
        recommendations: current?.recommendations || EMPTY_FILES,
        selectRecommendation,
        loading: current ? current.loading : Boolean(files?.length),
        error: current?.error || null,
        refresh,
        prepareNewRecommendation,
        commitNewRecommendation,
        cancelNewRecommendation,
        newRecommendationLoading,
        preferences,
        get preferenceOptions() { return dashboardRecommendationOptions(files); },
        updatePreferences,
        excludeRecommendation,
    };
}
