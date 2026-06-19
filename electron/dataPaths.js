import path from 'path';

export function resolveAppDataDir(executableDir = process.cwd()) {
    return path.join(executableDir || process.cwd(), 'data');
}

export function resolveLibraryDbPath(executableDir = process.cwd()) {
    return path.join(resolveAppDataDir(executableDir), 'library.db');
}

export function resolveApiCacheDbPath(executableDir = process.cwd()) {
    return path.join(resolveAppDataDir(executableDir), '.api_cache.db');
}

export function resolveConfigPath(executableDir = process.cwd()) {
    return path.join(resolveAppDataDir(executableDir), 'config.json');
}

export function resolveRenameHistoryPath(executableDir = process.cwd()) {
    return path.join(resolveAppDataDir(executableDir), 'rename_history.json');
}

export function resolveThumbnailDir(executableDir = process.cwd()) {
    return path.join(resolveAppDataDir(executableDir), 'thumbnails');
}
