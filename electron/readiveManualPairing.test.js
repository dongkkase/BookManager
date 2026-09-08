import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { manualPairingCode, ReadiveManualPairing } from './readive/manualPairing.js';
import { approveManualPairing } from './readive/manualPairingApproval.js';
import { ReadiveService } from './readive/service.js';

const context = { serverId: 'synthetic-server', serverName: 'Synthetic PC', host: '192.168.5.10', port: 19421, certificateSha256: 'a'.repeat(64) };
const credentials = { nonce: 'b'.repeat(64), deviceId: 'synthetic-phone' };
const body = { ...credentials, requestId: '11111111-1111-4111-8111-111111111111', deviceName: 'Synthetic Phone' };
const freshBody = overrides => ({ ...body, requestId: crypto.randomUUID(), ...overrides });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
    let now = Date.parse('2026-09-08T00:00:00.000Z');
    const approval = deferred();
    const calls = [];
    const pairing = new ReadiveManualPairing({ now: () => now, requestApproval: options => { calls.push(options); return approval.promise; } });
    return { pairing, approval, calls, advance: ms => { now += ms; } };
}

test('manual confirmation binds the actual certificate, fresh nonce and device with 64 displayed bits', () => {
    const raw = crypto.createHash('sha256').update(`readive-manual-pair-v1\n${context.certificateSha256}\n${body.nonce}\n${body.deviceId}`).digest('hex');
    const code = manualPairingCode(context.certificateSha256, body.nonce, body.deviceId);
    assert.equal(code.replaceAll(' ', ''), raw.slice(0, 16).toUpperCase());
    assert.match(code, /^[A-F0-9]{4}( [A-F0-9]{4}){3}$/);
    assert.notEqual(code, manualPairingCode('c'.repeat(64), body.nonce, body.deviceId));
    assert.notEqual(code, manualPairingCode(context.certificateSha256, 'c'.repeat(64), body.deviceId));
    assert.notEqual(code, manualPairingCode(context.certificateSha256, body.nonce, 'other-device'));
});

test('approval is required and only the bound device can consume an independently issued one-use ticket', async t => {
    const { pairing, approval, calls } = fixture(); t.after(() => pairing.clear());
    const initial = pairing.begin(body, context);
    assert.deepEqual(Object.keys(initial).sort(), ['expiresAt', 'requestId', 'serverId', 'serverName', 'version']);
    assert.deepEqual(pairing.status(initial.requestId, credentials), { status: 'pending' });
    await flush();
    assert.deepEqual(Object.keys(calls[0]).sort(), ['code', 'deviceName', 'signal']);
    assert.equal(calls[0].code, manualPairingCode(context.certificateSha256, body.nonce, body.deviceId));
    approval.resolve(true); await flush();
    const result = pairing.status(initial.requestId, credentials);
    assert.equal(result.status, 'approved');
    assert.equal(result.ticket.certificateSha256, context.certificateSha256);
    assert.equal(Date.parse(result.ticket.expiresAt), Date.parse(initial.expiresAt) - 60000);
    assert.equal(pairing.consume(result.ticket.secret, { ...body, deviceId: 'other-device' }), false);
    assert.equal(pairing.consume(result.ticket.secret, { ...body, deviceName: 'Renamed' }), false);
    assert.equal(pairing.consume(result.ticket.secret, body), true);
    assert.equal(pairing.consume(result.ticket.secret, body), false);
    assert.deepEqual(pairing.status(initial.requestId, credentials), { status: 'denied' });
});

for (const action of ['cancel', 'clear', 'expire', 'deny', 'error']) {
    test(`${action} cannot turn a late native result into an approved credential`, async t => {
        const { pairing, approval, calls, advance } = fixture(); t.after(() => pairing.clear());
        const initial = pairing.begin(body, context); await flush();
        if (action === 'cancel') assert.deepEqual(pairing.cancel(initial.requestId, credentials), { status: 'cancelled' });
        if (action === 'clear') pairing.clear();
        if (action === 'expire') { advance(120000); pairing.prune(); }
        if (action === 'error') approval.reject(new Error('synthetic-private-message'));
        else approval.resolve(action !== 'deny');
        await flush();
        assert.equal(calls[0].signal.aborted, true);
        if (['clear', 'expire'].includes(action)) assert.throws(() => pairing.status(initial.requestId, credentials), /manual_pairing_expired/);
        else assert.deepEqual(pairing.status(initial.requestId, credentials), { status: 'denied' });
    });
}

test('expiry timer aborts the actual prompt without waiting for another request', async () => {
    const signalReady = deferred();
    const pairing = new ReadiveManualPairing({ ttlMs: 15, requestApproval: ({ signal }) => { signalReady.resolve(signal); return new Promise(() => {}); } });
    pairing.begin(body, context);
    const signal = await signalReady.promise;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(signal.aborted, true);
    assert.equal(pairing.records.size, 0);
    pairing.clear();
});

test('cancelled prompt retains admission until its native promise settles and repeated begin is idempotent', async t => {
    const { pairing, approval, calls } = fixture(); t.after(() => pairing.clear());
    const initial = pairing.begin(body, context);
    assert.deepEqual(pairing.begin(body, context), initial); await flush();
    assert.equal(calls.length, 1);
    assert.throws(() => pairing.begin(freshBody({ nonce: 'c'.repeat(64) }), context), /manual_pairing_busy/);
    pairing.clear();
    assert.throws(() => pairing.begin(freshBody({ nonce: 'c'.repeat(64) }), context), /manual_pairing_busy/);
    approval.resolve(true); await flush();
    assert.ok(pairing.begin(freshBody({ nonce: 'c'.repeat(64) }), context));
});

test('untrusted fields and wrong polling credentials do not alter the request', async t => {
    const { pairing, calls } = fixture(); t.after(() => pairing.clear());
    for (const invalid of [null, [], {}, { ...body, nonce: 'B'.repeat(64) }, { ...body, nonce: 'b'.repeat(65) }, { ...body, deviceId: 'a\nbbbbbbb' }, { ...body, deviceName: 'x\nApprove' }, { ...body, deviceName: '\u202eabc' }, { ...body, deviceName: 'x'.repeat(101) }, { ...body, certificateSha256: 'c'.repeat(64) }]) {
        assert.throws(() => pairing.begin(invalid, context), /manual_pairing_invalid/);
    }
    assert.equal(calls.length, 0);
    const initial = pairing.begin(body, context);
    for (const wrong of [{ ...credentials, nonce: 'c'.repeat(64) }, { ...credentials, deviceId: 'other-device' }]) {
        assert.throws(() => pairing.status(initial.requestId, wrong), /manual_pairing_invalid/);
        assert.throws(() => pairing.cancel(initial.requestId, wrong), /manual_pairing_invalid/);
    }
    assert.deepEqual(pairing.status(initial.requestId, credentials), { status: 'pending' });
});

test('global admission is bounded across sources, and stop cannot reset the rate limit', async () => {
    let now = Date.now();
    const pairing = new ReadiveManualPairing({ now: () => now, requestApproval: async () => false });
    for (let index = 0; index < 10; index += 1) {
        pairing.begin(freshBody({ nonce: index.toString(16).padStart(64, '0') }), context);
        await flush(); pairing.clear();
    }
    assert.throws(() => pairing.begin(body, context), /manual_pairing_busy/);
    now += 600001;
    assert.ok(pairing.begin(body, context));
    await flush(); pairing.clear();
});

test('native approval has deny default, an abortable parent window and localized full-code instructions', async () => {
    for (const language of ['ko', 'en', 'ja']) {
        const controller = new AbortController();
        const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false } };
        let options;
        const approved = await approveManualPairing({ window, config: { language }, code: 'AAAA BBBB CCCC DDDD', deviceName: 'Synthetic phone', signal: controller.signal,
            dialog: { showMessageBox: async (parent, current) => { assert.equal(parent, window); options = current; return { response: 1 }; } } });
        assert.equal(approved, true);
        assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
        assert.equal(options.signal, controller.signal);
        assert.match(options.detail, /AAAA BBBB CCCC DDDD/);
        assert.match(options.detail, /16/);
        assert.doesNotMatch(options.message + options.detail, /manual_approval_/);
        assert.equal(await approveManualPairing({ window, config: { language }, code: 'synthetic', deviceName: 'Synthetic', signal: controller.signal,
            dialog: { showMessageBox: async () => { controller.abort(); return { response: 1 }; } } }), false);
    }
});

async function serviceFixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-manual-test-'));
    const local = { address: context.host, netmask: '255.255.255.0', name: 'en0' };
    const approval = deferred();
    const logs = [];
    const service = new ReadiveService({ directory: root, interfaces: () => [local], requestManualApproval: () => approval.promise, onLog: log => logs.push(log) });
    service.localInterface = local; service.port = context.port; service.certificateSha256 = context.certificateSha256;
    service.server = { close: callback => callback() };
    t.after(async () => { await service.stop(); await fs.rm(root, { recursive: true, force: true }); });
    const api = async (route, requestBody, remoteAddress = '192.168.5.20') => (await service.dispatch({ remoteAddress, localAddress: local.address, method: 'POST', pathname: `/readive/v1${route}`, body: requestBody })).json;
    return { service, approval, api, logs };
}

test('manual HTTP dispatch preserves QR tickets and device state until exact one-use redemption', async t => {
    const { service, approval, api, logs } = await serviceFixture(t);
    const qr = JSON.parse((await service.pairing()).ticket);
    const request = await api('/manual-pair', body);
    assert.equal(service.store.state.devices.length, 0);
    await assert.rejects(api('/manual-pair', { ...body, nonce: 'c'.repeat(64) }, '192.168.6.20'), /lan_only/);
    approval.resolve(true); await flush();
    const { ticket } = await api(`/manual-pair/${request.requestId}/status`, credentials);
    await assert.rejects(api('/pair', { secret: ticket.secret, deviceId: 'other-device', deviceName: body.deviceName }), /invalid_pairing_ticket/);
    const paired = await api('/pair', { secret: ticket.secret, deviceId: body.deviceId, deviceName: body.deviceName });
    assert.equal(paired.serverId, qr.serverId);
    await assert.rejects(api('/pair', { secret: ticket.secret, deviceId: body.deviceId, deviceName: body.deviceName }), /invalid_pairing_ticket/);
    await api('/pair', { secret: qr.secret, deviceId: 'qr-device-123', deviceName: 'QR phone' });
    assert.equal(service.store.state.devices.length, 2);
    const serialized = JSON.stringify(logs);
    for (const secret of [ticket.secret, body.nonce, qr.secret, paired.token]) assert.equal(serialized.includes(secret), false);
});

test('QR refresh does not replace an approved manual ticket and stop invalidates it', async t => {
    const { service, approval, api } = await serviceFixture(t);
    const request = await api('/manual-pair', body);
    approval.resolve(true); await flush();
    const { ticket } = await api(`/manual-pair/${request.requestId}/status`, credentials);
    await service.pairing();
    assert.equal((await api(`/manual-pair/${request.requestId}/status`, credentials)).ticket.secret, ticket.secret);
    await service.stop();
    assert.equal(service.manualPairing.consume(ticket.secret, body), false);
});


test('client UUID makes pre-response and cancel-first requests addressable without a native prompt', async t => {
    const { pairing, approval, calls } = fixture(); t.after(() => pairing.clear());
    assert.deepEqual(pairing.cancel(body.requestId, credentials), { status: 'cancelled' });
    assert.throws(() => pairing.begin(body, context), /manual_pairing_expired/);
    assert.throws(() => pairing.begin({ ...body, nonce: 'c'.repeat(64) }, context), /manual_pairing_invalid/);
    await flush(); assert.equal(calls.length, 0);
    const retry = freshBody({ nonce: 'c'.repeat(64) });
    const started = pairing.begin(retry, context);
    assert.equal(started.requestId, retry.requestId);
    pairing.cancel(retry.requestId, { nonce: retry.nonce, deviceId: retry.deviceId });
    approval.resolve(true); await flush();
    assert.equal(calls.length, 0, 'cancel before the queued prompt starts suppresses the prompt entirely');
    assert.throws(() => pairing.begin(retry, context), /manual_pairing_expired/);
});

test('unknown cancellation tombstones have shared admission limits, exact credential binding and finite lifetime', () => {
    const { pairing, advance } = fixture();
    try {
        for (let index = 0; index < 10; index += 1) pairing.cancel(crypto.randomUUID(), credentials);
        assert.equal(pairing.records.size, 10);
        assert.throws(() => pairing.cancel(crypto.randomUUID(), credentials), /manual_pairing_busy/);
        const id = pairing.records.keys().next().value;
        assert.throws(() => pairing.cancel(id, { ...credentials, nonce: 'c'.repeat(64) }), /manual_pairing_invalid/);
        advance(120000); pairing.prune(); assert.equal(pairing.records.size, 0);
        assert.throws(() => pairing.begin(body, context), /manual_pairing_busy/, 'expiry cannot reset the global request rate');
        advance(480001); assert.ok(pairing.begin(body, context));
    } finally { pairing.clear(); }
});


test('a cancelled native dialog rejection cannot remove the cancellation tombstone', async t => {
    const { pairing, approval } = fixture(); t.after(() => pairing.clear());
    pairing.begin(body, context); await flush();
    pairing.cancel(body.requestId, credentials);
    approval.reject(new Error('aborted native prompt')); await flush();
    assert.throws(() => pairing.begin(body, context), /manual_pairing_expired/);
});
