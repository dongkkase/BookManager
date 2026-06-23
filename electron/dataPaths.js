import path from 'path';

export function resolvePortableBaseDir(executableDir = process.cwd(), platform = process.platform) {
    const baseDir = executableDir || process.cwd();
    if (platform !== 'darwin') return baseDir;

    const normalized = path.normalize(baseDir);
    const macOsDir = path.join('Contents', 'MacOS');
    if (!normalized.endsWith(`${path.sep}${macOsDir}`)) return baseDir;

    const appBundleDir = path.dirname(path.dirname(normalized));
    if (path.extname(appBundleDir).toLowerCase() !== '.app') return baseDir;
    return path.dirname(appBundleDir);
}

export function resolveAppDataDir(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolvePortableBaseDir(executableDir, platform), 'data');
}

export function resolveLibraryDbPath(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolveAppDataDir(executableDir, platform), 'library.db');
}

export function resolveApiCacheDbPath(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolveAppDataDir(executableDir, platform), '.api_cache.db');
}

export function resolveConfigPath(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolveAppDataDir(executableDir, platform), 'config.json');
}

export function resolveRenameHistoryPath(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolveAppDataDir(executableDir, platform), 'rename_history.json');
}

export function resolveThumbnailDir(executableDir = process.cwd(), platform = process.platform) {
    return path.join(resolveAppDataDir(executableDir, platform), 'thumbnails');
}
