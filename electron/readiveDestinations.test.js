import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-destinations-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const service = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local] });
    service.localInterface = local;
    service.server = {};
    service.port = 19421;
    service.certificateSha256 = 'a'.repeat(64);
    const tokens = {};
    const api = (route, { method = 'GET', body = {}, deviceId = 'device-one' } = {}) => service.dispatch({ ...remote, token: tokens[deviceId], method, pathname: `/readive/v1${route}`, body });
    for (const deviceId of ['device-one', 'device-two']) {
        const ticket = JSON.parse((await service.pairing()).ticket);
        tokens[deviceId] = (await api('/pair', { method: 'POST', body: { secret: ticket.secret, deviceId, deviceName: deviceId } })).json.token;
    }
    return { root, service, api };
}

async function nextRequest(api) {
    for (let index = 0; index < 20; index += 1) {
        const requests = (await api('/destination-requests')).json.requests;
        if (requests.length) return requests[0];
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('Destination request was not queued');
}

test('Readive destination pages are device-owned, bounded, and only visited folders can be selected', async t => {
    const { service, api } = await fixture(t);
    const pending = service.requestDestinationPage({ deviceId: 'device-one', parentId: null, cursor: null });
    const request = await nextRequest(api);
    assert.deepEqual((await api('/destination-requests', { deviceId: 'device-two' })).json.requests, []);
    const page = { name: 'Phone', parentId: null, entries: [{ id: 'folder-one', name: 'Series', kind: 'directory', size: null }], nextCursor: null, revision: 'root-v1' };
    await assert.rejects(api(`/destinations/${request.id}`, { method: 'POST', body: page, deviceId: 'device-two' }), /destination_unavailable/);
    await api(`/destinations/${request.id}`, { method: 'POST', body: page });
    assert.deepEqual(await pending, page);
    const device = service.store.state.devices.find(item => item.id === 'device-one');
    assert.deepEqual(service.destinations.validate(device, { collectionId: null, name: 'Phone', revision: 'root-v1' }), { collectionId: null, name: 'Phone', revision: 'root-v1' });
    assert.throws(() => service.destinations.validate(device, { collectionId: 'folder-one', name: 'Series', revision: 'root-v1' }), /destination_changed/);
});

test('Readive destination replies reject malformed scope, oversized pages, and duplicate identifiers', async t => {
    const { service, api } = await fixture(t);
    const pending = service.requestDestinationPage({ deviceId: 'device-one', parentId: null });
    const request = await nextRequest(api);
    const page = { name: 'Phone', parentId: null, entries: [], nextCursor: null, revision: 'root-v1' };
    await assert.rejects(api(`/destinations/${request.id}`, { method: 'POST', body: { ...page, parentId: 'different' } }), /invalid_destination_page/);
    const item = { id: 'book-one', name: 'Book', kind: 'file', size: 1 };
    await assert.rejects(api(`/destinations/${request.id}`, { method: 'POST', body: { ...page, entries: [item, item] } }), /invalid_destination_page/);
    await assert.rejects(api(`/destinations/${request.id}`, { method: 'POST', body: { ...page, entries: Array.from({ length: 101 }, (_, index) => ({ ...item, id: `book-${index}` })) } }), /invalid_destination_page/);
    await api(`/destinations/${request.id}`, { method: 'POST', body: page });
    await pending;
});

test('Readive desktop jobs preserve the chosen destination and do not deduplicate another location', async t => {
    const { root, service, api } = await fixture(t);
    const targets = [];
    for (const parentId of [null, 'folder:one']) {
        const pending = service.requestDestinationPage({ deviceId: 'device-one', parentId });
        const request = await nextRequest(api);
        const page = { name: parentId || 'Phone', parentId, entries: [], nextCursor: null, revision: parentId || 'root-v1' };
        await api(`/destinations/${request.id}`, { method: 'POST', body: page });
        await pending;
        targets.push({ collectionId: parentId, name: page.name, revision: page.revision });
    }
    await fs.writeFile(path.join(root, 'book.txt'), 'book');
    const snapshot = await service.scan({ paths: [path.join(root, 'book.txt')] });
    const jobs = [];
    for (const destination of targets) jobs.push(await service.enqueue({ snapshotId: snapshot.id, deviceId: 'device-one', confirmed: true, destination }));
    assert.notEqual(jobs[0].id, jobs[1].id);
    assert.deepEqual(jobs[1].destination, targets[1]);
    assert.deepEqual((await api(`/jobs/${jobs[1].id}`)).json.job.destination, targets[1]);
    await assert.rejects(service.enqueue({ snapshotId: snapshot.id, deviceId: 'device-two', confirmed: true, destination: targets[1] }), /destination_changed/);
});

test('Readive destination request expiry and revocation settle waiters without leaving slots behind', async t => {
    const { service, api } = await fixture(t);
    let now = Date.now();
    service.destinations.now = () => now;
    const expired = service.requestDestinationPage({ deviceId: 'device-one', parentId: null });
    const expiredRejection = assert.rejects(expired, /destination_unavailable/);
    await nextRequest(api);
    now += 30001;
    assert.deepEqual((await api('/destination-requests')).json.requests, []);
    await expiredRejection;
    const pending = service.requestDestinationPage({ deviceId: 'device-one', parentId: null });
    const rejected = assert.rejects(pending, /destination_unavailable/);
    await nextRequest(api);
    await service.revoke({ deviceId: 'device-one' });
    await rejected;
    assert.equal(service.destinations.requests.size, 0);
});

test('Readive destination queue bounds pending work and rejects stale chosen folders', async t => {
    const { service, api } = await fixture(t);
    const pending = Array.from({ length: 4 }, () => assert.rejects(service.requestDestinationPage({ deviceId: 'device-one', parentId: null }), /destination_unavailable/));
    await nextRequest(api);
    await assert.rejects(service.requestDestinationPage({ deviceId: 'device-one', parentId: null }), /destination_busy/);
    service.destinations.clear();
    await Promise.all(pending);
    assert.equal(service.destinations.requests.size, 0);
    let now = Date.now();
    service.destinations.now = () => now;
    const awaiting = service.requestDestinationPage({ deviceId: 'device-one', parentId: null });
    const request = await nextRequest(api);
    await api(`/destinations/${request.id}`, { method: 'POST', body: { name: 'Phone', parentId: null, entries: [], nextCursor: null, revision: 'root-v1' } });
    await awaiting;
    now += 10 * 60 * 1000 + 1;
    const device = service.store.state.devices.find(item => item.id === 'device-one');
    assert.throws(() => service.destinations.validate(device, { collectionId: null, name: 'Phone', revision: 'root-v1' }), /destination_changed/);
});
