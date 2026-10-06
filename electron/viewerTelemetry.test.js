import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createTelemetry } from './telemetry.js';
import { setupViewerTtsTelemetry } from './viewerTelemetry.js';

function setup(t) {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-telemetry-'));
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_usage_stats: true },
        storageDir,
        isPackaged: true,
        serviceConfig: { posthogToken: 'phc_testtoken', posthogHost: 'https://analytics.example.test' },
    });
    t.after(() => {
        telemetry.updateTelemetryConsent({});
        fs.rmSync(storageDir, { recursive: true, force: true });
    });
    const distIndexPath = path.join(storageDir, 'dist', 'index.html');
    const frame = { url: `${pathToFileURL(distIndexPath).href}?viewer=1` };
    const sender = { mainFrame: frame };
    const event = { sender, senderFrame: frame };
    let session = { id: 'local-session', type: 'epub', filePath: '/private/book.epub' };
    let listener;
    setupViewerTtsTelemetry({
        ipcMain: { on(channel, callback) {
            assert.equal(channel, 'viewer:tts-used');
            listener = callback;
        } },
        distIndexPath,
        getSessionForSender: source => source === sender ? session : null,
        track: telemetry.trackTelemetryEvent,
        captureSession: telemetry.captureTelemetrySession,
        isSessionCurrent: telemetry.isTelemetrySessionCurrent,
    });
    return {
        telemetry, event,
        send: (payload, source = event) => listener(source, payload),
        setSession: value => { session = value; },
        events: () => requests.filter(value => value.event === 'viewer_tts_used'),
    };
}

test('TTS usage sends actual models once per viewer session and omits private input', async t => {
    const harness = setup(t);
    const models = [
        ['system', 'system'], ['supertonic', 'supertonic-3'],
        ['openai', 'gpt-4o-mini-tts'], ['openai', 'tts-1'], ['google', 'google-cloud-default'],
    ];
    for (const [engine, model] of models) {
        const payload = {
            sessionId: 'local-session', engine, model,
            format: 'comic', text: 'private text', voice: 'private voice', apiKey: 'private key',
        };
        harness.send(payload);
        harness.send(payload);
    }
    await harness.telemetry.flushTelemetry();
    assert.equal(harness.events().length, models.length);
    assert.deepEqual(harness.events().map(value => [value.properties.tts_engine, value.properties.tts_model]), models);
    for (const { properties } of harness.events()) {
        assert.equal(properties.format, 'epub');
        assert.equal(properties.feature, 'viewer-tts');
        assert.deepEqual(Object.keys(properties).sort(), [
            '$geoip_disable', '$ip', '$process_person_profile', 'app_version', 'distinct_id',
            'feature', 'format', 'os', 'tts_engine', 'tts_model',
        ]);
    }
    assert.doesNotMatch(JSON.stringify(harness.events()), /private|local-session/);
    harness.setSession({ id: 'next-session', type: 'text' });
    harness.send({ sessionId: 'next-session', engine: 'openai', model: 'tts-1' });
    await harness.telemetry.flushTelemetry();
    assert.equal(harness.events().length, 6);
    assert.equal(harness.events().at(-1).properties.format, 'text');
});

test('foreign frames, stale sessions, previews and unrecognized engine/model pairs are rejected', async t => {
    const harness = setup(t);
    const payload = { sessionId: 'local-session', engine: 'openai', model: 'tts-1' };
    harness.send(payload, { ...harness.event, senderFrame: { ...harness.event.senderFrame } });
    const foreignFrame = { url: 'https://example.test/?viewer=1' };
    harness.send(payload, { sender: { mainFrame: foreignFrame }, senderFrame: foreignFrame });
    const otherSender = { mainFrame: harness.event.senderFrame };
    harness.send(payload, { ...harness.event, sender: otherSender });
    harness.send({ ...payload, sessionId: 'old-session' });
    harness.send({ ...payload, model: '/private/model' });
    harness.send({ ...payload, engine: 'google' });
    harness.send(null);
    harness.send('private');
    harness.setSession({ id: 'local-session', type: 'epub', preview: true });
    harness.send(payload);
    harness.setSession({ id: 'local-session', type: 'comic' });
    harness.send(payload);
    harness.setSession(null);
    harness.send(payload);
    await harness.telemetry.flushTelemetry();
    assert.deepEqual(harness.events(), []);
});

test('disabled usage is not marked as reported and re-enabling consent starts a fresh count', async t => {
    const harness = setup(t);
    const payload = { sessionId: 'local-session', engine: 'system', model: 'system' };
    harness.telemetry.updateTelemetryConsent({ telemetry_usage_stats: false });
    harness.send(payload);
    await harness.telemetry.flushTelemetry();
    assert.deepEqual(harness.events(), []);
    harness.telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    harness.send(payload);
    harness.send(payload);
    await harness.telemetry.flushTelemetry();
    assert.equal(harness.events().length, 1);
    const previousId = harness.events()[0].properties.distinct_id;
    harness.telemetry.updateTelemetryConsent({ telemetry_usage_stats: false });
    harness.send(payload);
    harness.telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    harness.send(payload);
    await harness.telemetry.flushTelemetry();
    assert.equal(harness.events().length, 2);
    assert.notEqual(harness.events()[1].properties.distinct_id, previousId);
});
