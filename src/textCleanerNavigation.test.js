import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTextVisualLayout,
    closestTextChangeIndex,
    countTextLines,
    editorScrollTopForTextOffset,
    findTextMatches,
    mapTextOffsetByCanonical,
    mapTextOffsetThroughChanges,
    normalizeTextLineEndings,
    textOffsetForEditorScroll,
} from './textCleanerNavigation.js';

test('가상화 편집기의 실제 화면 위치를 전체 스크롤 비율보다 우선한다', () => {
    const editor = {
        textOffsetAtScrollCenter: () => 500,
        get scrollHeight() { throw new Error('가상 높이로 위치를 추정하면 안 됩니다.'); },
    };
    assert.equal(textOffsetForEditorScroll(editor, 10000000), 500);
});

test('개행과 자동 줄바꿈을 화면 줄 인덱스로 만든다', () => {
    const layout = buildTextVisualLayout('1234567890\nabc\n', 5);

    assert.deepEqual([...layout.lineStarts], [0, 11, 15]);
    assert.deepEqual([...layout.lineEnds], [10, 14, 15]);
    assert.deepEqual([...layout.rowStarts], [0, 2, 3]);
    assert.deepEqual([...layout.visualRowOffsets], [0, 5, 11, 15]);
    assert.deepEqual([...layout.canonicalStarts], [0, 10, 13]);
    assert.equal(layout.totalRows, 4);
    assert.equal(layout.totalCanonical, 13);
});

test('검색 결과의 위치와 전체 건수를 계산한다', () => {
    assert.deepEqual(findTextMatches('가나 가나 가', '가나'), {
        matches: [0, 3],
        totalCount: 2,
        truncated: false,
    });
    assert.deepEqual(findTextMatches('aaaa', 'a', 2), {
        matches: [0, 1],
        totalCount: 4,
        truncated: true,
    });
    assert.deepEqual(findTextMatches('가나', ''), {
        matches: [],
        totalCount: 0,
        truncated: false,
    });
});

test('빈 문서와 개행 문서의 전체 라인 수를 계산한다', () => {
    assert.equal(countTextLines(''), 1);
    assert.equal(countTextLines('가\n나\n'), 3);
});

test('textarea와 검색 좌표가 같도록 CRLF와 CR 개행을 LF로 정규화한다', () => {
    const normalized = normalizeTextLineEndings('첫 줄\r\n검색어 앞\r검색어 뒤');

    assert.equal(normalized, '첫 줄\n검색어 앞\n검색어 뒤');
    assert.deepEqual(findTextMatches(normalized, '검색어').matches, [4, 10]);
});

test('글꼴의 실제 폭으로 자동 줄바꿈 행을 계산한다', () => {
    const layout = buildTextVisualLayout('가가ab\n가', {
        columns: 4,
        wrapWidth: 4,
        measureCharacter: character => (character === '가' ? 2 : 1),
    });

    assert.deepEqual([...layout.visualRowOffsets], [0, 2, 5]);
    assert.deepEqual([...layout.rowStarts], [0, 2]);
    assert.equal(layout.totalRows, 3);
});

test('공백을 제외한 동일 문자열 좌표로 원본과 결과 위치를 양방향 변환한다', () => {
    const source = '가 나\n\n다 라';
    const result = '가나다라';
    const sourceLayout = buildTextVisualLayout(source, 20);
    const resultLayout = buildTextVisualLayout(result, 20);

    assert.equal(mapTextOffsetByCanonical(source, sourceLayout, result, resultLayout, 5), 2);
    assert.equal(mapTextOffsetByCanonical(result, resultLayout, source, sourceLayout, 3), 7);
    assert.equal(mapTextOffsetByCanonical('가', buildTextVisualLayout('가'), '나', buildTextVisualLayout('나'), 0), null);
    assert.equal(mapTextOffsetByCanonical('가', buildTextVisualLayout('가'), '가나', buildTextVisualLayout('가나'), 0), null);
});

test('변경 표시 제한을 넘는 문서 후반도 동일 문자열 위치로 변환한다', () => {
    const lines = Array.from({ length: 12050 }, (_, index) => `고유 문장 ${index}`);
    const source = lines.join('\n\n');
    const result = lines.join('\n');
    const sourceLayout = buildTextVisualLayout(source, 40);
    const resultLayout = buildTextVisualLayout(result, 40);
    const anchor = '고유 문장 12025';
    const sourceOffset = source.indexOf(anchor);
    const targetOffset = mapTextOffsetByCanonical(
        source,
        sourceLayout,
        result,
        resultLayout,
        sourceOffset,
    );

    assert.equal(result.slice(targetOffset, targetOffset + anchor.length), anchor);
});

test('편집기 스크롤 중앙을 텍스트 위치로 환산한다', () => {
    const editor = {
        scrollHeight: 1000,
        clientHeight: 200,
        scrollTop: 300,
    };

    assert.equal(textOffsetForEditorScroll(editor, 10000), 4000);
    assert.equal(editorScrollTopForTextOffset(editor, 10000, 4000), 300);
    assert.equal(editorScrollTopForTextOffset(editor, 10000, 10000), 800);
});

test('화면 줄 인덱스로 편집기 스크롤과 문자열 위치를 변환한다', () => {
    const layout = buildTextVisualLayout('1234567890\nabc\n', 5);
    const editor = {
        scrollHeight: 400,
        clientHeight: 0,
        scrollTop: 200,
    };

    assert.equal(textOffsetForEditorScroll(editor, 15, layout), 11);
    assert.equal(editorScrollTopForTextOffset(editor, 15, 11, layout), 200);
});

test('스크롤 위치에서 가장 가까운 변경 항목을 이진 탐색한다', () => {
    const changes = [
        { sourceStart: 100, resultStart: 80 },
        { sourceStart: 500, resultStart: 450 },
        { sourceStart: 900, resultStart: 700 },
    ];

    assert.equal(closestTextChangeIndex(changes, 50), 0);
    assert.equal(closestTextChangeIndex(changes, 500), 1);
    assert.equal(closestTextChangeIndex(changes, 760), 2);
    assert.equal(closestTextChangeIndex(changes, 460, 'resultStart'), 1);
    assert.equal(closestTextChangeIndex([], 100), -1);
});

test('원본과 결과의 문자 위치를 누적 변경량에 맞춰 양방향 변환한다', () => {
    const changes = [
        { sourceStart: 10, sourceEnd: 14, resultStart: 10, resultEnd: 12 },
        { sourceStart: 30, sourceEnd: 32, resultStart: 28, resultEnd: 28 },
        { sourceStart: 50, sourceEnd: 51, resultStart: 46, resultEnd: 47 },
    ];

    assert.equal(mapTextOffsetThroughChanges(changes, 5), 5);
    assert.equal(mapTextOffsetThroughChanges(changes, 12), 11);
    assert.equal(mapTextOffsetThroughChanges(changes, 20), 18);
    assert.equal(mapTextOffsetThroughChanges(changes, 31), 28);
    assert.equal(mapTextOffsetThroughChanges(changes, 40), 36);
    assert.equal(mapTextOffsetThroughChanges(
        changes,
        36,
        'resultStart',
        'resultEnd',
        'sourceStart',
        'sourceEnd',
    ), 40);
});
