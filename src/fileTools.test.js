import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FILE_TOOL_CATEGORIES,
    FILE_TOOLS,
    fileToolsByCategory,
    firstTextCleanerPath,
    isTextCleanerPath,
    resolveFileToolPathAction,
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
        ['tool:text-cleaner', 'tool:epub-editor', 'tab:organizer', 'tab:renamer', 'tool:cover-editor', 'tool:epub-optimizer', 'tab:metadata'],
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

test('표지 편집은 압축·이미지 카테고리에서 사용할 수 있는 내부 도구다', () => {
    const tool = fileToolsByCategory('archive-image').find(item => item.id === 'cover-editor');
    assert.equal(tool.status, 'available');
    assert.equal(tool.labelKey, 'cover_editor_title');
    assert.deepEqual(tool.target, { type: 'tool', toolId: 'cover-editor' });
});

test('목적 도구가 없는 파일 전달은 목록에서 무시하고 현재 도구를 유지한다', () => {
    const detail = { activeTab: 'tools', action: 'drop-paths', paths: ['/books/book.cbz', '/books/book.txt'] };
    assert.equal(resolveFileToolPathAction(detail, null), null);
    assert.equal(resolveFileToolPathAction(detail, 'epub-editor'), null);
    assert.deepEqual(resolveFileToolPathAction(detail, 'text-cleaner'), {
        toolId: 'text-cleaner', source: 'drop', request: { path: '/books/book.txt' },
    });
    assert.deepEqual(resolveFileToolPathAction(detail, 'cover-editor'), {
        toolId: 'cover-editor', source: 'drop', request: { paths: detail.paths, mode: 'append' },
    });
});

test('명시한 표지 편집 요청은 여러 경로와 적용 방식을 보존하고 중복만 정리한다', () => {
    const decomposed = '/books/가.cbz'.normalize('NFD');
    const detail = { activeTab: 'tools', action: 'load-paths', toolId: 'cover-editor', paths: [decomposed, '/books/가.cbz', '/books/b.epub'], mode: 'replace', source: 'folder' };
    assert.deepEqual(resolveFileToolPathAction(detail, 'text-cleaner'), {
        toolId: 'cover-editor', source: 'navigation', request: { paths: [decomposed, '/books/b.epub'], mode: 'replace', source: 'folder' },
    });
    assert.equal(resolveFileToolPathAction({ ...detail, mode: 'unknown' }, null).request.mode, 'append');
    assert.equal(resolveFileToolPathAction({ ...detail, source: 'drop' }, null).source, 'drop');
    assert.equal(resolveFileToolPathAction({ ...detail, source: 'drop' }, null).request.source, undefined);
    assert.equal(resolveFileToolPathAction({ ...detail, action: 'drop-paths' }, null).request.source, undefined);
});

test('다른 탭, 지원하지 않는 액션과 목적 도구 및 빈 경로를 무시한다', () => {
    const detail = { activeTab: 'tools', action: 'load-paths', toolId: 'cover-editor', paths: ['/books/a.cbz'] };
    for (const patch of [{ activeTab: 'folder' }, { action: 'save' }, { toolId: 'unknown' }, { paths: [] }, { paths: null }, { paths: '' }]) {
        assert.equal(resolveFileToolPathAction({ ...detail, ...patch }, 'cover-editor'), null);
    }
    assert.equal(resolveFileToolPathAction(undefined, 'cover-editor'), null);
    assert.equal(resolveFileToolPathAction({ ...detail, toolId: 'text-cleaner' }, 'cover-editor'), null);
});
