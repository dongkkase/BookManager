import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampDetailHeight,
    clampDetailWidth,
    clampSidebarWidth,
    normalizeDetailPanelPosition,
    resolveDetailHeight,
    resolveDetailWidth,
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
    assert.equal(clampDetailHeight(900, 700), 420);
    assert.equal(clampDetailHeight(20, 700), 112);
    assert.equal(clampDetailHeight(260, 300), 140);
});

test('저장된 splitter 값이 있으면 기본 비율보다 우선한다', () => {
    assert.equal(resolveSidebarWidth(310, 1200), 310);
    assert.equal(resolveDetailHeight(260, 800), 260);
});

test('상세 패널 위치가 없거나 잘못된 경우 기존 하단 배치를 유지한다', () => {
    assert.equal(normalizeDetailPanelPosition('right'), 'right');
    for (const position of [undefined, null, '', 'bottom', 'left', 'RIGHT']) {
        assert.equal(normalizeDetailPanelPosition(position), 'bottom');
    }
});

test('우측 상세 패널은 기본 40% 너비를 사용하고 저장된 너비를 우선한다', () => {
    assert.equal(resolveDetailWidth(undefined, 1000), 400);
    assert.equal(resolveDetailWidth(null, 1000), 400);
    assert.equal(resolveDetailWidth('', 1000), 400);
    assert.equal(resolveDetailWidth('invalid', 1000), 400);
    assert.equal(resolveDetailWidth(480, 1000), 480);
    assert.equal(resolveDetailWidth('420', 1000), 420);
});

test('우측 상세 패널 크기는 파일 목록과 경계선을 위한 공간을 남긴다', () => {
    assert.equal(clampDetailWidth(900, 1200), 640);
    assert.equal(clampDetailWidth(20, 1200), 300);
    assert.equal(clampDetailWidth(600, 700), 500);
    assert.equal(clampDetailWidth(600, 500), 300);
    assert.equal(clampDetailWidth(300, 450), 250);
    assert.equal(clampDetailWidth(300, 180), 0);
    assert.equal(clampDetailWidth(300, 0), 0);
});
