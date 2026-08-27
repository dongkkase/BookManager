import { app } from 'electron';
import path from 'node:path';
import { installConsolePipeGuard } from './utils/consolePipeGuard.js';
import { installRuntimeLogging } from './utils/runtimeLog.js';

installRuntimeLogging({
    appTarget: app,
    enabled: app.isPackaged,
    executableDir: path.dirname(process.execPath),
});
installConsolePipeGuard();

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

    mainModule = await import('./main.js');
    for (const request of pendingLaunchRequests.splice(0)) {
        dispatchLaunchRequest(request);
    }
}
