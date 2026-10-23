import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { signalPortableStartupReady } from './startupSignal.js';

const readyFileName = 'BookManager-startup.ready';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-startup-signal-'));
    const scratch = path.join(root, 'nsis-scratch');
    fs.mkdirSync(scratch);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const readyFile = path.join(scratch, readyFileName);
    return {
        root,
        scratch,
        readyFile,
        options: {
            platform: 'win32',
            env: { BOOKMANAGER_STARTUP_READY_FILE: readyFile },
            tempDir: root,
        },
    };
}

test('Windows portable startup creates the ready marker once without overwriting an existing file', async t => {
    const { readyFile, options } = fixture(t);
    assert.equal(await signalPortableStartupReady(options), true);
    assert.equal(fs.readFileSync(readyFile, 'utf8'), 'ready\nreduced\n');
    fs.writeFileSync(readyFile, 'existing marker');
    assert.equal(await signalPortableStartupReady(options), false);
    assert.equal(fs.readFileSync(readyFile, 'utf8'), 'existing marker');
});

test('the native launcher receives the resolved motion preference', async t => {
    const { readyFile, options } = fixture(t);
    assert.equal(await signalPortableStartupReady({ ...options, reducedMotion: false }), true);
    assert.equal(fs.readFileSync(readyFile, 'utf8'), 'ready\nanimate\n');
});

test('ordinary launches do not access the filesystem', async () => {
    let filesystemAccesses = 0;
    const fsPromises = new Proxy({}, {
        get: () => {
            filesystemAccesses += 1;
            throw new Error('No filesystem access is expected');
        },
    });
    for (const options of [
        { platform: 'darwin', env: { BOOKMANAGER_STARTUP_READY_FILE: '/tmp/nsis/BookManager-startup.ready' } },
        { platform: 'linux', env: { BOOKMANAGER_STARTUP_READY_FILE: '/tmp/nsis/BookManager-startup.ready' } },
        { platform: 'win32', env: {} },
        { platform: 'win32', env: { BOOKMANAGER_STARTUP_READY_FILE: readyFileName } },
        { platform: 'win32', env: { BOOKMANAGER_STARTUP_READY_FILE: '/tmp/nsis/config.json' } },
    ]) {
        assert.equal(await signalPortableStartupReady({ ...options, fsPromises }), false);
    }
    assert.equal(filesystemAccesses, 0);
});

test('markers outside the launcher scratch directory cannot be written', async t => {
    const { root, scratch, options } = fixture(t);
    const cases = [
        { tempDir: scratch, readyFile: path.join(root, readyFileName) },
        { tempDir: root, readyFile: path.join(root, readyFileName) },
    ];
    for (const { tempDir, readyFile } of cases) {
        assert.equal(await signalPortableStartupReady({
            ...options,
            tempDir,
            env: { BOOKMANAGER_STARTUP_READY_FILE: readyFile },
        }), false);
        assert.equal(fs.existsSync(readyFile), false);
    }
});

test('resolved Windows scratch paths accept casing aliases and reject other drives', async () => {
    const writes = [];
    const options = {
        platform: 'win32',
        pathApi: path.win32,
        tempDir: 'C:\\Users\\Reader\\AppData\\Local\\Temp',
        env: { BOOKMANAGER_STARTUP_READY_FILE: 'C:\\Users\\READER\\AppData\\Local\\Temp\\ns123.tmp\\BookManager-startup.ready' },
        fsPromises: {
            realpath: async value => value,
            writeFile: async (...args) => writes.push(args),
        },
    };
    assert.equal(await signalPortableStartupReady(options), true);
    assert.equal(writes.length, 1);
    assert.equal(await signalPortableStartupReady({
        ...options,
        env: { BOOKMANAGER_STARTUP_READY_FILE: 'D:\\ns123.tmp\\BookManager-startup.ready' },
    }), false);
    assert.equal(writes.length, 1);
});

test('missing scratch folders and filesystem errors never reject startup notification', async t => {
    const { scratch, options } = fixture(t);
    fs.rmdirSync(scratch);
    assert.equal(await signalPortableStartupReady(options), false);
    assert.equal(fs.existsSync(scratch), false);
    assert.equal(await signalPortableStartupReady({
        ...options,
        fsPromises: {
            realpath: async value => value,
            writeFile: async () => { throw new Error('Access denied'); },
        },
    }), false);
});

test('a scratch directory junction cannot redirect the marker outside the temp directory', async t => {
    const { root, scratch, options } = fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-startup-outside-'));
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    const link = path.join(scratch, 'redirect');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await signalPortableStartupReady({
        ...options,
        tempDir: root,
        env: { BOOKMANAGER_STARTUP_READY_FILE: path.join(link, readyFileName) },
    }), false);
    assert.equal(fs.existsSync(path.join(outside, readyFileName)), false);
});
