import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
const deviceId = 'device-recovery';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-sync-recovery-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const service = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local] });
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
