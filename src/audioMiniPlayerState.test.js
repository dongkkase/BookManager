import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampAudioMiniPlayerSeek,
    initialAudioMiniPlayerState,
    reduceAudioMiniPlayerState,
} from './audioMiniPlayerState.js';

test('미니플레이어 초기 조회 결과를 표시 상태로 정규화한다', () => {
    const state = initialAudioMiniPlayerState({
        visible: true,
        sessionId: 'audio-1',
        title: '제목',
        artist: '작가',
        artwork: 'data:image/png;base64,cover',
        currentTime: 65,
        duration: 300,
        playing: true,
    });

    assert.deepEqual(state, {
        visible: true,
        sessionId: 'audio-1',
        title: '제목',
        artist: '작가',
        artwork: 'data:image/png;base64,cover',
        fileName: '',
        currentTime: 65,
        duration: 300,
        playing: true,
        playbackRate: 1,
        volume: 1,
        muted: false,
    });
});

test('트랙과 재생 이벤트는 현재 상태를 순서대로 병합한다', () => {
    const shown = initialAudioMiniPlayerState({
        visible: true,
        sessionId: 'audio-1',
        title: '첫 트랙',
        currentTime: 10,
        duration: 100,
        playing: true,
    });
    const track = reduceAudioMiniPlayerState(shown, {
        type: 'track',
        sessionId: 'audio-2',
        title: '두 번째 트랙',
        artist: '낭독자',
    });
    const playback = reduceAudioMiniPlayerState(track, {
        type: 'playback',
        currentTime: 25,
        duration: 200,
        playing: false,
    });

    assert.equal(track.title, '두 번째 트랙');
    assert.equal(track.currentTime, 0);
    assert.equal(playback.artist, '낭독자');
    assert.equal(playback.currentTime, 25);
    assert.equal(playback.duration, 200);
    assert.equal(playback.playing, false);
});

test('clear 이벤트와 비표시 조회 결과는 미니플레이어를 제거한다', () => {
    const shown = initialAudioMiniPlayerState({ visible: true, title: '제목' });

    assert.equal(reduceAudioMiniPlayerState(shown, { type: 'clear', visible: false }), null);
    assert.equal(initialAudioMiniPlayerState({ type: 'clear', visible: false }), null);
    assert.equal(reduceAudioMiniPlayerState(null, { type: 'playback', currentTime: 10 }), null);
});

test('탐색 위치는 재생 시간 범위로 제한한다', () => {
    assert.equal(clampAudioMiniPlayerSeek(-10, 100), 0);
    assert.equal(clampAudioMiniPlayerSeek(40, 100), 40);
    assert.equal(clampAudioMiniPlayerSeek(120, 100), 100);
    assert.equal(clampAudioMiniPlayerSeek(40, 0), 40);
});
