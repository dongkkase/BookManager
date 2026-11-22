import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';
import { LibraryDB } from './database/library_db.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'opds-bind-')));
    const books = path.join(root, 'Books');
    await fs.mkdir(books);
    const file = path.join(books, 'Example.txt');
    await fs.writeFile(file, 'Book content');
    const db = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    await db.upsertFileInfo({ path: file, title: 'Example', ext: '.txt', size: 12 });
    const service = new ReadiveService({ directory: path.join(root, 'state'), getLibraryDb: () => db,
        getRegisteredLibraries: () => [{ path: books }], interfaces: () => [local] });
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    t.after(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
    const ticket = JSON.parse((await service.pairing()).ticket);
    const paired = await service.dispatch({ ...remote, method: 'POST', pathname: '/readive/v1/pair', body: {
        secret: ticket.secret, deviceId: 'opds-device', deviceName: 'Phone',
    } });
    const token = paired.json.token;
    const call = (route, body, overrides = {}) => service.dispatch({ ...remote, token, method: 'POST', pathname: '/readive/v1' + route, body, ...overrides });
    const binding = { path: file, size: 12, sha256: crypto.createHash('sha256').update('Book content').digest('hex') };
    return { root, books, file, db, service, call, binding };
}

test('an authenticated OPDS download binds by full content identity and joins existing bidirectional reading sync', async t => {
    const f = await fixture(t);
    const bound = (await f.call('/opds-bind', f.binding)).json;
    assert.equal(bound.sha256, f.binding.sha256);
    assert.equal(bound.size, 12);
    assert.deepEqual((await f.call('/opds-bind', f.binding)).json, bound);
    assert.equal(Object.keys(f.service.store.state.items).length, 1);
    const record = { itemId: bound.itemId, contentHash: bound.sha256, deviceId: 'opds-device', revision: 1,
        updatedAt: new Date().toISOString(), lastReadAt: new Date().toISOString(), readStatus: 'reading',
        locator: { kind: 'normalized', normalizedPosition: 0.4, pageIndex: 40, pageCount: 101 } };
    const exchange = await f.call('/reading', { itemIds: [bound.itemId], records: [record] });
    assert.equal(exchange.json.acknowledged.length, 1);
    let row = f.db.getConnection().prepare('SELECT * FROM reading_states WHERE file_path = ?').get(f.db.normalizeFilePath(f.file));
    assert.equal(row.status, 'reading');
    assert.equal(row.page_index, 40);
    await f.db.upsertReadingState(f.file, { format: 'text', pageIndex: 100, pageCount: 101, status: 'completed', locator: { kind: 'normalized', normalizedPosition: 1 } });
    const pulled = (await f.call('/reading', { itemIds: [bound.itemId], records: [] })).json.records;
    assert.equal(pulled[0].readStatus, 'completed');
});

test('OPDS binding rejects unauthenticated, unshared, traversal, wrong hash and changed files', async t => {
    const f = await fixture(t);
    await assert.rejects(f.call('/opds-bind', f.binding, { token: '' }), /unauthorized/);
    await assert.rejects(f.call('/opds-bind', { ...f.binding, path: path.join(f.root, 'Private.txt') }), /unshared/);
    await assert.rejects(f.call('/opds-bind', { ...f.binding, path: path.join(f.books, '..', 'Private.txt') }), /unshared/);
    await assert.rejects(f.call('/opds-bind', { ...f.binding, sha256: 'a'.repeat(64) }), /source_changed/);
    await assert.rejects(f.call('/opds-bind', { ...f.binding, size: 13 }), /source_changed/);
    const link = path.join(f.books, 'Link.txt');
    await fs.symlink(f.file, link);
    await assert.rejects(f.call('/opds-bind', { ...f.binding, path: link }));
    await fs.writeFile(f.file, 'Othercontent');
    await assert.rejects(f.call('/opds-bind', f.binding), /source_changed/);
    assert.equal(Object.keys(f.service.store.state.items).length, 0);
});

test('revocation, cancellation and unavailable libraries cannot register an OPDS reading item', async t => {
    const f = await fixture(t);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.call('/opds-bind', f.binding, { signal: controller.signal }));
    f.service.getRegisteredLibraries = () => [];
    await assert.rejects(f.call('/opds-bind', f.binding), /unshared/);
    await f.service.store.transact(state => { state.devices = []; });
    await assert.rejects(f.call('/opds-bind', f.binding), /unauthorized/);
    assert.equal(Object.keys(f.service.store.state.items).length, 0);
});
