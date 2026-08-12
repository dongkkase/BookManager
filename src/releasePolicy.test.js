import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeReleaseList,
    parseInlineMarkdown,
    parseReleaseMarkdown,
} from './releasePolicy.js';

test('릴리즈 목록을 게시일 최신순으로 정렬한다', () => {
    const releases = normalizeReleaseList([
        { id: 1, name: 'v2.0.0', publishedAt: '2026-05-01T00:00:00Z' },
        { id: 2, name: 'v2.1.0', publishedAt: '2026-06-01T00:00:00Z' },
    ]);
    assert.deepEqual(releases.map(item => item.name), ['v2.1.0', 'v2.0.0']);
    assert.equal(releases[0].date, '2026-06-01');
});

test('GitHub 외 릴리즈 URL은 외부 링크로 노출하지 않는다', () => {
    const [release] = normalizeReleaseList([
        { name: 'v1', url: 'javascript:alert(1)' },
    ]);
    assert.equal(release.url, '');
});

test('Markdown을 제목, 목록, 문단, 코드 블록으로 구조화한다', () => {
    const blocks = parseReleaseMarkdown('# 제목\n\n- 항목 1\n- 항목 2\n\n본문\n\n```\ncode\n```');
    assert.deepEqual(blocks.map(block => block.type), ['heading', 'list', 'paragraph', 'code']);
    assert.equal(blocks[1].items.length, 2);
    assert.equal(blocks[1].items[0].ordered, false);
    assert.equal(blocks[3].value, 'code');
});

test('http와 https 링크만 Markdown 링크로 인식한다', () => {
    assert.deepEqual(parseInlineMarkdown('[안전](https://example.com)'), [{
        type: 'link',
        label: '안전',
        url: 'https://example.com',
    }]);
    assert.deepEqual(parseInlineMarkdown('[위험](javascript:alert(1))'), [{
        type: 'text',
        value: '[위험](javascript:alert(1))',
    }]);
});

test('굵게, 인라인 코드, 순서 목록을 구조화한다', () => {
    assert.deepEqual(parseInlineMarkdown('**강조**와 `code`'), [
        { type: 'strong', value: '강조' },
        { type: 'text', value: '와 ' },
        { type: 'code', value: 'code' },
    ]);
    const [list] = parseReleaseMarkdown('1. 첫째\n2. 둘째');
    assert.equal(list.type, 'list');
    assert.equal(list.items.every(item => item.ordered), true);
});

test('탭으로 들여쓴 릴리즈 목록을 하위 항목으로 구조화한다', () => {
    const [list] = parseReleaseMarkdown([
        '- 메타데이터 관리',
        '\t- API 검색 적용',
        '\t\t- 제목 접두사 삭제',
        '\t\t- 제목 접미사 삭제',
        '- 환경설정',
    ].join('\r\n'));

    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].content[0].value, '메타데이터 관리');
    assert.equal(list.items[0].children.length, 1);
    assert.equal(list.items[0].children[0].content[0].value, 'API 검색 적용');
    assert.deepEqual(
        list.items[0].children[0].children.map(item => item.content[0].value),
        ['제목 접두사 삭제', '제목 접미사 삭제'],
    );
    assert.equal(list.items[1].content[0].value, '환경설정');
});

test('공백 들여쓰기와 순서가 섞인 목록의 깊이 복귀를 보존한다', () => {
    const [list] = parseReleaseMarkdown([
        '1. 첫째',
        '  - 하위 1',
        '    - 손자',
        '  - 하위 2',
        '2. 둘째',
    ].join('\n'));

    assert.equal(list.items.length, 2);
    assert.equal(list.items.every(item => item.ordered), true);
    assert.deepEqual(
        list.items[0].children.map(item => item.content[0].value),
        ['하위 1', '하위 2'],
    );
    assert.equal(list.items[0].children.every(item => !item.ordered), true);
    assert.equal(list.items[0].children[0].children[0].content[0].value, '손자');
    assert.equal(list.items[1].children.length, 0);
});
