import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolbarState } from './toolbarState.js';

test('빈 목록은 원본 초기 상태처럼 전체 선택 아이콘을 유지한다', () => {
    assert.deepEqual(createToolbarState([]), {
        totalCount: 0,
        checkedCount: 0,
        hasItems: false,
        allChecked: true,
    });
});

test('체크된 항목 수와 전체 선택 상태를 계산한다', () => {
    assert.deepEqual(
        createToolbarState([{ checked: true }, { checked: false }, { checked: true }]),
        {
            totalCount: 3,
            checkedCount: 2,
            hasItems: true,
            allChecked: false,
        },
    );
});

test('메타데이터의 undefined 체크 상태를 선택 상태로 처리할 수 있다', () => {
    const state = createToolbarState(
        [{}, { checked: true }, { checked: false }],
        item => item.checked !== false,
    );
    assert.equal(state.checkedCount, 2);
    assert.equal(state.allChecked, false);
});
