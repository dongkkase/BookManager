import { useCallback, useEffect, useRef } from 'react';
import { createReadingActivityTracker, READING_ACTIVITY_HEARTBEAT_MS } from '../readingActivityTracker.js';

export function useReadingActivity({ session, ready, playing = false, visualReading = true }) {
    const trackerRef = useRef(null);
    const stateRef = useRef({ ready, playing, visualReading });
    stateRef.current = { ready, playing, visualReading };

    useEffect(() => {
        const record = window.viewerAPI?.recordReadingActivity;
        if (!session?.id || session.preview || typeof record !== 'function') return undefined;
        const tracker = createReadingActivityTracker({
            record: interval => record(session.id, interval),
            initialState: {
                ...stateRef.current,
                visible: document.visibilityState === 'visible',
                focused: document.hasFocus(),
            },
        });
        trackerRef.current = tracker;
        const interact = () => tracker.interact();
        const focus = () => {
            tracker.interact();
            tracker.update({ focused: true });
        };
        const blur = () => {
            tracker.update({ focused: false });
            tracker.flush();
        };
        const visibility = () => {
            tracker.update({ visible: document.visibilityState === 'visible' });
            tracker.flush();
        };
        const flush = () => tracker.flush();
        const inputEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll', 'touchstart'];
        for (const type of inputEvents) window.addEventListener(type, interact, { passive: true, capture: true });
        window.addEventListener('focus', focus);
        window.addEventListener('blur', blur);
        window.addEventListener('pagehide', flush);
        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', visibility);
        const heartbeat = window.setInterval(() => tracker.sample(), READING_ACTIVITY_HEARTBEAT_MS);
        return () => {
            window.clearInterval(heartbeat);
            for (const type of inputEvents) window.removeEventListener(type, interact, true);
            window.removeEventListener('focus', focus);
            window.removeEventListener('blur', blur);
            window.removeEventListener('pagehide', flush);
            window.removeEventListener('beforeunload', flush);
            document.removeEventListener('visibilitychange', visibility);
            tracker.dispose();
            if (trackerRef.current === tracker) trackerRef.current = null;
        };
    }, [session?.id, session?.preview]);

    useEffect(() => {
        trackerRef.current?.update({ ready, playing, visualReading });
    }, [ready, playing, visualReading]);

    return useCallback(() => trackerRef.current?.flush(), []);
}
