import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { analyzeMetadataInputs, saveMetadataItems } from './tasks/metadataTask.js';
import { getZipEntryCompressedData, listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';

async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-batch-save-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    const coverPath = path.join(directory, 'new-cover.png');
    const cover = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
    fs.writeFileSync(coverPath, cover);
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await replaceZipEntry(filePath, 'META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    await replaceZipEntry(filePath, 'OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Old title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
    await replaceZipEntry(filePath, 'OEBPS/chapter.xhtml', '<html><body>Original chapter</body></html>');
    await replaceZipEntry(filePath, 'META-INF/sidecar.bin', randomBytes(1024 * 1024));
    return { directory, filePath, coverPath, cover, original: fs.readFileSync(filePath) };
}

test('EPUB 표지와 OPF는 한번 갱신하며 본문, 부가파일, 백업을 보존한다', async t => {
    const { filePath, coverPath, cover, original } = await fixture(t);
    const open = fsp.open.bind(fsp);
    let batchWrites = 0;
    t.mock.method(fsp, 'open', async (...args) => {
        if (args[1] === 'wx' && String(args[0]).endsWith('.zip-update')) batchWrites += 1;
        return open(...args);
    });
    const result = await saveMetadataItems([{
        filepath: filePath,
        metadata: { Title: 'New title', Writer: 'New author' },
        epubCoverChange: { type: 'file', filePath: coverPath },
    }], { backup_on: true });
    assert.deepEqual(result.stats.error, []);
    assert.equal(result.stats.success.length, 1);
    assert.equal(batchWrites, 1);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(filePath), 'bak', 'book.epub')), original);
    const updated = fs.readFileSync(filePath);
    const entries = listZipEntries(updated);
    for (const name of ['OEBPS/chapter.xhtml', 'META-INF/sidecar.bin']) {
        const before = listZipEntries(original).find(entry => entry.name === name);
        const after = entries.find(entry => entry.name === name);
        assert.deepEqual(getZipEntryCompressedData(updated, after), getZipEntryCompressedData(original, before));
    }
    const opf = readZipEntry(updated, entries.find(entry => entry.name === 'OEBPS/content.opf')).toString();
    assert.match(opf, /<dc:title>New title<\/dc:title>/);
    assert.match(opf, /<dc:creator>New author<\/dc:creator>/);
    assert.ok(entries.some(entry => entry.name.endsWith('bookmanager-cover.xhtml')));
    assert.ok(entries.some(entry => entry.name.endsWith('.png') && readZipEntry(updated, entry).equals(cover)));
    const analyzed = await analyzeMetadataInputs([filePath], { includeCovers: false });
    assert.equal(analyzed.items[0].metadata.Title, 'New title');
});

test('EPUB 스트리밍 복사 도중 취소하면 원본을 유지하고 오류 및 임시출력을 남기지 않는다', async t => {
    const { directory, filePath, original } = await fixture(t);
    const open = fsp.open.bind(fsp);
    let cancel = false;
    t.mock.method(fsp, 'open', async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx' && String(args[0]).endsWith('.zip-update')) {
            const write = handle.write.bind(handle);
            handle.write = async (...writeArgs) => {
                const result = await write(...writeArgs);
                if (writeArgs[2] >= 256 * 1024) cancel = true;
                return result;
            };
        }
        return handle;
    });
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'Cancelled title' } }], { backup_on: true, shouldCancel: () => cancel });
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(result.stats.success, []);
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['book.epub', 'new-cover.png']);
});
