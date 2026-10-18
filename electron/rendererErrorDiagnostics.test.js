import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
    classifyRendererErrorMessage,
    isTelemetryIpcChannelAllowed,
    isTelemetryRejectionTypeAllowed,
} from './rendererErrorDiagnostics.js';

const OPTIONS = {
    errorNames: new Set(['Error', 'TypeError', 'RangeError', 'AbortError']),
    errorCodes: new Map([['ENOENT', 'File or directory not found'], ['EIO', 'Input or output operation failed']]),
};

test('IPC messages retain only an exact known channel and known error prefixes', () => {
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'fs:readDir': Error: ENOENT: /Users/private-user/Secret Book token=secret", OPTIONS,
    ), { ipc_channel: 'fs:readDir', name: 'Error', code: 'ENOENT' });
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'viewer:getText': TypeError: Secret Book token=secret", OPTIONS,
    ), { ipc_channel: 'viewer:getText', name: 'TypeError' });
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'metadata:save': EIO: /Users/private-user/Secret Book", OPTIONS,
    ), { ipc_channel: 'metadata:save', code: 'EIO' });
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'config:get': Error: ENOENT", OPTIONS,
    ), { ipc_channel: 'config:get', name: 'Error', code: 'ENOENT' });
});

test('unknown channels, malformed prefixes and ordinary messages yield no inferred diagnostics', () => {
    for (const message of [
        "Error invoking remote method 'private-user:SecretBook': Error: ENOENT: token=secret",
        "Error invoking remote method 'fs:private-file': Error: ENOENT: token=secret",
        "Error invoking remote method 'fs:readDir/private-file': Error: ENOENT",
        "Error invoking remote method 'FS:readDir': Error: ENOENT",
        "Error invoking remote method 'fs:readDir ': Error: ENOENT",
        'Error invoking remote method "fs:readDir": Error: ENOENT',
        "Error invoking remote method 'fs:readDir':Error: ENOENT",
        "Error: Error invoking remote method 'fs:readDir': Error: ENOENT",
        "private-message\nError invoking remote method 'fs:readDir': Error: ENOENT",
        'Error: ENOENT: private-message',
        'ENOENT', '', undefined, null, 42, {},
        { toString() { throw new Error('Must not serialize private objects'); } },
    ]) {
        assert.deepEqual(classifyRendererErrorMessage(message, OPTIONS), {});
    }
});

test('error names and codes are inferred only from the immediate allowed prefixes', () => {
    for (const details of [
        'PrivateError: ENOENT: private-message',
        'private-message TypeError: ENOENT: token=secret',
        'private-message\nENOENT: token=secret',
        'ENOENT_PRIVATE: token=secret',
        'ENOENT-private: token=secret',
    ]) {
        assert.deepEqual(classifyRendererErrorMessage(
            `Error invoking remote method 'config:get': ${details}`, OPTIONS,
        ), { ipc_channel: 'config:get' });
    }
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'config:get': Error: private-message ENOENT: token=secret", OPTIONS,
    ), { ipc_channel: 'config:get', name: 'Error' });
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'config:get': Error: ENOENT: private-message",
    ), { ipc_channel: 'config:get' });
});

test('message classification is bounded and never retains the original text', () => {
    const privateText = 'Secret Book token=secret '.repeat(10000);
    assert.deepEqual(classifyRendererErrorMessage(
        `Error invoking remote method 'fs:readDir': Error: ENOENT: ${privateText}`, OPTIONS,
    ), { ipc_channel: 'fs:readDir', name: 'Error', code: 'ENOENT' });
    assert.deepEqual(classifyRendererErrorMessage(
        `${' '.repeat(1024)}Error invoking remote method 'fs:readDir': Error: ENOENT`, OPTIONS,
    ), {});
    assert.deepEqual(classifyRendererErrorMessage(
        `Error invoking remote method 'fs:readDir': ${privateText}TypeError: ENOENT`, OPTIONS,
    ), { ipc_channel: 'fs:readDir' });
});

test('uncaught browser notifications retain only exact allowed classifications', () => {
    const options = { ...OPTIONS, errorKind: 'uncaught-error' };
    for (const message of [
        'ResizeObserver loop completed with undelivered notifications.',
        'ResizeObserver loop limit exceeded',
    ]) {
        assert.deepEqual(classifyRendererErrorMessage(message, options), { browser_error: 'resize-observer-loop' });
    }
    assert.deepEqual(classifyRendererErrorMessage('Script error.', options), { browser_error: 'script-error' });
    for (const message of [
        'private-message ResizeObserver loop completed with undelivered notifications.',
        'ResizeObserver loop limit exceeded: Secret Book token=secret',
        'ResizeObserver loop limit exceeded ',
        'Script error. Secret Book token=secret',
        'script error.',
    ]) {
        assert.deepEqual(classifyRendererErrorMessage(message, options), {});
    }
});

test('browser notification text is not inferred for other error kinds', () => {
    for (const errorKind of [undefined, 'unhandled-rejection', 'private-kind']) {
        for (const message of [
            'ResizeObserver loop completed with undelivered notifications.',
            'ResizeObserver loop limit exceeded',
            'Script error.',
            'Uncaught TypeError: Secret Book token=secret',
        ]) {
            assert.deepEqual(classifyRendererErrorMessage(message, { ...OPTIONS, errorKind }), {});
        }
    }
});

test('uncaught message prefixes recover only an immediate allowed error name', () => {
    const options = { ...OPTIONS, errorKind: 'uncaught-error' };
    assert.deepEqual(classifyRendererErrorMessage('Uncaught TypeError: Secret Book token=secret', options), { name: 'TypeError' });
    assert.deepEqual(classifyRendererErrorMessage('Uncaught RangeError:', options), { name: 'RangeError' });
    for (const message of [
        'Uncaught PrivateError: Secret Book token=secret',
        'private-message Uncaught TypeError: Secret Book token=secret',
        'Uncaught TypeError-private: Secret Book token=secret',
        'Uncaught TypeError:Secret Book token=secret',
        'Uncaught Secret Book: TypeError: token=secret',
    ]) {
        assert.deepEqual(classifyRendererErrorMessage(message, options), {});
    }
    assert.deepEqual(classifyRendererErrorMessage('Uncaught TypeError: private-message', { errorKind: 'uncaught-error' }), {});
    assert.deepEqual(classifyRendererErrorMessage(
        "Error invoking remote method 'config:get': Error: ENOENT: Secret Book token=secret", options,
    ), { ipc_channel: 'config:get', name: 'Error', code: 'ENOENT' });
});

test('diagnostic value checks reject unknown values without string coercion', () => {
    for (const type of ['undefined', 'null', 'string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'function']) {
        assert.equal(isTelemetryRejectionTypeAllowed(type), true);
    }
    for (const value of [undefined, null, 1, {}, [], 'Secret Book', 'Error', 'Object']) {
        assert.equal(isTelemetryRejectionTypeAllowed(value), false);
        assert.equal(isTelemetryIpcChannelAllowed(value), false);
    }
    for (const value of ['fs:private-file', 'fs:readDir/private-file', 'FS:readDir', 'fs:readDir ', 'telemetry:error']) {
        assert.equal(isTelemetryIpcChannelAllowed(value), false);
    }
});

for (const filename of ['preload.js', 'preload.cjs', 'viewerPreload.cjs']) {
    test(`${filename} invokes only statically allowed diagnostic channels`, () => {
        const source = readFileSync(new URL(filename, import.meta.url), 'utf8')
            .replace("import { contextBridge, ipcRenderer } from 'electron';", "const { contextBridge, ipcRenderer } = require('electron');");
        const channels = new Set();
        let api;
        const ipcRenderer = {
            invoke(channel) { channels.add(channel); return Promise.resolve(); },
            send() {},
            on() {},
            removeListener() {},
        };
        vm.runInNewContext(source, {
            require: name => {
                assert.equal(name, 'electron');
                return { ipcRenderer, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } };
            },
        });
        for (const method of Object.values(api)) method();
        assert.ok(channels.size > 0);
        for (const channel of channels) {
            assert.equal(isTelemetryIpcChannelAllowed(channel), true, `${filename}: ${channel}`);
        }
    });
}
