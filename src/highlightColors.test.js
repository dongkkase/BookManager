import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ANNOTATION_COLORS,
    DEFAULT_HIGHLIGHT_COLOR,
    HIGHLIGHT_COLORS,
    HIGHLIGHT_COLOR_IDS,
    annotationStyle,
    highlightBackground,
    normalizeHighlightColor,
} from './highlightColors.js';

const READIVE_PALETTE = [
    ['yellow', '#FFE255', 'rgba(255, 226, 85, 0.58)'],
    ['green', '#5BD67D', 'rgba(91, 214, 125, 0.5)'],
    ['blue', '#52A9FF', 'rgba(82, 169, 255, 0.52)'],
    ['pink', '#FF6FB5', 'rgba(255, 111, 181, 0.5)'],
    ['purple', '#B57BFF', 'rgba(181, 123, 255, 0.5)'],
    ['orange', '#FFAB52', 'rgba(255, 171, 82, 0.5)'],
    ['red', '#FF6B6B', 'rgba(255, 107, 107, 0.5)'],
    ['olive', '#A8B95F', 'rgba(168, 185, 95, 0.5)'],
    ['cyan', '#4DD0E1', 'rgba(77, 208, 225, 0.5)'],
    ['gray', '#AEB4BE', 'rgba(174, 180, 190, 0.5)'],
];

test('Readive의 10색 ID와 마커 색상을 보존하고 밑줄·취소선을 별도 표시 방식으로 유지한다', () => {
    assert.deepEqual(HIGHLIGHT_COLORS.map(({ id, hex }) => [id, hex]), READIVE_PALETTE.map(([id, hex]) => [id, hex]));
    assert.deepEqual(HIGHLIGHT_COLOR_IDS, READIVE_PALETTE.map(([id]) => id));
    assert.deepEqual(ANNOTATION_COLORS, [...HIGHLIGHT_COLOR_IDS, 'underline', 'strikethrough']);
    assert.equal(HIGHLIGHT_COLORS.some(color => ['underline', 'strikethrough'].includes(color.id)), false);
});

test('10색·밑줄·취소선의 저장된 ID는 다시 읽을 때 바뀌지 않는다', () => {
    for (const id of [...READIVE_PALETTE.map(([color]) => color), 'underline', 'strikethrough']) {
        assert.equal(normalizeHighlightColor(id), id);
        assert.equal(normalizeHighlightColor(` ${id} `), id);
    }
});

test('없는 색상과 알 수 없는 저장값은 기존 기본색 노랑으로 복구한다', () => {
    assert.equal(DEFAULT_HIGHLIGHT_COLOR, 'yellow');
    for (const value of [undefined, null, '', ' ', 'unknown', '#FFAB52', 'RED', 42]) {
        assert.equal(normalizeHighlightColor(value), 'yellow');
        assert.equal(highlightBackground(value), 'rgba(255, 226, 85, 0.58)');
    }
});

test('10색의 본문 하이라이트는 지정된 RGB와 투명도로 렌더링하고 밑줄·취소선은 채우지 않는다', () => {
    for (const [id, , expectedBackground] of READIVE_PALETTE) {
        assert.equal(highlightBackground(id), expectedBackground, id);
    }
    assert.equal(highlightBackground('underline'), 'transparent');
    assert.equal(highlightBackground('strikethrough'), 'transparent');
});

test('표시 방식은 색상 하이라이트와 밑줄·취소선을 구분한다', () => {
    for (const [color] of READIVE_PALETTE) assert.equal(annotationStyle(color), 'highlight');
    assert.equal(annotationStyle('underline'), 'underline');
    assert.equal(annotationStyle('strikethrough'), 'strikethrough');
    assert.equal(annotationStyle(' strikethrough '), 'strikethrough');
    assert.equal(annotationStyle('unknown'), 'highlight');
});
