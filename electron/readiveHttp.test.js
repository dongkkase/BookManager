import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';
import { listReadiveInterfaces } from './readive/policy.js';

async function freePort(address) {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, address, resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

test('Readive HTTPS verifies pinned identity, emits bounded responses, resumes ranges, and denies stale/cancelled assets', async t => {
    const local = listReadiveInterfaces()[0];
    if (!local) { t.skip('A private IPv4 LAN interface is required.'); return; }
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-https-')));
    const logs = [];
    const service = new ReadiveService({ directory: path.join(root, 'state'), onLog: log => logs.push(log) });
    t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    const port = await freePort(local.address);
    const starts = await Promise.allSettled([service.start({ address: local.address, port }), service.start({ address: local.address, port })]);
    assert.equal(starts[0].status, 'fulfilled');
    assert.equal(starts[1].status, 'rejected');
    assert.equal(service.server.address().address, local.address);
    assert.deepEqual(logs, [{ type: 'INFO', key: 'readive.log_started', values: { url: `https://${local.address}:${port}` } }]);
    const ticket = JSON.parse((await service.pairing()).ticket);
    assert.equal(logs.at(-1).key, 'readive.log_pairing_created');
    const ca = await fs.readFile(path.join(root, 'state', 'certificate.pem'));
    const request = (route, { method = 'GET', body, token, headers = {}, pin = ticket.certificateSha256 } = {}) => new Promise((resolve, reject) => {
        const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const agent = new https.Agent();
        agent.createConnection = (options, callback) => {
            // Only the independently paired leaf pin can authorize this test connection.
            const socket = tls.connect({ ...options, rejectUnauthorized: false });
            socket.once('secureConnect', () => {
                const actual = crypto.createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');
                if (actual !== pin) {
                    socket.destroy();
                    callback(new Error('certificate_pin_mismatch'));
                } else callback(null, socket);
            });
            socket.once('error', callback);
        };
        const req = https.request({
            hostname: local.address, port: service.port, path: `/readive/v1${route}`, method, ca, agent,
            headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const data = Buffer.concat(chunks);
                assert.equal(Number(response.headers['content-length']), data.length);
                assert.equal(response.headers['transfer-encoding'], undefined);
                assert.equal(response.headers['content-encoding'], undefined);
                resolve({ status: response.statusCode, headers: response.headers, bytes: data, json: response.headers['content-type']?.includes('application/json') ? JSON.parse(data) : null });
            });
            response.on('error', reject);
        });
        req.on('error', reject);
        req.end(bytes);
    });
    await assert.rejects(request('/jobs', { pin: '0'.repeat(64) }), /certificate_pin_mismatch/);
    assert.equal((await request('/jobs')).status, 401);
    assert.equal(logs.length, 2, 'job polling does not add log entries');
    const paired = await request('/pair', { method: 'POST', body: { secret: ticket.secret, deviceId: 'phone-test', deviceName: 'Test phone' } });
    const token = paired.json.token;
    assert.deepEqual(logs.at(-1), { type: 'INFO', key: 'readive.log_device_paired', values: { device: 'Test phone' } });
    assert.equal((await request('/pair', { method: 'POST', body: { secret: ticket.secret, deviceId: 'phone-test', deviceName: 'Test phone' } })).status, 401);
    assert.deepEqual(logs.at(-1), { type: 'ERROR', key: 'readive.log_request_failed', values: { code: 'invalid_pairing_ticket' } });
    assert.equal(JSON.stringify(logs).includes(ticket.secret), false);
    assert.equal(JSON.stringify(logs).includes(token), false);
    assert.equal((await request('/jobs', { token, headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const filePath = path.join(root, 'one.txt');
    await fs.writeFile(filePath, '0123456789');
    const snapshot = await service.scan({ paths: [filePath] });
    const job = await service.enqueue({ snapshotId: snapshot.id, deviceId: 'phone-test', confirmed: true });
    const manifest = (await request(`/jobs/${job.id}`, { token })).json.manifest;
    const fileId = manifest.files[0].id;
    assert.equal((await request(`/jobs/${job.id}/files/${fileId}`, { token })).status, 409);
    assert.equal((await request(`/jobs/${job.id}/accept`, { token, method: 'POST', body: { manifestId: manifest.id } })).status, 200);
    const range = await request(`/jobs/${job.id}/files/${fileId}`, { token, headers: { Range: 'bytes=4-7' } });
    assert.equal(range.status, 206);
    assert.equal(range.bytes.toString(), '4567');
    assert.equal(range.headers['content-range'], 'bytes 4-7/10');
    assert.equal((await request(`/jobs/${job.id}/files/${fileId}`, { token, headers: { Range: 'bytes=50-' } })).status, 416);
    await fs.writeFile(filePath, 'changed');
    assert.equal((await request(`/jobs/${job.id}/files/${fileId}`, { token })).status, 409);
    await service.cancel({ jobId: job.id });
    assert.equal((await request(`/jobs/${job.id}/files/${fileId}`, { token })).status, 409);

    service.getRegisteredLibraries = () => [{ path: root, alias: 'Catalog books' }];
    const libraryId = (await service.status()).libraries[0].id;
    assert.deepEqual((await request('/libraries', { token })).json, { libraries: [{ id: libraryId, name: 'Catalog books' }] });
    const entries = await request(`/libraries/${libraryId}/entries?path=`, { token });
    assert.equal(entries.status, 200);
    assert.ok(entries.json.entries.some(entry => entry.name === 'one.txt'));
    assert.equal((await request(`/libraries/${libraryId}/entries?path=..%2F`, { token })).status, 400);
    assert.deepEqual(logs.at(-1), { type: 'ERROR', key: 'readive.log_catalog_failed', values: { code: 'invalid_library_path' } });
    assert.equal((await request('/jobs?path=', { token })).status, 400);
    assert.equal((await request(`/libraries/${libraryId}/entries?unrecognized=1`, { token })).status, 400);
    const scanId = crypto.randomUUID();
    const scanning = await request(`/libraries/${libraryId}/prepare`, { token, method: 'POST', body: { paths: ['one.txt'], scanId } });
    assert.equal(scanning.status, 200);
    assert.equal(scanning.json.scanId, scanId);
    await service.preparations.get(scanning.json.scanId).promise;
    const preparation = await request(`/libraries/${libraryId}/preparations/${scanning.json.scanId}`, { token });
    assert.equal(preparation.json.state, 'ready');
    const catalogJob = preparation.json.job;
    const catalogManifest = preparation.json.manifest;
    const catalogAssetRoute = `/jobs/${catalogJob.id}/files/${catalogManifest.files[0].id}`;
    assert.equal((await request(catalogAssetRoute, { token })).status, 409);
    assert.equal((await request(`/jobs/${catalogJob.id}/accept`, { token, method: 'POST', body: { manifestId: catalogManifest.id } })).status, 200);
    assert.equal((await request(catalogAssetRoute, { token })).bytes.toString(), 'changed');
    const cancelledScanId = crypto.randomUUID();
    assert.equal((await request(`/libraries/${libraryId}/preparations/${cancelledScanId}/cancel`, { token, method: 'POST' })).status, 200);
    assert.equal((await request(`/libraries/${libraryId}/prepare`, { token, method: 'POST', body: { paths: ['one.txt'], scanId: cancelledScanId } })).json.scanId, cancelledScanId);
    assert.deepEqual((await request(`/libraries/${libraryId}/preparations/${cancelledScanId}`, { token })).json, { state: 'failed', error: 'scan_cancelled' });
    await service.setLibraries({ libraryIds: [] });
    assert.equal((await request(catalogAssetRoute, { token })).bytes.toString(), 'changed');
    service.getRegisteredLibraries = () => [];
    assert.equal((await request(catalogAssetRoute, { token })).status, 409);
    await service.stop();
    assert.deepEqual(logs.at(-1), { type: 'INFO', key: 'readive.log_stopped', values: {} });
    await service.stop();
    assert.equal(logs.filter(log => log.key === 'readive.log_stopped').length, 1, 'stopping an idle server does not repeat the log');
});
