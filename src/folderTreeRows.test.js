import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFolderTreeRows, getFolderTreeWindow } from './folderTreeRows.js';

const folder = (path, extra = {}) => ({ path, name: path.split('/').pop(), isFolder: true, ...extra });

test('펼친 분기만 깊이 우선으로 표시하고 형제와 부모 정보를 유지한다', () => {
    const roots = [folder('/books'), folder('/other')];
    const entries = {
        '/books': { status: 'ready', children: [folder('/books/a'), folder('/books/b')] },
        '/books/a': { status: 'ready', children: [folder('/books/a/one'), folder('/books/a/two')] },
        '/books/b': { status: 'ready', children: [folder('/books/b/hidden')] },
    };
    const rows = buildFolderTreeRows(roots, entries, new Set(['/books', '/books/a']));
    assert.deepEqual(rows.map(row => row.path), ['/books', '/books/a', '/books/a/one', '/books/a/two', '/books/b', '/other']);
    assert.deepEqual(rows.map(row => [row.level, row.posInSet, row.setSize]), [[1, 1, 2], [2, 1, 2], [3, 1, 2], [3, 2, 2], [2, 2, 2], [1, 2, 2]]);
    assert.equal(rows[2].parentPath, '/books/a');
    assert.deepEqual(rows[2].siblingPaths, ['/books/a/one', '/books/a/two']);
    assert.deepEqual(rows[2].ancestorContinues, [true]);
    assert.equal(rows[3].hasNextSibling, false);
    assert.equal(rows[4].expanded, false);
    assert.equal(rows[4].canExpand, true);
});

test('자식 수 힌트와 실제 조회 결과로 펼치기 가능 여부를 결정한다', () => {
    const roots = [folder('/known-empty', { childFolderCount: 0 }), folder('/unknown'), folder('/stale', { childFolderCount: 0 }), folder('/empty', { childFolderCount: 5 }), folder('/file', { isFolder: false })];
    const rows = buildFolderTreeRows(roots, {
        '/stale': { status: 'ready', children: [folder('/stale/child')] },
        '/empty': { status: 'ready', children: [] },
    });
    assert.deepEqual(rows.map(row => row.canExpand), [false, true, true, false, false]);
});

test('펼친 폴더의 조회 중·실패·빈 폴더 상태는 해당 부모 바로 아래에 표시한다', () => {
    const roots = ['/pending', '/unqueried', '/failed', '/empty', '/hint-empty'].map(path => folder(path, path === '/hint-empty' ? { childFolderCount: 0 } : {}));
    const error = new Error('Access denied');
    const rows = buildFolderTreeRows(roots, {
        '/pending': { status: 'loading', children: [] },
        '/failed': { status: 'error', children: [], error },
        '/empty': { status: 'ready', children: [] },
    }, new Set(roots.map(node => node.path)));
    assert.deepEqual(rows.map(row => row.kind), ['node', 'loading', 'node', 'loading', 'node', 'error', 'node', 'empty', 'node', 'empty']);
    assert.equal(rows[5].parentPath, '/failed');
    assert.equal(rows[5].error, error);
    assert.equal(rows[5].level, 2);
    assert.equal(rows[7].hasNextSibling, false);
    assert.equal(rows[6].canExpand, false);
    assert.deepEqual(buildFolderTreeRows(roots, {}, new Set()).map(row => row.kind), roots.map(() => 'node'));
});

test('재조회 중 이전 자식이 남아 있어도 로딩 상태를 먼저 보여 준다', () => {
    const rows = buildFolderTreeRows([folder('/root')], { '/root': { status: 'loading', children: [folder('/root/stale')] } }, new Set(['/root']));
    assert.deepEqual(rows.map(row => row.kind), ['node', 'loading']);
});

test('입력을 변경하지 않고 노드의 메타데이터와 참조를 보존한다', () => {
    const node = Object.freeze(folder('/root', { alias: 'Library', isLibraryRoot: true }));
    const roots = Object.freeze([node]);
    const children = Object.freeze([Object.freeze(folder('/root/child'))]);
    const entries = Object.freeze({ '/root': Object.freeze({ status: 'ready', children }) });
    const expanded = new Set(['/root']);
    const rows = buildFolderTreeRows(roots, entries, expanded);
    assert.equal(rows[0].node, node);
    assert.equal(rows[1].node, children[0]);
    assert.deepEqual([...expanded], ['/root']);
    assert.equal(rows[0].node.alias, 'Library');
});

test('잘못된 자식 경로를 제외하고 순환 경로를 펼치지 않는다', () => {
    const rows = buildFolderTreeRows([folder('/root'), null], {
        '/root': { status: 'ready', children: [folder('/root'), folder('/root/child'), { name: 'missing' }] },
        '/root/child': { status: 'ready', children: [folder('/root')] },
    }, new Set(['/root', '/root/child']));
    assert.deepEqual(rows.map(row => row.kind === 'node' ? row.path : row.kind), ['/root', '/root/child', 'empty']);
    assert.equal(rows[0].setSize, 1);
    assert.equal(rows[1].canExpand, false);
});

test('중첩 라이브러리와 시스템 루트에서 같은 경로를 각각 보존하고 부모를 구분한다', () => {
    const roots = [folder('/books', { isLibraryRoot: true }), folder('/books/sub', { isLibraryRoot: true }), folder('/')];
    const entries = {
        '/': { status: 'ready', children: [folder('/books')] },
        '/books': { status: 'ready', children: [folder('/books/sub'), folder('/books/other')] },
        '/books/sub': { status: 'ready', children: [folder('/books/sub/child')] },
        '/books/sub/child': { status: 'error', children: [] },
    };
    const expanded = new Set(['/', '/books', '/books/sub', '/books/sub/child']);
    const rows = buildFolderTreeRows(roots, entries, expanded);
    assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
    const repeated = rows.filter(row => row.path === '/books/sub');
    assert.equal(repeated.length, 3);
    assert.deepEqual(repeated.map(row => row.level), [2, 1, 3]);
    for (const row of repeated) {
        const children = rows.filter(child => child.parentKey === row.key);
        assert.equal(children.length, 1);
        assert.equal(children[0].path, '/books/sub/child');
        assert.equal(children[0].parentPath, row.path);
        const status = rows.find(child => child.parentKey === children[0].key);
        assert.equal(status.kind, 'error');
    }
    const reordered = buildFolderTreeRows([...roots].reverse(), entries, expanded);
    assert.deepEqual(new Set(reordered.map(row => row.key)), new Set(rows.map(row => row.key)));
});

test('동일 경로의 루트나 형제도 제거하지 않고 위치마다 고유 키를 부여한다', () => {
    const rows = buildFolderTreeRows([folder('/root'), folder('/root', { isLibraryRoot: true })], {
        '/root': { status: 'ready', children: [folder('/root/a'), folder('/root/a')] },
    }, new Set(['/root']));
    assert.equal(rows.length, 6);
    assert.equal(new Set(rows.map(row => row.key)).size, 6);
    assert.deepEqual(rows.map(row => [row.level, row.posInSet, row.setSize]), [[1, 1, 2], [2, 1, 2], [2, 2, 2], [1, 2, 2], [2, 1, 2], [2, 2, 2]]);
    assert.notEqual(rows[1].parentKey, rows[4].parentKey);
});

test('가상 목록은 보이는 행 양쪽에 여유 행을 두고 전체 높이를 보존한다', () => {
    const window = getFolderTreeWindow(1000, 2800, 280, 28);
    assert.deepEqual(window, { start: 92, end: 118, beforeHeight: 2576, afterHeight: 24696 });
    assert.equal(window.beforeHeight + (window.end - window.start) * 28 + window.afterHeight, 28000);
    assert.deepEqual(getFolderTreeWindow(1000, 0, 280, 28), { start: 0, end: 18, beforeHeight: 0, afterHeight: 27496 });
});

test('큰 글꼴과 목록 축소 후 남은 스크롤 위치에서도 마지막 행을 표시한다', () => {
    const window = getFolderTreeWindow(50, 50000, 320, 32);
    assert.equal(window.end, 50);
    assert.equal(window.start, 32);
    assert.equal(window.afterHeight, 0);
    assert.deepEqual(getFolderTreeWindow(0, 0, 0, 0), { start: 0, end: 0, beforeHeight: 0, afterHeight: 0 });
});
