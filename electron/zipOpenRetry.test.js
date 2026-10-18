import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    listZipEntries,
    listZipEntriesFromFile,
    readZipEntry,
    readZipEntryFromFile,
    replaceZipEntries,
    replaceZipEntry,
    replaceZipEntryAppendOnly,
} from './core/zipArchive.js';

async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-open-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.cbz');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await replaceZipEntry(filePath, '001.jpg', 'original page');
    return { directory, filePath, original: fs.readFileSync(filePath) };
}

function busyError(syscall = 'open') {
    return Object.assign(new Error('Synthetic busy file'), { code: 'EBUSY', syscall });
}

function skipRetryWaits(t, onWait) {
    const delays = [];
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        delays.push(delay);
        queueMicrotask(() => {
            onWait?.();
            callback();
        });
    });
    return delays;
}

function assertClosed(handles) {
    assert.ok(handles.length > 0);
    for (const handle of handles) assert.equal(handle.fd, -1);
}

test('ZIP append retries only transient opens and performs backup and append once', async t => {
    const { filePath, original } = await fixture(t);
    const open = fsp.open.bind(fsp);
    const attempts = { 'r+': 0, r: 0 };
    const handles = [];
    let backups = 0;
    let writes = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async (target, flags, mode) => {
        attempts[flags] += 1;
        if (attempts[flags] <= (flags === 'r+' ? 2 : 1)) throw busyError();
        const handle = await open(target, flags, mode);
        handles.push(handle);
        if (flags === 'r+') {
            const write = handle.write.bind(handle);
            handle.write = (...args) => {
                writes += 1;
                return write(...args);
            };
        }
        return handle;
    });

    await replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        beforeWrite: () => { backups += 1; },
    });

    assert.deepEqual(delays, [100, 250, 100]);
    assert.deepEqual(attempts, { 'r+': 3, r: 2 });
    assert.equal(backups, 1);
    assert.equal(writes, 1);
    assertClosed(handles);
    const updated = fs.readFileSync(filePath);
    assert.deepEqual(updated.subarray(0, original.length), original);
    const entries = listZipEntries(updated);
    assert.equal(entries.filter(entry => entry.name === 'ComicInfo.xml').length, 1);
    assert.equal(readZipEntry(updated, entries.find(entry => entry.name === 'ComicInfo.xml')).toString(), '<ComicInfo/>');
});

test('persistent ZIP open EBUSY stops after four retries and preserves the final error and original', async t => {
    const { filePath, original } = await fixture(t);
    const failures = Array.from({ length: 5 }, () => busyError());
    let attempts = 0;
    let backups = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async () => { throw failures[attempts++]; });

    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        beforeWrite: () => { backups += 1; },
    }), error => error === failures[4]);

    assert.equal(attempts, 5);
    assert.deepEqual(delays, [100, 250, 500, 1000]);
    assert.equal(backups, 0);
    assert.deepEqual(fs.readFileSync(filePath), original);
});

test('ZIP open errors other than EBUSY fail immediately without backup or modification', async t => {
    const { filePath, original } = await fixture(t);
    const failure = Object.assign(new Error('Synthetic denied file'), { code: 'EACCES', syscall: 'open' });
    let attempts = 0;
    let backups = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async () => {
        attempts += 1;
        throw failure;
    });

    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        beforeWrite: () => { backups += 1; },
    }), error => error === failure);

    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
    assert.equal(backups, 0);
    assert.deepEqual(fs.readFileSync(filePath), original);
});

test('ZIP cancellation during the final busy open remains cancellation instead of an exhausted error', async t => {
    const { filePath, original } = await fixture(t);
    let attempts = 0;
    let cancelled = false;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async () => {
        attempts += 1;
        if (attempts === 5) cancelled = true;
        throw busyError();
    });

    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        shouldCancel: () => cancelled,
    }), { code: 'TASK_CANCELLED' });

    assert.equal(attempts, 5);
    assert.deepEqual(delays, [100, 250, 500, 1000]);
    assert.deepEqual(fs.readFileSync(filePath), original);
});

for (const blockedFlags of ['r+', 'r', 'wx']) {
    test(`ZIP cancellation during ${blockedFlags} open retry stops further opens and writes`, async t => {
        const { directory, filePath, original } = await fixture(t);
        const open = fsp.open.bind(fsp);
        const handles = [];
        let blockedAttempts = 0;
        let cancelled = false;
        let backups = 0;
        let writes = 0;
        const delays = skipRetryWaits(t, () => { cancelled = true; });
        t.mock.method(fsp, 'open', async (target, flags, mode) => {
            if (flags === blockedFlags) {
                blockedAttempts += 1;
                throw busyError();
            }
            const handle = await open(target, flags, mode);
            handles.push(handle);
            const write = handle.write.bind(handle);
            handle.write = (...args) => {
                writes += 1;
                return write(...args);
            };
            return handle;
        });
        const options = {
            shouldCancel: () => cancelled,
            beforeWrite: () => { backups += 1; },
        };
        const operation = blockedFlags === 'wx'
            ? replaceZipEntries(filePath, [{ name: 'ComicInfo.xml', content: '<ComicInfo/>' }], options)
            : replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', options);

        await assert.rejects(operation, { code: 'TASK_CANCELLED' });

        assert.equal(blockedAttempts, 1);
        assert.deepEqual(delays, [100]);
        assert.equal(backups, 0);
        assert.equal(writes, 0);
        if (handles.length) assertClosed(handles);
        assert.deepEqual(fs.readFileSync(filePath), original);
        assert.deepEqual(fs.readdirSync(directory), ['book.cbz']);
    });
}

for (const cancelAt of ['before-backup', 'after-backup']) {
    test(`ZIP append cancellation ${cancelAt} preserves original bytes and closes handles`, async t => {
        const { filePath, original } = await fixture(t);
        const open = fsp.open.bind(fsp);
        const handles = [];
        let cancelled = false;
        let backups = 0;
        t.mock.method(fsp, 'open', async (...args) => {
            const handle = await open(...args);
            handles.push(handle);
            if (args[1] === 'r' && cancelAt === 'before-backup') {
                const close = handle.close.bind(handle);
                handle.close = async () => {
                    await close();
                    cancelled = true;
                };
            }
            return handle;
        });

        await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
            shouldCancel: () => cancelled,
            beforeWrite: () => {
                backups += 1;
                cancelled = true;
            },
        }), { code: 'TASK_CANCELLED' });

        assert.equal(backups, cancelAt === 'before-backup' ? 0 : 1);
        assertClosed(handles);
        assert.deepEqual(fs.readFileSync(filePath), original);
    });
}

test('ZIP append never retries a partial write that fails with EBUSY', async t => {
    const { filePath, original } = await fixture(t);
    const open = fsp.open.bind(fsp);
    const handles = [];
    const failure = busyError('write');
    let appendOpens = 0;
    let backups = 0;
    let writes = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async (...args) => {
        const handle = await open(...args);
        handles.push(handle);
        if (args[1] === 'r+') {
            appendOpens += 1;
            const write = handle.write.bind(handle);
            handle.write = async (buffer, offset, length, position) => {
                writes += 1;
                if (writes > 1) throw failure;
                return write(buffer, offset, Math.min(length, 10), position);
            };
        }
        return handle;
    });

    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        beforeWrite: () => { backups += 1; },
    }), error => error === failure);

    assert.equal(appendOpens, 1);
    assert.equal(backups, 1);
    assert.equal(writes, 2);
    assert.deepEqual(delays, []);
    assertClosed(handles);
    const updated = fs.readFileSync(filePath);
    assert.equal(updated.length, original.length + 10);
    assert.deepEqual(updated.subarray(0, original.length), original);
});

test('ZIP append does not retry a backup failure with EBUSY', async t => {
    const { filePath, original } = await fixture(t);
    const open = fsp.open.bind(fsp);
    const handles = [];
    const failure = busyError();
    let backups = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async (...args) => {
        const handle = await open(...args);
        handles.push(handle);
        return handle;
    });

    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>', {
        beforeWrite: () => {
            backups += 1;
            throw failure;
        },
    }), error => error === failure);

    assert.equal(backups, 1);
    assert.deepEqual(delays, []);
    assertClosed(handles);
    assert.deepEqual(fs.readFileSync(filePath), original);
});

test('ZIP file listing and entry reading recover from transient open EBUSY and close handles', async t => {
    const { filePath } = await fixture(t);
    const open = fsp.open.bind(fsp);
    const handles = [];
    let attempts = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async (...args) => {
        attempts += 1;
        if (attempts % 2) throw busyError();
        const handle = await open(...args);
        handles.push(handle);
        return handle;
    });

    const entries = await listZipEntriesFromFile(filePath);
    const content = await readZipEntryFromFile(filePath, entries[0]);

    assert.equal(content.toString(), 'original page');
    assert.equal(attempts, 4);
    assert.deepEqual(delays, [100, 100]);
    assertClosed(handles);
});

test('ZIP rewrite retries exclusive output open with the original mode and replaces once', async t => {
    const { directory, filePath } = await fixture(t);
    const sourceMode = fs.statSync(filePath).mode & 0o777;
    const open = fsp.open.bind(fsp);
    const rename = fsp.rename.bind(fsp);
    const handles = [];
    const outputAttempts = [];
    let backups = 0;
    let renames = 0;
    const delays = skipRetryWaits(t);
    t.mock.method(fsp, 'open', async (...args) => {
        if (args[1] === 'wx') {
            outputAttempts.push(args);
            if (outputAttempts.length < 3) throw busyError();
        }
        const handle = await open(...args);
        handles.push(handle);
        return handle;
    });
    t.mock.method(fsp, 'rename', async (...args) => {
        renames += 1;
        return rename(...args);
    });

    await replaceZipEntries(filePath, [{ name: 'ComicInfo.xml', content: '<ComicInfo/>' }], {
        beforeWrite: () => { backups += 1; },
    });

    assert.deepEqual(delays, [100, 250]);
    assert.equal(outputAttempts.length, 3);
    for (const attempt of outputAttempts) assert.deepEqual(attempt, [outputAttempts[0][0], 'wx', sourceMode]);
    assert.equal(backups, 1);
    assert.equal(renames, 1);
    assertClosed(handles);
    const updated = fs.readFileSync(filePath);
    const entries = listZipEntries(updated);
    assert.equal(readZipEntry(updated, entries.find(entry => entry.name === '001.jpg')).toString(), 'original page');
    assert.equal(readZipEntry(updated, entries.find(entry => entry.name === 'ComicInfo.xml')).toString(), '<ComicInfo/>');
    assert.deepEqual(fs.readdirSync(directory), ['book.cbz']);
});
