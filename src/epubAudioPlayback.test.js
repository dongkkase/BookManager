import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpubAudioPlayback, normalizeEpubAudioPlaylist } from './epubAudioPlayback.js';

const track = (id, overrides = {}) => ({ id, kind: 'inline', title: id, sources: [{ src: `bookmanager-document://session/id/asset/${id}.mp3`, type: 'audio/mpeg' }], clipBegin: 0, clipEnd: null, ...overrides });
const flush = () => Promise.resolve().then(() => Promise.resolve());

function harness(options = {}) {
    let clock = 0;
    let nextId = 0;
    const frames = new Map();
    const audios = [];
    const states = [];
    let nextPlayback;
    const controller = createEpubAudioPlayback({
        ...options,
        now: () => clock,
        requestFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
        cancelFrame: id => frames.delete(id),
        onStateChange: value => states.push(value),
        createAudio() {
            const listeners = new Map();
            const audio = {
                paused: true,
                duration: 30,
                currentTime: 0,
                readyState: 1,
                src: '',
                volume: 1,
                muted: false,
                playCount: 0,
                pauseCount: 0,
                loadCount: 0,
                play() {
                    this.playCount += 1;
                    this.paused = false;
                    const promise = nextPlayback || Promise.resolve();
                    nextPlayback = null;
                    return promise;
                },
                pause() { this.paused = true; this.pauseCount += 1; },
                load() { this.loadCount += 1; },
                removeAttribute(name) { if (name === 'src') this.src = ''; },
                canPlayType(type) { return type === 'audio/mpeg' ? 'probably' : ''; },
                addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
                removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
                dispatch(type) { [...(listeners.get(type) || [])].forEach(listener => listener()); },
                listenerCount: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
            };
            audios.push(audio);
            return audio;
        },
    });
    return {
        controller, audios, states, frames,
        setNextPlayback: promise => { nextPlayback = promise; },
        step(milliseconds) {
            clock += milliseconds;
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback(clock));
        },
        state: () => controller.getState(),
    };
}

test('audio playlists remove missing resources and invalid clips while normalizing defaults', () => {
    assert.equal(normalizeEpubAudioPlaylist([{}, track('a'), track('bad', { clipBegin: 5, clipEnd: 4 })]).length, 1);
    assert.equal(normalizeEpubAudioPlaylist([track('a', { clipBegin: -5 })])[0].clipBegin, 0);
    assert.equal(normalizeEpubAudioPlaylist([track('a', { clipBegin: Infinity })])[0].clipBegin, 0);
});

test('entering an audio page fades in once and identical rerenders or shared cues keep playback', async () => {
    const h = harness({ volume: 0.8 });
    h.controller.setPlaylist([track('a')], { key: 'page-1' });
    await flush();
    assert.equal(h.audios[0].volume, 0);
    h.step(200);
    assert.ok(Math.abs(h.audios[0].volume - 0.4) < 0.001);
    h.step(200);
    assert.equal(h.audios[0].volume, 0.8);
    h.audios[0].currentTime = 12;
    h.controller.setPlaylist([track('a')], { key: 'page-1' });
    h.controller.setPlaylist([track('a')], { key: 'page-2' });
    assert.equal(h.audios.length, 1);
    assert.equal(h.audios[0].playCount, 1);
    assert.equal(h.audios[0].currentTime, 12);
    h.controller.dispose();
});

test('page changes crossfade and an empty playlist fades out before releasing the source', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();h.step(400);
    h.controller.setPlaylist([track('b')], { key: 2 });await flush();
    assert.equal(h.audios[0].paused, false);
    assert.equal(h.audios[1].volume, 0);
    h.step(200);
    assert.equal(h.audios[0].volume, 0.5);
    assert.equal(h.audios[1].volume, 0.5);
    h.step(200);
    assert.equal(h.audios[0].paused, true);
    assert.equal(h.audios[0].src, '');
    h.controller.setPlaylist([], { key: 3 });
    assert.equal(h.state().status, 'idle');
    assert.equal(h.audios[1].paused, false);
    h.step(400);
    assert.equal(h.audios[1].paused, true);
    assert.equal(h.frames.size, 0);
});

test('late play promises cannot revive audio after rapid navigation or disposal', async () => {
    const h = harness();
    let resolve;
    h.setNextPlayback(new Promise(done => { resolve = done; }));
    h.controller.setPlaylist([track('a')], { key: 1 });
    h.controller.setPlaylist([track('b')], { key: 2 });await flush();
    resolve();await flush();
    assert.equal(h.audios[0].paused, true);
    assert.equal(h.state().currentTrack.id, 'b');
    h.controller.dispose();
    assert.ok(h.audios.every(audio => audio.paused && !audio.src && audio.listenerCount() === 0));
    assert.equal(h.frames.size, 0);
});

test('manual pause fades naturally, survives page changes for a session, and resumes only by request', async () => {
    const h = harness({ pauseScope: 'session' });
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();h.step(400);
    h.controller.pause();
    assert.equal(h.state().manualPaused, true);
    assert.equal(h.audios[0].paused, false);
    h.step(400);
    assert.equal(h.audios[0].paused, true);
    h.controller.setPlaylist([track('b')], { key: 2 });
    assert.equal(h.audios.length, 1);
    h.controller.setSuspended(true);h.controller.setSuspended(false);
    assert.equal(h.audios.length, 1);
    h.controller.resume();await flush();
    assert.equal(h.state().status, 'playing');
    assert.equal(h.state().currentTrack.id, 'b');
    h.controller.dispose();
});

test('automatic resume cancels an unfinished disabled fade and preserves the playback position', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();h.step(400);
    h.audios[0].currentTime = 6;
    h.controller.setEnabled(false);h.step(150);
    h.controller.setEnabled(true);await flush();h.step(400);
    assert.equal(h.audios[0].paused, false);
    assert.equal(h.audios[0].volume, 1);
    assert.equal(h.audios[0].currentTime, 6);
    assert.equal(h.audios.length, 1);
    h.controller.setSuspended(true);
    assert.equal(h.audios[0].paused, true);
    h.controller.setSuspended(false);await flush();
    assert.equal(h.state().status, 'playing');
    h.controller.dispose();
});

test('autoplay denial is reported once and manual resume retries the same audio', async () => {
    const h = harness();
    h.setNextPlayback(Promise.reject(Object.assign(new Error('User gesture required'), { name: 'NotAllowedError' })));
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();
    assert.equal(h.state().status, 'blocked');
    h.controller.setPlaylist([track('a')], { key: 1 });
    assert.equal(h.audios[0].playCount, 1);
    h.controller.setSuspended(true);h.controller.setSuspended(false);
    assert.equal(h.state().status, 'blocked');
    assert.equal(h.audios[0].playCount, 1);
    h.controller.resume();await flush();h.step(400);
    assert.equal(h.state().status, 'playing');
    assert.equal(h.audios[0].playCount, 2);
    h.controller.dispose();
});

test('clip boundaries fade before the end, advance the page playlist, and do not restart ended pages', async () => {
    const h = harness();
    const tracks = [track('a', { clipBegin: 2, clipEnd: 3 }), track('b', { clipBegin: 5, clipEnd: 6 })];
    h.controller.setPlaylist(tracks, { key: 1 });await flush();h.step(400);
    assert.equal(h.audios[0].currentTime, 2);
    h.audios[0].currentTime = 2.8;h.step(1);h.step(100);
    assert.ok(h.audios[0].volume < 0.6);
    h.audios[0].currentTime = 3.1;h.audios[0].dispatch('timeupdate');await flush();
    assert.equal(h.audios[0].currentTime, 3);
    assert.equal(h.audios[0].paused, true);
    assert.equal(h.state().currentTrack.id, 'b');
    assert.equal(h.audios[1].currentTime, 5);
    h.audios[1].currentTime = 6;h.audios[1].dispatch('timeupdate');
    assert.equal(h.state().status, 'ended');
    h.controller.setPlaylist(tracks, { key: 1 });
    assert.equal(h.audios.length, 2);
    h.controller.resume();await flush();
    assert.equal(h.audios.length, 3);
    assert.equal(h.audios[2].currentTime, 2);
    h.controller.dispose();
});

test('explicit loops return to the clip beginning and selecting a track starts at that cue', async () => {
    const h = harness();
    h.controller.setPlaylist([track('loop', { clipBegin: 1, clipEnd: 2, loop: true }), track('b', { clipBegin: 4 })], { key: 1 });await flush();
    h.audios[0].currentTime = 2;h.audios[0].dispatch('timeupdate');await flush();
    assert.equal(h.audios.length, 1);
    assert.equal(h.audios[0].currentTime, 1);
    h.controller.playTrack('b');await flush();
    assert.equal(h.state().currentTrack.id, 'b');
    assert.equal(h.audios[1].currentTime, 4);
    h.controller.dispose();
});

test('newly visible cues on the same page do not replay cues that already ended', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a', { clipEnd: 1 })], { key: 1 });await flush();
    h.audios[0].currentTime = 1;h.audios[0].dispatch('timeupdate');
    assert.equal(h.state().status, 'ended');
    h.controller.setPlaylist([track('a', { clipEnd: 1 }), track('b', { clipEnd: 2 })], { key: 1 });await flush();
    assert.equal(h.state().currentTrack.id, 'b');
    assert.equal(h.audios.length, 2);
    h.audios[1].currentTime = 2;h.audios[1].dispatch('timeupdate');
    h.controller.setPlaylist([track('a', { clipEnd: 1 })], { key: 1 });
    assert.equal(h.state().status, 'ended');
    assert.equal(h.audios.length, 2);
    h.controller.dispose();
});

test('completed scroll cues replay after leaving the viewport while continuously visible cues stay completed', async () => {
    const h = harness();
    const a = track('a', { clipEnd: 1 });
    const b = track('b', { clipEnd: 2 });
    h.controller.setPlaylist([a], { key: 'scroll' });await flush();
    h.audios[0].currentTime = 1;h.audios[0].dispatch('timeupdate');
    h.controller.setPlaylist([a, b], { key: 'scroll' });await flush();
    assert.equal(h.state().currentTrack.id, 'b');
    h.controller.setPlaylist([b], { key: 'scroll' });
    h.controller.setPlaylist([a, b], { key: 'scroll' });
    assert.equal(h.audios.length, 2);
    assert.equal(h.audios[1].playCount, 1);
    h.audios[1].currentTime = 2;h.audios[1].dispatch('timeupdate');await flush();
    assert.equal(h.state().currentTrack.id, 'a');
    assert.equal(h.audios.length, 3);
    h.audios[2].currentTime = 1;h.audios[2].dispatch('timeupdate');
    h.controller.setPlaylist([a, b], { key: 'scroll' });
    assert.equal(h.state().status, 'ended');
    assert.equal(h.audios.length, 3);
    h.controller.dispose();
});

test('an empty scroll viewport resets completion only and honors a session manual pause on reentry', async () => {
    const h = harness({ pauseScope: 'session' });
    const a = track('a', { clipEnd: 1 });
    h.controller.setPlaylist([a], { key: 'scroll' });await flush();
    h.audios[0].currentTime = 1;h.audios[0].dispatch('timeupdate');
    h.controller.setPlaylist([], { key: 'scroll' });
    h.controller.setPlaylist([a], { key: 'scroll' });await flush();
    assert.equal(h.audios.length, 2);
    assert.equal(h.state().status, 'playing');
    h.controller.pause();
    h.controller.setPlaylist([], { key: 'scroll' });
    h.controller.setPlaylist([a], { key: 'scroll' });
    assert.equal(h.audios.length, 2);
    assert.equal(h.state().manualPaused, true);
    assert.equal(h.state().status, 'paused');
    h.controller.dispose();
});

test('a cue that returns during fade-out resumes the same audio without duplicate playback', async () => {
    const h = harness();
    const a = track('a');
    h.controller.setPlaylist([a], { key: 'scroll' });await flush();h.step(400);
    h.audios[0].currentTime = 4;
    h.controller.setPlaylist([], { key: 'scroll' });h.step(100);
    h.controller.setPlaylist([a], { key: 'scroll' });await flush();h.step(400);
    assert.equal(h.audios.length, 1);
    assert.equal(h.audios[0].currentTime, 4);
    assert.equal(h.audios[0].paused, false);
    assert.equal(h.audios[0].volume, 1);
    h.controller.dispose();
});

test('leaving a cue near its clip end limits the outgoing fade to the remaining clip', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a', { clipEnd: 2 })], { key: 'scroll' });await flush();h.step(400);
    h.audios[0].currentTime = 1.9;
    h.controller.setPlaylist([], { key: 'scroll' });h.step(101);
    assert.equal(h.audios[0].paused, true);
    assert.equal(h.audios[0].src, '');
    assert.equal(h.frames.size, 0);
});

test('manual track selection plays from the selected cue forward without returning to skipped cues', async () => {
    const h = harness({ autoplay: false });
    h.controller.setPlaylist([track('a'), track('b', { clipEnd: 1 }), track('c', { clipEnd: 2 })], { key: 'scroll', autoplay: false });
    h.controller.playTrack('b');await flush();
    h.audios[0].currentTime = 1;h.audios[0].dispatch('timeupdate');await flush();
    assert.equal(h.state().currentTrack.id, 'c');
    h.audios[1].currentTime = 2;h.audios[1].dispatch('timeupdate');
    assert.equal(h.state().status, 'ended');
    assert.equal(h.audios.length, 2);
    h.controller.dispose();
});

test('short narration clips reserve time for both fade-in and fade-out instead of staying silent', async () => {
    const h = harness();
    h.controller.setPlaylist([track('short', { clipEnd: 0.2 })], { key: 1 });await flush();
    h.audios[0].currentTime = 0.05;h.step(50);
    assert.ok(Math.abs(h.audios[0].volume - 0.5) < 0.001);
    h.audios[0].currentTime = 0.1;h.step(50);
    assert.equal(h.audios[0].volume, 1);
    h.audios[0].currentTime = 0.15;h.step(50);
    assert.ok(Math.abs(h.audios[0].volume - 0.5) < 0.001);
    h.audios[0].currentTime = 0.2;h.step(50);
    assert.equal(h.state().status, 'ended');
    assert.equal(h.audios[0].paused, true);
});

test('volume and mute update active fades and stopping immediately clears all sound and resources', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();h.step(200);
    h.controller.setVolume(0.2);
    assert.equal(h.audios[0].volume, 0.1);
    h.controller.setMuted(true);
    assert.equal(h.audios[0].muted, true);
    h.controller.setPlaylist([track('b')], { key: 2 });await flush();
    h.controller.stop();
    assert.ok(h.audios.every(audio => audio.paused && !audio.src));
    assert.equal(h.frames.size, 0);
    assert.equal(h.state().status, 'paused');
});

test('rapidly crossing another page preserves the audible outgoing fade until it finishes', async () => {
    const h = harness();
    h.controller.setPlaylist([track('a')], { key: 1 });await flush();h.step(400);
    h.controller.setPlaylist([track('b')], { key: 2 });await flush();
    h.controller.setPlaylist([track('c')], { key: 3 });await flush();
    assert.equal(h.audios[0].paused, false);
    assert.equal(h.audios[1].paused, true);
    h.step(200);
    assert.equal(h.audios[0].volume, 0.5);
    h.step(200);
    assert.equal(h.audios[0].paused, true);
    assert.equal(h.audios[2].paused, false);
    h.controller.dispose();
});

test('disabled autoplay waits for manual play, and unsupported sources fall back', async () => {
    const h = harness({ autoplay: false });
    h.controller.setPlaylist([track('a', { sources: [{ src: 'bad.mp3', type: 'audio/mpeg' }, { src: 'good.ogg', type: 'audio/ogg' }] })], { key: 1, autoplay: false });
    assert.equal(h.audios.length, 0);
    h.setNextPlayback(Promise.reject(Object.assign(new Error('Codec not supported'), { name: 'NotSupportedError' })));
    h.controller.resume();await flush();await flush();
    assert.equal(h.audios[0].src, 'good.ogg');
    assert.equal(h.state().status, 'playing');
    h.controller.dispose();
});
