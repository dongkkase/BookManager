import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { runTextCleanerSearchJob } from './textCleanerSearchJob.js';

function createWorker() {
    const moduleUrl = new URL('./workers/textCleanerSearchWorker.js', import.meta.url).href;
    const worker = new Worker(`
        const { parentPort } = require('node:worker_threads');
        global.self = { postMessage: data => parentPort.postMessage(data) };
        import(${JSON.stringify(moduleUrl)}).then(() => {
            parentPort.on('message', data => self.onmessage({ data }));
        });
    `, { eval: true });
    const adapter = {
        postMessage: data => worker.postMessage(data),
        terminate: () => worker.terminate(),
    };
    worker.on('message', data => adapter.onmessage?.({ data }));
    worker.on('error', error => adapter.onerror?.(error));
    return adapter;
}

test('검색과 바꾸기는 워커에서 옵션을 적용하고 오류를 반환한다', async () => {
    const options = { createWorker };
    const result = await runTextCleanerSearchJob({ text: 'cat CAT', query: 'cat', options: {} }, options);
    assert.equal(result.totalCount, 2);
    const replaced = await runTextCleanerSearchJob({ type: 'replace', text: 'cat CAT', query: 'cat', replacement: 'dog', options: { preserveCase: true }, all: true }, options);
    assert.equal(replaced.change.insert, 'dog DOG');
    await assert.rejects(runTextCleanerSearchJob({ text: 'cat', query: '[', options: { regex: true } }, options), { code: 'invalid_regex' });
});

test('새 입력으로 취소된 작업은 이전 결과를 전달하지 않는다', async () => {
    const controller = new AbortController();
    const result = runTextCleanerSearchJob({ text: 'a', query: 'a' }, { createWorker, signal: controller.signal });
    controller.abort();
    await assert.rejects(result, { code: 'cancelled' });
});

test('오래 걸리는 정규식은 워커를 종료하고 시간 초과를 알린다', async () => {
    await assert.rejects(runTextCleanerSearchJob({
        text: 'a'.repeat(10000) + '!', query: '(a+)+$', options: { regex: true },
    }, { createWorker, timeoutMs: 100 }), { code: 'search_timeout' });
});
