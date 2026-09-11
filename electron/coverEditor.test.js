import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { applyCoverEditor, inspectCoverEditor, loadCoverEditorImage } from './coverEditor.js';
import { resolveCoverEditorSevenZPath } from './coverEditorBinary.js';
import { LibraryDB } from './database/library_db.js';
import { saveLocalCoverOverride } from './documentCoverEditor.js';
import { crc32, listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';
import { inspectFolderFile } from './tasks/folderScanTask.js';
import { loadMetadataCover, listMetadataEpubImages } from './tasks/metadataTask.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const OLD_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');

async function fixture(t, extension = '.cbz') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-service-'));
    const filePath = path.join(directory, `book${extension}`);
    const imagePath = path.join(directory, 'new-cover.png');
    const dbPath = path.join(directory, 'data', 'library.db');
    const thumbnailDir = path.join(directory, 'data', 'thumbnails');
    const libraryDb = new LibraryDB({ dbPath });
    await fs.writeFile(imagePath, PNG);
    const { imageVersion } = await loadCoverEditorImage(imagePath);
    t.after(async () => {
        await libraryDb.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    return { directory, filePath, imagePath, imageVersion, dbPath, thumbnailDir, libraryDb };
}

async function zipFixture(filePath, entries) {
    await fs.writeFile(filePath, Buffer.alloc(0));
    for (const [name, content] of Object.entries(entries)) await replaceZipEntry(filePath, name, content);
}

async function comicFixture(f) {
    await zipFixture(f.filePath, {
        'part/001.png': OLD_PNG,
        'part/002.png': Buffer.concat([OLD_PNG, Buffer.from('original page two')]),
        'ComicInfo.xml': '<ComicInfo><Title>Original title</Title><PageCount>2</PageCount><Custom keep="yes"/><Pages><Page Image="0" Type="FrontCover" Bookmark="original cover"/><Page Image="1" Bookmark="chapter"/></Pages></ComicInfo>',
        'notes.txt': 'Original sidecar text',
    });
}

async function contents(filePath) {
    const buffer = await fs.readFile(filePath);
    return Object.fromEntries(listZipEntries(buffer).filter(entry => !entry.isDirectory)
        .map(entry => [entry.name, readZipEntry(buffer, entry)]));
}

async function assertNoWorkingFiles(directory) {
    assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.bookmanager-cover-') || name.endsWith('.zip-update')), []);
}

test('ZIP/CBZ 표지 교체는 원래 바이트를 백업하고 본문과 메타데이터를 보존한다', async t => {
    for (const extension of ['.zip', '.cbz']) {
        const f = await fixture(t, extension);
        await comicFixture(f);
        const original = await fs.readFile(f.filePath);
        const before = await contents(f.filePath);
        await f.libraryDb.upsertFileInfo({ path: f.filePath, title: 'Original title', thumb_path: 'old-thumbnail.png' });
        const descriptor = await inspectCoverEditor(f.filePath, f);
        const refreshed = [];
        const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace', targetEntry: descriptor.coverEntry }, {
            ...f,
            async refreshFilePreview(filePath) { refreshed.push(filePath); },
        });
        const after = await contents(f.filePath);
        assert.equal(result.success, true);
        assert.equal(result.filePath, f.filePath);
        assert.equal(result.converted, false);
        assert.deepEqual(await fs.readFile(result.backupPath), original);
        assert.deepEqual(after[descriptor.coverEntry], PNG);
        assert.deepEqual(after['part/002.png'], before['part/002.png']);
        assert.equal(after['notes.txt'].toString(), 'Original sidecar text');
        assert.match(after['ComicInfo.xml'].toString(), /<Custom keep="yes"\/>/);
        assert.deepEqual(refreshed, [f.filePath]);
        assert.equal((await f.libraryDb.getFileInfo(f.filePath)).thumb_path, '');
        const updated = await inspectCoverEditor(f.filePath, f);
        assert.equal(updated.coverDataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
        assert.notEqual(updated.version, descriptor.version);
        await assertNoWorkingFiles(f.directory);
    }
});

test('앞표지 추가와 파일명 재정렬은 기존 모든 페이지를 유지하고 원본을 백업한다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    const original = await fs.readFile(f.filePath);
    const before = await contents(f.filePath);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'add', renumber: true }, f);
    const updated = await inspectCoverEditor(f.filePath, f);
    const after = await contents(f.filePath);
    assert.equal(updated.pageCount, 3);
    assert.deepEqual(after[updated.pages[0].name], PNG);
    assert.deepEqual(after[updated.pages[1].name], before['part/001.png']);
    assert.deepEqual(after[updated.pages[2].name], before['part/002.png']);
    assert.match(after['ComicInfo.xml'].toString(), /<PageCount>3<\/PageCount>/);
    assert.match(after['ComicInfo.xml'].toString(), /Image="2" Bookmark="chapter"/);
    assert.equal(after['notes.txt'].toString(), 'Original sidecar text');
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    await assertNoWorkingFiles(f.directory);
});

test('열어 둔 사이 원본이 변경되면 외부 변경을 보존하고 표지 저장을 거부한다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    await replaceZipEntry(f.filePath, 'external.txt', 'Changed by another application');
    const externalVersion = await fs.readFile(f.filePath);
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, f), { code: 'COVER_SOURCE_CHANGED' });
    assert.deepEqual(await fs.readFile(f.filePath), externalVersion);
    await assert.rejects(fs.stat(path.join(f.directory, 'bak')), { code: 'ENOENT' });
    await assertNoWorkingFiles(f.directory);
});

test('이미지를 준비하는 동안 원본이 바뀌어도 저장 직전 검사로 덮어쓰기를 막는다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    let externalVersion;
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, {
        ...f,
        async normalizeImage(buffer, mimeType) {
            await replaceZipEntry(f.filePath, 'external.txt', 'Changed while preparing the image');
            externalVersion = await fs.readFile(f.filePath);
            return { buffer, mimeType };
        },
    }), { code: 'COVER_SOURCE_CHANGED' });
    assert.deepEqual(await fs.readFile(f.filePath), externalVersion);
    await assertNoWorkingFiles(f.directory);
});

test('잘못된 이미지와 이미지 디코딩 실패는 원본 및 백업 상태를 바꾸지 않는다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    const original = await fs.readFile(f.filePath);
    await fs.writeFile(f.imagePath, 'not an image');
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, f), /image/);
    await fs.writeFile(f.imagePath, PNG);
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, {
        ...f,
        normalizeImage() { throw new Error('Image decoding failed'); },
    }), /Image decoding failed/);
    assert.deepEqual(await fs.readFile(f.filePath), original);
    await assert.rejects(fs.stat(path.join(f.directory, 'bak')), { code: 'ENOENT' });
    await assertNoWorkingFiles(f.directory);
});

test('미리보기 이후 이미지 파일이 변경되면 확인한 이미지와 달라 저장을 거부한다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    const original = await fs.readFile(f.filePath);
    await fs.writeFile(f.imagePath, OLD_PNG);
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, f), { code: 'IMAGE_SOURCE_CHANGED' });
    assert.deepEqual(await fs.readFile(f.filePath), original);
    await assert.rejects(fs.stat(path.join(f.directory, 'bak')), { code: 'ENOENT' });
    await assertNoWorkingFiles(f.directory);
});

test('EPUB 통합 표지 저장은 표지 외 OPF 메타데이터와 본문을 그대로 보존한다', async t => {
    const f = await fixture(t, '.epub');
    const metadata = '<dc:identifier id="id">original-id</dc:identifier><dc:title>원래 제목</dc:title><dc:creator>원래 저자</dc:creator><dc:language>en</dc:language><meta name="custom" content="keep"/>';
    await zipFixture(f.filePath, {
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        'OEBPS/content.opf': `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="id" version="3.0"><metadata>${metadata}<meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine></package>`,
        'OEBPS/cover.png': OLD_PNG,
        'OEBPS/cover.xhtml': '<html><body><img src="cover.png"/></body></html>',
        'OEBPS/chapter.xhtml': '<html><body>원래 본문</body></html>',
    });
    const original = await fs.readFile(f.filePath);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, f);
    const after = await contents(f.filePath);
    assert.ok(after['OEBPS/content.opf'].toString().includes(metadata));
    assert.equal(after['OEBPS/chapter.xhtml'].toString(), '<html><body>원래 본문</body></html>');
    assert.deepEqual(after[(await listMetadataEpubImages(f.filePath)).coverEntryName], PNG);
    assert.deepEqual(await fs.readFile(result.backupPath), original);
    await assertNoWorkingFiles(f.directory);
});

function pdfFixture() {
    const bodies = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << >> /Contents 4 0 R >>',
        '<< /Length 0 >>\nstream\n\nendstream',
        '<< /Title (Original PDF title) /Author (Original PDF author) >>',
    ];
    let output = '%PDF-1.4\n';
    const offsets = [];
    bodies.forEach((body, index) => {
        offsets.push(Buffer.byteLength(output));
        output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(output);
    output += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(output);
}

test('PDF 로컬 표지는 강제 파일 재조회와 표지 미리보기에 적용되고 원본 PDF는 유지된다', async t => {
    const f = await fixture(t, '.pdf');
    const original = pdfFixture();
    await fs.writeFile(f.filePath, original);
    const stat = await fs.stat(f.filePath);
    await inspectFolderFile(f.filePath, { ...f, force: true });
    const descriptor = await inspectCoverEditor(f.filePath, f);
    assert.equal(descriptor.storage, 'database');
    assert.equal(descriptor.canAdd, false);
    let preview;
    const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, {
        ...f,
        async refreshFilePreview(filePath) { preview = await inspectFolderFile(filePath, { ...f, force: true }); },
    });
    const saved = await f.libraryDb.getFileInfo(f.filePath);
    assert.equal(result.success, true);
    assert.equal(result.warning, '');
    assert.equal(result.backupPath, '');
    assert.ok(saved.cover_override_path);
    assert.equal(saved.thumb_path, saved.cover_override_path);
    assert.equal(preview.thumb_path, saved.cover_override_path);
    assert.equal(preview.title, 'Original PDF title');
    assert.equal(preview.writer, 'Original PDF author');
    assert.equal(Number(preview.page_count), 1);
    assert.deepEqual(await fs.readFile(saved.cover_override_path), PNG);
    assert.deepEqual(await fs.readFile(f.filePath), original);
    assert.equal((await fs.stat(f.filePath)).mtimeMs, stat.mtimeMs);
    assert.equal(await loadMetadataCover(f.filePath, f), `data:image/png;base64,${PNG.toString('base64')}`);
    assert.equal((await inspectCoverEditor(f.filePath, f)).coverDataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
    await assertNoWorkingFiles(f.directory);
});

function waveFixture() {
    const buffer = Buffer.alloc(46);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24);
    buffer.writeUInt32LE(16000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(2, 40);
    return buffer;
}

test('먼저 시작한 폴더 스캔은 이후 저장된 PDF와 오디오 로컬 표지를 덮어쓰지 않는다', async t => {
    for (const scenario of [
        { extension: '.pdf', previousCover: false },
        { extension: '.pdf', previousCover: true },
        { extension: '.wav', previousCover: true },
    ]) {
        await t.test(`${scenario.extension} ${scenario.previousCover ? '교체' : '첫 저장'}`, async t => {
            const f = await fixture(t, scenario.extension);
            await fs.writeFile(f.filePath, scenario.extension === '.pdf' ? pdfFixture() : waveFixture());
            const previous = scenario.previousCover ? await saveLocalCoverOverride(f.filePath, f.imagePath, f) : null;
            let reachedSave;
            let resumeSave;
            const reached = new Promise(resolve => { reachedSave = resolve; });
            const paused = new Promise(resolve => { resumeSave = resolve; });
            const scanDb = new Proxy(f.libraryDb, {
                get(target, key) {
                    if (key === 'upsertFileInfo') return async (...args) => {
                        reachedSave();
                        await paused;
                        return target.upsertFileInfo(...args);
                    };
                    const value = Reflect.get(target, key);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            const pendingScan = inspectFolderFile(f.filePath, { ...f, libraryDb: scanDb, force: true });
            try {
                await Promise.race([reached, pendingScan.then(() => { throw new Error('Scan did not reach its cache write.'); })]);
                if (scenario.extension === '.pdf') {
                    const descriptor = await inspectCoverEditor(f.filePath, f);
                    const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, {
                        ...f,
                        refreshFilePreview: filePath => inspectFolderFile(filePath, { ...f, force: true }),
                    });
                    assert.equal(result.success, true);
                    assert.equal(result.warning, '');
                } else {
                    await saveLocalCoverOverride(f.filePath, f.imagePath, f);
                    await inspectFolderFile(f.filePath, { ...f, force: true });
                }
                const saved = await f.libraryDb.getFileInfo(f.filePath);
                resumeSave();
                const scanResult = await pendingScan;
                const final = await f.libraryDb.getFileInfo(f.filePath);
                assert.ok(saved.cover_override_path);
                assert.notEqual(saved.cover_override_path, previous?.coverPath);
                assert.equal(final.cover_override_path, saved.cover_override_path);
                assert.equal(final.thumb_path, saved.cover_override_path);
                assert.equal(scanResult.cover_override_path, saved.cover_override_path);
                assert.equal(scanResult.coverOverridePath, saved.cover_override_path);
                assert.equal(scanResult.thumb_path, saved.cover_override_path);
                assert.deepEqual(await fs.readFile(final.cover_override_path), PNG);
                if (previous) await assert.rejects(fs.stat(previous.coverPath), { code: 'ENOENT' });
            } finally {
                resumeSave();
                await pendingScan;
            }
        });
    }
});

test('표지 파일 교체 후 DB 갱신 실패 시 원본 파일과 기존 DB 기록을 복원한다', async t => {
    const f = await fixture(t);
    await comicFixture(f);
    await f.libraryDb.upsertFileInfo({ path: f.filePath, title: 'Original title', thumb_path: 'original.png' });
    const original = await fs.readFile(f.filePath);
    const record = await f.libraryDb.getFileInfo(f.filePath);
    const descriptor = await inspectCoverEditor(f.filePath, f);
    f.libraryDb.getConnection().exec("CREATE TRIGGER reject_cover_service BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT, 'cover service DB failure'); END;");
    await assert.rejects(applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace' }, f), /cover service DB failure/);
    assert.deepEqual(await fs.readFile(f.filePath), original);
    assert.deepEqual(await f.libraryDb.getFileInfo(f.filePath), record);
    const backupNames = await fs.readdir(path.join(f.directory, 'bak'));
    assert.equal(backupNames.length, 1);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'bak', backupNames[0])), original);
    await assertNoWorkingFiles(f.directory);
    f.libraryDb.getConnection().exec('DROP TRIGGER reject_cover_service');
    const retry = await inspectCoverEditor(f.filePath, f);
    const saved = await applyCoverEditor({ ...retry, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'replace', backup: false }, f);
    assert.equal(saved.success, true);
});

test('7z와 CB7 조회는 원본 버전을 변경하지 않고 같은 컨테이너에 표지를 저장한다', async t => {
    const sevenZExe = createRequire(import.meta.url)('7zip-bin').path7za;
    for (const extension of ['.7z', '.cb7']) {
        const f = await fixture(t, extension);
        const inputDirectory = path.join(f.directory, 'input');
        await fs.mkdir(inputDirectory);
        await fs.writeFile(path.join(inputDirectory, '001.png'), OLD_PNG);
        await fs.writeFile(path.join(inputDirectory, 'note.txt'), 'Keep source note');
        const packed = spawnSync(sevenZExe, ['a', '-t7z', f.filePath, '.'], { cwd: inputDirectory, encoding: 'utf8' });
        assert.equal(packed.status, 0, packed.stderr);
        const original = await fs.readFile(f.filePath);
        const stat = await fs.stat(f.filePath);
        const descriptor = await inspectCoverEditor(f.filePath, { ...f, sevenZExe });
        assert.equal((await fs.stat(f.filePath)).ctimeMs, stat.ctimeMs);
        const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'add', renumber: true }, { ...f, sevenZExe });
        assert.equal(result.filePath, f.filePath);
        assert.equal(result.converted, false);
        assert.deepEqual(await fs.readFile(result.backupPath), original);
        assert.equal((await fs.readFile(f.filePath)).subarray(0, 6).toString('hex'), '377abcaf271c');
        assert.equal((await inspectCoverEditor(f.filePath, { ...f, sevenZExe })).pageCount, 2);
        const note = spawnSync(sevenZExe, ['e', '-so', f.filePath, 'note.txt'], { encoding: 'utf8' });
        assert.equal(note.status, 0, note.stderr);
        assert.equal(note.stdout, 'Keep source note');
        await assertNoWorkingFiles(f.directory);
    }
});

function storedRar(entries) {
    const main = Buffer.alloc(13);
    main[2] = 0x73;
    main.writeUInt16LE(13, 5);
    main.writeUInt16LE(crc32(main.subarray(2)) & 0xffff, 0);
    const parts = [Buffer.from('526172211a0700', 'hex'), main];
    for (const [name, content] of Object.entries(entries)) {
        const nameBytes = Buffer.from(name);
        const header = Buffer.alloc(32 + nameBytes.length);
        header[2] = 0x74;
        header.writeUInt16LE(0x8000, 3);
        header.writeUInt16LE(header.length, 5);
        header.writeUInt32LE(content.length, 7);
        header.writeUInt32LE(content.length, 11);
        header[15] = 3;
        header.writeUInt32LE(crc32(content), 16);
        header[24] = 20;
        header[25] = 0x30;
        header.writeUInt16LE(nameBytes.length, 26);
        header.writeUInt32LE(0x81a4, 28);
        nameBytes.copy(header, 32);
        header.writeUInt16LE(crc32(header.subarray(2)) & 0xffff, 0);
        parts.push(header, content);
    }
    return Buffer.concat(parts);
}

test('RAR 저장은 기존 원본과 동명 CBZ를 보존한 새 CBZ에 표지를 추가한다', async t => {
    const sevenZExe = await resolveCoverEditorSevenZPath(createRequire(import.meta.url)('7zip-bin').path7za);
    const capabilities = spawnSync(sevenZExe, ['i'], { encoding: 'utf8' });
    if (capabilities.error || !/\sRar\s/.test(capabilities.stdout || '')) return t.skip('A 7-Zip executable with RAR support is unavailable.');
    const f = await fixture(t, '.rar');
    const original = storedRar({ '001.png': OLD_PNG, 'note.txt': Buffer.from('Original note') });
    await fs.writeFile(f.filePath, original);
    const existingDestination = path.join(f.directory, 'book_cover.cbz');
    await fs.writeFile(existingDestination, 'Do not overwrite');
    const descriptor = await inspectCoverEditor(f.filePath, { ...f, sevenZExe });
    assert.equal(descriptor.conversion, true);
    const result = await applyCoverEditor({ ...descriptor, imagePath: f.imagePath, imageVersion: f.imageVersion, mode: 'add', renumber: true }, { ...f, sevenZExe });
    assert.equal(result.converted, true);
    assert.equal(result.filePath, path.join(f.directory, 'book_cover_1.cbz'));
    assert.deepEqual(await fs.readFile(f.filePath), original);
    assert.equal(await fs.readFile(existingDestination, 'utf8'), 'Do not overwrite');
    const after = await contents(result.filePath);
    const updated = await inspectCoverEditor(result.filePath, f);
    assert.equal(updated.pageCount, 2);
    assert.deepEqual(after[updated.pages[0].name], PNG);
    assert.deepEqual(after[updated.pages[1].name], OLD_PNG);
    assert.equal(after['note.txt'].toString(), 'Original note');
    await assertNoWorkingFiles(f.directory);
});
