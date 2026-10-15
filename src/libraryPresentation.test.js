import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLibraryItems,
    groupLibraryItems,
    libraryDisplayName,
} from './libraryPresentation.js';

test('library display names prefer aliases and fall back to folder or root names', () => {
    assert.equal(libraryDisplayName('/Volumes/Books/Comics/', '만화 서재'), '만화 서재');
    assert.equal(libraryDisplayName('/Volumes/Books/Comics/'), 'Comics');
    assert.equal(libraryDisplayName('D:\\Books\\Novels\\'), 'Novels');
    assert.equal(libraryDisplayName('D:\\'), 'D:');
    assert.equal(libraryDisplayName('\\\\NAS\\Books\\'), 'Books');
    assert.equal(libraryDisplayName('/'), '/');
    assert.equal(libraryDisplayName(''), '');
});

test('library items preserve configured order and match normalized metadata paths', () => {
    const items = buildLibraryItems(['C:\\Books\\', '/Volumes/Comics', '/Audio'], [
        { path: '/Volumes/Comics/', alias: '만화', group: 'NAS' },
        { path: ' c:\\books ', alias: '책', group: 'Local' },
        { path: '/Other', alias: 'Unused', group: 'Other' },
        null,
    ]);

    assert.deepEqual(items, [
        { path: 'C:\\Books\\', index: 0, name: '책', group: 'Local' },
        { path: '/Volumes/Comics', index: 1, name: '만화', group: 'NAS' },
        { path: '/Audio', index: 2, name: 'Audio', group: '' },
    ]);
});

test('group order follows first appearance and repeated groups preserve library order', () => {
    const libraries = ['/Comics', '/Audio', '/Novels', '/PDF', '/Text'];
    const items = buildLibraryItems(libraries, [
        { path: '/Comics', group: 'NAS' },
        { path: '/Audio', group: '' },
        { path: '/Novels', group: 'Local' },
        { path: '/PDF', group: 'NAS' },
        { path: '/Text', group: '' },
    ]);

    assert.deepEqual(groupLibraryItems(items), [
        { key: 'NAS', label: 'NAS', items: [items[0], items[3]] },
        { key: '', label: '', items: [items[1], items[4]] },
        { key: 'Local', label: 'Local', items: [items[2]] },
    ]);
});

test('ungrouped libraries keep an empty label so the sidebar does not show a group header', () => {
    const items = buildLibraryItems(['/Books', '/Comics']);
    assert.deepEqual(groupLibraryItems(items), [{ key: '', label: '', items }]);
    assert.deepEqual(groupLibraryItems(), []);
    assert.deepEqual(buildLibraryItems(), []);
});

test('building and grouping library items leaves input arrays and objects unchanged', () => {
    const libraries = Object.freeze(['/Comics', '/Books']);
    const entries = Object.freeze([
        Object.freeze({ path: '/Comics', alias: '만화', group: 'NAS' }),
        Object.freeze({ path: '/Books', alias: '도서', group: 'NAS' }),
    ]);
    const items = Object.freeze(buildLibraryItems(libraries, entries).map(Object.freeze));
    const groups = groupLibraryItems(items);

    assert.deepEqual(libraries, ['/Comics', '/Books']);
    assert.deepEqual(entries, [
        { path: '/Comics', alias: '만화', group: 'NAS' },
        { path: '/Books', alias: '도서', group: 'NAS' },
    ]);
    assert.notEqual(groups[0].items, items);
    assert.equal(groups[0].items[0], items[0]);
    assert.deepEqual(items.map(item => item.index), [0, 1]);
});
