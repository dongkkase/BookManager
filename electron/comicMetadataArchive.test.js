import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';
import { COMICINFO_CACHE_VERSION } from './comicInfoXml.js';
import { runMetadataProcess } from './metadataProcess.js';
import {
    analyzeMetadataInputs,
    loadLatestSeriesMetadata,
    parseComicInfo,
    saveMetadataItems,
    writeArchiveRating,
} from './tasks/metadataTask.js';

const sources = [
    {
        format: 'comicbook',
        entryName: 'metadata/ComicBook.xml',
        xml: `<?xml version="1.0" encoding="utf-8"?>
<ComicBook>
    <Title>Legacy title</Title><Series>Legacy series</Series><Number>012AU</Number>
    <Writer>Legacy writer</Writer><Summary>Legacy summary</Summary><CommunityRating>4.5</CommunityRating>
    <Pages><Page Image="0" Type="FrontCover" Bookmark="Chapter 1"/></Pages>
    <Rating>3</Rating><CurrentPage>7</CurrentPage><CustomValuesStore>owner=original</CustomValuesStore>
</ComicBook>`,
    },
    {
        format: 'comet',
        entryName: 'legacy/CoMet.xml',
        xml: `<?xml version="1.0" encoding="UTF-8"?>
<comet>
    <title>Legacy title</title><series>Legacy series</series><issue>012AU</issue>
    <writer>Legacy writer</writer><description>Legacy summary</description>
    <publisher>Legacy publisher</publisher><custom>Original extension</custom>
</comet>`,
    },
];

async function fixture(t, extension = '.cbz') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comic-metadata-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return { directory, filePath: path.join(directory, `book${extension}`) };
}

async function writeZip(filePath, entries, fallback = false) {
    await fs.writeFile(filePath, Buffer.alloc(0));
    for (const [name, content] of Object.entries(entries)) await replaceZipEntry(filePath, name, content);
    if (fallback) {
        const buffer = await fs.readFile(filePath);
        const comment = Buffer.from('{"ComicBookInfo/1.0":{"title":"Comment metadata"}}');
        const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        buffer.writeUInt16LE(comment.length, end + 20);
        await fs.writeFile(filePath, Buffer.concat([buffer, comment, Buffer.from('TRAILING')]));
    }
}

async function readArchive(filePath) {
    const buffer = await fs.readFile(filePath);
    const entries = listZipEntries(buffer);
    return {
        buffer,
        names: entries.map(entry => entry.name),
        read: name => readZipEntry(buffer, entries.find(entry => entry.name === name)),
    };
}

async function analyze(filePath, options = {}) {
    return analyzeMetadataInputs([filePath], {
        includeCovers: false,
        includeInferredMetadata: false,
        includeCachedMetadata: false,
        ...options,
    });
}

function assertLegacyFields(metadata) {
    assert.equal(metadata.Title, 'Legacy title');
    assert.equal(metadata.Series, 'Legacy series');
    assert.equal(metadata.Number, '012AU');
    assert.equal(metadata.Writer, 'Legacy writer');
    assert.equal(metadata.Summary, 'Legacy summary');
}

for (const source of sources) {
    test(`${source.format} metadata is available to the editor and latest-volume lookup`, async t => {
        const { filePath } = await fixture(t);
        await writeZip(filePath, { [source.entryName]: source.xml, '001.jpg': 'page' });
        const original = await fs.readFile(filePath);
        const result = await analyze(filePath);
        assert.deepEqual(result.skippedFiles, []);
        const [item] = result.items;
        assert.equal(item.hasComicInfo, false);
        assert.equal(item.hasComicMetadata, true);
        assert.equal(item.comicMetadataFormat, source.format);
        assert.equal(item.comicMetadataEntryName, source.entryName);
        assertLegacyFields(item.metadata);
        const latest = await loadLatestSeriesMetadata({ title: 'Legacy title 1권', bookType: 'comic' }, {
            libraryDb: {
                async getMetadataTitleCandidates() {
                    return [{ path: filePath, title: 'Legacy title 10권', volume: '10', book_type: 'comic' }];
                },
            },
        });
        assert.equal(latest.sourcePath, filePath);
        assertLegacyFields(latest.metadata);
        assert.deepEqual(await fs.readFile(filePath), original);
    });

    for (const fallback of [false, true]) {
        test(`${source.format} saves unchanged metadata as ComicInfo and preserves the source (${fallback ? 'ZIP rewrite' : 'ZIP append'})`, async t => {
            const { filePath } = await fixture(t);
            await writeZip(filePath, { [source.entryName]: source.xml, '001.jpg': 'page' }, fallback);
            const result = await saveMetadataItems([{ filepath: filePath, metadata: {} }]);
            assert.deepEqual(result.stats.error, []);
            assert.equal(result.stats.success.length, 1);
            const archive = await readArchive(filePath);
            assert.ok(archive.names.includes('ComicInfo.xml'));
            assert.deepEqual(archive.read(source.entryName), Buffer.from(source.xml));
            assert.equal(archive.read('001.jpg').toString(), 'page');
            const xml = archive.read('ComicInfo.xml').toString('utf8');
            assertLegacyFields(parseComicInfo(xml));
            assert.doesNotMatch(xml, /ComicZipAddedDate|ComicZipModifiedDate/);
            if (source.format === 'comicbook') {
                assert.equal(parseComicInfo(xml).CommunityRating, '9');
                assert.match(xml, /<Page\b[^>]*Bookmark="Chapter 1"/);
            }
            if (fallback) assert.ok(archive.buffer.toString().endsWith('{"ComicBookInfo/1.0":{"title":"Comment metadata"}}TRAILING'));
            const [item] = (await analyze(filePath)).items;
            assert.equal(item.hasComicInfo, true);
            assert.equal(item.comicMetadataFormat, 'comicinfo');
            await saveMetadataItems([{ filepath: filePath, metadata: {} }]);
            assert.deepEqual(await fs.readFile(filePath), archive.buffer);
        });
    }

    test(`${source.format} rating-only save retains imported metadata and the original XML`, async t => {
        const { filePath } = await fixture(t);
        await writeZip(filePath, { [source.entryName]: source.xml, '001.jpg': 'page' });
        await writeArchiveRating(filePath, 7);
        const archive = await readArchive(filePath);
        const xml = archive.read('ComicInfo.xml').toString('utf8');
        assertLegacyFields(parseComicInfo(xml));
        assert.match(xml, /<CommunityRating>3\.5<\/CommunityRating>/);
        assert.deepEqual(archive.read(source.entryName), Buffer.from(source.xml));
    });
}

test('ComicInfo takes precedence without importing fields from ComicBook or CoMet', async t => {
    const { filePath } = await fixture(t);
    const comicInfo = '<ComicInfo><Title>Preferred title</Title></ComicInfo>';
    await writeZip(filePath, {
        'nested/ComicInfo.xml': comicInfo,
        'ComicBook.xml': sources[0].xml,
        'CoMet.xml': sources[1].xml,
    });
    const [item] = (await analyze(filePath)).items;
    assert.equal(item.comicMetadataFormat, 'comicinfo');
    assert.equal(item.metadata.Title, 'Preferred title');
    assert.equal(item.metadata.Writer, undefined);
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated' } }]);
    assert.deepEqual(result.stats.error, []);
    const archive = await readArchive(filePath);
    assert.equal(parseComicInfo(archive.read('ComicInfo.xml').toString()).Writer, undefined);
    assert.deepEqual(archive.read('ComicBook.xml'), Buffer.from(sources[0].xml));
    assert.deepEqual(archive.read('CoMet.xml'), Buffer.from(sources[1].xml));
});

test('legacy fields cached before ComicInfo was added do not reappear in the editor', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, { 'ComicBook.xml': sources[0].xml });
    const [legacy] = (await analyze(filePath)).items;
    assert.equal(legacy.metadata.Writer, 'Legacy writer');
    await replaceZipEntry(filePath, 'ComicInfo.xml', '<ComicInfo><Title>Preferred title</Title></ComicInfo>');
    const [preferred] = (await analyze(filePath, {
        includeCachedMetadata: true,
        libraryDb: {
            async getFileInfo() {
                return { path: filePath, book_type: 'comic', title: legacy.metadata.Title, writer: legacy.metadata.Writer };
            },
        },
    })).items;
    assert.equal(preferred.comicMetadataFormat, 'comicinfo');
    assert.equal(preferred.metadata.Title, 'Preferred title');
    assert.equal(preferred.metadata.Writer, undefined);
});

test('saving rereads the legacy XML and caches the complete converted result', async t => {
    const { filePath } = await fixture(t);
    const source = sources[0];
    await writeZip(filePath, { [source.entryName]: source.xml });
    const [item] = (await analyze(filePath)).items;
    const updatedSource = source.xml.replace('</ComicBook>', '<Publisher>Added after analysis</Publisher></ComicBook>');
    await replaceZipEntry(filePath, source.entryName, updatedSource);
    let stored;
    const result = await saveMetadataItems([{ ...item, metadata: { Title: 'Updated' } }], {
        libraryDb: {
            async getFileInfo() { return {}; },
            async upsertFileInfo(record) { stored = record; },
        },
    });
    assert.deepEqual(result.stats.error, []);
    const archive = await readArchive(filePath);
    const metadata = parseComicInfo(archive.read('ComicInfo.xml').toString());
    assert.equal(metadata.Title, 'Updated');
    assert.equal(metadata.Publisher, 'Added after analysis');
    assert.equal(metadata.Writer, 'Legacy writer');
    assert.equal(stored.publisher, 'Added after analysis');
    assert.equal(stored.writer, 'Legacy writer');
    assert.equal(stored.rating, '9');
    assert.equal(stored.has_metadata, 1);
    assert.equal(stored.comicinfo_version, COMICINFO_CACHE_VERSION);
    assert.deepEqual(archive.read(source.entryName), Buffer.from(updatedSource));
});

test('malformed preferred metadata is reported without falling back or changing the archive', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, {
        'ComicBook.xml': '<ComicBook><Title>Broken</ComicBook>',
        'CoMet.xml': sources[1].xml,
    });
    const original = await fs.readFile(filePath);
    const analysis = await analyze(filePath);
    assert.equal(analysis.items.length, 0);
    assert.equal(analysis.skippedFiles.length, 1);
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated' } }]);
    assert.equal(result.stats.error.length, 1);
    await assert.rejects(writeArchiveRating(filePath, 7));
    assert.deepEqual(await fs.readFile(filePath), original);
});

const sevenZExe = ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']
    .find(candidate => !spawnSync(candidate, ['i'], { stdio: 'ignore' }).error);

for (const source of sources) {
    test(`7z ${source.format} conversion and rating preserve the original metadata entry`, { skip: !sevenZExe }, async t => {
        const { directory, filePath } = await fixture(t, '.7z');
        await fs.mkdir(path.dirname(path.join(directory, source.entryName)), { recursive: true });
        await fs.writeFile(path.join(directory, source.entryName), source.xml);
        await fs.writeFile(path.join(directory, '001.jpg'), 'page');
        await runMetadataProcess(sevenZExe, ['a', filePath, source.entryName, '001.jpg'], { cwd: directory });
        const [item] = (await analyze(filePath, { sevenZExe })).items;
        assert.equal(item.comicMetadataFormat, source.format);
        const read = async name => (await runMetadataProcess(sevenZExe, ['e', '-so', '-spd', '-ssc', '--', filePath, name], { binary: true })).buffer;
        if (source.format === 'comicbook') {
            const result = await saveMetadataItems([{ filepath: filePath, metadata: {} }], { sevenZExe });
            assert.deepEqual(result.stats.error, []);
        } else {
            await writeArchiveRating(filePath, 7, { sevenZExe });
        }
        const xml = (await read('ComicInfo.xml')).toString('utf8');
        assertLegacyFields(parseComicInfo(xml));
        if (source.format === 'comet') assert.match(xml, /<CommunityRating>3\.5<\/CommunityRating>/);
        assert.deepEqual(await read(source.entryName), Buffer.from(source.xml));
        assert.equal((await read('001.jpg')).toString(), 'page');
    });
}
