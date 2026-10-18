import assert from 'node:assert/strict';
import test from 'node:test';
import { createFolderTreeLoader } from './folderTreeLoader.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('폴더 조회는 진행 중 Promise와 성공한 빈 목록까지 재사용한다', async () => {
    const read = deferred();
    const calls = [];
    const changes = [];
    const loader = createFolderTreeLoader({
        readChildren(path) {
            calls.push(path);
            return read.promise;
        },
        onChange: (path, entry) => changes.push([path, entry]),
    });

    assert.equal(loader.get('/books'), undefined);
    const first = loader.load('/books');
    assert.strictEqual(loader.load('/books'), first);
    assert.deepEqual(loader.get('/books'), { status: 'loading', children: [] });
    read.resolve([]);
    const children = await first;
    assert.strictEqual(await loader.load('/books'), children);
    assert.deepEqual(calls, ['/books']);
    assert.deepEqual(changes.map(([path, entry]) => [path, entry.status]), [
        ['/books', 'loading'],
        ['/books', 'ready'],
    ]);
    assert.strictEqual(loader.get('/books').children, children);
});

test('폴더 조회는 기본 네 개만 실행하며 대기 요청도 즉시 loading으로 알린다', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => `/folder-${index}`);
    const reads = new Map(paths.map(path => [path, deferred()]));
    const calls = [];
    const changes = [];
    let active = 0;
    let maximumActive = 0;
    const loader = createFolderTreeLoader({
        async readChildren(path) {
            calls.push(path);
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            try {
                return await reads.get(path).promise;
            } finally {
                active -= 1;
            }
        },
        onChange: (path, entry) => changes.push([path, entry.status]),
    });

    const pending = paths.map(path => loader.load(path));
    assert.deepEqual(calls, paths.slice(0, 4));
    assert.deepEqual(changes, paths.map(path => [path, 'loading']));
    assert.strictEqual(loader.load(paths[6]), pending[6]);
    for (const [index, path] of paths.entries()) {
        const children = [{ path: `${path}/child` }];
        reads.get(path).resolve(children);
        assert.deepEqual(await pending[index], children);
        assert.equal(loader.get(path).status, 'ready');
    }
    assert.deepEqual(calls, paths);
    assert.equal(maximumActive, 4);
});

test('실패한 조회는 빈 배열로 종료하고 다음 호출에서 재시도한다', async () => {
    const error = new Error('Folder unavailable');
    const children = [{ path: '/books/child' }];
    const changes = [];
    let attempts = 0;
    const loader = createFolderTreeLoader({
        readChildren() {
            attempts += 1;
            return attempts === 1 ? Promise.reject(error) : Promise.resolve(children);
        },
        onChange: (_path, entry) => changes.push(entry.status),
    });

    assert.deepEqual(await loader.load('/books'), []);
    assert.deepEqual(loader.get('/books'), { status: 'error', children: [], error });
    assert.strictEqual(await loader.load('/books'), children);
    assert.equal(attempts, 2);
    assert.deepEqual(changes, ['loading', 'error', 'loading', 'ready']);
});

test('우선 요청은 대기열 앞으로 이동하고 기존 Promise와 진행 중 조회를 유지한다', async () => {
    const paths = ['/running', '/warm-a', '/warm-b', '/interactive'];
    const reads = new Map(paths.map(path => [path, deferred()]));
    const calls = [];
    const changes = [];
    const loader = createFolderTreeLoader({
        maxConcurrent: 1,
        readChildren(path) {
            calls.push(path);
            return reads.get(path).promise;
        },
        onChange: (path, entry) => changes.push([path, entry.status]),
    });

    const pending = new Map(paths.slice(0, 3).map(path => [path, loader.load(path)]));
    pending.set('/interactive', loader.load('/interactive', { priority: true }));
    assert.strictEqual(loader.load('/warm-b', { priority: true }), pending.get('/warm-b'));
    assert.strictEqual(loader.load('/running', { priority: true }), pending.get('/running'));
    assert.deepEqual(calls, ['/running']);
    assert.deepEqual(changes, paths.map(path => [path, 'loading']));

    const expectedOrder = ['/running', '/warm-b', '/interactive', '/warm-a'];
    for (const [index, path] of expectedOrder.entries()) {
        assert.deepEqual(calls, expectedOrder.slice(0, index + 1));
        reads.get(path).resolve([]);
        await pending.get(path);
    }
    assert.deepEqual(calls, expectedOrder);
});

test('동기 예외도 오류 상태와 빈 배열로 변환한다', async () => {
    const loader = createFolderTreeLoader({
        readChildren() { throw 'Permission denied'; },
    });
    assert.deepEqual(await loader.load('/books'), []);
    assert.equal(loader.get('/books').status, 'error');
    assert.equal(loader.get('/books').error.message, 'Permission denied');
});

test('reset은 대기 요청을 취소하고 이전 실제 조회도 동시성 상한에 포함한다', async () => {
    const oldRead = deferred();
    const newRead = deferred();
    const calls = [];
    const changes = [];
    const loader = createFolderTreeLoader({
        maxConcurrent: 1,
        readChildren(path) {
            calls.push(path);
            return calls.length === 1 ? oldRead.promise : newRead.promise;
        },
        onChange: (path, entry) => changes.push([path, entry.status]),
    });

    const oldPending = loader.load('/books');
    const queued = loader.load('/queued');
    loader.reset();
    assert.deepEqual(await oldPending, []);
    assert.deepEqual(await queued, []);
    assert.equal(loader.get('/books'), undefined);
    assert.equal(loader.get('/queued'), undefined);

    const newPending = loader.load('/books');
    assert.deepEqual(calls, ['/books']);
    oldRead.resolve([{ path: '/stale' }]);
    await flush();
    assert.deepEqual(calls, ['/books', '/books']);
    assert.equal(loader.get('/books').status, 'loading');
    assert.strictEqual(loader.load('/books'), newPending);
    newRead.resolve([{ path: '/current' }]);
    assert.deepEqual(await newPending, [{ path: '/current' }]);
    assert.deepEqual(changes, [
        ['/books', 'loading'],
        ['/queued', 'loading'],
        ['/books', 'loading'],
        ['/books', 'ready'],
    ]);
});

test('reset 이전의 늦은 실패가 새 성공 캐시를 덮어쓰지 않는다', async () => {
    const oldRead = deferred();
    const newRead = deferred();
    const changes = [];
    let attempts = 0;
    const loader = createFolderTreeLoader({
        maxConcurrent: 2,
        readChildren() {
            attempts += 1;
            return attempts === 1 ? oldRead.promise : newRead.promise;
        },
        onChange: (_path, entry) => changes.push(entry.status),
    });

    const oldPending = loader.load('/books');
    loader.reset();
    const newPending = loader.load('/books');
    const children = [{ path: '/current' }];
    newRead.resolve(children);
    assert.strictEqual(await newPending, children);
    oldRead.reject(new Error('Stale failure'));
    await flush();
    assert.deepEqual(await oldPending, []);
    assert.deepEqual(loader.get('/books'), { status: 'ready', children });
    assert.deepEqual(changes, ['loading', 'loading', 'ready']);
    assert.strictEqual(await loader.load('/books'), children);
    assert.equal(attempts, 2);
});

test('dispose는 진행·대기 요청을 종료하고 새 요청과 늦은 알림을 막는다', async () => {
    const read = deferred();
    const calls = [];
    const changes = [];
    const loader = createFolderTreeLoader({
        maxConcurrent: 1,
        readChildren(path) {
            calls.push(path);
            return read.promise;
        },
        onChange: (path, entry) => changes.push([path, entry.status]),
    });

    const pending = loader.load('/books');
    const queued = loader.load('/queued');
    loader.dispose();
    assert.deepEqual(await pending, []);
    assert.deepEqual(await queued, []);
    assert.equal(loader.get('/books'), undefined);
    read.reject(new Error('Disposed request'));
    await flush();
    loader.reset();
    assert.deepEqual(await loader.load('/later'), []);
    assert.equal(loader.get('/later'), undefined);
    assert.deepEqual(calls, ['/books']);
    assert.deepEqual(changes, [['/books', 'loading'], ['/queued', 'loading']]);
});
