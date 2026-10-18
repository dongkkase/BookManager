import { groupLibraryItems } from './libraryPresentation.js';

function finishLibraryMove(entries, originalOrder, groups) {
    const nextEntries = groups.flatMap(group => group.items);
    return nextEntries.every((entry, index) => entry === originalOrder[index])
        ? entries
        : nextEntries;
}

export function moveLibraryEntry(entries = [], path, destination = {}) {
    if (!Array.isArray(entries) || !destination) return entries;
    const { group, targetPath, position = 'before' } = destination;
    if (typeof group !== 'string' || !['before', 'after'].includes(position)) return entries;
    const sourceEntry = entries.find(entry => entry.path === path);
    if (!sourceEntry || targetPath === path) return entries;
    const targetEntry = targetPath == null ? null : entries.find(entry => entry.path === targetPath);
    if (targetPath != null && (!targetEntry || (targetEntry.group || '') !== group)) return entries;

    const groups = groupLibraryItems(entries);
    const originalOrder = groups.flatMap(item => item.items);
    const sourceGroup = groups.find(item => item.key === (sourceEntry.group || ''));
    let targetGroup = groups.find(item => item.key === group);
    if (!targetGroup && group !== '') return entries;
    if (!targetGroup) {
        targetGroup = { key: '', label: '', items: [] };
        groups.push(targetGroup);
    }

    sourceGroup.items.splice(sourceGroup.items.indexOf(sourceEntry), 1);
    const targetIndex = targetEntry
        ? targetGroup.items.indexOf(targetEntry) + (position === 'after' ? 1 : 0)
        : targetGroup.items.length;
    const nextEntry = (sourceEntry.group || '') === group ? sourceEntry : { ...sourceEntry, group };
    targetGroup.items.splice(targetIndex, 0, nextEntry);

    return finishLibraryMove(entries, originalOrder, groups);
}

export function moveLibraryGroup(entries = [], groupKey, targetGroupKey, position = 'before') {
    if (!Array.isArray(entries) || !['before', 'after'].includes(position)) return entries;
    if (typeof groupKey !== 'string' || typeof targetGroupKey !== 'string' || groupKey === targetGroupKey) return entries;
    const groups = groupLibraryItems(entries);
    const sourceIndex = groups.findIndex(group => group.key === groupKey);
    const targetGroup = groups.find(group => group.key === targetGroupKey);
    if (sourceIndex < 0 || !targetGroup) return entries;

    const originalOrder = groups.flatMap(group => group.items);
    const [sourceGroup] = groups.splice(sourceIndex, 1);
    const targetIndex = groups.indexOf(targetGroup) + (position === 'after' ? 1 : 0);
    groups.splice(targetIndex, 0, sourceGroup);
    return finishLibraryMove(entries, originalOrder, groups);
}
