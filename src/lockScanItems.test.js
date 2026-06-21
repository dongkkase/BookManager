import assert from 'node:assert/strict';
import test from 'node:test';
import {
    hasMatchingLockScanItem,
    isLockScanTargetPath,
    mergeLockScanItem,
    mergeLockScanQueueItem,
    shouldAcceptLockScanItem,
} from './lockScanItems.js';

test('락스크린 스캔 placeholder는 스캔 대상 확장자만 받는다', () => {
    assert.equal(isLockScanTargetPath('/Books/A.cbz'), true);
    assert.equal(isLockScanTargetPath('/Books/A.pdf'), true);
    assert.equal(isLockScanTargetPath('/Books/A.epub'), true);
    assert.equal(isLockScanTargetPath('/Books/A.txt'), true);
    assert.equal(isLockScanTargetPath('/Books/A.md'), false);
    assert.equal(isLockScanTargetPath('/Books/Folder'), false);
});

test('락스크린 스캔 항목은 썸네일이 있으면 확장자 없이도 받는다', () => {
    assert.equal(shouldAcceptLockScanItem({ path: '/Books/Folder' }), false);
    assert.equal(shouldAcceptLockScanItem({ path: '/Books/Folder', src: 'bookmanager-thumbnail://cache/a.png' }), true);
});

test('락스크린 스캔 항목은 같은 파일 placeholder와 썸네일을 병합한다', () => {
    const path = '/Books/A.cbz';
    const first = mergeLockScanItem([], { path, name: 'A.cbz' }, 1);
    const second = mergeLockScanItem(first, {
        path,
        name: 'A.cbz',
        src: 'bookmanager-thumbnail://cache/a.png',
    }, 2);
    const third = mergeLockScanItem(second, { path, name: 'A.cbz' }, 3);

    assert.equal(third.length, 1);
    assert.equal(third[0].src, 'bookmanager-thumbnail://cache/a.png');
    assert.equal(third[0].updatedAt, 3);
});

test('락스크린 스캔 항목은 진행 placeholder가 많아도 썸네일을 보존한다', () => {
    let items = [];
    items = mergeLockScanItem(items, {
        path: '/Books/Ready.cbz',
        name: 'Ready.cbz',
        src: 'bookmanager-thumbnail://cache/ready.png',
    }, 1);

    for (let index = 0; index < 40; index += 1) {
        items = mergeLockScanItem(items, {
            path: `/Books/Pending-${index}.cbz`,
            name: `Pending-${index}.cbz`,
        }, index + 2);
    }

    assert.equal(items.some(item => item.path === '/Books/Ready.cbz' && item.src), true);
    assert.equal(items.filter(item => !item.src).length, 8);
});

test('락스크린 스캔 큐는 이벤트 순서를 유지하면서 같은 파일 업데이트를 병합한다', () => {
    let queue = [];
    queue = mergeLockScanQueueItem(queue, { path: '/Books/A.cbz', name: 'A.cbz' }, 1);
    queue = mergeLockScanQueueItem(queue, { path: '/Books/B.cbz', name: 'B.cbz' }, 2);
    queue = mergeLockScanQueueItem(queue, {
        path: '/Books/A.cbz',
        name: 'A.cbz',
        src: 'bookmanager-thumbnail://cache/a.png',
    }, 3);

    assert.deepEqual(queue.map(item => item.name), ['B.cbz', 'A.cbz']);
    assert.equal(queue[1].src, 'bookmanager-thumbnail://cache/a.png');
});

test('락스크린 스캔 항목은 화면 표시 목록에서 같은 파일을 찾을 수 있다', () => {
    const current = mergeLockScanItem([], { path: '/Books/A.cbz', name: 'A.cbz' }, 1);

    assert.equal(hasMatchingLockScanItem(current, { path: '/Books/A.cbz' }), true);
    assert.equal(hasMatchingLockScanItem(current, { path: '/Books/B.cbz' }), false);
});
