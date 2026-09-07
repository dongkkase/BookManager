import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewerTtsRequests } from './viewerTtsRequests.js';

test('페이지 합성 취소는 현재 IPC를 취소하고 다음 청크 전송을 막는다', async () => {
    let finish;
    const requests = [];
    const cancelledIds = [];
    const group = createViewerTtsRequests(id => cancelledIds.push(id));
    const createSpeech = payload => {
        requests.push(payload);
        return new Promise(resolve => { finish = resolve; });
    };
    const page = (async () => {
        for (const text of ['first', 'second']) await group.run(createSpeech, { text, voice: 'marin' });
    })();
    group.cancel();
    finish({ success: true, dataUrl: 'data:audio/mpeg;base64,AAAA' });
    await assert.rejects(page, { code: 'TTS_CANCELLED' });
    assert.equal(requests.length, 1);
    assert.deepEqual(cancelledIds, [requests[0].requestId]);
    assert.equal(requests[0].voice, 'marin');
});

test('새 페이지는 이전 페이지 취소와 독립적으로 같은 음성 데이터를 받는다', async () => {
    const first = createViewerTtsRequests();
    first.cancel();
    const next = createViewerTtsRequests();
    const expected = { success: true, dataUrl: 'data:audio/wav;base64,AAAA' };
    assert.equal(await next.run(async () => expected, { text: 'next' }), expected);
    await assert.rejects(first.run(async () => expected, {}), { name: 'AbortError' });
});
