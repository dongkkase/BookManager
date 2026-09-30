import assert from 'node:assert/strict';
import test from 'node:test';
import { textCleanerToolbarPosition } from './textCleanerSelectionToolbar.js';

const viewport = { width: 1000, height: 800 };
const editor = { left: 500, right: 980, top: 150, bottom: 700 };
const toolbar = { width: 270, height: 40 };

test('플로팅바는 선택 끝 위에 배치하고 결과 영역의 좌우 경계를 지킨다', () => {
    assert.deepEqual(textCleanerToolbarPosition({ left: 750, right: 750, top: 300, bottom: 320 }, editor, toolbar, viewport),
        { left: 615, top: 252 });
    assert.equal(textCleanerToolbarPosition({ left: 502, right: 502, top: 300, bottom: 320 }, editor, toolbar, viewport).left, 508);
    assert.equal(textCleanerToolbarPosition({ left: 978, right: 978, top: 300, bottom: 320 }, editor, toolbar, viewport).left, 702);
});

test('상단 공간이 부족하면 선택 아래에 표시하고 작은 결과 영역에서도 벗어나지 않는다', () => {
    assert.deepEqual(textCleanerToolbarPosition({ left: 750, right: 750, top: 150, bottom: 170 }, editor, toolbar, viewport),
        { left: 615, top: 178 });
    assert.deepEqual(textCleanerToolbarPosition({ left: 90, right: 90, top: 100, bottom: 120 },
        { left: 0, right: 180, top: 0, bottom: 180 }, { width: 164, height: 80 }, viewport), { left: 8, top: 12 });
});

test('스크롤로 선택 끝이 가려지거나 결과 영역이 숨겨지면 플로팅바를 표시하지 않는다', () => {
    for (const anchor of [null,
        { left: 750, right: 750, top: 100, bottom: 120 },
        { left: 750, right: 750, top: 710, bottom: 730 },
        { left: 490, right: 495, top: 300, bottom: 320 },
    ]) assert.equal(textCleanerToolbarPosition(anchor, editor, toolbar, viewport), null);
    assert.equal(textCleanerToolbarPosition({ left: 0, right: 0, top: 0, bottom: 0 },
        { left: 0, right: 0, top: 0, bottom: 0 }, toolbar, viewport), null);
});
