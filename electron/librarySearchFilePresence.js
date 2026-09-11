import fs from 'node:fs';
import path from 'node:path';

export async function filterLibrarySearchFilesByPresence(rows, {
    readdir = fs.promises.readdir,
    platform = process.platform,
    concurrency = 4,
    timeoutMs = 3000,
} = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const nameKey = value => platform === 'darwin' ? value.normalize('NFC')
        : platform === 'win32' ? value.toLowerCase() : value;
    const groups = new Map();
    const present = rows.map(() => true);
    for (let index = 0; index < rows.length; index += 1) {
        const filePath = rows[index]?.path;
        if (typeof filePath !== 'string' || !pathApi.isAbsolute(filePath)) continue;
        const parent = pathApi.dirname(filePath);
        const key = nameKey(parent);
        if (!groups.has(key)) groups.set(key, { parent, entries: [] });
        groups.get(key).entries.push({ index, name: nameKey(pathApi.basename(filePath)) });
    }
    const pending = [...groups.values()];
    const workerCount = Math.min(pending.length, Math.max(1, Math.min(16, Math.floor(Number(concurrency) || 4))));
    let next = 0;
    let stopped = false;
    const inspect = async () => {
        while (!stopped && next < pending.length) {
            const group = pending[next++];
            try {
                const names = await readdir(group.parent);
                if (stopped) return;
                const available = new Set(names.map(name => nameKey(String(name))));
                for (const entry of group.entries) present[entry.index] = available.has(entry.name);
            } catch (error) {
                if (stopped) return;
                // An unreadable NAS folder does not establish that its files are gone.
                if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
                    for (const entry of group.entries) present[entry.index] = false;
                }
            }
        }
    };
    let timer;
    try {
        // Stop scheduling reads when the budget expires; unresolved groups stay visible.
        await Promise.race([
            Promise.all(Array.from({ length: workerCount }, inspect)),
            new Promise(resolve => {
                timer = setTimeout(resolve, Math.max(1, Number(timeoutMs) || 3000));
            }),
        ]);
    } finally {
        stopped = true;
        clearTimeout(timer);
    }
    return rows.filter((_, index) => present[index]);
}
