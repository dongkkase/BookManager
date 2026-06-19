import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskCancellationRegistry } from './taskCancellation.js';
import { executeOrganizer } from './tasks/organizerTask.js';
import { executeRenamer } from './tasks/renamerTask.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

test('실행 중인 작업에 취소 신호를 전달한다', () => {
    const registry = new TaskCancellationRegistry();
    const controller = registry.start(1, 'organizer');

    assert.equal(controller.shouldCancel(), false);
    assert.equal(registry.cancel(1, 'organizer'), true);
    assert.equal(controller.shouldCancel(), true);
});

test('다른 창이나 다른 작업의 취소 신호를 섞지 않는다', () => {
    const registry = new TaskCancellationRegistry();
    const controller = registry.start(1, 'renamer');

    assert.equal(registry.cancel(2, 'renamer'), false);
    assert.equal(registry.cancel(1, 'organizer'), false);
    assert.equal(controller.shouldCancel(), false);
});

test('완료된 작업은 취소 대상에서 제거한다', () => {
    const registry = new TaskCancellationRegistry();
    const controller = registry.start(1, 'metadata');
    registry.finish(1, 'metadata', controller);

    assert.equal(registry.cancel(1, 'metadata'), false);
});

test('창 종료 시 해당 창의 모든 작업만 취소한다', () => {
    const registry = new TaskCancellationRegistry();
    const organizer = registry.start(1, 'organizer');
    const renamer = registry.start(1, 'renamer');
    const metadata = registry.start(2, 'metadata');

    assert.equal(registry.hasActive(1), true);
    assert.equal(registry.cancelAll(1), 2);
    assert.equal(organizer.cancelled, true);
    assert.equal(renamer.cancelled, true);
    assert.equal(metadata.cancelled, false);
    assert.equal(registry.hasActive(2), true);
});

test('취소한 작업이 정리될 때까지 종료를 대기한다', async () => {
    const registry = new TaskCancellationRegistry();
    const controller = registry.start(1, 'organizer');
    setTimeout(() => registry.finish(1, 'organizer', controller), 10);

    assert.equal(await registry.waitForIdle(1, 100), true);
    assert.equal(registry.hasActive(1), false);
});

test('각 작업 루프는 파일 처리 전 취소 요청을 반영한다', async () => {
    const item = { checked: true, name: 'book.cbz', filepath: '/missing/book.cbz' };
    const options = { shouldCancel: () => true, sevenZExe: '/missing/7za' };

    const organizer = await executeOrganizer([item], options);
    const renamer = await executeRenamer([item], options);
    const metadata = await saveMetadataItems([item], options);

    assert.equal(organizer.cancelled, true);
    assert.equal(renamer.cancelled, true);
    assert.equal(metadata.cancelled, true);
    assert.deepEqual(organizer.stats.error, []);
    assert.deepEqual(renamer.stats.error, []);
    assert.deepEqual(metadata.stats.error, []);
});

test('취소된 작업 정리 직후 같은 창에서 새 작업을 시작할 수 있다', async () => {
    const registry = new TaskCancellationRegistry();
    const first = registry.start(1, 'organizer');
    assert.equal(registry.cancel(1, 'organizer'), true);
    registry.finish(1, 'organizer', first);

    const second = registry.start(1, 'renamer');
    assert.equal(second.shouldCancel(), false);
    assert.equal(registry.hasActive(1), true);
    registry.finish(1, 'renamer', second);
    assert.equal(registry.hasActive(1), false);
});
