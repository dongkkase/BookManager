import path from 'node:path';
import { SCAN_TARGET_EXTENSIONS } from './scanTargets.js';
import { checkDuplicateFiles } from './tasks/folderScanTask.js';

const targetExtensions = new Set(SCAN_TARGET_EXTENSIONS);

function normalizeFiles(files) {
    const seen = new Set();
    return (Array.isArray(files) ? files : []).flatMap(file => {
        const filePath = file?.full_path || file?.path;
        if (file?.isDirectory || file?.exists === false || typeof filePath !== 'string'
            || !path.isAbsolute(filePath) || !targetExtensions.has(path.extname(filePath).toLowerCase())) return [];
        const fullPath = path.normalize(filePath);
        if (seen.has(fullPath)) return [];
        seen.add(fullPath);
        return [{ path: fullPath, full_path: fullPath, name: path.basename(fullPath) }];
    });
}

export function registerFolderDuplicateCheckIpc({ ipcMain, cancellationRegistry, getConfig }) {
    ipcMain.handle('folder:checkDuplicates', async (event, files = [], options = {}) => {
        const taskId = 'folder:checkDuplicates';
        cancellationRegistry.cancel(event.sender.id, taskId);
        const controller = cancellationRegistry.start(event.sender.id, taskId);
        try {
            const config = getConfig() || {};
            const folders = Array.isArray(options?.dupFolders) ? options.dupFolders : config.dup_check_folders;
            const dupFolders = [...new Set((Array.isArray(folders) ? folders : [])
                .filter(folder => typeof folder === 'string' && path.isAbsolute(folder))
                .map(folder => path.normalize(folder)))];
            const result = await checkDuplicateFiles(normalizeFiles(files), {
                dupFolders,
                lang: config.language || config.lang || 'ko',
                shouldCancel: () => controller.shouldCancel(),
            });
            return controller.shouldCancel()
                ? { files: [], cancelled: true }
                : { files: result, cancelled: false };
        } catch (error) {
            if (error?.code === 'TASK_CANCELLED') return { files: [], cancelled: true };
            throw error;
        } finally {
            cancellationRegistry.finish(event.sender.id, taskId, controller);
        }
    });
}
