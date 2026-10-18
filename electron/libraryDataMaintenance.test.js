import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { ContentIndexDB } from './database/content_index_db.js';
import { createLibraryDataMaintenance } from './libraryDataMaintenance.js';

async function fixture(t, { seed = true } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-library-maintenance-'));
    const dbPath = path.join(root, 'data', 'library.db');
    const contentIndexDbPath = path.join(root, 'data', 'content_index', 'content.db');
    const thumbnailDir = path.join(root, 'data', 'thumbnails');
    const libraryPath = path.join(root, 'registered-books');
    const outsidePath = path.join(root, 'outside-books');
    const library = new LibraryDB({ dbPath });
    const content = new ContentIndexDB({ dbPath: contentIndexDbPath });
    const changes = [];
    const errors = [];
    const instances = [];
    const value = {
        root, dbPath, contentIndexDbPath, thumbnailDir, libraryPath, outsidePath,
        library, content, changes, errors,
        start(options = {}) {
            const instance = createLibraryDataMaintenance({
                dbPath, contentIndexDbPath, thumbnailDir,
                getLibraryPaths: () => [libraryPath],
                onChanged: result => changes.push(result),
                onError: error => errors.push(error),
                ...options,
            });
            instances.push(instance);
            return instance;
        },
    };
    t.after(async () => {
        for (const instance of instances) await instance.dispose();
        await content.close();
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    if (!seed) return value;
    await Promise.all([thumbnailDir, libraryPath, outsidePath].map(directory => fs.mkdir(directory, { recursive: true })));
    for (const [kind, directory, character] of [['inside', libraryPath, 'a'], ['outside', outsidePath, 'b']]) {
        const filePath = path.join(directory, `${kind}.epub`);
        const coverPath = path.join(thumbnailDir, `${character.repeat(32)}.png`);
        await fs.writeFile(filePath, `${kind} original book`);
        await fs.writeFile(coverPath, `${kind} managed cover`);
        await library.upsertFileInfo({ path: filePath, title: `${kind} title`, thumb_path: coverPath });
        await library.upsertReadingState(filePath, { format: 'epub', pageIndex: 3, pageCount: 10 });
        await content.upsertDocumentTokens({ path: filePath, library_path: directory, status: 'ready' }, `${kind}word`);
        value[kind] = { filePath, coverPath };
    }
    return value;
}

function indexedPaths(value) {
    return value.content.getConnection().prepare('SELECT path FROM documents ORDER BY path').all().map(row => row.path);
}

test('unknown library configuration skips maintenance without creating databases', async t => {
    const value = await fixture(t, { seed: false });
    let linkedCalls = 0;
    const maintenance = value.start({
        getLibraryPaths: () => null,
        pruneLinkedData: async () => { linkedCalls += 1; return { changes: 1 }; },
    });
    await maintenance.run();
    await maintenance.dispose();
    for (const file of [value.dbPath, value.contentIndexDbPath, value.thumbnailDir]) {
        await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    }
    assert.equal(linkedCalls, 0);
    assert.deepEqual(value.changes, []);
    assert.deepEqual(value.errors, []);
});

test('registered roots retain inside data while outside metadata, covers and content are removed', async t => {
    const value = await fixture(t);
    const outsideShared = path.join(value.outsidePath, 'shared.epub');
    await fs.writeFile(outsideShared, 'shared original book');
    await value.library.upsertFileInfo({ path: outsideShared, thumb_path: value.inside.coverPath });
    const maintenance = value.start();
    await maintenance.run();

    assert.equal((await value.library.getFileInfo(value.inside.filePath)).title, 'inside title');
    assert.equal(await value.library.getFileInfo(value.outside.filePath), null);
    assert.equal(await value.library.getFileInfo(outsideShared), null);
    assert.deepEqual((await value.library.listRecentReadingStates()).map(row => row.filePath), [value.inside.filePath]);
    assert.deepEqual(indexedPaths(value), [value.inside.filePath]);
    assert.equal(value.content.getConnection().prepare("SELECT COUNT(*) AS count FROM document_terms_fts WHERE document_terms_fts MATCH 'outsideword'").get().count, 0);
    assert.equal(await fs.readFile(value.inside.coverPath, 'utf8'), 'inside managed cover');
    await assert.rejects(fs.stat(value.outside.coverPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(value.inside.filePath, 'utf8'), 'inside original book');
    assert.equal(await fs.readFile(value.outside.filePath, 'utf8'), 'outside original book');
    assert.equal(await fs.readFile(outsideShared, 'utf8'), 'shared original book');
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].deletedFileCount, 2);
    assert.deepEqual(value.errors, []);

    await maintenance.run();
    assert.equal(value.changes.length, 1, 'an unchanged rerun does not emit another change');
});

test('a trusted empty library list removes app data while keeping both original books', async t => {
    const value = await fixture(t);
    const maintenance = value.start({ getLibraryPaths: () => [] });
    await maintenance.run();
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM reading_states').get().count, 0);
    assert.deepEqual(indexedPaths(value), []);
    for (const kind of ['inside', 'outside']) {
        await assert.rejects(fs.stat(value[kind].coverPath), { code: 'ENOENT' });
        assert.equal(await fs.readFile(value[kind].filePath, 'utf8'), `${kind} original book`);
    }
    assert.equal(value.changes.length, 1);
    assert.deepEqual(value.errors, []);
});

test('a root change requested during maintenance is rerun with the latest trusted roots', async t => {
    const value = await fixture(t);
    let roots = [value.libraryPath];
    let queued;
    let maintenance;
    maintenance = value.start({
        getLibraryPaths: () => roots,
        onChanged: result => {
            value.changes.push(result);
            if (value.changes.length === 1) {
                roots = [];
                queued = maintenance.run();
            }
        },
    });
    const first = maintenance.run();
    await first;
    assert.equal(queued, first);
    assert.equal(value.changes.length, 2);
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
    assert.deepEqual(indexedPaths(value), []);
    assert.equal(await fs.readFile(value.inside.filePath, 'utf8'), 'inside original book');
    assert.deepEqual(value.errors, []);
});

test('concurrent overview reads share maintenance without scheduling another full pass', async t => {
    const value = await fixture(t);
    let started;
    let release;
    let linkedCalls = 0;
    const entered = new Promise(resolve => { started = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const maintenance = value.start({
        pruneLinkedData: async () => {
            linkedCalls += 1;
            started();
            await wait;
        },
    });
    const running = maintenance.run();
    await entered;
    const reads = Array.from({ length: 10 }, () => maintenance.run({ repeatIfRunning: false }));
    assert.ok(reads.every(request => request === running));
    release();
    await Promise.all(reads);
    assert.equal(linkedCalls, 1);
    assert.equal(value.changes.length, 1);
    assert.deepEqual(value.errors, []);
});

test('dispose waits for final cleanup and later runs cannot remove newly added data', async t => {
    const value = await fixture(t);
    const maintenance = value.start();
    const running = maintenance.run();
    await maintenance.dispose();
    await running;
    assert.equal(await value.library.getFileInfo(value.outside.filePath), null);
    assert.equal(value.changes.length, 1);

    await value.library.upsertFileInfo({ path: value.outside.filePath, title: 'new data after disposal' });
    await maintenance.run();
    await maintenance.dispose();
    assert.equal((await value.library.getFileInfo(value.outside.filePath)).title, 'new data after disposal');
    assert.equal(value.changes.length, 1);
    assert.deepEqual(value.errors, []);
});

test('linked data cleanup receives trusted roots and can trigger a change by itself', async t => {
    const value = await fixture(t);
    const linkedCalls = [];
    const roots = [value.libraryPath, value.outsidePath];
    const maintenance = value.start({
        getLibraryPaths: () => roots,
        pruneLinkedData: async libraries => {
            linkedCalls.push([...libraries]);
            return { changes: linkedCalls.length === 1 ? 1 : 0 };
        },
    });
    await maintenance.run();
    assert.deepEqual(linkedCalls, [roots]);
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].changes, 0, 'only linked data changed');
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 2);
    assert.equal(indexedPaths(value).length, 2);
    assert.deepEqual(value.errors, []);
});

test('a linked cleanup failure still reports completed local cleanup and its change', async t => {
    const value = await fixture(t);
    const failure = new Error('linked cleanup unavailable');
    const maintenance = value.start({ pruneLinkedData: async () => { throw failure; } });
    await maintenance.run();
    assert.equal(await value.library.getFileInfo(value.outside.filePath), null);
    assert.equal((await value.library.getFileInfo(value.inside.filePath)).title, 'inside title');
    assert.deepEqual(indexedPaths(value), [value.inside.filePath]);
    await assert.rejects(fs.stat(value.outside.coverPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(value.outside.filePath, 'utf8'), 'outside original book');
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].deletedFileCount, 1);
    assert.deepEqual(value.errors, [failure]);
});

test('content-only cleanup preserves Unicode library paths across macOS normalization forms', async t => {
    const value = await fixture(t, { seed: false });
    const libraryPath = path.join(value.root, '한글 서재').normalize('NFC');
    const registeredRoot = process.platform === 'darwin' ? libraryPath.normalize('NFD') : libraryPath;
    const inside = path.join(libraryPath, '가나다.epub').normalize('NFC');
    const outside = path.join(value.root, '다른 서재', '외부.epub').normalize('NFC');
    for (const filePath of [inside, outside]) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, 'original Unicode book');
        await value.content.upsertDocumentTokens({ path: filePath, library_path: path.dirname(filePath), status: 'ready' },
            filePath === inside ? 'retainedunicode' : 'removedunicode');
    }
    const maintenance = value.start({ getLibraryPaths: () => [registeredRoot] });
    await maintenance.run();
    assert.deepEqual(indexedPaths(value), [inside]);
    assert.equal(value.content.getConnection().prepare("SELECT COUNT(*) AS count FROM document_terms_fts WHERE document_terms_fts MATCH 'removedunicode'").get().count, 0);
    assert.equal(value.changes.length, 1);
    assert.equal(value.changes[0].changes, 0, 'content index changes alone must emit the change event');
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
    for (const filePath of [inside, outside]) assert.equal(await fs.readFile(filePath, 'utf8'), 'original Unicode book');
    assert.deepEqual(value.errors, []);
    await maintenance.run();
    assert.equal(value.changes.length, 1);
});

test('concurrent library scope saves wait for the preceding cleanup before applying each scope', async t => {
    const value = await fixture(t, { seed: false });
    let roots = [value.libraryPath];
    let release;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const observed = [];
    const maintenance = value.start({
        getLibraryPaths: () => roots,
        pruneLinkedData: async libraries => {
            observed.push([...libraries]);
            if (observed.length === 1) { started(); await held; }
        },
    });
    const running = maintenance.run();
    await entered;
    const saves = [[value.outsidePath], []].map(next => maintenance.withIdle(() => {
        roots = next;
        return maintenance.run();
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(roots, [value.libraryPath]);
    release();
    await Promise.all([running, ...saves]);
    assert.deepEqual(observed, [[value.libraryPath], [value.outsidePath], []]);
    assert.deepEqual(value.errors, []);
});
