import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { removeUnreferencedLibraryCovers } from './libraryCacheCleanup.js';

const UUID = '57c04ec8-4a39-4973-a129-453b74cc8001';
const MD5 = '1'.repeat(32);
const HASH = '2'.repeat(64);
const COVER = Buffer.from('app-managed-cover');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-library-cover-cleanup-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'data', 'library.db') });
    const thumbnailDir = path.join(root, 'data', 'thumbnails');
    const textCoverDir = path.join(root, 'data', 'text-thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    await fs.mkdir(textCoverDir, { recursive: true });
    library.getConnection();
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const cover = async (name, directory = thumbnailDir) => {
        const filePath = path.join(directory, name);
        await fs.writeFile(filePath, COVER);
        return filePath;
    };
    return { root, library, thumbnailDir, textCoverDir, cover };
}

test('removes only supplied unreferenced generated thumbnails and custom covers', async t => {
    const value = await fixture(t);
    const candidates = [
        await value.cover(`${MD5}.jpg`),
        await value.cover(`pdf-first-page-v2-${MD5}.webp`),
        await value.cover(`local-cover-override-${UUID}.png`),
        await value.cover(`audio-cover-override-${UUID}.jpeg`),
        await value.cover(`${HASH}-${UUID}.gif`, value.textCoverDir),
    ];
    const retained = await value.cover(`${'3'.repeat(32)}.bmp`);
    const result = await removeUnreferencedLibraryCovers(value.library, [...candidates, candidates[0]], value);
    assert.deepEqual(result, { removedFiles: 5, skippedFiles: 0, errors: [] });
    for (const candidate of candidates) await assert.rejects(fs.lstat(candidate), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(retained), COVER);
});

test('preserves shared references in either file column and the text metadata store', async t => {
    const value = await fixture(t);
    const thumbnail = await value.cover(`${MD5}.jpg`);
    const override = await value.cover(`local-cover-override-${UUID}.png`);
    const textCover = await value.cover(`${HASH}-${UUID}.png`, value.textCoverDir);
    await value.library.upsertFileInfo({ path: path.join(value.root, 'kept.cbz'), thumb_path: thumbnail });
    await value.library.upsertFileInfo({ path: path.join(value.root, 'kept.pdf'), cover_override_path: override });
    value.library.getConnection().prepare('INSERT INTO text_metadata VALUES (?, ?, ?, ?, ?)')
        .run(HASH, '{}', '{}', textCover, new Date().toISOString());
    const before = value.library.getConnection().serialize();
    assert.deepEqual(await removeUnreferencedLibraryCovers(value.library, [thumbnail, override, textCover], value), {
        removedFiles: 0, skippedFiles: 3, errors: [],
    });
    for (const file of [thumbnail, override, textCover]) assert.deepEqual(await fs.readFile(file), COVER);
    assert.deepEqual(value.library.getConnection().serialize(), before);
});

test('original paths in files, reading lists and TXT path links are never deleted', async t => {
    const value = await fixture(t);
    const files = [await value.cover(`${MD5}.jpg`), await value.cover(`${'3'.repeat(32)}.png`), await value.cover(`${HASH}-${UUID}.png`, value.textCoverDir)];
    await value.library.upsertFileInfo({ path: files[0] });
    const db = value.library.getConnection();
    db.prepare('INSERT INTO reading_list_members (list_id, path, added_at) VALUES (?, ?, ?)')
        .run('want-to-read', files[1], new Date().toISOString());
    db.prepare('INSERT INTO text_metadata VALUES (?, ?, ?, ?, ?)').run(HASH, '{}', '{}', '', new Date().toISOString());
    db.prepare('INSERT INTO text_metadata_paths VALUES (?, ?)').run(files[2], HASH);
    assert.equal((await removeUnreferencedLibraryCovers(value.library, files, value)).removedFiles, 0);
    for (const file of files) assert.deepEqual(await fs.readFile(file), COVER);
});

test('external images, nested files, unrelated names and directories are untouched', async t => {
    const value = await fixture(t);
    const external = await value.cover(`${MD5}.jpg`, value.root);
    const nestedDir = path.join(value.thumbnailDir, 'nested');
    await fs.mkdir(nestedDir);
    const nested = await value.cover(`${MD5}.jpg`, nestedDir);
    const unrelated = await value.cover('my-cover.png');
    const temporary = await value.cover(`local-cover-override-${UUID}.png.tmp`);
    const malformed = await value.cover('audio-cover-override-manual.png');
    const wrongKind = await value.cover(`${HASH}-${UUID}.png`);
    const directory = path.join(value.thumbnailDir, `${'4'.repeat(32)}.jpg`);
    await fs.mkdir(directory);
    const child = await value.cover('book.epub', directory);
    const candidates = [external, nested, unrelated, temporary, malformed, wrongKind, directory,
        value.thumbnailDir, `${value.thumbnailDir}/../../${path.basename(external)}`, 'relative.jpg', '/'];
    const result = await removeUnreferencedLibraryCovers(value.library, candidates, value);
    assert.equal(result.removedFiles, 0);
    assert.deepEqual(result.errors, []);
    for (const file of [external, nested, unrelated, temporary, malformed, wrongKind, child]) {
        assert.deepEqual(await fs.readFile(file), COVER);
    }
});

test('symbolic-link cache roots and candidate links cannot unlink external data', async t => {
    const value = await fixture(t);
    const outside = await value.cover(`${MD5}.png`, value.root);
    const fileLink = path.join(value.thumbnailDir, `${MD5}.jpg`);
    const rootLink = path.join(value.root, 'linked-cache');
    try {
        await fs.symlink(outside, fileLink);
        await fs.symlink(value.root, rootLink, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symbolic links are unavailable.'); return; }
        throw error;
    }
    assert.equal((await removeUnreferencedLibraryCovers(value.library, [fileLink], value)).removedFiles, 0);
    assert.equal((await removeUnreferencedLibraryCovers(value.library, [path.join(rootLink, path.basename(outside))], {
        thumbnailDir: rootLink,
    })).removedFiles, 0);
    assert.equal((await fs.lstat(fileLink)).isSymbolicLink(), true);
    assert.deepEqual(await fs.readFile(outside), COVER);
});

test('canonical aliases and hard links preserve covers still used by another entry', async t => {
    const value = await fixture(t);
    const shared = await value.cover(`${MD5}.jpg`);
    const linked = await value.cover(`${'3'.repeat(32)}.jpg`);
    const original = path.join(value.root, 'original-book.jpg');
    await fs.link(linked, original);
    const canonical = await fs.realpath(shared);
    const alias = path.join(path.dirname(canonical), 'unused', '..', path.basename(canonical));
    await value.library.upsertFileInfo({ path: path.join(value.root, 'kept.cbz'), thumb_path: alias });
    const result = await removeUnreferencedLibraryCovers(value.library, [shared, linked], value);
    assert.deepEqual(result, { removedFiles: 0, skippedFiles: 2, errors: [] });
    assert.deepEqual(await fs.readFile(original), COVER);
    assert.deepEqual(await fs.readFile(shared), COVER);
});

test('references created after the candidate list are checked again at deletion time', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const candidates = [candidate];
    const writer = new LibraryDB({ dbPath: value.library.dbPath });
    try {
        await writer.upsertFileInfo({ path: path.join(value.root, 'new-owner.pdf'), cover_override_path: candidate });
        assert.equal((await removeUnreferencedLibraryCovers(value.library, candidates, value)).removedFiles, 0);
    } finally {
        await writer.close();
    }
    assert.deepEqual(await fs.readFile(candidate), COVER);
});

test('a differently named symbolic-link reference preserves its shared cover target', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const alias = path.join(value.root, 'shared-cover.png');
    try {
        await fs.symlink(candidate, alias);
    } catch (error) {
        if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symbolic links are unavailable.'); return; }
        throw error;
    }
    await value.library.upsertFileInfo({ path: path.join(value.root, 'owner.epub'), thumb_path: alias });
    assert.equal((await removeUnreferencedLibraryCovers(value.library, [candidate], value)).removedFiles, 0);
    assert.deepEqual(await fs.readFile(alias), COVER);
});

test('new references from another connection are detected after a cleanup yield', async t => {
    const value = await fixture(t);
    const candidates = await Promise.all(Array.from({ length: 101 }, (_, index) => (
        value.cover(`${index.toString(16).padStart(32, '0')}.png`)
    )));
    const writer = new LibraryDB({ dbPath: value.library.dbPath });
    const db = writer.getConnection();
    const unlink = fsSync.unlinkSync;
    let queued = false;
    let inserted = false;
    fsSync.unlinkSync = filePath => {
        unlink(filePath);
        if (queued) return;
        queued = true;
        setImmediate(() => {
            db.prepare('INSERT INTO files (path, thumb_path) VALUES (?, ?)')
                .run(path.join(value.root, 'new-owner.cbz'), candidates[100]);
            inserted = true;
        });
    };
    try {
        const result = await removeUnreferencedLibraryCovers(value.library, candidates, value);
        assert.equal(inserted, true);
        assert.deepEqual(result, { removedFiles: 100, skippedFiles: 1, errors: [] });
        assert.deepEqual(await fs.readFile(candidates[100]), COVER);
    } finally {
        fsSync.unlinkSync = unlink;
        await writer.close();
    }
});

test('reference scanning allows another connection to write and retries a changed snapshot', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const retained = await value.cover(`${'3'.repeat(32)}.png`);
    await value.library.upsertFileInfo({ path: path.join(value.root, 'existing-owner.cbz'), thumb_path: retained });
    const writer = new LibraryDB({ dbPath: value.library.dbPath });
    const writerDb = writer.getConnection();
    writerDb.pragma('busy_timeout = 0');
    const realpath = fsSync.realpathSync;
    let writes = 0;
    fsSync.realpathSync = (...args) => {
        if (args[0] === retained && writes === 0) {
            writerDb.prepare('INSERT INTO files (path, thumb_path) VALUES (?, ?)')
                .run(path.join(value.root, 'new-owner.cbz'), candidate);
            writes += 1;
        }
        return realpath(...args);
    };
    try {
        assert.deepEqual(await removeUnreferencedLibraryCovers(value.library, [candidate], value), {
            removedFiles: 0, skippedFiles: 1, errors: [],
        });
        assert.equal(writes, 1);
        assert.deepEqual(await fs.readFile(candidate), COVER);
    } finally {
        fsSync.realpathSync = realpath;
        await writer.close();
    }
});

test('references committed between the protection snapshot and write lock prevent deletion', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const writer = new LibraryDB({ dbPath: value.library.dbPath });
    const writerDb = writer.getConnection();
    const db = value.library.getConnection();
    const transaction = db.transaction;
    let writes = 0;
    db.transaction = callback => {
        const remove = transaction.call(db, callback);
        return {
            immediate: (...args) => {
                if (writes === 0) {
                    writerDb.prepare('INSERT INTO files (path, cover_override_path) VALUES (?, ?)')
                        .run(path.join(value.root, 'new-owner.cbz'), candidate);
                    writes += 1;
                }
                return remove.immediate(...args);
            },
        };
    };
    try {
        assert.deepEqual(await removeUnreferencedLibraryCovers(value.library, [candidate], value), {
            removedFiles: 0, skippedFiles: 1, errors: [],
        });
        assert.equal(writes, 1);
        assert.deepEqual(await fs.readFile(candidate), COVER);
    } finally {
        db.transaction = transaction;
        await writer.close();
    }
});

test('same-connection reference changes invalidate the protection snapshot', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const db = value.library.getConnection();
    const transaction = db.transaction;
    let writes = 0;
    db.transaction = callback => {
        const remove = transaction.call(db, callback);
        return {
            immediate: (...args) => {
                if (writes === 0) {
                    db.prepare('INSERT INTO files (path, thumb_path) VALUES (?, ?)')
                        .run(path.join(value.root, 'new-owner.cbz'), candidate);
                    writes += 1;
                }
                return remove.immediate(...args);
            },
        };
    };
    try {
        assert.deepEqual(await removeUnreferencedLibraryCovers(value.library, [candidate], value), {
            removedFiles: 0, skippedFiles: 1, errors: [],
        });
        assert.equal(writes, 1);
        assert.deepEqual(await fs.readFile(candidate), COVER);
    } finally {
        db.transaction = transaction;
    }
});

test('continually changing references skip deletion after bounded snapshot retries', async t => {
    const value = await fixture(t);
    const candidate = await value.cover(`${MD5}.png`);
    const retained = await value.cover(`${'3'.repeat(32)}.png`);
    await value.library.upsertFileInfo({ path: path.join(value.root, 'existing-owner.cbz'), thumb_path: retained });
    const writer = new LibraryDB({ dbPath: value.library.dbPath });
    const writerDb = writer.getConnection();
    writerDb.pragma('busy_timeout = 0');
    const realpath = fsSync.realpathSync;
    let writes = 0;
    fsSync.realpathSync = (...args) => {
        if (args[0] === retained) {
            writerDb.prepare('INSERT INTO files (path) VALUES (?)')
                .run(path.join(value.root, `new-owner-${writes}.cbz`));
            writes += 1;
        }
        return realpath(...args);
    };
    try {
        assert.deepEqual(await removeUnreferencedLibraryCovers(value.library, [candidate], value), {
            removedFiles: 0, skippedFiles: 1, errors: [],
        });
        assert.equal(writes, 3);
        assert.deepEqual(await fs.readFile(candidate), COVER);
    } finally {
        fsSync.realpathSync = realpath;
        await writer.close();
    }
});
