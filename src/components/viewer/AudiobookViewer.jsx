import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_INTERVALS = [5, 10, 15, 30, 60];
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 120];
const AUDIO_PREFS_KEY = 'bookmanager-audiobook-preferences';

const AUDIOBOOK_TEXT = {
    ko: {
        audiobook: '오디오북',
        loading: '오디오북을 불러오는 중입니다.',
        loadError: '오디오북 정보를 불러오지 못했습니다.',
        unknownArtist: '아티스트 정보 없음',
        previous: '이전 트랙',
        next: '다음 트랙',
        rewind: '{seconds}초 되감기',
        forward: '{seconds}초 앞으로',
        play: '재생',
        pause: '일시정지',
        mute: '음소거',
        unmute: '음소거 해제',
        volume: '음량',
        playlist: '재생목록',
        bookmarks: '북마크',
        settings: '재생 설정',
        info: '파일 정보',
        fullscreen: '전체 화면',
        close: '닫기',
        track: '트랙 {current}/{total}',
        noQueue: '같은 폴더에 다른 오디오 파일이 없습니다.',
        currentTrack: '현재 재생 중',
        addBookmark: '현재 위치에 북마크 추가',
        bookmark: '북마크 {number}',
        noBookmarks: '저장된 북마크가 없습니다.',
        delete: '삭제',
        skipBackward: '되감기 간격',
        skipForward: '앞으로 감기 간격',
        continuous: '트랙 종료 후 다음 트랙 자동 재생',
        sleepTimer: '취침 타이머',
        off: '사용 안 함',
        endOfTrack: '현재 트랙 끝',
        minutes: '{minutes}분',
        sleepRemaining: '{time} 후 재생이 멈춥니다.',
        title: '제목',
        artist: '아티스트',
        album: '앨범',
        albumArtist: '앨범 아티스트',
        composer: '작곡가',
        genre: '장르',
        year: '연도',
        trackNumber: '트랙',
        discNumber: '디스크',
        duration: '재생 시간',
        bitrate: '비트레이트',
        sampleRate: '샘플레이트',
        codec: '코덱',
        container: '컨테이너',
        mime: 'MIME',
        fileName: '파일명',
        fileSize: '파일 크기',
        unknown: '-',
    },
    en: {
        audiobook: 'Audiobook',
        loading: 'Loading audiobook…',
        loadError: 'Could not load audiobook information.',
        unknownArtist: 'Unknown artist',
        previous: 'Previous track',
        next: 'Next track',
        rewind: 'Rewind {seconds} seconds',
        forward: 'Forward {seconds} seconds',
        play: 'Play',
        pause: 'Pause',
        mute: 'Mute',
        unmute: 'Unmute',
        volume: 'Volume',
        playlist: 'Playlist',
        bookmarks: 'Bookmarks',
        settings: 'Playback settings',
        info: 'File information',
        fullscreen: 'Fullscreen',
        close: 'Close',
        track: 'Track {current}/{total}',
        noQueue: 'There are no other audio files in this folder.',
        currentTrack: 'Now playing',
        addBookmark: 'Add bookmark at current position',
        bookmark: 'Bookmark {number}',
        noBookmarks: 'No bookmarks saved.',
        delete: 'Delete',
        skipBackward: 'Rewind interval',
        skipForward: 'Forward interval',
        continuous: 'Play the next track automatically',
        sleepTimer: 'Sleep timer',
        off: 'Off',
        endOfTrack: 'End of track',
        minutes: '{minutes} min',
        sleepRemaining: 'Playback stops in {time}.',
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        albumArtist: 'Album artist',
        composer: 'Composer',
        genre: 'Genre',
        year: 'Year',
        trackNumber: 'Track',
        discNumber: 'Disc',
        duration: 'Duration',
        bitrate: 'Bitrate',
        sampleRate: 'Sample rate',
        codec: 'Codec',
        container: 'Container',
        mime: 'MIME',
        fileName: 'Filename',
        fileSize: 'File size',
        unknown: '-',
    },
    ja: {
        audiobook: 'オーディオブック',
        loading: 'オーディオブックを読み込んでいます。',
        loadError: 'オーディオブック情報を読み込めませんでした。',
        unknownArtist: 'アーティスト情報なし',
        previous: '前のトラック',
        next: '次のトラック',
        rewind: '{seconds}秒戻る',
        forward: '{seconds}秒進む',
        play: '再生',
        pause: '一時停止',
        mute: 'ミュート',
        unmute: 'ミュート解除',
        volume: '音量',
        playlist: 'プレイリスト',
        bookmarks: 'ブックマーク',
        settings: '再生設定',
        info: 'ファイル情報',
        fullscreen: 'フルスクリーン',
        close: '閉じる',
        track: 'トラック {current}/{total}',
        noQueue: '同じフォルダーに他のオーディオファイルがありません。',
        currentTrack: '再生中',
        addBookmark: '現在位置にブックマークを追加',
        bookmark: 'ブックマーク {number}',
        noBookmarks: '保存されたブックマークはありません。',
        delete: '削除',
        skipBackward: '巻き戻し間隔',
        skipForward: '早送り間隔',
        continuous: '終了後に次のトラックを自動再生',
        sleepTimer: 'スリープタイマー',
        off: 'オフ',
        endOfTrack: '現在のトラック終了時',
        minutes: '{minutes}分',
        sleepRemaining: '{time}後に再生を停止します。',
        title: 'タイトル',
        artist: 'アーティスト',
        album: 'アルバム',
        albumArtist: 'アルバムアーティスト',
        composer: '作曲者',
        genre: 'ジャンル',
        year: '年',
        trackNumber: 'トラック',
        discNumber: 'ディスク',
        duration: '再生時間',
        bitrate: 'ビットレート',
        sampleRate: 'サンプルレート',
        codec: 'コーデック',
        container: 'コンテナ',
        mime: 'MIME',
        fileName: 'ファイル名',
        fileSize: 'ファイルサイズ',
        unknown: '-',
    },
};

function textFor(language, key, values = {}) {
    const messages = AUDIOBOOK_TEXT[language] || AUDIOBOOK_TEXT.ko;
    return String(messages[key] || AUDIOBOOK_TEXT.en[key] || key).replace(/\{(\w+)\}/g, (_match, name) => (
        values[name] === undefined ? '' : String(values[name])
    ));
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

function formatFileSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function pairValue(number, total) {
    if (!number && !total) return '';
    if (!total) return String(number || '');
    return `${number || '-'}/${total}`;
}

function readStoredJson(key, fallback) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function saveStoredJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage can be unavailable in restricted browser contexts.
    }
}

function audioStateKey(session) {
    return `bookmanager-viewer-state:${session?.filePath || session?.fileName || session?.id || ''}`;
}

function audioBookmarksKey(session) {
    return `bookmanager-viewer-bookmarks:${session?.filePath || session?.fileName || session?.id || ''}`;
}

function persistAudioPlaybackState(session, audio, fallbackDuration = 0, fallbackRate = 1, fallbackPosition = 0) {
    if (!session) return;
    const positionSeconds = Number(audio?.currentTime);
    const playbackRate = Number(audio?.playbackRate);
    const hasLoadedAudio = Boolean(audio) && Number(audio.readyState) > 0 && Number.isFinite(positionSeconds);
    saveStoredJson(audioStateKey(session), {
        positionSeconds: hasLoadedAudio ? positionSeconds : Math.max(0, Number(fallbackPosition) || 0),
        durationSeconds: Number(audio?.duration) || fallbackDuration,
        playbackRate: Number.isFinite(playbackRate) ? playbackRate : fallbackRate,
    });
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function ToolbarButton({ title, active = false, disabled = false, icon, onClick }) {
    return (
        <button
            type="button"
            className={`audiobook-toolbar-button ${active ? 'is-active' : ''}`.trim()}
            title={title}
            aria-label={title}
            aria-pressed={active || undefined}
            disabled={disabled}
            onClick={onClick}
        >
            <FaIcon name={icon} size={16} />
        </button>
    );
}

function AudiobookViewer({
    session,
    language = 'ko',
    isFullscreen = false,
    adjacentLoading = false,
    onToggleFullscreen,
    onClose,
    onMoveAdjacent,
    onOpenQueueItem,
}) {
    const audioRef = useRef(null);
    const restoreTimeRef = useRef(0);
    const restoreDurationRef = useRef(0);
    const autoplayNextRef = useRef(false);
    const [audioData, setAudioData] = useState(null);
    const [queue, setQueue] = useState({ currentIndex: -1, items: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [scrubbing, setScrubbing] = useState(false);
    const [panel, setPanel] = useState('');
    const initialPreferences = useMemo(() => readStoredJson(AUDIO_PREFS_KEY, {}), []);
    const [playbackRate, setPlaybackRate] = useState(() => clamp(initialPreferences.playbackRate || 1, 0.75, 2));
    const [volume, setVolume] = useState(() => clamp(initialPreferences.volume ?? 1, 0, 1));
    const [muted, setMuted] = useState(false);
    const [skipBackward, setSkipBackward] = useState(() => (
        SKIP_INTERVALS.includes(initialPreferences.skipBackward) ? initialPreferences.skipBackward : 15
    ));
    const [skipForward, setSkipForward] = useState(() => (
        SKIP_INTERVALS.includes(initialPreferences.skipForward) ? initialPreferences.skipForward : 30
    ));
    const [continuousPlayback, setContinuousPlayback] = useState(initialPreferences.continuousPlayback !== false);
    const [bookmarks, setBookmarks] = useState([]);
    const [sleepMode, setSleepMode] = useState('off');
    const [sleepDeadline, setSleepDeadline] = useState(0);
    const [sleepRemaining, setSleepRemaining] = useState(0);

    const t = useCallback((key, values) => textFor(language, key, values), [language]);
    const activeAudioData = audioData?._sessionId === session?.id ? audioData : null;
    const metadata = activeAudioData?.metadata || {};
    const title = metadata.title || String(session?.fileName || '').replace(/\.[^.]+$/, '') || t('audiobook');
    const artist = metadata.artist || metadata.albumArtist || t('unknownArtist');
    const artwork = metadata.artworkDataUrl || '';
    const effectiveDuration = duration > 0 ? duration : Number(metadata.durationSeconds) || 0;
    const progress = effectiveDuration > 0 ? clamp(currentTime / effectiveDuration, 0, 1) : 0;
    const currentQueueIndex = queue.currentIndex >= 0 ? queue.currentIndex : 0;

    const savePlaybackState = useCallback(() => {
        persistAudioPlaybackState(
            session,
            audioRef.current,
            effectiveDuration || restoreDurationRef.current,
            playbackRate,
            restoreTimeRef.current,
        );
    }, [effectiveDuration, playbackRate, session]);

    const publishAudioMiniPlayback = useCallback(() => {
        if (!session?.id) return;
        const audio = audioRef.current;
        const audioPosition = Number(audio?.currentTime);
        const audioDuration = Number(audio?.duration);
        const audioRate = Number(audio?.playbackRate);
        const audioVolume = Number(audio?.volume);
        window.viewerAPI?.publishAudioMiniPlayback?.({
            sessionId: session.id,
            positionSeconds: Number.isFinite(audioPosition) ? audioPosition : currentTime,
            durationSeconds: Number.isFinite(audioDuration) ? audioDuration : effectiveDuration,
            playing: audio ? !audio.paused && !audio.ended : playing,
            playbackRate: Number.isFinite(audioRate) ? audioRate : playbackRate,
            volume: Number.isFinite(audioVolume) ? audioVolume : volume,
            muted: Boolean(audio?.muted ?? muted),
        });
    }, [currentTime, effectiveDuration, muted, playbackRate, playing, session?.id, volume]);

    useEffect(() => {
        saveStoredJson(AUDIO_PREFS_KEY, {
            playbackRate,
            volume,
            skipBackward,
            skipForward,
            continuousPlayback,
        });
        const audio = audioRef.current;
        if (audio) {
            audio.playbackRate = playbackRate;
            audio.volume = volume;
        }
    }, [continuousPlayback, playbackRate, skipBackward, skipForward, volume]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        setAudioData(null);
        setQueue({ currentIndex: -1, items: [] });
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setPanel('');
        const stored = readStoredJson(audioStateKey(session), {});
        restoreTimeRef.current = Math.max(0, Number(stored.positionSeconds) || 0);
        restoreDurationRef.current = Math.max(0, Number(stored.durationSeconds) || 0);
        const storedPlaybackRate = Number(stored.playbackRate);
        setPlaybackRate(PLAYBACK_RATES.includes(storedPlaybackRate)
            ? storedPlaybackRate
            : clamp(initialPreferences.playbackRate || 1, 0.75, 2));
        const storedBookmarks = readStoredJson(audioBookmarksKey(session), []);
        setBookmarks(Array.isArray(storedBookmarks) ? storedBookmarks.map(bookmark => ({
            ...bookmark,
            timeSeconds: Math.max(0, Number(bookmark.timeSeconds ?? bookmark.time) || 0),
        })) : []);

        Promise.all([
            window.viewerAPI.getAudioData(session.id),
            window.viewerAPI.listAudioQueue(session.id),
        ])
            .then(([nextAudioData, nextQueue]) => {
                if (!active) return;
                setAudioData({ ...nextAudioData, _sessionId: session.id });
                setQueue(nextQueue && typeof nextQueue === 'object'
                    ? nextQueue
                    : { currentIndex: -1, items: [] });
            })
            .catch(loadError => {
                if (active) setError(loadError?.message || t('loadError'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [initialPreferences.playbackRate, session, t]);

    useEffect(() => {
        if (!activeAudioData?.documentUrl) return undefined;
        const capturedSession = session;
        const capturedAudio = audioRef.current;
        const capturedDuration = Number(metadata.durationSeconds) || 0;
        const saveCapturedPlaybackState = () => persistAudioPlaybackState(
            capturedSession,
            capturedAudio,
            capturedDuration || restoreDurationRef.current,
            Number(capturedAudio?.playbackRate) || playbackRate,
            restoreTimeRef.current,
        );
        const handleBeforeUnload = () => saveCapturedPlaybackState();
        const timer = window.setInterval(saveCapturedPlaybackState, 5000);
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            saveCapturedPlaybackState();
        };
    }, [activeAudioData?.documentUrl, metadata.durationSeconds, playbackRate, session]);

    useEffect(() => {
        if (!activeAudioData?.documentUrl || !session?.id) return;
        window.viewerAPI?.publishAudioMiniTrack?.({
            sessionId: session.id,
            fileName: session.fileName || '',
            title,
            artist,
            artworkDataUrl: artwork,
        });
    }, [activeAudioData?.documentUrl, artist, artwork, session?.fileName, session?.id, title]);

    useEffect(() => {
        if (!activeAudioData?.documentUrl) return;
        publishAudioMiniPlayback();
    }, [activeAudioData?.documentUrl, publishAudioMiniPlayback]);

    useEffect(() => {
        if (!sleepDeadline) {
            setSleepRemaining(0);
            return undefined;
        }
        const updateRemaining = () => {
            const remaining = Math.max(0, Math.ceil((sleepDeadline - Date.now()) / 1000));
            setSleepRemaining(remaining);
            if (remaining > 0) return;
            audioRef.current?.pause();
            setSleepMode('off');
            setSleepDeadline(0);
        };
        updateRemaining();
        const timer = window.setInterval(updateRemaining, 1000);
        return () => window.clearInterval(timer);
    }, [sleepDeadline]);

    const togglePlayback = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
            audio.play().catch(playError => setError(playError?.message || String(playError)));
        } else {
            audio.pause();
        }
    }, []);

    const seekTo = useCallback(nextTime => {
        const audio = audioRef.current;
        if (!audio) return;
        const maximum = Number.isFinite(audio.duration) ? audio.duration : effectiveDuration;
        const target = clamp(nextTime, 0, Math.max(0, maximum));
        audio.currentTime = target;
        restoreTimeRef.current = target;
        setCurrentTime(target);
        savePlaybackState();
    }, [effectiveDuration, savePlaybackState]);

    useEffect(() => window.viewerAPI?.onAudioMiniPlayerCommand?.(command => {
        if (command?.sessionId && command.sessionId !== session?.id) return;
        const audio = audioRef.current;
        if (!audio) return;
        if (command?.type === 'play') {
            audio.play().catch(playError => setError(playError?.message || String(playError)));
        } else if (command?.type === 'pause') {
            audio.pause();
        } else if (command?.type === 'seek') {
            seekTo(command.positionSeconds);
        }
    }), [seekTo, session?.id]);

    const skipBy = useCallback(delta => {
        seekTo((Number(audioRef.current?.currentTime) || 0) + delta);
    }, [seekTo]);

    const addBookmark = useCallback(() => {
        const time = Number(audioRef.current?.currentTime) || currentTime;
        savePlaybackState();
        setBookmarks(current => {
            if (current.some(bookmark => Math.abs(bookmark.timeSeconds - time) < 1)) return current;
            const next = [
                ...current,
                {
                    id: `${Date.now().toString(36)}-${Math.round(time * 1000).toString(36)}`,
                    timeSeconds: time,
                    label: '',
                },
            ]
                .sort((left, right) => left.timeSeconds - right.timeSeconds)
                .map((bookmark, index) => ({
                    ...bookmark,
                    label: t('bookmark', { number: index + 1 }),
                }));
            saveStoredJson(audioBookmarksKey(session), next);
            return next;
        });
    }, [currentTime, savePlaybackState, session, t]);

    const deleteBookmark = useCallback(id => {
        setBookmarks(current => {
            const next = current
                .filter(bookmark => bookmark.id !== id)
                .map((bookmark, index) => ({
                    ...bookmark,
                    label: t('bookmark', { number: index + 1 }),
                }));
            saveStoredJson(audioBookmarksKey(session), next);
            return next;
        });
    }, [session, t]);

    const moveAdjacent = useCallback(async (direction, autoplay = false) => {
        if (adjacentLoading) return;
        audioRef.current?.pause();
        savePlaybackState();
        autoplayNextRef.current = autoplay;
        try {
            const moved = await onMoveAdjacent?.(direction);
            if (!moved) autoplayNextRef.current = false;
        } catch (moveError) {
            autoplayNextRef.current = false;
            setError(moveError?.message || String(moveError));
        }
    }, [adjacentLoading, onMoveAdjacent, savePlaybackState]);

    const closeViewer = useCallback(() => {
        publishAudioMiniPlayback();
        onClose?.();
    }, [onClose, publishAudioMiniPlayback]);

    const openQueueItem = useCallback(async fileName => {
        if (!fileName || adjacentLoading) return;
        audioRef.current?.pause();
        savePlaybackState();
        autoplayNextRef.current = false;
        try {
            await onOpenQueueItem?.(fileName);
        } catch (queueError) {
            setError(queueError?.message || String(queueError));
        }
    }, [adjacentLoading, onOpenQueueItem, savePlaybackState]);

    const setSleepTimer = useCallback(value => {
        if (value === 'off' || value === 'end') {
            setSleepMode(value);
            setSleepDeadline(0);
            return;
        }
        const minutes = Number(value);
        setSleepMode(String(minutes));
        setSleepDeadline(Date.now() + minutes * 60 * 1000);
    }, []);

    const handleLoadedMetadata = useCallback(event => {
        const audio = event.currentTarget;
        const nextDuration = Number.isFinite(audio.duration) ? audio.duration : Number(metadata.durationSeconds) || 0;
        restoreDurationRef.current = nextDuration;
        setDuration(nextDuration);
        audio.playbackRate = playbackRate;
        audio.volume = volume;
        audio.currentTime = clamp(restoreTimeRef.current, 0, Math.max(0, nextDuration - 0.1));
        restoreTimeRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
        if (autoplayNextRef.current) {
            autoplayNextRef.current = false;
            audio.play().catch(playError => setError(playError?.message || String(playError)));
        }
    }, [metadata.durationSeconds, playbackRate, volume]);

    const handleEnded = useCallback(() => {
        setPlaying(false);
        savePlaybackState();
        if (sleepMode === 'end') {
            setSleepMode('off');
            return;
        }
        if (continuousPlayback && session?.adjacent?.hasNext) {
            moveAdjacent(1, true);
        }
    }, [continuousPlayback, moveAdjacent, savePlaybackState, session?.adjacent?.hasNext, sleepMode]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (panel) setPanel('');
                else closeViewer();
                return;
            }
            if (event.target?.closest?.('input, select, textarea, button, a, [contenteditable="true"]')) return;
            if (event.key === 'F11' || (event.key === 'Enter' && !event.repeat)) {
                event.preventDefault();
                onToggleFullscreen?.();
                return;
            }
            if (event.code === 'Space') {
                event.preventDefault();
                togglePlayback();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                skipBy(-skipBackward);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                skipBy(skipForward);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setVolume(current => clamp(current + 0.05, 0, 1));
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setVolume(current => clamp(current - 0.05, 0, 1));
            } else if (event.key === '[') {
                event.preventDefault();
                moveAdjacent(-1);
            } else if (event.key === ']') {
                event.preventDefault();
                moveAdjacent(1);
            } else if (event.key.toLowerCase() === 'm') {
                event.preventDefault();
                setMuted(current => !current);
            } else if (event.key.toLowerCase() === 'b') {
                event.preventDefault();
                addBookmark();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [addBookmark, closeViewer, moveAdjacent, onToggleFullscreen, panel, skipBackward, skipBy, skipForward, togglePlayback]);

    const infoRows = useMemo(() => [
        [t('title'), metadata.title],
        [t('artist'), metadata.artist],
        [t('album'), metadata.album],
        [t('albumArtist'), metadata.albumArtist],
        [t('composer'), metadata.composer],
        [t('genre'), metadata.genre],
        [t('year'), metadata.year],
        [t('trackNumber'), pairValue(metadata.trackNumber, metadata.trackTotal)],
        [t('discNumber'), pairValue(metadata.discNumber, metadata.discTotal)],
        [t('duration'), formatTime(effectiveDuration)],
        [t('bitrate'), metadata.bitrateBitsPerSecond ? `${Math.round(metadata.bitrateBitsPerSecond / 1000)} kbps` : ''],
        [t('sampleRate'), metadata.sampleRateHz ? `${(metadata.sampleRateHz / 1000).toFixed(1)} kHz` : ''],
        [t('codec'), metadata.codec],
        [t('container'), metadata.container],
        [t('mime'), activeAudioData?.mime || metadata.mimeType],
        [t('fileName'), session?.fileName],
        [t('fileSize'), formatFileSize(metadata.fileSizeBytes)],
    ], [activeAudioData?.mime, effectiveDuration, metadata, session?.fileName, t]);

    const togglePanel = nextPanel => {
        setPanel(current => current === nextPanel ? '' : nextPanel);
    };

    if (loading) {
        return (
            <div className="audiobook-viewer audiobook-state" lang={language}>
                <FaIcon name="headphones" size={36} />
                <span>{t('loading')}</span>
            </div>
        );
    }

    return (
        <div className="audiobook-viewer" lang={language}>
            {artwork && (
                <div
                    className="audiobook-backdrop"
                    style={{ backgroundImage: `url(${artwork})` }}
                    aria-hidden="true"
                />
            )}
            <div className="audiobook-backdrop-shade" aria-hidden="true" />

            <audio
                key={session.id}
                ref={audioRef}
                src={activeAudioData?.documentUrl || undefined}
                preload="metadata"
                muted={muted}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={event => {
                    if (Number.isFinite(event.currentTarget.duration)) {
                        restoreDurationRef.current = event.currentTarget.duration;
                        setDuration(event.currentTarget.duration);
                    }
                }}
                onTimeUpdate={event => {
                    if (!scrubbing) {
                        restoreTimeRef.current = event.currentTarget.currentTime;
                        setCurrentTime(event.currentTarget.currentTime);
                    }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                    setPlaying(false);
                    savePlaybackState();
                }}
                onEnded={handleEnded}
                onError={() => setError(t('loadError'))}
            />

            <header className="audiobook-toolbar">
                <div className="audiobook-toolbar-title">
                    <FaIcon name="headphones" size={17} />
                    <span>{t('audiobook')}</span>
                </div>
                <div className="audiobook-toolbar-actions">
                    <ToolbarButton title={t('playlist')} active={panel === 'playlist'} icon="list" onClick={() => togglePanel('playlist')} />
                    <ToolbarButton title={t('bookmarks')} active={panel === 'bookmarks'} icon="bookmark" onClick={() => togglePanel('bookmarks')} />
                    <ToolbarButton title={t('info')} active={panel === 'info'} icon="info" onClick={() => togglePanel('info')} />
                    <ToolbarButton title={t('fullscreen')} active={isFullscreen} icon="desktop" onClick={onToggleFullscreen} />
                    <ToolbarButton title={t('settings')} active={panel === 'settings'} icon="gear" onClick={() => togglePanel('settings')} />
                </div>
            </header>

            <main className="audiobook-stage">
                <div className={`audiobook-cover ${artwork ? 'has-artwork' : 'is-fallback'}`.trim()}>
                    {artwork
                        ? <img src={artwork} alt="" />
                        : <FaIcon name="headphones" size={82} />}
                </div>
                <section className="audiobook-identity">
                    <h1>{title}</h1>
                    <p className="audiobook-artist">{artist}</p>
                    <p className="audiobook-file-name" title={session?.fileName}>{session?.fileName}</p>
                    {queue.items.length > 0 && (
                        <p className="audiobook-track-position">
                            {t('track', { current: currentQueueIndex + 1, total: queue.items.length })}
                        </p>
                    )}
                </section>
            </main>

            {error && <div className="audiobook-error" role="alert">{error}</div>}

            <footer className="audiobook-player">
                <div className="audiobook-timeline">
                    <span>{formatTime(currentTime)}</span>
                    <input
                        type="range"
                        min="0"
                        max={Math.max(1, effectiveDuration)}
                        step="0.1"
                        value={clamp(currentTime, 0, Math.max(1, effectiveDuration))}
                        style={{ '--audiobook-progress': `${progress * 100}%` }}
                        aria-label={t('duration')}
                        onPointerDown={() => setScrubbing(true)}
                        onChange={event => setCurrentTime(Number(event.target.value))}
                        onPointerUp={event => {
                            setScrubbing(false);
                            seekTo(Number(event.currentTarget.value));
                        }}
                        onPointerCancel={() => {
                            restoreTimeRef.current = Number(audioRef.current?.currentTime) || 0;
                            setScrubbing(false);
                            setCurrentTime(restoreTimeRef.current);
                        }}
                        onKeyUp={event => seekTo(Number(event.currentTarget.value))}
                    />
                    <span>{formatTime(effectiveDuration)}</span>
                </div>

                <div className="audiobook-control-row">
                    <div className="audiobook-volume-control">
                        <button
                            type="button"
                            title={muted ? t('unmute') : t('mute')}
                            aria-label={muted ? t('unmute') : t('mute')}
                            onClick={() => setMuted(current => !current)}
                        >
                            <FaIcon name={muted || volume === 0 ? 'volumeMute' : 'volumeHigh'} size={16} />
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={volume}
                            aria-label={t('volume')}
                            onChange={event => setVolume(clamp(event.target.value, 0, 1))}
                        />
                    </div>

                    <div className="audiobook-primary-controls">
                        <button type="button" title={t('previous')} aria-label={t('previous')} disabled={!session?.adjacent?.hasPrevious || adjacentLoading} onClick={() => moveAdjacent(-1)}>
                            <FaIcon name="backwardStep" size={18} />
                        </button>
                        <button type="button" title={t('rewind', { seconds: skipBackward })} aria-label={t('rewind', { seconds: skipBackward })} onClick={() => skipBy(-skipBackward)}>
                            <FaIcon name="rotateLeft" size={18} />
                            <span>{skipBackward}</span>
                        </button>
                        <button type="button" className="audiobook-play-button" title={playing ? t('pause') : t('play')} aria-label={playing ? t('pause') : t('play')} onClick={togglePlayback}>
                            <FaIcon name={playing ? 'pause' : 'play'} size={22} />
                        </button>
                        <button type="button" title={t('forward', { seconds: skipForward })} aria-label={t('forward', { seconds: skipForward })} onClick={() => skipBy(skipForward)}>
                            <FaIcon name="rotateRight" size={18} />
                            <span>{skipForward}</span>
                        </button>
                        <button type="button" title={t('next')} aria-label={t('next')} disabled={!session?.adjacent?.hasNext || adjacentLoading} onClick={() => moveAdjacent(1)}>
                            <FaIcon name="forwardStep" size={18} />
                        </button>
                    </div>

                    <label className="audiobook-rate-control">
                        <span className="sr-only">{t('settings')}</span>
                        <select value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}>
                            {PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
                        </select>
                    </label>
                </div>

                {(sleepMode !== 'off') && (
                    <div className="audiobook-sleep-status">
                        <FaIcon name="clock" size={13} />
                        <span>{sleepMode === 'end'
                            ? t('endOfTrack')
                            : t('sleepRemaining', { time: formatTime(sleepRemaining) })}</span>
                    </div>
                )}
            </footer>

            {panel && (
                <button type="button" className="audiobook-panel-scrim" aria-label={t('close')} onClick={() => setPanel('')} />
            )}
            {panel && (
                <aside className="audiobook-side-panel" aria-label={t(panel)}>
                    <div className="audiobook-panel-header">
                        <h2>{t(panel)}</h2>
                        <button type="button" aria-label={t('close')} onClick={() => setPanel('')}>
                            <FaIcon name="xmark" size={16} />
                        </button>
                    </div>

                    {panel === 'playlist' && (
                        <div className="audiobook-queue-list">
                            {queue.items.length <= 1 && <p className="audiobook-empty">{t('noQueue')}</p>}
                            {queue.items.map(item => (
                                <button
                                    type="button"
                                    key={`${item.index}-${item.fileName}`}
                                    className={item.current ? 'is-current' : ''}
                                    disabled={item.current || adjacentLoading}
                                    onClick={() => openQueueItem(item.fileName)}
                                >
                                    <span className="audiobook-queue-index">{item.index + 1}</span>
                                    <span className="audiobook-queue-name">{item.title || item.fileName}</span>
                                    {item.current && <span className="audiobook-current-label">{t('currentTrack')}</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    {panel === 'bookmarks' && (
                        <div className="audiobook-bookmark-panel">
                            <button type="button" className="audiobook-add-bookmark" onClick={addBookmark}>
                                <FaIcon name="plus" size={14} />
                                <span>{t('addBookmark')}</span>
                            </button>
                            {bookmarks.length === 0 && <p className="audiobook-empty">{t('noBookmarks')}</p>}
                            <div className="audiobook-bookmark-list">
                                {bookmarks.map(bookmark => (
                                    <div key={bookmark.id}>
                                        <button type="button" onClick={() => seekTo(bookmark.timeSeconds)}>
                                            <span>{bookmark.label}</span>
                                            <time>{formatTime(bookmark.timeSeconds)}</time>
                                        </button>
                                        <button type="button" title={t('delete')} aria-label={t('delete')} onClick={() => deleteBookmark(bookmark.id)}>
                                            <FaIcon name="trash" size={13} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {panel === 'settings' && (
                        <div className="audiobook-settings-panel">
                            <label>
                                <span>{t('skipBackward')}</span>
                                <select value={skipBackward} onChange={event => setSkipBackward(Number(event.target.value))}>
                                    {SKIP_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}
                                </select>
                            </label>
                            <label>
                                <span>{t('skipForward')}</span>
                                <select value={skipForward} onChange={event => setSkipForward(Number(event.target.value))}>
                                    {SKIP_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}
                                </select>
                            </label>
                            <label className="audiobook-checkbox-setting">
                                <input type="checkbox" checked={continuousPlayback} onChange={event => setContinuousPlayback(event.target.checked)} />
                                <span>{t('continuous')}</span>
                            </label>
                            <fieldset>
                                <legend>{t('sleepTimer')}</legend>
                                <div className="audiobook-sleep-options">
                                    <button type="button" className={sleepMode === 'off' ? 'is-active' : ''} onClick={() => setSleepTimer('off')}>{t('off')}</button>
                                    <button type="button" className={sleepMode === 'end' ? 'is-active' : ''} onClick={() => setSleepTimer('end')}>{t('endOfTrack')}</button>
                                    {SLEEP_MINUTES.map(minutes => (
                                        <button type="button" key={minutes} className={sleepMode === String(minutes) ? 'is-active' : ''} onClick={() => setSleepTimer(minutes)}>
                                            {t('minutes', { minutes })}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        </div>
                    )}

                    {panel === 'info' && (
                        <dl className="audiobook-info-list">
                            {infoRows.map(([label, value]) => (
                                <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{value || t('unknown')}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </aside>
            )}
        </div>
    );
}

export { AudiobookViewer };
export default AudiobookViewer;
