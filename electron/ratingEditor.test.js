import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tagLib from 'node-taglib-sharp';
import { resolveCoverEditorSevenZPath } from './coverEditorBinary.js';
import { runMetadataProcess } from './metadataProcess.js';
import { saveItemRating } from './ratingEditor.js';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry, listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';
import { inspectFolderFile } from './tasks/folderScanTask.js';
import { readAudioMetadata } from './audioMetadata.js';

async function fixture(t, extension = '.cbz') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-rating-test-'));
    const filePath = path.join(directory, `book${extension}`);
    const dbPath = path.join(directory, 'library.db');
    const libraryDb = new LibraryDB({ dbPath });
    t.after(async () => { await libraryDb.close(); await fs.rm(directory, { recursive: true, force: true }); });
    return { directory, filePath, dbPath, libraryDb };
}

async function zip(filePath, entries) {
    await fs.writeFile(filePath, Buffer.alloc(0));
    for (const [name, content] of Object.entries(entries)) await replaceZipEntry(filePath, name, content);
}

async function entry(filePath, name) {
    const entries = await listZipEntriesFromFile(filePath);
    return (await readZipEntryFromFile(filePath, entries.find(item => item.name === name))).toString('utf8');
}

const scan = f => inspectFolderFile(f.filePath, { libraryDb: f.libraryDb, force: true, skipCoverExtraction: true });

test('rating saves only ComicInfo rating and preserves pages, custom fields, unrelated entries and backup', async t => {
    const f = await fixture(t);
    const xml = '<ComicInfo><Title>Original</Title><Custom value="keep"/><CommunityRating>2</CommunityRating><Pages><Page Image="0" Bookmark="chapter"/></Pages></ComicInfo>';
    await zip(f.filePath, { 'ComicInfo.xml': xml, '001.jpg': 'page bytes', 'notes.txt': 'notes' });
    const original = await fs.readFile(f.filePath);
    const result = await saveItemRating({ filePath: f.filePath, rating: 7 }, { ...f, backup_on: true });
    assert.equal(result.storage, 'file', result.fallbackReason);
    assert.equal(await entry(f.filePath, 'ComicInfo.xml'), xml.replace('<CommunityRating>2</CommunityRating>', '').replace('</ComicInfo>', '<CommunityRating>7</CommunityRating></ComicInfo>'));
    assert.equal(await entry(f.filePath, '001.jpg'), 'page bytes');
    assert.equal(await entry(f.filePath, 'notes.txt'), 'notes');
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    assert.equal((await scan(f)).rating, '7');
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating_override, '');
});

for (const metadata of ['', '<ComicInfo><CommunityRating/><Title>Keep</Title></ComicInfo>']) {
    test(`comic creates missing or empty rating: ${Boolean(metadata)}`, async t => {
        const f = await fixture(t);
        await zip(f.filePath, { '001.jpg': 'page bytes', ...(metadata ? { 'sub/ComicInfo.xml': metadata } : {}) });
        const result = await saveItemRating({ filePath: f.filePath, rating: 1 }, f);
        assert.equal(result.storage, 'file', result.fallbackReason);
        assert.equal((await scan(f)).rating, '1');
    });
}

test('EPUB replaces all existing rating aliases without changing other package metadata or content', async t => {
    const f = await fixture(t, '.epub');
    const xml = '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><opf:metadata><dc:title>Original</dc:title><opf:meta property="schema:ratingValue">2</opf:meta><opf:meta name="calibre:rating" content="4"/><opf:meta name="custom" content="keep"/></opf:metadata><opf:manifest/><opf:spine/></opf:package>';
    await zip(f.filePath, { mimetype: 'application/epub+zip', 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', 'OEBPS/content.opf': xml, 'OEBPS/chapter.xhtml': 'chapter' });
    const result = await saveItemRating({ filePath: f.filePath, rating: 9 }, f);
    assert.equal(result.storage, 'file', result.fallbackReason);
    const updated = await entry(f.filePath, 'OEBPS/content.opf');
    assert.match(updated, /<dc:title>Original<\/dc:title>/);
    assert.match(updated, /<opf:meta name="custom" content="keep"\/>/);
    assert.doesNotMatch(updated, /schema:ratingValue/);
    assert.match(updated, /<opf:meta name="calibre:rating" content="9"\/>/);
    assert.equal(await entry(f.filePath, 'OEBPS/chapter.xhtml'), 'chapter');
    assert.equal((await scan(f)).rating, '9');
});

test('partial native write failure leaves original intact and DB rating survives force scan, bulk update and reopen', async t => {
    const f = await fixture(t);
    await zip(f.filePath, { 'ComicInfo.xml': '<ComicInfo><Title>Original</Title><CommunityRating>3</CommunityRating></ComicInfo>' });
    const original = await fs.readFile(f.filePath);
    await scan(f);
    const result = await saveItemRating({ filePath: f.filePath, rating: 8 }, { ...f, writeNativeRating: async stagedPath => {
        await fs.writeFile(stagedPath, 'partial write');
        throw new Error('read-only metadata');
    } });
    assert.equal(result.storage, 'database');
    assert.deepEqual(await fs.readFile(f.filePath), original);
    assert.equal((await scan(f)).rating, '8');
    const record = await f.libraryDb.getFileInfo(f.filePath);
    await f.libraryDb.upsertFileInfoBulk([{ ...record, rating: '3', rating_override: '' }]);
    await f.libraryDb.close();
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating, '8');
    assert.equal((await scan(f)).rating, '8');
    const saved = await saveItemRating({ filePath: f.filePath, rating: 5 }, f);
    assert.equal(saved.storage, 'file', saved.fallbackReason);
    assert.equal((await scan(f)).rating, '5');
    assert.equal((await f.libraryDb.getFileInfo(f.filePath)).rating_override, '');
    assert.ok(!(await fs.readdir(f.directory)).some(name => name.startsWith('.bookmanager-rating-')));
});

test('TXT stores a local rating without changing text and retains it when refreshed', async t => {
    const f = await fixture(t, '.txt');
    await fs.writeFile(f.filePath, 'Keep this text.');
    const result = await saveItemRating({ filePath: f.filePath, rating: 10 }, f);
    assert.equal(result.storage, 'database');
    assert.equal(await fs.readFile(f.filePath, 'utf8'), 'Keep this text.');
    assert.equal((await scan(f)).rating, '10');
    assert.equal((await scan(f)).rating, '10');
});

test('rejects invalid scores and changed source instead of overwriting file or storing a stale rating', async t => {
    const f = await fixture(t);
    await zip(f.filePath, { 'notes.txt': 'original' });
    for (const rating of [0, -1, 11, 1.5, '7', null, NaN]) {
        await assert.rejects(saveItemRating({ filePath: f.filePath, rating }, f), /integer/);
    }
    await assert.rejects(saveItemRating({ filePath: f.filePath, rating: 4 }, { ...f, writeNativeRating: async () => {
        await fs.writeFile(f.filePath, 'concurrent external edit');
    } }), /file changed/);
    assert.equal(await fs.readFile(f.filePath, 'utf8'), 'concurrent external edit');
    assert.equal(await f.libraryDb.getFileInfo(f.filePath), null);
});

test('MP3 rating round trips without changing title or custom ID3 fields', async t => {
    const f = await fixture(t, '.mp3');
    const frame = Buffer.alloc(288, 0x55);
    Buffer.from('ffe348c4000000034800000000', 'hex').copy(frame);
    Buffer.from('LAME4.0').copy(frame, 13);
    await fs.writeFile(f.filePath, Buffer.concat([frame, frame, frame, frame]));
    const audio = tagLib.File.createFromPath(f.filePath);
    audio.tag.title = 'Original title';
    const custom = tagLib.Id3v2UserTextInformationFrame.fromDescription('custom');
    custom.text = ['keep'];
    audio.getTag(tagLib.TagTypes.Id3v2, true).addFrame(custom);
    audio.save();
    audio.dispose();
    for (const rating of [1, 7, 10]) {
        const result = await saveItemRating({ filePath: f.filePath, rating }, f);
        assert.equal(result.storage, 'file', result.fallbackReason);
        const metadata = await readAudioMetadata(f.filePath, { includeCover: false });
        assert.equal(metadata.rating, String(rating));
        assert.equal(metadata.title, 'Original title');
    }
    const updated = tagLib.File.createFromPath(f.filePath);
    try { assert.equal(updated.getTag(tagLib.TagTypes.Id3v2, false).frames.find(item => item.description === 'custom').text[0], 'keep'); }
    finally { updated.dispose(); }
    assert.equal((await scan(f)).rating, '10');
});

function pdfFixture({ signed = false } = {}) {
    const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:custom="urn:custom" xmp:Rating="2"><custom:keep>Original</custom:keep></rdf:Description></rdf:RDF></x:xmpmeta>';
    const objects = ['<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>', `<< /Title (Original title) /Custom (Keep) ${signed ? '/ByteRange [0 1 2 3]' : ''} >>`, `<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(xml)} >>\nstream\n${xml}\nendstream`];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return pdf;
}

test('PDF preserves original Info and custom XMP through repeated rating edits', async t => {
    const f = await fixture(t, '.pdf');
    const original = pdfFixture();
    await fs.writeFile(f.filePath, original);
    for (const rating of [3, 8]) {
        const result = await saveItemRating({ filePath: f.filePath, rating }, f);
        assert.equal(result.storage, 'file', result.fallbackReason);
        const pdf = await fs.readFile(f.filePath, 'utf8');
        assert.ok(pdf.startsWith(original));
        assert.match(pdf.slice(pdf.lastIndexOf('trailer')), /\/Info 4 0 R/);
        const lastXml = pdf.slice(pdf.lastIndexOf('<x:xmpmeta'));
        assert.match(lastXml, /<custom:keep>Original<\/custom:keep>/);
        assert.doesNotMatch(lastXml, /xmp:Rating="2"/);
        assert.match(lastXml, new RegExp(`<xmp:Rating>${rating}</xmp:Rating>`));
        assert.equal((await scan(f)).rating, String(rating));
    }
});

test('signed PDF falls back to DB with byte-identical source', async t => {
    const f = await fixture(t, '.pdf');
    const original = pdfFixture({ signed: true });
    await fs.writeFile(f.filePath, original);
    const result = await saveItemRating({ filePath: f.filePath, rating: 6 }, f);
    assert.equal(result.storage, 'database');
    assert.equal(await fs.readFile(f.filePath, 'utf8'), original);
    assert.equal((await scan(f)).rating, '6');
});

const M4B_FIXTURE_BASE64 = [
    'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAwNtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAMgABAAABAAAA',
    'AAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC',
    'AAACLXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAMgAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAA',
    'AAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAADIAAAQAAAEAAAAAAaVtZGlh',
    'AAAAIG1kaGQAAAAAAAAAAAAAAAAAAB9AAAAFkFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFu',
    'ZGxlcgAAAAFQbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEUc3Ri',
    'bAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAB9AAAAAAAA2ZXNkcwAAAAADgICAJQAB',
    'AASAgIAXQBUAAAAAAB9AAAAEYwWAgIAFFYhW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAAAQAABAAAAAABAAABkAAAABxz',
    'dHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABUAAAAEAAAAFHN0Y28AAAAAAAAAAQAAAy8A',
    'AAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAAgAAAAEAAABidWR0YQAAAFptZXRhAAAA',
    'AAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYy',
    'LjEyLjEwMgAAAAhmcmVlAAAAIW1kYXTeAgBMYXZjNjIuMjguMTAyAAIwQA4BGCAH',
].join('');

for (const extension of ['.m4b', '.flac']) {
    test(`${extension} native rating persists while retaining the title`, async t => {
        const f = await fixture(t, extension);
        if (extension === '.m4b') await fs.writeFile(f.filePath, Buffer.from(M4B_FIXTURE_BASE64, 'base64'));
        else {
            const flac = Buffer.alloc(42);
            flac.write('fLaC');
            flac[4] = 0x80;
            flac[7] = 34;
            flac.writeUInt16BE(4096, 8);
            flac.writeUInt16BE(4096, 10);
            flac.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | 44100n, 18);
            await fs.writeFile(f.filePath, flac);
        }
        const original = tagLib.File.createFromPath(f.filePath);
        original.tag.title = 'Keep title';
        original.save();
        original.dispose();
        for (const rating of [1, 9]) {
            const result = await saveItemRating({ filePath: f.filePath, rating }, f);
            assert.equal(result.storage, 'file', result.fallbackReason);
            const metadata = await readAudioMetadata(f.filePath, { includeCover: false });
            assert.equal(metadata.rating, String(rating));
            assert.equal(metadata.title, 'Keep title');
        }
    });
}

test('7z comic rating updates the existing nested ComicInfo entry', async t => {
    const f = await fixture(t, '.cb7');
    const sevenZExe = await resolveCoverEditorSevenZPath();
    assert.ok(sevenZExe, 'Bundled 7z binary is required');
    await fs.mkdir(path.join(f.directory, 'content'));
    await fs.writeFile(path.join(f.directory, 'content', 'ComicInfo.xml'), '<ComicInfo><Title>Keep</Title><CommunityRating>2</CommunityRating></ComicInfo>');
    await runMetadataProcess(sevenZExe, ['a', '-t7z', f.filePath, 'content/ComicInfo.xml'], { cwd: f.directory });
    const result = await saveItemRating({ filePath: f.filePath, rating: 7 }, { ...f, sevenZExe });
    assert.equal(result.storage, 'file', result.fallbackReason);
    const metadata = await inspectFolderFile(f.filePath, { libraryDb: f.libraryDb, sevenZExe, force: true, skipCoverExtraction: true });
    assert.equal(metadata.rating, '7');
    assert.equal(metadata.title, 'Keep');
});
