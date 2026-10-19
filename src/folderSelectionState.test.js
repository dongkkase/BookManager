import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createFileSelectionLookup,
    nextSelectionIndex,
    selectedFilesSize,
} from './folderSelectionState.js';

test('선택 조회를 사용하지 않는 목록 갱신은 파일 인덱스를 만들지 않는다', () => {
    let pathReads = 0;
    const files = Array.from({ length: 1000 }, (_, index) => ({
        get path() { pathReads += 1; return `/book/${index}`; },
    }));
    const lookup = createFileSelectionLookup(files);
    assert.equal(pathReads, 0);
    assert.equal(lookup.getIndex('/book/0'), 0);
    const initialReads = pathReads;
    assert.equal(lookup.getFile('/book/999'), files[999]);
    assert.equal(lookup.getIndex('/missing'), undefined);
    assert.equal(lookup.getFile('/missing'), undefined);
    assert.equal(pathReads, initialReads);
});

test('선택 조회는 현재 목록의 순서와 메타데이터를 사용한다', () => {
    const original = [{ path: '/a', cover: 'old' }, { path: '/b' }];
    const before = createFileSelectionLookup(original);
    assert.equal(before.getIndex('/b'), 1);
    const updated = [{ path: '/b', cover: 'new' }, original[0]];
    const after = createFileSelectionLookup(updated);
    assert.equal(after.getIndex('/b'), 0);
    assert.equal(after.getFile('/b').cover, 'new');
    assert.equal(before.getFile('/b'), original[1]);
    assert.equal(createFileSelectionLookup([{ path: '' }, null, ...updated]).getIndex('/b'), 2);
    assert.equal(createFileSelectionLookup([original[0], updated[0], { path: '/a' }]).getIndex('/a'), 2);
});

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
