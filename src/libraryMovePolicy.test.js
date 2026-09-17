import test from 'node:test';
import assert from 'node:assert/strict';

import { applyConflictChoice, createLibraryMovePlans, expandLibraryMovePlans, libraryMoveFolderSources } from './libraryMovePolicy.js';

test('createLibraryMovePlans updates destinations with the folder option', () => {
    const source = '/source/Series/Book.cbz';
    assert.equal(
        createLibraryMovePlans([source], '/library', { createCurrentFolder: true })[0].dest,
        '/library/Series/Book.cbz',
    );
    assert.equal(
        createLibraryMovePlans([source], '/library', { createCurrentFolder: false })[0].dest,
        '/library/Book.cbz',
    );
});

test('folder mode always moves the folder itself', () => {
    const plan = createLibraryMovePlans(
        ['/source/Series'],
        '/library',
        { createCurrentFolder: false, folderMode: true },
    )[0];
    assert.equal(plan.dest, '/library/Series');
});

test('conflict choices remain scoped to one plan', () => {
    const first = applyConflictChoice({ src: 'a', dest: 'x' }, 'overwrite');
    const second = { src: 'b', dest: 'y' };
    assert.equal(first.conflictAction, 'overwrite');
    assert.equal(second.conflictAction, undefined);
});

test('list folder moves include all selected folders without duplicate descendants', () => {
    const entries = ['/source/A', '/source/B', '/source/A/nested'].map(path => ({ path, isDirectory: true }));
    entries.push({ path: '/source/file.cbz', isDirectory: false });
    assert.deepEqual(libraryMoveFolderSources({ source: 'list', folderPath: '/source/B' }, entries), ['/source/A', '/source/B']);
    assert.deepEqual(libraryMoveFolderSources({ folderPath: '/source/B' }, entries), ['/source/B']);
    assert.deepEqual(libraryMoveFolderSources({ source: 'list', folderPath: '/source/C' }, entries), ['/source/C']);
});

test('folder moves exclude unchanged destinations', () => {
    assert.deepEqual(createLibraryMovePlans(['/library/A'], '/library', { folderMode: true }), []);
});

test('same-name source folders are both expanded even before the destination exists', async () => {
    const plans = createLibraryMovePlans(['/first/Series', '/second/Series', '/third/Other'], '/library', { folderMode: true });
    const expanded = [];
    const result = await expandLibraryMovePlans(plans, {
        exists: async () => false,
        expandFolderMove: async (src, dest) => {
            expanded.push(src);
            return { success: true, plans: [{ src: `${src}/book.cbz`, dest: `${dest}/book.cbz` }] };
        },
    });
    assert.deepEqual(expanded, ['/first/Series', '/second/Series']);
    assert.equal(result.length, 3);
    assert.equal(result[2], plans[2]);
});

test('folder expansion failures stop preparation instead of silently dropping a folder', async () => {
    const plans = createLibraryMovePlans(['/source/A', '/source/B'], '/library', { folderMode: true });
    await assert.rejects(expandLibraryMovePlans(plans, {
        exists: async () => true,
        expandFolderMove: async () => ({ success: false, message: 'Folder unavailable' }),
    }), /Folder unavailable/);
});
