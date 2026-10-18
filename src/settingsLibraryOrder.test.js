import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLibraryItems } from './libraryPresentation.js';
import { normalizeLibraryEntries, syncLibraryConfig } from './settingsPolicy.js';
import { moveLibraryEntry, moveLibraryGroup } from './settingsLibraryOrder.js';

const entries = Object.freeze([
    Object.freeze({ path: '/Books', alias: '도서', group: 'NAS', custom: 'preserve' }),
    Object.freeze({ path: '/Downloads', alias: '', group: '' }),
    Object.freeze({ path: '/Comics', alias: '만화', group: 'Local' }),
    Object.freeze({ path: '/Novels', alias: '소설', group: 'NAS' }),
    Object.freeze({ path: '/Audio', alias: '오디오북', group: '' }),
]);

function paths(items) {
    return items.map(item => item.path);
}

function groupKeys(items) {
    return groupLibraryItems(items).map(group => group.key);
}

test('moving a folder within its group preserves surrounding group order', () => {
    const moved = moveLibraryEntry(entries, '/Books', { group: 'NAS', targetPath: '/Novels', position: 'after' });
    assert.deepEqual(paths(moved), ['/Novels', '/Books', '/Downloads', '/Audio', '/Comics']);
    assert.deepEqual(groupKeys(moved), ['NAS', '', 'Local']);
    assert.equal(moved[1], entries[0]);
    assert.deepEqual(paths(moveLibraryEntry(moved, '/Books', { group: 'NAS', targetPath: '/Novels', position: 'before' })),
        ['/Books', '/Novels', '/Downloads', '/Audio', '/Comics']);
});

test('dropping a folder on a group appends it and assigns the group without losing metadata', () => {
    const moved = moveLibraryEntry(entries, '/Books', { group: 'Local' });
    assert.deepEqual(paths(moved), ['/Novels', '/Downloads', '/Audio', '/Comics', '/Books']);
    assert.deepEqual(groupKeys(moved), ['NAS', '', 'Local']);
    assert.deepEqual(moved.at(-1), { path: '/Books', alias: '도서', group: 'Local', custom: 'preserve' });
    assert.notEqual(moved.at(-1), entries[0]);
    assert.equal(entries[0].group, 'NAS');
    for (const entry of moved.slice(0, -1)) assert.equal(entry, entries.find(item => item.path === entry.path));
});

test('dropping next to a folder transfers its group and respects before and after positions', () => {
    const before = moveLibraryEntry(entries, '/Comics', { group: 'NAS', targetPath: '/Novels', position: 'before' });
    assert.deepEqual(paths(before), ['/Books', '/Comics', '/Novels', '/Downloads', '/Audio']);
    assert.deepEqual(groupKeys(before), ['NAS', '']);
    assert.equal(before[1].group, 'NAS');
    const after = moveLibraryEntry(entries, '/Comics', { group: 'NAS', targetPath: '/Novels', position: 'after' });
    assert.deepEqual(paths(after), ['/Books', '/Novels', '/Comics', '/Downloads', '/Audio']);
    assert.equal(after[2].group, 'NAS');
});

test('folders can leave a group for an existing or newly created ungrouped section', () => {
    const moved = moveLibraryEntry(entries, '/Comics', { group: '' });
    assert.deepEqual(paths(moved), ['/Books', '/Novels', '/Downloads', '/Audio', '/Comics']);
    assert.equal(moved.at(-1).group, '');
    assert.deepEqual(groupKeys(moved), ['NAS', '']);

    const grouped = entries.filter(entry => entry.group);
    const ungrouped = moveLibraryEntry(grouped, '/Books', { group: '' });
    assert.deepEqual(paths(ungrouped), ['/Novels', '/Comics', '/Books']);
    assert.deepEqual(groupKeys(ungrouped), ['NAS', 'Local', '']);
    assert.equal(ungrouped.at(-1).group, '');
});

test('moving groups carries all members in their existing order, including ungrouped folders', () => {
    const moved = moveLibraryGroup(entries, 'Local', 'NAS', 'before');
    assert.deepEqual(paths(moved), ['/Comics', '/Books', '/Novels', '/Downloads', '/Audio']);
    assert.deepEqual(groupKeys(moved), ['Local', 'NAS', '']);
    assert.deepEqual(paths(moveLibraryGroup(entries, 'NAS', 'Local', 'after')),
        ['/Downloads', '/Audio', '/Comics', '/Books', '/Novels']);
    assert.deepEqual(paths(moveLibraryGroup(entries, '', 'NAS', 'before')),
        ['/Downloads', '/Audio', '/Books', '/Novels', '/Comics']);
    for (const entry of moved) assert.equal(entry, entries.find(item => item.path === entry.path));
});

test('same-location drops preserve the original config order instead of flattening it', () => {
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'NAS', targetPath: '/Books' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'NAS', targetPath: '/Novels', position: 'before' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Novels', { group: 'NAS', targetPath: '/Books', position: 'after' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Novels', { group: 'NAS' }), entries);
    assert.equal(moveLibraryGroup(entries, 'NAS', 'NAS'), entries);
    assert.equal(moveLibraryGroup(entries, 'NAS', '', 'before'), entries);
    assert.equal(moveLibraryGroup(entries, '', 'NAS', 'after'), entries);
});

test('stale or inconsistent drag targets leave folder settings untouched', () => {
    assert.equal(moveLibraryEntry(entries, '/Missing', { group: 'NAS' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'Missing' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'NAS', targetPath: '/Missing' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'Local', targetPath: '/Novels' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', { group: 'NAS', position: 'unknown' }), entries);
    assert.equal(moveLibraryEntry(entries, '/Books'), entries);
    assert.equal(moveLibraryEntry(entries, '/Books', null), entries);
    assert.equal(moveLibraryGroup(entries, 'Missing', 'NAS'), entries);
    assert.equal(moveLibraryGroup(entries, 'NAS', 'Missing'), entries);
    assert.equal(moveLibraryGroup(entries, 'NAS', 'Local', 'unknown'), entries);
    assert.deepEqual(moveLibraryEntry([], '/Books', { group: '' }), []);
    assert.deepEqual(moveLibraryGroup([], '', 'NAS'), []);
});

test('group and folder moves survive saving and normalizing library configuration', () => {
    const transferred = moveLibraryEntry(entries, '/Books', { group: 'Local' });
    const reordered = moveLibraryGroup(transferred, 'Local', 'NAS');
    const saved = syncLibraryConfig({ unrelated: true }, reordered);
    assert.equal(saved.unrelated, true);
    assert.deepEqual(saved.libraries, ['/Comics', '/Books', '/Novels', '/Downloads', '/Audio']);
    assert.deepEqual(saved.dup_check_folders, saved.libraries);
    assert.deepEqual(groupKeys(normalizeLibraryEntries(saved)), ['Local', 'NAS', '']);
    assert.deepEqual(normalizeLibraryEntries(saved).find(entry => entry.path === '/Books'),
        { path: '/Books', alias: '도서', group: 'Local' });
});
