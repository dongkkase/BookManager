import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfAutoSpreadStepSize, scanViewerPdfPageRatios } from './viewerPdfAutoFlow.js';
import { adjacentSpreadPageStartIndex, resolveSpreadPageStartIndex } from './viewerSpreadNavigation.js';
import { buildSlideThumbGroups } from './viewerComicSlideThumbs.js';

test('PDF 자동 펼침은 가로장과 직전 짝을 단독으로 표시하며 탐색과 썸네일이 일치한다', () => {
    const count = 7;
    const ratios = { 0: 0.7, 1: 1.4, 2: 0.7, 3: 0.7, 4: 1, 5: 1.5, 6: 0.7 };
    const step = index => pdfAutoSpreadStepSize(index, count, ratios);
    assert.deepEqual(buildSlideThumbGroups({
        items: Array.from({ length: count }, (_, index) => index), spread: true, getStepSizeForIndex: step,
    }).map(group => group.pageIndexes), [[0], [1], [2, 3], [4], [5], [6]]);
    assert.equal(adjacentSpreadPageStartIndex(4, -1, count, step), 2);
    assert.equal(adjacentSpreadPageStartIndex(2, 1, count, step), 4);
    assert.equal(adjacentSpreadPageStartIndex(5, 1, count, step), 6);
    assert.equal(resolveSpreadPageStartIndex(3, count, step), 2);
    assert.equal(resolveSpreadPageStartIndex(3, count, index => pdfAutoSpreadStepSize(index, count, { ...ratios, 3: 1.4 })), 3);
});

test('PDF 크기는 현재·인접 페이지를 먼저 측정하고 렌더 회전을 반영한 viewport를 사용한다', async () => {
    const requested = [];
    const updates = [];
    let yielded = 0;
    await scanViewerPdfPageRatios({
        numPages: 10,
        async getPage(number) {
            requested.push(number);
            return { getViewport(options) {
                assert.deepEqual(options, { scale: 1 });
                return number === 6 ? { width: 900, height: 600 } : { width: 600, height: 900 };
            } };
        },
    }, {
        getCurrentIndex: () => 5,
        onRatios: ratios => updates.push(ratios),
        yieldControl: async () => { yielded += 1; },
    });
    assert.deepEqual(requested.slice(0, 3), [6, 7, 5]);
    assert.equal(new Set(requested).size, 10);
    assert.equal(updates.at(-1)[5], 1.5);
    assert.equal(updates.at(-1)[0], 2 / 3);
    assert.equal(Object.keys(updates[0]).length, 1);
    assert.equal(yielded, 1);
});

test('PDF 순차 측정 중 이동한 페이지를 우선하고 이미 측정한 페이지는 다시 읽지 않는다', async () => {
    const requested = [];
    let currentIndex = 0;
    await scanViewerPdfPageRatios({
        numPages: 12,
        async getPage(number) {
            requested.push(number);
            if (requested.length === 1) currentIndex = 10;
            return { getViewport: () => ({ width: 600, height: 900 }) };
        },
    }, { getCurrentIndex: () => currentIndex, initialRatios: { 0: 2 / 3 }, yieldControl: async () => {} });
    assert.deepEqual(requested.slice(0, 4), [2, 11, 12, 10]);
    assert.equal(requested.includes(1), false);
    assert.equal(new Set(requested).size, 11);
});

test('큰 PDF는 첫 우선 페이지 이후 여덟 장 단위로만 상태를 내보내고 남은 마지막 묶음을 반영한다', async () => {
    const updates = [];
    let yielded = 0;
    await scanViewerPdfPageRatios({
        numPages: 1003,
        async getPage() {
            return { getViewport: () => ({ width: 900, height: 600 }) };
        },
    }, {
        getCurrentIndex: () => 500,
        onRatios: ratios => updates.push(Object.keys(ratios).length),
        yieldControl: async () => { yielded += 1; },
    });
    assert.deepEqual(updates.slice(0, 5), [1, 2, 3, 8, 16]);
    assert.equal(updates.at(-1), 1003);
    assert.equal(updates.length, 129);
    assert.equal(yielded, 125);
});

test('PDF 측정 실패는 해당 페이지만 기본 묶음으로 처리하며 취소 후 결과를 내보내지 않는다', async () => {
    const updates = [];
    await scanViewerPdfPageRatios({
        numPages: 2,
        async getPage(number) {
            if (number === 1) throw new Error('unavailable');
            return { getViewport: () => ({ width: Infinity, height: 900 }) };
        },
    }, { onRatios: ratios => updates.push(ratios) });
    assert.deepEqual(updates.at(-1), { 0: 0, 1: 0 });
    let canceled = false;
    await scanViewerPdfPageRatios({
        numPages: 2,
        async getPage() {
            canceled = true;
            return { getViewport: () => assert.fail('Cancelled page measured') };
        },
    }, { isCancelled: () => canceled, onRatios: () => assert.fail('Cancelled ratios published') });
});
