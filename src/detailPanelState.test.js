import assert from 'node:assert/strict';
import test from 'node:test';
import {
    duplicateDetailRows,
    splitMetadataValues,
    visibleDetailTags,
} from './detailPanelState.js';

test('태그 값을 분리하고 중복을 제거한다', () => {
    assert.deepEqual(splitMetadataValues('Action, Drama', 'Drama;Fantasy'), ['Action', 'Drama', 'Fantasy']);
});

test('제거한 태그는 현재 상세 패널에서 숨긴다', () => {
    assert.deepEqual(visibleDetailTags({ tags: 'A,B', genre: 'C' }, ['B']), ['A', 'C']);
});

test('중복 파일 상세 행을 안전한 형식으로 변환한다', () => {
    assert.deepEqual(duplicateDetailRows({
        duplicate_matches: [{ path: '/Books/a.cbz', ratio: 98.2, name: 'a.cbz' }],
    }), [{ path: '/Books/a.cbz', ratio: 98.2, name: 'a.cbz' }]);
});
