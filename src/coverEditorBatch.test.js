import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCoverEditorTargets, runCoverEditorBatch } from './coverEditorBatch.js';

const file = (fullPath, extra = {}) => Object.freeze({
    name: fullPath.split('/').at(-1),
    path: '/library',
    full_path: fullPath,
    is_folder: false,
    ...extra,
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
};

test('선택 밖 파일을 우클릭하면 기존 선택을 유지하고 우클릭 파일만 대상으로 한다', () => {
    const selected = Object.freeze([file('/library/selected.cbz'), file('/library/selected.epub')]);
    const context = file('/other/selected.cbz');
    assert.deepEqual(resolveCoverEditorTargets(context, selected), [context]);
    assert.equal(selected.length, 2);
    assert.equal(selected[0].full_path, '/library/selected.cbz');
});

test('선택 안의 파일을 우클릭하면 지원 파일만 선택 순서로 처리하고 경로 중복을 제거한다', () => {
    const comic = file('/library/comic.CBZ');
    const epub = file('/library/book.epub');
    const pdf = file('/library/book.pdf');
    const audio = file('/library/audio.m4b');
    const text = file('/library/book.txt');
    const selected = Object.freeze([
        comic,
        file('/library/image.png'),
        epub,
        file('/library/comic.CBZ', { name: 'Duplicate reference' }),
        file('/library/directory.cbz', { is_folder: true }),
        pdf,
        audio,
        text,
    ]);
    const context = file('/library/book.epub', { name: 'A separate context-menu object' });
    assert.deepEqual(resolveCoverEditorTargets(context, selected), [comic, epub, pdf, audio, text]);
    assert.equal(selected.length, 8);
});

test('선택이 없으면 지원되는 우클릭 파일 하나만 반환하고 폴더와 미지원 파일은 제외한다', () => {
    const context = file('/library/book.cb7');
    assert.deepEqual(resolveCoverEditorTargets(context, []), [context]);
    assert.deepEqual(resolveCoverEditorTargets(file('/library/cover.jpg'), []), []);
    assert.deepEqual(resolveCoverEditorTargets(file('/library/directory.epub', { is_folder: true }), []), []);
});

test('Windows 경로 표기와 macOS 한글 정규화가 달라도 같은 선택 파일을 중복 처리하지 않는다', () => {
    const windows = file('C:\\Books\\ONE.CBZ');
    const korean = file('/library/한글.cbz');
    const other = file('/library/other.pdf');
    const selected = [windows, file('c:/books/one.cbz'), korean, file('/library/한글.cbz'.normalize('NFD')), other];
    assert.deepEqual(resolveCoverEditorTargets(file('c:/BOOKS/one.cbz'), selected), [windows, korean, other]);
});

test('빈 일괄 요청은 저장이나 진행 알림 없이 빈 결과를 반환한다', async () => {
    const result = await runCoverEditorBatch([], () => assert.fail('No file should be saved.'), {
        onProgress: () => assert.fail('No completed file should be reported.'),
    });
    assert.equal(result.batch, true);
    assert.deepEqual(result.results, []);
    assert.equal(result.successCount, 0);
    assert.equal(result.failureCount, 0);
    assert.equal(result.cancelledCount, 0);
});

test('형식별 저장 필드를 유지하며 한 번에 하나씩 처리하고 완료 순서대로 진행을 알린다', async () => {
    const requests = Object.freeze([
        Object.freeze({ filePath: '/library/comic.cbz', version: 'comic-version', imagePath: '/images/comic.png', imageVersion: 'image-one', mode: 'add', renumber: true, backup: true }),
        Object.freeze({ filePath: '/library/book.epub', version: 'epub-version', imagePath: '/images/book.jpg', imageVersion: 'image-two', mode: 'replace', targetEntry: 'OEBPS/cover.jpg', backup: false }),
        Object.freeze({ filePath: '/library/book.txt', version: 'text-version', textContentHash: 'text-hash', imagePath: '/images/text.png', imageVersion: 'image-three', mode: 'replace' }),
    ]);
    const first = deferred();
    const calls = [];
    const progress = [];
    let active = 0;
    let maxActive = 0;
    const pending = runCoverEditorBatch(requests, async request => {
        calls.push(request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls.length === 1) await first.promise;
        active -= 1;
        return { success: true, filePath: request.filePath, backupPath: request.backup ? '/library/bak/comic.cbz' : '', warning: '' };
    }, { onProgress: update => progress.push(update) });
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(progress.length, 0);
    first.resolve();
    const result = await pending;
    assert.equal(maxActive, 1);
    assert.deepEqual(calls, requests);
    assert.equal(result.batch, true);
    assert.equal(result.successCount, 3);
    assert.equal(result.failureCount, 0);
    assert.equal(result.cancelledCount, 0);
    assert.equal(result.results[0].backupPath, '/library/bak/comic.cbz');
    assert.deepEqual(progress.map(update => ({ completed: update.completed, total: update.total, filePath: update.filePath })), requests.map((request, index) => ({ completed: index + 1, total: 3, filePath: request.filePath })));
    progress.forEach((update, index) => assert.deepEqual(update.result, result.results[index]));
});

test('실패 응답과 예외가 있어도 다음 파일을 처리하고 파일별 오류 코드와 성공 결과를 보존한다', async () => {
    const requests = ['denied', 'changed', 'good'].map(name => ({ filePath: `/library/${name}.cbz`, mode: 'replace' }));
    const calls = [];
    const progress = [];
    const result = await runCoverEditorBatch(requests, async request => {
        calls.push(request.filePath);
        if (request.filePath === requests[0].filePath) return { success: false, error: 'Permission denied', code: 'EACCES' };
        if (request.filePath === requests[1].filePath) throw Object.assign(new Error('Book changed'), { code: 'COVER_SOURCE_CHANGED' });
        return { success: true, filePath: request.filePath, warning: 'Preview refresh failed', converted: false };
    }, { onProgress: update => progress.push(update) });
    assert.deepEqual(calls, requests.map(request => request.filePath));
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 2);
    assert.equal(result.cancelledCount, 0);
    assert.deepEqual(result.results.map(item => item.filePath), calls);
    assert.equal(result.results[0].success, false);
    assert.equal(result.results[0].error, 'Permission denied');
    assert.equal(result.results[0].code, 'EACCES');
    assert.equal(result.results[1].success, false);
    assert.equal(result.results[1].error, 'Book changed');
    assert.equal(result.results[1].code, 'COVER_SOURCE_CHANGED');
    assert.equal(result.results[2].success, true);
    assert.equal(result.results[2].warning, 'Preview refresh failed');
    assert.equal(progress.length, 3);
});

test('저장 성공 확인이 없는 응답을 성공으로 집계하지 않는다', async () => {
    const requests = [{ filePath: '/library/empty.pdf' }, { filePath: '/library/failed.pdf' }, { filePath: '/library/good.pdf' }];
    const result = await runCoverEditorBatch(requests, async request => {
        if (request.filePath === requests[0].filePath) return undefined;
        if (request.filePath === requests[1].filePath) return { error: 'Disconnected' };
        return { success: true, filePath: request.filePath };
    });
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 2);
    assert.equal(result.results[0].success, false);
    assert.ok(result.results[0].error);
    assert.equal(result.results[1].error, 'Disconnected');
});

test('일괄 저장 요청의 같은 실제 경로는 처음 요청만 적용하고 진행 총계에서도 중복을 제외한다', async () => {
    const requests = Object.freeze([
        Object.freeze({ filePath: 'C:\\Books\\ONE.CBZ', imagePath: '/images/first.png', mode: 'add' }),
        Object.freeze({ filePath: 'c:/books/one.cbz', imagePath: '/images/second.png', mode: 'replace' }),
        Object.freeze({ filePath: '/library/한글.epub', imagePath: '/images/book.png', mode: 'replace' }),
        Object.freeze({ filePath: '/library/한글.epub'.normalize('NFD'), imagePath: '/images/duplicate.png', mode: 'add' }),
    ]);
    const calls = [];
    const progress = [];
    const result = await runCoverEditorBatch(requests, async request => {
        calls.push(request);
        return { success: true, filePath: request.filePath };
    }, { onProgress: update => progress.push(update) });
    assert.deepEqual(calls, [requests[0], requests[2]]);
    assert.equal(result.successCount, 2);
    assert.equal(result.results.length, 2);
    assert.deepEqual(progress.map(update => [update.completed, update.total]), [[1, 2], [2, 2]]);
});

test('RAR 변환 후 결과에는 원본 경로와 새 CBZ 경로를 구분하고 진행 알림은 원본을 식별한다', async () => {
    const request = { filePath: '/library/source.rar', mode: 'add', renumber: true };
    const progress = [];
    const result = await runCoverEditorBatch([request], async () => ({
        success: true,
        filePath: '/library/source_cover.cbz',
        converted: true,
        backupPath: '',
    }), { onProgress: update => progress.push(update) });
    assert.equal(result.results[0].sourcePath, request.filePath);
    assert.equal(result.results[0].filePath, '/library/source_cover.cbz');
    assert.equal(result.results[0].converted, true);
    assert.equal(progress[0].filePath, request.filePath);
    assert.equal(progress[0].result.filePath, '/library/source_cover.cbz');
});

test('진행 UI 갱신이 실패해도 이미 저장한 파일을 실패로 표시하거나 다음 저장을 중단하지 않는다', async () => {
    const requests = [{ filePath: '/library/one.cbz' }, { filePath: '/library/two.cbz' }];
    const calls = [];
    const result = await runCoverEditorBatch(requests, async request => {
        calls.push(request.filePath);
        return { success: true, filePath: request.filePath };
    }, {
        onProgress: async update => {
            if (update.completed === 1) throw new Error('Progress view unavailable');
        },
    });
    assert.deepEqual(calls, requests.map(request => request.filePath));
    assert.equal(result.successCount, 2);
    assert.equal(result.failureCount, 0);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[0].progressWarning, 'Progress view unavailable');
});

test('시작 전에 취소되면 어느 파일도 저장하지 않고 모든 요청을 취소 결과로 반환한다', async () => {
    const requests = [{ filePath: '/library/one.cbz' }, { filePath: '/library/two.epub' }];
    const result = await runCoverEditorBatch(requests, () => assert.fail('Cancelled files must not be saved.'), {
        shouldCancel: () => true,
        onProgress: () => assert.fail('A cancelled request has not completed a save.'),
    });
    assert.equal(result.successCount, 0);
    assert.equal(result.failureCount, 0);
    assert.equal(result.cancelledCount, 2);
    assert.deepEqual(result.results.map(item => item.filePath), requests.map(request => request.filePath));
    assert.ok(result.results.every(item => item.cancelled === true && item.success === false));
});

test('저장 도중 취소하면 현재 파일은 완료하고 남은 파일은 저장 함수를 호출하지 않는다', async () => {
    const requests = ['one', 'two', 'three'].map(name => ({ filePath: `/library/${name}.cbz` }));
    const inFlight = deferred();
    const calls = [];
    const progress = [];
    let cancelled = false;
    const pending = runCoverEditorBatch(requests, async request => {
        calls.push(request.filePath);
        await inFlight.promise;
        return { success: true, filePath: request.filePath, backupPath: '/library/bak/one.cbz' };
    }, { shouldCancel: () => cancelled, onProgress: update => progress.push(update) });
    await tick();
    assert.deepEqual(calls, [requests[0].filePath]);
    cancelled = true;
    inFlight.resolve();
    const result = await pending;
    assert.deepEqual(calls, [requests[0].filePath]);
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);
    assert.equal(result.cancelledCount, 2);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[0].backupPath, '/library/bak/one.cbz');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].completed, 1);
    assert.equal(progress[0].total, 3);
    assert.deepEqual(result.results.slice(1).map(item => item.filePath), requests.slice(1).map(request => request.filePath));
    assert.ok(result.results.slice(1).every(item => item.cancelled === true && item.success === false));
});
