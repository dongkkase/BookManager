export function setupFileAssociationIPC(options = {}) {
    const {
        ipcMain,
        manager,
        getMainWindow = () => null,
    } = options;
    if (!ipcMain || !manager) throw new TypeError('IPC and file association manager are required.');

    const assertMainWindowSender = event => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed?.() || mainWindow.webContents !== event?.sender) {
            throw new Error('File associations can only be managed from the main window.');
        }
    };

    const handlers = {
        'fileAssociations:getStatus': async event => {
            assertMainWindowSender(event);
            return manager.getStatus();
        },
        'fileAssociations:apply': async (event, extensions) => {
            assertMainWindowSender(event);
            return manager.apply(extensions);
        },
        'fileAssociations:openSettings': async event => {
            assertMainWindowSender(event);
            return manager.openSettings();
        },
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, handler);
    }

    return {
        dispose: () => {
            for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
        },
    };
}
