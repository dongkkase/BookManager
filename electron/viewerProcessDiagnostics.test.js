import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { AUDIOBOOK_CLOSE_ACTION, createAudiobookCloseDialogOptions, resolveAudiobookCloseAction } from './audiobookClosePolicy.js';
import { createCoverEditViewerGuard } from './coverEditViewerGuard.js';
import { isExpectedProcessExit } from './processSafety.js';
import { createTelemetry } from './telemetry.js';

const source = readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace('export function setupViewerWindowManager', 'function setupViewerWindowManager');

function harness(platform = 'win32', reportError = () => {}) {
    const windows = [];
    const reports = [];
    const handlers = new Map();
    const mainMessages = [];
    let shuttingDown = false;
    let dialogResponse = 2;
    class FakeWindow extends EventEmitter {
        constructor() {
            super();
            this.webContents = Object.assign(new EventEmitter(), {
                isDestroyed: () => false,
                isLoadingMainFrame: () => false,
                send() {},
                reload() { assert.fail('Viewer diagnostics must not introduce automatic reloads'); },
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
        hide() {}
        focus() {}
        close() {
            this.emit('close', { preventDefault() {} });
        }
    }
    const mainWindow = {
        isDestroyed: () => false,
        isMinimized: () => false,
        show() {},
        focus() {},
        webContents: {
            isDestroyed: () => false,
            send: (channel, payload) => mainMessages.push({ channel, payload: structuredClone(payload) }),
        },
    };
    const setup = vm.runInNewContext(`${source}\nsetupViewerWindowManager`, {
        path, process: { platform }, AbortController, setTimeout, clearTimeout,
        console: { info() {}, warn() {} },
        BrowserWindow: FakeWindow,
        ViewerSessionManager: class {
            create(filePath) {
                const type = { '.m4b': 'audio', '.pdf': 'pdf', '.epub': 'epub' }[path.extname(filePath).toLowerCase()];
                return { id: `session-${filePath}`, filePath, fileName: path.basename(filePath), type };
            }
        },
        protocol: { handle() {} },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
        screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
        dialog: { showMessageBox: async () => ({ response: dialogResponse }) },
        AUDIOBOOK_CLOSE_ACTION, createAudiobookCloseDialogOptions, resolveAudiobookCloseAction,
        createCoverEditViewerGuard,
        installEditorMediaHeaders() {},
        setupViewerTtsTelemetry() {},
        observeOperation: (_feature, action) => action(),
        reportTelemetryError: (error, context) => {
            reports.push({ error, context: structuredClone(context) });
            reportError(error, context);
        },
        isExpectedProcessExit: (details, options) => isExpectedProcessExit(details, { platform, ...options }),
    });
    const manager = setup({ getMainWindow: () => mainWindow, isShuttingDown: () => shuttingDown });
    return {
        manager, windows, reports, handlers, mainMessages,
        setShuttingDown: value => { shuttingDown = value; },
        setDialogResponse: value => { dialogResponse = value; },
        async open(filePath = '/private/book.epub') {
            await manager.openViewer(filePath);
            return windows.at(-1);
        },
    };
}

test('viewer process failures retain details and distinguish running from confirmed app shutdown', async () => {
    const h = harness();
    const window = await h.open();
    window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    assert.equal(h.reports.length, 0);
    const interrupted = { reason: 'abnormal-exit', exitCode: -1073741510 };
    window.webContents.emit('render-process-gone', {}, interrupted);
    assert.equal(h.reports[0].error, interrupted);
    assert.deepEqual(h.reports[0].context, {
        source: 'render-process-gone', window_type: 'viewer', format: 'epub', app_lifecycle: 'running',
    });

    h.setShuttingDown(true);
    h.manager.prepareForAppQuit();
    window.webContents.emit('render-process-gone', {}, interrupted);
    window.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 });
    assert.equal(h.reports.length, 1);
    const crash = { reason: 'crashed', exitCode: -1073741819 };
    window.webContents.emit('render-process-gone', {}, crash);
    assert.equal(h.reports[1].error, crash);
    assert.equal(h.reports[1].context.app_lifecycle, 'quitting');
});

test('PDF process exits retain the current format and native diagnostics through the final Sentry transport', async t => {
    const storageDir = mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-process-'));
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        platform: 'win32',
        fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
    });
    t.after(() => {
        telemetry.updateTelemetryConsent({});
        rmSync(storageDir, { recursive: true, force: true });
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        storageDir,
        appVersion: '3.12.0',
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    const h = harness('win32', telemetry.reportTelemetryError);
    const window = await h.open('/private/previous.epub');
    assert.equal(await h.open('/private/Secret Book.pdf'), window);
    window.webContents.emit('render-process-gone', {}, {});
    const failures = [
        [{ reason: 'crashed', exitCode: -1073741819 }, 'Process crashed'],
        [{ reason: 'oom', exitCode: 1 }, 'Process ran out of memory'],
    ];
    for (const [details] of failures) {
        window.webContents.emit('render-process-gone', {}, { ...details, message: 'Secret Book token=secret', path: '/private/Secret Book.pdf' });
    }
    window.close();
    for (const details of [{ reason: 'killed', exitCode: 1 }, { reason: 'abnormal-exit', exitCode: -1073741510 }]) {
        window.webContents.emit('render-process-gone', {}, details);
    }
    assert.equal(h.reports.length, 3);
    for (const [details] of failures) {
        window.webContents.emit('render-process-gone', {}, details);
    }
    await telemetry.flushTelemetry();

    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 5);
    assert.deepEqual(events[0].tags, {
        format: 'pdf', source: 'render-process-gone', os: 'win32', window_type: 'viewer', app_lifecycle: 'running',
    });
    assert.equal(events[0].exception.values[0].value, 'Error: Process exited unexpectedly');
    for (const [index, [details, description]] of [...failures, ...failures].entries()) {
        const event = events[index + 1];
        assert.deepEqual(event.tags, {
            format: 'pdf', source: 'render-process-gone', os: 'win32', window_type: 'viewer',
            process_reason: details.reason, exit_code: details.exitCode, app_lifecycle: index < 2 ? 'running' : 'quitting',
        });
        assert.equal(event.exception.values[0].value, `Error: ${description}`);
        assert.equal(event.exception.values[0].stacktrace, undefined);
    }
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, 5);
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|Secret Book|token=secret|previous\.epub/);
});

test('completed close and Windows session end suppress expected exits while preserving real crashes', async () => {
    for (const beginClose of [window => window.close(), window => window.emit('session-end')]) {
        const h = harness();
        const window = await h.open();
        beginClose(window);
        window.webContents.emit('render-process-gone', {}, { reason: 'abnormal-exit', exitCode: 3221225786 });
        window.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 });
        assert.equal(h.reports.length, 0);
        window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
        assert.equal(h.reports.length, 1);
        assert.equal(h.reports[0].context.app_lifecycle, 'quitting');
    }
});

test('canceled audio close and a tentative session query do not suppress unexpected exits', async () => {
    const h = harness();
    const window = await h.open('/private/book.m4b');
    window.close();
    await new Promise(resolve => setImmediate(resolve));
    window.emit('query-session-end');
    window.webContents.emit('render-process-gone', {}, { reason: 'abnormal-exit', exitCode: -1073741510 });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].context.app_lifecycle, 'running');
    assert.equal(h.reports[0].context.format, 'audio');
});

test('late crashes remain reportable without attributing the new viewer session', async () => {
    const h = harness();
    const oldWindow = await h.open('/private/old.epub');
    oldWindow.close();
    const newWindow = await h.open('/private/new.epub');
    assert.notEqual(newWindow, oldWindow);
    oldWindow.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 });
    assert.equal(h.reports.length, 0);
    oldWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].error.exitCode, 1);
    assert.deepEqual(h.reports[0].context, {
        source: 'render-process-gone', window_type: 'viewer', app_lifecycle: 'quitting',
    });
    newWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 2 });
    assert.equal(h.reports.length, 2);
    assert.equal(h.reports[1].error.exitCode, 2);
    assert.deepEqual(h.reports[1].context, {
        source: 'render-process-gone', window_type: 'viewer', format: 'epub', app_lifecycle: 'running',
    });
});

test('expected audio process exit still clears an active mini player', async () => {
    const h = harness();
    const window = await h.open('/private/book.m4b');
    h.setDialogResponse(0);
    await h.handlers.get('viewer:closeWindow')({ sender: window.webContents });
    assert.ok(h.mainMessages.some(message => message.payload.type === 'show'));
    h.setShuttingDown(true);
    window.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 });
    assert.equal(h.reports.length, 0);
    assert.equal(h.mainMessages.at(-1).payload.type, 'clear');
});
