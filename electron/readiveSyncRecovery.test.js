import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';
import { LibraryDB } from './database/library_db.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
const deviceId = 'device-recovery';

async function fixture(t, { withLibraryDb = false } = {}) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-sync-recovery-')));
    const libraryDb = withLibraryDb ? new LibraryDB({ dbPath: path.join(root, 'reading.db') }) : null;
    t.after(async () => { await libraryDb?.close(); await fs.rm(root, { recursive: true, force: true }); });
    const service = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local], getLibraryDb: async () => libraryDb });
    service.localInterface = local;
    service.port = 19421;
    service.server = {};
    service.certificateSha256 = 'a'.repeat(64);
    const request = async (token, route, body) => service.dispatch({
        ...remote, token, method: body === undefined ? 'GET' : 'POST', pathname: `/readive/v1${route}`, body,
    });
    const pair = async (id = deviceId) => {
        const ticket = JSON.parse((await service.pairing()).ticket);
        return (await request('', '/pair', { secret: ticket.secret, deviceId: id, deviceName: id })).json.token;
    };
    const share = async (name, id = deviceId) => {
        const filePath = path.join(root, name);
        await fs.writeFile(filePath, name);
        const snapshot = await service.scan({ paths: [filePath] });
        const job = await service.enqueue({ snapshotId: snapshot.id, deviceId: id, confirmed: true });
        return service.store.state.jobs.find(item => item.id === job.id).manifest.files[0];
    };
    return { service, request, pair, share };
}

function reading(file, id = deviceId, revision = 1) {
    return {
        itemId: file.itemId, contentHash: file.sha256, deviceId: id, revision,
        updatedAt: new Date(Date.now() - 1000).toISOString(), lastReadAt: null,
        readStatus: 'reading', locator: { kind: 'page', pageIndex: revision, pageCount: 100 },
    };
}

test('Readive reading recovers after registration with retained mobile books without restoring revoked access', async t => {
    const { service, request, pair, share } = await fixture(t);
    const oldToken = await pair();
    const oldFile = await share('old.txt');
    const oldReading = reading(oldFile);
    await request(oldToken, '/reading', { itemIds: [oldFile.itemId], records: [oldReading] });
    await service.revoke({ deviceId });
    await assert.rejects(request(oldToken, '/jobs'), /unauthorized/);
    const token = await pair();
    const currentFile = await share('current.txt');
    const currentReading = reading(currentFile);
    const unknownFile = { itemId: 'retired-item', sha256: 'b'.repeat(64) };
    const body = {
        itemIds: [oldFile.itemId, currentFile.itemId, unknownFile.itemId],
        records: [reading(oldFile, deviceId, 2), currentReading, reading(unknownFile)],
    };

    const response = await request(token, '/reading', body);
    assert.deepEqual(response.json.records, [currentReading]);
    assert.deepEqual(service.store.state.items[oldFile.sha256].deviceIds, []);
    assert.deepEqual(service.store.state.reading[`${oldFile.itemId}:${deviceId}`], oldReading);
    assert.equal(Object.values(service.store.state.items).some(item => item.itemId === unknownFile.itemId), false);
    assert.equal(service.store.state.reading[`${unknownFile.itemId}:${deviceId}`], undefined);
    assert.deepEqual((await request(token, '/reading', body)).json.records, [currentReading], 'later polls continue to succeed');
    assert.ok(Array.isArray((await request(token, '/jobs')).json.jobs));
});

test('Readive selected reading skips another device book without exposing or changing its history', async t => {
    const { service, request, pair, share } = await fixture(t);
    const token = await pair();
    const otherId = 'device-private';
    const otherToken = await pair(otherId);
    const privateFile = await share('private.txt', otherId);
    const privateReading = reading(privateFile, otherId);
    await request(otherToken, '/reading', { itemIds: [privateFile.itemId], records: [privateReading] });

    const before = structuredClone(service.store.state);
    const response = await request(token, '/reading', {
        itemIds: [privateFile.itemId], records: [reading(privateFile)],
    });
    assert.deepEqual(response.json.records, []);
    assert.deepEqual(service.store.state, before);
});

test('Readive recovery still rejects wrong hashes, records outside the selection, and malformed stale records atomically', async t => {
    const { service, request, pair, share } = await fixture(t);
    const token = await pair();
    const file = await share('current.txt');
    const record = reading(file);
    const unknown = { itemId: 'unknown-item', sha256: 'b'.repeat(64) };
    const before = structuredClone(service.store.state);
    const batches = [
        { body: { itemIds: [file.itemId], records: [{ ...record, contentHash: 'c'.repeat(64) }] }, code: /unshared_reading_item/ },
        { body: { itemIds: [file.itemId], records: [record, reading(unknown)] }, code: /unshared_reading_item/ },
        { body: { itemIds: [file.itemId, unknown.itemId], records: [record, { ...reading(unknown), deviceId: 'spoofed-device' }] }, code: /invalid_reading_record/ },
        { body: { itemIds: [file.itemId, file.itemId], records: [record] }, code: /invalid_reading_selection/ },
        { body: { records: [record, reading(unknown)] }, code: /unshared_reading_item/ },
    ];
    for (const { body, code } of batches) {
        await assert.rejects(request(token, '/reading', body), code);
        assert.deepEqual(service.store.state, before);
    }
});


function signature(record) {
    return { itemId: record.itemId, contentHash: record.contentHash, deviceId: record.deviceId, revision: record.revision };
}

test('Readive unchanged reading polls skip durable writes and notifications while acknowledging accepted uploads', async t => {
    const { service, request, pair, share } = await fixture(t, { withLibraryDb: true });
    const token = await pair();
    const file = await share('unchanged.txt');
    const record = reading(file);
    let saves = 0;
    let changes = 0;
    const save = service.store.save.bind(service.store);
    service.store.save = async () => { saves += 1; await save(); };
    service.onReadingChanged = () => { changes += 1; };
    const body = { itemIds: [file.itemId], records: [record] };
    const first = await request(token, '/reading', body);
    assert.deepEqual(first.json.acknowledged, [signature(record)]);
    assert.equal(saves, 1);
    assert.equal(changes, 1);
    for (let index = 0; index < 3; index += 1) {
        const repeated = await request(token, '/reading', { ...body, knownReadings: [signature(record)] });
        assert.deepEqual(repeated.json.records, []);
        assert.deepEqual(repeated.json.acknowledged, [signature(record)]);
    }
    assert.equal(saves, 1, 'unchanged state is not rewritten');
    assert.equal(changes, 1, 'unchanged progress does not refresh the desktop panels');
    assert.deepEqual((await request(token, '/reading', { ...body, records: [] })).json.records, [record], 'older clients still receive the full selected winners');
    assert.equal(saves, 1);
    const next = { ...record, revision: 2, locator: { kind: 'page', pageIndex: 30, pageCount: 100 } };
    const changed = await request(token, '/reading', { ...body, records: [next], knownReadings: [signature(record)] });
    assert.deepEqual(changed.json.records, [next]);
    assert.deepEqual(changed.json.acknowledged, [signature(next)]);
    assert.equal(saves, 2);
    assert.equal(changes, 2);
});

test('Readive acknowledges a stored losing upload but never a stale or unshared upload', async t => {
    const { service, request, pair, share } = await fixture(t, { withLibraryDb: true });
    const token = await pair();
    const otherId = 'device-other';
    const otherToken = await pair(otherId);
    const file = await share('shared.txt');
    await share('shared.txt', otherId);
    const winner = { ...reading(file, otherId, 3), updatedAt: new Date().toISOString() };
    await request(otherToken, '/reading', { itemIds: [file.itemId], records: [winner] });
    let changes = 0;
    service.onReadingChanged = () => { changes += 1; };
    const losing = reading(file, deviceId, 2);
    const response = await request(token, '/reading', { itemIds: [file.itemId], records: [losing], knownReadings: [signature(winner)] });
    assert.deepEqual(response.json.records, []);
    assert.deepEqual(response.json.acknowledged, [signature(losing)]);
    assert.equal(changes, 0, 'storing a losing device revision does not refresh an unchanged desktop position');
    const changedPayload = { ...losing, locator: { kind: 'page', pageIndex: 90, pageCount: 100 } };
    const repeated = await request(token, '/reading', { itemIds: [file.itemId], records: [changedPayload] });
    assert.deepEqual(repeated.json.acknowledged, [signature(losing)]);
    assert.deepEqual(service.store.state.reading[`${file.itemId}:${deviceId}`], losing, 'the first stored payload keeps ownership of an unchanged revision');
    const stale = await request(token, '/reading', { itemIds: [file.itemId], records: [reading(file)] });
    assert.deepEqual(stale.json.acknowledged, []);
    const privateFile = await share('private-ack.txt', otherId);
    const privateResponse = await request(token, '/reading', { itemIds: [privateFile.itemId], records: [reading(privateFile)], knownReadings: [signature(reading(privateFile, otherId))] });
    assert.deepEqual(privateResponse.json, { records: [], acknowledged: [] });
    assert.equal(service.store.state.reading[`${privateFile.itemId}:${deviceId}`], undefined);
});

test('Readive rejects malformed known reading signatures before accepting an uploaded change', async t => {
    const { service, request, pair, share } = await fixture(t);
    const token = await pair();
    const file = await share('known-validation.txt');
    const record = reading(file);
    const known = signature(record);
    const before = structuredClone(service.store.state);
    const invalid = [null, {}, [known, known], [{ ...known, revision: 0 }], [{ ...known, deviceId: '' }], [{ ...known, contentHash: 'invalid' }], Array.from({ length: 501 }, (_, index) => ({ ...known, itemId: `item-${index}` }))];
    for (const knownReadings of invalid) {
        await assert.rejects(request(token, '/reading', { itemIds: [file.itemId], records: [record], knownReadings }), /invalid_known_reading/);
        assert.deepEqual(service.store.state, before);
    }
    await assert.rejects(request(token, '/reading', { itemIds: [file.itemId], records: [record], knownReadings: [{ ...known, itemId: 'outside-selection' }] }), /unshared_reading_item/);
    assert.deepEqual(service.store.state, before);
    await assert.rejects(request(token, '/reading', { itemIds: [file.itemId], records: [record], knownReadings: [{ ...known, contentHash: 'b'.repeat(64) }] }), /unshared_reading_item/);
    assert.deepEqual(service.store.state, before);
});

test('Readive failed reading persistence rolls back memory and emits no successful acknowledgement or change', async t => {
    const { service, request, pair, share } = await fixture(t);
    const token = await pair();
    const file = await share('save-failure.txt');
    const record = reading(file);
    const before = structuredClone(service.store.state);
    let changes = 0;
    service.onReadingChanged = () => { changes += 1; };
    const save = service.store.save.bind(service.store);
    service.store.save = async () => { throw new Error('fixture-save-failed'); };
    await assert.rejects(request(token, '/reading', { itemIds: [file.itemId], records: [record] }), /fixture-save-failed/);
    assert.deepEqual(service.store.state, before);
    assert.equal(changes, 0);
    service.store.save = save;
    const response = await request(token, '/reading', { itemIds: [file.itemId], records: [record] });
    assert.deepEqual(response.json.acknowledged, [signature(record)]);
    assert.equal(changes, 0, 'history without a desktop database does not trigger a panel refresh');
});

test('Readive frequent job polls keep live presence current and persist it at most once per minute', async t => {
    const { service, request, pair } = await fixture(t);
    let now = Date.now();
    service.now = () => now;
    const token = await pair();
    const startedAt = now;
    const beforeDisk = JSON.parse(await fs.readFile(service.store.filePath, 'utf8'));
    let saves = 0;
    const save = service.store.save.bind(service.store);
    service.store.save = async () => { saves += 1; await save(); };
    for (let second = 1; second < 60; second += 1) {
        now = startedAt + second * 1000;
        await request(token, '/jobs');
        assert.equal((await service.status()).devices.find(item => item.id === deviceId).lastSeenAt, new Date(now).toISOString());
    }
    assert.equal(saves, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(service.store.filePath, 'utf8')), beforeDisk);
    now = startedAt + 60000;
    await request(token, '/jobs');
    assert.equal(saves, 1);
    assert.equal(JSON.parse(await fs.readFile(service.store.filePath, 'utf8')).devices.find(item => item.id === deviceId).lastSeenAt, new Date(now).toISOString());
    now += 1000;
    await request(token, '/jobs');
    await service.store.transact(state => { state.jobs = [...state.jobs]; });
    assert.equal(saves, 2, 'other mutations retain their normal durable transaction');
    await request(token, '/jobs');
    assert.equal(saves, 2);
    await service.revoke({ deviceId });
    await assert.rejects(request(token, '/jobs'), /unauthorized/);
});

test('Readive failed presence persistence restores memory and retries the same checkpoint', async t => {
    const { service, request, pair } = await fixture(t);
    let now = Date.now();
    service.now = () => now;
    const token = await pair();
    const before = structuredClone(service.store.state);
    now += 60000;
    const save = service.store.save.bind(service.store);
    service.store.save = async () => { throw new Error('presence-save-failed'); };
    await assert.rejects(request(token, '/jobs'), /presence-save-failed/);
    assert.deepEqual(service.store.state, before);
    let saves = 0;
    service.store.save = async () => { saves += 1; await save(); };
    await request(token, '/jobs');
    assert.equal(saves, 1);
    assert.equal(JSON.parse(await fs.readFile(service.store.filePath, 'utf8')).devices.find(item => item.id === deviceId).lastSeenAt, new Date(now).toISOString());
});
