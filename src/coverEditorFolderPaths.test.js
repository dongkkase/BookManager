import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCoverEditorFolderPaths } from './features/fileTools/coverEditor/coverEditorFolderPaths.js';

const file = name => ({ name, isFile: true, isDirectory: false });
const directory = name => ({ name, isFile: false, isDirectory: true });

test('cover folder collection includes supported files in naturally ordered nested directories', async () => {
    const folders = {
        '/books': [directory('Series 10'), file('Book 10.zip'), directory('Series 2'), file('Book 2.CBZ'), file('notes.md'), file('image.jpg')],
        '/books/Series 2': [directory('nested'), file('Book.epub'), file('Book.pdf'), file('Book.txt'), file('Book.mp3')],
        '/books/Series 2/nested': [file('Chapter 10.cbr'), file('Chapter 2.cb7')],
        '/books/Series 10': [file('End.7z')],
    };
    const visited = [];
    const paths = await collectCoverEditorFolderPaths('/books', async path => {
        visited.push(path);
        return folders[path];
    });
    assert.deepEqual(paths, [
        '/books/Book 2.CBZ', '/books/Book 10.zip',
        '/books/Series 2/Book.epub', '/books/Series 2/Book.mp3', '/books/Series 2/Book.pdf', '/books/Series 2/Book.txt',
        '/books/Series 2/nested/Chapter 2.cb7', '/books/Series 2/nested/Chapter 10.cbr',
        '/books/Series 10/End.7z',
    ]);
    assert.deepEqual(visited, ['/books', '/books/Series 2', '/books/Series 2/nested', '/books/Series 10']);
});

test('cover folder collection skips backup folders, hidden folders, links, and unsafe names', async () => {
    const visited = [];
    const paths = await collectCoverEditorFolderPaths('/books', async path => {
        visited.push(path);
        return [
            directory('bak'), directory('BAK'), directory('.hidden'),
            { name: 'linked', isFile: false, isDirectory: false },
            { name: 'linked.zip', isFile: false, isDirectory: false },
            file('../escape.zip'), file('nested/escape.zip'), file('nested\\escape.zip'), file('bad\0.zip'),
            directory('.'), directory('..'), directory(''), null,
            file('book.zip'),
        ];
    });
    assert.deepEqual(paths, ['/books/book.zip']);
    assert.deepEqual(visited, ['/books']);
});

test('cover folder collection preserves POSIX roots, drive roots, and UNC path separators', async () => {
    for (const [root, child, nested] of [
        ['/', '/book.zip', '/series/book.zip'],
        ['C:\\', 'C:\\book.zip', 'C:\\series\\book.zip'],
        ['C:/books/', 'C:/books/book.zip', 'C:/books/series/book.zip'],
        ['\\\\server\\share\\', '\\\\server\\share\\book.zip', '\\\\server\\share\\series\\book.zip'],
    ]) {
        const paths = await collectCoverEditorFolderPaths(root, async path => path === root ? [file('book.zip'), directory('series')] : [file('book.zip')]);
        assert.deepEqual(paths, [child, nested], root);
    }
});

test('cover folder collection stops when cancelled before reading or after an awaited read', async () => {
    let reads = 0;
    assert.deepEqual(await collectCoverEditorFolderPaths('/books', async () => { reads += 1; }, () => true), []);
    assert.equal(reads, 0);

    let cancelled = false;
    const result = await collectCoverEditorFolderPaths('/books', async () => {
        reads += 1;
        cancelled = true;
        return [file('book.zip'), directory('nested')];
    }, () => cancelled);
    assert.deepEqual(result, []);
    assert.equal(reads, 1);
});

test('cover folder collection discards partial results and does not read more directories after cancellation', async () => {
    const visited = [];
    let cancelled = false;
    const result = await collectCoverEditorFolderPaths('/books', async path => {
        visited.push(path);
        if (path === '/books') return [file('book.zip'), directory('Series 1'), directory('Series 2')];
        cancelled = true;
        return [file('chapter.zip')];
    }, () => cancelled);
    assert.deepEqual(result, []);
    assert.deepEqual(visited, ['/books', '/books/Series 1']);
});

test('cover folder collection checks cancellation while walking a directory listing', async () => {
    let checks = 0;
    const visited = [];
    const result = await collectCoverEditorFolderPaths('/books', async path => {
        visited.push(path);
        return [file('Book 1.zip'), file('Book 2.zip'), directory('nested')];
    }, () => ++checks > 4);
    assert.deepEqual(result, []);
    assert.deepEqual(visited, ['/books']);
});

test('cover folder collection propagates reader failures without yielding partial paths', async () => {
    const failure = new Error('Cannot read directory');
    await assert.rejects(collectCoverEditorFolderPaths('/books', async path => {
        if (path === '/books') return [file('book.zip'), directory('nested')];
        throw failure;
    }), error => error === failure);
});

test('cover folder collection handles missing paths and empty listings', async () => {
    let reads = 0;
    const readDir = async () => { reads += 1; return null; };
    assert.deepEqual(await collectCoverEditorFolderPaths('', readDir), []);
    assert.deepEqual(await collectCoverEditorFolderPaths(null, readDir), []);
    assert.equal(reads, 0);
    assert.deepEqual(await collectCoverEditorFolderPaths('/books', readDir), []);
    assert.equal(reads, 1);
});
