import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('macOS bootstrap paints the splash before main imports and keeps launch requests', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || process.platform !== 'darwin') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 on macOS for the isolated bootstrap smoke test.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-bootstrap-test-'));
    const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
    try {
        await Promise.all([
            fs.mkdir(path.join(directory, 'electron', 'utils'), { recursive: true }),
            fs.mkdir(path.join(directory, 'electron', 'portable'), { recursive: true }),
            fs.mkdir(path.join(directory, 'src'), { recursive: true }),
            fs.mkdir(path.join(directory, 'profile'), { recursive: true }),
            fs.mkdir(path.join(directory, 'session'), { recursive: true }),
            fs.mkdir(path.join(directory, 'app-data'), { recursive: true }),
        ]);
        const realModules = [
            'bootstrap.js',
            'startupPresentation.js',
            'startupSplash.js',
            'startupSignal.js',
            'utils/consolePipeGuard.js',
            'portable/splash.png',
        ];
        await Promise.all(realModules.map(file => fs.copyFile(
            path.join(sourceDirectory, file), path.join(directory, 'electron', file),
        )));
        await Promise.all([
            fs.cp(path.join(sourceDirectory, 'startupSplash'), path.join(directory, 'electron', 'startupSplash'), { recursive: true }),
            fs.copyFile(path.join(sourceDirectory, '..', 'src', 'motionPolicy.js'), path.join(directory, 'src', 'motionPolicy.js')),
            fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', main: 'entry.js' })),
            fs.writeFile(path.join(directory, 'app-data', 'config.json'), JSON.stringify({ motion_preference: 'full' })),
            fs.writeFile(path.join(directory, 'electron', 'dataPaths.js'), `
import path from 'node:path';
export function migrateLegacyAppDataDir() {
    globalThis.bootstrapFixture.beforeReady('migration');
    return globalThis.bootstrapFixture.dataDirectory;
}
export function resolveAppDataDir() { return globalThis.bootstrapFixture.dataDirectory; }
export function resolveConfigPath() { return path.join(globalThis.bootstrapFixture.dataDirectory, 'config.json'); }
`),
            fs.writeFile(path.join(directory, 'electron', 'hardwareAcceleration.js'), `
export function configureHardwareAcceleration(app) {
    globalThis.bootstrapFixture.beforeReady('hardware');
    app.disableHardwareAcceleration();
}
`),
            fs.writeFile(path.join(directory, 'electron', 'macDataMigration.js'), `
export function assertAppDataDirWritable(directory) {
    globalThis.bootstrapFixture.beforeReady('writable');
    globalThis.bootstrapFixture.assert.equal(directory, globalThis.bootstrapFixture.dataDirectory);
}
`),
            fs.writeFile(path.join(directory, 'electron', 'utils', 'runtimeLog.js'), `
export function installRuntimeLogging() { globalThis.bootstrapFixture.beforeReady('logging'); }
`),
            fs.writeFile(path.join(directory, 'entry.js'), `
import assert from 'node:assert/strict';
import { app, dialog, protocol } from 'electron';
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.setPath('sessionData', ${JSON.stringify(path.join(directory, 'session'))});
const steps = [];
const fixture = globalThis.bootstrapFixture = {
    assert, steps, requests: [],
    dataDirectory: ${JSON.stringify(path.join(directory, 'app-data'))},
    beforeReady(name) {
        assert.equal(app.isReady(), false, name + ' must run before ready');
        steps.push(name);
    },
    fail(error) {
        process.stderr.write(String(error.stack || error) + '\\n');
        app.exit(1);
    },
};
process.on('uncaughtException', fixture.fail);
process.on('unhandledRejection', fixture.fail);
dialog.showErrorBox = (title, content) => fixture.fail(new Error(title + ': ' + content));
const registerSchemes = protocol.registerSchemesAsPrivileged.bind(protocol);
protocol.registerSchemesAsPrivileged = schemes => {
    fixture.beforeReady('schemes');
    assert.deepEqual(schemes.map(value => value.scheme), [
        'bookmanager-thumbnail', 'bookmanager-document', 'bookmanager-comic',
    ]);
    assert.ok(schemes.every(value => value.privileges.standard && value.privileges.secure));
    registerSchemes(schemes);
};
await import('./electron/bootstrap.js');
assert.equal(app.isReady(), false, 'Entry module must finish without awaiting app.whenReady()');
let prevented = false;
app.emit('open-file', { preventDefault() { prevented = true; } }, '/fixture/queued.epub');
assert.equal(prevented, true);
app.emit('second-instance', {}, ['BookManager', '/fixture/second.pdf'], '/fixture');
`),
            fs.writeFile(path.join(directory, 'electron', 'main.js'), `
import { app, BrowserWindow, systemPreferences } from 'electron';
import { startupPresentation } from './startupPresentation.js';
const fixture = globalThis.bootstrapFixture;
const { assert, steps } = fixture;
assert.equal(app.isReady(), true, 'Main imports after Electron is ready');
assert.equal(app.getName(), 'BookManager');
assert.deepEqual(steps, ['schemes', 'migration', 'writable', 'hardware', 'logging']);
const splashWindows = BrowserWindow.getAllWindows();
assert.equal(splashWindows.length, 1);
assert.equal(splashWindows[0].isVisible(), true, 'Splash must be visible before heavy main imports');
steps.push('main-import');
export function handleBootstrapOpenFile(filePath) {
    fixture.requests.push({ type: 'open-file', filePath });
}
export function handleBootstrapSecondInstance(commandLine, workingDirectory) {
    fixture.requests.push({ type: 'second-instance', commandLine, workingDirectory });
}
startupPresentation.update('loading');
const mainWindow = new BrowserWindow({ show: false, width: 360, height: 240 });
mainWindow.once('ready-to-show', async () => {
    try {
        await startupPresentation.complete({
            mainWindow,
            showMainWindow: () => mainWindow.showInactive(),
            motionPreference: 'full',
            systemPreferences,
        });
        assert.equal(mainWindow.isVisible(), true);
        assert.equal(mainWindow.getOpacity(), 1);
        assert.equal(splashWindows[0].isDestroyed(), true);
        assert.deepEqual(BrowserWindow.getAllWindows(), [mainWindow]);
        assert.deepEqual(fixture.requests, [
            { type: 'open-file', filePath: '/fixture/queued.epub' },
            { type: 'second-instance', commandLine: ['BookManager', '/fixture/second.pdf'], workingDirectory: '/fixture' },
        ]);
        steps.push('main-visible');
        process.stdout.write('STARTUP_BOOTSTRAP_RESULT=' + JSON.stringify({ steps, requests: fixture.requests.length, windows: BrowserWindow.getAllWindows().length }) + '\\n');
        app.exit(0);
    } catch (error) {
        fixture.fail(error);
    }
});
void mainWindow.loadURL('data:text/html,<html><body>Bootstrap smoke test</body></html>').catch(fixture.fail);
`),
        ]);
        const electronPath = (await import('electron')).default;
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(electronPath, [directory], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error('Bootstrap smoke test timed out: ' + output));
            }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/STARTUP_BOOTSTRAP_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const observed = JSON.parse(payload);
        assert.deepEqual(observed.steps, ['schemes', 'migration', 'writable', 'hardware', 'logging', 'main-import', 'main-visible']);
        assert.equal(observed.requests, 2);
        assert.equal(observed.windows, 1);
        t.diagnostic(payload);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
