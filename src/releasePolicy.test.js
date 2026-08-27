import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    normalizeReleaseList,
    normalizeReleaseImageUrl,
    parseInlineMarkdown,
    parseReleaseImageLine,
    parseReleaseMarkdown,
} from './releasePolicy.js';

const releaseTabSource = readFileSync(new URL('./tabs/ReleaseTab.jsx', import.meta.url), 'utf8');
const releaseCssSource = readFileSync(new URL('./styles/ReleaseTab.css', import.meta.url), 'utf8');

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

test('GitHub 릴리즈의 HTML 이미지 태그를 안전한 이미지 블록으로 구조화한다', () => {
    const blocks = parseReleaseMarkdown([
        '본문',
        '',
        '<img width="819" height="640" alt="화면 &amp; 이미지" src="https://github.com/user-attachments/assets/8fb05b37-3e04-4d77-b90f-f978f78032a9" />',
        '<img src=\'https://github.com/user-attachments/assets/26a49428-a31c-4b3b-a36d-930289a1e64b\' alt=\'두 번째\' />',
    ].join('\r\n'));

    assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'image', 'image']);
    assert.deepEqual(blocks[1], {
        type: 'image',
        src: 'https://github.com/user-attachments/assets/8fb05b37-3e04-4d77-b90f-f978f78032a9',
        alt: '화면 & 이미지',
        width: 819,
        height: 640,
    });
    assert.equal(blocks[2].alt, '두 번째');
});

test('GitHub Markdown 이미지도 이미지 블록으로 인식한다', () => {
    assert.deepEqual(
        parseReleaseImageLine('![화면](https://github.com/user-attachments/assets/8fb05b37-3e04-4d77-b90f-f978f78032a9 "미리보기")'),
        {
            type: 'image',
            src: 'https://github.com/user-attachments/assets/8fb05b37-3e04-4d77-b90f-f978f78032a9',
            alt: '화면',
        },
    );
});

test('릴리즈 이미지는 GitHub HTTPS 첨부 경로만 허용하고 위험한 HTML 속성은 버린다', () => {
    assert.equal(normalizeReleaseImageUrl('http://github.com/user-attachments/assets/image-id'), '');
    assert.equal(normalizeReleaseImageUrl('https://example.com/image.png'), '');
    assert.equal(normalizeReleaseImageUrl('javascript:alert(1)'), '');

    const image = parseReleaseImageLine('<img onerror="alert(1)" style="position:fixed" width="999999" src="https://github.com/user-attachments/assets/image-id" />');
    assert.deepEqual(image, {
        type: 'image',
        src: 'https://github.com/user-attachments/assets/image-id',
        alt: '',
        width: 4096,
    });
    assert.equal(parseReleaseImageLine('<img src="https://example.com/image.png" />'), null);
});

test('코드 블록의 이미지 태그는 실제 이미지로 렌더링하지 않는다', () => {
    const [block] = parseReleaseMarkdown('```html\n<img src="https://github.com/user-attachments/assets/image-id" />\n```');
    assert.equal(block.type, 'code');
    assert.match(block.value, /<img/);
});

test('릴리즈 이미지는 데이터 URL로 불러와 카드 안에서 비율을 유지한다', () => {
    assert.match(releaseTabSource, /const fetchImageDataUrl = window\.electronAPI\?\.fetchImageDataUrl[\s\S]*?fetchImageDataUrl\(image\.src\)/);
    assert.match(releaseTabSource, /block\.type === 'image'/);
    assert.match(releaseTabSource, /loading="lazy"/);
    assert.match(releaseTabSource, /decoding="async"/);
    assert.doesNotMatch(releaseTabSource, /dangerouslySetInnerHTML/);
    assert.match(releaseCssSource, /\.release-card-image\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?height:\s*auto/);
});
