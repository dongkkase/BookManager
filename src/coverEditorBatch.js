import { COMIC_EXTENSIONS, AUDIO_EXTENSIONS, extensionFromFile } from './metadata/metadataTypes.js';

export function supportsCoverEditor(file) {
    if (!file || file.isDirectory || file.is_folder) return false;
    const extension = extensionFromFile({ ...file, path: file.full_path || file.path });
    return COMIC_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension) || ['.epub', '.pdf', '.txt'].includes(extension);
}

function filePath(file) {
    return String(file?.full_path || file?.path || '');
}

function pathKey(value) {
    const normalized = String(value || '').replace(/\\/g, '/').normalize('NFC');
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

export function resolveCoverEditorTargets(contextFile, selectedFiles = []) {
    if (!supportsCoverEditor(contextFile) || !filePath(contextFile)) return [];
    const selected = Array.isArray(selectedFiles) ? selectedFiles : [];
    const contextKey = pathKey(filePath(contextFile));
    const candidates = selected.some(file => pathKey(filePath(file)) === contextKey) ? selected : [contextFile];
    const seen = new Set();
    return candidates.filter(file => {
        const key = pathKey(filePath(file));
        if (!key || !supportsCoverEditor(file) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function runCoverEditorBatch(requests, apply, { onProgress, shouldCancel } = {}) {
    const seen = new Set();
    const pending = requests.filter(request => {
        const key = pathKey(request.filePath);
        if (!key) throw new Error('A cover edit requires a file path.');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const results = [];
    for (const request of pending) {
        const sourcePath = request.filePath;
        if (shouldCancel?.()) {
            results.push({ sourcePath, filePath: sourcePath, success: false, cancelled: true });
            continue;
        }
        let result;
        try {
            const saved = await apply(request);
            result = { ...saved, sourcePath, filePath: saved?.filePath || sourcePath, success: saved?.success === true };
            if (!result.success && !result.error) result.error = 'Could not save the cover.';
        } catch (error) {
            result = { sourcePath, filePath: sourcePath, success: false, error: error?.message || String(error), code: error?.code || '' };
        }
        results.push(result);
        try {
            await onProgress?.({ completed: results.length, total: pending.length, filePath: sourcePath, result });
        } catch (error) {
            result.progressWarning = error?.message || String(error);
        }
    }
    return {
        batch: true,
        results,
        successCount: results.filter(result => result.success).length,
        failureCount: results.filter(result => !result.success && !result.cancelled).length,
        cancelledCount: results.filter(result => result.cancelled).length,
    };
}
