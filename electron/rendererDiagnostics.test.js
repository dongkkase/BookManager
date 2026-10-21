import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installTelemetryErrorHandlers } from '../src/telemetry.js';
import { setupTelemetryIPC } from './observabilityIpc.js';
import { createTelemetry } from './telemetry.js';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SERVICE_CONFIG = { sentryDsn: 'https://publickey@errors.example.test/42' };
const PRIVATE_CONTENT = /Secret Book|private-user|private-code|private-kind|private-message|token=secret/;

function setup(t, source = 'renderer') {
    const requests = [];
    const clients = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (url, init) => {
            assert.equal(new URL(url).hostname, 'errors.example.test');
            requests.push(init);
            return { ok: true };
        },
        loadSentry: async () => {
            const sdk = await import('@sentry/node');
            return {
                NodeClient: class extends sdk.NodeClient {
                    constructor(options) {
                        super(options);
                        clients.push(this);
                    }
                },
            };
        },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        appVersion: '3.12.0',
        isPackaged: true,
        serviceConfig: SERVICE_CONFIG,
    });

    const handlers = new Map();
    const ipcMain = {
        handle(channel, handler) { handlers.set(channel, handler); },
        on(channel, handler) { handlers.set(channel, handler); },
    };
    const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
    setupTelemetryIPC({ ipcMain, distIndexPath, report: telemetry.reportTelemetryError });
    const mainFrame = { url: pathToFileURL(distIndexPath).href };
    const sender = { senderFrame: mainFrame, sender: { mainFrame } };
    const send = (payload, event = sender) => handlers.get('telemetry:error')(event, structuredClone(payload));
    const listeners = new Map();
    const target = {
        electronAPI: { reportTelemetryError: send },
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name, listener) {
            if (listeners.get(name) === listener) listeners.delete(name);
        },
    };
    const dispose = installTelemetryErrorHandlers({ target, source });
    t.after(async () => {
        dispose();
        telemetry.updateTelemetryConsent({});
        await Promise.all(clients.map(client => client.close()));
    });

    return {
        send,
        sender,
        dispatch: (name, event) => listeners.get(name)(event),
        async events() {
            assert.equal(await telemetry.flushTelemetry(), true);
            const body = requests.map(request => request.body).join('\n');
            assert.doesNotMatch(body, PRIVATE_CONTENT);
            assert.equal(body.includes(APP_ROOT), false);
            return requests.map(request => JSON.parse(request.body.split('\n')[2]));
        },
    };
}

test('renderer errors without ErrorEvent.error retain a trusted script location in the final Sentry envelope', async t => {
    const harness = setup(t);
    harness.dispatch('error', {
        error: null,
        message: 'private-message: Secret Book /Users/private-user/book.epub',
        filename: pathToFileURL(path.join(APP_ROOT, 'src', 'telemetry.js')).href,
        lineno: 86,
        colno: 23,
    });
    const events = await harness.events();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tags, {
        source: 'renderer', os: process.platform, error_kind: 'uncaught-error',
    });
    assert.deepEqual(events[0].exception.values[0].stacktrace.frames, [
        { filename: 'app:///src/telemetry.js', lineno: 86, colno: 23, in_app: true },
    ]);
});

test('renderer fallback locations retain a trusted line when the browser omits the column', async t => {
    const harness = setup(t, 'viewer');
    const filename = pathToFileURL(path.join(APP_ROOT, 'src', 'telemetry.js')).href;
    for (const coordinates of [{ lineno: 86 }, { lineno: 86, colno: 0 }]) {
        harness.dispatch('error', { message: 'private-message Secret Book token=secret', filename, ...coordinates });
        harness.send({ name: 'Error', source: 'viewer', error_kind: 'uncaught-error', filename, ...coordinates });
    }
    const events = await harness.events();
    assert.equal(events.length, 4);
    for (const event of events) {
        assert.deepEqual(event.exception.values[0].stacktrace.frames, [
            { filename: 'app:///src/telemetry.js', lineno: 86, in_app: true },
        ]);
    }
});

test('renderer error codes survive IPC and valid stacks take precedence over ErrorEvent fallback locations', async t => {
    const harness = setup(t, 'viewer');
    const error = Object.assign(new TypeError('private-message: Secret Book'), {
        code: 'ENOENT',
        stack: `TypeError: Secret Book\n    at privateFunction (${path.join(APP_ROOT, 'src', 'telemetry.js')}:19:7)`,
        path: '/Users/private-user/book.epub',
    });
    harness.dispatch('error', {
        error,
        filename: pathToFileURL(path.join(APP_ROOT, 'electron', 'telemetry.js')).href,
        lineno: 95,
        colno: 12,
    });
    const events = await harness.events();
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tags, {
        source: 'viewer', os: process.platform, error_code: 'ENOENT', error_kind: 'uncaught-error',
    });
    assert.equal(events[0].exception.values[0].value, 'TypeError (ENOENT): File or directory not found');
    assert.deepEqual(events[0].exception.values[0].stacktrace.frames, [
        { filename: 'app:///src/telemetry.js', lineno: 19, colno: 7, in_app: true },
    ]);
});

test('plain unhandled rejections and uncaught errors receive distinct safe grouping without their original messages', async t => {
    const harness = setup(t);
    harness.dispatch('unhandledrejection', { reason: 'private-message: Secret Book token=secret' });
    harness.dispatch('error', { message: 'private-message: Secret Book token=secret' });
    const events = await harness.events();
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => event.tags.error_kind), ['unhandled-rejection', 'uncaught-error']);
    assert.notDeepEqual(events[0].fingerprint, events[1].fingerprint);
    for (const event of events) {
        assert.ok(event.fingerprint.some(value => value.includes(event.tags.error_kind)));
        assert.equal(event.exception.values[0].stacktrace, undefined);
    }
});

test('stackless viewer browser notifications get distinct fixed descriptions and safe groups', async t => {
    const harness = setup(t, 'viewer');
    for (const message of [
        'ResizeObserver loop completed with undelivered notifications.',
        'ResizeObserver loop limit exceeded',
        'Script error.',
        'private-message Secret Book token=secret',
    ]) {
        harness.dispatch('error', { error: null, message, filename: '', lineno: 0, colno: 0 });
    }
    const events = await harness.events();
    assert.equal(events.length, 4);
    assert.deepEqual(events.map(event => event.tags.browser_error), [
        'resize-observer-loop', 'resize-observer-loop', 'script-error', undefined,
    ]);
    assert.deepEqual(events.map(event => event.exception.values[0].value), [
        'Error: ResizeObserver loop notifications were deferred',
        'Error: ResizeObserver loop notifications were deferred',
        'Error: Script error details were hidden by the browser',
        'Error: Uncaught JavaScript error',
    ]);
    assert.deepEqual(events[0].fingerprint, events[1].fingerprint);
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, 3);
    for (const event of events) {
        assert.equal(event.tags.source, 'viewer');
        assert.equal(event.tags.error_kind, 'uncaught-error');
        assert.equal(event.exception.values[0].stacktrace, undefined);
        if (event.tags.browser_error) {
            assert.ok(event.fingerprint.includes(`browser_error:${event.tags.browser_error}`));
        }
    }
});

test('renderer browser classifications ignore partial messages and forged diagnostic values', async t => {
    const harness = setup(t, 'viewer');
    for (const message of [
        'private-message Secret Book ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications. token=secret',
        'Script error. Secret Book token=secret',
    ]) {
        harness.send({ name: 'Error', source: 'viewer', error_kind: 'uncaught-error', message, browser_error: 'resize-observer-loop' });
    }
    harness.send({ name: 'Error', source: 'viewer', error_kind: 'uncaught-error', browser_error: 'script-error' });
    harness.send({ name: 'Error', source: 'viewer', message: 'Script error.', browser_error: 'script-error' });
    harness.dispatch('unhandledrejection', { reason: 'ResizeObserver loop limit exceeded' });
    harness.dispatch('unhandledrejection', { reason: 'Script error.' });
    const events = await harness.events();
    assert.equal(events.length, 7);
    for (const event of events) {
        assert.equal(event.tags.browser_error, undefined);
        assert.ok(event.fingerprint.every(value => !value.startsWith('browser_error:')));
    }
});

test('stackless uncaught messages recover allowed error types without transmitting message contents', async t => {
    const harness = setup(t, 'viewer');
    harness.dispatch('error', { message: 'Uncaught TypeError: private-message Secret Book token=secret' });
    harness.dispatch('error', { message: 'Uncaught RangeError: private-message Secret Book token=secret' });
    harness.dispatch('error', { message: 'Uncaught PrivateError: private-message Secret Book token=secret' });
    const events = await harness.events();
    assert.deepEqual(events.map(event => event.exception.values[0].type), ['TypeError', 'RangeError', 'Error']);
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, 3);
    for (const event of events) assert.equal(event.tags.browser_error, undefined);
});

test('IPC rejections retain only registered channels and safe codes after Electron loses the original stack', async t => {
    const harness = setup(t);
    for (const channel of ['config:save', 'viewer:getConfig']) {
        harness.dispatch('unhandledrejection', {
            reason: {
                name: 'Error',
                message: `Error invoking remote method '${channel}': Error: ENOENT: private-message /Users/private-user/Secret Book token=secret`,
                stack: 'Error: private-message\n    at IpcRenderer.invoke (node:electron/js2c/renderer_init:2:6321)',
            },
        });
    }
    const events = await harness.events();
    assert.equal(events.length, 2);
    assert.notDeepEqual(events[0].fingerprint, events[1].fingerprint);
    for (const [index, channel] of ['config:save', 'viewer:getConfig'].entries()) {
        assert.deepEqual(events[index].tags, {
            source: 'renderer', os: process.platform, error_code: 'ENOENT', error_kind: 'unhandled-rejection',
            ipc_channel: channel, rejection_type: 'object',
        });
        assert.equal(events[index].exception.values[0].value, 'Error (ENOENT): File or directory not found');
        assert.equal(events[index].exception.values[0].stacktrace, undefined);
        assert.ok(events[index].fingerprint.includes(`ipc_channel:${channel}`));
    }
});

test('IPC rejection diagnostics recover known error names and preserve explicit allowed codes', async t => {
    const harness = setup(t);
    harness.dispatch('unhandledrejection', {
        reason: {
            name: 'Error', code: 'EACCES',
            message: "Error invoking remote method 'config:save': TypeError: ENOENT: private-message Secret Book",
        },
    });
    harness.dispatch('unhandledrejection', {
        reason: { name: 'Error', message: "Error invoking remote method 'config:save': Error: private-message Secret Book" },
    });
    const events = await harness.events();
    assert.equal(events[0].exception.values[0].type, 'TypeError');
    assert.equal(events[0].tags.error_code, 'EACCES');
    assert.equal(events[1].tags.ipc_channel, 'config:save');
    assert.equal(events[1].exception.values[0].value, 'Error: IPC invocation failed');
});

test('settings save rejections retain their fixed code without exposing settings or paths', async t => {
    const harness = setup(t);
    harness.dispatch('unhandledrejection', {
        reason: new Error("Error invoking remote method 'config:save': Error: CONFIG_SAVE_FAILED: private-message Secret Book token=secret"),
    });
    const [event] = await harness.events();
    assert.equal(event.tags.ipc_channel, 'config:save');
    assert.equal(event.tags.error_code, 'CONFIG_SAVE_FAILED');
    assert.equal(event.exception.values[0].value, 'Error (CONFIG_SAVE_FAILED): Settings could not be saved');
});

test('unknown IPC channels, message contents and forged diagnostic tags do not enter Sentry', async t => {
    const harness = setup(t);
    for (const message of [
        "Error invoking remote method 'private-user': Error: ENOENT: Secret Book",
        "private-message Error invoking remote method 'config:save': Error: ENOENT: Secret Book",
        'private-message: Secret Book ENOENT',
    ]) {
        harness.send({
            name: 'Error', message, source: 'renderer', error_kind: 'unhandled-rejection',
            ipc_channel: 'config:save', rejection_type: 'private-user',
        });
    }
    harness.dispatch('unhandledrejection', {
        reason: { message: "Error invoking remote method 'config:save': Error: private-message Secret Book ENOENT" },
    });
    harness.send({ name: 'Error', source: 'renderer', error_kind: 'uncaught-error', rejection_type: 'string' });
    const events = await harness.events();
    for (const event of events.slice(0, 3)) {
        assert.deepEqual(event.tags, { source: 'renderer', os: process.platform, error_kind: 'unhandled-rejection' });
    }
    assert.equal(events[3].tags.ipc_channel, 'config:save');
    assert.equal(events[3].tags.error_code, undefined);
    assert.equal(events[4].tags.rejection_type, undefined);
});

test('stackless rejection groups distinguish value types without serializing their contents', async t => {
    const harness = setup(t);
    for (const reason of ['private-message Secret Book', null, undefined, { private: 'token=secret' }]) {
        harness.dispatch('unhandledrejection', { reason });
    }
    const events = await harness.events();
    assert.deepEqual(events.map(event => event.tags.rejection_type), ['string', 'null', 'undefined', 'object']);
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, 4);
});

test('rejection value types do not split groups with an existing trusted stack', async t => {
    const harness = setup(t);
    const stack = `Error: private-message\n    at ${path.join(APP_ROOT, 'src', 'telemetry.js')}:19:7`;
    for (const reason of [{ stack }, Object.assign(() => {}, { stack })]) {
        harness.dispatch('unhandledrejection', { reason });
    }
    const events = await harness.events();
    assert.deepEqual(events.map(event => event.tags.rejection_type), ['object', 'function']);
    assert.deepEqual(events[0].fingerprint, events[1].fingerprint);
    assert.deepEqual(events[0].exception.values[0].stacktrace.frames, [
        { filename: 'app:///src/telemetry.js', lineno: 19, colno: 7, in_app: true },
    ]);
});

test('renderer fallback locations exclude external URLs, user documents and nonexistent app files', async t => {
    const harness = setup(t);
    const filenames = [
        'https://private-user.example.test/Secret Book.js?token=secret',
        'file:///Users/private-user/Secret%20Book.js',
        'C:\\Users\\private-user\\Secret Book.js',
        path.join(APP_ROOT, 'src', 'private-user.js'),
        path.join(APP_ROOT, 'src', '..', 'private-user.js'),
        'bookmanager-document://private-user/Secret Book.js',
    ];
    for (const filename of filenames) {
        harness.dispatch('error', {
            message: 'private-message: Secret Book', filename, lineno: 17, colno: 8,
        });
    }
    const events = await harness.events();
    assert.equal(events.length, filenames.length);
    for (const event of events) {
        assert.equal(event.tags.error_kind, 'uncaught-error');
        assert.equal(event.exception.values[0].stacktrace, undefined);
    }
});

test('IPC rejects unknown renderer diagnostic values and invalid fallback coordinates before transmission', async t => {
    const harness = setup(t);
    const filename = pathToFileURL(path.join(APP_ROOT, 'src', 'telemetry.js')).href;
    for (const coordinates of [
        { lineno: 0, colno: 8 },
        { lineno: 17, colno: -1 },
        { lineno: 17, colno: '8' },
        { lineno: '17', colno: 8 },
        { lineno: 17, colno: 1.5 },
        { lineno: 10000001, colno: 8 },
        { lineno: 17, colno: Infinity },
    ]) {
        harness.send({
            name: 'Secret Book', message: 'private-message', code: 'private-code',
            error_kind: 'private-kind', source: 'private-user', filename, ...coordinates,
        });
    }
    const events = await harness.events();
    assert.equal(events.length, 7);
    for (const event of events) {
        assert.deepEqual(event.tags, { source: 'renderer', os: process.platform });
        assert.equal(event.exception.values[0].type, 'Error');
        assert.equal(event.exception.values[0].stacktrace, undefined);
        assert.deepEqual(event.fingerprint, ['bookmanager', 'app', 'renderer', 'Error', 'unknown']);
    }
});

test('foreign frames and malformed renderer payloads cannot send Sentry reports', async t => {
    const harness = setup(t);
    const payload = { name: 'Error', code: 'ENOENT', error_kind: 'unhandled-rejection' };
    const foreign = { url: 'https://private-user.example.test/' };
    harness.send(payload, { senderFrame: foreign, sender: { mainFrame: foreign } });
    harness.send(payload, { ...harness.sender, senderFrame: { ...harness.sender.senderFrame } });
    harness.send(payload, {});
    harness.send(null);
    harness.send('private-message');
    assert.deepEqual(await harness.events(), []);
});
