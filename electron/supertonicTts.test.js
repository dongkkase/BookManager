import assert from 'node:assert/strict';
import test from 'node:test';
import { planSupertonicSpeech, splitSupertonicRequests } from './supertonicReading.js';

import {
    createPcm16WavBuffer,
    detectSupertonicLanguage,
    normalizeSupertonicOptions,
    renderSupertonicSpeech,
} from './supertonicTts.js';

test('Supertonic 언어 감지는 한국어와 일본어를 우선 판별한다', () => {
    assert.equal(detectSupertonicLanguage('안녕하세요'), 'ko');
    assert.equal(detectSupertonicLanguage('こんにちは'), 'ja');
    assert.equal(detectSupertonicLanguage('Hello'), 'en');
    assert.equal(detectSupertonicLanguage('Hello', 'ko'), 'en');
    assert.equal(detectSupertonicLanguage('Bonjour', 'fr'), 'fr');
});

test('Supertonic 출력은 초과 피크를 잘라내지 않고 비율을 유지하여 감쇠한다', () => {
    const wav = createPcm16WavBuffer(Float32Array.from([0, 0.5, 1, 2, -2, NaN, Infinity]), 24000);
    const samples = Array.from({ length: 7 }, (_, index) => wav.readInt16LE(44 + index * 2));
    assert.deepEqual(samples, [0, 8028, 16056, 32112, -32112, 0, 0]);
    const normal = createPcm16WavBuffer(Float32Array.from([0, 0.5, -0.5]), 24000);
    assert.equal(normal.readInt16LE(46), 16384);
});

test('구간별 합성은 지정한 쉼과 비명 길이 음량 제한을 적용한다', async () => {
    const calls = [];
    const plan = [
        { text: '본문', voice: 'M1', volume: 1, pause: 0.3 },
        { text: '아악', voice: 'F1', volume: 0.5, pause: 0.1, effect: true, maxSeconds: 0.5 },
    ];
    const result = await renderSupertonicSpeech(plan, async segment => {
        calls.push(segment.voice);
        return { wav: new Float32Array(segment.effect ? 2000 : 1000).fill(0.8) };
    }, 1000);
    assert.deepEqual(calls, ['M1', 'F1']);
    assert.equal(result.duration, 1.8);
    assert.ok(result.wav.slice(1000, 1300).every(value => value === 0));
    assert.ok(Math.abs(result.wav[1500] - 0.4) < 1e-6);
    assert.equal(result.wav.at(-1), 0);
    assert.equal((await renderSupertonicSpeech([], () => assert.fail(), 1000)).duration, 0.05);
});

test('구간을 합성하다 취소하면 다음 구간을 합성하지 않는다', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(renderSupertonicSpeech([{ text: '첫째' }, { text: '둘째' }], async () => {
        calls += 1;
        controller.abort();
        return { wav: new Float32Array(100) };
    }, 1000, controller.signal), { code: 'TTS_CANCELLED' });
    assert.equal(calls, 1);
});

test('이어지는 대사 사이의 무음은 합성 요청 경계를 넘어도 한 번만 들어간다', async () => {
    const text = '“내 잘못 아니라 했잖냐. 적당히 해라.”\n\n“차장님, 이거 놓으세요. 이 새끼가 진짜!”';
    const synthesize = async () => ({ wav: new Float32Array(1000).fill(0.5) });
    const result = await renderSupertonicSpeech(planSupertonicSpeech(text), synthesize, 1000);
    assert.equal(result.duration, 2.9);
    assert.ok(result.wav.slice(1000, 1450).every(value => value === 0));
    assert.ok(result.wav[1500] > 0);
    const requests = splitSupertonicRequests(text, 32);
    assert.equal(requests.length, 2);
    const parts = [];
    for (const request of requests) {
        parts.push(...(await renderSupertonicSpeech(planSupertonicSpeech(request), synthesize, 1000)).wav);
    }
    assert.deepEqual(Float32Array.from(parts), result.wav);
    const disabled = await renderSupertonicSpeech(planSupertonicSpeech(text, { dialogueEnabled: false }), synthesize, 1000);
    assert.equal(disabled.duration, 1);
});

test('비명 고음 완화는 높은 주파수를 줄이며 비활성 상태에서는 원래 파형을 유지한다', async () => {
    const sampleRate = 44100;
    const energy = wav => wav.slice(5000, 15000).reduce((sum, value) => sum + value * value, 0);
    const render = async (frequency, soften) => renderSupertonicSpeech(
        [{ volume: 1, pause: 0, effect: true, soften }],
        async () => ({ wav: Float32Array.from({ length: 20000 }, (_, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate) * 0.5) }),
        sampleRate,
    );
    const high = energy((await render(12000, false)).wav);
    const low = energy((await render(1000, false)).wav);
    assert.ok(energy((await render(12000, true)).wav) < high * 0.1);
    assert.ok(energy((await render(1000, true)).wav) > low * 0.8);
});

test('Supertonic 합성 옵션은 음성, 언어, 속도와 추론 단계를 정규화한다', () => {
    assert.deepEqual(normalizeSupertonicOptions({
        text: '  안녕하세요.  ',
        voice: 'f3',
        lang: 'ko',
        speed: 9,
        totalStep: 1,
    }), {
        text: '안녕하세요.',
        voice: 'F3',
        lang: 'ko',
        speed: 2,
        totalStep: 2,
    });
    assert.equal(normalizeSupertonicOptions({ text: 'Hello', voice: 'unknown' }).voice, 'M1');
    assert.throws(() => normalizeSupertonicOptions({ text: '' }), error => error.code === 'SUPERTONIC_NO_TEXT');
});

test('Supertonic PCM 출력은 재생 가능한 16비트 mono WAV 헤더를 만든다', () => {
    const wav = createPcm16WavBuffer(new Float32Array([-1, 0, 0.5, 1]), 24000);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), 8);
    assert.equal(wav.length, 52);
});
