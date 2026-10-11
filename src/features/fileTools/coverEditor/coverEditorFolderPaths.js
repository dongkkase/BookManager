import { supportsCoverEditor } from '../../../coverEditorBatch.js';

const nameOrder = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

function validEntryName(name) {
    return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

export async function collectCoverEditorFolderPaths(folderPath, readDir, shouldCancel = () => false) {
    if (typeof folderPath !== 'string' || !folderPath || shouldCancel()) return [];
    const separator = /^[a-z]:\\/i.test(folderPath) || folderPath.startsWith('\\\\') ? '\\' : '/';
    const paths = [];
    const pending = [folderPath];

    while (pending.length) {
        if (shouldCancel()) return [];
        const currentPath = pending.pop();
        const entries = await readDir(currentPath);
        if (shouldCancel()) return [];
        const sortedEntries = (Array.isArray(entries) ? entries : [])
            .filter(entry => entry && validEntryName(entry.name))
            .sort((left, right) => nameOrder.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        const directories = [];
        for (const entry of sortedEntries) {
            if (shouldCancel()) return [];
            const path = `${currentPath.replace(/[\\/]+$/, '')}${separator}${entry.name}`;
            if (entry.isDirectory === true) {
                if (!entry.name.startsWith('.') && entry.name.toLowerCase() !== 'bak') directories.push(path);
            } else if (entry.isFile === true && supportsCoverEditor({ path })) {
                paths.push(path);
            }
        }
        for (let index = directories.length - 1; index >= 0; index -= 1) pending.push(directories[index]);
    }
    return paths;
}
