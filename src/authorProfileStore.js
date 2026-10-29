import { authorKey, normalizeAuthorProfile } from './authorCatalog.js';

export const AUTHOR_PROFILES_KEY = 'bookmanager.authorProfiles';
export const AUTOMATIC_AUTHOR_PROFILES_KEY = 'bookmanager.authorProfiles.automatic';
export const AUTHOR_PROFILE_CACHE_VERSION = 2;
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const BACKGROUND_SCAN_BATCH_SIZE = 100;

function readEntries(storage, key) {
    try {
        const value = JSON.parse(storage?.getItem(key) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
    } catch {
        return [];
    }
}

function readManualProfiles(storage) {
    const profiles = new Map();
    for (const [name, value] of readEntries(storage, AUTHOR_PROFILES_KEY)) {
        const key = authorKey(name);
        const profile = normalizeAuthorProfile(value);
        if (key && (value === null || profile)) profiles.set(key, profile);
    }
    return profiles;
}

function readAutomaticProfiles(storage) {
    const profiles = new Map();
    for (const [name, value] of readEntries(storage, AUTOMATIC_AUTHOR_PROFILES_KEY)) {
        const key = authorKey(name);
        const profile = normalizeAuthorProfile(value?.profile);
        if (!key || !value || (value.profile !== null && !profile) || value.profile?.photoOverride || ['naver', 'local'].includes(profile?.provider)
            || !Number.isFinite(value.checkedAt) || !Number.isFinite(value.expiresAt)
            || value.checkedAt < 0 || value.expiresAt <= value.checkedAt) continue;
        profiles.set(key, {
            profile,
            checkedAt: value.checkedAt,
            expiresAt: value.expiresAt,
            version: value.version === AUTHOR_PROFILE_CACHE_VERSION ? AUTHOR_PROFILE_CACHE_VERSION : 0,
            ...(value.failed === true ? { failed: true } : {}),
        });
    }
    return profiles;
}

function mergeAutomaticProfiles(first, second) {
    const result = new Map(first);
    for (const [key, entry] of second) {
        const previous = result.get(key);
        if (!previous || previous.version < entry.version
            || (previous.version === entry.version && previous.checkedAt <= entry.checkedAt)) result.set(key, entry);
    }
    return result;
}

function chooseAutomaticProfile(author, candidates) {
    const profiles = candidates.filter(candidate => !['naver', 'local'].includes(candidate?.provider) && !candidate?.photoOverride).map(normalizeAuthorProfile)
        .filter(profile => profile && (profile.provider === 'openlibrary' || profile.authorVerified !== false));
    const name = authorKey(author.name);
    const matching = profiles.filter(profile => [profile.name, ...profile.alternateNames].some(value => authorKey(value) === name));
    if (!matching.length) return null;
    const titles = new Set(author.books.flatMap(book => [book?.title, book?.name])
        .filter(value => typeof value === 'string' && value.trim())
        .map(value => authorKey(value.replace(/\.(?:epub|pdf|txt|cbz|cbr|zip|rar|7z|mp3|m4a|m4b|flac)$/i, ''))));
    const workMatches = matching.filter(profile => [profile.topWork, ...profile.works]
        .some(title => title && titles.has(authorKey(title))));
    const eligible = workMatches.length ? workMatches : matching;
    const priority = { wikidata: 0, wikipedia: 1, openlibrary: 2 };
    const compare = (left, right) => Number(!left.photoUrl) - Number(!right.photoUrl)
        || priority[left.provider] - priority[right.provider];
    const preferred = [...eligible].sort(compare)[0];
    const wikimediaEntities = new Set(eligible
        .filter(profile => profile.provider !== 'openlibrary' && profile.entityId)
        .map(profile => profile.entityId));
    if (preferred.provider !== 'openlibrary' && wikimediaEntities.size > 1) return null;
    const identities = new Map();
    for (const profile of eligible) {
        const key = profile.entityId || `${profile.provider}:${profile.id}`;
        if (!identities.has(key)) identities.set(key, []);
        identities.get(key).push(profile);
    }
    const sourceMatches = [...identities.values()].filter(group => group.some(profile => profile.provider === preferred.provider));
    if (sourceMatches.length !== 1) return null;
    return sourceMatches[0].sort(compare)[0];
}

export function createAuthorProfileStore({
    storage, search, persistPhoto, now = Date.now, onChange = () => {},
    setTimer = setTimeout, clearTimer = clearTimeout,
    backgroundDelayMs = 5000, backgroundFailureDelayMs = 60000,
} = {}) {
    let manual = readManualProfiles(storage);
    let automatic = readAutomaticProfiles(storage);
    let authors = new Map();
    let backgroundAuthors = new Map();
    let backgroundIterator = null;
    let backgroundTimer = null;
    let backgroundReadyAt = 0;
    let backgroundRecheckAt = Infinity;
    let loadingKey = null;
    let working = false;
    let disposed = false;
    let snapshot = 0;
    const listeners = new Set();
    const unsavedAutomatic = new Map();
    const invalidatedAutomatic = new Set();
    const revisions = new Map();
    const photoStorageRetryAt = new Map();
    const manualRequests = new Map();
    const manualQueue = [];

    const notify = () => {
        if (disposed) return;
        snapshot += 1;
        onChange();
        for (const listener of listeners) listener();
    };
    const writeManual = next => {
        try {
            storage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify(Object.fromEntries(next)));
            manual = next;
            return true;
        } catch {
            return false;
        }
    };
    const writeAutomatic = () => {
        automatic = mergeAutomaticProfiles(readAutomaticProfiles(storage), automatic);
        for (const key of invalidatedAutomatic) automatic.delete(key);
        try {
            storage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(Object.fromEntries(automatic)));
            unsavedAutomatic.clear();
            invalidatedAutomatic.clear();
        } catch {
            // Keep results in this session when local storage is full or unavailable.
        }
    };
    const needsProfile = author => {
        const cached = automatic.get(author.key);
        return !manual.has(author.key) && !cached?.profile?.photoUrl
            && !(cached?.version === AUTHOR_PROFILE_CACHE_VERSION && cached.expiresAt > now());
    };
    const currentProfile = key => manual.has(key) ? manual.get(key) : automatic.get(key)?.profile || null;
    const needsPhotoStorage = profile => typeof persistPhoto === 'function' && profile?.photoUrl && !profile.storedPhoto && !profile.photoOverride;
    const needsWork = author => needsProfile(author)
        || needsPhotoStorage(currentProfile(author.key)) && !(photoStorageRetryAt.get(author.key) > now());
    const storePhoto = async profile => {
        const saved = normalizeAuthorProfile(await persistPhoto(profile));
        if (!saved?.storedPhoto || saved.id !== profile.id || saved.provider !== profile.provider) throw new Error('Author photo was not saved');
        return saved;
    };
    const getStatus = key => {
        const normalized = authorKey(key);
        if (manual.has(normalized)) {
            const profile = manual.get(normalized);
            return profile === null ? 'initials' : profile.photoUrl ? 'ready' : 'empty';
        }
        const cached = automatic.get(normalized);
        if (cached?.profile?.photoUrl) return 'ready';
        if (loadingKey === normalized) return 'loading';
        const author = authors.get(normalized);
        if (author && needsProfile(author)) return 'queued';
        return cached ? cached.failed ? 'error' : 'empty' : 'idle';
    };
    const normalizeAuthors = value => {
        const normalized = new Map();
        for (const author of Array.isArray(value) ? value : []) {
            const key = authorKey(author?.key || author?.name);
            if (key && typeof author?.name === 'string' && author.name.trim()) {
                normalized.set(key, { key, name: author.name.trim(), books: Array.isArray(author.books) ? author.books : [] });
            }
        }
        return normalized;
    };
    const clearBackgroundTimer = () => {
        if (backgroundTimer === null) return;
        clearTimer(backgroundTimer);
        backgroundTimer = null;
    };
    const nextVisibleAuthor = () => {
        for (const author of authors.values()) {
            if (needsWork(author)) return author;
        }
        return null;
    };
    const resetBackgroundScan = () => {
        clearBackgroundTimer();
        backgroundIterator = backgroundAuthors.size ? backgroundAuthors.values() : null;
        backgroundRecheckAt = Infinity;
    };
    const rememberBackgroundExpiry = key => {
        if (!backgroundAuthors.has(key)) return;
        const profile = currentProfile(key);
        if (profile?.photoUrl) {
            const retryAt = photoStorageRetryAt.get(key);
            if (needsPhotoStorage(profile) && retryAt > now()) backgroundRecheckAt = Math.min(backgroundRecheckAt, retryAt);
            return;
        }
        if (manual.has(key)) return;
        const cached = automatic.get(key);
        if (cached?.version === AUTHOR_PROFILE_CACHE_VERSION && cached.expiresAt > now()) {
            backgroundRecheckAt = Math.min(backgroundRecheckAt, cached.expiresAt);
        }
    };
    const scheduleBackground = delay => {
        if (disposed || working || backgroundTimer !== null || (!backgroundIterator && !Number.isFinite(backgroundRecheckAt))) return;
        backgroundTimer = setTimer(() => {
            backgroundTimer = null;
            if (disposed || working) return;
            const visible = nextVisibleAuthor();
            if (visible) {
                void work(visible, false);
                return;
            }
            if (!backgroundIterator) {
                backgroundIterator = backgroundAuthors.size ? backgroundAuthors.values() : null;
                backgroundRecheckAt = Infinity;
            }
            for (let checked = 0; checked < BACKGROUND_SCAN_BATCH_SIZE && backgroundIterator; checked += 1) {
                const next = backgroundIterator.next();
                if (next.done) {
                    backgroundIterator = null;
                    scheduleWork();
                    return;
                }
                if (needsWork(next.value)) {
                    void work(next.value, true);
                    return;
                }
                rememberBackgroundExpiry(next.value.key);
            }
            scheduleBackground(0);
        }, delay);
    };
    const scheduleWork = () => {
        if (disposed || working) return;
        while (manualQueue.length) {
            const request = manualQueue.shift();
            if (manualRequests.get(request.key) !== request || request.revision !== (revisions.get(request.key) || 0)) {
                request.resolve(false);
                continue;
            }
            clearBackgroundTimer();
            void workManual(request);
            return;
        }
        const visible = nextVisibleAuthor();
        if (visible) {
            clearBackgroundTimer();
            void work(visible, false);
        } else {
            const nextAt = backgroundIterator ? backgroundReadyAt : Math.max(backgroundReadyAt, backgroundRecheckAt);
            if (Number.isFinite(nextAt)) scheduleBackground(Math.max(0, nextAt - now()));
        }
    };
    const work = async (author, background) => {
        if (working || disposed) return;
        working = true;
        try {
            const revision = revisions.get(author.key) || 0;
            const migrating = needsPhotoStorage(currentProfile(author.key));
            const manualProfile = migrating && manual.has(author.key);
            let profile = currentProfile(author.key);
            const previousManual = manualProfile ? JSON.stringify(profile) : undefined;
            let success = Boolean(migrating);
            let partial = false;
            let storageFailed = false;
            loadingKey = author.key;
            notify();
            try {
                if (!migrating) {
                    const result = await search(author.name);
                    success = result?.success === true && Array.isArray(result.profiles);
                    partial = result?.partial === true;
                    if (success) profile = chooseAutomaticProfile(author, result.profiles);
                }
                if (needsPhotoStorage(profile)) {
                    try {
                        profile = await storePhoto(profile);
                        photoStorageRetryAt.delete(author.key);
                    } catch {
                        storageFailed = true;
                        if (migrating) photoStorageRetryAt.set(author.key, now() + FAILURE_TTL_MS);
                        else profile = normalizeAuthorProfile({ ...profile, photoUrl: '', hasPhoto: false });
                    }
                }
            } catch {
                // A failed author lookup must not prevent the remaining authors from loading.
            }
            loadingKey = null;
            if (disposed) return;
            const failed = !success || partial || storageFailed;
            backgroundReadyAt = Math.max(backgroundReadyAt, now()
                + (background && failed ? Math.max(backgroundDelayMs, backgroundFailureDelayMs) : backgroundDelayMs));
            if (revision !== (revisions.get(author.key) || 0)) {
                notify();
                return;
            }
            if (manualProfile) {
                const next = readManualProfiles(storage);
                if (JSON.stringify(next.get(author.key)) !== previousManual) {
                    manual = next;
                    notify();
                    return;
                }
                if (!storageFailed) {
                    next.set(author.key, profile);
                    if (!writeManual(next)) {
                        photoStorageRetryAt.set(author.key, now() + FAILURE_TTL_MS);
                        if (background) backgroundReadyAt = Math.max(backgroundReadyAt, now() + backgroundFailureDelayMs);
                    }
                }
                rememberBackgroundExpiry(author.key);
                notify();
                return;
            }
            const checkedAt = now();
            const entry = {
                profile, checkedAt,
                expiresAt: checkedAt + (failed ? FAILURE_TTL_MS : PROFILE_TTL_MS),
                version: AUTHOR_PROFILE_CACHE_VERSION,
                ...(failed ? { failed: true } : {}),
            };
            automatic.set(author.key, entry);
            rememberBackgroundExpiry(author.key);
            unsavedAutomatic.set(author.key, entry);
            invalidatedAutomatic.delete(author.key);
            writeAutomatic();
            notify();
        } finally {
            working = false;
            scheduleWork();
        }
    };
    const setManual = (key, value) => {
        const normalized = authorKey(key);
        const profile = normalizeAuthorProfile(value);
        if (disposed || !normalized || (value !== null && !profile)) return false;
        const next = readManualProfiles(storage);
        next.set(normalized, profile);
        if (!writeManual(next)) return false;
        revisions.set(normalized, (revisions.get(normalized) || 0) + 1);
        manualRequests.delete(normalized);
        photoStorageRetryAt.delete(normalized);
        if (backgroundAuthors.has(normalized)) resetBackgroundScan();
        notify();
        scheduleWork();
        return true;
    };
    const workManual = async request => {
        working = true;
        let saved = false;
        try {
            const profile = await storePhoto(request.profile);
            if (!disposed && manualRequests.get(request.key) === request && request.revision === (revisions.get(request.key) || 0)
                && JSON.stringify(readManualProfiles(storage).get(request.key)) === request.previousManual) {
                saved = setManual(request.key, profile);
            }
        } catch {
            // Keep the existing selection when the replacement cannot be saved.
        } finally {
            if (manualRequests.get(request.key) === request) manualRequests.delete(request.key);
            working = false;
            request.resolve(saved);
            scheduleWork();
        }
    };

    return {
        getStatus,
        getSnapshot: () => snapshot,
        subscribe(listener) {
            if (!disposed) listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getProfile(key) {
            const normalized = authorKey(key);
            return currentProfile(normalized);
        },
        hasOverride(key) {
            return manual.has(authorKey(key));
        },
        setManual,
        saveManual(key, value) {
            const normalized = authorKey(key);
            const profile = normalizeAuthorProfile(value);
            if (disposed || !normalized || (value !== null && !profile)) return Promise.resolve(false);
            if (!needsPhotoStorage(profile)) return Promise.resolve(setManual(normalized, value));
            return new Promise(resolve => {
                const request = {
                    key: normalized, profile, revision: revisions.get(normalized) || 0,
                    previousManual: JSON.stringify(readManualProfiles(storage).get(normalized)), resolve,
                };
                manualRequests.set(normalized, request);
                manualQueue.push(request);
                scheduleWork();
            });
        },
        useAutomatic(key) {
            const normalized = authorKey(key);
            if (disposed || !normalized) return false;
            const next = readManualProfiles(storage);
            next.delete(normalized);
            if (!writeManual(next)) return false;
            revisions.set(normalized, (revisions.get(normalized) || 0) + 1);
            manualRequests.delete(normalized);
            photoStorageRetryAt.delete(normalized);
            automatic.delete(normalized);
            unsavedAutomatic.delete(normalized);
            invalidatedAutomatic.add(normalized);
            writeAutomatic();
            resetBackgroundScan();
            notify();
            scheduleWork();
            return true;
        },
        setAuthors(value) {
            if (disposed) return;
            const previousQueued = new Set([...authors.keys()].filter(key => getStatus(key) === 'queued'));
            authors = normalizeAuthors(value);
            const queued = [...authors.keys()].filter(key => getStatus(key) === 'queued');
            if (queued.length !== previousQueued.size || queued.some(key => !previousQueued.has(key))) notify();
            scheduleWork();
        },
        setBackgroundAuthors(value) {
            if (disposed) return;
            const hadBackgroundAuthors = backgroundAuthors.size > 0;
            backgroundAuthors = normalizeAuthors(value);
            resetBackgroundScan();
            if (!hadBackgroundAuthors && backgroundAuthors.size) {
                backgroundReadyAt = Math.max(backgroundReadyAt, now() + backgroundDelayMs);
            }
            scheduleWork();
        },
        reload() {
            if (disposed) return;
            const nextManual = readManualProfiles(storage);
            for (const key of new Set([...manual.keys(), ...nextManual.keys()])) {
                if (manual.has(key) !== nextManual.has(key) || JSON.stringify(manual.get(key)) !== JSON.stringify(nextManual.get(key))) {
                    revisions.set(key, (revisions.get(key) || 0) + 1);
                    manualRequests.delete(key);
                    photoStorageRetryAt.delete(key);
                }
            }
            manual = nextManual;
            automatic = mergeAutomaticProfiles(readAutomaticProfiles(storage), unsavedAutomatic);
            for (const key of invalidatedAutomatic) automatic.delete(key);
            resetBackgroundScan();
            notify();
            scheduleWork();
        },
        dispose() {
            disposed = true;
            authors.clear();
            backgroundAuthors.clear();
            backgroundIterator = null;
            backgroundRecheckAt = Infinity;
            clearBackgroundTimer();
            listeners.clear();
            manualRequests.clear();
            for (const request of manualQueue.splice(0)) request.resolve(false);
        },
    };
}
