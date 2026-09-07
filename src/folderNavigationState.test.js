import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOLDER_NAVIGATION_HISTORY_LIMIT,
    getFolderLocation,
    moveFolderNavigation,
    parentFolderPath,
    pushFolderNavigation,
    rememberFolderLocation,
    resolveFolderLocation,
} from './folderNavigationState.js';

function history(...paths) {
    return paths.reduce(pushFolderNavigation, { entries: [], index: -1 });
}

test('폴더별 위치는 경로를 정규화해 보관하며 다른 폴더 위치와 구분한다', () => {
    const locations = new Map();
    const selectedPaths = ['C:/Books/1.cbz', 'C:/Books/2.cbz'];
    rememberFolderLocation(locations, 'C:\\Books', {
        selectedPaths, activePath: selectedPaths[0], viewMode: 'table', scrollTop: 1500, scrollLeft: 240,
    });
    rememberFolderLocation(locations, 'C:/Books/Series', { scrollTop: 500 });
    selectedPaths.push('C:/Books/3.cbz');

    assert.equal(getFolderLocation(locations, 'c:/books/').scrollTop, 1500);
    assert.equal(getFolderLocation(locations, 'c:/books/').scrollLeft, 240);
    assert.equal(getFolderLocation(locations, 'c:/books/').selectedPaths.length, 2);
    assert.equal(getFolderLocation(locations, 'C:/Books/Series').scrollTop, 500);
    assert.equal(getFolderLocation(locations, '/unknown'), undefined);
});

test('최근 100개 폴더 위치를 유지하고 재방문한 폴더는 남겨둔다', () => {
    const locations = new Map();
    for (let index = 0; index < 100; index += 1) {
        rememberFolderLocation(locations, `/books/${index}`, { scrollTop: index });
    }
    rememberFolderLocation(locations, '/books/0', { scrollTop: 500 });
    rememberFolderLocation(locations, '/books/100', { scrollTop: 100 });
    assert.equal(locations.size, 100);
    assert.equal(getFolderLocation(locations, '/books/1'), undefined);
    assert.equal(getFolderLocation(locations, '/books/0').scrollTop, 500);
});

test('뒤로 이동은 남아 있는 선택 항목과 가로·세로 위치를 복원한다', () => {
    const location = {
        viewMode: 'table', scrollTop: 1700, scrollLeft: 300,
        selectedPaths: ['/books/1.cbz', '/books/deleted.cbz', '/books/2.cbz'],
        activePath: '/books/1.cbz',
    };
    const resolved = resolveFolderLocation(location, [
        { path: '/books/1.cbz' }, { path: '/books/2.cbz' },
    ], { viewMode: 'table' });
    assert.deepEqual(resolved, {
        selectedPaths: ['/books/1.cbz', '/books/2.cbz'], activePath: '/books/1.cbz',
        scrollTop: 1700, scrollLeft: 300, revealPath: '',
    });
});

test('상위 이동은 자식 폴더를 선택해 표시하고 보기 변경은 선택 항목을 찾아간다', () => {
    const location = {
        viewMode: 'table', scrollTop: 1700, scrollLeft: 300,
        selectedPaths: ['C:/Books/1.cbz'], activePath: 'C:/Books/1.cbz',
    };
    const files = [{ path: 'C:/Books/Series' }, { path: 'C:/Books/1.cbz' }];
    assert.deepEqual(resolveFolderLocation(location, files, {
        viewMode: 'table', revealPath: 'c:\\books\\series\\',
    }), {
        selectedPaths: ['C:/Books/Series'], activePath: 'C:/Books/Series',
        scrollTop: 1700, scrollLeft: 300, revealPath: 'C:/Books/Series',
    });
    assert.equal(resolveFolderLocation(location, files, { viewMode: 'tile' }).revealPath, 'C:/Books/1.cbz');
    assert.equal(resolveFolderLocation(location, [], { viewMode: 'table' }).activePath, '');
});

test('같은 보기라도 정렬·그룹·항목 크기가 바뀌면 선택 항목의 새 위치를 표시한다', () => {
    const location = {
        viewMode: 'table', layoutKey: 'name|asc|none|50', scrollTop: 1000,
        selectedPaths: ['/books/3.cbz'], activePath: '/books/3.cbz',
    };
    const files = [{ path: '/books/3.cbz' }];
    assert.equal(resolveFolderLocation(location, files, {
        viewMode: 'table', layoutKey: location.layoutKey,
    }).revealPath, '');
    assert.equal(resolveFolderLocation(location, files, {
        viewMode: 'table', layoutKey: 'name|desc|series|100',
    }).revealPath, '/books/3.cbz');
});

test('폴더 탐색은 방문 순서를 유지하고 뒤로 및 앞으로 이동한다', () => {
    const initial = history('/books', '/books/one', '/books/two');
    const backward = moveFolderNavigation(initial, -1);
    const forward = moveFolderNavigation(backward, 1);

    assert.deepEqual(backward, { entries: initial.entries, index: 1 });
    assert.equal(backward.entries[backward.index], '/books/one');
    assert.deepEqual(forward, initial);
    assert.equal(initial.index, 2);
});

test('빈 탐색 기록과 양끝에서는 이동 범위를 벗어나지 않는다', () => {
    const empty = history();
    assert.deepEqual(empty, { entries: [], index: -1 });
    assert.equal(moveFolderNavigation(empty, -1), empty);
    assert.equal(moveFolderNavigation(empty, 1), empty);

    const state = history('/books', '/books/one', '/books/two');
    const first = moveFolderNavigation(state, -100);
    assert.equal(first.index, 0);
    assert.equal(moveFolderNavigation(first, -1), first);
    assert.equal(moveFolderNavigation(first, 100).index, 2);
    assert.equal(moveFolderNavigation(state, 1), state);
    assert.equal(moveFolderNavigation(state, NaN), state);
});

test('뒤로 이동한 다음 새 폴더를 방문하면 앞으로 기록만 제거한다', () => {
    const initial = history('/books', '/books/one', '/books/two');
    const backward = moveFolderNavigation(initial, -1);
    const branch = pushFolderNavigation(backward, '/books/three');

    assert.deepEqual(branch, { entries: ['/books', '/books/one', '/books/three'], index: 2 });
    assert.deepEqual(initial.entries, ['/books', '/books/one', '/books/two']);
    assert.equal(moveFolderNavigation(branch, 1), branch);
});

test('현재 폴더를 다시 방문하면 기록과 앞으로 이동 가능 상태를 유지한다', () => {
    const state = moveFolderNavigation(history('/books/', '/books/one'), -1);
    assert.equal(pushFolderNavigation(state, '/books'), state);
    assert.equal(pushFolderNavigation(state, ''), state);
    assert.equal(pushFolderNavigation(state, null), state);
    assert.equal(moveFolderNavigation(state, 1).entries[1], '/books/one');

    const revisited = history('/books', '/books/one', '/books');
    assert.deepEqual(revisited.entries, ['/books', '/books/one', '/books']);
});

test('경로 비교는 Windows 구분자와 대소문자 및 유니코드를 정규화하고 원문을 보존한다', () => {
    const windowsPath = 'C:\\Books\\Recent\\';
    const windows = history(windowsPath);
    assert.equal(pushFolderNavigation(windows, 'c:/books/recent'), windows);
    assert.equal(windows.entries[0], windowsPath);

    const unc = history('\\\\Server\\Share\\Books');
    assert.equal(pushFolderNavigation(unc, '//server/share/books/'), unc);

    const unicode = history('/books/e\u0301');
    assert.equal(pushFolderNavigation(unicode, '/books/\u00e9/'), unicode);
    assert.equal(unicode.entries[0], '/books/e\u0301');
    assert.deepEqual(history('/Books', '/books').entries, ['/Books', '/books']);
});

test('탐색 기록은 최근 100개를 유지하고 남은 기록 안에서 이동한다', () => {
    const paths = Array.from({ length: FOLDER_NAVIGATION_HISTORY_LIMIT + 5 }, (_, index) => `/books/${index}`);
    const state = history(...paths);
    assert.equal(state.entries.length, 100);
    assert.equal(state.index, 99);
    assert.deepEqual(state.entries, paths.slice(5));
    assert.equal(moveFolderNavigation(state, -100).entries[0], '/books/5');
});

test('POSIX 상위 폴더는 루트까지 이동하고 루트에서는 종료한다', () => {
    assert.equal(parentFolderPath('/books/series'), '/books');
    assert.equal(parentFolderPath('/books/series/'), '/books');
    assert.equal(parentFolderPath('/books'), '/');
    assert.equal(parentFolderPath('/books/'), '/');
    assert.equal(parentFolderPath('/'), '');
    assert.equal(parentFolderPath(''), '');
    assert.equal(parentFolderPath(null), '');
    assert.equal(parentFolderPath('/books/back\\slash'), '/books');
});

test('Windows 상위 폴더는 드라이브 루트와 원래 구분자를 유지한다', () => {
    assert.equal(parentFolderPath('C:\\Books\\Series'), 'C:\\Books');
    assert.equal(parentFolderPath('C:\\Books\\Series\\'), 'C:\\Books');
    assert.equal(parentFolderPath('C:\\Books'), 'C:\\');
    assert.equal(parentFolderPath('C:\\'), '');
    assert.equal(parentFolderPath('C:/Books/Series'), 'C:/Books');
    assert.equal(parentFolderPath('C:/Books/'), 'C:/');
    assert.equal(parentFolderPath('C:/'), '');
});

test('UNC 상위 폴더는 공유 폴더를 루트로 취급한다', () => {
    assert.equal(parentFolderPath('\\\\server\\share\\Books\\Series'), '\\\\server\\share\\Books');
    assert.equal(parentFolderPath('\\\\server\\share\\Books'), '\\\\server\\share');
    assert.equal(parentFolderPath('\\\\server\\share\\Books\\'), '\\\\server\\share');
    assert.equal(parentFolderPath('\\\\server\\share'), '');
    assert.equal(parentFolderPath('\\\\server\\share\\'), '');
    assert.equal(parentFolderPath('//server/share/Books'), '//server/share');
    assert.equal(parentFolderPath('//server/share/'), '');
});
