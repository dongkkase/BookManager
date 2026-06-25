import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('중복 검사 토글은 라이브러리 재인덱싱을 시작하지 않는다', () => {
    const start = source.indexOf('const handleDupCheckChange = useCallback');
    assert.notEqual(start, -1);
    const end = source.indexOf('const handleRefreshTree', start);
    const block = source.slice(start, end);
    assert.doesNotMatch(block, /updateFolderIndex/);
    assert.doesNotMatch(block, /setPreparingDuplicates\(true\)/);
    assert.match(block, /enableDupCheck:\s*nextValue/);
});

test('라이브러리 이동 완료 후 전체 인덱싱 대신 이동 결과만 증분 반영한다', () => {
    const start = source.indexOf('const moveSelectedToLibrary = useCallback');
    assert.notEqual(start, -1);
    const end = source.indexOf('const openLibraryMoveDialog', start);
    const block = source.slice(start, end);
    assert.match(block, /completedMoves/);
    assert.match(block, /applyLibraryMoveIndex/);
    assert.doesNotMatch(block, /updateFolderIndex/);
});
