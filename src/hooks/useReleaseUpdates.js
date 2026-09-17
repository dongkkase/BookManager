import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeReleaseList } from '../releasePolicy.js';
import { mergeSeenReleases, readSeenReleases, RELEASE_SEEN_STORAGE_KEY, unreadRecentReleases } from '../releaseNotificationPolicy.js';

export function useReleaseUpdates() {
    const [result, setResult] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now);
    const [seenKeys, setSeenKeys] = useState(() => {
        try { return readSeenReleases(window.localStorage); } catch { return []; }
    });
    const seenRef = useRef(seenKeys);

    useEffect(() => {
        let disposed = false;
        let pending = false;
        let lastAttempt = 0;
        const refresh = async () => {
            if (pending || disposed) return;
            pending = true;
            lastAttempt = Date.now();
            try {
                const response = await window.electronAPI?.getReleases?.();
                if (disposed) return;
                if (response?.error || !Array.isArray(Array.isArray(response) ? response : response?.releases)) {
                    throw new Error(response?.error || 'RELEASES_UNAVAILABLE');
                }
                setResult(response);
                setError('');
            } catch (loadError) {
                if (!disposed) setError(loadError.message || 'NETWORK_ERROR');
            } finally {
                pending = false;
                if (!disposed) {
                    setLoading(false);
                    setNow(Date.now());
                }
            }
        };
        const onFocus = () => {
            setNow(Date.now());
            if (Date.now() - lastAttempt >= 5 * 60 * 1000) void refresh();
        };
        void refresh();
        const refreshTimer = window.setInterval(refresh, 30 * 60 * 1000);
        const ageTimer = window.setInterval(() => setNow(Date.now()), 60 * 1000);
        window.addEventListener('focus', onFocus);
        return () => {
            disposed = true;
            window.clearInterval(refreshTimer);
            window.clearInterval(ageTimer);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    const releases = useMemo(() => normalizeReleaseList(Array.isArray(result) ? result : result.releases).filter(release => !release.draft), [result]);
    const unread = useMemo(() => unreadRecentReleases(releases, seenKeys, now), [releases, seenKeys, now]);
    const markViewed = useCallback(items => {
        const next = mergeSeenReleases(seenRef.current, items);
        if (next.length === seenRef.current.length && next.every((key, index) => key === seenRef.current[index])) return;
        seenRef.current = next;
        setSeenKeys(next);
        try { window.localStorage.setItem(RELEASE_SEEN_STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep session read state when storage is unavailable. */ }
    }, []);

    return { result, releases, loading, error, unread, markViewed };
}
