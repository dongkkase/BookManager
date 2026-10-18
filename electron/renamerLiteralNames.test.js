import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import sevenZip from '7zip-bin';
import { listZipEntriesFromFile, readZipEntryFromFile, replaceZipEntry } from './core/zipArchive.js';
import { getOperationErrors } from './operationDiagnostics.js';
import { executeRenamer } from './tasks/renamerTask.js';

const sevenZExe = sevenZip.path7za;
const toolAvailable = !spawnSync(sevenZExe, ['i'], { stdio: 'ignore' }).error;
const requires7z = { skip: toolAvailable ? false : 'Bundled 7-Zip is not executable' };

async function fixture(t, names, extension = '.zip') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-literal-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filepath = path.join(root, `Source${extension}`);
    fs.writeFileSync(filepath, Buffer.alloc(0));
    const contents = new Map();
    for (const [index, name] of names.entries()) {
        const data = Buffer.from(`page ${index}: ${name}`);
        contents.set(name, data);
        await replaceZipEntry(filepath, name, data);
    }
    const original = fs.readFileSync(filepath);
    return {
        root, filepath, contents, original,
        run: (entries, overrides = {}) => executeRenamer([{ filepath, name: path.basename(filepath), entries }], {
            sevenZExe, deleteOriginal: true, lang: 'en', ...overrides,
        }),
        assertClean() {
            assert.deepEqual(fs.readdirSync(root), [path.basename(filepath)]);
        },
    };
}

async function assertRenamed(f, result, expected) {
    assert.equal(result.cancelled, false);
    assert.equal(result.stats.success.length, 1, result.stats.error.join('\n'));
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(getOperationErrors(result), []);
    assert.deepEqual(result.outputFiles, [f.filepath]);
    const entries = await listZipEntriesFromFile(f.filepath);
    assert.deepEqual(entries.filter(entry => !entry.isDirectory).map(entry => entry.name).sort(), [...expected.keys()].sort());
    for (const [name, originalName] of expected) {
        const entry = entries.find(value => value.name === name);
        assert.deepEqual(await readZipEntryFromFile(f.filepath, entry), f.contents.get(originalName));
    }
    f.assertClean();
}

for (const extension of ['.zip', '.cbz']) {
    test(`direct ${extension} renaming treats switch and wildcard names literally`, requires7z, async t => {
        const names = ['-cover.jpg', 'page*.jpg', 'page?.jpg', 'page1.jpg'];
        const f = await fixture(t, names, extension);
        const entries = names.slice(0, 3).map((originalPath, index) => ({ originalPath, newName: `renamed-${index}.jpg` }));
        const result = await f.run(entries);
        const expected = new Map(entries.map(entry => [entry.newName, entry.originalPath]));
        expected.set('page1.jpg', 'page1.jpg');
        await assertRenamed(f, result, expected);
    });
}

test('direct rename lists preserve at signs, Unicode, spaces and quotes across batches', requires7z, async t => {
    const names = ['@표지 한글.jpg', ' leading and trailing.jpg ', '"quoted".jpg', '-switch.jpg', 'page?.jpg'];
    while (names.length < 22) names.push(`@page-${names.length}.jpg`);
    const f = await fixture(t, names);
    const entries = names.map((originalPath, index) => ({ originalPath, newName: `@새 이름 ${index}.jpg` }));
    const result = await f.run(entries);
    await assertRenamed(f, result, new Map(entries.map(entry => [entry.newName, entry.originalPath])));
});

test('at-sign paths with line breaks use extraction without splitting rename list entries', {
    skip: !toolAvailable || process.platform === 'win32' ? 'Requires 7-Zip and filesystem support for line breaks' : false,
}, async t => {
    const f = await fixture(t, ['@page\nbreak.jpg', 'normal.jpg']);
    const result = await f.run([
        { originalPath: '@page\nbreak.jpg', newName: 'renamed.jpg' },
        { originalPath: 'normal.jpg', newName: 'normal.jpg' },
    ]);
    await assertRenamed(f, result, new Map([['renamed.jpg', '@page\nbreak.jpg'], ['normal.jpg', 'normal.jpg']]));
});

test('failed direct renames remove list files and preserve the source bytes', requires7z, async t => {
    const f = await fixture(t, ['@page.jpg']);
    const invalidArchive = Buffer.from('invalid archive for process failure');
    fs.writeFileSync(f.filepath, invalidArchive);
    const result = await f.run([{ originalPath: '@page.jpg', newName: 'renamed.jpg' }]);
    assert.equal(result.stats.success.length, 0);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.outputFiles, []);
    assert.equal(getOperationErrors(result)[0].code, 'PROCESS_FAILED');
    assert.equal(getOperationErrors(result)[0].telemetryStage, 'direct-rename');
    assert.deepEqual(fs.readFileSync(f.filepath), invalidArchive);
    f.assertClean();
});

test('cancellation after writing a rename list preserves the source and removes temporary files', requires7z, async t => {
    const f = await fixture(t, ['@page.jpg']);
    const writeFile = fsp.writeFile;
    let cancelled = false;
    t.mock.method(fsp, 'writeFile', async (filename, ...args) => {
        await writeFile(filename, ...args);
        if (String(filename).endsWith('.rename-list.txt')) cancelled = true;
    });
    const result = await f.run([{ originalPath: '@page.jpg', newName: 'renamed.jpg' }], {
        shouldCancel: () => cancelled,
    });
    assert.equal(cancelled, true);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(getOperationErrors(result), []);
    assert.deepEqual(result.outputFiles, []);
    assert.deepEqual(fs.readFileSync(f.filepath), f.original);
    f.assertClean();
});
