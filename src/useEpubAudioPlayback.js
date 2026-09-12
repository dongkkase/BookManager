import { useEffect, useMemo, useRef, useState } from 'react';
import { createEpubAudioPlayback } from './epubAudioPlayback.js';

export function useEpubAudioPlayback({ playlist, pageKey, sessionKey, enabled = true, autoplay = true, volume = 1, muted = false, pauseScope = 'page' }) {
    const [state, setState] = useState({ status: 'idle', currentTrack: null, volume, muted, error: null, manualPaused: false });
    const controllerRef = useRef(null);
    const optionsRef = useRef(null);
    const blurredRef = useRef(false);
    optionsRef.current = { playlist, pageKey, enabled, autoplay, volume, muted, pauseScope };
    const controls = useMemo(() => Object.fromEntries(['pause', 'resume', 'toggle', 'stop', 'playTrack', 'setVolume', 'setMuted'].map(name => [name, (...args) => controllerRef.current?.[name](...args)])), []);

    useEffect(() => {
        const options = optionsRef.current;
        const controller = createEpubAudioPlayback({ ...options, onStateChange: setState });
        controllerRef.current = controller;
        controller.setSuspended(document.hidden || blurredRef.current);
        controller.setPlaylist(options.playlist, { key: options.pageKey, autoplay: options.autoplay });
        setState(controller.getState());
        return () => {
            controller.dispose();
            if (controllerRef.current === controller) controllerRef.current = null;
        };
    }, [sessionKey, pauseScope]);

    useEffect(() => {
        const controller = controllerRef.current;
        if (!controller) return;
        controller.setVolume(volume);
        controller.setMuted(muted);
        controller.setEnabled(enabled);
        controller.setPlaylist(playlist, { key: pageKey, autoplay });
    }, [playlist, pageKey, enabled, autoplay, volume, muted]);

    useEffect(() => {
        let blurTimer;
        const frameWindows = new Map();
        const sync = () => controllerRef.current?.setSuspended(document.hidden || blurredRef.current);
        const detachFrame = frame => {
            try {
                frameWindows.get(frame)?.removeEventListener('blur', blur);
                frameWindows.get(frame)?.removeEventListener('focus', focus);
            } catch {}
            frameWindows.delete(frame);
        };
        const watchFrames = reloadFrame => {
            const frames = new Set(document.querySelectorAll('iframe'));
            for (const frame of frameWindows.keys()) {
                if (!frames.has(frame) || frame === reloadFrame) detachFrame(frame);
            }
            for (const frame of frames) {
                if (frameWindows.has(frame)) continue;
                try {
                    const frameWindow = frame.contentWindow;
                    if (!frameWindow) continue;
                    frameWindow.addEventListener('blur', blur);
                    frameWindow.addEventListener('focus', focus);
                    frameWindows.set(frame, frameWindow);
                } catch {}
            }
        };
        const checkFocus = () => {
            blurredRef.current = !document.hasFocus();
            sync();
        };
        const blur = () => {
            clearTimeout(blurTimer);
            blurTimer = setTimeout(checkFocus, 0);
        };
        const focus = () => { clearTimeout(blurTimer); checkFocus(); };
        const frameLoaded = event => {
            if (event.target?.tagName === 'IFRAME') watchFrames(event.target);
        };
        const framesChanged = new MutationObserver(() => watchFrames());
        window.addEventListener('blur', blur);
        window.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', sync);
        document.addEventListener('load', frameLoaded, true);
        framesChanged.observe(document.documentElement, { childList: true, subtree: true });
        watchFrames();
        return () => {
            clearTimeout(blurTimer);
            for (const frame of frameWindows.keys()) detachFrame(frame);
            framesChanged.disconnect();
            window.removeEventListener('blur', blur);
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', sync);
            document.removeEventListener('load', frameLoaded, true);
        };
    }, []);

    return { ...state, ...controls };
}
