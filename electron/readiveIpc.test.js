import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerReadiveIpc } from './readive/ipc.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };

async function fixture(t, language = 'en') {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-ipc-')));
    const handlers = new Map();
    const logs = [];
    const config = { language };
    const delivery = { windowDestroyed: false, contentsDestroyed: false, sendFails: false };
    const mainFrame = {};
    const webContents = {
        mainFrame,
        isDestroyed: () => delivery.contentsDestroyed,
        send: (channel, payload) => {
            if (delivery.sendFails) throw new Error('renderer closed during delivery');
            assert.equal(channel, 'server:log');
            logs.push(payload);
        },
    };
    const mainWindow = { isDestroyed: () => delivery.windowDestroyed, webContents };
    const service = registerReadiveIpc({
        ipcMain: {
            handle: (channel, handler) => handlers.set(channel, handler),
            removeHandler: channel => handlers.delete(channel),
        },
        configManager: { userDataPath: root, getConfig: () => config },
        getLibraryDbPath: () => null,
        getMainWindow: () => mainWindow,
    });
    service.interfaces = () => [local];
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    const invoke = (method, args, event = { sender: webContents, senderFrame: mainFrame }) => (
        handlers.get(`readive:${method}`)(event, args)
    );
    t.after(async () => {
        await service.dispose();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { service, invoke, logs, config, delivery, webContents, mainFrame, handlers };
}

test('Readive IPC sends pairing and device events to server logs without exposing credentials or shared-server status', async t => {
    const { service, invoke, logs } = await fixture(t);
    await invoke('status');
    await invoke('status');
    assert.deepEqual(logs, []);

    const pairing = await invoke('pairing');
    const ticket = JSON.parse(pairing.ticket);
    assert.deepEqual((await invoke('status')).pairing, pairing);
    assert.deepEqual(await invoke('pairing'), pairing);
    assert.equal(logs.length, 1);
    assert.match(logs[0].message, /QR/i);
    const result = await service.dispatch({
        ...remote,
        method: 'POST',
        pathname: '/readive/v1/pair',
        body: { secret: ticket.secret, deviceId: 'phone-123', deviceName: 'Phone\n\t[ERROR]\r\u0000' },
    });
    assert.equal(logs.length, 2);
    assert.match(logs[1].message, /Phone/);
    const tokenHash = service.store.state.devices[0].tokenHash;
    await invoke('revoke', { deviceId: 'phone-123' });
    assert.equal(logs.length, 3);
    assert.match(logs[2].message, /Phone/);
    await invoke('revoke', { deviceId: 'phone-123' });
    await invoke('status');
    assert.equal(logs.length, 3, 'repeated revocation and status polling do not add logs');
    await invoke('stop');
    assert.equal(logs.length, 4);
    await invoke('stop');
    assert.equal(logs.length, 4, 'stopping an already stopped server does not add a log');

    for (const log of logs) {
        assert.deepEqual(Object.keys(log).sort(), ['message', 'protocol', 'type']);
        assert.equal(log.type, 'INFO');
        assert.equal(log.protocol, 'Readive');
        assert.doesNotMatch(log.message, /[\u0000-\u001f\u007f]/);
        assert.doesNotMatch(log.message, /readive\.log_/);
    }
    const serialized = JSON.stringify(logs);
    for (const secret of [ticket.secret, pairing.ticket, pairing.qrPayload, result.json.token, tokenHash]) {
        assert.equal(serialized.includes(secret), false, 'credentials never appear in server logs');
    }
});

test('Readive IPC translates new-session logs using the current configured language without logging QR lookups', async t => {
    const { service, invoke, logs, config } = await fixture(t, 'ko');
    await invoke('pairing');
    assert.match(logs[0].message, /QR/);
    assert.match(logs[0].message, /[가-힣]/);
    config.language = 'en';
    await invoke('pairing');
    assert.equal(logs.length, 1, 'Reading the current QR does not generate another pairing event');
    await invoke('stop');
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    await invoke('pairing');
    assert.match(logs[2].message, /QR/);
    assert.doesNotMatch(logs[2].message, /[가-힣]/);
    assert.notEqual(logs[0].message, logs[2].message);
});

test('Readive IPC logs stopped-server pairing failures with a safe error code', async t => {
    const { invoke, logs } = await fixture(t);
    await invoke('stop');
    logs.length = 0;
    await assert.rejects(invoke('pairing'), /server_not_running/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, 'ERROR');
    assert.equal(logs[0].protocol, 'Readive');
    assert.match(logs[0].message, /server_not_running/);
    assert.equal(Object.hasOwn(logs[0], 'status'), false);
});

test('Readive IPC reports action failures without logging raw messages or unsafe error codes', async t => {
    const { service, invoke, logs } = await fixture(t);
    const cases = [
        { method: 'start', code: 'EADDRINUSE', expected: 'EADDRINUSE' },
        { method: 'stop', code: 'private\nsecret-token', expected: 'internal_error' },
        { method: 'pairing', code: 'x'.repeat(65), expected: 'internal_error' },
        { method: 'revoke', code: undefined, expected: 'internal_error' },
    ];
    for (const { method, code, expected } of cases) {
        const original = service[method];
        const error = new Error('private raw error: ticket=secret-token');
        if (code !== undefined) error.code = code;
        service[method] = async () => { throw error; };
        logs.length = 0;
        try {
            await assert.rejects(invoke(method), actual => actual === error);
            assert.equal(logs.length, 1);
            assert.equal(logs[0].type, 'ERROR');
            assert.match(logs[0].message, new RegExp(expected));
            assert.doesNotMatch(logs[0].message, /private|secret-token|ticket=/);
        } finally {
            service[method] = original;
        }
    }
});

test('Readive service operations survive destroyed renderers and failed log delivery', async t => {
    const { service, invoke, logs, delivery } = await fixture(t);
    delivery.windowDestroyed = true;
    assert.ok((await service.pairing()).qrDataUrl);
    assert.deepEqual(logs, []);
    delivery.windowDestroyed = false;
    delivery.contentsDestroyed = true;
    assert.ok((await service.pairing()).qrDataUrl);
    assert.deepEqual(logs, []);
    delivery.contentsDestroyed = false;
    delivery.sendFails = true;
    assert.ok((await invoke('pairing')).qrDataUrl);
    assert.deepEqual(await invoke('stop'), { running: false });
    assert.deepEqual(logs, []);
    assert.equal(service.server, null);
});

test('Readive IPC rejects untrusted senders and frames before creating a ticket or a log', async t => {
    const { service, invoke, logs, webContents, mainFrame, handlers } = await fixture(t);
    await assert.rejects(invoke('pairing', {}, { sender: { mainFrame }, senderFrame: mainFrame }), /readive_untrusted_sender/);
    await assert.rejects(invoke('pairing', {}, { sender: webContents, senderFrame: {} }), /readive_untrusted_frame/);
    await assert.rejects(invoke('status', {}, { sender: { mainFrame }, senderFrame: mainFrame }), /readive_untrusted_sender/);
    await assert.rejects(invoke('status', {}, { sender: webContents, senderFrame: {} }), /readive_untrusted_frame/);
    assert.equal(service.ticket, null);
    assert.deepEqual(logs, []);
    await service.dispose();
    assert.equal(handlers.size, 0);
});
