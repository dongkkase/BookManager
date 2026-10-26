import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { listZipEntries, readZipEntry, replaceZipEntry } from '../core/zipArchive.js';
import { parseComicInfo, saveMetadataItems, writeArchiveRating } from '../tasks/metadataTask.js';
import { createBookManagerComicRuntime } from './bookManagerComicRuntime.mjs';
import { createReadiveComicRuntime } from './readiveComicRuntime.mjs';

// This opt-in test needs both checkouts; ordinary BookManager tests remain independent of Readive.
const readiveRoot = path.resolve(process.argv[2] || fileURLToPath(new URL('../../../Readive/', import.meta.url)));
await fs.access(path.join(readiveRoot, 'src/library/comicMetadataXml.ts'));
const page = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const originalXml = '<ComicInfo xmlns:custom="urn:roundtrip"><Title>Old</Title><CommunityRating>2</CommunityRating>'
    + '<Pages><Page Image="0" Type="FrontCover" Bookmark="Chapter 1" custom:flag="keep"/></Pages>'
    + '<custom:Extra>Preserved extension</custom:Extra></ComicInfo>';
const legacyBook = '<ComicBook><Title>Stale</Title><Writer>Stale writer</Writer><CommunityRating>5</CommunityRating>'
    + '<Manga>YesAndRightToLeft</Manga><Rating>1</Rating><CurrentPage>7</CurrentPage></ComicBook>';
const legacyComet = '<comet><title>Stale</title><readingDirection>rtl</readingDirection><rating>Teen</rating></comet>';
const fullMetadata = {
    Title: '샘플 & <문자> "책"', Series: 'Series', Number: '001AU', Count: '12', Volume: '3',
    AlternateSeries: 'Alternate', AlternateNumber: '02B', AlternateCount: '4',
    Summary: 'First line\nLiteral &lt;b&gt; and &#x110000;', Notes: 'Notes & more',
    Year: '2026', Month: '10', Day: '26', Writer: '글 작가, 共同作者', Penciller: 'Artist',
    Inker: 'Inker', Colorist: 'Colorist', Letterer: 'Letterer', CoverArtist: 'Cover artist',
    Editor: 'Editor', Translator: 'Translator', Publisher: 'Publisher', Imprint: 'Imprint',
    Genre: 'Fantasy, Adventure', Tags: 'Tag one, Tag two', Web: 'https://example.invalid/book?a=1&b=2',
    PageCount: '2', LanguageISO: 'ko', Format: 'Manga', BlackAndWhite: 'Yes', Manga: 'YesAndRightToLeft',
    Characters: 'Hero, Other', Teams: 'Team', Locations: 'City', ScanInformation: 'Scan source',
    StoryArc: 'Arc', StoryArcNumber: '01A', SeriesGroup: 'Group', AgeRating: '15세 이용가',
    CommunityRating: '9', MainCharacterOrTeam: 'Hero team', Review: 'Review text', GTIN: '9780306406157',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, entries = { 'ComicInfo.xml': originalXml, 'ComicBook.xml': legacyBook, 'CoMet.xml': legacyComet }) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-readive-flow-')));
    const libraryRoot = path.join(directory, 'library');
    await fs.mkdir(libraryRoot);
    const filePath = path.join(libraryRoot, 'sample.cbz');
    await fs.writeFile(filePath, Buffer.alloc(0));
    for (const [name, content] of Object.entries({ ...entries, '001.png': page, '002.png': page })) {
        await replaceZipEntry(filePath, name, content);
    }
    const sql = new DatabaseSync(':memory:');
    sql.exec('CREATE TABLE files (path TEXT PRIMARY KEY, record TEXT NOT NULL)');
    const libraryDb = {
        dbPath: ':memory:',
        async getFileInfo(file) {
            const row = sql.prepare('SELECT record FROM files WHERE path = ?').get(file);
            return row ? JSON.parse(row.record) : null;
        },
        async upsertFileInfo(record) {
            sql.prepare('INSERT INTO files VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET record = excluded.record')
                .run(record.path, JSON.stringify(record));
        },
        async setFileRating() { throw new Error('These tests must not write a desktop personal rating.'); },
    };
    const desktop = await createBookManagerComicRuntime({ directory: path.join(directory, 'service'), libraryRoot, libraryDb });
    const readers = [];
    t.after(async () => {
        for (const reader of readers) reader.close();
        await desktop.close();
        sql.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    const save = async metadata => {
        const result = await saveMetadataItems([{ filepath: filePath, metadata }], { libraryDb });
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.stats.success.length, 1);
    };
    const archive = async () => {
        const bytes = await fs.readFile(filePath);
        const index = listZipEntries(bytes);
        return { bytes, index, read: name => readZipEntry(bytes, index.find(entry => entry.name === name)) };
    };
    const open = async archivePath => {
        const runtime = await createReadiveComicRuntime({ readiveRoot, archivePath });
        readers.push(runtime);
        return runtime;
    };
    const transfer = async () => {
        const packet = await desktop.download('sample.cbz');
        assert.equal(packet.status, 200);
        assert.equal(packet.file.metadata, null, 'CBZ metadata comes from its XML, not a separate text-book JSON asset');
        assert.equal(digest(packet.bytes), packet.file.sha256);
        assert.deepEqual(packet.bytes, await fs.readFile(filePath));
        const receivedPath = path.join(directory, `received-${readers.length}.cbz`);
        await fs.writeFile(receivedPath, packet.bytes);
        const reader = await open(receivedPath);
        assert.deepEqual(reader.getImportedBytes(), packet.bytes);
        const manifest = reader.parseManifest(packet.manifest);
        const file = manifest.files.find(candidate => candidate.id === packet.file.id);
        assert.ok(file);
        const preview = reader.parseEntryPreview(packet.preview, 'sample.cbz');
        await reader.saveTransfer(file);
        return { reader, packet: { ...packet, manifest, file, preview } };
    };
    return { filePath, libraryDb, desktop, save, archive, open, transfer };
}

for (const rating of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`desktop ${rating}/10 → XML ${rating / 2}/5 → local import, preview, transfer and rating sync stay ${rating}/10`, async t => {
        const h = await fixture(t);
        await h.save({ Title: 'Rating test', CommunityRating: String(rating), Manga: 'No' });
        const saved = await h.archive();
        assert.match(saved.read('ComicInfo.xml').toString(), new RegExp(`<CommunityRating>${rating / 2}</CommunityRating>`));
        assert.equal(parseComicInfo(saved.read('ComicInfo.xml').toString()).CommunityRating, String(rating));
        assert.equal((await h.libraryDb.getFileInfo(h.filePath)).rating, String(rating));
        const local = await h.open(h.filePath);
        assert.equal((await local.getDetail()).rating, String(rating));
        const { reader, packet } = await h.transfer();
        assert.equal(String(packet.preview.metadata.CommunityRating), String(rating));
        assert.equal(reader.previewDetail(packet.preview.metadata).rating, String(rating));
        assert.equal((await reader.getDetail()).rating, String(rating));
        const reply = await h.desktop.pullRating(packet.file);
        assert.equal(reply.rating, rating);
        await reader.applyRatingReply(reply);
        for (let repeat = 0; repeat < 3; repeat += 1) {
            reader.clearMemoryCache();
            assert.equal((await reader.getDetail()).rating, String(rating));
            assert.equal((await reader.getStoredDetail()).rating, String(rating));
        }
        assert.equal(reader.getPersistedDetail().comicMetadata.CommunityRating, String(rating));
        assert.equal(await reader.getDirection(), 'ltr');
        assert.equal((await reader.resolveDirection({ globalDirection: 'rtl' })).preferredReadingDirection, 'ltr');
        await h.save({});
        assert.deepEqual((await h.archive()).bytes, saved.bytes, 'Unchanged re-save must not divide the rating again');
        assert.deepEqual(reader.warnings, []);
    });
}

test('all 43 fields, page annotations, extensions and legacy XML survive save and imported detail/cache/index', async t => {
    const h = await fixture(t);
    await h.save(fullMetadata);
    const saved = await h.archive();
    const xml = saved.read('ComicInfo.xml').toString();
    assert.match(xml, /<Page\b[^>]*Bookmark="Chapter 1"[^>]*custom:flag="keep"/);
    assert.match(xml, /<custom:Extra>Preserved extension<\/custom:Extra>/);
    assert.deepEqual(saved.read('ComicBook.xml'), Buffer.from(legacyBook));
    assert.deepEqual(saved.read('CoMet.xml'), Buffer.from(legacyComet));
    assert.deepEqual(saved.read('001.png'), page);
    const expected = { ...fullMetadata, AgeRating: 'MA15+' };
    const { reader, packet } = await h.transfer();
    const detail = await reader.getDetail();
    assert.equal(Object.keys(expected).length, 43);
    assert.deepEqual(detail.comicMetadata, expected);
    assert.equal(detail.title, expected.Title);
    assert.equal(detail.description, expected.Summary);
    assert.equal(detail.rating, '9');
    assert.equal(detail.ageRating, 'MA15+');
    assert.equal(detail.isbn, expected.GTIN);
    assert.equal(detail.publicationDate, '2026-10-26');
    assert.deepEqual(detail.authors, ['글 작가', '共同作者']);
    assert.ok(detail.creators.includes('Translator'));
    assert.equal(detail.pageCount, 2);
    assert.equal(reader.getPersistedDetail().comicMetadata.Translator, 'Translator');
    assert.deepEqual(reader.getIndexDetail().comicMetadata, expected);
    assert.match(reader.getSearchText(), /translator/i);
    assert.equal(packet.preview.metadata.Translator, undefined, 'Legacy preview payload may omit fields kept in the archive');
    assert.equal(await reader.getDirection(), 'rtl');
    assert.equal((await reader.resolveDirection({ globalDirection: 'ltr' })).effectiveReadingDirection, 'rtl');
    assert.equal((await reader.resolveDirection({ sessionOverride: 'ltr' })).effectiveReadingDirection, 'ltr');
    const streamed = await h.desktop.read('sample.cbz');
    assert.deepEqual(streamed.bytes, saved.bytes, 'Direct reader also sends unmodified archive bytes');
    reader.clearMemoryCache();
    assert.deepEqual((await reader.getDetail()).comicMetadata, expected);
    await h.save(fullMetadata);
    assert.deepEqual((await h.archive()).bytes, saved.bytes);
    assert.deepEqual(reader.warnings, []);
});

for (const [format, source, expectedDirection, expectedRating] of [
    ['ComicBook.xml', '<ComicBook><Title>Legacy</Title><Writer>Writer</Writer><Translator>Translator</Translator><CommunityRating>2</CommunityRating><Manga>YesAndRightToLeft</Manga><Rating>5</Rating><Pages><Page Image="0" Bookmark="Start"/></Pages></ComicBook>', 'rtl', '4'],
    ['CoMet.xml', '<comet><title>Legacy</title><writer>Writer</writer><writer>Other</writer><readingDirection>ltr</readingDirection><rating>Teen</rating><identifier>ISBN: 978-0-306-40615-7</identifier></comet>', 'ltr', null],
    ['CoMet.xml', '<comet><title>Legacy</title><readingDirection>rtl</readingDirection></comet>', 'rtl', null],
]) {
    test(`${format} ${expectedDirection} → desktop conversion → ComicInfo priority preserves values and direction`, async t => {
        const h = await fixture(t, { [format]: source });
        await h.save({});
        const saved = await h.archive();
        assert.deepEqual(saved.read(format), Buffer.from(source));
        const { reader } = await h.transfer();
        const detail = await reader.getDetail();
        assert.equal(detail.title, 'Legacy');
        assert.equal(detail.rating, expectedRating);
        assert.equal(await reader.getDirection(), expectedDirection);
        assert.equal((await reader.resolveDirection({ globalDirection: expectedDirection === 'ltr' ? 'rtl' : 'ltr' })).effectiveReadingDirection, expectedDirection);
        assert.ok(reader.counters.extractedEntries.includes('ComicInfo.xml'));
        assert.ok(!reader.counters.extractedEntries.includes(format));
        if (format === 'ComicBook.xml') {
            assert.equal(detail.comicMetadata.Translator, 'Translator');
            assert.match(saved.read('ComicInfo.xml').toString(), /Bookmark="Start"/);
        } else if (expectedDirection === 'ltr') {
            assert.equal(detail.ageRating, 'Teen');
            assert.equal(detail.isbn, '9780306406157');
            assert.deepEqual(detail.authors, ['Writer', 'Other']);
        }
        await h.save({});
        assert.deepEqual((await h.archive()).bytes, saved.bytes);
        assert.deepEqual(reader.warnings, []);
    });
}

test('unknown direction and cleared fields use ComicInfo alone; local personal ratings remain independent', async t => {
    const h = await fixture(t);
    await h.save({ Title: 'Preferred', Writer: '', CommunityRating: '4', Manga: 'Unknown' });
    const { reader, packet } = await h.transfer();
    assert.deepEqual((await reader.getDetail()).authors, []);
    assert.equal(await reader.getDirection(), null);
    assert.equal((await reader.resolveDirection({ globalDirection: 'rtl' })).effectiveReadingDirection, 'rtl');
    assert.equal((await reader.resolveDirection({ globalDirection: 'ltr' })).effectiveReadingDirection, 'ltr');
    await reader.applyRatingReply(await h.desktop.pullRating(packet.file));
    await reader.setRating(7);
    await reader.applyRatingReply(await h.desktop.pullRating(packet.file));
    reader.clearMemoryCache();
    assert.equal((await reader.getDetail()).rating, '7');
    assert.equal(reader.getPersistedDetail().comicMetadata.CommunityRating, '4');
    assert.deepEqual(reader.getImportedBytes(), (await h.archive()).bytes);
    assert.deepEqual(reader.warnings, []);
});

test('rating-only archive edits retain metadata and direction through a subsequent import', async t => {
    const h = await fixture(t);
    await h.save(fullMetadata);
    await writeArchiveRating(h.filePath, 3);
    const saved = await h.archive();
    assert.match(saved.read('ComicInfo.xml').toString(), /<CommunityRating>1\.5<\/CommunityRating>/);
    const reader = await h.open(h.filePath);
    assert.equal((await reader.getDetail()).rating, '3');
    assert.equal((await reader.getDetail()).comicMetadata.Translator, 'Translator');
    assert.equal(await reader.getDirection(), 'rtl');
    assert.deepEqual(saved.read('ComicBook.xml'), Buffer.from(legacyBook));
});

for (const [rating, synchronized] of [['8.8', 9], ['0', null]]) {
    test(`XML/preview ${rating} remains exact; existing personal-rating protocol uses ${synchronized}`, async t => {
        const h = await fixture(t);
        await h.save({ Title: 'Rating precision', CommunityRating: rating });
        const { reader, packet } = await h.transfer();
        assert.equal((await reader.getDetail()).rating, rating);
        assert.equal(reader.previewDetail(packet.preview.metadata).rating, rating);
        const reply = await h.desktop.pullRating(packet.file);
        assert.equal(reply.rating, synchronized);
        await reader.applyRatingReply(reply);
        assert.equal((await reader.getDetail()).rating, synchronized === null ? null : String(synchronized));
        assert.equal(reader.getPersistedDetail().comicMetadata.CommunityRating, rating);
    });
}

test('desktop 9.3/10 rounds once to XML 4.7/5 and imported metadata 9.4/10; personal rating sync uses 9', async t => {
    const h = await fixture(t);
    await h.save({ Title: 'Standard rating precision', CommunityRating: '9.3' });
    const saved = await h.archive();
    const xml = saved.read('ComicInfo.xml').toString();
    assert.match(xml, /<CommunityRating>4\.7<\/CommunityRating>/);
    assert.equal(parseComicInfo(xml).CommunityRating, '9.4');
    assert.equal((await h.libraryDb.getFileInfo(h.filePath)).rating, '9.4');
    const { reader, packet } = await h.transfer();
    assert.equal(String(packet.preview.metadata.CommunityRating), '9.4');
    assert.equal(reader.previewDetail(packet.preview.metadata).rating, '9.4');
    assert.equal((await reader.getDetail()).rating, '9.4');
    const reply = await h.desktop.pullRating(packet.file);
    assert.equal(reply.rating, 9);
    await reader.applyRatingReply(reply);
    reader.clearMemoryCache();
    assert.equal((await reader.getDetail()).rating, '9');
    assert.equal(reader.getPersistedDetail().comicMetadata.CommunityRating, '9.4');
    for (const metadata of [{}, { CommunityRating: '9.4' }, {}]) {
        await h.save(metadata);
        assert.deepEqual((await h.archive()).bytes, saved.bytes, 'Re-saving the normalized rating must not divide or round it again');
        assert.equal((await h.libraryDb.getFileInfo(h.filePath)).rating, '9.4');
        assert.equal(String((await h.desktop.preview('sample.cbz')).metadata.CommunityRating), '9.4');
    }
    const importedAgain = await h.open(h.filePath);
    assert.equal((await importedAgain.getDetail()).rating, '9.4');
    assert.deepEqual(reader.warnings, []);
    assert.deepEqual(importedAgain.warnings, []);
});
