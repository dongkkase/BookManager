import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Writable } from 'node:stream';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-readers-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let now = Date.now();
    const service = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local], now: () => now, getRegisteredLibraries: () => [root] });
    service.localInterface = local;
    service.port = 19421;
    service.server = {};
    service.certificateSha256 = 'a'.repeat(64);
    const api = async (route, { method = 'GET', body, token = firstToken, signal } = {}) => service.dispatch({ ...remote, method, pathname: `/readive/v1${route}`, body, token, signal });
    const pair = async (deviceId = 'device-123') => {
        const ticket = JSON.parse((await service.pairing()).ticket);
        return (await api('/pair', { method: 'POST', body: { secret: ticket.secret, deviceId, deviceName: deviceId }, token: '' })).json.token;
    };
    let firstToken = await pair();
    const libraryId = (await service.status()).libraries[0].id;
    return { root, service, api, libraryId, pair, advance: milliseconds => { now += milliseconds; } };
}

test('Readive direct reads freeze source metadata without hashing bytes or creating transfer jobs', async t => {
    const { root, service, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'temporary reader content');
    const originalOpen = fs.open;
    let contentReads = 0;
    fs.open = async function (...args) {
        const handle = await originalOpen.apply(this, args);
        if (String(args[0]) === path.join(root, 'book.txt')) {
            const originalStream = handle.createReadStream.bind(handle);
            handle.createReadStream = (...values) => { contentReads += 1; return originalStream(...values); };
        }
        return handle;
    };
    try {
        const opened = (await api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } })).json;
        assert.equal(opened.name, 'book.txt');
        assert.equal(opened.size, 24);
        assert.equal(opened.format, 'txt');
        assert.match(opened.sourceVersion, /^[a-f0-9]{64}$/);
        assert.equal(contentReads, 0);
        assert.equal(service.store.state.jobs.length, 0);
        assert.deepEqual(service.store.state.items, {});
        const result = await api(`/readers/${opened.id}/content`);
        assert.equal(result.asset.size, opened.size);
        assert.equal(result.asset.sha256, undefined, 'a source revision must not be claimed to be a content hash');
        assert.equal(result.readerId, opened.id);
        assert.deepEqual((await api(`/readers/${opened.id}/close`, { method: 'POST' })).json, { success: true });
        await assert.rejects(api(`/readers/${opened.id}/content`), /reader_expired/);
        assert.deepEqual((await api(`/readers/${opened.id}/close`, { method: 'POST' })).json, { success: true });
    } finally { fs.open = originalOpen; }
});

test('Readive direct reads enforce device ownership, registered roots, frozen files, and idle expiry', async t => {
    const { root, api, libraryId, pair, advance, service } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    const open = async () => (await api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } })).json;
    const reader = await open();
    const other = await pair('device-456');
    await assert.rejects(api(`/readers/${reader.id}/content`, { token: other }), /reader_expired/);
    await assert.rejects(api(`/readers/${reader.id}/close`, { method: 'POST', token: other }), /reader_expired/);
    await fs.writeFile(path.join(root, 'book.txt'), 'replacement');
    await assert.rejects(api(`/readers/${reader.id}/content`), /source_changed/);
    const replacement = await open();
    assert.notEqual(replacement.sourceVersion, reader.sourceVersion);
    await fs.unlink(path.join(root, 'book.txt'));
    await assert.rejects(api(`/readers/${replacement.id}/content`), /source_changed/);
    await fs.writeFile(path.join(root, 'book.txt'), 'replacement');
    advance(10 * 60 * 1000 + 1);
    await assert.rejects(api(`/readers/${replacement.id}/content`), /reader_expired/);
    const current = await open();
    service.getRegisteredLibraries = () => [];
    await assert.rejects(api(`/readers/${current.id}/content`), /library_unavailable/);
});

test('Readive direct reads reject traversal, symlinks, directories, and unsupported files', async t => {
    const { root, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    await fs.writeFile(path.join(root, 'unsupported.wma'), 'audio');
    await fs.symlink(path.join(root, 'book.txt'), path.join(root, 'link.txt'));
    for (const value of ['../book.txt', 'link.txt', '', 'unsupported.wma']) {
        await assert.rejects(api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: value } }), /invalid_library_path|source_changed/);
    }
});

test('Readive reader slots stay bounded and stop clears completed sessions', async t => {
    const { root, service, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    const route = `/libraries/${libraryId}/read`;
    for (let index = 0; index < 4; index += 1) await api(route, { method: 'POST', body: { path: 'book.txt' } });
    await assert.rejects(api(route, { method: 'POST', body: { path: 'book.txt' } }), /too_many_readers/);
    service.server = { close: callback => callback() };
    await service.stop();
    assert.equal(service.readers.sessions.size, 0);
});

test('Readive sends no final reader chunk if its source changes after the bytes were read', async t => {
    const { root, service, api, libraryId } = await fixture(t);
    const filePath = path.join(root, 'book.txt');
    await fs.writeFile(filePath, 'original');
    const opened = (await api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } })).json;
    const result = await api(`/readers/${opened.id}/content`);
    const originalOpen = fs.open;
    let changed = false;
    fs.open = async function (...args) {
        const handle = await originalOpen.apply(this, args);
        if (String(args[0]) === filePath && !changed) {
            const originalStream = handle.createReadStream.bind(handle);
            handle.createReadStream = (...values) => {
                const source = originalStream(...values);
                return { async *[Symbol.asyncIterator]() {
                    for await (const chunk of source) {
                        changed = true;
                        await fs.writeFile(filePath, 'modified');
                        yield chunk;
                    }
                } };
            };
        }
        return handle;
    };
    let bytes = 0;
    const response = new Writable({ write(chunk, encoding, callback) { bytes += chunk.length; callback(); } });
    response.writeHead = () => {};
    try {
        await assert.rejects(service.sendReaderAsset({ headers: {}, socket: remote }, response, result), /source_changed/);
        assert.equal(changed, true);
        assert.equal(bytes, 0, 'the native client completes at Content-Length, so validation must precede the final write');
        assert.equal(service.connections.size, 0);
    } finally { fs.open = originalOpen; response.destroy(); }
});

test('Readive aborted and re-paired pending reads cannot create new sessions', async t => {
    const { root, service, api, libraryId, pair } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    const originalStat = fs.lstat;
    let release;
    let ready;
    let held = false;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { ready = resolve; });
    fs.lstat = async function (file, ...args) {
        if (String(file) === root && !held) { held = true; ready(); await gate; }
        return originalStat.call(this, file, ...args);
    };
    try {
        const pending = api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } });
        const rejected = assert.rejects(pending, /reader_expired|unauthorized/);
        await started;
        await pair();
        release();
        await rejected;
        assert.equal(service.readers.sessions.size, 0);
        assert.equal(service.readers.pending.size, 0);
    } finally { release(); fs.lstat = originalStat; }
});

test('Readive clear retains pending-open admission until all filesystem checks settle', async t => {
    const { root, service, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    const originalStat = fs.lstat;
    let release;
    let ready;
    let held = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { ready = resolve; });
    fs.lstat = async function (file, ...args) {
        if (String(file) === root) { held += 1; if (held === 4) ready(); await gate; }
        return originalStat.call(this, file, ...args);
    };
    try {
        const pending = Array.from({ length: 4 }, () => assert.rejects(api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } }), /reader_expired/));
        await started;
        service.readers.clear();
        await assert.rejects(api(`/libraries/${libraryId}/read`, { method: 'POST', body: { path: 'book.txt' } }), /too_many_readers/);
        assert.equal(service.readers.pending.size, 4);
        release();
        await Promise.all(pending);
        assert.equal(service.readers.pending.size, 0);
        assert.equal(service.readers.sessions.size, 0);
    } finally { release(); fs.lstat = originalStat; }
});
