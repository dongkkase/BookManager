import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DAILY_RECOMMENDATION_STORAGE_KEY,
    createDailyRecommendationIndex,
    dailyRecommendationDay,
    findDailyRecommendation,
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
    recommendationPreferenceOptions,
    recommendationPreferencesKey,
    recommendationSeries,
} from '../recommendationPreferencesState.js';

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
    const optionsRef = useRef(null);
    const [snapshot, setSnapshot] = useState(null);
    const snapshotRef = useRef(null);
    const filesRef = useRef(files);
    const requestRef = useRef(0);
    const mountedRef = useRef(false);
    const recordRef = useRef(null);
    const seedRef = useRef(null);
    const previewRef = useRef(null);
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
            candidates: createDailyRecommendationIndex(files, platform, preferencesRef.current),
        };
    }
    if (optionsRef.current?.source !== files) {
        optionsRef.current = { source: files, value: recommendationPreferenceOptions(files) };
    }

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
            const result = await findDailyRecommendation({
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
            if (result.record) {
                result.record.preferencesKey = catalog.preferencesKey;
                recordRef.current = result.record;
                try {
                    const nextRecord = JSON.stringify(result.record);
                    if (storage?.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) !== nextRecord) {
                        storage?.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, nextRecord);
                    }
                } catch {
                    // Keep the current recommendation in memory when storage is unavailable.
                }
            }
            const nextSnapshot = { source, day, file: result.file, loading: false, error: null };
            if (!result.file || !window.electronAPI?.getFilePreview) {
                publish(nextSnapshot);
                return;
            }
            const retainedPath = retained?.file?.full_path || retained?.file?.path;
            const sameBook = readingStatePathKey(retainedPath, platform) === readingStatePathKey(result.record.path, platform);
            if (!sameBook) {
                publish(nextSnapshot);
            }
            const cached = previewRef.current;
            if (cached?.sourceFile !== result.sourceFile || cached.day !== day) {
                previewRef.current = {
                    sourceFile: result.sourceFile,
                    day,
                    promise: Promise.resolve().then(() => window.electronAPI.getFilePreview(result.record.path, { force: false }))
                        .then(preview => preview?.success && preview.file ? preview.file : null).catch(() => null),
                };
            }
            const preview = await previewRef.current.promise;
            if (!isCurrent()) return;
            if (!preview) {
                previewRef.current = null;
                publish(sameBook ? { ...nextSnapshot, file: {
                    ...retained.file,
                    readingState: result.file.readingState,
                    viewerStatus: result.file.viewerStatus,
                } } : nextSnapshot);
                return;
            }
            const file = mergeRecommendationPreview(result.file, preview);
            publish({ source, day, file, loading: false, error: null });
        } catch (error) {
            if (isCurrent() && !retained?.file) {
                publish({ source, day, file: null, loading: false, error: error || new Error('reading_state_unavailable') });
            }
        }
    }, []);

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
        previewRef.current = null;
        const currentCatalog = catalogRef.current;
        catalogRef.current = {
            source: filesRef.current, platform: currentCatalog.platform, preferences: next, preferencesKey,
            candidates: createDailyRecommendationIndex(filesRef.current, currentCatalog.platform, next),
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
        const pending = {
            token: ++newRecommendationSequenceRef.current,
            day,
            snapshot: current,
            seed: randomSeed(),
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
            const result = await findDailyRecommendation({
                day,
                record,
                seed: pending.seed,
                request: window.electronAPI?.getReadingStates,
                readStatus: createViewerStatusReader(storage),
                platform: catalog.platform,
                candidates: catalog.candidates,
                preferDifferentFrom: currentPath,
                isCurrent,
            });
            if (!isCurrent() || !result) {
                finishNewRecommendation(pending);
                return cancelled;
            }
            let file = result.file;
            if (result.record) result.record.preferencesKey = catalog.preferencesKey;
            const same = file && readingStatePathKey(result.record.path, catalog.platform)
                === readingStatePathKey(currentPath, catalog.platform);
            if (file && !same && window.electronAPI?.getFilePreview) {
                const preview = await Promise.resolve().then(() => window.electronAPI.getFilePreview(result.record.path, { force: false }))
                    .then(response => response?.success && response.file ? response.file : null).catch(() => null);
                if (preview) file = mergeRecommendationPreview(file, preview);
            } else if (same && current?.file) {
                file = mergeRecommendationPreview(file, current.file);
            }
            const latest = catalogRef.current;
            if (!isCurrent() || (file && (!latest.candidates.has(readingStatePathKey(result.record.path, latest.platform))
                || !isDailyRecommendationEntryVolume(file)))) {
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
            const key = readingStatePathKey(pending.result.record.path, catalog.platform);
            if (!catalog.candidates.has(key)) return false;
            const revision = pending.revision;
            const candidate = catalog.candidates.get(key);
            const rows = await window.electronAPI?.getReadingStates?.([candidate.path]);
            if (!isCurrent() || revision !== pending.revision) return false;
            if (!Array.isArray(rows)) throw new Error('reading_state_unavailable');
            const latest = catalogRef.current;
            const latestCandidate = latest.candidates.get(readingStatePathKey(candidate.path, latest.platform));
            if (!latestCandidate) return false;
            const readingState = rows.find(row => row && !row.deletedAt
                && readingStatePathKey(row.filePath, latest.platform) === latestCandidate.key) || null;
            const file = {
                ...pending.prepared.file,
                ...(latestCandidate.file === pending.result.sourceFile ? {} : latestCandidate.file),
                path: latestCandidate.file.path,
                full_path: latestCandidate.path,
                readingState,
            };
            const storage = recommendationStorage();
            file.viewerStatus = createViewerStatusReader(storage)(file);
            if (!isDailyRecommendationEntryVolume(file) || file.viewerStatus.isCompleted || file.viewerStatus.hasReadingProgress) return false;
            const record = { ...pending.result.record, path: latestCandidate.path };
            recordRef.current = record;
            seedRef.current = record.seed;
            try {
                storage?.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify(record));
            } catch {
                // Keep the confirmed choice in memory if persistence is unavailable.
            }
            previewRef.current = { sourceFile: latestCandidate.file, day: pending.day, promise: Promise.resolve(file) };
            const next = { source: latest.source, day: pending.day, file, loading: false, error: null };
            snapshotRef.current = next;
            setSnapshot(next);
            finishNewRecommendation(pending, false);
            return true;
        } finally {
            finishNewRecommendation(pending);
        }
    }, [finishNewRecommendation]);

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
                        candidates: createDailyRecommendationIndex(filesRef.current, catalog.platform, next),
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
        loading: current ? current.loading : Boolean(files?.length),
        error: current?.error || null,
        refresh,
        prepareNewRecommendation,
        commitNewRecommendation,
        cancelNewRecommendation,
        newRecommendationLoading,
        preferences,
        preferenceOptions: optionsRef.current.value,
        updatePreferences,
        excludeRecommendation,
    };
}
