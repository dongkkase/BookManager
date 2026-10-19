import path from 'node:path';
import { isRegisteredLibraryFile } from '../libraryPathScope.js';

const completedScopes = new WeakMap();

function emptyCleanupResult() {
    return {
        changes: 0,
        deletedItemCount: 0,
        deletedPathHashCount: 0,
        deletedReadingCount: 0,
        deletedAppliedReadingCount: 0,
        preservedSharedItemCount: 0,
    };
}

function entries(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function internalJobHashes(jobs, contains) {
    const hashes = new Set();
    for (const job of Array.isArray(jobs) ? jobs : []) {
        for (const file of Array.isArray(job?.manifest?.files) ? job.manifest.files : []) {
            const asset = job.assets?.[job.fileAssets?.[file.id]?.file];
            if (!asset || !contains(asset.sourcePath)) continue;
            const hash = file.sha256 || asset.sha256;
            if (typeof hash === 'string' && hash && (!asset.sha256 || asset.sha256 === hash)) hashes.add(hash);
        }
    }
    return hashes;
}

export async function pruneReadiveLibraryData(store, libraryPaths) {
    if (!Array.isArray(libraryPaths) || libraryPaths.some(value => (
        typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)
    ))) throw new Error('invalid_library_paths');
    const registeredPaths = [...libraryPaths];
    const scope = JSON.stringify(registeredPaths);
    const completed = completedScopes.get(store);
    if (completed?.scope === scope && completed.pending === store.pending && completed.state === store.state) {
        return { ...emptyCleanupResult(), skipped: true };
    }
    const contains = filePath => isRegisteredLibraryFile(filePath, registeredPaths);
    const operation = store.transact(state => {
        const result = emptyCleanupResult();
        const protectedHashes = internalJobHashes(state.jobs, contains);
        for (const [filePath, hash] of entries(state.pathContentHashes)) {
            if (contains(filePath)) {
                if (typeof hash === 'string' && hash) protectedHashes.add(hash);
            } else {
                delete state.pathContentHashes[filePath];
                result.deletedPathHashCount += 1;
            }
        }
        for (const [hash, item] of entries(state.items)) {
            if (contains(item?.sourcePath)) {
                protectedHashes.add(hash);
                if (item.contentHash) protectedHashes.add(item.contentHash);
            }
        }
        const retainedItemIds = new Set();
        for (const [hash, item] of entries(state.items)) {
            if (protectedHashes.has(hash) || protectedHashes.has(item?.contentHash)) {
                if (item?.itemId) retainedItemIds.add(item.itemId);
                if (!contains(item?.sourcePath)) result.preservedSharedItemCount += 1;
            } else {
                delete state.items[hash];
                result.deletedItemCount += 1;
            }
        }
        for (const [key, record] of entries(state.reading)) {
            if (retainedItemIds.has(record?.itemId) || protectedHashes.has(record?.contentHash)) continue;
            delete state.reading[key];
            result.deletedReadingCount += 1;
        }
        for (const [itemId, applied] of entries(state.appliedReadings)) {
            if (retainedItemIds.has(itemId) || protectedHashes.has(applied?.record?.contentHash)) continue;
            delete state.appliedReadings[itemId];
            result.deletedAppliedReadingCount += 1;
        }
        result.changes = result.deletedItemCount + result.deletedPathHashCount
            + result.deletedReadingCount + result.deletedAppliedReadingCount;
        return result;
    }, { shouldSave: result => result.changes > 0 });
    const pending = store.pending;
    const result = await operation;
    // A queued transfer or reading update must invalidate this completed pass.
    if (pending && typeof pending.then === 'function' && store.pending === pending) {
        completedScopes.set(store, { scope, pending, state: store.state });
    }
    return result;
}
