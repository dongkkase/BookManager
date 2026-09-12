import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { translate } from '../../utils/i18n';
import '../../styles/epubAudioControls.css';

export function EpubAudioControls({ player, tracks, settings, onSettingsChange, language, suspended, slideNavOpen }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const t = name => translate(`viewer.epub_audio.${name}`, language);
    const playing = player.status === 'playing' && !player.muted && player.volume > 0;
    const current = player.currentTrack;
    const status = suspended ? t('tts_paused') : player.status === 'blocked' ? t('blocked')
        : player.status === 'error' ? t('error') : !tracks.length ? t('no_audio')
            : player.status === 'loading' ? t('loading') : player.status === 'playing' ? t('playing') : t('paused');
    useEffect(() => {
        if (!open) return undefined;
        const closeOutside = event => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);
    return (
        <div
            ref={rootRef}
            className={`viewer-epub-audio-controls${playing ? ' is-playing' : ''}${slideNavOpen ? ' has-slide-nav' : ''}`}
            onKeyDown={event => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    setOpen(false);
                }
                event.stopPropagation();
            }}
        >
            <button
                type="button"
                className="viewer-epub-audio-indicator"
                title={`${t('title')} · ${status}`}
                aria-label={`${t('title')} · ${status}`}
                aria-expanded={open}
                aria-controls="viewer-epub-audio-menu"
                onClick={() => setOpen(value => !value)}
            >
                <FaIcon name="music" />
                <span className="viewer-epub-audio-note note-one" aria-hidden="true">♪</span>
                <span className="viewer-epub-audio-note note-two" aria-hidden="true">♫</span>
                <span className="viewer-epub-audio-levels" aria-hidden="true"><i /><i /><i /></span>
            </button>
            {open && (
                <section id="viewer-epub-audio-menu" className="viewer-epub-audio-menu" aria-label={t('title')}>
                    <div className="viewer-epub-audio-heading">
                        <span>{t('title')}</span>
                        <small role="status">{status}</small>
                        <button type="button" aria-label={t('close')} onClick={() => setOpen(false)}><FaIcon name="xmark" /></button>
                    </div>
                    <div className="viewer-epub-audio-row">
                        <button
                            type="button"
                            className="viewer-epub-audio-play"
                            disabled={!tracks.length || suspended}
                            aria-label={player.status === 'playing' || player.status === 'loading' ? t('pause') : t('play')}
                            title={player.status === 'playing' || player.status === 'loading' ? t('pause') : t('play')}
                            onClick={player.toggle}
                        ><FaIcon name={player.status === 'loading' ? 'spinner' : player.status === 'playing' ? 'pause' : 'play'} spin={player.status === 'loading'} /></button>
                        <select
                            aria-label={t('track')}
                            value={tracks.some(track => track.id === current?.id) ? current.id : tracks[0]?.id || ''}
                            disabled={!tracks.length || suspended}
                            onChange={event => player.playTrack(event.target.value)}
                        >
                            {!tracks.length && <option value="">{t('no_audio')}</option>}
                            {tracks.map((track, index) => <option key={track.id} value={track.id}>{track.title || `${t('track')} ${index + 1}`}</option>)}
                        </select>
                    </div>
                    <div className="viewer-epub-audio-row viewer-epub-audio-options">
                        <label><input type="checkbox" checked={settings.autoplay} onChange={event => onSettingsChange({ autoplay: event.target.checked })} />{t('autoplay')}</label>
                        <button type="button" title={player.muted ? t('unmute') : t('mute')} aria-label={player.muted ? t('unmute') : t('mute')} aria-pressed={player.muted} onClick={() => onSettingsChange({ muted: !settings.muted })}><FaIcon name={player.muted ? 'volumeMute' : 'volumeHigh'} /></button>
                        <input type="range" min="0" max="100" step="1" value={Math.round(settings.volume * 100)} aria-label={t('volume')} onChange={event => onSettingsChange({ volume: Number(event.target.value) / 100, muted: false })} />
                        <small>{Math.round(settings.volume * 100)}%</small>
                    </div>
                </section>
            )}
        </div>
    );
}
