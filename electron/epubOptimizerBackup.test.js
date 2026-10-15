import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { writePackage } from './epubEditor/package.js';
import { listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';
import { inspectEpub, optimizeEpub } from './epubOptimizer/core.js';

const settings = { images: false, fonts: false, recompress: true };

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-backup-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    const entries = [
        { name: 'mimetype', data: 'application/epub+zip' },
        { name: 'META-INF/container.xml', data: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
        { name: 'EPUB/package.opf', data: '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>' },
        { name: 'EPUB/chapter.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p>${'A paragraph '.repeat(500)}</p></body></html>` },
    ];
    await writePackage(filePath, entries.map(entry => ({ ...entry, store: true })));
    return { directory, filePath, backupDirectory: path.join(directory, 'bak') };
}

async function contents(filePath) {
    const entries = await listZipEntriesFromFile(filePath);
    return new Map(await Promise.all(entries.map(async entry => [entry.name, await readZipEntryFromFile(filePath, entry)])));
}

async function seedBackup(backupDirectory) {
    await fs.mkdir(backupDirectory);
    const backupPath = path.join(backupDirectory, 'book.epub');
    const bytes = Buffer.from('Existing backup must stay unchanged');
    await fs.writeFile(backupPath, bytes);
    return { backupPath, bytes };
}

test('overwrite with backup replaces the source with a valid smaller EPUB and keeps exact original bytes in bak', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const inspection = await inspectEpub(filePath);
    const result = await optimizeEpub(filePath, settings, { overwrite: true, backup: true, expectedFingerprint: inspection.fingerprint });
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, filePath);
    assert.equal(result.backupPath, path.join(backupDirectory, 'book.epub'));
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    assert.deepEqual(await contents(filePath), originalContents);
    const saved = await fs.readFile(filePath);
    assert.ok(saved.length < original.length);
    assert.equal(result.savedBytes, original.length - saved.length);
    assert.equal(result.originalSize, original.length);
    assert.equal(result.outputSize, saved.length);
    assert.notEqual((await inspectEpub(filePath)).fingerprint, inspection.fingerprint);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('overwrite without backup saves the optimized source without creating a bak directory', async t => {
    const { directory, filePath } = await fixture(t);
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const result = await optimizeEpub(filePath, settings, { overwrite: true, backup: false });
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, filePath);
    assert.equal(result.backupPath, '');
    assert.ok((await fs.stat(filePath)).size < original.length);
    assert.deepEqual(await contents(filePath), originalContents);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('omitting overwrite and backup preserves the existing separate-output API behavior', async t => {
    const { directory, filePath } = await fixture(t);
    const original = await fs.readFile(filePath);
    const result = await optimizeEpub(filePath, settings);
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, path.join(directory, 'book.optimized.epub'));
    assert.equal(result.backupPath, '');
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['book.epub', 'book.optimized.epub']);
});

test('numbered backups preserve every existing copy', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const existing = await seedBackup(backupDirectory);
    const numberedPath = path.join(backupDirectory, 'book_1.epub');
    const numberedBytes = Buffer.from('Previous numbered backup');
    await fs.writeFile(numberedPath, numberedBytes);
    const result = await optimizeEpub(filePath, settings, { overwrite: true, backup: true });
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, filePath);
    assert.equal(result.backupPath, path.join(backupDirectory, 'book_2.epub'));
    assert.deepEqual(await fs.readFile(existing.backupPath), existing.bytes);
    assert.deepEqual(await fs.readFile(numberedPath), numberedBytes);
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    assert.deepEqual((await fs.readdir(backupDirectory)).sort(), ['book.epub', 'book_1.epub', 'book_2.epub']);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('a backup name claimed during copying is preserved and retried with the next number', async t => {
    const { filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const racingPath = path.join(backupDirectory, 'book.epub');
    const racingBytes = Buffer.from('Backup created by another operation');
    const copyFile = fs.copyFile;
    let claimed = false;
    t.mock.method(fs, 'copyFile', async (source, destination, mode) => {
        if (source === filePath && destination === racingPath && !claimed) {
            assert.equal(mode & constants.COPYFILE_EXCL, constants.COPYFILE_EXCL);
            claimed = true;
            await fs.writeFile(racingPath, racingBytes, { flag: 'wx' });
        }
        return copyFile(source, destination, mode);
    });
    const result = await optimizeEpub(filePath, settings, { overwrite: true, backup: true });
    assert.equal(claimed, true);
    assert.equal(result.status, 'saved');
    assert.equal(result.backupPath, path.join(backupDirectory, 'book_1.epub'));
    assert.deepEqual(await fs.readFile(racingPath), racingBytes);
    assert.deepEqual(await fs.readFile(result.backupPath), original);
});

test('inspection and optimization with no reduction do not create backups or replace the source', async t => {
    const { directory, filePath } = await fixture(t);
    const original = await fs.readFile(filePath);
    await inspectEpub(filePath, { overwrite: true, backup: true });
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
    const result = await optimizeEpub(filePath, { ...settings, recompress: false }, { overwrite: true, backup: true });
    assert.equal(result.status, 'unchanged');
    assert.equal(result.backupPath, '');
    assert.equal(result.outputPath, null);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('stale inspection and cancellation before work do not create backups or output', async t => {
    const variants = [
        { name: 'stale inspection', options: { expectedFingerprint: 'stale' }, code: 'SOURCE_CHANGED' },
        { name: 'cancelled', options: { shouldCancel: () => true }, code: 'TASK_CANCELLED' },
    ];
    for (const variant of variants) {
        await t.test(variant.name, async t => {
            const { directory, filePath } = await fixture(t);
            const original = await fs.readFile(filePath);
            await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true, ...variant.options }), { code: variant.code });
            assert.deepEqual(await fs.readFile(filePath), original);
            assert.deepEqual(await fs.readdir(directory), ['book.epub']);
        });
    }
});

test('a backup-directory failure preserves the original source and creates no output', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const existing = Buffer.from('bak is a file');
    await fs.writeFile(backupDirectory, existing);
    await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true }), { code: 'EPUB_BACKUP_FAILED' });
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readFile(backupDirectory), existing);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('cancellation after backup removes only the newly created backup and preserves the source', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const existing = await seedBackup(backupDirectory);
    const copyFile = fs.copyFile;
    let cancelled = false;
    t.mock.method(fs, 'copyFile', async (source, destination, mode) => {
        const result = await copyFile(source, destination, mode);
        if (source === filePath && path.dirname(destination) === backupDirectory) cancelled = true;
        return result;
    });
    await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true, shouldCancel: () => cancelled }), { code: 'TASK_CANCELLED' });
    assert.equal(cancelled, true);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readFile(existing.backupPath), existing.bytes);
    assert.deepEqual(await fs.readdir(backupDirectory), ['book.epub']);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('source changes during backup prevent replacement and remove only the new backup', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const existing = await seedBackup(backupDirectory);
    const copyFile = fs.copyFile;
    let changed = false;
    t.mock.method(fs, 'copyFile', async (source, destination, mode) => {
        const result = await copyFile(source, destination, mode);
        if (source === filePath && path.dirname(destination) === backupDirectory) {
            changed = true;
            await fs.utimes(filePath, new Date(), new Date(Date.now() + 10000));
        }
        return result;
    });
    await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true }), { code: 'SOURCE_CHANGED' });
    assert.equal(changed, true);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readFile(existing.backupPath), existing.bytes);
    assert.deepEqual(await fs.readdir(backupDirectory), ['book.epub']);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('final replacement failure preserves the original and reports the retained recovery backup', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const existing = await seedBackup(backupDirectory);
    const rename = fs.rename;
    let attempted = false;
    t.mock.method(fs, 'rename', async (source, destination) => {
        if (destination === filePath) {
            attempted = true;
            assert.deepEqual(await fs.readFile(path.join(backupDirectory, 'book_1.epub')), original);
            throw Object.assign(new Error('Replacement denied'), { code: 'EACCES' });
        }
        return rename(source, destination);
    });
    const newBackupPath = path.join(backupDirectory, 'book_1.epub');
    await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true }), { code: 'EACCES', backupPath: newBackupPath });
    assert.equal(attempted, true);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readFile(existing.backupPath), existing.bytes);
    assert.deepEqual(await fs.readFile(newBackupPath), original);
    assert.deepEqual((await fs.readdir(backupDirectory)).sort(), ['book.epub', 'book_1.epub']);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('a lost rename response retains and reports the original backup even when replacement already succeeded', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const existing = await seedBackup(backupDirectory);
    const rename = fs.rename;
    let replaced = false;
    t.mock.method(fs, 'rename', async (source, destination) => {
        const result = await rename(source, destination);
        if (destination === filePath) {
            replaced = true;
            throw Object.assign(new Error('Rename response lost'), { code: 'EIO' });
        }
        return result;
    });
    const newBackupPath = path.join(backupDirectory, 'book_1.epub');
    await assert.rejects(optimizeEpub(filePath, settings, { overwrite: true, backup: true }), { code: 'EIO', backupPath: newBackupPath });
    assert.equal(replaced, true);
    assert.ok((await fs.stat(filePath)).size < original.length);
    assert.deepEqual(await contents(filePath), originalContents);
    await inspectEpub(filePath);
    assert.deepEqual(await fs.readFile(existing.backupPath), existing.bytes);
    assert.deepEqual(await fs.readFile(newBackupPath), original);
    assert.deepEqual((await fs.readdir(backupDirectory)).sort(), ['book.epub', 'book_1.epub']);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});

test('overwriting through a leaf symlink preserves the link and optimizes its target with an exact original backup', async t => {
    const { directory, filePath } = await fixture(t);
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const aliasDirectory = path.join(directory, 'aliases');
    const aliasPath = path.join(aliasDirectory, 'linked.epub');
    const linkTarget = '../book.epub';
    await fs.mkdir(aliasDirectory);
    await fs.symlink(linkTarget, aliasPath);
    const inspection = await inspectEpub(aliasPath);
    const result = await optimizeEpub(aliasPath, settings, { overwrite: true, backup: true, expectedFingerprint: inspection.fingerprint });
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, aliasPath);
    assert.ok(result.backupPath);
    assert.equal((await fs.lstat(aliasPath)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(aliasPath), linkTarget);
    assert.equal(await fs.realpath(aliasPath), await fs.realpath(filePath));
    assert.ok((await fs.stat(filePath)).size < original.length);
    assert.deepEqual(await contents(filePath), originalContents);
    assert.deepEqual(await fs.readFile(aliasPath), await fs.readFile(filePath));
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    assert.equal((await fs.lstat(result.backupPath)).isFile(), true);
    await inspectEpub(aliasPath);
});

test('worker forwards overwrite and backup options to the final save', async t => {
    const { directory, filePath, backupDirectory } = await fixture(t);
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const inspection = await inspectEpub(filePath);
    const worker = new Worker(new URL('./epubOptimizer/worker.js', import.meta.url), {
        workerData: { action: 'optimize', filePath, settings, overwrite: true, backup: true, expectedFingerprint: inspection.fingerprint },
    });
    t.after(() => worker.terminate());
    const messages = [];
    const exitCode = await new Promise((resolve, reject) => {
        worker.on('message', message => messages.push(message));
        worker.once('error', reject);
        worker.once('exit', resolve);
    });
    assert.equal(exitCode, 0);
    assert.equal(messages.some(message => message.type === 'error'), false);
    const results = messages.filter(message => message.type === 'result');
    assert.equal(results.length, 1);
    assert.equal(results[0].result.status, 'saved');
    assert.equal(results[0].result.outputPath, filePath);
    assert.equal(results[0].result.backupPath, path.join(backupDirectory, 'book.epub'));
    assert.deepEqual(await fs.readFile(results[0].result.backupPath), original);
    assert.deepEqual(await contents(filePath), originalContents);
    assert.ok((await fs.stat(filePath)).size < original.length);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['bak', 'book.epub']);
});
