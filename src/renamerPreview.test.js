import assert from 'node:assert/strict';
import test from 'node:test';
import { trackRenamerPreview, waitForRenamerPreviews } from './utils/renamerPreview.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

test('미리보기 완료 결과를 유지하고 대기 목록에서 제거한다', async () => {
    const pending = new Set();
    const preview = deferred();
    const tracked = trackRenamerPreview(pending, preview.promise);
    assert.equal(pending.size, 1);
    preview.resolve({ success: true, dataUrl: 'data:image/png;base64,image' });
    assert.deepEqual(await tracked, { success: true, dataUrl: 'data:image/png;base64,image' });
    assert.equal(pending.size, 0);
});

test('모든 미리보기가 끝날 때까지 기다리고 실패한 요청도 정리한다', async () => {
    const pending = new Set();
    const first = deferred();
    const second = deferred();
    const firstTracked = trackRenamerPreview(pending, first.promise);
    const secondTracked = trackRenamerPreview(pending, second.promise);
    const failure = new Error('Preview failed');
    const rejected = assert.rejects(secondTracked, error => error === failure);
    let ready = false;
    const waiting = waitForRenamerPreviews(pending).then(value => { ready = value; });

    first.resolve('first');
    await firstTracked;
    assert.equal(ready, false);
    assert.equal(pending.size, 1);

    second.reject(failure);
    await rejected;
    await waiting;
    assert.equal(ready, true);
    assert.equal(pending.size, 0);
});

test('응답 없는 미리보기 대기를 즉시 취소하며 뒤늦은 완료로 저장을 시작하지 않는다', async () => {
    const pending = new Set();
    const preview = deferred();
    const tracked = trackRenamerPreview(pending, preview.promise);
    const controller = new AbortController();
    let executions = 0;
    const waiting = waitForRenamerPreviews(pending, controller.signal).then(ready => {
        if (ready) executions += 1;
        return ready;
    });
    controller.abort();
    assert.equal(await waiting, false);
    assert.equal(pending.size, 1);

    preview.resolve('late preview');
    await tracked;
    assert.equal(executions, 0);
    assert.equal(pending.size, 0);
});

test('취소 뒤 다음 실행은 아직 남은 미리보기를 다시 기다린다', async () => {
    const pending = new Set();
    const preview = deferred();
    const tracked = trackRenamerPreview(pending, preview.promise);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await waitForRenamerPreviews(pending, controller.signal), false);

    const waiting = waitForRenamerPreviews(pending);
    preview.resolve('finished');
    await tracked;
    assert.equal(await waiting, true);
});

test('진행 중인 미리보기가 없으면 바로 실행 가능하고 이미 취소됐으면 실행하지 않는다', async () => {
    assert.equal(await waitForRenamerPreviews(new Set()), true);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await waitForRenamerPreviews(new Set(), controller.signal), false);
});
