import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeViewerFlowMode,
    resolveViewerFlowMode,
    textPageIndexAtOffset,
    textPageOffsets,
    webtoonPageSize,
    webtoonWidthReference,
    webtoonZoomForWidth,
} from './viewerAutoFlow.js';

test('보기 모드는 알려진 선택만 유지하고 잘못된 저장값은 한장보기로 되돌린다', () => {
    for (const mode of ['auto', 'single', 'spread', 'scroll']) {
        assert.equal(normalizeViewerFlowMode(mode), mode);
    }
    for (const value of [undefined, null, '', 'automatic', 'AUTO', {}, 0]) {
        assert.equal(normalizeViewerFlowMode(value), 'single');
    }
});

test('자동 보기는 가로 화면에서 두장, 세로 또는 정사각형 화면에서 한장을 선택한다', () => {
    assert.equal(resolveViewerFlowMode('auto', { width: 1440, height: 900 }), 'spread');
    assert.equal(resolveViewerFlowMode('auto', { width: 640, height: 480 }), 'spread');
    assert.equal(resolveViewerFlowMode('auto', { width: 900, height: 1440 }), 'single');
    assert.equal(resolveViewerFlowMode('auto', { width: 900, height: 900 }), 'single');
    assert.equal(resolveViewerFlowMode('auto', { width: 900.1, height: 900 }), 'spread');
});

test('측정하지 못했거나 유효하지 않은 화면 크기는 한장보기로 처리한다', () => {
    for (const viewport of [
        undefined, null, {}, { width: 0, height: 0 }, { width: -1, height: 900 },
        { width: 900, height: 0 }, { width: Infinity, height: 900 },
        { width: 900, height: NaN }, { width: '1440', height: 900 },
    ]) assert.equal(resolveViewerFlowMode('auto', viewport), 'single');
});

test('자동 보기는 웹툰에서 화면 방향과 관계없이 스크롤을 선택하며 수동 선택이 항상 우선한다', () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 640, height: 900 }, undefined]) {
        assert.equal(resolveViewerFlowMode('auto', viewport, true), 'scroll');
        for (const mode of ['single', 'spread', 'scroll']) {
            assert.equal(resolveViewerFlowMode(mode, viewport, true), mode);
            assert.equal(resolveViewerFlowMode(mode, viewport, false), mode);
        }
        assert.equal(resolveViewerFlowMode('unknown', viewport, true), 'single');
    }
});

test('웹툰 표시 폭이 800px을 넘으면 배율을 소수 둘째 자리에서 내려 폭을 제한한다', () => {
    const zoom = webtoonZoomForWidth(100, 1416);
    assert.equal(zoom, 56.49);
    assert.ok(1416 * zoom / 100 <= 800);
    assert.equal(webtoonZoomForWidth(50, 1416), 28.24);
    assert.equal(webtoonZoomForWidth(100, 800.01), 99.99);
});

test('웹툰 폭이 이미 제한 안에 있거나 측정하지 못하면 배율을 바꾸지 않는다', () => {
    for (const width of [800, 799, 708, 0, -10, undefined, null, NaN, Infinity, '1416']) {
        assert.equal(webtoonZoomForWidth(100, width), 100);
        assert.equal(webtoonZoomForWidth(50, width), 50);
    }
});

test('웹툰 자동 축소는 최소 배율을 지키고 현재 배율보다 확대하지 않는다', () => {
    assert.equal(webtoonZoomForWidth(100, 10000), 10);
    assert.equal(webtoonZoomForWidth(100, 10000, 20), 20);
    assert.equal(webtoonZoomForWidth(5, 1000), 5);
    assert.equal(webtoonZoomForWidth(50, 1000, 80), 50);
    assert.equal(webtoonZoomForWidth(100, 10000, NaN), 10);
    assert.equal(webtoonZoomForWidth(0, 1000), 0);
    assert.equal(webtoonZoomForWidth(undefined, 1000), undefined);
});

test('웹툰 원본 폭이 섞이면 가장 작은 유효 폭의 페이지를 기준으로 삼는다', () => {
    const pages = [{ name: 'cover' }, { name: 'first' }, { name: 'second' }];
    const sizes = {
        cover: { width: 1200, height: 1600 },
        first: { width: 530, height: 1200 },
        second: { width: 750, height: 1500 },
    };
    assert.deepEqual(webtoonWidthReference(pages, sizes), { width: 530, height: 1200 });
    assert.deepEqual(webtoonWidthReference(pages.slice(0, 1), sizes), sizes.cover);
});

test('같은 폭의 웹툰 기준 페이지는 크기 로드 순서와 관계없이 문서의 앞 페이지를 선택한다', () => {
    const pages = [{ name: 'first' }, { name: 'second' }, { name: 'third' }];
    const sizes = {
        third: { width: 530, height: 1800 },
        second: { width: 530, height: 1500 },
        first: { width: 530, height: 1200 },
    };
    assert.deepEqual(webtoonWidthReference(pages, sizes), { width: 530, height: 1200 });
    assert.deepEqual(webtoonWidthReference([...pages].reverse(), sizes), { width: 530, height: 1800 });
});

test('웹툰 공통 폭은 페이지마다 원본 비율을 유지하고 높이를 정수 픽셀로 맞춘다', () => {
    assert.deepEqual(webtoonPageSize({ width: 1200, height: 1600 }, 530), { width: 530, height: 707 });
    assert.deepEqual(webtoonPageSize({ width: 750, height: 1500 }, 530), { width: 530, height: 1060 });
    assert.deepEqual(webtoonPageSize({ width: 530, height: 1200 }, 530), { width: 530, height: 1200 });
    assert.deepEqual(webtoonPageSize({ width: 100000, height: 2 }, 530), { width: 530, height: 1 });
});

test('웹툰 기준 폭은 현재 책의 페이지에 한정하고 유효하지 않은 크기는 제외한다', () => {
    const sizes = {
        old: { width: 160, height: 1600 },
        current: { width: 750, height: 1500 },
        missing: null,
        zero: { width: 0, height: 1600 },
        pixel: { width: 1, height: 1600 },
        negative: { width: 530, height: -1 },
        infinity: { width: Infinity, height: 1600 },
        nan: { width: 530, height: NaN },
        string: { width: '530', height: 1600 },
    };
    const pages = Object.keys(sizes).filter(name => name !== 'old').map(name => ({ name }));
    assert.deepEqual(webtoonWidthReference(pages, sizes), { width: 750, height: 1500 });
    assert.equal(webtoonWidthReference(pages.filter(page => page.name !== 'current'), sizes), null);
    assert.equal(webtoonWidthReference([{ name: 'not-loaded' }], sizes), null);
    assert.equal(webtoonWidthReference(), null);
    assert.equal(webtoonWidthReference(null, null), null);
    for (const name of ['missing', 'zero', 'pixel', 'negative', 'infinity', 'nan', 'string']) {
        assert.equal(webtoonPageSize(sizes[name], 530), null);
    }
    for (const width of [undefined, null, 0, 1, -1, NaN, Infinity, '530']) {
        assert.equal(webtoonPageSize(sizes.current, width), null);
    }
});

test('텍스트 페이지 시작 위치는 분할 중 달라지는 공백과 줄바꿈을 제외한다', () => {
    const before = ['첫째 문단\n\n둘째', ' 문단\t🙂 셋째 ', '마지막 문단'];
    const after = ['첫째\n문단', '둘째문단 🙂', '셋째\n마지막', '문단'];
    const beforeOffsets = textPageOffsets(before);
    const afterOffsets = textPageOffsets(after);

    assert.deepEqual(beforeOffsets, [0, 6, 12]);
    assert.deepEqual(afterOffsets, [0, 4, 10, 15]);
    assert.equal(textPageIndexAtOffset(afterOffsets, beforeOffsets[1]), 1);
    assert.equal(textPageIndexAtOffset(afterOffsets, beforeOffsets[2]), 2);
});

test('텍스트 위치는 페이지 경계를 새 페이지로 해석하고 문서 바깥에서는 끝으로 제한한다', () => {
    const offsets = textPageOffsets(['abcd', 'ef', 'ghijk']);
    assert.deepEqual(offsets, [0, 4, 6]);
    for (const [offset, index] of [[-5, 0], [0, 0], [3, 0], [4, 1], [5, 1], [6, 2], [100, 2]]) {
        assert.equal(textPageIndexAtOffset(offsets, offset), index);
    }
    assert.equal(textPageIndexAtOffset(offsets, NaN), 0);
    assert.equal(textPageIndexAtOffset(offsets, Infinity), 0);
});

test('빈 텍스트와 공백 페이지만 있어도 페이지 위치를 안전하게 계산한다', () => {
    assert.deepEqual(textPageOffsets(), []);
    assert.equal(textPageIndexAtOffset(), 0);
    assert.deepEqual(textPageOffsets(['', null, ' \n\t ', 'abc']), [0, 0, 0, 0]);
    assert.equal(textPageIndexAtOffset(textPageOffsets(['', 'abc', '', 'def']), 0), 1);
    assert.equal(textPageIndexAtOffset(textPageOffsets(['', 'abc', '', 'def']), 3), 3);
    assert.equal(textPageIndexAtOffset(textPageOffsets(['']), 100), 0);
});
