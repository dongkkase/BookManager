import test from 'node:test';
import assert from 'node:assert/strict';

import { applyConflictChoice, createLibraryMovePlans } from './libraryMovePolicy.js';

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
