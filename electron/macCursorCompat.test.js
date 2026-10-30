import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { installMacCursorCompat, isMacCursorCompatEnabled } from './macCursorCompat.js';

function createWindow(id) {
    const window = new EventEmitter();
    window.id = id;
    window.isDestroyed = () => false;
    window.getNativeWindowHandle = () => Buffer.alloc(8);
    window.webContents = new EventEmitter();
    window.webContents.isLoading = () => false;
    return window;
}

function fixture(existing = []) {
    const app = new EventEmitter();
    const calls = [];
    const warnings = [];
    const addon = Object.fromEntries(['attach', 'setCursor', 'suspend', 'detach'].map(name => [name, (...args) => calls.push([name, ...args])]));
    const controller = installMacCursorCompat({
        app,
        BrowserWindow: { getAllWindows: () => existing },
        addon,
        platform: 'darwin',
        enabled: true,
        env: {},
        logger: { warn: (...args) => warnings.push(args) },
    });
    return { app, addon, calls, warnings, controller };
}

test('macOS cursor compatibility supports an explicit override and targets macOS 27 by default', () => {
    const policy = { platform: 'darwin', env: {}, systemVersion: '27.0.1' };
    assert.equal(isMacCursorCompatEnabled(policy), true);
    assert.equal(isMacCursorCompatEnabled({ ...policy, systemVersion: '26.6' }), false);
    assert.equal(isMacCursorCompatEnabled({ ...policy, enabled: false }), false);
    assert.equal(isMacCursorCompatEnabled({ ...policy, enabled: false, env: { BOOKMANAGER_MAC_CURSOR_COMPAT: '1' } }), true);
    assert.equal(isMacCursorCompatEnabled({ ...policy, enabled: true, env: { BOOKMANAGER_MAC_CURSOR_COMPAT: '0' } }), false);
    assert.equal(isMacCursorCompatEnabled({ ...policy, platform: 'win32', env: { BOOKMANAGER_MAC_CURSOR_COMPAT: '1' } }), false);
    assert.equal(isMacCursorCompatEnabled({ ...policy, systemVersion: '' }), false);
});

test('disabled platforms never load the native helper or install window listeners', () => {
    const app = new EventEmitter();
    const controller = installMacCursorCompat({
        app,
        platform: 'linux',
        enabled: true,
        loadAddon: () => assert.fail('The macOS addon must not load on Linux.'),
    });
    assert.equal(controller.enabled, false);
    assert.equal(app.listenerCount('browser-window-created'), 0);
});

test('an unavailable helper leaves the normal cursor and window lifecycle untouched', () => {
    const app = new EventEmitter();
    const warnings = [];
    const controller = installMacCursorCompat({
        app,
        platform: 'darwin',
        env: {},
        enabled: true,
        loadAddon: () => { throw new Error('Missing native helper'); },
        logger: { warn: (...args) => warnings.push(args) },
    });
    assert.equal(controller.enabled, false);
    assert.equal(app.listenerCount('browser-window-created'), 0);
    assert.equal(app.listenerCount('will-quit'), 0);
    assert.equal(warnings.length, 1);
    controller.dispose();
});

test('existing and new windows forward Electron cursor types and custom image geometry', () => {
    const first = createWindow(1);
    const { app, calls, controller } = fixture([first]);
    const second = createWindow(2);
    app.emit('browser-window-created', {}, second);
    assert.equal(controller.attachWindow(first), false);
    assert.deepEqual(calls.filter(([name]) => name === 'attach').map(([, , id]) => id), [1, 2]);
    first.webContents.emit('cursor-changed', {}, 'pointer');
    first.webContents.emit('cursor-changed', {}, 'hand');
    const png = Buffer.from('custom-cursor');
    second.webContents.emit('cursor-changed', {}, 'custom', { isEmpty: () => false, toPNG: () => png }, 2, { width: 48, height: 48 }, { x: 10, y: 12 });
    assert.deepEqual(calls.filter(([name]) => name === 'setCursor'), [
        ['setCursor', 1, 'pointer'],
        ['setCursor', 1, 'hand'],
        ['setCursor', 2, 'custom', png, 10, 12, 2],
    ]);
    controller.dispose();
    assert.deepEqual(calls.filter(([name]) => name === 'detach'), [['detach', 1], ['detach', 2]]);
    assert.equal(first.webContents.listenerCount('cursor-changed'), 0);
    assert.equal(second.listenerCount('closed'), 0);
    assert.equal(app.listenerCount('browser-window-created'), 0);
});

test('loading completion cannot reactivate a suspended or crashed renderer and close releases its native cursor', () => {
    const window = createWindow(3);
    const { app, calls, controller } = fixture([window]);
    const lastSuspension = () => calls.filter(([name]) => name === 'suspend').at(-1)[2];
    controller.suspendWindow(window, true);
    window.webContents.emit('did-start-loading');
    window.webContents.emit('did-stop-loading');
    assert.equal(lastSuspension(), true);
    controller.suspendWindow(window, false);
    assert.equal(lastSuspension(), false);
    window.webContents.emit('render-process-gone');
    window.webContents.emit('did-stop-loading');
    assert.equal(lastSuspension(), true);
    window.webContents.emit('did-start-loading');
    window.webContents.emit('did-stop-loading');
    assert.equal(lastSuspension(), false);
    window.emit('closed');
    app.emit('will-quit');
    assert.deepEqual(calls.filter(([name]) => name === 'detach'), [['detach', 3]]);
    assert.equal(window.webContents.listenerCount('render-process-gone'), 0);
});

test('a native update failure detaches only the affected window and restores its native cursor', () => {
    const first = createWindow(4);
    const second = createWindow(5);
    const { addon, calls, warnings, controller } = fixture([first, second]);
    addon.setCursor = () => { throw new Error('Native cursor update failed.'); };
    first.webContents.emit('cursor-changed', {}, 'hand');
    assert.deepEqual(calls.filter(([name]) => name === 'detach'), [['detach', 4]]);
    assert.equal(warnings.length, 1);
    assert.equal(first.webContents.listenerCount('cursor-changed'), 0);
    assert.equal(second.webContents.listenerCount('cursor-changed'), 1);
    controller.dispose();
});

test('embedded webviews and developer tools forward their own cursor and release listeners', () => {
    const window = createWindow(6);
    const { calls, controller } = fixture([window]);
    const guest = new EventEmitter();
    const devTools = new EventEmitter();
    window.webContents.emit('did-attach-webview', {}, guest);
    window.webContents.devToolsWebContents = devTools;
    window.webContents.emit('devtools-opened');
    window.webContents.emit('devtools-opened');
    guest.emit('cursor-changed', {}, 'text');
    devTools.emit('cursor-changed', {}, 'col-resize');
    assert.deepEqual(calls.filter(([name]) => name === 'setCursor'), [
        ['setCursor', 6, 'text'],
        ['setCursor', 6, 'col-resize'],
    ]);
    guest.emit('destroyed');
    assert.equal(guest.listenerCount('cursor-changed'), 0);
    controller.dispose();
    assert.equal(devTools.listenerCount('cursor-changed'), 0);
    assert.equal(window.webContents.listenerCount('did-attach-webview'), 0);
    assert.equal(window.webContents.listenerCount('devtools-opened'), 0);
});
