import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getOperationErrors } from './operationDiagnostics.js';
import { executeRenamer } from './tasks/renamerTask.js';

const ORIGINAL = 'original archive contents';
const HOLDING = 'existing recovery archive';
const OUTPUTS = { direct: 'directly renamed archive', repack: 'repacked archive' };
const requiresExecutableScript = { skip: process.platform === 'win32' };
const TOOL_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'rn') {
    fs.writeFileSync(args[1], 'directly renamed archive');
} else if (args[0] === 'x') {
    const directory = args.find(arg => arg.startsWith('-o')).slice(2);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '001.jpg'), 'original page');
} else if (args[0] === 'a') {
    fs.writeFileSync(args[2], 'repacked archive');
} else {
    process.exit(2);
}
`;

function setup(t, mode = 'direct') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-output-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filepath = path.join(root, mode === 'repack' ? 'Source.ZIP' : 'Source.zip');
    const holdingPath = `${filepath}.bookmanager.tmp`;
    const sevenZExe = path.join(root, 'fake-7z');
    fs.writeFileSync(filepath, ORIGINAL);
    fs.writeFileSync(holdingPath, HOLDING);
    fs.writeFileSync(sevenZExe, `#!/usr/bin/env node\n${TOOL_SCRIPT}`, { mode: 0o755 });
    const item = {
        filepath,
        name: path.basename(filepath),
        entries: [{ originalPath: '001.jpg', newName: '002.jpg' }],
    };
    return {
        root, filepath, holdingPath,
        run: overrides => executeRenamer([item], {
            sevenZExe, deleteOriginal: true, lang: 'en',
            ...(mode === 'repack' ? { flattenFolders: true } : {}),
            ...overrides,
        }),
        assertFiles(expected = [filepath]) {
            assert.equal(fs.readFileSync(holdingPath, 'utf8'), HOLDING);
            assert.deepEqual(fs.readdirSync(root).sort(), [sevenZExe, holdingPath, ...expected].map(value => path.basename(value)).sort());
        },
    };
}

function assertSuccess(result, sourcePath, outputPath = sourcePath) {
    assert.equal(result.cancelled, false);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(getOperationErrors(result), []);
    assert.deepEqual(result.outputFiles, [outputPath]);
    assert.deepEqual(result.pathMap, { [sourcePath]: outputPath });
}

for (const mode of ['direct', 'repack']) {
    test(`${mode} replacement publishes over the source without moving or deleting it first and preserves existing recovery files`, requiresExecutableScript, async t => {
        const fixture = setup(t, mode);
        const rename = fsp.rename;
        const remove = fsp.rm;
        const moves = [];
        const removals = [];
        let sourceAtPublication;
        t.mock.method(fsp, 'rename', async (source, destination) => {
            moves.push([source, destination]);
            if (destination === fixture.filepath) sourceAtPublication = fs.readFileSync(fixture.filepath, 'utf8');
            return rename(source, destination);
        });
        t.mock.method(fsp, 'rm', async (target, options) => {
            removals.push(target);
            return remove(target, options);
        });

        const result = await fixture.run();
        assertSuccess(result, fixture.filepath);
        assert.equal(sourceAtPublication, ORIGINAL);
        assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), OUTPUTS[mode]);
        assert.equal(moves.some(([source]) => source === fixture.filepath), false);
        assert.equal(removals.includes(fixture.filepath), false);
        fixture.assertFiles();
    });

    test(`${mode} output replacement failure preserves the original archive and reports the original write error`, requiresExecutableScript, async t => {
        const fixture = setup(t, mode);
        const failure = Object.assign(new Error('output replacement failed'), { code: 'EIO', syscall: 'rename' });
        const stack = failure.stack;
        const rename = fsp.rename;
        t.mock.method(fsp, 'rename', async (source, destination) => {
            if (destination === fixture.filepath) throw failure;
            return rename(source, destination);
        });

        const result = await fixture.run();
        assert.equal(result.cancelled, false);
        assert.equal(result.stats.success.length, 0);
        assert.equal(result.stats.error.length, 1);
        assert.deepEqual(result.outputFiles, []);
        assert.deepEqual(result.pathMap, {});
        assert.equal(getOperationErrors(result)[0], failure);
        assert.equal(failure.stack, stack);
        assert.equal(failure.telemetryStage, 'write-output');
        assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), ORIGINAL);
        fixture.assertFiles();
    });
}

test('a transient busy replacement retries while the original archive remains readable', requiresExecutableScript, async t => {
    const fixture = setup(t);
    const rename = fsp.rename;
    let attempts = 0;
    const sourceContents = [];
    t.mock.method(fsp, 'rename', async (source, destination) => {
        if (destination === fixture.filepath) {
            attempts += 1;
            sourceContents.push(fs.readFileSync(fixture.filepath, 'utf8'));
            if (attempts === 1) throw Object.assign(new Error('archive is busy'), { code: 'EBUSY', syscall: 'rename' });
        }
        return rename(source, destination);
    });

    const result = await fixture.run();
    assertSuccess(result, fixture.filepath);
    assert.equal(attempts, 2);
    assert.deepEqual(sourceContents, [ORIGINAL, ORIGINAL]);
    assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), OUTPUTS.direct);
    fixture.assertFiles();
});

test('a persistently busy replacement stops after bounded retries and preserves the original archive', requiresExecutableScript, async t => {
    const fixture = setup(t);
    const failure = Object.assign(new Error('archive remains busy'), { code: 'EBUSY', syscall: 'rename' });
    const rename = fsp.rename;
    let attempts = 0;
    t.mock.method(fsp, 'rename', async (source, destination) => {
        if (destination === fixture.filepath) {
            attempts += 1;
            throw failure;
        }
        return rename(source, destination);
    });

    const result = await fixture.run();
    assert.equal(attempts, 8);
    assert.equal(result.stats.success.length, 0);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.outputFiles, []);
    assert.deepEqual(result.pathMap, {});
    assert.equal(getOperationErrors(result)[0], failure);
    assert.equal(failure.telemetryStage, 'write-output');
    assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), ORIGINAL);
    fixture.assertFiles();
});

test('cancellation during a busy retry stops before another replacement without reporting an error', requiresExecutableScript, async t => {
    const fixture = setup(t);
    const rename = fsp.rename;
    let attempts = 0;
    let cancelled = false;
    let timer;
    t.after(() => clearTimeout(timer));
    t.mock.method(fsp, 'rename', async (source, destination) => {
        if (destination === fixture.filepath) {
            attempts += 1;
            if (attempts === 1) {
                timer = setTimeout(() => { cancelled = true; }, 20);
                throw Object.assign(new Error('archive is busy'), { code: 'EBUSY' });
            }
        }
        return rename(source, destination);
    });

    const result = await fixture.run({ shouldCancel: () => cancelled });
    assert.equal(result.cancelled, true);
    assert.equal(attempts, 1);
    assert.equal(result.stats.success.length, 0);
    assert.equal(result.stats.skip.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(getOperationErrors(result), []);
    assert.deepEqual(result.outputFiles, []);
    assert.deepEqual(result.pathMap, {});
    assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), ORIGINAL);
    fixture.assertFiles();
});

test('extension conversion preserves an existing destination and removes the source only after publishing a unique output', requiresExecutableScript, async t => {
    const fixture = setup(t);
    const existing = path.join(fixture.root, 'Source.cbz');
    const output = path.join(fixture.root, 'Source_1.cbz');
    fs.writeFileSync(existing, 'existing destination');
    const remove = fsp.rm;
    let publishedAtSourceRemoval;
    t.mock.method(fsp, 'rm', async (target, options) => {
        if (target === fixture.filepath) publishedAtSourceRemoval = fs.readFileSync(output, 'utf8');
        return remove(target, options);
    });

    const result = await fixture.run({ target_format: 'cbz' });
    assertSuccess(result, fixture.filepath, output);
    assert.equal(publishedAtSourceRemoval, OUTPUTS.repack);
    assert.equal(fs.existsSync(fixture.filepath), false);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing destination');
    assert.equal(fs.readFileSync(output, 'utf8'), OUTPUTS.repack);
    fixture.assertFiles([existing, output]);
});

test('source removal failure keeps both archives and returns the published output with the original removal error', requiresExecutableScript, async t => {
    const fixture = setup(t);
    const output = path.join(fixture.root, 'Source.cbz');
    const failure = Object.assign(new Error('source removal failed'), { code: 'EIO', syscall: 'unlink' });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, options) => {
        if (target === fixture.filepath) throw failure;
        return remove(target, options);
    });

    const result = await fixture.run({ target_format: 'cbz' });
    assert.equal(result.cancelled, false);
    assert.equal(result.stats.success.length, 0);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.outputFiles, [output]);
    assert.deepEqual(result.pathMap, { [fixture.filepath]: output });
    assert.equal(getOperationErrors(result)[0], failure);
    assert.equal(failure.telemetryStage, 'remove-source');
    assert.equal(fs.readFileSync(fixture.filepath, 'utf8'), ORIGINAL);
    assert.equal(fs.readFileSync(output, 'utf8'), OUTPUTS.repack);
    fixture.assertFiles([fixture.filepath, output]);
});
