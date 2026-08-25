import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(electronDirectory, 'main.js'), 'utf8');

test('macOS open-file listener is installed before the single-instance lock', () => {
    const openFileListenerIndex = mainSource.indexOf("app.on('open-file'");
    const singleInstanceLockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');

    assert.notEqual(openFileListenerIndex, -1);
    assert.notEqual(singleInstanceLockIndex, -1);
    assert.equal(openFileListenerIndex < singleInstanceLockIndex, true);
    assert.match(mainSource, /enqueueOpenFiles\(launchFilePathsFromArguments\(\[filePath\]\)\)/);
});

test('Windows launch arguments and second-instance files enter the pending queue', () => {
    assert.match(
        mainSource,
        /process\.platform === 'win32'[\s\S]*enqueueOpenFiles\(launchFilePathsFromArguments\(process\.argv\)\)/,
    );
    assert.match(
        mainSource,
        /app\.on\('second-instance',[\s\S]*launchFilePathsFromArguments\(commandLine, workingDirectory\)/,
    );
});

test('queued files wait for the main window and cannot recursively launch BookManager', () => {
    assert.match(mainSource, /!mainWindowReady \|\| !viewerController \|\| !configManager/);
    assert.match(mainSource, /mainWindowReady = true;[\s\S]*drainPendingOpenFiles\(\)/);
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
