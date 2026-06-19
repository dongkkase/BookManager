import assert from 'node:assert/strict';
import test from 'node:test';
import {
    nextSelectionIndex,
    selectedFilesSize,
} from './folderSelectionState.js';

test('키보드 선택 이동은 목록 경계를 벗어나지 않는다', () => {
    assert.equal(nextSelectionIndex(3, -1, 1), 0);
    assert.equal(nextSelectionIndex(3, 0, -1), 0);
    assert.equal(nextSelectionIndex(3, 2, 1), 2);
});

test('선택된 파일만 용량 합계에 포함한다', () => {
    assert.equal(selectedFilesSize([
        { path: '/a', size: 100 },
        { path: '/b', size: 250 },
    ], ['/b']), 250);
});
