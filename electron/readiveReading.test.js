import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { exchangeReading, getImportedReadingState, validateReadingRecord } from './readive/reading.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-reading-'));
    const libraryDb = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    t.after(async () => { await libraryDb.close(); await fs.rm(root, { recursive: true, force: true }); });
    const filePath = path.join(root, 'book.pdf');
    const contentHash = 'a'.repeat(64);
    const state = { serverId: 'server-123', items: { [contentHash]: { itemId: 'item-123', contentHash, sourcePath: filePath, format: 'pdf', deviceIds: ['device-123'] } }, reading: {}, appliedReadings: {} };
    const record = { itemId: 'item-123', contentHash, deviceId: 'device-123', revision: 1, updatedAt: new Date(Date.now() - 60000).toISOString(), lastReadAt: new Date(Date.now() - 60000).toISOString(), readStatus: 'reading', locator: { kind: 'page', pageIndex: 20, pageCount: 100 } };
    return { state, libraryDb, filePath, record, device: { id: 'device-123' } };
}

test('Readive reading rejects spoofed origins, nonfinite positions, and future updates', () => {
    const record = { itemId: 'item', contentHash: 'a'.repeat(64), deviceId: 'phone', revision: 1, updatedAt: new Date().toISOString(), lastReadAt: null, readStatus: 'reading', locator: { kind: 'page', pageIndex: 2 } };
    assert.equal(validateReadingRecord(record, 'phone').revision, 1);
    assert.throws(() => validateReadingRecord(record, 'other'), /invalid_reading_record/);
    assert.throws(() => validateReadingRecord({ ...record, updatedAt: null }, 'phone'), /invalid_reading_time/);
    assert.throws(() => validateReadingRecord({ ...record, locator: { kind: 'page', pageIndex: Infinity } }, 'phone'), /invalid_reading_locator/);
    assert.throws(() => validateReadingRecord({ ...record, updatedAt: '2099-01-01T00:00:00Z' }, 'phone'), /invalid_reading_time/);
});

test('Readive remote reading persists once and hydrates after an open-only timestamp write', async t => {
    const { state, libraryDb, filePath, record, device } = await fixture(t);
    await exchangeReading(state, device, [record], libraryDb);
    const firstRevision = state.appliedReadings[record.itemId].localRevision;
    assert.equal((await getImportedReadingState(state, filePath, libraryDb)).pageIndex, 20);
    await exchangeReading(state, device, [record], libraryDb);
    assert.equal(state.appliedReadings[record.itemId].localRevision, firstRevision);
    assert.equal(Object.keys(state.reading).length, 1);
    await libraryDb.upsertReadingState(filePath, { lastReadAt: Date.now() });
    assert.equal((await getImportedReadingState(state, filePath, libraryDb)).pageIndex, 20);
    await exchangeReading(state, device, [], libraryDb);
    assert.equal(Object.keys(state.reading).length, 1, 'opening a book does not echo an imported position as a PC-origin edit');
    await libraryDb.upsertReadingState(filePath, { pageIndex: 21, lastReadAt: Date.now() });
    assert.equal(await getImportedReadingState(state, filePath, libraryDb), null);
    const winners = await exchangeReading(state, device, [], libraryDb);
    assert.equal(winners[0].deviceId, state.serverId);
    assert.equal(winners[0].locator.pageIndex, 21);
});

test('Readive rejects unshared books and ignores repeated older per-device revisions', async t => {
    const { state, libraryDb, record, device } = await fixture(t);
    await assert.rejects(exchangeReading(state, device, [{ ...record, itemId: 'other' }], libraryDb), /unshared_reading_item/);
    await exchangeReading(state, device, [{ ...record, revision: 2 }], libraryDb);
    const returned = await exchangeReading(state, device, [{ ...record, locator: { kind: 'page', pageIndex: 1 } }], libraryDb);
    assert.equal(returned[0].revision, 2);
    assert.equal(returned[0].locator.pageIndex, 20);
});


test('Readive keeps shared reading history when the original source is unavailable without applying it to a replacement', async t => {
    const { state, libraryDb, filePath, record, device } = await fixture(t);
    await exchangeReading(state, device, [record], libraryDb);
    state.items[record.contentHash].identity = {};
    const next = { ...record, revision: 2, locator: { kind: 'page', pageIndex: 30, pageCount: 100 } };
    const winners = await exchangeReading(state, device, [next], libraryDb);
    assert.equal(winners[0].locator.pageIndex, 30);
    assert.equal((await libraryDb.listRecentReadingStates())[0].pageIndex, 20);
    assert.equal(await getImportedReadingState(state, filePath, libraryDb), null);
});


test('Readive strips renderer-only keys and normalizes nullable legacy reading fields on export', async t => {
    const { state, libraryDb, filePath, device } = await fixture(t);
    await libraryDb.upsertReadingState(filePath, { format: 'pdf', pageIndex: 4, pageCount: 10, locator: { kind: 'page', pageIndex: 4, scrollPercent: 12, privateRendererKey: true } });
    const records = await exchangeReading(state, device, [], libraryDb);
    assert.deepEqual(records[0].locator, { kind: 'page', pageIndex: 4, pageCount: 10 });
    assert.doesNotThrow(() => validateReadingRecord(records[0], state.serverId));
});


test('Readive preserves explicit unread status instead of inferring a new local reading event', async t => {
    const { state, libraryDb, filePath, record, device } = await fixture(t);
    const unread = { ...record, readStatus: 'unread', lastReadAt: null, locator: { kind: 'page', pageIndex: 0, pageCount: 100 } };
    await exchangeReading(state, device, [unread], libraryDb);
    assert.equal((await libraryDb.listRecentReadingStates())[0].status, 'unread');
    assert.equal((await getImportedReadingState(state, filePath, libraryDb)).readStatus, 'unread');
    const records = await exchangeReading(state, device, [], libraryDb);
    assert.equal(records[0].deviceId, device.id);
    assert.equal(Object.keys(state.reading).length, 1);
});


test('Readive batches selected shared IDs even when the paired library has more than 2000 books', async () => {
    const state = { serverId: 'server', items: {}, reading: {}, appliedReadings: {} };
    for (let index = 0; index < 2100; index += 1) {
        const contentHash = index.toString(16).padStart(64, '0');
        state.items[contentHash] = { itemId: `item-${index}`, contentHash, sourcePath: `/fixture/${index}.pdf`, format: 'pdf', deviceIds: ['phone'] };
    }
    const record = { itemId: 'item-0', contentHash: '0'.repeat(64), deviceId: 'phone', revision: 1, updatedAt: new Date().toISOString(), lastReadAt: null, readStatus: 'reading', locator: { kind: 'page', pageIndex: 4 } };
    const records = await exchangeReading(state, { id: 'phone' }, [record], undefined, ['item-0', 'item-1']);
    assert.deepEqual(records, [record]);
    await assert.rejects(exchangeReading(state, { id: 'phone' }, [], undefined), /too_many_reading_items/);
    assert.deepEqual(await exchangeReading(state, { id: 'phone' }, [], undefined, ['unshared-item']), []);
    await assert.rejects(exchangeReading(state, { id: 'phone' }, [record], undefined, ['item-1']), /unshared_reading_item/);
    await assert.rejects(exchangeReading(state, { id: 'phone' }, [], undefined, Array.from({ length: 501 }, (_, index) => `item-${index}`)), /invalid_reading_selection/);
});

test('Readive does not relabel old path-based reading progress when file content is replaced', async t => {
    const { libraryDb, filePath, device } = await fixture(t);
    const { ReadiveService } = await import('./readive/service.js');
    const realDirectory = await fs.realpath(path.dirname(filePath));
    const sourcePath = path.join(realDirectory, 'replacement.pdf');
    const service = new ReadiveService({ directory: path.join(realDirectory, 'link'), getLibraryDb: async () => libraryDb });
    await service.store.transact(state => { state.devices.push({ id: device.id, name: 'Fixture phone', tokenHash: 'a'.repeat(64) }); });
    await fs.writeFile(sourcePath, 'original-content');
    await libraryDb.upsertReadingState(sourcePath, { format: 'pdf', pageIndex: 20, pageCount: 100, locator: { kind: 'page', pageIndex: 20, pageCount: 100 }, lastReadAt: Date.now() - 60000 });
    const originalScan = await service.scan({ paths: [sourcePath] });
    const originalJob = await service.enqueue({ snapshotId: originalScan.id, deviceId: device.id, confirmed: true });
    const originalItem = service.store.state.jobs.find(job => job.id === originalJob.id).manifest.files[0];
    await service.store.transact(state => exchangeReading(state, device, [], libraryDb, [originalItem.itemId]));
    await fs.writeFile(sourcePath, 'replacement-content-with-different-bytes');
    const replacementScan = await service.scan({ paths: [sourcePath] });
    const replacementJob = await service.enqueue({ snapshotId: replacementScan.id, deviceId: device.id, confirmed: true });
    const replacementItem = service.store.state.jobs.find(job => job.id === replacementJob.id).manifest.files[0];
    assert.notEqual(replacementItem.itemId, originalItem.itemId);
    let exported = await service.store.transact(state => exchangeReading(state, device, [], libraryDb, [replacementItem.itemId]));
    assert.deepEqual(exported, [], 'old path-based progress must not become a record for replacement bytes');
    await libraryDb.upsertReadingState(sourcePath, { lastReadAt: Date.now() });
    exported = await service.store.transact(state => exchangeReading(state, device, [], libraryDb, [replacementItem.itemId]));
    assert.deepEqual(exported, [], 'opening without moving must not relabel the old position');
    await libraryDb.upsertReadingState(sourcePath, { pageIndex: 21, locator: { kind: 'page', pageIndex: 21, pageCount: 100 }, lastReadAt: Date.now() });
    exported = await service.store.transact(state => exchangeReading(state, device, [], libraryDb, [replacementItem.itemId]));
    assert.equal(exported[0].locator.pageIndex, 21);
    assert.equal(exported[0].contentHash, replacementItem.sha256);
    await libraryDb.upsertReadingState(sourcePath, { pageIndex: 20, locator: { kind: 'page', pageIndex: 20, pageCount: 100 }, lastReadAt: Date.now() });
    exported = await service.store.transact(state => exchangeReading(state, device, [], libraryDb, [replacementItem.itemId]));
    assert.equal(exported[0].locator.pageIndex, 20, 'returning to a formerly used position remains a real new reading change');
});

test('Readive hydration finds the valid replacement item when an older hash retains the same source path', async t => {
    const { state, libraryDb, filePath, record, device } = await fixture(t);
    const { scanReadivePaths } = await import('./readive/manifest.js');
    const realDirectory = await fs.realpath(path.dirname(filePath));
    const sourcePath = path.join(realDirectory, 'replacement.pdf');
    await fs.writeFile(sourcePath, 'original');
    const first = await scanReadivePaths([sourcePath]);
    const firstFile = first.entries[0];
    state.items = { [firstFile.contentHash]: { itemId: 'old-item', contentHash: firstFile.contentHash, sourcePath, format: 'pdf', deviceIds: [device.id], identity: first.assets[firstFile.assetId].identity } };
    await exchangeReading(state, device, [{ ...record, itemId: 'old-item', contentHash: firstFile.contentHash }], libraryDb);
    await fs.writeFile(sourcePath, 'replacement-bytes');
    const second = await scanReadivePaths([sourcePath]);
    const secondFile = second.entries[0];
    state.items[secondFile.contentHash] = { itemId: 'new-item', contentHash: secondFile.contentHash, sourcePath, format: 'pdf', deviceIds: [device.id], identity: second.assets[secondFile.assetId].identity };
    const replacementRecord = { ...record, itemId: 'new-item', contentHash: secondFile.contentHash, updatedAt: new Date(Date.now() + 1000).toISOString(), locator: { kind: 'page', pageIndex: 60, pageCount: 100 } };
    await exchangeReading(state, device, [replacementRecord], libraryDb, ['new-item']);
    const hydrated = await getImportedReadingState(state, sourcePath, libraryDb);
    assert.equal(hydrated?.pageIndex, 60);
});
