import { folderEntryOperationTargets } from './fileActionPolicy.js';
import { normalizeLibraryKey } from './folderLibraryStatus.js';

export function libraryMoveFolderSources(menu, selectedEntries = []) {
    const selectedFolders = selectedEntries.filter(entry => entry.isDirectory);
    const clickedKey = normalizeLibraryKey(menu.folderPath);
    const includesClicked = selectedFolders.some(entry => normalizeLibraryKey(entry.full_path || entry.path) === clickedKey);
    const entries = menu.source === 'list' && includesClicked
        ? selectedFolders
        : [{ path: menu.folderPath, isDirectory: true }];
    return folderEntryOperationTargets(entries).map(entry => entry.full_path || entry.path);
}

export async function expandLibraryMovePlans(plans, api) {
    const destinationCounts = new Map();
    for (const plan of plans.filter(plan => plan.folderMode)) {
        const key = normalizeLibraryKey(plan.dest);
        destinationCounts.set(key, (destinationCounts.get(key) || 0) + 1);
    }
    const expandedPlans = [];
    for (const plan of plans) {
        if (plan.folderMode && (destinationCounts.get(normalizeLibraryKey(plan.dest)) > 1 || await api.exists(plan.dest))) {
            const expanded = await api.expandFolderMove(plan.src, plan.dest);
            if (!expanded?.success) throw new Error(expanded?.message || 'Folder move preparation failed.');
            expandedPlans.push(...expanded.plans.map(entry => ({ ...entry, targetLibrary: plan.targetLibrary })));
        } else {
            expandedPlans.push(plan);
        }
    }
    return expandedPlans;
}

function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).pop() || '';
}

function parentPath(filePath) {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return separatorIndex >= 0 ? value.slice(0, separatorIndex) : '';
}

function joinPath(base, ...parts) {
    const separator = String(base || '').includes('\\') ? '\\' : '/';
    const normalizedBase = String(base || '').replace(/[\\/]+$/, '');
    return [normalizedBase, ...parts.map(part => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
        .filter(Boolean)
        .join(separator);
}

export function createLibraryMovePlans(sources, targetLibrary, options = {}) {
    const { createCurrentFolder = true, folderMode = false } = options;
    return (sources || []).map(source => {
        const sourcePath = source?.full_path || source?.path || source?.src || source;
        const sourceName = basename(sourcePath);
        const currentFolder = basename(parentPath(sourcePath));
        const destination = folderMode
            ? joinPath(targetLibrary, sourceName)
            : joinPath(targetLibrary, ...(createCurrentFolder ? [currentFolder] : []), sourceName);
        return {
            src: sourcePath,
            dest: destination,
            targetLibrary,
            folderMode,
            cleanupRoot: folderMode ? '' : parentPath(sourcePath),
        };
    }).filter(plan => plan.src && plan.dest && normalizeLibraryKey(plan.src) !== normalizeLibraryKey(plan.dest));
}

export function applyConflictChoice(plan, choice) {
    if (!['overwrite', 'rename', 'skip'].includes(choice)) return plan;
    return { ...plan, conflictAction: choice };
}
