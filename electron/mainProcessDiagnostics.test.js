import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createExitDialogOptions, normalizeRuntimeState, shouldProceedWithExit } from './exitPolicy.js';
import { attachWindowSafetyHandlers, installProcessSafetyHandlers, isExpectedProcessExit } from './processSafety.js';

const mainSource = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');

function sourceSection(start, end, source = mainSource) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing main process section: ${start}`);
    return source.slice(startIndex, endIndex);
}

function harness({ working = false, dialogResponse = 1, deferDialog = false, observedRuntime = true, runtimeLookupFails = false } = {}) {
    const app = new EventEmitter();
    const windows = [];
    const reports = [];
    const localReports = [];
    const pendingHandlers = [];
    const timers = new Map();
    const runtimeState = { isWorking: working, language: 'ko', activeTab: 'folder' };
    const runtimeStates = new Map(observedRuntime ? [[1, runtimeState]] : []);
    const getRuntimeState = vm.runInNewContext(
        `({ ${sourceSection('    getRuntimeState(', '    cancelAll(', ipcSource)} }).getRuntimeState`,
        { runtimeStates, normalizeRuntimeState },
    );
    let timerId = 0;
    let resolveDialog;
    let cancelledTasks = 0;
    let preparedViewers = 0;

    function dispatch(target, eventName) {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const listener of target.listeners(eventName)) {
            const result = listener(event);
            if (result?.then) pendingHandlers.push(result);
        }
        return event;
    }

    class FakeWindow extends EventEmitter {
        constructor() {
            super();
            this.destroyed = false;
            this.closeAccepted = false;
            this.reloads = 0;
            this.webContents = Object.assign(new EventEmitter(), {
                id: windows.length + 1,
                isDestroyed: () => this.destroyed,
                reload: () => { this.reloads += 1; },
            });
            windows.push(this);
        }
        static getAllWindows() { return windows.filter(window => !window.destroyed); }
        isDestroyed() { return this.destroyed; }
        setMenu() {}
        loadFile() {}
        close() {
            if (!dispatch(this, 'close').defaultPrevented) this.closeAccepted = true;
        }
        finishClose() {
            assert.equal(this.closeAccepted, true);
            this.destroyed = true;
            this.emit('closed');
        }
    }

    app.quit = () => dispatch(app, 'before-quit');
    const main = vm.runInNewContext([
        sourceSection('let mainWindow = null;', '// 개발 모드 여부'),
        sourceSection('function isAppShuttingDown()', 'installProcessSafetyHandlers({'),
        sourceSection('function createMainWindow(config)', 'function createTray()'),
        sourceSection("app.on('window-all-closed'", "app.on('will-quit'"),
        'configManager = testConfigManager;',
        'ipcController = testIpcController;',
        'viewerController = testViewerController;',
        '({ createMainWindow, isAppShuttingDown, reportProcessFault });',
    ].join('\n'), {
        app, BrowserWindow: FakeWindow, path, process: { platform: 'win32' },
        __dirname: '/application/electron', APP_NAME: 'BookManager', APP_ID: 'com.bookmanager.app',
        DIST_INDEX_PATH: '/application/dist/index.html', isDev: false, useDevServer: false, useUnsafeDevNodeIntegration: false,
        console: { warn() {}, error() {} },
        screen: { getPrimaryDisplay: () => ({ workArea: {} }), getAllDisplays: () => [] },
        resolveWindowState: () => ({ bounds: {}, minWidth: 800, minHeight: 600 }),
        serializeWindowState: () => ({}),
        getAppIconPath: () => '',
        installEditorMediaHeaders() {},
        createExitDialogOptions, shouldProceedWithExit,
        dialog: {
            showMessageBox: () => deferDialog
                ? new Promise(resolve => { resolveDialog = response => resolve({ response }); })
                : Promise.resolve({ response: dialogResponse }),
        },
        getSharingServerStatus: () => ({ OPDS: {}, Web: {}, WebDAV: {} }),
        flushTelemetry: async () => {},
        testConfigManager: { config: {}, updateConfig() {} },
        testIpcController: {
            getRuntimeState: (...args) => {
                if (runtimeLookupFails) throw new Error('Runtime state lookup failed');
                return getRuntimeState(...args);
            },
            cancelAll: () => { cancelledTasks += 1; },
            waitForIdle: async () => {},
            clear: ownerId => runtimeStates.delete(ownerId),
        },
        testViewerController: {
            prepareForAppQuit: () => { preparedViewers += 1; },
            closeAllWindows() {},
        },
        reportLocalProcessFault: (eventName, details) => localReports.push({ eventName, details }),
        reportTelemetryError: (details, context) => reports.push({ details, context: structuredClone(context) }),
        isExpectedProcessExit: (details, options) => isExpectedProcessExit(details, { platform: 'win32', ...options }),
        attachWindowSafetyHandlers: (window, options) => attachWindowSafetyHandlers(window, {
            ...options,
            setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
            clearTimeout: id => timers.delete(id),
        }),
    });
    installProcessSafetyHandlers({
        processTarget: new EventEmitter(), appTarget: app, reportFault: main.reportProcessFault,
    });
    main.createMainWindow({});

    return {
        app, windows, reports, localReports, timers, runtimeState, runtimeStates, getRuntimeState,
        get window() { return windows.at(-1); },
        get cancelledTasks() { return cancelledTasks; },
        get preparedViewers() { return preparedViewers; },
        isShuttingDown: main.isAppShuttingDown,
        reportProcessFault: main.reportProcessFault,
        answerDialog: response => resolveDialog(response),
        recreate: () => app.emit('activate'),
        async settle() {
            while (pendingHandlers.length) await Promise.all(pendingHandlers.splice(0));
        },
        runTimers() {
            for (const [id, callback] of [...timers]) {
                timers.delete(id);
                callback();
            }
        },
    };
}

const controlExit = { reason: 'abnormal-exit', exitCode: -1073741510 };

test('main unresponsive reports identify the running window during pending and cancelled exit confirmation', async () => {
    const h = harness({ working: true, deferDialog: true });
    h.window.webContents.emit('unresponsive');
    h.app.quit();
    h.window.webContents.emit('unresponsive');
    h.answerDialog(1);
    await h.settle();
    h.window.webContents.emit('unresponsive');
    assert.equal(h.reports.length, 3);
    for (const report of h.reports) {
        assert.deepEqual(report.context, {
            source: 'renderer-unresponsive', app_lifecycle: 'running', window_type: 'main',
            menu: 'folder', task_state: 'busy',
        });
        assert.deepEqual(report.details, {});
    }
    assert.equal(h.localReports.length, 3);
    assert.equal(h.timers.size, 0);
    assert.equal(h.window.reloads, 0);
});

test('main unresponsive reports retain confirmed shutdown state and reset for a new window', async () => {
    const h = harness();
    h.window.close();
    await h.settle();
    h.window.webContents.emit('unresponsive');
    assert.deepEqual(h.reports[0].context, {
        source: 'renderer-unresponsive', app_lifecycle: 'quitting', window_type: 'main',
        menu: 'folder', task_state: 'idle',
    });
    h.window.finishClose();
    h.recreate();
    h.window.webContents.emit('unresponsive');
    assert.equal(h.reports[1].context.app_lifecycle, 'running');
    h.window.emit('session-end');
    h.window.webContents.emit('unresponsive');
    assert.equal(h.reports[2].context.app_lifecycle, 'quitting');
    assert.equal(h.reports.length, 3);
    assert.equal(h.timers.size, 0);
});

test('main unresponsive diagnostics use the latest observed menu and task state', () => {
    const h = harness();
    h.runtimeState.activeTab = 'renamer';
    h.runtimeState.isWorking = true;
    h.window.webContents.emit('unresponsive');
    h.runtimeState.activeTab = 'tools';
    h.runtimeState.isWorking = false;
    h.window.webContents.emit('unresponsive');
    assert.deepEqual(h.reports.map(report => ({
        menu: report.context.menu,
        task_state: report.context.task_state,
    })), [
        { menu: 'renamer', task_state: 'busy' },
        { menu: 'tools', task_state: 'idle' },
    ]);
    assert.equal(h.timers.size, 0);
    assert.equal(h.window.reloads, 0);
});

test('unobserved main runtime state is omitted while close flow retains its default state', () => {
    const h = harness({ observedRuntime: false });
    assert.equal(h.getRuntimeState(h.window.webContents.id, { allowDefault: false }), null);
    assert.deepEqual(h.getRuntimeState(h.window.webContents.id), {
        isWorking: false, language: 'ko', activeTab: 'folder',
    });
    h.window.webContents.emit('unresponsive');
    h.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 });
    assert.deepEqual(h.reports.map(report => report.context), [
        { source: 'renderer-unresponsive', app_lifecycle: 'running', window_type: 'main' },
        { source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main' },
    ]);
});

test('late main renderer faults from a closed window cannot inherit replacement state', async () => {
    const h = harness();
    const oldWindow = h.window;
    oldWindow.close();
    await h.settle();
    oldWindow.finishClose();
    h.recreate();
    h.runtimeStates.set(h.window.webContents.id, {
        activeTab: 'metadata', isWorking: true, language: 'ko',
    });
    oldWindow.webContents.emit('unresponsive');
    oldWindow.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 });
    h.window.webContents.emit('unresponsive');
    h.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 });
    assert.deepEqual(h.reports.slice(0, 2).map(report => report.context), [
        { source: 'renderer-unresponsive', app_lifecycle: 'running', window_type: 'main' },
        { source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main' },
    ]);
    for (const report of h.reports.slice(2)) {
        assert.equal(report.context.menu, 'metadata');
        assert.equal(report.context.task_state, 'busy');
    }
});

test('runtime lookup failure still reports original main renderer faults', () => {
    const h = harness({ runtimeLookupFails: true });
    assert.doesNotThrow(() => h.window.webContents.emit('unresponsive'));
    assert.doesNotThrow(() => h.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 }));
    assert.deepEqual(h.reports.map(report => report.context), [
        { source: 'renderer-unresponsive', app_lifecycle: 'running', window_type: 'main' },
        { source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main' },
    ]);
    assert.equal(h.localReports.length, 2);
});

test('process reports forward selected runtime diagnostics only for main renderer faults', () => {
    const h = harness();
    const context = { menu: 'tools', task_state: 'busy', privatePath: '/private/book.txt', source: 'viewer' };
    h.reportProcessFault('renderer-unresponsive', {}, context);
    h.reportProcessFault('render-process-gone', {}, context);
    h.reportProcessFault('child-process-gone', {}, context);
    h.reportProcessFault('uncaughtException', {}, context);
    assert.deepEqual(h.reports.map(report => report.context), [
        {
            source: 'renderer-unresponsive', app_lifecycle: 'running', window_type: 'main',
            menu: 'tools', task_state: 'busy',
        },
        {
            source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main',
            menu: 'tools', task_state: 'busy',
        },
        { source: 'child-process-gone', app_lifecycle: 'running' },
        { source: 'uncaughtException' },
    ]);
});

test('main renderer OOM retains original details and latest runtime diagnostics with one recovery', () => {
    const h = harness();
    h.runtimeState.activeTab = 'renamer';
    h.runtimeState.isWorking = true;
    const details = { reason: 'oom', exitCode: -536870904 };
    h.window.webContents.emit('render-process-gone', {}, details);
    assert.equal(h.reports[0].details, details);
    assert.deepEqual(h.reports[0].context, {
        source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main',
        menu: 'renamer', task_state: 'busy',
    });
    assert.equal(h.timers.size, 1);
    h.runTimers();
    assert.equal(h.window.reloads, 1);
    assert.equal(h.getRuntimeState(h.window.webContents.id, { allowDefault: false }), h.runtimeState);
    h.window.webContents.emit('render-process-gone', {}, details);
    assert.equal(h.reports[1].details, details);
    assert.equal(h.timers.size, 0);
    assert.equal(h.window.reloads, 1);
    assert.equal(h.cancelledTasks, 0);
});

test('main renderer control exits while running retain diagnostics and trigger one recovery', () => {
    const h = harness();
    h.window.webContents.emit('render-process-gone', {}, controlExit);
    assert.deepEqual(h.reports, [{
        details: controlExit,
        context: {
            source: 'render-process-gone', app_lifecycle: 'running', window_type: 'main',
            menu: 'folder', task_state: 'idle',
        },
    }]);
    assert.equal(h.localReports.length, 1);
    assert.equal(h.timers.size, 1);
    h.runTimers();
    assert.equal(h.window.reloads, 1);
});

test('pending and cancelled main exit confirmation keep process reporting and recovery active', async () => {
    const h = harness({ working: true, deferDialog: true });
    h.app.quit();
    assert.equal(h.isShuttingDown(), false);
    h.app.emit('child-process-gone', {}, { ...controlExit, type: 'GPU' });
    assert.equal(h.reports[0].context.app_lifecycle, 'running');
    h.answerDialog(1);
    await h.settle();
    assert.equal(h.isShuttingDown(), false);
    assert.equal(h.window.closeAccepted, false);
    assert.equal(h.cancelledTasks, 0);
    assert.equal(h.preparedViewers, 0);
    h.window.webContents.emit('render-process-gone', {}, controlExit);
    assert.equal(h.reports[1].context.app_lifecycle, 'running');
    h.runTimers();
    assert.equal(h.window.reloads, 1);
});

test('confirmed main close keeps late control exits suppressed until remaining windows close', async () => {
    const h = harness({ working: true, dialogResponse: 0 });
    h.app.quit();
    await h.settle();
    assert.equal(h.cancelledTasks, 1);
    assert.equal(h.isShuttingDown(), true);
    h.window.finishClose();
    for (const exitCode of [-1073741510, 3221225786]) {
        const details = { ...controlExit, exitCode };
        h.window.webContents.emit('render-process-gone', {}, details);
        h.app.emit('child-process-gone', {}, { ...details, type: 'GPU' });
    }
    assert.equal(h.reports.length, 0);
    assert.equal(h.isShuttingDown(), true);
    assert.equal(h.localReports.length, 4);
    assert.equal(h.timers.size, 0);
    h.app.emit('window-all-closed');
    await h.settle();
    assert.equal(h.isShuttingDown(), true);
});

test('real crashes after main closes remain reported as quitting', async () => {
    const h = harness();
    h.window.close();
    await h.settle();
    h.window.finishClose();
    for (const reason of ['crashed', 'oom']) {
        h.window.webContents.emit('render-process-gone', {}, { reason, exitCode: 1 });
        h.app.emit('child-process-gone', {}, { reason, exitCode: 1, type: 'GPU' });
    }
    assert.equal(h.reports.length, 4);
    assert.ok(h.reports.every(report => report.context.app_lifecycle === 'quitting'));
    assert.equal(h.timers.size, 0);
});

test('creating a new main window restores running diagnostics and recovery', async () => {
    const h = harness();
    const oldWindow = h.window;
    oldWindow.close();
    await h.settle();
    oldWindow.finishClose();
    h.recreate();
    assert.notEqual(h.window, oldWindow);
    assert.equal(h.isShuttingDown(), false);
    h.window.webContents.emit('render-process-gone', {}, controlExit);
    assert.equal(h.reports[0].context.app_lifecycle, 'running');
    h.runTimers();
    assert.equal(h.window.reloads, 1);
});

test('blocked renderer unload restores running diagnostics and allows close or app quit retries', async () => {
    for (const retry of ['close', 'quit']) {
        const h = harness();
        h.app.quit();
        await h.settle();
        assert.equal(h.isShuttingDown(), true);
        h.window.closeAccepted = false;
        h.window.webContents.emit('will-prevent-unload', {
            preventDefault() { assert.fail('The renderer unload guard must remain active'); },
        });
        h.window.webContents.emit('render-process-gone', {}, controlExit);
        assert.equal(h.reports[0]?.context.app_lifecycle, 'running');
        assert.equal(h.isShuttingDown(), false);
        h.runTimers();
        assert.equal(h.window.reloads, 1);
        if (retry === 'close') h.window.close();
        else h.app.quit();
        await h.settle();
        assert.equal(h.window.closeAccepted, true, retry);
        assert.equal(h.isShuttingDown(), true, retry);
    }
});

test('only a confirmed Windows session end suppresses main control exits and pending recovery', () => {
    const h = harness();
    h.window.emit('query-session-end');
    assert.equal(h.isShuttingDown(), false);
    h.window.webContents.emit('render-process-gone', {}, controlExit);
    assert.equal(h.reports[0].context.app_lifecycle, 'running');
    assert.equal(h.timers.size, 1);
    h.window.emit('session-end');
    assert.equal(h.isShuttingDown(), true);
    h.window.webContents.emit('render-process-gone', {}, controlExit);
    h.app.emit('child-process-gone', {}, { ...controlExit, type: 'GPU' });
    h.runTimers();
    assert.equal(h.reports.length, 1);
    assert.equal(h.window.reloads, 0);
    h.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
    assert.equal(h.reports[1].context.app_lifecycle, 'quitting');
});
