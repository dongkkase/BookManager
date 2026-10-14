import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { relaunchApp } from './appRelaunch.js';

function fixture(isPackaged = true) {
    const calls = [];
    const app = {
        isPackaged,
        relaunch(...args) { calls.push(['relaunch', ...args]); },
        quit() { calls.push(['quit']); },
    };
    return { app, calls };
}

test('Windows portable relaunches its original launcher before quitting without overriding arguments', () => {
    for (const executable of ['D:\\Apps\\BookManager.exe', 'D:\\내 서재 & Books\\Book Manager.exe']) {
        const { app, calls } = fixture();
        assert.equal(relaunchApp(app, {
            platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: executable },
        }), true);
        assert.deepEqual(calls, [['relaunch', { execPath: executable }], ['quit']]);
    }
});

test('ordinary Windows, macOS, Linux and development builds keep their default relaunch behavior', () => {
    for (const options of [
        { platform: 'win32', isPackaged: true, env: {} },
        { platform: 'darwin', isPackaged: true },
        { platform: 'linux', isPackaged: true },
        { platform: 'win32', isPackaged: false },
        { platform: 'darwin', isPackaged: false },
        { platform: 'linux', isPackaged: false },
    ]) {
        const { app, calls } = fixture(options.isPackaged);
        relaunchApp(app, {
            platform: options.platform,
            env: options.env || { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\BookManager.exe' },
        });
        assert.deepEqual(calls, [['relaunch'], ['quit']]);
    }
});

test('missing, blank and non-string portable executable settings preserve the normal relaunch', () => {
    for (const executable of [undefined, null, '', '   ', 42, {}, ['D:\\Apps\\BookManager.exe']]) {
        const { app, calls } = fixture();
        relaunchApp(app, { platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: executable } });
        assert.deepEqual(calls, [['relaunch'], ['quit']]);
    }
    const { app, calls } = fixture();
    relaunchApp(app, { platform: 'win32', env: null });
    assert.deepEqual(calls, [['relaunch'], ['quit']]);
});

test('a failed relaunch propagates its error without quitting the current app', () => {
    for (const env of [{}, { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\BookManager.exe' }]) {
        const { app, calls } = fixture();
        const failure = new Error('Relaunch failed');
        app.relaunch = () => { calls.push(['relaunch']); throw failure; };
        assert.throws(() => relaunchApp(app, { platform: 'win32', env }), error => error === failure);
        assert.deepEqual(calls, [['relaunch']]);
    }
});

test('the app relaunch IPC delegates to the portable-aware helper and ignores renderer launch options', () => {
    const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    assert.match(source, /import \{ relaunchApp \} from '\.\/appRelaunch\.js';/);
    const start = source.indexOf("ipcMain.handle('app:relaunch'");
    const end = source.indexOf("ipcMain.handle('app:installUpdate'", start);
    assert.ok(start >= 0 && end > start);
    const { app, calls } = fixture();
    const executable = 'D:\\내 서재\\BookManager.exe';
    let handler;
    vm.runInNewContext(source.slice(start, end), {
        ipcMain: {
            handle(channel, callback) {
                assert.equal(channel, 'app:relaunch');
                handler = callback;
            },
        },
        app,
        relaunchApp: (...args) => {
            assert.deepEqual(args, [app]);
            return relaunchApp(app, { platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: executable } });
        },
    });
    assert.equal(handler({}, { execPath: 'C:\\untrusted.exe', args: ['untrusted'] }), true);
    assert.deepEqual(calls, [['relaunch', { execPath: executable }], ['quit']]);
});
