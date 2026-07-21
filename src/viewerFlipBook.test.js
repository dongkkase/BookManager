import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFlipBookStructureKey } from './viewerFlipBook.js';

test('페이지 수가 같아도 플립북 페이지 묶음이 바뀌면 구조 키가 변경된다', () => {
    const pairedPages = [
        { sourceIndex: 0, side: 'left' },
        { sourceIndex: 1, side: 'right' },
        { sourceIndex: 2, side: 'left' },
        { sourceIndex: 3, side: 'right' },
    ];
    const firstPageAlone = [
        { sourceIndex: null, side: 'left' },
        { sourceIndex: 0, side: 'right' },
        { sourceIndex: 1, side: 'left' },
        { sourceIndex: 2, side: 'right' },
        { sourceIndex: 3, side: 'left' },
        { sourceIndex: null, side: 'right' },
    ];

    assert.notEqual(
        buildFlipBookStructureKey(pairedPages),
        buildFlipBookStructureKey(firstPageAlone),
    );
});

test('플립북 페이지 내용만 갱신될 때는 구조 키가 유지된다', () => {
    const before = [
        { sourceIndex: null, side: 'left', renderState: 'loading' },
        { sourceIndex: 0, side: 'right', renderState: 'loading' },
    ];
    const after = [
        { sourceIndex: null, side: 'left', renderState: 'ready' },
        { sourceIndex: 0, side: 'right', renderState: 'ready' },
    ];

    assert.equal(buildFlipBookStructureKey(before), buildFlipBookStructureKey(after));
});
