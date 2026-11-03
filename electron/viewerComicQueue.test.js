import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewerComicPageCache, ViewerComicQueue } from './viewerComicQueue.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('만화 읽기 큐는 전체 두 작업과 아카이브당 한 작업으로 제한한다', async () => {
    const queue = new ViewerComicQueue(2);
    const gates = Array.from({ length: 6 }, deferred);
    const started = [];
    const requests = gates.map((gate, index) => queue.run(String(index), 'session', async () => {
        started.push(index);
        await gate.promise;
        return index;
    }, { resource: index < 3 ? 'book-a' : 'book-b' }));
    await Promise.resolve();
    assert.deepEqual(started, [0, 3]);
    assert.equal(queue.active, 2);
    gates.forEach(gate => gate.resolve());
    assert.deepEqual(await Promise.all(requests), [0, 1, 2, 3, 4, 5]);
    assert.equal(queue.active, 0);
    assert.equal(queue.requests.size, 0);
    assert.equal(queue.pending.length, 0);
});

test('같은 페이지의 구독 하나만 취소하면 나머지 요청은 같은 결과를 받는다', async () => {
    const queue = new ViewerComicQueue();
    const gate = deferred();
    const controller = new AbortController();
    let calls = 0;
    const work = async signal => {
        calls += 1;
        await gate.promise;
        assert.equal(signal.aborted, false);
        return Buffer.from('page');
    };
    const first = queue.run('page', 'session', work, { signal: controller.signal });
    const second = queue.run('page', 'session', work);
    const third = queue.run('page', 'session', work);
    const cancelled = assert.rejects(first, { name: 'AbortError' });
    controller.abort();
    gate.resolve();
    await cancelled;
    const [left, right] = await Promise.all([second, third]);
    assert.equal(left, right);
    assert.equal(calls, 1);
});

test('취소된 실행 작업이 끝나기 전에는 다음 압축 해제를 시작하지 않는다', async () => {
    const queue = new ViewerComicQueue(1);
    const closed = deferred();
    let signal;
    let nextStarted = false;
    const running = queue.run('active', 'old', async activeSignal => {
        signal = activeSignal;
        await closed.promise;
    });
    const queued = queue.run('queued', 'old', () => assert.fail('Cancelled queued work must not start.'));
    const settled = Promise.allSettled([running, queued]);
    await Promise.resolve();
    queue.cancelGroup('old');
    const next = queue.run('next', 'new', () => { nextStarted = true; });
    await Promise.resolve();
    assert.equal(signal.aborted, true);
    assert.equal(nextStarted, false);
    assert.equal(queue.active, 1);
    assert.ok((await settled).every(result => result.reason.name === 'AbortError'));
    closed.resolve();
    await next;
    assert.equal(nextStarted, true);
    assert.equal(queue.requests.size, 0);
});

test('마지막 구독을 취소하면 대기 요청을 제거하고 같은 키를 다시 요청할 수 있다', async () => {
    const queue = new ViewerComicQueue(1);
    const gate = deferred();
    const blocker = queue.run('blocker', 'other', () => gate.promise);
    const controller = new AbortController();
    const request = queue.run('page', 'session', () => assert.fail('Aborted work must not start.'), { signal: controller.signal });
    const cancelled = assert.rejects(request, { name: 'AbortError' });
    controller.abort();
    const replacement = queue.run('page', 'session', () => 'new-page');
    gate.resolve();
    await Promise.all([cancelled, blocker]);
    assert.equal(await replacement, 'new-page');
    assert.equal(queue.requests.size, 0);
});

test('페이지 캐시는 바이트와 개수 제한을 지키고 변경된 파일과 큰 페이지를 보관하지 않는다', () => {
    const cache = new ViewerComicPageCache(10, 2);
    const page = size => ({ buffer: Buffer.alloc(size) });
    cache.set('first', 'session', 'version-1', page(4));
    cache.set('second', 'session', 'version-1', page(4));
    assert.ok(cache.get('first', 'version-1'));
    cache.set('third', 'session', 'version-1', page(4));
    assert.equal(cache.get('second', 'version-1'), null);
    assert.equal(cache.entries.size, 2);
    cache.set('large', 'session', 'version-1', page(9));
    assert.equal(cache.bytes, 9);
    assert.equal(cache.entries.size, 1);
    cache.set('oversized', 'session', 'version-1', page(11));
    assert.equal(cache.entries.size, 1);
    assert.equal(cache.get('large', 'version-2'), null);
    assert.equal(cache.bytes, 0);
    cache.set('last', 'session', 'version-2', page(5));
    cache.clearGroup('session');
    assert.equal(cache.bytes, 0);
    assert.equal(cache.entries.size, 0);
});

test('본문 요청은 대기 중인 미리읽기보다 먼저 실행되고 같은 페이지 요청을 승격한다', async () => {
    const queue = new ViewerComicQueue(1);
    const gate = deferred();
    const order = [];
    const running = queue.run('current', 'session', () => gate.promise);
    const first = queue.run('background-first', 'session', () => { order.push('first'); }, { priority: 1 });
    const later = queue.run('background-later', 'session', () => { order.push('promoted'); return 'page'; }, { priority: 1 });
    const foreground = queue.run('background-later', 'session', () => assert.fail('The existing request must be shared.'));
    gate.resolve();
    const results = await Promise.all([running, first, later, foreground]);
    assert.deepEqual(order, ['promoted', 'first']);
    assert.equal(results[2], results[3]);
});
