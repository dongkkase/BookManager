import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createTtsRequestRegistry } from './ttsRequestRegistry.js';
import { createTtsSynthesisQueue } from './ttsSynthesisQueue.js';

test('TTS 취소는 요청한 창에만 적용하고 마지막 요청 뒤 listener를 해제한다', async () => {
    const registry = createTtsRequestRegistry();
    const left = new EventEmitter();
    const right = new EventEmitter();
    const wait = signal => new Promise(resolve => signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
    const leftTask = registry.run(left, 'same-id', wait);
    let finishRight;
    let rightSignal;
    const rightTask = registry.run(right, 'same-id', signal => {
        rightSignal = signal;
        return new Promise(resolve => { finishRight = resolve; });
    });
    assert.equal(left.listenerCount('destroyed'), 1);
    assert.equal(registry.cancel(left, 'same-id'), true);
    assert.equal(await leftTask, 'cancelled');
    assert.equal(left.listenerCount('destroyed'), 0);
    assert.equal(rightSignal.aborted, false);
    finishRight('done');
    assert.equal(await rightTask, 'done');
    assert.equal(right.listenerCount('destroyed'), 0);
});

test('창 종료는 모든 대기 중 TTS 요청을 취소한다', async () => {
    const registry = createTtsRequestRegistry();
    const sender = new EventEmitter();
    const tasks = Array.from({ length: 20 }, (_, index) => registry.run(sender, String(index), signal => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve(signal.aborted), { once: true });
    })));
    assert.equal(sender.listenerCount('destroyed'), 1);
    sender.emit('destroyed');
    assert.deepEqual(await Promise.all(tasks), Array(20).fill(true));
    assert.equal(sender.listenerCount('destroyed'), 0);
    assert.equal(registry.cancel(sender, '1'), false);
});

test('창을 닫으면 대기 합성을 건너뛰고 다른 창의 합성은 동시 실행 없이 이어진다', async () => {
    const registry = createTtsRequestRegistry();
    const closingSender = new EventEmitter();
    const remainingSender = new EventEmitter();
    let releaseInference;
    const inference = new Promise(resolve => { releaseInference = resolve; });
    const executed = [];
    let active = 0;
    let maximumActive = 0;
    const queue = createTtsSynthesisQueue(async options => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        executed.push(options.id);
        if (options.id === 0) await inference;
        active -= 1;
        return options.id;
    });
    const closingTasks = Array.from({ length: 20 }, (_, id) => registry.run(closingSender, String(id), signal => (
        queue({ id }, { signal })
    )));
    const settled = Promise.allSettled(closingTasks);
    await new Promise(resolve => setImmediate(resolve));
    closingSender.emit('destroyed');
    const results = await settled;
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'TTS_CANCELLED'));
    assert.equal(closingSender.listenerCount('destroyed'), 0);
    const nextTask = registry.run(remainingSender, 'next', signal => queue({ id: 'next' }, { signal }));
    assert.deepEqual(executed, [0]);
    releaseInference();
    assert.equal(await nextTask, 'next');
    assert.deepEqual(executed, [0, 'next']);
    assert.equal(maximumActive, 1);
    assert.equal(remainingSender.listenerCount('destroyed'), 0);
    registry.dispose();
});
