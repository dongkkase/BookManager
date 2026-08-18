import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { clampAudioMiniPlayerSeek } from '../audioMiniPlayerState';
import { FaIcon } from './FaIcon';

const MINI_PLAYER_TEXT = {
    ko: {
        region: '오디오북 미니 플레이어',
        audiobook: '오디오북',
        play: '재생',
        pause: '일시정지',
        seek: '재생 위치',
        restore: '전체 플레이어로 돌아가기',
        close: '재생 중지 및 미니 플레이어 닫기',
    },
    en: {
        region: 'Audiobook mini player',
        audiobook: 'Audiobook',
        play: 'Play',
        pause: 'Pause',
        seek: 'Playback position',
        restore: 'Return to full player',
        close: 'Stop playback and close mini player',
    },
    ja: {
        region: 'オーディオブックミニプレーヤー',
        audiobook: 'オーディオブック',
        play: '再生',
        pause: '一時停止',
        seek: '再生位置',
        restore: 'フルプレーヤーに戻る',
        close: '再生を停止してミニプレーヤーを閉じる',
    },
};
const SEEK_COMMIT_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
]);

function miniPlayerText(language) {
    const normalized = String(language || 'ko').toLowerCase();
    if (normalized.startsWith('en')) return MINI_PLAYER_TEXT.en;
    if (normalized.startsWith('ja')) return MINI_PLAYER_TEXT.ja;
    return MINI_PLAYER_TEXT.ko;
}

function formatTime(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function AudiobookMiniPlayer({ state, language = 'ko', onControl }) {
    const [seekPreview, setSeekPreview] = useState(null);
    const [coverFailed, setCoverFailed] = useState(false);
    const text = useMemo(() => miniPlayerText(language), [language]);
    const duration = Math.max(0, Number(state?.duration) || 0);
    const currentTime = clampAudioMiniPlayerSeek(
        seekPreview ?? state?.currentTime,
        duration,
    );
    const sliderMaximum = Math.max(1, duration, currentTime);
    const progress = duration > 0 ? currentTime / duration : 0;
    const title = state?.title || state?.fileName || text.audiobook;
    const artist = state?.artist || '';
    const artwork = coverFailed ? '' : state?.artwork || '';

    useEffect(() => {
        setSeekPreview(null);
    }, [state?.sessionId]);

    useEffect(() => {
        setCoverFailed(false);
    }, [state?.artwork]);

    const sendControl = useCallback(command => {
        try {
            Promise.resolve(onControl?.({
                ...command,
                sessionId: state?.sessionId || '',
            })).catch(() => {});
        } catch {
            // The main process can be unavailable while the app is shutting down.
        }
    }, [onControl, state?.sessionId]);

    const commitSeek = useCallback(value => {
        const positionSeconds = clampAudioMiniPlayerSeek(value, duration);
        setSeekPreview(null);
        sendControl({ type: 'seek', positionSeconds });
    }, [duration, sendControl]);

    if (!state?.visible) return null;

    const positionText = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    const titleText = artist ? `${title} · ${artist}` : title;

    return (
        <section
            className={`app-audio-mini-player ${state.playing ? 'is-playing' : 'is-paused'}`}
            aria-label={text.region}
        >
            <div className={`app-audio-mini-cover ${artwork ? 'has-artwork' : 'is-fallback'}`}>
                {artwork
                    ? <img src={artwork} alt="" onError={() => setCoverFailed(true)} />
                    : <FaIcon name="headphones" size={18} />}
            </div>

            <div className="app-audio-mini-main">
                <div className="app-audio-mini-identity" aria-live="polite" title={titleText}>
                    <strong>{title}</strong>
                    {artist && <span>{artist}</span>}
                </div>
                <div className="app-audio-mini-progress-row">
                    <input
                        type="range"
                        min="0"
                        max={sliderMaximum}
                        step="0.1"
                        value={currentTime}
                        disabled={duration <= 0}
                        style={{ '--app-audio-mini-progress': `${progress * 100}%` }}
                        aria-label={text.seek}
                        aria-valuetext={positionText}
                        onChange={event => setSeekPreview(Number(event.currentTarget.value))}
                        onPointerUp={event => commitSeek(event.currentTarget.value)}
                        onPointerCancel={() => setSeekPreview(null)}
                        onKeyUp={event => {
                            if (SEEK_COMMIT_KEYS.has(event.key)) {
                                commitSeek(event.currentTarget.value);
                            }
                        }}
                    />
                    <span className="app-audio-mini-time" aria-hidden="true">{positionText}</span>
                </div>
            </div>

            <div className="app-audio-mini-actions">
                <button
                    type="button"
                    className="app-audio-mini-button app-audio-mini-play"
                    title={state.playing ? text.pause : text.play}
                    aria-label={state.playing ? text.pause : text.play}
                    aria-pressed={Boolean(state.playing)}
                    onClick={() => sendControl({ type: state.playing ? 'pause' : 'play' })}
                >
                    <FaIcon name={state.playing ? 'pause' : 'play'} size={13} />
                </button>
                <button
                    type="button"
                    className="app-audio-mini-button"
                    title={text.restore}
                    aria-label={text.restore}
                    onClick={() => sendControl({ type: 'restore' })}
                >
                    <FaIcon name="desktop" size={12} />
                </button>
                <button
                    type="button"
                    className="app-audio-mini-button app-audio-mini-close"
                    title={text.close}
                    aria-label={text.close}
                    onClick={() => sendControl({ type: 'close' })}
                >
                    <FaIcon name="xmark" size={13} />
                </button>
            </div>
        </section>
    );
}

export default AudiobookMiniPlayer;
