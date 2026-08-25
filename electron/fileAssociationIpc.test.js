import assert from 'node:assert/strict';
import test from 'node:test';

import { setupFileAssociationIPC } from './fileAssociationIpc.js';

test('file association IPC accepts only the main window sender', async () => {
    const handlers = new Map();
    const removed = [];
    const ipcMain = {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: channel => removed.push(channel),
    };
    const sender = {};
    const manager = {
        getStatus: async () => ({ supported: true }),
        apply: async extensions => ({ success: true, extensions }),
        openSettings: async () => ({ success: true }),
    };
    const controller = setupFileAssociationIPC({
        ipcMain,
        manager,
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
    });

    assert.deepEqual(
        await handlers.get('fileAssociations:getStatus')({ sender }),
        { supported: true },
    );
    await assert.rejects(
        handlers.get('fileAssociations:getStatus')({ sender: {} }),
        /main window/,
    );
    assert.deepEqual(
        await handlers.get('fileAssociations:apply')({ sender }, ['.cbz']),
        { success: true, extensions: ['.cbz'] },
    );

    controller.dispose();
    assert.deepEqual(removed.sort(), [
        'fileAssociations:apply',
        'fileAssociations:getStatus',
        'fileAssociations:openSettings',
    ]);
});
