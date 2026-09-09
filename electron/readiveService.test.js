import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
const prefix = '/readive/v1';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-service-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const service = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local], now: () => Date.parse('2026-09-07T12:00:00Z') });
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    const pair = async (deviceId = 'device-123') => {
        const ticket = JSON.parse((await service.pairing()).ticket);
        const result = await service.dispatch({ ...remote, method: 'POST', pathname: `${prefix}/pair`, body: { secret: ticket.secret, deviceId, deviceName: deviceId } });
        return result.json.token;
    };
    return { root, service, pair };
}

function api(service, token, method, route, body) {
    return service.dispatch({ ...remote, token, method, pathname: `${prefix}${route}`, body });
}

test('Readive session QR remains reusable while every LAN route requires authentication', async t => {
    const { service } = await fixture(t);
    const pairing = await service.pairing();
    const ticket = JSON.parse(pairing.ticket);
    assert.equal(pairing.sessionScoped, true);
    assert.equal(ticket.expiresAt, '9999-12-31T23:59:59.999Z');
    assert.deepEqual((await service.status()).pairing, pairing);
    assert.deepEqual(await service.pairing(), pairing);
    assert.match(pairing.qrDataUrl, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(pairing.qrDataUrl.split(',')[1], 'base64').toString('utf8');
    assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.equal(svg.includes(ticket.secret), false);
    assert.equal(JSON.parse(Buffer.from(pairing.qrPayload.split('ticket=')[1], 'base64url')).certificateSha256, 'a'.repeat(64));
    const args = { ...remote, method: 'POST', pathname: `${prefix}/pair`, body: { secret: ticket.secret, deviceId: 'device-123', deviceName: 'Phone' } };
    const { token } = (await service.dispatch(args)).json;
    service.now = () => Date.parse('2027-09-07T12:00:00Z');
    const secondDevice = (await service.dispatch({ ...args, body: { ...args.body, deviceId: 'device-456' } })).json;
    assert.equal(secondDevice.deviceId, 'device-456');
    assert.deepEqual((await service.status()).pairing, pairing, 'Pairing a device and elapsed time do not replace the session QR');
    await assert.rejects(api(service, 'invalid', 'GET', '/jobs'), /unauthorized/);
    await assert.rejects(service.dispatch({ ...remote, remoteAddress: '192.168.6.20', token, method: 'GET', pathname: `${prefix}/jobs` }), /lan_only/);
    const replacementTicket = JSON.parse((await service.pairing()).ticket);
    assert.equal(replacementTicket.secret, ticket.secret);
    const replacement = (await service.dispatch({ ...args, body: { ...args.body, secret: replacementTicket.secret } })).json.token;
    await assert.rejects(api(service, token, 'GET', '/jobs'), /unauthorized/);
    assert.equal((await api(service, replacement, 'GET', '/jobs')).json.jobs.length, 0);
    await service.revoke({ deviceId: 'device-123' });
    await assert.rejects(api(service, token, 'GET', '/jobs'), /unauthorized/);
});

test('stopping clears the session QR and a later session rejects the previous secret', async t => {
    const { service } = await fixture(t);
    const original = await service.pairing();
    const oldTicket = JSON.parse(original.ticket);
    await service.stop();
    assert.equal((await service.status()).pairing, null);
    assert.equal(service.ticket, null);
    await assert.rejects(service.pairing(), /server_not_running/);
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    const current = await service.pairing();
    assert.notEqual(current.ticket, original.ticket);
    await assert.rejects(service.dispatch({ ...remote, method: 'POST', pathname: `${prefix}/pair`, body: { secret: oldTicket.secret, deviceId: 'device-old', deviceName: 'Old session' } }), /invalid_pairing_ticket/);
    const saved = await fs.readFile(service.store.filePath, 'utf8');
    assert.equal(saved.includes(oldTicket.secret), false);
    assert.equal(saved.includes(JSON.parse(current.ticket).secret), false);
});

test('a pairing lookup cannot publish QR data after its server is stopped or replaced', async t => {
    for (const restart of [false, true]) {
        const { service } = await fixture(t);
        let release;
        const loaded = service.store.load.bind(service.store);
        service.store.load = async () => { await new Promise(resolve => { release = resolve; }); return loaded(); };
        const pending = service.pairing();
        const rejected = assert.rejects(pending, /server_not_running/);
        await service.stop();
        if (restart) {
            service.server = { close: callback => callback() };
            service.localInterface = local;
            service.port = 19421;
        }
        release();
        await rejected;
        assert.equal(service.sessionPairing, null);
        assert.equal(service.ticket, null);
    }
});

test('a queued QR redemption cannot register a device after its session stops or changes', async t => {
    for (const restart of [false, true]) {
        const { service } = await fixture(t);
        const { secret } = JSON.parse((await service.pairing()).ticket);
        let release;
        service.store.pending = new Promise(resolve => { release = resolve; });
        const pending = service.dispatch({ ...remote, method: 'POST', pathname: `${prefix}/pair`, body: { secret, deviceId: 'device-stale', deviceName: 'Stale request' } });
        const rejected = assert.rejects(pending, /invalid_pairing_ticket/);
        await new Promise(resolve => setImmediate(resolve));
        await service.stop();
        if (restart) {
            service.server = { close: callback => callback() };
            service.localInterface = local;
            service.port = 19421;
            await service.pairing();
        }
        release();
        await rejected;
        assert.deepEqual(service.store.state.devices, []);
    }
});

test('Readive jobs require two approvals, persist partial ACKs, deduplicate, and cancel without deleting sources', async t => {
    const { root, service, pair } = await fixture(t);
    const token = await pair();
    await fs.mkdir(path.join(root, 'Books'));
    await fs.writeFile(path.join(root, 'Books', 'one.txt'), 'one');
    await fs.writeFile(path.join(root, 'Books', 'two.txt'), 'two');
    const scan = await service.scan({ paths: [path.join(root, 'Books')] });
    service.now = Date.now;
    await assert.rejects(service.enqueue({ snapshotId: scan.id, deviceId: 'device-123' }), /confirmation_required/);
    const job = await service.enqueue({ snapshotId: scan.id, deviceId: 'device-123', confirmed: true });
    const duplicate = await service.enqueue({ snapshotId: scan.id, deviceId: 'device-123', confirmed: true });
    assert.equal(duplicate.id, job.id);
    const rescanned = await service.scan({ paths: [path.join(root, 'Books')] });
    const repeated = await service.enqueue({ snapshotId: rescanned.id, deviceId: 'device-123', confirmed: true });
    assert.equal(repeated.id, job.id, 'a new scan preserves committed directory and file IDs');
    const { manifest } = (await api(service, token, 'GET', `/jobs/${job.id}`)).json;
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.directories.length, 1);
    await assert.rejects(api(service, token, 'GET', `/jobs/${job.id}/files/${manifest.files[0].id}`), /accept_required/);
    await api(service, token, 'POST', `/jobs/${job.id}/accept`, { manifestId: manifest.id });
    const asset = (await api(service, token, 'GET', `/jobs/${job.id}/files/${manifest.files[0].id}`)).asset;
    assert.equal(asset.size, 3);
    await api(service, token, 'POST', `/jobs/${job.id}/ack`, { fileId: manifest.files[0].id });
    await api(service, token, 'POST', `/jobs/${job.id}/ack`, { fileId: manifest.files[0].id });
    await assert.rejects(api(service, token, 'POST', `/jobs/${job.id}/ack`, { complete: true }), /incomplete_transfer/);
    const restored = new ReadiveService({ directory: path.join(root, 'state'), interfaces: () => [local] });
    restored.localInterface = local;
    assert.deepEqual((await api(restored, token, 'GET', `/jobs/${job.id}`)).json.job.completedFileIds, [manifest.files[0].id]);
    await api(restored, token, 'POST', `/jobs/${job.id}/cancel`, {});
    await assert.rejects(api(restored, token, 'GET', `/jobs/${job.id}/files/${manifest.files[1].id}`), /job_cancelled/);
    assert.equal(await fs.readFile(path.join(root, 'Books', 'one.txt'), 'utf8'), 'one');
});

test('Readive approvals bind the chosen device and frozen source snapshot', async t => {
    const { root, service, pair } = await fixture(t);
    const token = await pair();
    const secondToken = await pair('device-456');
    const filePath = path.join(root, 'one.txt');
    await fs.writeFile(filePath, 'one');
    const scan = await service.scan({ paths: [filePath] });
    service.now = Date.now;
    const job = await service.enqueue({ snapshotId: scan.id, deviceId: 'device-123', confirmed: true });
    await assert.rejects(api(service, secondToken, 'GET', `/jobs/${job.id}`), /not_found/);
    await fs.writeFile(filePath, 'replacement');
    await assert.rejects(api(service, token, 'POST', `/jobs/${job.id}/accept`, { manifestId: scan.id }), /source_changed/);
});


test('Readive allows sending completed payloads again while preserving destination collection identity', async t => {
    const { root, service, pair } = await fixture(t);
    const token = await pair();
    await fs.mkdir(path.join(root, 'Books'));
    await fs.writeFile(path.join(root, 'Books', 'one.txt'), 'one');
    const scan = await service.scan({ paths: [path.join(root, 'Books')] });
    service.now = Date.now;
    const first = await service.enqueue({ snapshotId: scan.id, deviceId: 'device-123', confirmed: true });
    const manifest = (await api(service, token, 'GET', `/jobs/${first.id}`)).json.manifest;
    await api(service, token, 'POST', `/jobs/${first.id}/accept`, { manifestId: manifest.id });
    await api(service, token, 'POST', `/jobs/${first.id}/ack`, { fileId: manifest.files[0].id });
    await api(service, token, 'POST', `/jobs/${first.id}/ack`, { complete: true });
    const rescanned = await service.scan({ paths: [path.join(root, 'Books')] });
    const second = await service.enqueue({ snapshotId: rescanned.id, deviceId: 'device-123', confirmed: true });
    assert.notEqual(second.id, first.id);
    assert.equal(second.state, 'queued');
    const nextManifest = (await api(service, token, 'GET', `/jobs/${second.id}`)).json.manifest;
    assert.equal(nextManifest.directories[0].id, manifest.directories[0].id);
    assert.equal(nextManifest.files[0].itemId, manifest.files[0].itemId);
});
