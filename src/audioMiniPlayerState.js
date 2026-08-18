const EMPTY_AUDIO_MINI_PLAYER_STATE = Object.freeze({
    visible: true,
    sessionId: '',
    title: '',
    artist: '',
    artwork: '',
    fileName: '',
    currentTime: 0,
    duration: 0,
    playing: false,
    playbackRate: 1,
    volume: 1,
    muted: false,
});

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
    return Math.max(0, finiteNumber(value, fallback));
}

function normalizeAudioMiniPlayerState(value = {}, fallback = EMPTY_AUDIO_MINI_PLAYER_STATE) {
    return {
        visible: true,
        sessionId: String(value.sessionId ?? fallback.sessionId ?? ''),
        title: String(value.title ?? fallback.title ?? ''),
        artist: String(value.artist ?? fallback.artist ?? ''),
        artwork: String(value.artwork ?? value.artworkDataUrl ?? fallback.artwork ?? ''),
        fileName: String(value.fileName ?? fallback.fileName ?? ''),
        currentTime: nonNegativeNumber(
            value.currentTime ?? value.positionSeconds,
            fallback.currentTime,
        ),
        duration: nonNegativeNumber(
            value.duration ?? value.durationSeconds,
            fallback.duration,
        ),
        playing: value.playing === undefined
            ? Boolean(fallback.playing)
            : Boolean(value.playing),
        playbackRate: Math.max(0.1, finiteNumber(value.playbackRate, fallback.playbackRate || 1)),
        volume: Math.min(1, Math.max(0, finiteNumber(value.volume, fallback.volume ?? 1))),
        muted: value.muted === undefined
            ? Boolean(fallback.muted)
            : Boolean(value.muted),
    };
}

export function reduceAudioMiniPlayerState(currentState, event) {
    if (!event || typeof event !== 'object') return currentState;

    const type = String(event.type || '');
    if (type === 'clear' || event.visible === false) return null;

    const canCreateState = type === 'show' || event.visible === true;
    if (!currentState && !canCreateState) return currentState;

    const trackChanged = type === 'track'
        && event.sessionId
        && currentState?.sessionId
        && event.sessionId !== currentState.sessionId;
    const baseState = trackChanged
        ? EMPTY_AUDIO_MINI_PLAYER_STATE
        : currentState || EMPTY_AUDIO_MINI_PLAYER_STATE;

    return normalizeAudioMiniPlayerState(event, baseState);
}

export function initialAudioMiniPlayerState(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (snapshot.type === 'clear' || snapshot.visible === false) return null;
    return reduceAudioMiniPlayerState(null, {
        ...snapshot,
        type: 'show',
        visible: true,
    });
}

export function clampAudioMiniPlayerSeek(value, duration) {
    const maximum = nonNegativeNumber(duration, 0);
    const position = nonNegativeNumber(value, 0);
    return maximum > 0 ? Math.min(maximum, position) : position;
}
