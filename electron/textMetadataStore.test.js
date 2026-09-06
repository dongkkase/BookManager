import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { getTextContentHash, isTextMetadataPath, resolveTextMetadata, saveTextMetadata } from './textMetadataStore.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-text-metadata-'));
    const dbPath = path.join(root, 'data', 'library.db');
    const libraryDb = new LibraryDB({ dbPath });
    const filePath = path.join(root, 'book.txt');
    await fs.writeFile(filePath, 'The original book body.');
    t.after(async () => {
        libraryDb.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, dbPath, libraryDb, filePath };
}

test('TXT identity uses complete content and only enables the requested format', async t => {
    const { root, filePath } = await fixture(t);
    assert.equal(isTextMetadataPath('book.TXT'), true);
    assert.equal(isTextMetadataPath('book.md'), false);
    const second = path.join(root, 'second.txt');
    const content = Buffer.alloc(1024 * 1024, 'a');
    await fs.writeFile(filePath, content);
    content[300000] = 'b'.charCodeAt(0);
    await fs.writeFile(second, content);
    assert.notEqual(await getTextContentHash(filePath), await getTextContentHash(second));
});

test('metadata and custom covers survive move, index/cache clearing and database reopen without changing TXT', async t => {
    const { root, dbPath, libraryDb, filePath } = await fixture(t);
    const source = await fs.readFile(filePath);
    const before = await fs.stat(filePath);
    const imagePath = path.join(root, 'selected-cover.png');
    await fs.writeFile(imagePath, PNG);
    const metadata = { Title: 'Saved title', Writer: 'Saved author', Summary: '', CustomField: 'preserved' };
    const saved = await saveTextMetadata(filePath, {
        libraryDb, metadata,
        record: { title: metadata.Title, writer: metadata.Writer, summary: '' },
        coverChange: { type: 'file', filePath: imagePath },
    });
    assert.equal(path.dirname(saved.coverPath), path.join(path.dirname(dbPath), 'text-thumbnails'));
    assert.deepEqual(await fs.readFile(filePath), source);
    assert.equal((await fs.stat(filePath)).mtimeMs, before.mtimeMs);
    const moved = path.join(root, 'renamed.txt');
    await fs.rename(filePath, moved);
    const recovered = await resolveTextMetadata(moved, { libraryDb });
    assert.deepEqual(recovered.metadata, metadata);
    assert.equal(await libraryDb.getFileInfo(filePath), null);
    libraryDb.getConnection().exec('DELETE FROM files');
    await fs.rm(path.join(path.dirname(dbPath), 'thumbnails'), { recursive: true, force: true });
    await fs.rm(imagePath);
    libraryDb.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        const restored = await resolveTextMetadata(moved, { libraryDb: reopened });
        assert.deepEqual(restored.metadata, metadata);
        assert.equal(restored.record.book_type, 'book');
        assert.equal(restored.record.path, moved);
        assert.deepEqual(await fs.readFile(restored.coverPath), PNG);
        assert.equal((await reopened.getFileInfo(moved)).writer, 'Saved author');
    } finally {
        reopened.close();
    }
});

test('same bytes share metadata while unrelated same-name same-size files do not match', async t => {
    const { root, filePath, libraryDb } = await fixture(t);
    await saveTextMetadata(filePath, { libraryDb, metadata: { Title: 'Original' }, record: { title: 'Original' } });
    const copyPath = path.join(root, 'copy.txt');
    await fs.copyFile(filePath, copyPath);
    assert.equal((await resolveTextMetadata(copyPath, { libraryDb })).metadata.Title, 'Original');
    assert.ok(await libraryDb.getFileInfo(filePath));
    const folder = path.join(root, 'unrelated');
    await fs.mkdir(folder);
    const unrelated = path.join(folder, 'book.txt');
    await fs.writeFile(unrelated, Buffer.alloc((await fs.stat(filePath)).size, 'z'));
    assert.equal(await resolveTextMetadata(unrelated, { libraryDb }), null);
});

test('explicit empty metadata fields remain empty after save and retrieval', async t => {
    const { libraryDb, filePath } = await fixture(t);
    await saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'Old', Writer: 'Old', Summary: 'Old' },
        record: { title: 'Old', writer: 'Old', summary: 'Old' },
    });
    await saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: '', Writer: '', Summary: '', CommunityRating: 0 },
        record: { title: '', writer: '', summary: '', rating: 0 },
    });
    const restored = await resolveTextMetadata(filePath, { libraryDb });
    assert.deepEqual(restored.metadata, { Title: '', Writer: '', Summary: '', CommunityRating: 0 });
    assert.equal((await libraryDb.getFileInfo(filePath)).title, '');
    assert.equal((await libraryDb.getFileInfo(filePath)).writer, '');
});

test('saving shared TXT metadata updates matching copies in search atomically and leaves replaced copies alone', async t => {
    const { root, filePath, libraryDb } = await fixture(t);
    const saved = await saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'Old shared title' }, record: { title: 'Old shared title' },
    });
    const copyPath = path.join(root, 'copy.txt');
    const replacedPath = path.join(root, 'replaced.txt');
    for (const linkedPath of [copyPath, replacedPath]) {
        await fs.copyFile(filePath, linkedPath);
        await resolveTextMetadata(linkedPath, { libraryDb });
    }
    await fs.utimes(copyPath, new Date('2020-01-01'), new Date('2020-01-01'));
    await fs.writeFile(replacedPath, Buffer.alloc((await fs.stat(replacedPath)).size, 'x'));
    await libraryDb.upsertFileInfo({ path: replacedPath, title: 'Replacement title' });
    await libraryDb.prepareSearchIndex();
    await saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'New shared title' }, record: { title: 'New shared title' },
    });
    const results = await libraryDb.searchFiles('New shared title', [root], { limit: 10 });
    assert.deepEqual(results.map(row => row.path).sort(), [filePath, copyPath].sort());
    assert.equal((await libraryDb.getFileInfo(copyPath)).mtime, (await fs.stat(copyPath)).mtimeMs / 1000);
    assert.equal((await libraryDb.getFileInfo(replacedPath)).title, 'Replacement title');
    libraryDb.getConnection().exec(`
        CREATE TRIGGER reject_shared_copy_update BEFORE UPDATE ON files
        WHEN NEW.path LIKE '%copy.txt'
        BEGIN SELECT RAISE(ABORT, 'copy update failure'); END;
    `);
    await assert.rejects(saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'Failed shared title' }, record: { title: 'Failed shared title' },
    }), /copy update failure/);
    assert.equal((await libraryDb.getTextMetadata(saved.contentHash)).metadata.Title, 'New shared title');
    assert.equal((await libraryDb.getFileInfo(filePath)).title, 'New shared title');
    assert.equal((await libraryDb.getFileInfo(copyPath)).title, 'New shared title');
});

test('replacement at a previously known path cannot inherit stale metadata or receive an old editor save', async t => {
    const { filePath, libraryDb } = await fixture(t);
    const saved = await saveTextMetadata(filePath, { libraryDb, metadata: { Title: 'Old' }, record: { title: 'Old' } });
    await fs.writeFile(filePath, 'A different body length.');
    assert.equal(await resolveTextMetadata(filePath, { libraryDb }), null);
    await assert.rejects(saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'Stale edit' }, record: { title: 'Stale edit' },
        expectedContentHash: saved.contentHash,
    }), /content has changed/);
    assert.equal((await libraryDb.getTextMetadata(saved.contentHash)).metadata.Title, 'Old');
});

test('legacy manual metadata migrates once while filename-inferred metadata is left alone', async t => {
    const { filePath, libraryDb } = await fixture(t);
    await libraryDb.upsertFileInfo({ path: filePath, title: 'book', series: 'book', volume: '1', metadata_override: 0, has_metadata: 0 });
    assert.equal(await resolveTextMetadata(filePath, { libraryDb }), null);
    await libraryDb.upsertFileInfo({ path: filePath, title: 'book', writer: 'Legacy author', summary: 'Legacy summary' });
    const migrated = await resolveTextMetadata(filePath, { libraryDb });
    assert.equal(migrated.metadata.Writer, 'Legacy author');
    assert.equal(migrated.record.summary, 'Legacy summary');
    await fs.writeFile(filePath, 'Replacement');
    assert.equal(await resolveTextMetadata(filePath, { libraryDb }), null);
});

test('legacy metadata saves without index flags preserve series-only edits', async t => {
    const { filePath, libraryDb } = await fixture(t);
    await libraryDb.upsertFileInfo({ path: filePath, title: 'book', series: 'Edited series', language: 'ko' });
    const legacy = await libraryDb.getFileInfo(filePath);
    assert.equal(legacy.has_metadata, '');
    assert.equal(legacy.metadata_override, '');
    const migrated = await resolveTextMetadata(filePath, { libraryDb });
    assert.equal(migrated.metadata.Series, 'Edited series');
    assert.equal(migrated.metadata.LanguageISO, 'ko');
});

test('database failure rolls back durable metadata and index and removes the new cover', async t => {
    const { root, filePath, libraryDb } = await fixture(t);
    const imagePath = path.join(root, 'cover.png');
    await fs.writeFile(imagePath, PNG);
    const saved = await saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'Before' }, record: { title: 'Before' },
        coverChange: { type: 'file', filePath: imagePath },
    });
    libraryDb.getConnection().exec(`
        CREATE TRIGGER reject_text_save BEFORE UPDATE ON files
        BEGIN SELECT RAISE(ABORT, 'test index failure'); END;
    `);
    await assert.rejects(saveTextMetadata(filePath, {
        libraryDb, metadata: { Title: 'After' }, record: { title: 'After' },
        coverChange: { type: 'file', filePath: imagePath },
    }), /test index failure/);
    assert.equal((await libraryDb.getTextMetadata(saved.contentHash)).metadata.Title, 'Before');
    assert.equal((await libraryDb.getFileInfo(filePath)).title, 'Before');
    assert.deepEqual(await fs.readdir(path.dirname(saved.coverPath)), [path.basename(saved.coverPath)]);
    assert.deepEqual(await fs.readFile(saved.coverPath), PNG);
});

test('cover changes validate bytes and size and reset active cover references', async t => {
    const { root, filePath, libraryDb } = await fixture(t);
    const imagePath = path.join(root, 'cover.png');
    await fs.writeFile(imagePath, 'not an image');
    await assert.rejects(saveTextMetadata(filePath, {
        libraryDb, metadata: {}, record: {}, coverChange: { type: 'file', filePath: imagePath },
    }), /must be a PNG/);
    const handle = await fs.open(imagePath, 'w');
    await handle.truncate(16 * 1024 * 1024 + 1);
    await handle.close();
    await assert.rejects(saveTextMetadata(filePath, {
        libraryDb, metadata: {}, record: {}, coverChange: { type: 'file', filePath: imagePath },
    }), /16 MiB/);
    await fs.writeFile(imagePath, PNG);
    const first = await saveTextMetadata(filePath, {
        libraryDb, metadata: {}, record: {}, coverChange: { type: 'file', filePath: imagePath },
    });
    const second = await saveTextMetadata(filePath, {
        libraryDb, metadata: {}, record: {}, coverChange: { type: 'file', filePath: imagePath },
    });
    assert.notEqual(first.coverPath, second.coverPath);
    const reset = await saveTextMetadata(filePath, {
        libraryDb, metadata: {}, record: {}, coverChange: { type: 'reset' },
    });
    assert.equal(reset.coverPath, '');
    assert.equal((await resolveTextMetadata(filePath, { libraryDb })).record.thumb_path, '');
});

test('in-app moves retain known path identity and explicit empty titles', async t => {
    const { root, filePath, libraryDb } = await fixture(t);
    const saved = await saveTextMetadata(filePath, { libraryDb, metadata: { Title: '' }, record: { title: '' } });
    const destination = path.join(root, 'moved.txt');
    await fs.rename(filePath, destination);
    await libraryDb.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: filePath, dest: destination }] });
    assert.equal(await libraryDb.getTextMetadataPathHash(destination), saved.contentHash);
    assert.equal((await libraryDb.getFileInfo(destination)).title, '');
    await fs.writeFile(destination, 'replacement');
    assert.equal(await resolveTextMetadata(destination, { libraryDb }), null);
});
