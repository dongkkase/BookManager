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

test('쉼표는 표시 제목과 코어 시리즈명에 보존한다', () => {
    const filename = '작품명, 새로운 이야기 01권.cbz';

    assert.equal(cleanDisplayTitle(filename), '작품명, 새로운 이야기');
    assert.equal(extractCoreTitle(filename), '작품명, 새로운 이야기');
    assert.equal(
        formatLeafName('작품명, 새로운 이야기', '작품명, 새로운 이야기 01권', 0, 10, 'ko'),
        '작품명, 새로운 이야기 01권',
    );
});

test('소수 권수, part, 외전 표기의 leaf 이름이 Python parser와 같다', () => {
    assert.equal(formatLeafName('작품명', '작품명 2.5권', 0, 10, 'ko'), '작품명 02.5권');
    assert.equal(formatLeafName('Series', 'Part 2', 0, 10, 'en'), 'Series v02');
    assert.equal(formatLeafName('작품명', '외전', 0, 10, 'ko'), '작품명 외전');
    assert.equal(formatLeafName('Series', 'Side Story 3화', 0, 10, 'en'), 'Side Story Ch 03 Side Story');
});

test('제목의 부대, 부, 장 숫자는 권수로 오인하지 않는다', () => {
    assert.equal(cleanDisplayTitle('에녹 제2부대의 배고픈 원정 밥'), '에녹 제2부대의 배고픈 원정 밥');
    assert.equal(extractCoreTitle('에녹 제2부대의 배고픈 원정 밥'), '에녹 제2부대의 배고픈 원정 밥');
    assert.equal(
        formatLeafName('에녹 제2부대의 배고픈 원정 밥', '에녹 제2부대의 배고픈 원정 밥', 0, 1, 'ko'),
        '에녹 제2부대의 배고픈 원정 밥',
    );

    assert.equal(cleanDisplayTitle('사이코 메트러 2부 01권'), '사이코 메트러 2부');
    assert.equal(extractCoreTitle('사이코 메트러 2부 01권'), '사이코 메트러 2부');
    assert.equal(
        formatLeafName('사이코 메트러 2부', '사이코 메트러 2부 01권', 0, 10, 'ko'),
        '사이코 메트러 2부 01권',
    );

    assert.equal(cleanDisplayTitle('Re 제로부터 시작하는 이세계 생활 제5장'), 'Re 제로부터 시작하는 이세계 생활 제5장');
    assert.equal(extractCoreTitle('Re 제로부터 시작하는 이세계 생활 제5장'), 'Re 제로부터 시작하는 이세계 생활 제5장');
    assert.equal(
        formatLeafName('Re 제로부터 시작하는 이세계 생활 제5장', 'Re 제로부터 시작하는 이세계 생활 제5장', 0, 1, 'ko'),
        'Re 제로부터 시작하는 이세계 생활 제5장',
    );
});

test('제목 중간의 단독 권은 보존하고 숫자가 붙은 권수만 정리한다', () => {
    const title = '북두의 권 세기말 드라마 촬영전';

    assert.equal(cleanDisplayTitle(title), title);
    assert.equal(extractCoreTitle(title), title);
    assert.equal(cleanDisplayTitle(`${title} 1권`), title);
    assert.equal(extractCoreTitle(`${title} 1권`), title);
    assert.equal(cleanDisplayTitle(`${title} 제1권`), title);
    assert.equal(extractCoreTitle(`${title} 제1권`), title);
});

test('이미지 보정 suffix 안의 숫자는 무단위 권수로 오인하지 않는다', () => {
    assert.equal(
        formatLeafName('프랑켄 프랑 번역본', '프랑켄프랑 01_waifu2x_noise2', 0, 8, 'ko'),
        '프랑켄 프랑 번역본 01권',
    );
    assert.equal(
        formatLeafName('프랑켄 프랑 번역본', '프랑켄프랑 01waifu2x_noise2', 0, 8, 'ko'),
        '프랑켄 프랑 번역본 01권',
    );
    assert.equal(
        formatLeafName('프랑켄 프랑 번역본', '프랑켄프랑 05_waifu2x_noise2_scale_x0_8', 0, 8, 'ko'),
        '프랑켄 프랑 번역본 05권',
    );
    assert.equal(
        formatLeafName('프랑켄 프랑 번역본', '프랑켄프랑 08_waifu2x_noise2_scale_x1_4', 0, 8, 'ko'),
        '프랑켄 프랑 번역본 08권',
    );
});

test('한글과 일본어 파일명은 NFC로 정규화한다', () => {
    assert.equal(fixEncoding('한글'.normalize('NFD')), '한글');
    assert.equal(fixEncoding('作品名'), '作品名');
});

test('상대 경로와 NFD 한글 파일명에서도 제목을 파일명에서 추론한다', () => {
    const filename = './test/황천의 츠가이 1~10.zip'.normalize('NFD');

    assert.deepEqual(resolveTitles(filename, '황천의 츠가이 01'), ['황천의 츠가이', '황천의 츠가이']);
});
