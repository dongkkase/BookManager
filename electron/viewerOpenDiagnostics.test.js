import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { ViewerSessionManager } from './viewerSessions.js';
import { createCoverEditViewerGuard } from './coverEditViewerGuard.js';
import { observeOperation } from './observabilityOperations.js';
import { createTelemetry } from './telemetry.js';
import { translate } from '../src/utils/i18n.js';

const source = fs.readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace('export function setupViewerWindowManager', 'function setupViewerWindowManager');

function harness(t, language = 'ko', options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-open-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const handlers = new Map();
    const windows = [];
    const usage = [];
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        platform: 'win32',
        fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        storageDir: root,
        appVersion: '3.14.1',
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    t.after(() => telemetry.updateTelemetryConsent({}));
    class FakeWindow extends EventEmitter {
        constructor() {
            super();
            this.messages = [];
            this.webContents = Object.assign(new EventEmitter(), {
                isDestroyed: () => false,
                isLoadingMainFrame: () => false,
                send: (...args) => this.messages.push(args),
            });
            windows.push(this);
        }
        static fromWebContents(sender) { return windows.find(window => window.webContents === sender); }
        isDestroyed() { return false; }
        isMinimized() { return false; }
        setTitle() {}
        setMenu() {}
        loadFile() {}
        show() {}
        focus() {}
    }
    const setup = vm.runInNewContext(`${source}\nsetupViewerWindowManager`, {
        path, process: { platform: 'win32' }, AbortController, setTimeout, clearTimeout,
        console: { info() {}, warn() {} },
        BrowserWindow: FakeWindow, ViewerSessionManager, createCoverEditViewerGuard, translate,
        protocol: { handle() {} },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
        screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
        installEditorMediaHeaders() {},
        setupViewerTtsTelemetry() {},
        observeOperation: (feature, action, settings) => observeOperation(feature, action, {
            ...settings,
            report: telemetry.reportTelemetryError,
            track: event => { usage.push(event); return true; },
            isSessionCurrent: () => true,
        }),
    });
    const manager = setup({ configManager: { getConfig: () => ({ language }) }, ...options });
    return {
        root, windows, usage, requests, telemetry, manager,
        open: filePath => handlers.get('viewer:open')({}, filePath),
        current: window => handlers.get('viewer:getCurrentSession')({ sender: window.webContents }),
    };
}

for (const language of ['ko', 'en', 'ja']) {
    test(`missing viewer files return localized guidance without a Sentry event or changing the open book (${language})`, async t => {
        const h = harness(t, language);
        const existing = path.join(h.root, 'existing.pdf');
        fs.writeFileSync(existing, 'existing book');
        const opened = await h.open(existing);
        assert.equal(opened.success, true);
        const window = h.windows[0];
        const previousMessages = window.messages.length;
        h.usage.length = 0;

        const result = await h.open(path.join(h.root, 'Secret Book.epub'));

        assert.deepEqual(structuredClone(result), {
            success: false, code: 'ENOENT', message: translate('viewer_file_not_found', language),
        });
        assert.notEqual(result.message, 'viewer_file_not_found');
        assert.doesNotMatch(result.message, /Secret Book|Error invoking remote method/);
        assert.equal(h.windows.length, 1);
        assert.equal(window.messages.length, previousMessages);
        assert.equal((await h.current(window)).id, opened.session.id);
        assert.deepEqual(h.usage.map(event => event.event), ['feature_started', 'feature_failed']);
        await h.telemetry.flushTelemetry();
        assert.deepEqual(h.requests, []);
    });
}

test('an unavailable file becomes openable after it is restored without restarting the app', async t => {
    const h = harness(t);
    const filePath = path.join(h.root, 'restored.pdf');
    assert.equal((await h.open(filePath)).code, 'ENOENT');
    assert.equal(h.windows.length, 0);
    fs.writeFileSync(filePath, 'restored book');
    assert.equal((await h.open(filePath)).success, true);
    assert.equal(h.windows.length, 1);
    await h.telemetry.flushTelemetry();
    assert.deepEqual(h.requests, []);
});

test('unexpected viewer I/O failures retain their code and reach Sentry without the source path', async t => {
    const h = harness(t);
    const filePath = path.join(h.root, 'Secret Book.pdf');
    const error = Object.assign(new Error(`private I/O failure: ${filePath}`), { code: 'EIO', syscall: 'stat', path: filePath });
    const stat = fs.statSync;
    t.mock.method(fs, 'statSync', (...args) => {
        if (args[0] === filePath) throw error;
        return stat(...args);
    });
    await assert.rejects(h.open(filePath), failure => failure === error);
    assert.equal(h.windows.length, 0);
    await h.telemetry.flushTelemetry();
    assert.equal(h.requests.length, 1);
    const event = JSON.parse(h.requests[0].body.split('\n')[2]);
    assert.equal(event.tags.feature, 'viewer-open');
    assert.equal(event.tags.error_code, 'EIO');
    assert.equal(event.exception.values[0].value, 'Error (EIO): Input or output operation failed');
    assert.doesNotMatch(h.requests[0].body, /Secret Book|private I\/O failure/);
    assert.equal(h.requests[0].body.includes(h.root), false);
});

test('a different missing resource is not presented as a missing book', async t => {
    const error = Object.assign(new Error('Other resource missing'), { code: 'ENOENT', syscall: 'stat', path: '/other/resource.png' });
    const h = harness(t, 'ko', { getIconPath: () => { throw error; } });
    const filePath = path.join(h.root, 'existing.pdf');
    fs.writeFileSync(filePath, 'existing book');
    await assert.rejects(h.open(filePath), failure => failure === error);
});
