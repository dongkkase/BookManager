import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(electronDirectory, 'main.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(electronDirectory, 'bootstrap.js'), 'utf8');

test('bootstrap relays launch requests before loading the heavy main module', () => {
    const openFileListenerIndex = bootstrapSource.indexOf("app.on('open-file'");
    const singleInstanceLockIndex = bootstrapSource.indexOf('app.requestSingleInstanceLock()');
    const secondInstanceListenerIndex = bootstrapSource.indexOf("app.on('second-instance'");
    const mainImportIndex = bootstrapSource.indexOf("await import('./main.js')");

    assert.notEqual(openFileListenerIndex, -1);
    assert.notEqual(singleInstanceLockIndex, -1);
    assert.notEqual(secondInstanceListenerIndex, -1);
    assert.notEqual(mainImportIndex, -1);
    assert.equal(openFileListenerIndex < singleInstanceLockIndex, true);
    assert.equal(singleInstanceLockIndex < secondInstanceListenerIndex, true);
    assert.equal(secondInstanceListenerIndex < mainImportIndex, true);
    assert.match(bootstrapSource, /if \(!gotTheLock\) \{\s*app\.quit\(\);\s*\} else \{/);
    assert.match(bootstrapSource, /pendingLaunchRequests\.splice\(0\)/);
    assert.doesNotMatch(mainSource, /requestSingleInstanceLock/);
});

test('Windows launch arguments and second-instance files enter the pending queue', () => {
    assert.match(
        mainSource,
        /process\.platform === 'win32'[\s\S]*enqueueOpenFiles\(launchFilePathsFromArguments\(process\.argv\)\)/,
    );
    assert.match(
        bootstrapSource,
        /app\.on\('second-instance',[\s\S]*dispatchLaunchRequest\(\{[\s\S]*type: 'second-instance'/,
    );
    assert.match(mainSource, /export function handleBootstrapOpenFile\(filePath\)[\s\S]*enqueueOpenFiles\(launchFilePathsFromArguments\(\[filePath\]\)\)/);
    assert.match(mainSource, /export function handleBootstrapSecondInstance\(commandLine, workingDirectory\)[\s\S]*launchFilePathsFromArguments\(commandLine, workingDirectory\)/);
});

test('queued files open as soon as the viewer infrastructure is ready', () => {
    assert.match(mainSource, /if \(isDrainingOpenFiles \|\| !viewerController \|\| !configManager\) return/);
    assert.doesNotMatch(mainSource, /isDrainingOpenFiles \|\| !mainWindowReady/);
    assert.match(mainSource, /createMainWindow\(config\);\s*void drainPendingOpenFiles\(\)/);
    assert.match(mainSource, /showMainWindowInactiveForInitialFile[\s\S]*mainWindow\.showInactive\(\)/);
    assert.match(mainSource, /process\.env\.PORTABLE_EXECUTABLE_FILE/);
    assert.match(mainSource, /resolveMacApplicationPath\(app\.getPath\('exe'\)\)/);
});

test('file association manager receives the macOS system version', () => {
    assert.match(
        mainSource,
        /createFileAssociationManager\(\{[\s\S]*systemVersion: process\.getSystemVersion\?\.\(\) \|\| ''/,
    );
    assert.doesNotMatch(mainSource, /app\.getSystemVersion/);
});
