import path from 'node:path';
import { LibraryDB } from '../database/library_db.js';
import { ReadiveService } from './service.js';
import { sharingText } from '../servers/shared/sharingCommon.js';

let registeredService = null;

export async function getReadiveReadingState(filePath) {
    return registeredService ? registeredService.readingState(filePath) : null;
}

export function registerReadiveIpc({ ipcMain, configManager, getLibraryDbPath, getMainWindow, onReadingChanged }) {
    let libraryDb;
    let libraryDbPath;
    const service = new ReadiveService({
        directory: path.join(configManager.userDataPath, 'readive-link'),
        getRegisteredLibraries: () => configManager.getConfig()?.library_entries || configManager.getConfig()?.libraries || [],
        getLibraryDb: async () => {
            const currentPath = getLibraryDbPath();
            if (!currentPath) return null;
            if (currentPath !== libraryDbPath) {
                await libraryDb?.close();
                libraryDb = new LibraryDB({ dbPath: currentPath });
                libraryDbPath = currentPath;
            }
            return libraryDb;
        },
        onReadingChanged: onReadingChanged || (() => {
            const window = getMainWindow?.();
            if (window && !window.isDestroyed()) window.webContents.send('reading:changed', { source: 'readive' });
        }),
        onLog: ({ type, key, values }) => {
            const window = getMainWindow?.();
            if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
            window.webContents.send('server:log', {
                type,
                protocol: 'Readive',
                message: sharingText(configManager.getConfig() || {}, key, key, values),
            });
        },
    });
    registeredService = service;
    const methods = ['status', 'start', 'stop', 'pairing', 'revoke', 'scan', 'enqueue', 'cancel', 'setLibraries'];
    const loggedActions = { start: 'readive.start', stop: 'readive.stop', pairing: 'readive.pair', revoke: 'readive.revoke' };
    for (const method of methods) {
        ipcMain.handle(`readive:${method}`, async (event, args = {}) => {
            const mainWindow = getMainWindow?.();
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) throw new Error('readive_untrusted_sender');
            if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) throw new Error('readive_untrusted_frame');
            try {
                return await service[method](args);
            } catch (error) {
                const actionKey = loggedActions[method];
                if (actionKey) service.logError('readive.log_action_failed', error, {
                    action: sharingText(configManager.getConfig() || {}, actionKey, actionKey),
                });
                throw error;
            }
        });
    }
    service.dispose = async () => {
        for (const method of methods) ipcMain.removeHandler(`readive:${method}`);
        await service.stop();
        await libraryDb?.close();
        if (registeredService === service) registeredService = null;
    };
    return service;
}
