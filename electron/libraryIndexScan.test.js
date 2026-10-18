import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createArchiveFingerprint, scanArchivePaths } from './ipcHandlers.js';

async function fixture(t) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-index-scan-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const folders = Array.from({ length: 12 }, (_, index) => path.join(root, `시리즈 ${index + 1}`));
    const files = [];
    for (const folder of folders) {
        await fs.promises.mkdir(folder);
        for (const name of ['Book 10.cbz', 'Book 2.cbz']) {
            const file = path.join(folder, name);
            await fs.promises.writeFile(file, 'book');
            files.push(file);
        }
    }
    await fs.promises.mkdir(path.join(root, 'Empty'));
    await fs.promises.mkdir(path.join(root, '.hidden'));
    await fs.promises.writeFile(path.join(root, '.hidden', 'Hidden.epub'), 'hidden');
    await fs.promises.writeFile(path.join(root, 'Ignored.md'), 'ignored');
    return { root, folders, files };
}

test('directory reads overlap within a bound while callbacks, priority and results stay deterministic', async t => {
    const { root, folders, files } = await fixture(t);
    const readDirectory = fs.promises.readdir;
    let active = 0;
    let peak = 0;
    let callbacks = 0;
    let peakCallbacks = 0;
    const calls = new Map();
    t.mock.method(fs.promises, 'readdir', async (folder, options) => {
        calls.set(folder, (calls.get(folder) || 0) + 1);
        active += 1;
        peak = Math.max(peak, active);
        try {
            await new Promise(resolve => setTimeout(resolve, folder.endsWith('2') ? 12 : 3));
            return await readDirectory(folder, options);
        } finally {
            active -= 1;
        }
    });
    const matched = [];
    const visited = [];
    const progress = [];
    const priority = folders[8];
    const result = await scanArchivePaths(root, priority, value => progress.push(value), null, async file => {
        callbacks += 1;
        peakCallbacks = Math.max(peakCallbacks, callbacks);
        await new Promise(resolve => setTimeout(resolve, 1));
        matched.push(file);
        callbacks -= 1;
    }, folder => visited.push(folder));
    assert.deepEqual([...result].sort(), [...files].sort());
    assert.deepEqual(result, matched);
    assert.deepEqual(result.slice(0, 2), [path.join(priority, 'Book 2.cbz'), path.join(priority, 'Book 10.cbz')]);
    assert.ok(peak > 1 && peak <= 4, `active directory reads: ${peak}`);
    assert.equal(peakCallbacks, 1);
    assert.equal(active, 0);
    assert.ok([...calls.values()].every(count => count === 1));
    assert.ok(visited.includes(path.join(root, 'Empty')));
    assert.equal(visited.includes(path.join(root, '.hidden')), false);
    assert.equal(progress.at(-1).matchedCount, files.length);
    assert.deepEqual(await scanArchivePaths(root, priority), result);
});

test('cancellation waits for in-flight directory reads and stops callbacks before returning', async t => {
    const { root } = await fixture(t);
    const readDirectory = fs.promises.readdir;
    let cancelled = false;
    let active = 0;
    const matched = [];
    t.mock.method(fs.promises, 'readdir', async (folder, options) => {
        active += 1;
        try {
            if (folder !== root) {
                cancelled = true;
                await new Promise(resolve => setTimeout(resolve, 5));
            }
            return await readDirectory(folder, options);
        } finally {
            active -= 1;
        }
    });
    await assert.rejects(scanArchivePaths(root, '', null, () => cancelled, file => matched.push(file)), { code: 'TASK_CANCELLED' });
    assert.equal(active, 0);
    assert.deepEqual(matched, []);
});

test('fingerprints ignore traversal order but detect additions, removals and file changes', () => {
    const first = { full_path: '/books/Book 2.cbz', size: 10, mtime: 100 };
    const second = { full_path: '/books/Book 10.cbz', size: 20, mtime: 200 };
    const entries = [second, first];
    const fingerprint = createArchiveFingerprint(entries);
    assert.equal(createArchiveFingerprint([first, second]), fingerprint);
    assert.deepEqual(entries, [second, first]);
    assert.notEqual(createArchiveFingerprint([first]), fingerprint);
    assert.notEqual(createArchiveFingerprint([first, { ...second, size: 21 }]), fingerprint);
    assert.notEqual(createArchiveFingerprint([first, { ...second, mtime: 201 }]), fingerprint);
    assert.notEqual(createArchiveFingerprint([first, { ...second, full_path: '/books/Renamed.cbz' }]), fingerprint);
});
