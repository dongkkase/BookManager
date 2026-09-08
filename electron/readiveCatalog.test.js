import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const prefix = '/readive/v1';

async function fixture(t) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-catalog-')));
    const root = path.join(directory, 'Books');
    await fs.mkdir(root);
    const configured = [{ path: root, alias: 'My books' }];
    const service = new ReadiveService({ directory: path.join(directory, 'state'), interfaces: () => [local], getRegisteredLibraries: () => configured });
    service.localInterface = local;
    service.port = 19421;
    service.server = {};
    service.certificateSha256 = 'a'.repeat(64);
    t.after(async () => {
        service.scanController?.abort();
        await Promise.all([...service.preparations.values()].map(preparation => preparation.promise));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const api = async (route, { method = 'GET', body, token = pairedToken } = {}) => {
        const url = new URL(`${prefix}${route}`, 'https://readive.invalid');
        return (await service.dispatch({ method, pathname: url.pathname, query: url.searchParams, body, token, remoteAddress: '192.168.5.20', localAddress: local.address })).json;
    };
    const ticket = JSON.parse((await service.pairing()).ticket);
    let pairedToken;
    pairedToken = (await api('/pair', { method: 'POST', token: '', body: { secret: ticket.secret, deviceId: 'test-phone', deviceName: 'Phone' } })).token;
    const libraryId = (await service.status()).libraries[0].id;
    const prepare = async paths => {
        const result = await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths } });
        const initial = await api(`/libraries/${libraryId}/preparations/${result.scanId}`);
        assert.ok(['scanning', 'ready', 'failed'].includes(initial.state));
        await service.preparations.get(result.scanId).promise;
        return { scanId: result.scanId, ...await api(`/libraries/${libraryId}/preparations/${result.scanId}`) };
    };
    return { directory, root, configured, service, api, libraryId, prepare };
}

test('Readive catalog automatically exposes registered supported paths only to paired devices', async t => {
    const { directory, root, configured, service, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    await fs.writeFile(path.join(root, 'unsupported.wma'), 'no');
    await fs.mkdir(path.join(root, 'Nested'));
    await fs.writeFile(path.join(directory, 'outside.txt'), 'private');
    await fs.symlink(path.join(directory, 'outside.txt'), path.join(root, 'link.txt'));
    await assert.rejects(api('/libraries', { token: 'a'.repeat(43) }), /unauthorized/);
    await assert.rejects(api(`/libraries/${libraryId}/entries`, { token: '' }), /unauthorized/);
    await assert.rejects(api(`/libraries/${libraryId}/prepare`, { method: 'POST', token: '', body: { paths: [''] } }), /unauthorized/);
    assert.deepEqual(await api('/libraries'), { libraries: [{ id: libraryId, name: 'My books' }] });
    const listed = await api(`/libraries/${libraryId}/entries?path=`);
    assert.deepEqual(listed.entries.map(entry => entry.name), ['Nested', 'one.txt']);
    assert.equal(listed.entries[0].size, null);
    assert.equal(listed.entries[0].format, null);
    assert.equal(listed.entries[1].format, 'txt');
    assert.equal(JSON.stringify(listed).includes(root), false);
    for (const value of ['../outside.txt', '/outside.txt', 'Nested/../one.txt', 'link.txt', 'Nested\\x', '.git/config']) {
        await assert.rejects(api(`/libraries/${libraryId}/entries?path=${encodeURIComponent(value)}`), /invalid_library_path|source_changed/);
    }
    await assert.rejects(api(`/libraries/${libraryId}/entries?path=&path=Nested`), /query_not_allowed/);
    await assert.rejects(api(`/libraries/${'0'.repeat(32)}/entries`), /library_unavailable/);
    const restored = new ReadiveService({ directory: path.join(directory, 'state'), getRegisteredLibraries: () => configured });
    assert.equal((await restored.status()).libraries[0].shared, true);
    configured.splice(0);
    assert.deepEqual(await api('/libraries'), { libraries: [] });
    await assert.rejects(api(`/libraries/${libraryId}/entries`), /library_unavailable/);
});

test('Readive ignores legacy library selection and follows all registered library additions and removals', async t => {
    const { directory, configured, service, api, libraryId } = await fixture(t);
    await service.store.transact(state => { state.sharedLibraries = [{ libraryId }]; });
    const secondPath = path.join(directory, 'More books');
    await fs.mkdir(secondPath);
    await fs.writeFile(path.join(secondPath, 'two.txt'), 'two');
    configured.push({ path: secondPath, alias: 'More books' });
    const registered = (await service.status()).libraries;
    const secondId = registered.find(library => library.path === secondPath).id;
    assert.equal(registered.every(library => library.shared), true);
    const allLibraries = { libraries: [
        { id: libraryId, name: 'My books' },
        { id: secondId, name: 'More books' },
    ] };
    assert.deepEqual(await api('/libraries'), allLibraries);
    assert.equal((await api(`/libraries/${secondId}/entries`)).entries[0].name, 'two.txt');
    await service.setLibraries({ libraryIds: [] });
    assert.deepEqual(await api('/libraries'), allLibraries);
    await service.store.transact(state => { state.sharedLibraries = []; });
    assert.deepEqual(await api('/libraries'), allLibraries);
    const restored = new ReadiveService({ directory: path.join(directory, 'state'), getRegisteredLibraries: () => configured });
    assert.equal((await restored.status()).libraries.length, 2);
    configured.splice(0, 1);
    assert.deepEqual(await api('/libraries'), { libraries: [{ id: secondId, name: 'More books' }] });
    await assert.rejects(api(`/libraries/${libraryId}/entries`), /library_unavailable/);
});

test('Readive catalog pages survive idle time while binding the library, parent and directory contents', async t => {
    const { directory, root, configured, api, libraryId, service } = await fixture(t);
    await Promise.all(Array.from({ length: 205 }, (_, index) => fs.writeFile(path.join(root, `${index}.txt`), `${index}`)));
    await fs.mkdir(path.join(root, 'Nested'));
    const first = await api(`/libraries/${libraryId}/entries`);
    assert.equal(first.entries.length, 200);
    assert.ok(first.nextCursor);
    const second = await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(second.entries.length, 6);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.entries, ...second.entries].map(entry => entry.id)).size, 206);
    await assert.rejects(api(`/libraries/${libraryId}/entries?path=Nested&cursor=${encodeURIComponent(first.nextCursor)}`), /invalid_cursor/);
    await assert.rejects(api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor + 'a')}`), /invalid_cursor/);
    const otherRoot = path.join(directory, 'Other books');
    await fs.mkdir(otherRoot);
    configured.push({ path: otherRoot });
    const otherLibraryId = (await service.status()).libraries.find(library => library.path === otherRoot).id;
    await assert.rejects(api(`/libraries/${otherLibraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`), /invalid_cursor/);
    for (const elapsed of [11 * 60 * 1000, 24 * 60 * 60 * 1000]) {
        service.now = () => Date.now() + elapsed;
        assert.deepEqual(await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`), second);
    }
    const legacyPayload = Buffer.from(JSON.stringify({
        ...JSON.parse(Buffer.from(first.nextCursor.split('.')[0], 'base64url')),
        expiresAt: Date.now() - 24 * 60 * 60 * 1000,
    })).toString('base64url');
    const legacyCursor = `${legacyPayload}.${crypto.createHmac('sha256', service.catalogSecret).update(legacyPayload).digest('base64url')}`;
    assert.deepEqual(await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(legacyCursor)}`), second);
    await fs.writeFile(path.join(root, 'new.txt'), 'new');
    await assert.rejects(api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`), /catalog_changed/);
    await assert.rejects(api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(legacyCursor)}`), /catalog_changed/);
});

test('Readive catalog cursors still require a registered library and an authorized device after idle time', async t => {
    const { root, configured, api, libraryId, service } = await fixture(t);
    await Promise.all(Array.from({ length: 201 }, (_, index) => fs.writeFile(path.join(root, `${index}.txt`), `${index}`)));
    const first = await api(`/libraries/${libraryId}/entries`);
    assert.ok(first.nextCursor);
    const nextPage = `/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`;
    service.now = () => Date.now() + 24 * 60 * 60 * 1000;
    const registered = configured.splice(0);
    await assert.rejects(api(nextPage), /library_unavailable/);
    configured.push(...registered);
    assert.equal((await api(nextPage)).entries.length, 1);
    await service.revoke({ deviceId: 'test-phone' });
    await assert.rejects(api(nextPage), /unauthorized/);
});

test('Readive catalog and job polling recover after a rejected reading request', async t => {
    const { root, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    await assert.rejects(api('/reading', { method: 'POST', body: { records: null } }), /invalid_reading_batch/);
    assert.deepEqual(await api('/jobs'), { jobs: [] });
    assert.equal((await api(`/libraries/${libraryId}/entries`)).entries[0].name, 'one.txt');
});

test('Readive mobile preparation preserves selected ancestry and still requires receiver acceptance', async t => {
    const { root, configured, service, api, libraryId, prepare } = await fixture(t);
    await fs.mkdir(path.join(root, 'A', 'Same'), { recursive: true });
    await fs.mkdir(path.join(root, 'B', 'Same'), { recursive: true });
    await fs.writeFile(path.join(root, 'A', 'Same', 'one.txt'), 'one');
    await fs.writeFile(path.join(root, 'B', 'Same', 'two.txt'), 'two');
    await fs.writeFile(path.join(root, 'excluded.txt'), 'excluded');
    const prepared = await prepare(['A/Same', 'B/Same']);
    assert.equal(prepared.state, 'ready');
    assert.equal(prepared.job.origin, 'mobile-browse');
    assert.equal(prepared.job.state, 'queued');
    assert.deepEqual(prepared.manifest.files.map(file => file.relativePath), ['Books/A/Same/one.txt', 'Books/B/Same/two.txt']);
    assert.deepEqual(prepared.manifest.directories.map(entry => entry.relativePath), ['Books', 'Books/A', 'Books/A/Same', 'Books/B', 'Books/B/Same']);
    const fileRoute = `/jobs/${prepared.job.id}/files/${prepared.manifest.files[0].id}`;
    await assert.rejects(api(fileRoute), /accept_required/);
    await api(`/jobs/${prepared.job.id}/accept`, { method: 'POST', body: { manifestId: prepared.manifest.id } });
    await api(fileRoute);
    await service.setLibraries({ libraryIds: [] });
    await api(fileRoute);
    const registered = configured.splice(0);
    await assert.rejects(api(fileRoute), /library_unavailable/);
    configured.push(...registered);
    await api(fileRoute);
    await service.cancel({ jobId: prepared.job.id });
    await assert.rejects(api(fileRoute), /job_cancelled/);
    const later = await prepare(['A/Same']);
    assert.notEqual(later.job.id, prepared.job.id);
    const cancelled = await api(`/libraries/${libraryId}/preparations/${later.scanId}/cancel`, { method: 'POST' });
    assert.equal(cancelled.success, true);
    assert.equal((await api(`/jobs/${later.job.id}`)).job.state, 'cancelled');
});

test('Readive binds existing transfers to their roots and rejects changed assets and cancelled scans', async t => {
    const { directory, root, api, libraryId, prepare, service } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    const prepared = await prepare(['']);
    await fs.writeFile(path.join(root, 'one.txt'), 'changed');
    await assert.rejects(api(`/jobs/${prepared.job.id}/accept`, { method: 'POST', body: { manifestId: prepared.manifest.id } }), /source_changed/);
    const pending = await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''] } });
    await api(`/libraries/${libraryId}/preparations/${pending.scanId}/cancel`, { method: 'POST' });
    await service.preparations.get(pending.scanId).promise;
    assert.deepEqual(await api(`/libraries/${libraryId}/preparations/${pending.scanId}`), { state: 'failed', error: 'scan_cancelled' });
    await fs.rename(root, path.join(directory, 'Moved'));
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'private.txt'), 'private');
    assert.deepEqual(await api('/libraries'), { libraries: [{ id: libraryId, name: 'My books' }] });
    await assert.rejects(api(`/jobs/${prepared.job.id}/accept`, { method: 'POST', body: { manifestId: prepared.manifest.id } }), /library_unavailable/);
    assert.equal((await api(`/libraries/${libraryId}/entries`)).entries[0].name, 'private.txt');
});

test('Readive mobile preparations cannot bypass soft and hard transfer limits', async t => {
    const { root, api, prepare } = await fixture(t);
    await Promise.all(Array.from({ length: 101 }, (_, index) => fs.writeFile(path.join(root, `${index}.txt`), `${index}`)));
    const prepared = await prepare(['']);
    assert.equal(prepared.state, 'ready');
    await assert.rejects(api(`/jobs/${prepared.job.id}/accept`, { method: 'POST', body: { manifestId: prepared.manifest.id } }), /large_confirmation_required/);
    await api(`/jobs/${prepared.job.id}/accept`, { method: 'POST', body: { manifestId: prepared.manifest.id, largeConfirmed: true } });
    await Promise.all(Array.from({ length: 901 }, (_, index) => fs.writeFile(path.join(root, `extra-${index}.txt`), `${index}`)));
    const blocked = await prepare(['']);
    assert.equal(blocked.state, 'failed');
    assert.equal(blocked.error, 'transfer_hard_limit');
});

test('Readive preparation IDs honor cancellation arriving before POST and replay without restarting scans', async t => {
    const { root, api, libraryId, service } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    const scanId = crypto.randomUUID();
    const preparationRoute = `/libraries/${libraryId}/preparations/${scanId}`;
    assert.deepEqual(await api(`${preparationRoute}/cancel`, { method: 'POST' }), { success: true });
    const started = await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId } });
    assert.equal(started.scanId, scanId);
    assert.deepEqual(await api(preparationRoute), { state: 'failed', error: 'scan_cancelled' });
    assert.equal(service.scanning, false);
    assert.equal((await api('/jobs')).jobs.length, 0);
    assert.equal((await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId } })).scanId, scanId);
    assert.equal(service.scanning, false);
    await assert.rejects(api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId: 'invalid' } }), /invalid_scan_id/);
});

test('Readive client preparation UUID is idempotent and scan deadlines stop stalled preparation', async t => {
    const { root, api, libraryId, service } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    const scanId = crypto.randomUUID();
    assert.equal((await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId } })).scanId, scanId);
    await service.preparations.get(scanId).promise;
    assert.equal((await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId } })).scanId, scanId);
    assert.equal((await api('/jobs')).jobs.length, 1);
    await assert.rejects(api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: ['one.txt'], scanId } }), /preparation_mismatch/);
    service.preparationTimeoutMs = 10;
    service.getLibraryDb = () => new Promise(resolve => setTimeout(() => resolve(null), 30));
    const timeoutId = crypto.randomUUID();
    await api(`/libraries/${libraryId}/prepare`, { method: 'POST', body: { paths: [''], scanId: timeoutId } });
    await service.preparations.get(timeoutId).promise;
    assert.deepEqual(await api(`/libraries/${libraryId}/preparations/${timeoutId}`), { state: 'failed', error: 'scan_timeout' });
    assert.equal(service.scanning, false);
});

test('Readive early cancellation tombstones are bounded and expire after the retention window', async t => {
    const { api, libraryId, service } = await fixture(t);
    for (let index = 0; index < 256; index += 1) {
        await api(`/libraries/${libraryId}/preparations/${crypto.randomUUID()}/cancel`, { method: 'POST' });
    }
    assert.equal(service.cancelledPreparations.size, 256);
    await assert.rejects(api(`/libraries/${libraryId}/preparations/${crypto.randomUUID()}/cancel`, { method: 'POST' }), /too_many_jobs/);
    service.now = () => Date.now() + 31 * 60 * 1000;
    service.prunePreparations();
    assert.equal(service.cancelledPreparations.size, 0);
    assert.deepEqual(await api(`/libraries/${libraryId}/preparations/${crypto.randomUUID()}/cancel`, { method: 'POST' }), { success: true });
});

test('Readive catalog pages stat only returned children and reuse one sorted directory snapshot', async t => {
    const { root, api, libraryId } = await fixture(t);
    await Promise.all(Array.from({ length: 601 }, (_, index) => fs.writeFile(path.join(root, `book-${index}.txt`), 'book')));
    const originalStat = fs.lstat;
    const originalOpen = fs.opendir;
    let childStats = 0;
    let scans = 0;
    fs.lstat = async function (file, ...args) {
        if (path.dirname(String(file)) === root) childStats += 1;
        return originalStat.call(this, file, ...args);
    };
    fs.opendir = async function (file, ...args) {
        if (String(file) === root) scans += 1;
        return originalOpen.call(this, file, ...args);
    };
    try {
        let page = await api(`/libraries/${libraryId}/entries`);
        assert.equal(page.entries.length, 200);
        assert.equal(childStats, 200, 'first response must not stat every child on a slow network volume');
        const entries = [...page.entries];
        while (page.nextCursor) {
            page = await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(page.nextCursor)}`);
            entries.push(...page.entries);
        }
        assert.equal(entries.length, 601);
        assert.equal(new Set(entries.map(entry => entry.id)).size, 601);
        assert.equal(childStats, 601);
        assert.equal(scans, 1);
    } finally { fs.lstat = originalStat; fs.opendir = originalOpen; }
});

test('Readive catalog deduplicates repeated SMB directory entries without repeating child work', async t => {
    const { root, api, libraryId } = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    await fs.mkdir(path.join(root, 'Nested'));
    const realEntries = await fs.readdir(root, { withFileTypes: true });
    const originalOpen = fs.opendir;
    fs.opendir = async function (file, ...args) {
        if (String(file) !== root) return originalOpen.call(this, file, ...args);
        return { async *[Symbol.asyncIterator]() { for (let round = 0; round < 7; round += 1) yield* realEntries; } };
    };
    try {
        const page = await api(`/libraries/${libraryId}/entries`);
        assert.deepEqual(page.entries.map(entry => entry.name), ['Nested', 'one.txt']);
        assert.equal(new Set(page.entries.map(entry => entry.id)).size, page.entries.length);
    } finally { fs.opendir = originalOpen; }
});

test('Readive catalog browses a large directory beyond the unchanged transfer scan limit', async t => {
    const { root, api, libraryId } = await fixture(t);
    let next = 0;
    await Promise.all(Array.from({ length: 24 }, async () => {
        for (;;) {
            const index = next++;
            if (index >= 10001) return;
            await fs.mkdir(path.join(root, `folder-${index}`));
        }
    }));
    const page = await api(`/libraries/${libraryId}/entries`);
    assert.equal(page.entries.length, 200);
    assert.ok(page.nextCursor);
    assert.equal(page.entries.every(entry => entry.kind === 'directory'), true);
});

test('Readive catalog raw enumeration remains bounded even when unsupported entries are repeated', async t => {
    const { root, api, libraryId } = await fixture(t);
    const originalOpen = fs.opendir;
    fs.opendir = async function (file, ...args) {
        if (String(file) !== root) return originalOpen.call(this, file, ...args);
        return { async *[Symbol.asyncIterator]() {
            for (let index = 0; index < 100001; index += 1) yield { name: 'unsupported.wma', isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
        } };
    };
    try { await assert.rejects(api(`/libraries/${libraryId}/entries`), /catalog_too_large/); }
    finally { fs.opendir = originalOpen; }
});

test('Readive compact cursors paginate long Korean paths within the native URL bound', async t => {
    const { root, api, libraryId } = await fixture(t);
    const relative = Array.from({ length: 15 }, (_, index) => `${'가'.repeat(40)}${index}`).join('/');
    const nested = path.join(root, ...relative.split('/'));
    await Promise.all(Array.from({ length: 201 }, (_, index) => fs.writeFile(path.join(root, `${index}.txt`), 'book')));
    const originalStat = fs.lstat;
    const originalOpen = fs.opendir;
    // macOS PATH_MAX cannot create this valid longer path locally, so only its filesystem lookup is mapped.
    fs.lstat = async function (file, ...args) {
        const name = String(file);
        if (name.startsWith(path.join(root, '가'))) return originalStat.call(this, name.endsWith('.txt') ? path.join(root, path.basename(name)) : root, ...args);
        return originalStat.call(this, file, ...args);
    };
    fs.opendir = async function (file, ...args) { return originalOpen.call(this, String(file) === nested ? root : file, ...args); };
    try {
        const first = await api(`/libraries/${libraryId}/entries?path=${encodeURIComponent(relative)}`);
        const route = `/libraries/${libraryId}/entries?path=${encodeURIComponent(relative)}&cursor=${encodeURIComponent(first.nextCursor)}`;
        assert.ok(Buffer.byteLength(`https://192.168.5.10:19421${prefix}${route}`) <= 8192, 'cursor must not repeat the raw parent path');
        assert.equal((await api(route)).entries.length, 1);
    } finally { fs.lstat = originalStat; fs.opendir = originalOpen; }
});

test('Readive snapshot pages refresh child sizes while content-only edits leave paging positions valid', async t => {
    const { root, api, libraryId, service } = await fixture(t);
    await Promise.all(Array.from({ length: 201 }, (_, index) => fs.writeFile(path.join(root, `book-${index}.txt`), 'old')));
    const first = await api(`/libraries/${libraryId}/entries`);
    await fs.writeFile(path.join(root, first.entries[0].name), 'changed earlier page');
    await fs.writeFile(path.join(root, 'book-200.txt'), 'updated next page');
    const second = await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(second.entries[0].size, Buffer.byteLength('updated next page'));
    service.catalogCache.clear();
    assert.deepEqual(await api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`), second, 'cache eviction must not expire an unchanged name snapshot');
    await fs.unlink(path.join(root, 'book-200.txt'));
    await fs.symlink(path.join(root, 'book-0.txt'), path.join(root, 'book-200.txt'));
    await assert.rejects(api(`/libraries/${libraryId}/entries?cursor=${encodeURIComponent(first.nextCursor)}`), /catalog_changed/);
});

test('Readive catalog retains in-flight scan accounting when cleared and bounds retained snapshots', async () => {
    const { ReadiveCatalogCache } = await import('./readive/catalog.js');
    const cache = new ReadiveCatalogCache({ maxPending: 1, maxSnapshots: 2, maxEntries: 2, maxBytes: 200 });
    const stat = { dev: 1, ino: 2, birthtimeMs: 3, mtimeMs: 4, ctimeMs: 5 };
    const value = { entries: [{ name: 'book', kind: 'file' }], signature: 'a'.repeat(64), bytes: 100 };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const held = cache.read('held', stat, async () => { await gate; return value; });
    await new Promise(resolve => setImmediate(resolve));
    cache.clear();
    await assert.rejects(cache.read('next', stat, async () => value), /catalog_busy/);
    release();
    await held;
    assert.equal(cache.pending.size, 0);
    assert.equal(cache.snapshots.size, 0, 'a scan started before clear must not repopulate the cache');
    for (const key of ['one', 'two', 'three']) await cache.read(key, stat, async () => value);
    assert.deepEqual([...cache.snapshots.keys()], ['two', 'three']);
});

test('Readive catalog cancels page work and holds request admission until every worker settles', async t => {
    const { root, api, libraryId, service } = await fixture(t);
    await Promise.all(Array.from({ length: 200 }, (_, index) => fs.writeFile(path.join(root, `book-${index}.txt`), 'book')));
    await api(`/libraries/${libraryId}/entries`);
    service.catalogCache.maxPending = 1;
    const { readReadiveLibraryEntries, validateReadiveLibrary } = await import('./readive/catalog.js');
    const { scope } = await validateReadiveLibrary(service.store.state, [root], libraryId);
    for (const mode of ['cancel', 'failure']) {
        const originalStat = fs.lstat;
        let release;
        let ready;
        let childStats = 0;
        let active = 0;
        let maximumActive = 0;
        const gate = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { ready = resolve; });
        const controller = new AbortController();
        fs.lstat = async function (file, ...args) {
            if (path.dirname(String(file)) !== root) return originalStat.call(this, file, ...args);
            childStats += 1;
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            if (childStats === 8) ready();
            try {
                if (mode === 'failure' && path.basename(String(file)) === 'book-0.txt') throw new Error('synthetic child failure');
                await gate;
                return await originalStat.call(this, file, ...args);
            } finally { active -= 1; }
        };
        const options = { secret: service.catalogSecret, cache: service.catalogCache, signal: controller.signal };
        try {
            const pending = readReadiveLibraryEntries(scope, '', '', options);
            const rejected = assert.rejects(pending, mode === 'cancel' ? /catalog_cancelled/ : /catalog_changed/);
            await started;
            if (mode === 'cancel') controller.abort();
            await assert.rejects(readReadiveLibraryEntries(scope, '', '', options.signal.aborted ? { ...options, signal: undefined } : options), /catalog_busy/);
            assert.equal(service.catalogCache.activeRequests.size, 1);
            release();
            await rejected;
            assert.equal(service.catalogCache.activeRequests.size, 0);
            assert.equal(childStats, 8, 'cancelled or failed pages must not continue reading the other children');
            assert.equal(maximumActive <= 8, true);
        } finally { release(); fs.lstat = originalStat; }
    }
});


test('Readive legacy content-signature cursors still validate old pages and reject stale file identities', async t => {
    const { root, api, libraryId, service } = await fixture(t);
    await Promise.all(Array.from({ length: 201 }, (_, index) => fs.writeFile(path.join(root, `${index}.txt`), 'old')));
    const { validateReadiveLibrary } = await import('./readive/catalog.js');
    const { scope } = await validateReadiveLibrary(service.store.state, [root], libraryId);
    const stat = await fs.lstat(root);
    const identities = await Promise.all((await fs.readdir(root)).map(async name => {
        const child = await fs.lstat(path.join(root, name));
        return [name, child.ino, child.dev, child.size, child.mtimeMs, child.ctimeMs];
    }));
    const signature = crypto.createHash('sha256').update(JSON.stringify({
        identity: { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs },
        mtime: stat.mtimeMs, ctime: stat.ctimeMs, identities: identities.sort((a, b) => a[0].localeCompare(b[0])),
    })).digest('hex');
    const payload = Buffer.from(JSON.stringify({ libraryId, approvalId: scope.approvalId, path: '', offset: 200, signature })).toString('base64url');
    const cursor = `${payload}.${crypto.createHmac('sha256', service.catalogSecret).update(payload).digest('base64url')}`;
    const route = `/libraries/${libraryId}/entries?cursor=${encodeURIComponent(cursor)}`;
    assert.equal((await api(route)).entries.length, 1);
    await fs.writeFile(path.join(root, '0.txt'), 'different content');
    await assert.rejects(api(route), /catalog_changed/);
});

test('Readive cancellation during path validation cannot start a fresh directory scan after clear', async t => {
    const { root, libraryId, service } = await fixture(t);
    const { readReadiveLibraryEntries, validateReadiveLibrary } = await import('./readive/catalog.js');
    const { scope } = await validateReadiveLibrary(service.store.state, [root], libraryId);
    const originalStat = fs.lstat;
    const originalOpen = fs.opendir;
    let release;
    let ready;
    let held = false;
    let scans = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { ready = resolve; });
    fs.lstat = async function (file, ...args) {
        if (String(file) === root && !held) { held = true; ready(); await gate; }
        return originalStat.call(this, file, ...args);
    };
    fs.opendir = async function (file, ...args) { scans += 1; return originalOpen.call(this, file, ...args); };
    try {
        const pending = readReadiveLibraryEntries(scope, '', '', { secret: service.catalogSecret, cache: service.catalogCache });
        const rejected = assert.rejects(pending, /catalog_cancelled/);
        await started;
        service.catalogCache.clear();
        release();
        await rejected;
        assert.equal(scans, 0);
        assert.equal(service.catalogCache.pending.size, 0);
    } finally { release(); fs.lstat = originalStat; fs.opendir = originalOpen; }
});
