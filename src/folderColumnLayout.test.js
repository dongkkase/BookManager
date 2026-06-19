import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDefaultColumnLayout,
    moveColumn,
    normalizeColumnLayout,
    serializeColumnLayout,
} from './folderColumnLayout.js';

test('기본 레이아웃은 모든 원본 컬럼과 기본 표시 상태를 제공한다', () => {
    const layout = createDefaultColumnLayout();
    assert.equal(layout.length, 22);
    assert.equal(layout.find(column => column.key === 'name').visible, true);
    assert.equal(layout.find(column => column.key === 'folder_path').visible, false);
});

test('저장된 순서와 폭을 복원하고 새 컬럼을 뒤에 추가한다', () => {
    const layout = normalizeColumnLayout([
        { key: 'name', visible: true, width: 333 },
        { key: 'cover', visible: false, width: 60 },
    ]);
    assert.equal(layout[0].key, 'name');
    assert.equal(layout[0].width, 333);
    assert.equal(layout[1].key, 'cover');
    assert.equal(layout.length, 22);
});

test('컬럼 이동과 저장 직렬화는 표시, 순서, 폭을 유지한다', () => {
    const layout = createDefaultColumnLayout();
    const moved = moveColumn(layout, 1, -1);
    assert.equal(moved[0].key, 'dup_count');
    assert.deepEqual(Object.keys(serializeColumnLayout(moved)[0]), ['key', 'visible', 'width']);
});
