const clampVolume = value => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 1));

export function normalizeEpubAudioPlaylist(tracks) {
    return (Array.isArray(tracks) ? tracks : []).flatMap(track => {
        const sources = (Array.isArray(track?.sources) ? track.sources : []).filter(source => typeof source?.src === 'string' && source.src.trim()).map(source => ({ src: source.src, type: source.type || '' }));
        const clipBegin = Math.max(0, Number.isFinite(Number(track?.clipBegin)) ? Number(track.clipBegin) : 0);
        const clipEnd = track?.clipEnd == null || !Number.isFinite(Number(track.clipEnd)) ? null : Number(track.clipEnd);
        if (!sources.length || (clipEnd !== null && clipEnd <= clipBegin)) return [];
        return [{ ...track, sources, clipBegin, clipEnd, loop: Boolean(track.loop) }];
    });
}

const trackKey = track => JSON.stringify([track.id || '', track.sources, track.clipBegin, track.clipEnd, track.loop]);

export function createEpubAudioPlayback({
    createAudio = () => new Audio(),
    onStateChange = () => {},
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id),
    now = () => performance.now(),
    fadeDuration = 400,
    volume: initialVolume = 1,
    muted: initialMuted = false,
    enabled: initialEnabled = true,
    autoplay: initialAutoplay = true,
    pauseScope = 'page',
} = {}) {
    const fadeMilliseconds = Math.max(1, Number(fadeDuration) || 400);
    let volume = clampVolume(initialVolume);
    let muted = Boolean(initialMuted);
    let enabled = Boolean(initialEnabled);
    let autoplay = Boolean(initialAutoplay);
    let suspended = false;
    let manualPaused = false;
    let wantsPlayback = autoplay;
    let disposed = false;
    let playlist = [];
    let playlistKey;
    let playlistSignature = '';
    let index = 0;
    let completed = false;
    const finishedTracks = new Set();
    let active = null;
    const outgoing = new Set();
    let frameId = null;
    let status = 'idle';
    let error = null;
    let lastState;

    const canPlay = () => !disposed && enabled && !suspended && !manualPaused && wantsPlayback;
    const snapshot = () => ({ status, currentTrack: active?.track || (status === 'ended' ? playlist.at(-1) || null : playlist[index] || null), volume, muted, error, manualPaused });
    const emit = () => {
        if (disposed) return;
        const next = snapshot();
        const signature = JSON.stringify(next);
        if (signature !== lastState) {
            lastState = signature;
            onStateChange(next);
        }
    };
    const setStatus = (next, nextError = null) => {
        status = next;
        error = nextError;
        emit();
    };
    const applyVolume = slot => {
        if (slot.disposed) return;
        slot.audio.muted = muted;
        slot.audio.volume = clampVolume(slot.gain * volume);
    };
    const release = slot => {
        if (!slot || slot.disposed) return;
        slot.disposed = true;
        slot.playToken += 1;
        slot.fade = null;
        slot.listeners.forEach(remove => remove());
        slot.audio.pause();
        slot.audio.removeAttribute?.('src');
        slot.audio.load?.();
        outgoing.delete(slot);
    };
    const schedule = () => {
        if (!disposed && frameId === null && (outgoing.size || active?.fade || (active && status === 'playing'))) frameId = requestFrame(tick);
    };
    const fade = (slot, target, done, duration = fadeMilliseconds) => {
        if (!slot || slot.disposed) return;
        slot.fade = { start: now(), from: slot.gain, target, done, duration: Math.max(1, duration) };
        if (Math.abs(slot.gain - target) < 0.0001) {
            slot.fade = null;
            done?.();
        } else schedule();
    };
    const retire = slot => {
        if (!slot) return;
        slot.playToken += 1;
        outgoing.add(slot);
        const remaining = clipBoundary(slot) - (Number(slot.audio.currentTime) || 0);
        fade(slot, 0, () => release(slot), Number.isFinite(remaining) ? Math.min(fadeMilliseconds, Math.max(1, remaining * 1000)) : fadeMilliseconds);
    };
    const pauseSlot = (slot, immediate) => {
        if (!slot || slot.disposed) return;
        slot.playToken += 1;
        if (immediate || slot.audio.paused) {
            slot.fade = null;
            slot.gain = 0;
            applyVolume(slot);
            slot.audio.pause();
        } else fade(slot, 0, () => slot.audio.pause());
    };
    const clipBoundary = slot => {
        const duration = Number(slot.audio.duration);
        const nativeEnd = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
        return slot.track.clipEnd === null ? nativeEnd : Math.min(nativeEnd, slot.track.clipEnd);
    };
    const seekBeginning = slot => {
        if (slot.audio.readyState < 1 && slot.track.clipBegin > 0) return false;
        try {
            slot.audio.currentTime = slot.track.clipBegin;
            slot.pendingSeek = false;
            return true;
        } catch { return false; }
    };
    const finish = slot => {
        if (disposed || active !== slot || slot.finished) return;
        slot.finished = true;
        const boundary = clipBoundary(slot);
        if (Number.isFinite(boundary) && slot.audio.currentTime > boundary) {
            try { slot.audio.currentTime = boundary; } catch {}
        }
        slot.audio.pause();
        slot.playToken += 1;
        slot.fade = null;
        slot.gain = 0;
        applyVolume(slot);
        if (slot.track.loop) {
            slot.finished = false;
            slot.endFade = false;
            slot.pendingSeek = true;
            seekBeginning(slot);
            if (canPlay()) startSlot(slot);
            else setStatus('paused');
            return;
        }
        release(slot);
        active = null;
        finishedTracks.add(slot.key);
        index = playlist.findIndex(track => !finishedTracks.has(trackKey(track)));
        if (index >= 0) {
            if (canPlay()) activate(index);
            else setStatus('paused');
        } else {
            index = playlist.length;
            completed = true;
            setStatus('ended');
        }
    };
    const inspectBoundary = slot => {
        if (active !== slot || slot.disposed || slot.pendingSeek || slot.audio.paused) return;
        const end = clipBoundary(slot);
        if (!Number.isFinite(end)) return;
        const remaining = end - (Number(slot.audio.currentTime) || 0);
        if (remaining <= 0.005) finish(slot);
        else if (remaining <= (slot.fadeWindow || fadeMilliseconds) / 1000 && !slot.endFade) {
            slot.endFade = true;
            fade(slot, 0, undefined, remaining * 1000);
        }
    };
    function tick() {
        frameId = null;
        if (disposed) return;
        const timestamp = now();
        for (const slot of [active, ...outgoing]) {
            if (!slot || slot.disposed || !slot.fade) continue;
            const transition = slot.fade;
            const progress = Math.min(1, Math.max(0, (timestamp - transition.start) / transition.duration));
            const eased = progress * progress * (3 - 2 * progress);
            slot.gain = transition.from + (transition.target - transition.from) * eased;
            applyVolume(slot);
            if (progress >= 1 && slot.fade === transition) {
                slot.fade = null;
                transition.done?.();
            }
        }
        if (active && status === 'playing') inspectBoundary(active);
        schedule();
    }
    const fail = (slot, reason) => {
        if (disposed || active !== slot || slot.disposed) return;
        slot.audio.pause();
        slot.gain = 0;
        slot.fade = null;
        applyVolume(slot);
        if (reason?.name === 'NotAllowedError') {
            slot.blocked = true;
            slot.failure = { name: 'NotAllowedError', message: reason.message || 'Autoplay was blocked.' };
            setStatus('blocked', slot.failure);
            return;
        }
        if (slot.sourceIndex + 1 < slot.sources.length) {
            slot.sourceIndex += 1;
            slot.pendingSeek = true;
            slot.audio.src = slot.sources[slot.sourceIndex].src;
            slot.audio.load?.();
            seekBeginning(slot);
            if (canPlay()) startSlot(slot);
            return;
        }
        slot.failed = true;
        slot.failure = { name: reason?.name || 'MediaError', message: reason?.message || 'Unable to play this audio.' };
        setStatus('error', slot.failure);
    };
    function startSlot(slot, manual = false) {
        if (!canPlay() || active !== slot || slot.disposed || ((slot.blocked || slot.failed) && !manual)) return;
        if (manual && slot.failed) {
            slot.audio.load?.();
            slot.pendingSeek = true;
        }
        slot.blocked = false;
        slot.failed = false;
        slot.failure = null;
        slot.finished = false;
        slot.endFade = false;
        slot.fade = null;
        const token = ++slot.playToken;
        if (slot.pendingSeek) seekBeginning(slot);
        setStatus('loading');
        let playback;
        try { playback = slot.audio.play(); } catch (reason) { fail(slot, reason); return; }
        Promise.resolve(playback).then(() => {
            if (slot.disposed) { slot.audio.pause(); return; }
            if (disposed || active !== slot || slot.playToken !== token || !canPlay()) return;
            if (slot.pendingSeek && !seekBeginning(slot)) return;
            setStatus('playing');
            const remaining = clipBoundary(slot) - (Number(slot.audio.currentTime) || 0);
            slot.fadeWindow = Number.isFinite(remaining) ? Math.min(fadeMilliseconds, Math.max(1, remaining * 500)) : fadeMilliseconds;
            fade(slot, 1, undefined, slot.fadeWindow);
            inspectBoundary(slot);
            schedule();
        }, reason => {
            if (!disposed && active === slot && slot.playToken === token) fail(slot, reason);
        });
    }
    function activate(nextIndex) {
        if (!canPlay() || nextIndex >= playlist.length) return;
        const track = playlist[nextIndex];
        const returning = [...outgoing].find(slot => !slot.disposed && !slot.finished && slot.key === trackKey(track));
        if (returning) {
            outgoing.delete(returning);
            active = returning;
            index = nextIndex;
            returning.track = track;
            startSlot(returning);
            return;
        }
        let audio;
        try { audio = createAudio(); } catch (reason) { setStatus('error', { name: reason?.name || 'Error', message: reason?.message || 'Audio is unavailable.' }); return; }
        const sources = [...track.sources].sort((a, b) => Number(Boolean(b.type && audio.canPlayType?.(b.type))) - Number(Boolean(a.type && audio.canPlayType?.(a.type))));
        const slot = { audio, track, key: trackKey(track), sources, sourceIndex: 0, gain: 0, fade: null, playToken: 0, pendingSeek: true, blocked: false, failed: false, finished: false, endFade: false, disposed: false, listeners: [] };
        active = slot;
        index = nextIndex;
        const listen = (type, handler) => {
            audio.addEventListener(type, handler);
            slot.listeners.push(() => audio.removeEventListener(type, handler));
        };
        listen('loadedmetadata', () => {
            if (active !== slot || slot.disposed) return;
            if (slot.pendingSeek) seekBeginning(slot);
            if (slot.track.clipBegin >= clipBoundary(slot)) finish(slot);
        });
        listen('timeupdate', () => inspectBoundary(slot));
        listen('ended', () => finish(slot));
        listen('error', () => fail(slot, audio.error));
        audio.preload = 'auto';
        audio.loop = false;
        applyVolume(slot);
        audio.src = sources[0].src;
        audio.load?.();
        startSlot(slot);
    }
    const reconcile = (manual = false) => {
        if (!playlist.length) { setStatus('idle'); return; }
        if (completed) { setStatus('ended'); return; }
        if (!canPlay()) {
            pauseSlot(active, suspended);
            setStatus('paused');
            return;
        }
        if (!active) activate(index);
        else if (!manual && (active.blocked || active.failed)) setStatus(active.blocked ? 'blocked' : 'error', active.failure);
        else if (manual || ((active.audio.paused || !['playing', 'loading'].includes(status)) && !active.blocked && !active.failed)) startSlot(active, manual);
    };
    const controller = {
        getState: snapshot,
        setPlaylist(tracks, { key = '', autoplay: nextAutoplay = autoplay } = {}) {
            if (disposed) return;
            const next = normalizeEpubAudioPlaylist(tracks);
            const signature = JSON.stringify(next.map(trackKey));
            const pageChanged = key !== playlistKey;
            const playlistChanged = signature !== playlistSignature;
            if (pageChanged) finishedTracks.clear();
            else if (playlistChanged) {
                const visibleKeys = new Set(next.map(trackKey));
                for (const finishedKey of finishedTracks) {
                    if (!visibleKeys.has(finishedKey)) finishedTracks.delete(finishedKey);
                }
            }
            if (pageChanged && pauseScope !== 'session') manualPaused = false;
            const autoplayChanged = autoplay !== Boolean(nextAutoplay);
            autoplay = Boolean(nextAutoplay);
            if (pageChanged || autoplayChanged) wantsPlayback = autoplay;
            playlistKey = key;
            playlistSignature = signature;
            playlist = next;
            if (!pageChanged && !playlistChanged) {
                if (autoplayChanged) reconcile();
                emit();
                return;
            }
            const currentIndex = active ? playlist.findIndex(track => trackKey(track) === active.key) : -1;
            if (currentIndex >= 0 && !active.finished) {
                index = currentIndex;
                active.track = playlist[index];
                completed = false;
                reconcile();
                emit();
                return;
            }
            retire(active);
            active = null;
            index = playlist.findIndex(track => !finishedTracks.has(trackKey(track)));
            completed = playlist.length > 0 && index < 0;
            if (index < 0) index = 0;
            reconcile();
        },
        pause() {
            if (disposed) return;
            manualPaused = true;
            wantsPlayback = false;
            pauseSlot(active, false);
            setStatus(playlist.length ? 'paused' : 'idle');
        },
        resume() {
            if (disposed) return;
            manualPaused = false;
            wantsPlayback = true;
            if (completed) { completed = false; index = 0; finishedTracks.clear(); }
            reconcile(true);
        },
        toggle() {
            if (status === 'playing' || status === 'loading') controller.pause();
            else controller.resume();
        },
        playTrack(trackId) {
            if (disposed) return;
            const nextIndex = playlist.findIndex(track => track.id === trackId);
            if (nextIndex < 0) return;
            manualPaused = false;
            wantsPlayback = true;
            completed = false;
            finishedTracks.clear();
            playlist.slice(0, nextIndex).forEach(track => finishedTracks.add(trackKey(track)));
            const selected = playlist[nextIndex];
            if (active?.key === trackKey(selected)) {
                index = nextIndex;
                reconcile(true);
                return;
            }
            retire(active);
            active = null;
            index = nextIndex;
            reconcile(true);
        },
        stop() {
            if (disposed) return;
            manualPaused = true;
            wantsPlayback = false;
            release(active);
            active = null;
            [...outgoing].forEach(release);
            index = 0;
            completed = false;
            finishedTracks.clear();
            if (frameId !== null) { cancelFrame(frameId); frameId = null; }
            setStatus(playlist.length ? 'paused' : 'idle');
        },
        setVolume(value) {
            volume = clampVolume(value);
            [active, ...outgoing].filter(Boolean).forEach(applyVolume);
            emit();
        },
        setMuted(value) {
            muted = Boolean(value);
            [active, ...outgoing].filter(Boolean).forEach(applyVolume);
            emit();
        },
        setEnabled(value) {
            const next = Boolean(value);
            if (disposed || enabled === next) return;
            enabled = next;
            reconcile();
        },
        setSuspended(value) {
            const next = Boolean(value);
            if (disposed || suspended === next) return;
            suspended = next;
            if (suspended) [...outgoing].forEach(release);
            reconcile();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            release(active);
            active = null;
            [...outgoing].forEach(release);
            if (frameId !== null) cancelFrame(frameId);
            frameId = null;
            playlist = [];
            finishedTracks.clear();
            status = 'idle';
        },
    };
    return controller;
}
