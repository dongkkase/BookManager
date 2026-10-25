import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';
import { runMetadataProcess } from './metadataProcess.js';
import { parseComicInfo, saveMetadataItems, writeArchiveRating } from './tasks/metadataTask.js';

const originalXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:custom="urn:bookmanager-test" custom:source="original">
    <!-- Keep the original page annotations. -->
    <Title>Original</Title>
    <Translator>Translator</Translator>
    <Review>Review</Review>
    <StoryArc>Arc</StoryArc>
    <StoryArcNumber>2</StoryArcNumber>
    <GTIN>9781234567897</GTIN>
    <CommunityRating>4.5</CommunityRating>
    <ComicZipAddedDate>2024-01-02 03:04:05</ComicZipAddedDate>
    <ComicZipModifiedDate>2024-02-03 04:05:06</ComicZipModifiedDate>
    <Pages><Page Image="0" Type="FrontCover" Bookmark="Chapter 1" custom:flag="keep"/></Pages>
    <custom:Extra custom:id="123"><custom:Value>Preserve</custom:Value></custom:Extra>
</ComicInfo>`;
const comicBookXml = '<ComicBook><Title>Original</Title><CurrentPage>12</CurrentPage><Rating>4</Rating><CustomValuesStore>source=example</CustomValuesStore></ComicBook>';
const comicBookInfo = '{"ComicBookInfo/1.0":{"title":"Original","rating":4}}';

async function fixture(t, extension = '.cbz') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comicinfo-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return { directory, filePath: path.join(directory, `book${extension}`) };
}

async function writeZip(filePath, entries) {
    await fs.writeFile(filePath, Buffer.alloc(0));
    for (const [name, content] of Object.entries(entries)) {
        await replaceZipEntry(filePath, name, content);
    }
}

function endRecord(buffer) {
    return buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

async function addZipComment(filePath, trailing = '') {
    const buffer = await fs.readFile(filePath);
    const comment = Buffer.from(comicBookInfo);
    const end = endRecord(buffer);
    buffer.writeUInt16LE(comment.length, end + 20);
    await fs.writeFile(filePath, Buffer.concat([buffer, comment, Buffer.from(trailing)]));
}

async function readArchive(filePath) {
    const buffer = await fs.readFile(filePath);
    const entries = listZipEntries(buffer);
    const end = endRecord(buffer);
    const commentEnd = end + 22 + buffer.readUInt16LE(end + 20);
    return {
        buffer,
        names: entries.map(entry => entry.name),
        read: name => readZipEntry(buffer, entries.find(entry => entry.name === name)).toString('utf8'),
        comment: buffer.subarray(end + 22, commentEnd).toString('utf8'),
        trailing: buffer.subarray(commentEnd).toString('utf8'),
    };
}

function assertPreservedXml(xml) {
    assert.equal(parseComicInfo(xml).Translator, 'Translator');
    assert.equal(parseComicInfo(xml).Review, 'Review');
    assert.equal(parseComicInfo(xml).StoryArcNumber, '2');
    assert.equal(parseComicInfo(xml).GTIN, '9781234567897');
    assert.match(xml, /xmlns:custom="urn:bookmanager-test"/);
    assert.match(xml, /custom:source="original"/);
    assert.match(xml, /<!-- Keep the original page annotations\. -->/);
    assert.match(xml, /<Page\b[^>]*Bookmark="Chapter 1"[^>]*custom:flag="keep"/);
    assert.match(xml, /<custom:Extra custom:id="123"><custom:Value>Preserve<\/custom:Value><\/custom:Extra>/);
    assert.match(xml, /<ComicZipAddedDate>2024-01-02 03:04:05<\/ComicZipAddedDate>/);
    assert.match(xml, /<ComicZipModifiedDate>2024-02-03 04:05:06<\/ComicZipModifiedDate>/);
}

for (const fallback of [false, true]) {
    test(`ComicInfo save preserves page annotations, extensions, CE data and CBI comment (${fallback ? 'ZIP rewrite' : 'ZIP append'})`, async t => {
        const { filePath } = await fixture(t);
        await writeZip(filePath, {
            'nested/COMICINFO.XML': '<ComicInfo><Title>Nested stale title</Title></ComicInfo>',
            'legacy\\COMICINFO.XML': '<ComicInfo><Title>Legacy stale title</Title></ComicInfo>',
            'ComicInfo.xml': originalXml,
            'ComicBook.xml': comicBookXml,
            '001.jpg': 'page bytes',
        });
        await addZipComment(filePath, fallback ? 'TRAILING' : '');

        const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated', CommunityRating: '7' } }]);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.stats.success.length, 1);
        const archive = await readArchive(filePath);
        const xml = archive.read('ComicInfo.xml');
        assert.equal(parseComicInfo(xml).Title, 'Updated');
        assert.match(xml, /<CommunityRating>3\.5<\/CommunityRating>/);
        assertPreservedXml(xml);
        assert.deepEqual(archive.names.filter(name => /comicinfo\.xml$/i.test(name)), ['ComicInfo.xml']);
        assert.equal(archive.read('ComicBook.xml'), comicBookXml);
        assert.equal(archive.read('001.jpg'), 'page bytes');
        assert.equal(archive.comment, comicBookInfo);
        assert.equal(archive.trailing, fallback ? 'TRAILING' : '');

        await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated', CommunityRating: '7' } }]);
        assert.deepEqual(await fs.readFile(filePath), archive.buffer);
    });
}

test('saving an archive with only nested ComicInfo preserves its XML when moving it to the root', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, { 'sub/ComicInfo.xml': originalXml, '001.jpg': 'page' });
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated' } }]);
    assert.deepEqual(result.stats.error, []);
    const archive = await readArchive(filePath);
    assertPreservedXml(archive.read('ComicInfo.xml'));
    assert.ok(!archive.names.includes('sub/ComicInfo.xml'));
});

test('new ComicInfo metadata does not add private timestamps', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, { '001.jpg': 'page' });
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'New', CommunityRating: '10' } }]);
    assert.deepEqual(result.stats.error, []);
    const xml = (await readArchive(filePath)).read('ComicInfo.xml');
    assert.match(xml, /<CommunityRating>5<\/CommunityRating>/);
    assert.doesNotMatch(xml, /ComicZipAddedDate|ComicZipModifiedDate/);
});

test('malformed existing ComicInfo fails without replacing the archive', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, { 'ComicInfo.xml': '<ComicInfo><Title>Broken</ComicInfo>', '001.jpg': 'page' });
    const original = await fs.readFile(filePath);
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated' } }]);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(await fs.readFile(filePath), original);
});

test('rating-only writes standard rating while preserving unrelated metadata and extensions', async t => {
    const { filePath } = await fixture(t);
    await writeZip(filePath, { 'ComicInfo.xml': originalXml, 'ComicBook.xml': comicBookXml, '001.jpg': 'page' });
    await writeArchiveRating(filePath, 9);
    const archive = await readArchive(filePath);
    assert.match(archive.read('ComicInfo.xml'), /<CommunityRating>4\.5<\/CommunityRating>/);
    assertPreservedXml(archive.read('ComicInfo.xml'));
    assert.equal(archive.read('ComicBook.xml'), comicBookXml);
});

const sevenZExe = ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za'].find(candidate => !spawnSync(candidate, ['i'], { stdio: 'ignore' }).error);

test('7z metadata save preserves nested XML content and CE library metadata', { skip: !sevenZExe }, async t => {
    const { directory, filePath } = await fixture(t, '.7z');
    await fs.mkdir(path.join(directory, 'sub'));
    await fs.writeFile(path.join(directory, 'sub', 'COMICINFO.XML'), originalXml);
    await fs.writeFile(path.join(directory, 'ComicBook.xml'), comicBookXml);
    await fs.writeFile(path.join(directory, '001.jpg'), 'page');
    await runMetadataProcess(sevenZExe, ['a', filePath, 'sub/COMICINFO.XML', 'ComicBook.xml', '001.jpg'], { cwd: directory });
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Updated', CommunityRating: '7' } }], { sevenZExe });
    assert.deepEqual(result.stats.error, []);
    const xml = (await runMetadataProcess(sevenZExe, ['e', '-so', filePath, 'ComicInfo.xml'], { binary: true })).buffer.toString('utf8');
    assertPreservedXml(xml);
    assert.match(xml, /<CommunityRating>3\.5<\/CommunityRating>/);
    const ceXml = (await runMetadataProcess(sevenZExe, ['e', '-so', filePath, 'ComicBook.xml'], { binary: true })).buffer.toString('utf8');
    assert.equal(ceXml, comicBookXml);
    const listing = await runMetadataProcess(sevenZExe, ['l', '-slt', filePath]);
    assert.doesNotMatch(listing.stdout, /Path = sub\/COMICINFO\.XML/);
});
