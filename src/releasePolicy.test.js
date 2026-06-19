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
