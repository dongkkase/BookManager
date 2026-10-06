import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reportViewerTtsUsage } from './viewerTtsTelemetry.js';

const source = readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

function section(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source section: ${start}`);
    return source.slice(startIndex, endIndex);
}

function targetWithEvents() {
    const events = [];
    return { events, target: { viewerAPI: { reportTtsUsage: payload => events.push(payload) } } };
}

test('TTS 통계는 허용 모델만 전달하고 텍스트와 음성 이름을 제외한다', () => {
    const { events, target } = targetWithEvents();
    for (const [engine, model] of [
        ['system', 'system'], ['supertonic', 'supertonic-3'], ['google', 'google-cloud-default'],
        ['openai', 'gpt-4o-mini-tts'], ['openai', 'tts-1'],
    ]) {
        assert.equal(reportViewerTtsUsage({ sessionId: 'book-session', engine, model, text: 'Private text', voice: 'Private voice' }, target), true);
        assert.deepEqual(events.at(-1), { sessionId: 'book-session', engine, model });
    }
    for (const payload of [
        { sessionId: 'book-session', engine: 'openai', model: 'Private model' },
        { sessionId: 'book-session', engine: 'openai' },
        { sessionId: 'book-session', engine: 'Private engine' },
        { sessionId: '', engine: 'system' },
    ]) assert.equal(reportViewerTtsUsage(payload, target), false);
    assert.equal(events.length, 5);
});

test('통계 브리지의 부재와 예외는 낭독에 영향을 주지 않는다', async () => {
    const payload = { sessionId: 'book-session', engine: 'system' };
    assert.equal(reportViewerTtsUsage(payload, {}), false);
    assert.equal(reportViewerTtsUsage(payload, { viewerAPI: { reportTtsUsage() { throw new Error('Closed'); } } }), false);
    assert.equal(reportViewerTtsUsage(payload, { viewerAPI: { reportTtsUsage() { return Promise.reject(new Error('Closed')); } } }), true);
    await new Promise(resolve => setImmediate(resolve));
});

test('시스템 낭독은 시작 콜백에서 보고하고 편집기 미리보기는 제외한다', () => {
    const events = [];
    const optionsFor = Function('reportViewerTtsUsage', 'engine', 'sessionPreview', `
        const useCallback = callback => callback;
        const sessionId = 'book-session';
        const settings = { engine, rate: 1 };
        const speechText = 'body';
        const selectedVoice = null;
        const language = 'ko';
        let options;
        const useTts = value => { options = value; return {}; };
        ${section('const reportTtsUsage =', 'const voices = state.voices')}
        return options;
    `);
    for (const [engine, preview] of [['system', false], ['system', true], ['openai', false]]) {
        const options = optionsFor(payload => events.push(payload), engine, preview);
        options.onStart();
    }
    assert.deepEqual(events, [{ sessionId: 'book-session', engine: 'system', model: undefined }]);
});

function playbackHarness() {
    const { events, target } = targetWithEvents();
    let audio;
    let start;
    let fail;
    class Audio {
        constructor() { audio = this; }
        play() { return new Promise((resolve, reject) => { start = resolve; fail = reject; }); }
    }
    const harness = Function('Audio', 'reportViewerTtsUsage', 'target', `
        const useCallback = callback => callback;
        const openAiRunRef = { current: 1 };
        const openAiAudioRef = { current: null };
        const openAiPlaybackCancelRef = { current: null };
        const ttsRateRef = { current: 1 };
        const setOpenAiState = () => {};
        const applyTtsAudioPlaybackRate = () => {};
        const remoteTtsCode = (engine, code) => engine + code;
        const reportTtsUsage = (engine, model) => reportViewerTtsUsage({ sessionId: 'book-session', engine, model }, target);
        ${section('const playOpenAiAudioDataUrl =', 'const openAiTtsErrorMessage =')}
        return { play: playOpenAiAudioDataUrl, run: openAiRunRef, cancel: () => openAiPlaybackCancelRef.current?.() };
    `)(Audio, reportViewerTtsUsage, target);
    return { ...harness, events, start: () => start(), fail: () => fail(new Error('Playback failed')), audio: () => audio };
}

test('원격 낭독은 실제 폴백 모델을 보고하고 재개 신호도 메인의 동의 검사로 전달한다', async () => {
    const h = playbackHarness();
    const playing = h.play('data:audio/mpeg;base64,fixture', 1, 'openai', 'tts-1');
    assert.deepEqual(h.events, []);
    h.audio().onplaying();
    h.start();
    await Promise.resolve();
    assert.equal(h.events.length, 2);
    h.audio().onpause();
    h.audio().onplaying();
    assert.deepEqual(h.events, Array.from({ length: 3 }, () => ({ sessionId: 'book-session', engine: 'openai', model: 'tts-1' })));
    h.audio().onended();
    assert.equal(await playing, 'ended');
});

test('재생 거부와 시작 전 취소 및 만료된 낭독은 통계를 보내지 않는다', async () => {
    for (const scenario of ['failure', 'cancelled', 'stale']) {
        const h = playbackHarness();
        const playing = h.play('fixture', 1, 'openai', 'gpt-4o-mini-tts');
        if (scenario === 'failure') {
            const rejected = assert.rejects(playing, /Playback failed/);
            h.fail();
            await rejected;
        } else {
            if (scenario === 'stale') h.run.current = 2;
            else h.cancel();
            h.start();
            await Promise.resolve();
            if (scenario === 'stale') h.cancel();
            assert.equal(await playing, 'cancelled');
        }
        assert.deepEqual(h.events, []);
    }
});

test('선택 영역 낭독은 실제 재생된 각 청크의 모델을 전달하고 미리 듣기는 제외한다', async () => {
    const models = [];
    const starts = [];
    const errors = [];
    const createSpeech = async text => ({ success: true, dataUrl: text, model: text === 'first' ? 'gpt-4o-mini-tts' : 'tts-1' });
    const speak = Function('createSpeech', `
        let detachedRemoteTtsToken = 0;
        let detachedRemoteTtsRequests;
        const window = { viewerAPI: {} };
        const getRemoteTtsApi = () => createSpeech;
        const splitTtsTextIntoChunks = () => ['first', 'second'];
        const remoteTtsMaxInputLength = () => 4000;
        const remoteTtsPayload = (_engine, text) => text;
        const stopDetachedRemoteTtsAudio = () => {};
        const createViewerTtsRequests = () => ({ run: (api, payload) => api(payload) });
        const playDetachedRemoteTtsAudio = async (_data, _token, _engine, _rate, onStart) => { onStart(); return 'ended'; };
        const remoteTtsToastMessage = error => error.message;
        ${section('async function speakDetachedRemoteTts(', 'function readerItemTtsText(')}
        return speakDetachedRemoteTts;
    `)(createSpeech);
    await speak('body', { engine: 'openai' }, error => errors.push(error), 'ko', () => starts.push(true), () => true, true, model => models.push(model));
    assert.deepEqual(models, ['gpt-4o-mini-tts', 'tts-1']);
    assert.equal(starts.length, 1);
    await speak('preview', { engine: 'openai' }, error => errors.push(error), 'ko');
    assert.equal(models.length, 2);
    assert.deepEqual(errors, []);
});
