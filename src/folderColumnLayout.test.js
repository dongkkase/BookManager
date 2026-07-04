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
    assert.equal(layout.length, 24);
    assert.deepEqual(layout.slice(0, 2).map(column => column.key), [
        'viewer_reading_status',
        'viewer_bookmark_status',
    ]);
    assert.equal(layout.find(column => column.key === 'viewer_reading_status').visible, true);
    assert.equal(layout.find(column => column.key === 'viewer_bookmark_status').visible, true);
    assert.equal(layout.find(column => column.key === 'name').visible, true);
    assert.equal(layout.find(column => column.key === 'folder_path').visible, false);
});

test('저장된 순서와 폭을 복원하고 새 상태 컬럼은 처음에 표시되도록 앞에 추가한다', () => {
    const layout = normalizeColumnLayout([
        { key: 'name', visible: true, width: 333 },
        { key: 'cover', visible: false, width: 60 },
    ]);
    assert.deepEqual(layout.slice(0, 4).map(column => column.key), [
        'viewer_reading_status',
        'viewer_bookmark_status',
        'name',
        'cover',
    ]);
    assert.equal(layout[2].width, 333);
    assert.equal(layout.length, 24);
});

test('컬럼 이동과 저장 직렬화는 표시, 순서, 폭을 유지한다', () => {
    const layout = createDefaultColumnLayout();
    const moved = moveColumn(layout, 2, -1);
    assert.equal(moved[1].key, 'cover');
    assert.deepEqual(Object.keys(serializeColumnLayout(moved)[0]), ['key', 'visible', 'width']);
});
