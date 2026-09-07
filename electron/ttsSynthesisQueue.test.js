import assert from 'node:assert/strict';
import test from 'node:test';
import { createTtsSynthesisQueue } from './ttsSynthesisQueue.js';
import { createSupertonicTtsDataUrl } from './supertonicTts.js';

test('취소한 대기 TTS는 즉시 종료하고 합성 순서를 유지하며 실행하지 않는다', async () => {
    let releaseFirst;
    const firstReady = new Promise(resolve => { releaseFirst = resolve; });
    const executed = [];
    const queue = createTtsSynthesisQueue(async options => {
        executed.push(options.id);
        if (options.id === 1) await firstReady;
        return options.id;
    });
    const first = queue({ id: 1 });
    const controller = new AbortController();
    const cancelled = queue({ id: 2 }, { signal: controller.signal });
    const third = queue({ id: 3 });
    controller.abort();
    await assert.rejects(cancelled, { code: 'TTS_CANCELLED' });
    assert.deepEqual(executed, [1]);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, third]), [1, 3]);
    assert.deepEqual(executed, [1, 3]);
});

test('이미 취소한 Supertonic 요청은 모델 파일을 열지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(createSupertonicTtsDataUrl({ text: '읽지 않는 내용' }, {
        modelDir: '/nonexistent-cancelled-model',
        signal: controller.signal,
    }), { code: 'TTS_CANCELLED' });
});
