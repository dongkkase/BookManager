import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanFolder } from './tasks/folderScanTask.js';

function createFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-quick-scan-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directories = Array.from({ length: 12 }, (_, index) => path.join(root, `Folder ${index + 1}`));
    for (const directory of directories) {
        fs.mkdirSync(path.join(directory, 'Nested'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'Book 10.cbz'), '');
        fs.writeFileSync(path.join(directory, 'Book 2.cbz'), '');
        fs.writeFileSync(path.join(directory, 'Nested', 'Deep.epub'), '');
    }
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, '.hidden', 'Hidden.cbz'), '');
    fs.writeFileSync(path.join(root, 'Ignored.png'), '');
    fs.writeFileSync(path.join(root, '.visible.cbz'), '');
    fs.symlinkSync(directories[0], path.join(root, 'Linked'), 'junction');
    return { root, directories };
}

function captureEvents() {
    const events = [];
    return {
        events,
        event: { sender: { isDestroyed: () => false, send: (channel, data) => events.push({ channel, data }) } },
    };
}

test('quick recursive scans overlap bounded directory reads and stats while preserving breadth-first results', async t => {
    const { root, directories } = createFixture(t);
    const calls = { readdir: new Map(), stat: new Map() };
    const active = { readdir: 0, stat: 0 };
    const peak = { readdir: 0, stat: 0 };
    for (const method of ['readdir', 'stat']) {
        const original = fs.promises[method];
        t.mock.method(fs.promises, method, async (...args) => {
            calls[method].set(args[0], (calls[method].get(args[0]) || 0) + 1);
            active[method] += 1;
            peak[method] = Math.max(peak[method], active[method]);
            try {
                await new Promise(resolve => setTimeout(resolve, args[0].endsWith('2') ? 8 : 2));
                return await original(...args);
            } finally {
                active[method] -= 1;
            }
        });
    }
    const { events, event } = captureEvents();
    const rows = await scanFolder(root, {
        quickListOnly: true,
        includeSubfolders: true,
        includeDirectories: true,
        reportQuickFiles: true,
        reportTaskProgress: true,
        resultCacheKey: 'concurrent-quick',
        suppressEvents: true,
    }, event);
    const expected = [
        path.join(root, '.visible.cbz'),
        ...directories,
        ...directories.flatMap(directory => ['Book 2.cbz', 'Book 10.cbz'].map(name => path.join(directory, name))),
        ...directories.map(directory => path.join(directory, 'Nested', 'Deep.epub')),
    ];
    assert.deepEqual(rows.map(row => row.path), expected);
    assert.deepEqual(events.filter(event => event.channel === 'folder:quickFiles').flatMap(event => event.data.files), rows);
    assert.equal(events.filter(event => event.channel === 'task:progress').at(-1).data.progress, 100);
    for (const method of ['readdir', 'stat']) {
        assert.ok(peak[method] > 1 && peak[method] <= 4, `${method} concurrency: ${peak[method]}`);
        assert.equal(active[method], 0);
        assert.ok([...calls[method].values()].every(count => count === 1));
    }
    assert.deepEqual([...calls.stat.keys()], directories);
    assert.equal(calls.readdir.has(path.join(root, '.hidden')), false);
    assert.equal(calls.readdir.has(path.join(root, 'Linked')), false);
});

test('a prefetched read failure and unavailable folder stat do not discard other quick scan results', async t => {
    const { root, directories } = createFixture(t);
    const readDirectory = fs.promises.readdir;
    const stat = fs.promises.stat;
    t.mock.method(fs.promises, 'readdir', async (...args) => {
        if (args[0] === directories[1]) throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
        return readDirectory(...args);
    });
    t.mock.method(fs.promises, 'stat', async (...args) => {
        if (args[0] === directories[2]) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
        return stat(...args);
    });
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const rows = await scanFolder(root, { quickListOnly: true, includeSubfolders: true, includeDirectories: true });
    assert.equal(rows.filter(row => row.isDirectory).length, directories.length);
    assert.equal(rows.find(row => row.path === directories[2]).mtime, 0);
    assert.equal(rows.some(row => row.path.startsWith(`${directories[1]}${path.sep}`)), false);
    assert.ok(rows.some(row => row.path === path.join(directories.at(-1), 'Nested', 'Deep.epub')));
    assert.equal(errors.length, 1);
});

for (const cancelDuring of ['readdir', 'stat']) {
    test(`cancellation during ${cancelDuring} drains prefetched I/O and stops new requests and events`, async t => {
        const { root } = createFixture(t);
        let cancelled = false;
        let requestsAfterCancel = 0;
        let eventsAfterCancel = 0;
        const active = { readdir: 0, stat: 0 };
        for (const method of ['readdir', 'stat']) {
            const original = fs.promises[method];
            t.mock.method(fs.promises, method, async (...args) => {
                if (cancelled) requestsAfterCancel += 1;
                active[method] += 1;
                try {
                    if (args[0] !== root) {
                        await new Promise(resolve => setTimeout(resolve, method === cancelDuring ? 2 : 8));
                        if (method === cancelDuring) cancelled = true;
                    }
                    return await original(...args);
                } finally {
                    active[method] -= 1;
                }
            });
        }
        const event = { sender: {
            isDestroyed: () => false,
            send: () => { if (cancelled) eventsAfterCancel += 1; },
        } };
        await assert.rejects(scanFolder(root, {
            quickListOnly: true,
            includeSubfolders: true,
            includeDirectories: true,
            reportQuickFiles: true,
            reportTaskProgress: true,
            resultCacheKey: 'cancelled-quick',
            shouldCancel: () => cancelled,
        }, event), { code: 'TASK_CANCELLED' });
        assert.equal(requestsAfterCancel, 0);
        assert.equal(eventsAfterCancel, 0);
        assert.deepEqual(active, { readdir: 0, stat: 0 });
    });
}
