import path from 'node:path';
import fs from 'node:fs/promises';
import { observeOperation } from '../observabilityOperations.js';

export function registerEpubOptimizerIpc({ ipcMain, BrowserWindow, createService, observe = observeOperation }) {
    let servicePromise;
    const owners = new Set();
    const inspections = new Map();
    const writes = new Set();
    const service = () => servicePromise ||= createService ? Promise.resolve(createService()) : import('./service.js').then(({ EpubOptimizerService }) => new EpubOptimizerService({
        createProcessor: async () => {
            const { createImageProcessor } = await import('./imageProcessor.js');
            return createImageProcessor({ BrowserWindow });
        },
    }));
    ipcMain.handle('tools:epubOptimizer', async (event, request = {}) => {
        let writeKey;
        try {
            if (!request || typeof request !== 'object' || !['inspect', 'optimize', 'cancel'].includes(request.action)
                || typeof request.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.operationId)) {
                return { error: 'OPTIMIZER_INVALID_REQUEST', code: 'OPTIMIZER_INVALID_REQUEST' };
            }
            const owner = event.sender.id;
            const optimizer = await service();
            if (event.sender.isDestroyed()) return { error: 'TASK_CANCELLED', code: 'TASK_CANCELLED' };
            if (!owners.has(owner)) {
                owners.add(owner);
                const release = () => {
                    inspections.delete(owner);
                    void optimizer.dispose(owner);
                };
                event.sender.once('destroyed', () => { owners.delete(owner); release(); });
                event.sender.on('did-navigate', release);
            }
            if (request.action === 'cancel') return optimizer.cancel(owner, request.operationId);
            if (typeof request.filePath !== 'string' || !path.isAbsolute(request.filePath) || request.filePath.includes('\0')
                || path.extname(request.filePath).toLowerCase() !== '.epub') return { error: 'EPUB_FILE_REQUIRED', code: 'EPUB_FILE_REQUIRED' };
            const ownerInspections = inspections.get(owner) || new Map();
            inspections.set(owner, ownerInspections);
            if (request.action === 'optimize' && (!ownerInspections.has(request.filePath)
                || JSON.stringify(ownerInspections.get(request.filePath)) !== JSON.stringify(request.expectedFingerprint))) {
                return { error: 'EPUB_REINSPECT_REQUIRED', code: 'EPUB_REINSPECT_REQUIRED' };
            }
            if (request.action === 'optimize' && request.overwrite === true) {
                const realPath = await fs.realpath(request.filePath);
                const key = process.platform === 'win32' ? realPath.toLowerCase() : realPath;
                if (writes.has(key)) return { error: 'OPTIMIZER_BUSY', code: 'OPTIMIZER_BUSY' };
                writes.add(key);
                writeKey = key;
                if (event.sender.isDestroyed()) return { error: 'TASK_CANCELLED', code: 'TASK_CANCELLED' };
            }
            const run = () => optimizer.run(owner, {
                action: request.action,
                filePath: request.filePath,
                operationId: request.operationId,
                ...(request.action === 'optimize' ? { settings: request.settings, expectedFingerprint: request.expectedFingerprint,
                    backup: request.backup === true, overwrite: request.overwrite === true } : {}),
            }, progress => {
                if (!event.sender.isDestroyed()) event.sender.send('tools:epubOptimizer:progress', {
                    operationId: request.operationId,
                    ...progress,
                    currentItem: progress.name || request.filePath,
                });
            });
            const result = request.action === 'optimize'
                ? await observe('epub-optimize', run, { format: 'epub' })
                : await run();
            if (request.action === 'inspect' && !event.sender.isDestroyed() && inspections.get(owner) === ownerInspections) {
                ownerInspections.set(request.filePath, result.fingerprint);
                if (ownerInspections.size > 10000) ownerInspections.delete(ownerInspections.keys().next().value);
            }
            return result;
        } catch (error) {
            return { error: error.message || 'OPTIMIZER_FAILED', code: error.code || 'OPTIMIZER_FAILED',
                ...(error.backupPath ? { backupPath: error.backupPath } : {}) };
        } finally {
            if (writeKey) writes.delete(writeKey);
        }
    });
    return {
        async dispose() {
            inspections.clear();
            owners.clear();
            if (servicePromise) await (await servicePromise).dispose();
            writes.clear();
        },
    };
}
