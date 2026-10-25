import { authorKey, normalizeAuthorProfile } from './authorCatalog.js';

export const AUTHOR_PROFILES_KEY = 'bookmanager.authorProfiles';
export const AUTOMATIC_AUTHOR_PROFILES_KEY = 'bookmanager.authorProfiles.automatic';
export const AUTHOR_PROFILE_CACHE_VERSION = 2;
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

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
        if (!key || !value || (value.profile !== null && !profile) || value.profile?.photoOverride || profile?.provider === 'naver'
            || !Number.isFinite(value.checkedAt) || !Number.isFinite(value.expiresAt)
            || value.checkedAt < 0 || value.expiresAt <= value.checkedAt) continue;
        profiles.set(key, {
            profile,
            checkedAt: value.checkedAt,
            expiresAt: value.expiresAt,
            version: value.version === AUTHOR_PROFILE_CACHE_VERSION ? AUTHOR_PROFILE_CACHE_VERSION : 0,
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
    const profiles = candidates.filter(candidate => candidate?.provider !== 'naver' && !candidate?.photoOverride).map(normalizeAuthorProfile)
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

export function createAuthorProfileStore({ storage, search, now = Date.now, onChange = () => {} } = {}) {
    let manual = readManualProfiles(storage);
    let automatic = readAutomaticProfiles(storage);
    let authors = new Map();
    let working = false;
    let disposed = false;
    const unsavedAutomatic = new Map();
    const invalidatedAutomatic = new Set();
    const revisions = new Map();

    const notify = () => {
        if (!disposed) onChange();
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
        return !manual.has(author.key) && !(cached?.version === AUTHOR_PROFILE_CACHE_VERSION && cached.expiresAt > now());
    };
    const work = async () => {
        if (working || disposed) return;
        working = true;
        try {
            while (!disposed) {
                const author = [...authors.values()].find(needsProfile);
                if (!author) break;
                const revision = revisions.get(author.key) || 0;
                let profile = automatic.get(author.key)?.profile || null;
                let success = false;
                let partial = false;
                try {
                    const result = await search(author.name);
                    success = result?.success === true && Array.isArray(result.profiles);
                    partial = result?.partial === true;
                    if (success) profile = chooseAutomaticProfile(author, result.profiles);
                } catch {
                    // A failed author lookup must not prevent the remaining visible authors from loading.
                }
                if (disposed) break;
                if (revision !== (revisions.get(author.key) || 0)) continue;
                const checkedAt = now();
                const entry = { profile, checkedAt, expiresAt: checkedAt + (success && !partial ? PROFILE_TTL_MS : FAILURE_TTL_MS), version: AUTHOR_PROFILE_CACHE_VERSION };
                automatic.set(author.key, entry);
                unsavedAutomatic.set(author.key, entry);
                invalidatedAutomatic.delete(author.key);
                writeAutomatic();
                notify();
            }
        } finally {
            working = false;
        }
    };

    return {
        getProfile(key) {
            const normalized = authorKey(key);
            return manual.has(normalized) ? manual.get(normalized) : automatic.get(normalized)?.profile || null;
        },
        hasOverride(key) {
            return manual.has(authorKey(key));
        },
        setManual(key, value) {
            const normalized = authorKey(key);
            const profile = normalizeAuthorProfile(value);
            if (disposed || !normalized || (value !== null && !profile)) return false;
            const next = readManualProfiles(storage);
            next.set(normalized, profile);
            if (!writeManual(next)) return false;
            notify();
            void work();
            return true;
        },
        useAutomatic(key) {
            const normalized = authorKey(key);
            if (disposed || !normalized) return false;
            const next = readManualProfiles(storage);
            next.delete(normalized);
            if (!writeManual(next)) return false;
            revisions.set(normalized, (revisions.get(normalized) || 0) + 1);
            automatic.delete(normalized);
            unsavedAutomatic.delete(normalized);
            invalidatedAutomatic.add(normalized);
            writeAutomatic();
            notify();
            void work();
            return true;
        },
        setAuthors(value) {
            if (disposed) return;
            authors = new Map();
            for (const author of Array.isArray(value) ? value : []) {
                const key = authorKey(author?.key || author?.name);
                if (key && typeof author?.name === 'string' && author.name.trim()) {
                    authors.set(key, { key, name: author.name.trim(), books: Array.isArray(author.books) ? author.books : [] });
                }
            }
            void work();
        },
        reload() {
            if (disposed) return;
            manual = readManualProfiles(storage);
            automatic = mergeAutomaticProfiles(readAutomaticProfiles(storage), unsavedAutomatic);
            for (const key of invalidatedAutomatic) automatic.delete(key);
            notify();
            void work();
        },
        dispose() {
            disposed = true;
            authors.clear();
        },
    };
}
