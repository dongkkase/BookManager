export const RELEASE_SEEN_STORAGE_KEY = 'bookmanager:release-notes-seen:v1';
export const RELEASE_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export function releaseNotificationKey(release) {
    const publishedAt = Date.parse(release?.publishedAt || release?.published_at || release?.date || '');
    const id = release?.id || release?.tag || release?.name;
    return id && Number.isFinite(publishedAt) ? `${id}:${publishedAt}` : '';
}

export function unreadRecentReleases(releases, seenKeys = [], now = Date.now()) {
    const seen = new Set(seenKeys);
    return (releases || []).filter(release => {
        const key = releaseNotificationKey(release);
        const timestamp = Date.parse(release.publishedAt || release.published_at || release.date || '');
        return !release.draft && key && !seen.has(key) && timestamp <= now && timestamp >= now - RELEASE_RECENT_MS;
    });
}

export function readSeenReleases(storage) {
    try {
        const value = JSON.parse(storage.getItem(RELEASE_SEEN_STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value.filter(key => typeof key === 'string').slice(-200) : [];
    } catch {
        return [];
    }
}

export function mergeSeenReleases(seenKeys, releases) {
    return [...new Set([...seenKeys, ...releases.filter(release => !release.draft).map(releaseNotificationKey).filter(Boolean)])].slice(-200);
}
