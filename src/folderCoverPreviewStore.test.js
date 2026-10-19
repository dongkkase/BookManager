import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderCoverPreviewStore, folderCoverPreviewKey, folderPreviewMetadataUpdate } from './folderCoverPreviewStore.js';

const file = (path = '/library/book.cbz', overrides = {}) => ({ path, mtime: 10, size: 100, cover: '', ...overrides });

test('cover-only results notify only the corresponding card without changing source records', () => {
    const store = createFolderCoverPreviewStore();
    const first = file();
    const second = file('/library/other.cbz');
    let firstChanges = 0;
    let secondChanges = 0;
    store.subscribe(store.key(first), () => firstChanges++);
    store.subscribe(store.key(second), () => secondChanges++);
    const preview = { ...first, cover: 'cover.jpg', thumb_path: '/cache/cover.jpg' };
    store.publish(first, preview);
    assert.equal(firstChanges, 1);
    assert.equal(secondChanges, 0);
    assert.equal(first.cover, '');
    assert.equal(store.resolve(first).cover, 'cover.jpg');
    assert.equal(store.resolve(second), second);
    assert.equal(folderPreviewMetadataUpdate(first, preview), null);
    const snapshot = store.snapshot(first);
    store.publish(first, { ...preview });
    assert.equal(store.snapshot(first), snapshot);
    assert.equal(firstChanges, 1);
});

test('preview metadata updates preserve meaningful changes and existing duplicate results', () => {
    const source = file(undefined, { name: 'Book', page_count: '', tags: ['comic'], duplicate_matches: [{ path: '/copy' }], dup_count: 1 });
    assert.equal(folderPreviewMetadataUpdate(source, { ...source, tags: ['comic'], cover: 'cover.jpg', cache_source: 'archive', duplicate_matches: [], dup_count: 0 }), null);
    assert.deepEqual(folderPreviewMetadataUpdate(source, { ...source, cover: 'cover.jpg', page_count: 150, title: 'New title', rating: '8' }), {
        path: source.path, isDirectory: source.isDirectory, page_count: 150, title: 'New title', rating: '8',
    });
});

test('new raw covers and file versions take priority over previous preview overlays', () => {
    const store = createFolderCoverPreviewStore();
    const source = file();
    store.publish(source, { ...source, cover: 'old-preview.jpg' });
    const edited = { ...source, cover: 'edited.jpg' };
    assert.equal(store.resolve(edited), edited);
    const changed = { ...source, mtime: 11 };
    assert.equal(store.resolve(changed), changed);
    store.clear();
    assert.equal(store.resolve(source), source);
});

test('preview survives metadata hydration and cached navigation while changed folders invalidate it', () => {
    const store = createFolderCoverPreviewStore();
    const source = file('/library/folder', { isDirectory: true, mtime: 0, size: 0 });
    const preview = { ...source, mtime: 10, cover: 'folder.jpg', cover_file_path: '/library/folder/book.cbz' };
    store.publish(source, preview);
    assert.equal(store.resolve(source).cover, 'folder.jpg');
    assert.equal(store.resolve({ ...source, mtime: 10 }).cover, 'folder.jpg');
    const other = file('/other/folder', { isDirectory: true });
    store.publish(other, { ...other, cover: 'other.jpg' });
    assert.equal(store.resolve(source).cover, 'folder.jpg');
    assert.equal(store.snapshot({ ...source, mtime: 11 }), null);
    assert.equal(store.snapshot({ ...source, isDirectory: false }), null);
});

test('evicted previews can be requested again and subscribed visible covers remain available', () => {
    const evicted = [];
    const store = createFolderCoverPreviewStore({ limit: 2, onEvict: key => evicted.push(key) });
    const first = file('/one');
    const second = file('/two');
    const third = file('/three');
    const unsubscribe = store.subscribe(store.key(first), () => {});
    for (const source of [first, second, third]) store.publish(source, { ...source, cover: source.path + '.jpg' });
    assert.equal(store.resolve(first).cover, '/one.jpg');
    assert.equal(store.resolve(second), second);
    assert.deepEqual(evicted, [folderCoverPreviewKey(second)]);
    unsubscribe();
    store.clear();
    assert.equal(store.snapshot(first), null);
});
