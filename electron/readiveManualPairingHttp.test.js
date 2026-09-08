import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import test from 'node:test';
import { ReadiveService } from './readive/service.js';
import { listReadiveInterfaces } from './readive/policy.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('manual registration over pinned HTTPS requires native approval without relaxing protected routes', async t => {
    const local = listReadiveInterfaces()[0];
    if (!local) { t.skip('A private IPv4 LAN interface is required.'); return; }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-manual-https-'));
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, local.address, resolve); });
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    let approval;
    let approvalSignal;
    const service = new ReadiveService({ directory: root, requestManualApproval: ({ signal }) => {
        approvalSignal = signal;
        return new Promise(resolve => { approval = resolve; });
    } });
    t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    await service.start({ address: local.address, port });
    const pin = service.certificateSha256;
    const request = (route, body, { token, origin, expectedPin = pin } = {}) => new Promise((resolve, reject) => {
        const bytes = Buffer.from(JSON.stringify(body || {}));
        const agent = new https.Agent();
        agent.createConnection = (options, callback) => {
            const socket = tls.connect({ ...options, rejectUnauthorized: false });
            socket.once('secureConnect', () => {
                // The fixture independently knows the server leaf; no HTTP precedes this pin check.
                if (crypto.createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex') !== expectedPin) {
                    socket.destroy(); callback(new Error('pin_mismatch'));
                } else callback(null, socket);
            });
            socket.once('error', callback);
        };
        const req = https.request({ hostname: local.address, port, path: `/readive/v1${route}`, method: 'POST', agent,
            headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) } }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
                const data = Buffer.concat(chunks);
                assert.equal(Number(response.headers['content-length']), data.length);
                assert.equal(response.headers['transfer-encoding'], undefined);
                resolve({ status: response.statusCode, json: JSON.parse(data) });
            });
        });
        req.on('error', reject); req.end(bytes);
    });
    const credentials = { nonce: 'a'.repeat(64), deviceId: 'synthetic-https-phone' };
    const body = { ...credentials, requestId: crypto.randomUUID(), deviceName: 'Synthetic HTTPS phone' };
    assert.equal((await request('/jobs', {})).status, 401);
    assert.equal((await request('/manual-pair', body, { origin: 'https://malicious.invalid' })).status, 403);
    await assert.rejects(request('/manual-pair', body, { expectedPin: '0'.repeat(64) }), /pin_mismatch/);
    const initial = await request('/manual-pair', body);
    assert.equal(initial.status, 200);
    assert.equal(initial.json.requestId, body.requestId);
    assert.equal(service.store.state.devices.length, 0);
    const route = `/manual-pair/${initial.json.requestId}`;
    assert.deepEqual((await request(`${route}/status`, credentials)).json, { status: 'pending' });
    assert.equal((await request(`${route}/status`, { ...credentials, deviceId: 'wrong-device' })).status, 401);
    approval(false); await flush();
    assert.deepEqual((await request(`${route}/status`, credentials)).json, { status: 'denied' });
    const nextBody = { ...body, requestId: crypto.randomUUID(), nonce: 'b'.repeat(64) };
    const next = (await request('/manual-pair', nextBody)).json;
    approval(true); await flush();
    const nextCredentials = { nonce: nextBody.nonce, deviceId: nextBody.deviceId };
    const approved = (await request(`/manual-pair/${next.requestId}/status`, nextCredentials)).json;
    assert.equal(approved.status, 'approved');
    assert.equal(approved.ticket.certificateSha256, pin);
    const pairBody = { secret: approved.ticket.secret, deviceId: body.deviceId, deviceName: body.deviceName };
    assert.equal((await request('/pair', { ...pairBody, deviceId: 'wrong-device' })).status, 401);
    assert.equal((await request('/pair', pairBody)).status, 200);
    assert.equal((await request('/pair', pairBody)).status, 401);
    assert.equal(service.store.state.devices.length, 1);
    const cancelBody = { ...body, requestId: crypto.randomUUID(), nonce: 'c'.repeat(64) };
    const cancelled = (await request('/manual-pair', cancelBody)).json;
    assert.deepEqual((await request(`/manual-pair/${cancelled.requestId}/cancel`, { nonce: cancelBody.nonce, deviceId: body.deviceId })).json, { status: 'cancelled' });
    assert.equal(approvalSignal.aborted, true);
    approval(true); await flush();
    assert.equal(service.store.state.devices.length, 1);
});
