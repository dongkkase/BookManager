import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
    LIBRARY_SEARCH_ERROR_CODES,
    LibrarySearchService,
    isRetryableLibrarySearchWorkerError,
} from './librarySearchService.js';

class FakeWorker extends EventEmitter {
    static instances = [];

    constructor() {
        super();
        this.messages = [];
        this.terminateCount = 0;
        FakeWorker.instances.push(this);
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminateCount += 1;
        return Promise.resolve(0);
    }
}

function createService(options = {}) {
    FakeWorker.instances = [];
    return new LibrarySearchService('/tmp/library.db', {
        WorkerClass: FakeWorker,
        searchTimeoutMs: 1000,
        prepareTimeoutMs: 1000,
        ...options,
    });
}

test('worker constructor 오류를 transport Promise 거절로 변환한다', async () => {
    class ThrowingWorker {
        constructor() {
            throw new Error('worker unavailable');
        }
    }
    const service = new LibrarySearchService('/tmp/library.db', { WorkerClass: ThrowingWorker });

    await assert.rejects(service.prepare(), error => (
        error.code === LIBRARY_SEARCH_ERROR_CODES.transport
        && isRetryableLibrarySearchWorkerError(error)
    ));
    assert.equal(service.pending.size, 0);
    await service.close();
});

test('postMessage 동기 오류는 pending을 정리하고 worker를 종료한다', async () => {
    class ThrowingPostWorker extends FakeWorker {
        postMessage() {
            throw new Error('post failed');
        }
    }
    FakeWorker.instances = [];
    const service = new LibrarySearchService('/tmp/library.db', {
        WorkerClass: ThrowingPostWorker,
        searchTimeoutMs: 1000,
    });

    await assert.rejects(service.search('query', ['/Books']), {
        code: LIBRARY_SEARCH_ERROR_CODES.transport,
    });
    assert.equal(service.pending.size, 0);
    assert.equal(FakeWorker.instances[0].terminateCount, 1);
    await service.close();
});

test('worker query 오류는 transport 오류와 구분한다', async () => {
    const service = createService();
    const request = service.search('query', ['/Books']);
    const worker = FakeWorker.instances[0];
    worker.emit('message', {
        id: worker.messages[0].id,
        error: { message: 'query failed', code: LIBRARY_SEARCH_ERROR_CODES.query },
    });

    await assert.rejects(request, error => (
        error.code === LIBRARY_SEARCH_ERROR_CODES.query
        && !isRetryableLibrarySearchWorkerError(error)
    ));
    assert.equal(service.worker, worker);
    await service.close();
});

test('worker transport 종료는 모든 pending을 거절하고 다음 요청에서 재시작한다', async () => {
    const service = createService();
    const first = service.search('first', ['/Books']);
    const second = service.search('second', ['/Books']);
    const firstWorker = FakeWorker.instances[0];
    const rejectionChecks = Promise.all([
        assert.rejects(first, { code: LIBRARY_SEARCH_ERROR_CODES.transport }),
        assert.rejects(second, { code: LIBRARY_SEARCH_ERROR_CODES.transport }),
    ]);
    firstWorker.emit('error', new Error('worker crashed'));
    await rejectionChecks;
    assert.equal(service.pending.size, 0);
    assert.equal(firstWorker.terminateCount, 1);

    const third = service.search('third', ['/Books']);
    const secondWorker = FakeWorker.instances[1];
    secondWorker.emit('message', { id: secondWorker.messages[0].id, result: ['ok'] });
    assert.deepEqual(await third, ['ok']);
    await service.close();
});

test('요청 timeout은 worker와 모든 pending을 정리한다', async () => {
    const service = createService({ searchTimeoutMs: 20 });
    const first = service.search('first', ['/Books']);
    const second = service.search('second', ['/Books']);
    const worker = FakeWorker.instances[0];

    await Promise.all([
        assert.rejects(first, { code: LIBRARY_SEARCH_ERROR_CODES.timeout }),
        assert.rejects(second, { code: LIBRARY_SEARCH_ERROR_CODES.timeout }),
    ]);
    assert.equal(service.pending.size, 0);
    assert.equal(service.worker, null);
    assert.equal(worker.terminateCount, 1);
    await service.close();
});

test('superseded 응답은 빈 결과로 완료한다', async () => {
    const service = createService();
    const request = service.search('old', ['/Books']);
    const worker = FakeWorker.instances[0];
    worker.emit('message', { id: worker.messages[0].id, superseded: true, result: [] });

    assert.deepEqual(await request, []);
    assert.equal(service.pending.size, 0);
    await service.close();
});

test('close는 pending을 closed로 거절하고 몇 번 호출해도 worker를 한 번만 종료한다', async () => {
    const service = createService();
    const request = service.search('query', ['/Books']);
    const worker = FakeWorker.instances[0];
    const rejectionCheck = assert.rejects(request, {
        code: LIBRARY_SEARCH_ERROR_CODES.closed,
    });
    const firstClose = service.close();
    const secondClose = service.close();

    assert.equal(firstClose, secondClose);
    await Promise.all([firstClose, rejectionCheck]);
    assert.equal(worker.terminateCount, 1);
    await assert.rejects(service.search('next', ['/Books']), {
        code: LIBRARY_SEARCH_ERROR_CODES.closed,
    });
});
