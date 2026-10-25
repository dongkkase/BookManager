import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { LibraryDB } from './database/library_db.js';
import { readingListsRequest } from './readingLists.js';
import { buildOpdsApp } from './servers/opdsServer.js';

const atom = 'http://www.w3.org/2005/Atom';
const pse = 'http://vaemendis.net/opds-pse/ns';
const readDate = '2026-03-04T10:30:00.000Z';
const childReadDate = '2026-03-05T10:30:00.000Z';

function entries(xml) {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(document.getElementsByTagNameNS(atom, 'entry'));
}

function entryFor(xml, title) {
    const result = entries(xml).find(entry => entry.getElementsByTagNameNS(atom, 'title')[0]?.textContent.replace(/^⭘ /, '') === title);
    assert.ok(result, `Missing entry: ${title}`);
    return result;
}

function date(entry, field) {
    return entry.getElementsByTagNameNS(atom, field)[0]?.textContent || null;
}

function lastReadDate(entry) {
    return Array.from(entry.getElementsByTagNameNS(atom, 'link'))
        .find(link => link.getAttribute('rel') === 'subsection' || link.getAttribute('rel') === 'http://opds-spec.org/acquisition/open-access')
        ?.getAttributeNS(pse, 'lastReadDate') || null;
}

async function fixture(t, { withDb = true } = {}) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'opds-dates-')));
    const root = path.join(directory, 'Books');
    const folder = path.join(root, 'Series');
    const file = path.join(root, 'Read.txt');
    const unread = path.join(root, 'Unread.txt');
    const child = path.join(folder, 'Child.txt');
    const outside = path.join(directory, 'Private.txt');
    await fs.mkdir(folder, { recursive: true });
    for (const target of [file, unread, child, outside]) {
        await fs.writeFile(target, 'book');
        await fs.utimes(target, new Date('2025-01-02T00:00:00.000Z'), new Date('2025-01-02T00:00:00.000Z'));
    }
    const stats = new Map(await Promise.all([root, folder, file, unread, child].map(async target => [target, await fs.stat(target)])));
    const dbPath = path.join(directory, 'library.db');
    const db = withDb ? new LibraryDB({ dbPath }) : null;
    let collectionId;
    let collectionCreatedAt;
    if (db) {
        await db.replaceLibraryFolders(root, [
            { folder_path: root, parent_path: '', name: 'Books' },
            { folder_path: folder, parent_path: root, name: 'Series' },
        ]);
        for (const target of [file, unread, child, outside]) await db.upsertFileInfo({
            path: target, title: path.basename(target), ext: '.txt', genre: 'Fantasy', tags: 'Magic', size: 4,
        });
        db.getConnection().prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ?').run(new Date().toISOString(), new Date().toISOString());
        await db.upsertReadingState(file, { format: 'text', lastReadAt: readDate });
        await db.upsertReadingState(child, { format: 'text', lastReadAt: childReadDate });
        await db.upsertReadingState(outside, { format: 'text', lastReadAt: '2026-04-01T00:00:00.000Z' });
        collectionId = (await readingListsRequest(db, { operation: 'create', name: 'Weekend' })).id;
        collectionCreatedAt = db.getConnection().prepare('SELECT created_at FROM reading_lists WHERE id = ?').get(collectionId).created_at;
        for (const id of ['want-to-read', collectionId]) await readingListsRequest(db, { operation: 'add', id, paths: [file, folder, outside] });
    }
    const app = buildOpdsApp({ library_entries: [{ path: root, alias: 'Books' }] }, () => {}, withDb ? { dbPath } : {});
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (db) await db.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const read = async route => {
        const response = await fetch(base + route);
        assert.equal(response.status, 200, route);
        return response.text();
    };
    return { base, root, folder, file, unread, child, outside, stats, collectionId, collectionCreatedAt, read };
}

function assertDates(entry, stat, expectedLastRead) {
    assert.equal(date(entry, 'published'), new Date(stat.birthtimeMs).toISOString());
    assert.equal(date(entry, 'updated'), new Date(stat.mtimeMs).toISOString());
    assert.equal(lastReadDate(entry), expectedLastRead);
}

test('OPDS returns actual creation, modification and last-read dates for immediate entries only', async t => {
    const value = await fixture(t);
    const inspected = [];
    const stat = fs.stat;
    t.mock.method(fs, 'stat', async (...args) => { inspected.push(args[0]); return stat(...args); });
    const batches = [];
    const lookup = LibraryDB.prototype.listReadingStatesByPaths;
    t.mock.method(LibraryDB.prototype, 'listReadingStatesByPaths', async function (paths) {
        batches.push(paths);
        return lookup.call(this, paths);
    });
    const xml = await value.read(`/opds?dir=${encodeURIComponent(value.root)}`);
    assertDates(entryFor(xml, 'Read.txt'), value.stats.get(value.file), readDate);
    assertDates(entryFor(xml, 'Unread.txt'), value.stats.get(value.unread), null);
    assertDates(entryFor(xml, 'Series'), value.stats.get(value.folder), childReadDate);
    assert.equal(xml.includes('Child.txt'), false);
    assert.equal(xml.includes('Private.txt'), false);
    assert.equal(inspected.includes(value.child), false, 'Folder dates do not stat descendants');
    assert.equal(batches.length, 1);
    assert.deepEqual([...batches[0]].sort(), [value.file, value.unread].sort());
});

test('OPDS root folders carry dates without fabricating dates for virtual lists', async t => {
    const value = await fixture(t);
    const xml = await value.read('/opds');
    assertDates(entryFor(xml, 'Books'), value.stats.get(value.root), childReadDate);
    const recent = entryFor(xml, '최근 읽음');
    assert.equal(date(recent, 'published'), null);
    assert.equal(lastReadDate(recent), null);
});

test('OPDS reading lists, collection contents and tag results preserve the same dates and shared scope', async t => {
    const value = await fixture(t);
    for (const route of ['/opds?list=recent-reading', '/opds?list=recent-added', '/opds?list=want-to-read', `/opds?list=collections&collection=${value.collectionId}`]) {
        const xml = await value.read(route);
        assert.ok(xml.includes('Read.txt'), `${route}: ${xml}`);
        assertDates(entryFor(xml, 'Read.txt'), value.stats.get(value.file), readDate);
        assert.equal(xml.includes('Private.txt'), false);
        if (route.includes('want-to-read') || route.includes('collection=')) {
            assertDates(entryFor(xml, 'Series'), value.stats.get(value.folder), childReadDate);
        }
    }
    const collections = await value.read('/opds?list=collections');
    assert.equal(date(entryFor(collections, 'Weekend'), 'published'), value.collectionCreatedAt);
    assert.equal(lastReadDate(entryFor(collections, 'Weekend')), childReadDate);
    const response = await fetch(`${value.base}/opds/tags?dir=${encodeURIComponent(value.root)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { genres: ['fantasy'], tags: ['magic'], match: 'all' } }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assertDates(entryFor(result.feed, 'Read.txt'), value.stats.get(value.file), readDate);
    assertDates(entryFor(result.feed, 'Child.txt'), value.stats.get(value.child), childReadDate);
    assertDates(entryFor(result.feed, 'Unread.txt'), value.stats.get(value.unread), null);
    assert.equal(result.feed.includes('Private.txt'), false);
});

test('OPDS filesystem fallback exposes creation dates and omits unknown reading dates', async t => {
    const value = await fixture(t, { withDb: false });
    const xml = await value.read(`/opds?dir=${encodeURIComponent(value.root)}`);
    assertDates(entryFor(xml, 'Read.txt'), value.stats.get(value.file), null);
    assertDates(entryFor(xml, 'Series'), value.stats.get(value.folder), null);
});
