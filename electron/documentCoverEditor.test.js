import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { getTextContentHash, resolveTextMetadata, saveTextMetadata } from './textMetadataStore.js';
import { LOCAL_COVER_OVERRIDE_PREFIX, saveLocalCoverOverride, saveTextCoverOnly, writeAudioCoverOnly } from './documentCoverEditor.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');

async function fixture(t, extension = '.txt') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-document-cover-'));
    const dbPath = path.join(root, 'data', 'library.db');
    const thumbnailDir = path.join(root, 'data', 'thumbnails');
    const filePath = path.join(root, `book${extension}`);
    const imagePath = path.join(root, 'cover.png');
    const libraryDb = new LibraryDB({ dbPath });
    await fs.writeFile(filePath, 'Original book content\r\nSecond line.');
    await fs.writeFile(imagePath, PNG);
    t.after(async () => {
        await libraryDb.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, dbPath, libraryDb, thumbnailDir, filePath, imagePath };
}

test('TXT cover-only replacement preserves source bytes, timestamps, complete metadata and index fields', async t => {
    const value = await fixture(t);
    const { filePath, imagePath, libraryDb } = value;
    const metadata = { Title: '', Writer: 'Saved writer', Summary: 'First\nSecond', CustomField: 'Untouched' };
    const record = { title: '', writer: 'Saved writer', summary: 'First\nSecond', notes: 'Preserve record only field', number: '1064', language: '' };
    const initial = await saveTextMetadata(filePath, { libraryDb, metadata, record });
    const source = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    const result = await saveTextCoverOnly(filePath, imagePath, { ...value, expectedContentHash: initial.contentHash });
    const saved = await resolveTextMetadata(filePath, { libraryDb });
    assert.deepEqual(await fs.readFile(filePath), source);
    assert.equal((await fs.stat(filePath)).mtimeMs, stat.mtimeMs);
    assert.deepEqual(saved.metadata, metadata);
    for (const [key, expected] of Object.entries(record)) assert.equal(saved.record[key], expected, key);
    assert.equal(result.contentHash, initial.contentHash);
    assert.equal(result.coverPath, saved.coverPath);
    assert.deepEqual(await fs.readFile(result.coverPath), PNG);
});

test('TXT cover-only save refuses changed source identity and rolls back a failed DB save', async t => {
    const value = await fixture(t);
    const { filePath, imagePath, libraryDb } = value;
    const first = await saveTextCoverOnly(filePath, imagePath, value);
    await assert.rejects(saveTextCoverOnly(filePath, imagePath, { ...value, expectedContentHash: 'stale' }), /content has changed/);
    libraryDb.getConnection().exec(`
        CREATE TRIGGER reject_text_cover BEFORE UPDATE ON text_metadata
        BEGIN SELECT RAISE(ABORT, 'test save failure'); END;
    `);
    const directory = path.dirname(first.coverPath);
    const before = await fs.readdir(directory);
    await assert.rejects(saveTextCoverOnly(filePath, imagePath, value), /test save failure/);
    assert.deepEqual(await fs.readdir(directory), before);
    assert.equal((await resolveTextMetadata(filePath, { libraryDb })).coverPath, first.coverPath);
});

test('cover-only TXT metadata is recovered by content identity after moving the source', async t => {
    const value = await fixture(t);
    const metadata = { Title: 'Persisted title', Custom: 'Keep this' };
    await saveTextMetadata(value.filePath, { libraryDb: value.libraryDb, metadata, record: { title: metadata.Title } });
    const movedPath = path.join(value.root, 'moved.txt');
    await fs.rename(value.filePath, movedPath);
    const result = await saveTextCoverOnly(movedPath, value.imagePath, { dbPath: value.dbPath, thumbnailDir: value.thumbnailDir });
    assert.equal(result.contentHash, await getTextContentHash(movedPath));
    assert.deepEqual((await resolveTextMetadata(movedPath, { libraryDb: value.libraryDb })).metadata, metadata);
});

test('generic cover overrides preserve PDF and unsupported audio bytes and every existing metadata column', async t => {
    for (const extension of ['.pdf', '.webm']) {
        await t.test(extension, async t => {
            const value = await fixture(t, extension);
            const { filePath, imagePath, libraryDb } = value;
            await libraryDb.upsertFileInfo({ path: filePath, title: 'Keep title', writer: 'Keep author', metadata_override: 1, album: 'Keep album', notes: 'Keep notes' });
            const before = await libraryDb.getFileInfo(filePath);
            const source = await fs.readFile(filePath);
            const stat = await fs.stat(filePath);
            const first = await saveLocalCoverOverride(filePath, imagePath, value);
            const after = await libraryDb.getFileInfo(filePath);
            for (const [key, expected] of Object.entries(before)) {
                if (!['cover_override_path', 'thumb_path', 'thumbnail'].includes(key)) assert.deepEqual(after[key], expected, key);
            }
            assert.equal(after.cover_override_path, first.coverPath);
            assert.equal(after.thumb_path, first.coverPath);
            assert.ok(path.basename(first.coverPath).startsWith(LOCAL_COVER_OVERRIDE_PREFIX));
            assert.deepEqual(await fs.readFile(first.coverPath), PNG);
            assert.deepEqual(await fs.readFile(filePath), source);
            assert.equal((await fs.stat(filePath)).mtimeMs, stat.mtimeMs);
            const second = await saveLocalCoverOverride(filePath, imagePath, value);
            assert.notEqual(second.coverPath, first.coverPath);
            await assert.rejects(fs.stat(first.coverPath), { code: 'ENOENT' });
            assert.deepEqual(await fs.readFile(imagePath), PNG);
        });
    }
});

test('failed override updates keep the previous cover and clean up the newly copied image', async t => {
    const value = await fixture(t, '.pdf');
    const first = await saveLocalCoverOverride(value.filePath, value.imagePath, value);
    value.libraryDb.getConnection().exec(`
        CREATE TRIGGER reject_cover BEFORE UPDATE OF cover_override_path ON files
        BEGIN SELECT RAISE(ABORT, 'test save failure'); END;
    `);
    const before = await fs.readdir(value.thumbnailDir);
    await assert.rejects(saveLocalCoverOverride(value.filePath, value.imagePath, value), /test save failure/);
    assert.deepEqual(await fs.readdir(value.thumbnailDir), before);
    assert.equal((await value.libraryDb.getFileInfo(value.filePath)).cover_override_path, first.coverPath);
    assert.deepEqual(await fs.readFile(first.coverPath), PNG);
});

test('invalid images are rejected before TXT metadata, local overrides or audio files can change', async t => {
    const value = await fixture(t);
    await fs.writeFile(value.imagePath, 'not an image');
    for (const save of [saveTextCoverOnly, saveLocalCoverOverride, writeAudioCoverOnly]) {
        await assert.rejects(save(value.filePath, value.imagePath, value), /valid PNG/);
    }
    assert.equal(await value.libraryDb.getFileInfo(value.filePath), null);
    const handle = await fs.open(value.imagePath, 'w');
    await handle.truncate(16 * 1024 * 1024 + 1);
    await handle.close();
    await assert.rejects(saveLocalCoverOverride(value.filePath, value.imagePath, value), /16 MiB/);
});
