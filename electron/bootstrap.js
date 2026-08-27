import { app } from 'electron';
import { installConsolePipeGuard } from './utils/consolePipeGuard.js';

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
