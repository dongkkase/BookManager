import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const channel = 'app:history-navigation';

for (const filename of ['preload.cjs', 'preload.js']) {
    test(`${filename} forwards history directions without exposing IPC events and removes its own listener`, () => {
        const source = readFileSync(new URL(filename, import.meta.url), 'utf8')
            .replace("import { contextBridge, ipcRenderer } from 'electron';", "const { contextBridge, ipcRenderer } = require('electron');");
        const ipcRenderer = new EventEmitter();
        let api;
        vm.runInNewContext(source, {
            require: name => {
                assert.equal(name, 'electron');
                return {
                    ipcRenderer,
                    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
                };
            },
        });
        const received = [];
        const otherReceived = [];
        const unsubscribe = api.onHistoryNavigation((...args) => received.push(args));
        const unsubscribeOther = api.onHistoryNavigation(direction => otherReceived.push(direction));
        ipcRenderer.emit(channel, { sender: 'must-not-be-exposed' }, -1);
        ipcRenderer.emit(channel, { sender: 'must-not-be-exposed' }, 1);
        assert.deepEqual(received, [[-1], [1]]);
        assert.deepEqual(otherReceived, [-1, 1]);
        assert.equal(ipcRenderer.listenerCount(channel), 2);
        unsubscribe();
        ipcRenderer.emit(channel, {}, -1);
        assert.deepEqual(received, [[-1], [1]]);
        assert.deepEqual(otherReceived, [-1, 1, -1]);
        unsubscribeOther();
        assert.equal(ipcRenderer.listenerCount(channel), 0);
    });
}

function createMainWindowBridge() {
    const source = readFileSync(new URL('main.js', import.meta.url), 'utf8');
    const registrations = Array.from(source.matchAll(/mainWindow\.on\('(?:app-command|swipe)',[\s\S]*?^    \}\);/gm), match => match[0]);
    assert.equal(registrations.length, 2, 'main window must subscribe to native app commands and swipes');
    const sent = [];
    const mainWindow = new EventEmitter();
    mainWindow.webContents = {
        isDestroyed: () => false,
        send: (...args) => sent.push(args),
    };
    vm.runInNewContext(registrations.join('\n'), { mainWindow });
    return { mainWindow, sent };
}

test('main window maps only browser back and forward commands to history IPC', () => {
    const { mainWindow, sent } = createMainWindowBridge();
    for (const command of ['browser-backward', 'browser-forward', 'browser-backward', 'media-play', 'browser-refresh', '']) {
        mainWindow.emit('app-command', {}, command);
    }
    assert.deepEqual(sent, [[channel, -1], [channel, 1], [channel, -1]]);
});

test('main window maps macOS horizontal swipes to history IPC and ignores vertical swipes', () => {
    const { mainWindow, sent } = createMainWindowBridge();
    for (const direction of ['left', 'right', 'left', 'up', 'down', '']) {
        mainWindow.emit('swipe', {}, direction);
    }
    assert.deepEqual(sent, [[channel, -1], [channel, 1], [channel, -1]]);
});

test('native history commands do not send to destroyed web contents', () => {
    const { mainWindow, sent } = createMainWindowBridge();
    mainWindow.webContents.isDestroyed = () => true;
    mainWindow.emit('app-command', {}, 'browser-backward');
    mainWindow.emit('swipe', {}, 'left');
    assert.deepEqual(sent, []);
});
