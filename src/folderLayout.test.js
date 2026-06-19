import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampDetailHeight,
    clampSidebarWidth,
    resolveDetailHeight,
    resolveSidebarWidth,
} from './folderLayout.js';

test('최초 좌우 splitter는 원본의 1:4 비율을 사용한다', () => {
    assert.equal(resolveSidebarWidth(undefined, 1200), 240);
});

test('최초 상하 splitter는 상세 패널 35% 비율을 사용한다', () => {
    assert.equal(resolveDetailHeight(undefined, 800), 280);
});

test('저장된 splitter 값은 현재 컨테이너 범위 안으로 제한한다', () => {
    assert.equal(clampSidebarWidth(900, 1200), 520);
    assert.equal(clampSidebarWidth(100, 1200), 220);
    assert.equal(clampDetailHeight(900, 700), 550);
    assert.equal(clampDetailHeight(20, 700), 180);
});

test('저장된 splitter 값이 있으면 기본 비율보다 우선한다', () => {
    assert.equal(resolveSidebarWidth(310, 1200), 310);
    assert.equal(resolveDetailHeight(260, 800), 260);
});
