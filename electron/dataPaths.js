import path from 'path';

export function resolvePortableBaseDir(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    if (platform === 'win32' && env?.PORTABLE_EXECUTABLE_DIR) {
        return env.PORTABLE_EXECUTABLE_DIR;
    }

    const baseDir = executableDir || process.cwd();
    if (platform !== 'darwin') return baseDir;

    const normalized = path.normalize(baseDir);
    const macOsDir = path.join('Contents', 'MacOS');
    if (!normalized.endsWith(`${path.sep}${macOsDir}`)) return baseDir;

    const appBundleDir = path.dirname(path.dirname(normalized));
    if (path.extname(appBundleDir).toLowerCase() !== '.app') return baseDir;
    return path.dirname(appBundleDir);
}

export function resolveAppDataDir(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolvePortableBaseDir(executableDir, platform, env), 'data');
}

export function resolveLibraryDbPath(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), 'library.db');
}

export function resolveApiCacheDbPath(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), '.api_cache.db');
}

export function resolveConfigPath(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), 'config.json');
}

export function resolveRenameHistoryPath(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), 'rename_history.json');
}

export function resolveThumbnailDir(executableDir = process.cwd(), platform = process.platform, env = process.env) {
    return path.join(resolveAppDataDir(executableDir, platform, env), 'thumbnails');
}
