import assert from 'node:assert/strict';
import test from 'node:test';
import { copyReadivePairing, getReadivePairingText, readivePairingDeviceRevision } from './readivePairingClipboard.js';

const now = Date.parse('2026-09-08T00:00:00.000Z');
const pairing = { expiresAt: new Date(now + 300000).toISOString(), qrPayload: 'readive://bookmanager?ticket=synthetic-ticket', ticket: '{"synthetic":true}' };

test('manual pairing copies the exact existing QR link or legacy JSON without rebuilding credentials', async () => {
    const values = [];
    assert.equal(await copyReadivePairing({ getText: () => getReadivePairingText(pairing, { running: true, now }), writeText: async text => values.push(text) }), 'copied');
    assert.deepEqual(values, [pairing.qrPayload]);
    assert.equal(getReadivePairingText({ ...pairing, qrPayload: undefined }, { running: true, now }), pairing.ticket);
});

test('expired, stopped and unknown-status pairing never reaches the clipboard', async () => {
    let writes = 0;
    for (const options of [{ running: false, now }, { running: true, statusError: true, now }, { running: true, now: now + 300000 }]) {
        assert.equal(await copyReadivePairing({ getText: () => getReadivePairingText(pairing, options), writeText: async () => { writes += 1; } }), 'unavailable');
    }
    assert.equal(getReadivePairingText({ ...pairing, expiresAt: 'invalid' }, { running: true, now }), '');
    assert.equal(getReadivePairingText(null, { running: true, now }), '');
    assert.equal(writes, 0);
});

test('clipboard denial reports failure only while the same pairing remains valid', async () => {
    assert.equal(await copyReadivePairing({ getText: () => pairing.qrPayload, writeText: async () => { throw new Error('denied'); } }), 'failed');
    let text = pairing.qrPayload;
    assert.equal(await copyReadivePairing({ getText: () => text, writeText: async () => { text = ''; throw new Error('denied'); } }), 'unavailable');
});

test('late clipboard completion cannot report success for stopped, expired or replaced pairing', async () => {
    for (const next of ['', 'readive://bookmanager?ticket=new-synthetic-ticket']) {
        let text = pairing.qrPayload;
        assert.equal(await copyReadivePairing({ getText: () => text, writeText: async () => { text = next; } }), 'unavailable');
    }
});

test('new registration or re-pair invalidates the one-use pairing display while heartbeat and order changes do not', () => {
    const devices = [{ id: 'phone-0001', pairedAt: '2026-09-07T00:00:00.000Z', lastSeenAt: '2026-09-07T01:00:00.000Z' }, { id: 'tablet-001', pairedAt: '2026-09-06T00:00:00.000Z' }];
    const deviceRevision = readivePairingDeviceRevision(devices);
    const boundPairing = { ...pairing, deviceRevision };
    const valid = { running: true, now, deviceRevision };
    assert.equal(getReadivePairingText(boundPairing, valid), pairing.qrPayload);
    assert.equal(readivePairingDeviceRevision([...devices].reverse().map(device => ({ ...device, lastSeenAt: '2026-09-08T00:00:00.000Z' }))), deviceRevision);
    for (const changed of [[...devices, { id: 'newphone-1', pairedAt: new Date(now).toISOString() }], [{ ...devices[0], pairedAt: new Date(now).toISOString() }, devices[1]]]) {
        assert.equal(getReadivePairingText(boundPairing, { ...valid, deviceRevision: readivePairingDeviceRevision(changed) }), '');
    }
});
