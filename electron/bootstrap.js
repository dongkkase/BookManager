import { app, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installConsolePipeGuard } from './utils/consolePipeGuard.js';
import { installRuntimeLogging } from './utils/runtimeLog.js';
import { configureHardwareAcceleration } from './hardwareAcceleration.js';
import { migrateLegacyAppDataDir, resolveAppDataDir } from './dataPaths.js';
import { assertAppDataDirWritable } from './macDataMigration.js';

let mainModule = null;
const pendingLaunchRequests = [];

function dispatchLaunchRequest(request) {
    if (!mainModule) {
        pendingLaunchRequests.push(request);
        return;
    }
    if (request.type === 'open-file') {
        mainModule.handleBootstrapOpenFile(request.filePath);
        return;
    }
    mainModule.handleBootstrapSecondInstance(request.commandLine, request.workingDirectory);
}

if (process.platform === 'darwin') {
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        dispatchLaunchRequest({ type: 'open-file', filePath });
    });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, commandLine, workingDirectory) => {
        dispatchLaunchRequest({
            type: 'second-instance',
            commandLine,
            workingDirectory,
        });
    });

    const executableDir = app.isPackaged
        ? path.dirname(process.execPath)
        : fileURLToPath(new URL('..', import.meta.url));
    try {
        // Migrate before logging or settings create the destination directory.
        const appDataDir = migrateLegacyAppDataDir(executableDir);
        if (process.platform === 'darwin') assertAppDataDirWritable(appDataDir);
    } catch (error) {
        dialog.showErrorBox('BookManager', [
            '앱 데이터를 이전하거나 저장 폴더에 접근할 수 없습니다. 기존 데이터는 보존됩니다.',
            'Cannot migrate or access app data. Existing data has been preserved.',
            resolveAppDataDir(executableDir),
            error?.message || String(error),
        ].join('\n\n'));
        app.exit(1);
    }

    // Apply the migrated preference synchronously before Electron is ready.
    configureHardwareAcceleration(app, executableDir);
    installRuntimeLogging({
        appTarget: app,
        enabled: app.isPackaged,
        executableDir,
    });
    installConsolePipeGuard();

    mainModule = await import('./main.js');
    for (const request of pendingLaunchRequests.splice(0)) {
        dispatchLaunchRequest(request);
    }
}
