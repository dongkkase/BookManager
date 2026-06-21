import assert from 'node:assert/strict';
import test from 'node:test';
import {
    cleanDisplayTitle,
    extractCoreTitle,
    fixEncoding,
    formatLeafName,
    resolveTitles,
} from './parsers/parser.js';

const PYTHON_PARSER_CORPUS = [
    {
        input: '작품명 01권 [홍길동 그림] (고화질).cbz',
        display: '작품명',
        core: '작품명',
    },
    {
        input: '作品名 Vol. 2.5 [Group].CBZ',
        display: '作品名 Vol. 2.5',
        core: '作品名 Vol. 2.5',
    },
    {
        input: 'Series Season 2 Part 3 10-12화.zip',
        display: 'Series Season 2 Part 3',
        core: 'Series Season 2 Part 3',
    },
    {
        input: '만화 외전 1화 [릴리즈그룹].cbr',
        display: '만화 외전',
        core: '만화',
    },
    {
        input: '작품명 1~3권 합본.zip',
        display: '작품명 합본',
        core: '작품명',
    },
];

test('대표 파일명 corpus의 표시 제목과 코어 시리즈명이 Python parser와 같다', () => {
    for (const sample of PYTHON_PARSER_CORPUS) {
        assert.equal(cleanDisplayTitle(sample.input), sample.display, sample.input);
        assert.equal(extractCoreTitle(sample.input), sample.core, sample.input);
    }
});

test('소수 권수, part, 외전 표기의 leaf 이름이 Python parser와 같다', () => {
    assert.equal(formatLeafName('작품명', '작품명 2.5권', 0, 10, 'ko'), '작품명 02.5권');
    assert.equal(formatLeafName('Series', 'Part 2', 0, 10, 'en'), 'Series v02');
    assert.equal(formatLeafName('작품명', '외전', 0, 10, 'ko'), '작품명 외전');
    assert.equal(formatLeafName('Series', 'Side Story 3화', 0, 10, 'en'), 'Side Story Ch 03 Side Story');
});

test('한글과 일본어 파일명은 NFC로 정규화한다', () => {
    assert.equal(fixEncoding('한글'.normalize('NFD')), '한글');
    assert.equal(fixEncoding('作品名'), '作品名');
});

test('상대 경로와 NFD 한글 파일명에서도 제목을 파일명에서 추론한다', () => {
    const filename = './test/황천의 츠가이 1~10.zip'.normalize('NFD');

    assert.deepEqual(resolveTitles(filename, '황천의 츠가이 01'), ['황천의 츠가이', '황천의 츠가이']);
});
