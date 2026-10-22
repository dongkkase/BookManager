export function registerAppDataIpc({ ipcMain, shell, getAppDataDir }) {
    ipcMain.handle('appData:getPath', () => getAppDataDir());
    ipcMain.handle('appData:openFolder', async () => {
        try {
            const message = await shell.openPath(getAppDataDir());
            return message ? { success: false, message } : { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });
}
