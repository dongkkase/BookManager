import { extractCoreTitle, extractVolNumbers } from './utils/folderUtils.js';

function parentPath(filePath) {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return separatorIndex >= 0 ? value.slice(0, separatorIndex) : '';
}

export function findMissingVolumes(files = []) {
    const seriesMap = new Map();

    files.forEach(file => {
        if (file?.is_folder || file?.is_dup_folder || file?.is_dup_child) return;
        const filePath = file?.full_path || file?.path || '';
        const filenameStem = String(file?.name || '').replace(/\.[^.]+$/, '');
        const series = String(file?.series || extractCoreTitle(filenameStem) || '').trim()
            || parentPath(filePath).split(/[\\/]/).pop()
            || '';
        if (!series) return;
        if (!seriesMap.has(series)) seriesMap.set(series, []);
        seriesMap.get(series).push({
            name: file?.name || '',
            path: filePath,
        });
    });

    const missingData = [];
    for (const [series, items] of seriesMap.entries()) {
        const volumes = new Set();
        let folderPath = '';
        items.forEach(item => {
            extractVolNumbers(item.name, series).forEach(volume => volumes.add(volume));
            if (!folderPath) folderPath = parentPath(item.path);
        });
        if (volumes.size === 0) continue;

        const sorted = [...volumes].sort((a, b) => a - b);
        const minimum = sorted[0];
        const maximum = sorted[sorted.length - 1];
        if (maximum - minimum >= 150) continue;

        const missing = [];
        for (let volume = minimum; volume < maximum; volume += 1) {
            if (!volumes.has(volume)) missing.push(String(volume));
        }
        if (missing.length > 0) {
            missingData.push({ series, missing, folder_path: folderPath });
        }
    }

    return missingData.sort((a, b) => a.series.localeCompare(b.series));
}

export function isPathInsideFolder(filePath, folderPath) {
    const normalize = value => String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLocaleLowerCase();
    const file = normalize(filePath);
    const folder = normalize(folderPath);
    return Boolean(file && folder && (file === folder || file.startsWith(`${folder}/`)));
}
