import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadiveDestinationBrowser } from './readiveDestinationPolicy.js';

const page = (parentId = null, entries = [], nextCursor = null, revision = 'rev-1') => ({ parentId, name: parentId ?? 'Phone', entries, nextCursor, revision });
const folder = id => ({ id, name: id, kind: 'directory', size: null });
const file = id => ({ id, name: id, kind: 'file', size: 12 });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a loaded page automatically becomes the destination and remains unselected while loading', async () => {
    let resolve;
    const browser = createReadiveDestinationBrowser({ requestPage: () => new Promise(done => { resolve = done; }) });
    const snapshots = [];
    browser.subscribe(state => snapshots.push(state));
    browser.setDevice('phone', true);
    assert.equal(browser.getSnapshot().selection, null);
    assert.equal(browser.getSnapshot().loading, true);
    resolve(page(null, [folder('Shelf'), file('Book.txt')])); await tick();
    assert.deepEqual(browser.getSnapshot().selection, { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev-1' });
    assert.equal(snapshots.some(state => state.loading && state.selection !== null), false, 'Loading and destination selection are published consistently');
    assert.equal(browser.open('Book.txt'), false);
    assert.equal(browser.getSnapshot().selection.collectionId, null);
    browser.dispose();
});

test('folder navigation follows returned pages, preserves file rows, and goes back to the actual parent', async () => {
    const requests = [];
    const browser = createReadiveDestinationBrowser({ requestPage: async value => {
        requests.push(value);
        return value.parentId === null ? page(null, [folder('Shelf'), file('Root.txt')]) : page('Shelf', [file('Child.txt')]);
    } });
    browser.setDevice('phone', true); await tick();
    browser.open('Shelf');
    assert.equal(browser.getSnapshot().selection, null);
    await tick();
    assert.deepEqual(browser.getSnapshot().selection, { deviceId: 'phone', collectionId: 'Shelf', name: 'Phone / Shelf', revision: 'rev-1' });
    assert.deepEqual(browser.getSnapshot().page.entries.map(entry => entry.id), ['Child.txt']);
    browser.back();
    assert.equal(browser.getSnapshot().selection, null);
    await tick();
    assert.deepEqual(requests.map(value => value.parentId), [null, 'Shelf', null]);
    assert.deepEqual(browser.getSnapshot().selection, { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev-1' });
    browser.dispose();
});

test('device switch, offline state and disposal ignore late success and failure', async () => {
    for (const mode of ['switch', 'offline', 'dispose']) {
        for (const outcome of ['success', 'failure']) {
            const pending = [];
            const browser = createReadiveDestinationBrowser({ requestPage: value => new Promise((resolve, reject) => pending.push({ value, resolve, reject })) });
            browser.setDevice('first', true);
            if (mode === 'switch') browser.setDevice('second', true);
            else if (mode === 'offline') browser.setDevice('first', false);
            else browser.dispose();
            if (outcome === 'success') pending[0].resolve(page(null, [file('Stale.txt')]));
            else pending[0].reject(new Error('offline'));
            await tick();
            assert.equal(browser.getSnapshot().page, null, `${mode}/${outcome}`);
            assert.equal(browser.getSnapshot().error, false);
            assert.equal(browser.getSnapshot().selection, null);
            if (mode === 'switch') {
                pending[1].resolve(page()); await tick();
                assert.equal(browser.getSnapshot().selection.deviceId, 'second');
            }
            browser.dispose();
        }
    }
});

test('refresh failure invalidates the selected destination and retry reloads the first page', async () => {
    let calls = 0;
    const browser = createReadiveDestinationBrowser({ requestPage: async () => {
        if (++calls === 2) throw new Error('offline');
        return page(null, [folder('Shelf')], null, `rev-${calls}`);
    } });
    browser.setDevice('phone', true); await tick();
    browser.refresh(); assert.equal(browser.getSnapshot().selection, null); await tick();
    assert.equal(browser.getSnapshot().error, true);
    assert.equal(browser.getSnapshot().selection, null);
    browser.refresh(); await tick();
    assert.equal(browser.getSnapshot().selection.revision, 'rev-3');
    browser.dispose();
});

test('pagination keeps previous rows, detects repeated cursors and prevents selecting incomplete failed pages', async () => {
    let repeat = false;
    const browser = createReadiveDestinationBrowser({ requestPage: async ({ cursor }) => cursor
        ? page(null, [file('Book.txt'), folder('Next')], repeat ? cursor : null)
        : page(null, [file('Book.txt')], 'page-2') });
    browser.setDevice('phone', true); await tick();
    browser.more(); browser.more();
    assert.equal(browser.getSnapshot().selection, null);
    await tick();
    assert.deepEqual(browser.getSnapshot().page.entries.map(entry => entry.id), ['Book.txt', 'Next']);
    assert.deepEqual(browser.getSnapshot().selection, { deviceId: 'phone', collectionId: null, name: 'Phone', revision: 'rev-1' });
    repeat = true; browser.refresh(); await tick(); browser.more(); await tick();
    assert.equal(browser.getSnapshot().error, true);
    assert.equal(browser.getSnapshot().selection, null);
    browser.dispose();
});

test('a changed directory revision cannot be merged with an older page', async () => {
    const browser = createReadiveDestinationBrowser({ requestPage: async ({ cursor }) => page(null, [folder(cursor ? 'New' : 'Old')], cursor ? null : 'page-2', cursor ? 'new-revision' : 'old-revision') });
    browser.setDevice('phone', true); await tick(); browser.more(); await tick();
    assert.equal(browser.getSnapshot().error, true);
    assert.equal(browser.getSnapshot().selection, null);
    browser.dispose();
});

test('loaded destinations are cleared immediately on device changes and offline transitions', async () => {
    const pending = [];
    const browser = createReadiveDestinationBrowser({ requestPage: value => new Promise(resolve => pending.push({ value, resolve })) });
    browser.setDevice('phone', true);
    pending[0].resolve(page()); await tick();
    assert.equal(browser.getSnapshot().selection.deviceId, 'phone');
    browser.setDevice('tablet', true);
    assert.equal(browser.getSnapshot().selection, null);
    pending[1].resolve(page()); await tick();
    assert.equal(browser.getSnapshot().selection.deviceId, 'tablet');
    browser.setDevice('tablet', false);
    assert.equal(browser.getSnapshot().selection, null);
    assert.equal(browser.getSnapshot().page, null);
    browser.dispose();
});

test('invalid returned pages cannot become automatically selected destinations', async () => {
    for (const result of [page('unexpected-parent'), { ...page(), revision: '' }, { ...page(), entries: [folder('duplicate'), folder('duplicate')] }]) {
        const browser = createReadiveDestinationBrowser({ requestPage: async () => result });
        browser.setDevice('phone', true); await tick();
        assert.equal(browser.getSnapshot().error, true);
        assert.equal(browser.getSnapshot().loading, false);
        assert.equal(browser.getSnapshot().selection, null);
        browser.dispose();
    }
});
