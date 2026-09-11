import fs from 'node:fs';
import path from 'node:path';

function sameEntry(before, after) {
    return ['dev', 'ino', 'mode', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]);
}

export function createPermanentDeleteDialogOptions(entries, t) {
    return {
        type: 'warning',
        title: t('fs_delete_permanent_title'),
        message: t('fs_delete_permanent_message', [entries.length]),
        detail: `${t('fs_delete_permanent_detail')}\n\n${entries.map(entry => `${entry.path}\n${entry.error}`).join('\n\n')}`,
        buttons: [t('btn_cancel'), t('fs_delete_permanent_button')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    };
}

export async function deleteFileEntries(filePaths, {
    trashItem,
    confirmPermanentDelete = async () => false,
    syncDeletedPaths = async () => {},
    t,
    fsApi = fs.promises,
}) {
    const deleted = [];
    const fileInfoDeletes = [];
    const errors = [];
    const failedTrash = [];
    const cancelledPaths = [];
    const seen = new Set();
    const recordDeleted = entry => {
        deleted.push(entry.path);
        fileInfoDeletes.push({ path: entry.path, recursive: entry.stat.isDirectory() });
    };
    const recordError = (filePath, error) => errors.push(t('fs_delete_failed', [path.basename(String(filePath)), error.message || String(error)]));

    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
        let entry;
        try {
            if (typeof filePath !== 'string' || filePath.includes('\0') || !path.isAbsolute(filePath)) {
                throw new Error(t('fs_delete_invalid_path'));
            }
            const normalizedPath = path.normalize(filePath);
            const rootPath = path.parse(normalizedPath).root;
            if (normalizedPath === rootPath) throw new Error(t('fs_delete_root_blocked'));
            const targetPath = normalizedPath.endsWith(path.sep) ? normalizedPath.slice(0, -1) : normalizedPath;
            if (seen.has(targetPath)) continue;
            seen.add(targetPath);
            const stat = await fsApi.lstat(targetPath);
            entry = { path: filePath, targetPath, stat };
            await trashItem(targetPath);
            recordDeleted(entry);
        } catch (error) {
            if (!entry && error.code === 'ENOENT') continue;
            if (entry) failedTrash.push({ ...entry, error: error.message || String(error) });
            else recordError(filePath, error);
        }
    }

    if (failedTrash.length > 0) {
        let confirmed = false;
        let confirmationFailed = false;
        try {
            confirmed = await confirmPermanentDelete(failedTrash.map(entry => ({ path: entry.path, error: entry.error }))) === true;
        } catch (error) {
            confirmationFailed = true;
            for (const entry of failedTrash) recordError(entry.path, error);
        }
        if (!confirmed && !confirmationFailed) cancelledPaths.push(...failedTrash.map(entry => entry.path));
        if (confirmed) {
            for (const entry of failedTrash) {
                try {
                    const current = await fsApi.lstat(entry.targetPath);
                    if (!sameEntry(entry.stat, current)) throw new Error(t('fs_delete_source_changed'));
                    if (current.isDirectory()) {
                        const parent = await fsApi.stat(path.dirname(entry.targetPath));
                        if (current.dev !== parent.dev) throw new Error(t('fs_delete_root_blocked'));
                    }
                    await fsApi.rm(entry.targetPath, { recursive: current.isDirectory(), force: false });
                    recordDeleted(entry);
                } catch (error) {
                    recordError(entry.path, error);
                }
            }
        }
    }

    if (fileInfoDeletes.length > 0) {
        try {
            await syncDeletedPaths(fileInfoDeletes);
        } catch (error) {
            errors.push(error.message || String(error));
        }
    }
    return { success: errors.length === 0 && cancelledPaths.length === 0, deleted, errors, cancelled: cancelledPaths.length > 0, cancelledPaths };
}
