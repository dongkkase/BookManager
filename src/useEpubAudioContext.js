import { useEffect, useState } from 'react';
import { epubAudioViewportReady, visibleEpubAudioTracks } from './epubAudioContext.js';

export function useEpubAudioContext({ rootRef, mapping, enabled, sessionKey, flowMode, pageIndex }) {
    const [visible, setVisible] = useState({ sessionKey: '', mapping: null, flowMode: '', pageIndex: -1, tracks: [] });
    useEffect(() => {
        if (!enabled || !mapping.tracks.length) {
            setVisible(current => current.tracks.length ? { sessionKey, tracks: [] } : current);
            return undefined;
        }
        let frame;
        const update = () => {
            if (!epubAudioViewportReady(rootRef.current, { flowMode, pageIndex })) return;
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
    if (!enabled || visible.sessionKey !== sessionKey) return [];
    if (visible.mapping === mapping && visible.flowMode === flowMode && visible.pageIndex === pageIndex) return visible.tracks;
    // Keep a playing range through layout changes until the new text fragments can be measured.
    return visible.tracks.flatMap(track => track.rangeId ? mapping.tracks.filter(candidate => candidate.id === track.id && candidate.rangeId === track.rangeId) : []);
}
