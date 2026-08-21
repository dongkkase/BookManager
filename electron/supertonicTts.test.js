import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPcm16WavBuffer,
    detectSupertonicLanguage,
    normalizeSupertonicOptions,
} from './supertonicTts.js';

test('Supertonic 언어 감지는 한국어와 일본어를 우선 판별한다', () => {
    assert.equal(detectSupertonicLanguage('안녕하세요'), 'ko');
    assert.equal(detectSupertonicLanguage('こんにちは'), 'ja');
    assert.equal(detectSupertonicLanguage('Hello'), 'en');
    assert.equal(detectSupertonicLanguage('Hello', 'ko'), 'en');
    assert.equal(detectSupertonicLanguage('Bonjour', 'fr'), 'fr');
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
