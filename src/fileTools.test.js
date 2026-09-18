import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FILE_TOOL_CATEGORIES,
    FILE_TOOLS,
    fileToolsByCategory,
    firstTextCleanerPath,
    isTextCleanerPath,
} from './fileTools.js';

test('파일 도구 ID와 카테고리는 중복 없이 유효하다', () => {
    const categoryIds = FILE_TOOL_CATEGORIES.map(category => category.id);
    const toolIds = FILE_TOOLS.map(tool => tool.id);

    assert.equal(new Set(categoryIds).size, categoryIds.length);
    assert.equal(new Set(toolIds).size, toolIds.length);
    for (const tool of FILE_TOOLS) assert.ok(categoryIds.includes(tool.category), tool.id);
});

test('사용 가능한 도구만 실제 이동 대상을 제공한다', () => {
    const available = FILE_TOOLS.filter(tool => tool.status === 'available');
    const unavailable = FILE_TOOLS.filter(tool => tool.status !== 'available');

    assert.deepEqual(
        available.map(tool => `${tool.target?.type}:${tool.target?.toolId || tool.target?.tabId}`),
        ['tool:text-cleaner', 'tab:organizer', 'tab:renamer', 'tab:metadata'],
    );
    for (const tool of unavailable) assert.equal(tool.target, undefined, tool.id);
});

test('텍본 정리기는 사용 가능한 내부 도구로 텍스트 카테고리 첫 번째에 표시된다', () => {
    const textTools = fileToolsByCategory('text');

    assert.equal(textTools[0]?.id, 'text-cleaner');
    assert.equal(textTools[0]?.status, 'available');
    assert.deepEqual(textTools[0]?.target, { type: 'tool', toolId: 'text-cleaner' });
});

test('텍본 정리기는 대소문자와 관계없이 첫 TXT 경로를 선택한다', () => {
    assert.equal(isTextCleanerPath('/books/book.TXT'), true);
    assert.equal(isTextCleanerPath('/books/book.epub'), false);
    assert.equal(firstTextCleanerPath(['/books/a.epub', '/books/b.txt']), '/books/b.txt');
    assert.equal(firstTextCleanerPath(['/books/a.epub']), '');
});
