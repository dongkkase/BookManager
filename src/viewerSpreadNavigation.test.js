import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    adjacentSpreadPageStartIndex,
    adjacentSpreadSelectionIndex,
    resolveSpreadPageStartIndex,
} from './viewerSpreadNavigation.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

function stepSizeForSinglePages(pageCount, singlePageIndexes = []) {
    const singlePageIndexSet = new Set(singlePageIndexes);
    return pageIndex => {
        if (
            pageIndex >= pageCount - 1
            || singlePageIndexSet.has(pageIndex)
            || singlePageIndexSet.has(pageIndex + 1)
        ) {
            return 1;
        }
        return 2;
    };
}

test('가로 페이지 전후의 펼침면 시작점을 가변 묶음에 맞춰 계산한다', () => {
    const pageCount = 8;
    const getStepSizeForIndex = stepSizeForSinglePages(pageCount, [3]);

    assert.deepEqual(
        Array.from({ length: pageCount }, (_, index) => (
            resolveSpreadPageStartIndex(index, pageCount, getStepSizeForIndex)
        )),
        [0, 0, 2, 3, 4, 4, 6, 6],
    );
});

test('이전 이동은 현재 묶음 크기가 아니라 실제 이전 묶음 경계를 사용한다', () => {
    const pageCount = 8;
    const getStepSizeForIndex = stepSizeForSinglePages(pageCount, [3]);

    assert.equal(adjacentSpreadPageStartIndex(4, -1, pageCount, getStepSizeForIndex), 3);
    assert.equal(adjacentSpreadPageStartIndex(3, -1, pageCount, getStepSizeForIndex), 2);
    assert.equal(adjacentSpreadPageStartIndex(2, -1, pageCount, getStepSizeForIndex), 0);
    assert.equal(adjacentSpreadPageStartIndex(0, -1, pageCount, getStepSizeForIndex), 0);
});

test('아직 판정되지 않은 이전 펼침면은 가장 가까운 페이지를 선택 대상으로 보존한다', () => {
    const pageCount = 6;
    const unknownStepSize = () => 2;
    const previousPageIndex = adjacentSpreadPageStartIndex(4, -1, pageCount, unknownStepSize);
    const selectedPageIndex = adjacentSpreadSelectionIndex(4, -1, pageCount, unknownStepSize);

    assert.equal(previousPageIndex, 2);
    assert.equal(selectedPageIndex, 3);
    assert.equal(
        resolveSpreadPageStartIndex(
            selectedPageIndex,
            pageCount,
            stepSizeForSinglePages(pageCount, [selectedPageIndex]),
        ),
        3,
    );
});

test('만화 뷰어 이전 이동은 표시 시작점과 비동기 판정용 선택 페이지를 함께 저장한다', () => {
    assert.match(
        viewerSource,
        /const nextSelectedPageIndex = flowMode === 'spread' && session\?\.type === 'comic' && delta < 0[\s\S]*?adjacentSpreadSelectionIndex\(currentIndex, delta, pageCount, getStepSizeForIndex\)/,
    );
    assert.match(
        viewerSource,
        /setPageIndexSynced\(nextIndex, \{ selectedPageIndex: nextSelectedPageIndex \}\)/,
    );
    assert.match(
        viewerSource,
        /pageTurnPendingRef\.current[\s\S]*?bookPageTurnTargetRef\.current === pageIndex[\s\S]*?bookPageTurnTargetRef\.current = normalizedPageIndex/,
    );
    assert.doesNotMatch(
        viewerSource,
        /if \(bookPageTurnTargetRef\.current !== targetIndex\) return;/,
    );
});

test('늦은 가로 판정으로 현재 인덱스가 묶음 내부가 되어도 인접 묶음으로 바로 이동한다', () => {
    const pageCount = 9;
    const getStepSizeForIndex = stepSizeForSinglePages(pageCount, [2, 3]);

    assert.equal(resolveSpreadPageStartIndex(5, pageCount, getStepSizeForIndex), 4);
    assert.equal(adjacentSpreadPageStartIndex(5, -1, pageCount, getStepSizeForIndex), 3);
    assert.equal(adjacentSpreadPageStartIndex(5, 1, pageCount, getStepSizeForIndex), 6);
});

test('선택한 두 번째 페이지가 늦게 가로형으로 판명되면 그 페이지를 새 시작점으로 승격한다', () => {
    const pageCount = 6;
    const selectedPageIndex = 5;
    const initialPageIndex = resolveSpreadPageStartIndex(selectedPageIndex, pageCount, () => 2);
    const discoveredPageIndex = resolveSpreadPageStartIndex(
        selectedPageIndex,
        pageCount,
        stepSizeForSinglePages(pageCount, [selectedPageIndex]),
    );

    assert.equal(initialPageIndex, 4);
    assert.equal(discoveredPageIndex, 5);
});

test('고정 두 페이지 묶음과 마지막 홀수 페이지도 같은 계산을 사용한다', () => {
    const pageCount = 5;
    const getStepSizeForIndex = () => 2;

    assert.equal(resolveSpreadPageStartIndex(3, pageCount, getStepSizeForIndex), 2);
    assert.equal(adjacentSpreadPageStartIndex(2, 1, pageCount, getStepSizeForIndex), 4);
    assert.equal(adjacentSpreadPageStartIndex(4, 1, pageCount, getStepSizeForIndex), 4);
    assert.equal(adjacentSpreadPageStartIndex(4, -1, pageCount, getStepSizeForIndex), 2);
});

test('마지막 펼침면이 두 페이지여도 다음 묶음은 현재 시작점에 머문다', () => {
    const pageCount = 6;
    const getStepSizeForIndex = () => 2;

    assert.equal(adjacentSpreadPageStartIndex(4, 1, pageCount, getStepSizeForIndex), 4);
    assert.equal(adjacentSpreadPageStartIndex(5, 1, pageCount, getStepSizeForIndex), 4);
});
