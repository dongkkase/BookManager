import { fail } from './policy.js';
import { openFrozenAsset } from './manifest.js';

const normalize = value => {
    const rating = Number(value);
    return Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.max(1, Math.round(rating))) : null;
};
const validRating = value => value === null || Number.isInteger(value) && value >= 1 && value <= 10;

export async function exchangeRatings(state, device, body, libraryDb, assertActive = () => {}) {
    if (!body || !Array.isArray(body.itemIds) || body.itemIds.length > 500
        || body.itemIds.some(id => typeof id !== 'string' || !id || id.length > 100)
        || new Set(body.itemIds).size !== body.itemIds.length || !Array.isArray(body.records) || body.records.length > body.itemIds.length
        || Object.keys(body).some(key => !['itemIds', 'records'].includes(key))) throw fail('invalid_ratings');
    const selected = new Set(body.itemIds);
    const allowed = new Map(Object.values(state.items).filter(item => selected.has(item.itemId) && item.deviceIds.includes(device.id)).map(item => [item.itemId, item]));
    const uploads = new Map();
    for (const record of body.records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)
            || Object.keys(record).some(key => !['itemId', 'contentHash', 'rating', 'baseRating', 'mutationId'].includes(key))
            || !selected.has(record.itemId) || uploads.has(record.itemId)
            || !/^[a-f0-9]{64}$/.test(record.contentHash) || !validRating(record.rating) || record.rating === null
            || !validRating(record.baseRating) || typeof record.mutationId !== 'string' || !/^[a-f0-9-]{36}$/.test(record.mutationId)) throw fail('invalid_ratings');
        const item = allowed.get(record.itemId);
        if (item && item.contentHash !== record.contentHash) throw fail('unshared_rating_item', 403);
        uploads.set(record.itemId, record);
    }
    if (!libraryDb?.getFileInfo || !libraryDb?.setFileRating) throw fail('rating_unavailable', 503);
    state.ratingReceipts ||= {};
    const records = [];
    const changed = [];
    for (const item of allowed.values()) {
        assertActive();
        const identity = item.ratingIdentity || item.identity;
        if (!identity) continue;
        let handle;
        try { handle = await openFrozenAsset({ sourcePath: item.sourcePath, identity }); }
        catch { continue; }
        await handle.close();
        const row = await libraryDb.getFileInfo(item.sourcePath);
        if (!row) continue;
        let rating = normalize(row.rating);
        const upload = uploads.get(item.itemId);
        const receiptKey = `${device.id}:${item.itemId}`;
        const receipts = state.ratingReceipts[receiptKey] || [];
        let acknowledgedMutationId = null;
        let conflict = false;
        if (upload) {
            if (receipts.includes(upload.mutationId)) acknowledgedMutationId = upload.mutationId;
            else if (rating !== upload.baseRating && rating !== upload.rating) conflict = true;
            else {
                assertActive();
                const recheck = await openFrozenAsset({ sourcePath: item.sourcePath, identity });
                await recheck.close();
                // Keep the transferred content hash stable; BookManager's DB override survives rescans.
                const saved = await libraryDb.setFileRating(item.sourcePath, upload.rating, { storage: 'database', expectedRating: upload.baseRating });
                if (saved === false) {
                    const latest = await libraryDb.getFileInfo(item.sourcePath);
                    records.push({ itemId: item.itemId, rating: normalize(latest?.rating), acknowledgedMutationId: null, conflict: true });
                    continue;
                }
                rating = upload.rating;
                state.ratingReceipts[receiptKey] = [...receipts, upload.mutationId].slice(-64);
                acknowledgedMutationId = upload.mutationId;
                changed.push({ filePath: item.sourcePath, rating });
            }
        }
        records.push({ itemId: item.itemId, rating, acknowledgedMutationId, conflict });
    }
    return { records, changed };
}
