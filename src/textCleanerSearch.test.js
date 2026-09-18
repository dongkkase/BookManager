import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
    buildTextVisualLayout, closestTextChangeIndex, findTextMatches,
    mapTextOffsetByCanonical, mapTextOffsetThroughChanges,
} from './textCleanerNavigation.js';

const source = fs.readFileSync(new URL('./tabs/TextCleanerTool.jsx', import.meta.url), 'utf8');
const mapping = source.slice(source.indexOf('    const mappedEditorOffset ='), source.indexOf('    const focusQuote ='));
const search = source.slice(source.indexOf('    const moveSearch ='), source.indexOf('    const handleSave ='));

function createFixture({ manualEdited = false } = {}) {
    const original = '  시작\n  검색 하나\n  검색 둘';
    const result = '시작\n검색 하나\n검색 둘';
    const calls = [];
    const frames = new Map();
    let frameId = 0;
    const createEditor = side => ({
        focus: () => calls.push([side, 'focus']),
        setSelectionRange: (start, end) => calls.push([side, 'selection', start, end]),
        centerAtTextOffset: offset => calls.push([side, 'center', offset]),
    });
    const context = {
        changes: [], manualEdited,
        useCallback: callback => callback,
        sourceTextRef: { current: original }, resultTextRef: { current: result },
        sourceAreaRef: { current: createEditor('source') },
        resultAreaRef: { current: createEditor('result') },
        sourceLayoutRef: { current: buildTextVisualLayout(original) },
        resultLayoutRef: { current: buildTextVisualLayout(result) },
        sourceSearchMirrorRef: { current: null }, resultSearchMirrorRef: { current: null },
        sourceSearchQuery: '검색', resultSearchQuery: '검색',
        sourceSearchResult: { ...findTextMatches(original, '검색'), query: '검색', index: -1 },
        resultSearchResult: { ...findTextMatches(result, '검색'), query: '검색', index: -1 },
        resultInput: { pending: false, flush: () => result },
        activeSearchMatchRef: { current: {} },
        viewAnchorOffsetsRef: { current: {} },
        layoutStaleRef: { current: false }, syncingScrollRef: { current: false },
        scrollSyncFrameRef: { current: null },
        findTextMatches, mapTextOffsetByCanonical, mapTextOffsetThroughChanges, closestTextChangeIndex,
        setSourceSearchResult: value => { context.sourceSearchResult = value; },
        setResultSearchResult: value => { context.resultSearchResult = value; },
        setSelectedChangeIndex() {},
        searchMirrorGeometry: () => null,
        centerEditorAtTextOffset: (editor, offset) => editor.centerAtTextOffset(offset),
        updateSearchHighlight: side => calls.push([side, 'highlight']),
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
    };
    const api = vm.runInNewContext(`${mapping}\n${search}\n({ moveSearch });`, context);
    return { ...api, context, calls, focusTarget: { focus: () => calls.push(['search', 'focus']) } };
}

test('검색창에서 이동하면 편집기에 포커스를 옮기지 않고 선택 반영 후 양쪽을 중앙에 맞춘다', () => {
    for (const side of ['source', 'result']) {
        const fixture = createFixture();
        fixture.moveSearch(side, 1, fixture.focusTarget);
        const targetSide = side === 'source' ? 'result' : 'source';
        const offset = fixture.context[`${side}SearchResult`].matches[0];
        const targetOffset = fixture.context[`${targetSide}SearchResult`].matches[0];
        assert.deepEqual(fixture.calls, [
            [side, 'selection', offset, offset + 2],
            ['search', 'focus'],
            [side, 'highlight'],
            [side, 'center', offset],
            [targetSide, 'center', targetOffset],
        ]);
        assert.equal(fixture.context.viewAnchorOffsetsRef.current[side], offset);
        assert.equal(fixture.context.viewAnchorOffsetsRef.current[targetSide], targetOffset);
    }
});

test('다음·이전 검색과 처음·마지막 순환에서도 선택 범위와 이동 위치가 일치한다', () => {
    const fixture = createFixture();
    for (const [direction, expectedIndex] of [[1, 0], [1, 1], [1, 0], [-1, 1], [-1, 0]]) {
        fixture.calls.length = 0;
        fixture.moveSearch('result', direction, fixture.focusTarget);
        const result = fixture.context.resultSearchResult;
        assert.equal(result.index, expectedIndex);
        const offset = result.matches[expectedIndex];
        assert.deepEqual(fixture.calls[0], ['result', 'selection', offset, offset + 2]);
        assert.deepEqual(fixture.calls[3], ['result', 'center', offset]);
    }
});

test('직접 수정한 본문 검색은 해당 결과를 정확히 이동하고 반대편의 근사 위치를 맞춘다', () => {
    const fixture = createFixture({ manualEdited: true });
    fixture.moveSearch('result', 1, fixture.focusTarget);
    const { context } = fixture;
    const offset = context.resultSearchResult.matches[0];
    const mappedOffset = Math.round(offset / context.resultTextRef.current.length * context.sourceTextRef.current.length);
    assert.deepEqual(fixture.calls.at(-2), ['result', 'center', offset]);
    assert.deepEqual(fixture.calls.at(-1), ['source', 'center', mappedOffset]);
});
