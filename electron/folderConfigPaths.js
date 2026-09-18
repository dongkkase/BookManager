import fs from 'node:fs';

const PATH_LIST_KEYS = ['libraries', 'dup_check_folders', 'library_entries', 'favorites', 'folder_favorites', 'folder_goto_history'];
const PATH_KEYS = ['folder_last_path', 'last_folder_path', 'last_selected_folder_path', 'last_selected_library'];

export async function restoreFolderConfigPaths(config, {
    platform = process.platform,
    stat = fs.promises.stat,
    timeoutMs = 3000,
} = {}) {
    if (platform !== 'darwin') return config;
    const entryPath = entry => typeof entry === 'string' ? entry : entry?.path;
    const paths = [...new Set([
        ...PATH_LIST_KEYS.flatMap(key => Array.isArray(config[key]) ? config[key].map(entryPath) : []),
        ...PATH_KEYS.map(key => config[key]),
    ].filter(value => typeof value === 'string' && value.normalize('NFC') !== value.normalize('NFD')))];
    if (paths.length === 0) return config;

    const replacements = new Map();
    let next = 0;
    let stopped = false;
    const inspect = async () => {
        while (!stopped && next < paths.length) {
            const original = paths[next++];
            // Preserve working paths; only recover old, missing Unicode spellings.
            const candidates = [...new Set([original, original.normalize('NFD'), original.normalize('NFC')])];
            for (const candidate of candidates) {
                if (stopped) return;
                try {
                    const stats = await stat(candidate);
                    if (!stopped && stats.isDirectory() && candidate !== original) {
                        replacements.set(original, candidate);
                    }
                    break;
                } catch (error) {
                    if (error?.code !== 'ENOENT') break;
                }
            }
        }
    };
    let timer;
    try {
        await Promise.race([
            Promise.all(Array.from({ length: Math.min(4, paths.length) }, inspect)),
            new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
        ]);
    } finally {
        stopped = true;
        clearTimeout(timer);
    }
    if (replacements.size === 0) return config;

    const restorePath = value => replacements.get(value) || value;
    const restoreEntry = entry => typeof entry === 'string' ? restorePath(entry)
        : entry?.path && replacements.has(entry.path) ? { ...entry, path: restorePath(entry.path) } : entry;
    const restored = { ...config };
    for (const key of PATH_LIST_KEYS) {
        if (Array.isArray(config[key])) restored[key] = config[key].map(restoreEntry);
    }
    for (const key of PATH_KEYS) {
        if (typeof config[key] === 'string') restored[key] = restorePath(config[key]);
    }
    return restored;
}
