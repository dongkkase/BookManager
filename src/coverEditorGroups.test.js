import assert from 'node:assert/strict';
import test from 'node:test';
import { coverEditorFolder, groupCoverEditorEntries } from './coverEditorGroups.js';

test('files are grouped by their containing folder and retain their original row indices', () => {
    const entries = ['/books/A/one.cbz', '/books/B/two.epub', '/books/A/three.cbz', '/books/A/nested/four.txt']
        .map(filePath => ({ filePath }));
    const groups = groupCoverEditorEntries(entries);
    assert.deepEqual(groups.map(group => group.path), ['/books/A', '/books/B', '/books/A/nested']);
    assert.deepEqual(groups.map(group => group.entries.map(({ index }) => index)), [[0, 2], [1], [3]]);
    assert.equal(groups[0].entries[1].entry, entries[2]);
});

test('folder keys normalize Windows separators, case and Unicode without merging distinct POSIX folders', () => {
    assert.equal(coverEditorFolder('C:\\Books\\Series\\a.cbz').key, coverEditorFolder('c:/books/series/b.epub').key);
    assert.equal(coverEditorFolder('\\\\Server\\Share\\Series\\a.cbz').key, coverEditorFolder('//server/share/series/b.cbz').key);
    assert.equal(coverEditorFolder('/books/가/a.cbz').key, coverEditorFolder('/books/가/b.cbz'.normalize('NFD')).key);
    assert.notEqual(coverEditorFolder('/books/A/a.cbz').key, coverEditorFolder('/books/a/b.cbz').key);
    assert.notEqual(coverEditorFolder('/books/A/Series/a.cbz').key, coverEditorFolder('/books/B/Series/b.cbz').key);
    assert.deepEqual(coverEditorFolder('/book.cbz'), { path: '/', key: '/', name: '/' });
    assert.deepEqual(coverEditorFolder('book.cbz'), { path: '', key: '', name: '' });
    assert.deepEqual(groupCoverEditorEntries([]), []);
});
