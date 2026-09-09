import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReadivePaths, selectReadiveEntries, summarizeReadiveEntries, canEnqueueReadiveTransfer } from './readiveTransferPolicy.js';

const entries = [
    { id: 'root', kind: 'directory', parentId: null },
    { id: 'child', kind: 'directory', parentId: 'root' },
    { id: 'a', kind: 'file', parentId: 'child', size: 100, metadataBytes: 20, coverBytes: 30 },
    { id: 'b', kind: 'file', parentId: 'root', size: 200, metadataBytes: 10, coverBytes: 0 },
];

test('sidebar transfer uses clicked folder while list transfer preserves mixed selection', () => {
    const selected = [{ path: '/library/a.txt' }, { path: '/library/series', isDirectory: true }];
    assert.deepEqual(resolveReadivePaths({ type: 'folder', folderPath: '/other' }, selected), ['/other']);
    assert.deepEqual(resolveReadivePaths({ type: 'folder', source: 'list', folderPath: '/library/series' }, selected), ['/library/a.txt', '/library/series']);
    assert.deepEqual(resolveReadivePaths({ type: 'file', file: { full_path: '/library/a.txt' } }, selected), ['/library/a.txt', '/library/series']);
});

test('excluding a folder removes all descendants from preview and byte totals', () => {
    const selected = selectReadiveEntries(entries, ['child']);
    assert.deepEqual(selected.map(entry => entry.id), ['root', 'b']);
    assert.deepEqual(summarizeReadiveEntries(selected), { files: 1, folders: 1, bytes: 210, metadataBytes: 10, coverBytes: 0, large: false, blocked: false });
    assert.deepEqual(selectReadiveEntries(entries, ['root']), []);
});

test('large and hard transfer limits are enforced independently of checkbox confirmation', () => {
    const summary = summarizeReadiveEntries(Array.from({ length: 101 }, (_, id) => ({ id, kind: 'file', size: 1 })));
    assert.equal(summary.large, true);
    const options = { snapshot: { id: 'scan' }, summary, deviceId: 'phone', running: true, destination: { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev' } };
    assert.equal(canEnqueueReadiveTransfer(options), false);
    assert.equal(canEnqueueReadiveTransfer({ ...options, largeConfirmed: true }), true);
    assert.equal(canEnqueueReadiveTransfer({ ...options, largeConfirmed: true, busy: true }), false);
    assert.equal(canEnqueueReadiveTransfer({ ...options, largeConfirmed: true, snapshot: { id: 'scan', blocked: true } }), false);
    assert.equal(summarizeReadiveEntries([{ kind: 'file', size: 10 * 1024 ** 3 + 1 }]).blocked, true);
});

test('unknown sizes and empty selection cannot start a transfer', () => {
    const options = { snapshot: { id: 'scan' }, deviceId: 'phone', running: true, destination: { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev' } };
    const unknownSize = summarizeReadiveEntries([{ kind: 'file', size: NaN }]);
    assert.equal(unknownSize.blocked, true);
    assert.equal(canEnqueueReadiveTransfer({ ...options, summary: unknownSize }), false);
    assert.equal(canEnqueueReadiveTransfer({ ...options, summary: summarizeReadiveEntries([]) }), false);
});

test('server skipped entries are excluded from the confirmation scope and byte totals', () => {
    const snapshotEntries = [...entries, { id: 'skip', parentId: 'root', kind: 'file', size: 5000, skippedReason: 'unsupported_format' }];
    assert.equal(selectReadiveEntries(snapshotEntries).length, entries.length);
    assert.equal(summarizeReadiveEntries(snapshotEntries).bytes, 360);
});


test('a valid chosen destination enables normal transfers without a separate general confirmation', () => {
    const options = { snapshot: { id: 'scan' }, summary: summarizeReadiveEntries(entries), deviceId: 'phone', running: true };
    assert.equal(canEnqueueReadiveTransfer(options), false);
    const destination = { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev' };
    assert.equal(canEnqueueReadiveTransfer({ ...options, destination }), true);
    assert.equal(canEnqueueReadiveTransfer({ ...options, destination: { ...destination, deviceId: 'other' } }), false);
    assert.equal(canEnqueueReadiveTransfer({ ...options, destination: { ...destination, revision: '' } }), false);
});
