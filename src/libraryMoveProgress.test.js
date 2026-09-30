import assert from 'node:assert/strict';
import test from 'node:test';
import { createLibraryMoveProgress } from './libraryMoveProgress.js';
import { translate } from './utils/i18n.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (overrides = {}) => ({
    task: 'folder:libraryMove', requestId: 'move-1', libraryPhase: 'moving',
    currentFile: '/source/book.cbz', destinationFile: '/library/book.cbz',
    processedCount: 0, totalCount: 2, progress: 0, ...overrides,
});

test('실제 처리량을 이동·인덱싱 진행률로 표시하고 기존 표지는 즉시 재사용한다', () => {
    const updates = [];
    let previews = 0;
    const controller = createLibraryMoveProgress({
        requestId: 'move-1', files: [{ path: '/source/book.cbz', cover: 'cover-url' }],
        getPreview: () => { previews += 1; }, onProgress: data => updates.push(data),
    });
    controller.handle(event({ requestId: 'another' }));
    controller.handle(event({ task: 'folder:scan' }));
    assert.equal(updates.length, 0);
    controller.handle(event());
    controller.handle(event({ progress: 40 }));
    controller.handle(event({ progress: 50, processedCount: 1 }));
    assert.deepEqual(updates.map(data => data.progress), [25, 43, 47.5]);
    assert.equal(updates[1].percent, 40);
    assert.ok(updates.every(data => data.currentItemCover === 'cover-url'));
    assert.equal(previews, 0);
    controller.handle(event({ libraryPhase: 'indexing', progress: 50 }));
    assert.equal(updates.at(-1).progress, 86);
    assert.equal(updates.at(-1).slideItemReady, false);
    controller.dispose();
    controller.handle(event());
    assert.equal(updates.length, 4);
});

test('이동된 원본의 표지가 없으면 목적지에서 가져오고 같은 경로의 카드를 갱신한다', async () => {
    const paths = [];
    const updates = [];
    const controller = createLibraryMoveProgress({
        requestId: 'move-1',
        getPreview: async path => {
            paths.push(path);
            return path.startsWith('/library') ? { file: { cover: 'destination-cover' } } : { success: false };
        },
        onProgress: data => updates.push(data),
    });
    controller.handle(event());
    await tick();
    assert.deepEqual(paths, ['/source/book.cbz', '/library/book.cbz']);
    assert.equal(updates.at(-1).currentItemCover, 'destination-cover');
    assert.equal(updates.at(-1).currentFile, '/source/book.cbz');
    controller.handle(event({ progress: 20 }));
    assert.equal(paths.length, 2);
    controller.dispose();
});

test('표지 요청은 하나씩 실행하며 오래된 응답과 종료 후 응답이 현재 작업을 덮어쓰지 않는다', async () => {
    const requests = [];
    const updates = [];
    const controller = createLibraryMoveProgress({
        requestId: 'move-1',
        getPreview: path => new Promise(resolve => requests.push({ path, resolve })),
        onProgress: data => updates.push(data),
    });
    controller.handle(event());
    controller.handle(event({ currentFile: '/source/next.cbz' }));
    assert.equal(requests.length, 1);
    requests[0].resolve({ file: { cover: 'old-cover' } });
    await tick();
    assert.equal(requests.length, 2);
    assert.equal(updates.at(-1).currentFile, '/source/next.cbz');
    assert.equal(updates.at(-1).currentItemCover, '');
    const count = updates.length;
    controller.dispose();
    requests[1].resolve({ file: { cover: 'late-cover' } });
    await tick();
    assert.equal(updates.length, count);
});

test('완료 수와 백분율 문구를 세 언어로 제공한다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of ['library_move_status_moving_progress', 'library_move_status_indexing_progress']) {
            assert.match(translate(key, language, [1, 6, 25]), /1\/6/);
            assert.match(translate(key, language, [1, 6, 25]), /25%/);
        }
    }
});
