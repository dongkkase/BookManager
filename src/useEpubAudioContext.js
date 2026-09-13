import { useEffect, useState } from 'react';
import { visibleEpubAudioTracks } from './epubAudioContext.js';

export function useEpubAudioContext({ rootRef, mapping, enabled, sessionKey, flowMode, pageIndex }) {
    const [visible, setVisible] = useState({ sessionKey: '', mapping: null, flowMode: '', pageIndex: -1, tracks: [] });
    useEffect(() => {
        if (!enabled || !mapping.tracks.length) {
            setVisible(current => current.tracks.length ? { sessionKey, tracks: [] } : current);
            return undefined;
        }
        let frame;
        const update = () => {
            const tracks = visibleEpubAudioTracks(rootRef.current, mapping, { flowMode, pageIndex });
            setVisible(current => current.sessionKey === sessionKey
                && current.mapping === mapping && current.flowMode === flowMode && current.pageIndex === pageIndex
                && current.tracks.length === tracks.length
                && current.tracks.every((track, index) => track === tracks[index]) ? current : { sessionKey, mapping, flowMode, pageIndex, tracks });
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        };
        const root = rootRef.current;
        root?.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const timer = window.setInterval(update, 200);
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(timer);
            root?.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
        };
    }, [enabled, flowMode, mapping, pageIndex, rootRef, sessionKey]);
    return enabled && visible.sessionKey === sessionKey && visible.mapping === mapping
        && visible.flowMode === flowMode && visible.pageIndex === pageIndex ? visible.tracks : [];
}
