import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadMetadataCover, listMetadataEpubImages, writeEpubCoverOnly } from './tasks/metadataTask.js';
import { getZipEntryCompressedData, listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
const originalMetadata = [
    '<dc:identifier id="book-id">urn:uuid:original-book</dc:identifier>',
    '<dc:title id="original-title">원래 제목</dc:title>',
    '<dc:creator id="author">원래 저자</dc:creator>',
    '<meta refines="#author" property="role" scheme="marc:relators">aut</meta>',
    '<dc:language>ja</dc:language>',
    '<dc:description>소개 &amp; 내용</dc:description>',
    '<dc:date>2020-02-03</dc:date>',
    '<meta property="dcterms:modified">2021-01-01T00:00:00Z</meta>',
    '<meta name="custom-key" content="그대로 보존"/>',
].join('\n');

async function fixture(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-cover-only-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    const imagePath = path.join(directory, 'new-cover.png');
    const coverName = `OEBPS/images/cover.${options.oldExtension || 'png'}`;
    const coverHref = coverName.slice('OEBPS/'.length);
    const oldCover = Buffer.from('existing cover image');
    const oldPage = `<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="${coverHref}" alt="old cover"/></body></html>`;
    const chapter = '<html><body>원래 본문과 이미지 <img src="images/illustration.png"/></body></html>';
    const opf = `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="book-id" version="3.0">
<metadata>${originalMetadata}
<meta name="cover" content="old-cover-image"/></metadata>
<manifest>
<item id="old-cover-image" href="${coverHref}" media-type="image/${options.oldExtension === 'jpg' ? 'jpeg' : 'png'}" properties="cover-image"/>
<item id="old-cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine><itemref idref="old-cover-page"/><itemref idref="chapter"/></spine>
<guide><reference type="cover" title="Original cover" href="cover.xhtml"/></guide>
</package>`;
    fs.writeFileSync(filePath, Buffer.alloc(0));
    fs.writeFileSync(imagePath, PNG);
    for (const [name, content] of [
        ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
        ['OEBPS/content.opf', opf],
        [coverName, oldCover],
        ['OEBPS/cover.xhtml', oldPage],
        ['OEBPS/chapter.xhtml', chapter],
        ['OEBPS/images/illustration.png', PNG],
        ['OEBPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a><a epub:type="bodymatter" href="chapter.xhtml">본문</a></nav></body></html>'],
        ['META-INF/custom.bin', Buffer.from('unchanged auxiliary data')],
    ]) await replaceZipEntry(filePath, name, content);
    return { directory, filePath, imagePath, coverName, oldCover, oldPage, chapter, opf };
}

function archive(filePath) {
    const buffer = fs.readFileSync(filePath);
    const entries = listZipEntries(buffer);
    return {
        buffer, entries,
        read(name) { return readZipEntry(buffer, entries.find(entry => entry.name === name)); },
        compressed(name) { return getZipEntryCompressedData(buffer, entries.find(entry => entry.name === name)); },
    };
}

test('EPUB 표지만 교체하고 모든 원래 메타데이터, 본문, 부가파일을 보존한다', async t => {
    const f = await fixture(t);
    const before = archive(f.filePath);
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath, { mode: 'replace' });
    const after = archive(f.filePath);
    const opf = after.read('OEBPS/content.opf').toString();
    assert.equal(result.coverEntry, f.coverName);
    assert.equal(result.coverPageEntry, 'OEBPS/cover.xhtml');
    assert.equal(result.readingPageOffset, 0);
    assert.deepEqual(after.read(f.coverName), PNG);
    assert.ok(opf.includes(originalMetadata));
    assert.match(opf, /unique-identifier="book-id"/);
    assert.match(opf, /<meta name="cover" content="old-cover-image" \/>/);
    assert.match(after.read(result.coverPageEntry).toString(), /src="images\/cover.png"/);
    assert.match(opf, /<spine>\s*<itemref idref="old-cover-page" linear="yes" \/>\s*<itemref idref="chapter"\/>/);
    for (const entry of ['OEBPS/chapter.xhtml', 'OEBPS/images/illustration.png', 'META-INF/custom.bin']) {
        assert.deepEqual(after.compressed(entry), before.compressed(entry));
    }
    assert.equal(after.entries[0].name, 'mimetype');
    assert.equal(after.entries[0].method, 0);
    assert.equal((await listMetadataEpubImages(f.filePath)).coverEntryName, f.coverName);
    assert.equal(await loadMetadataCover(f.filePath), `data:image/png;base64,${PNG.toString('base64')}`);
});

test('표지 이미지 형식이 바뀌면 기존 이미지를 보존하고 새 이미지와 표지 페이지 참조를 연결한다', async t => {
    const f = await fixture(t, { oldExtension: 'jpg' });
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath);
    const after = archive(f.filePath);
    assert.notEqual(result.coverEntry, f.coverName);
    assert.deepEqual(after.read(f.coverName), f.oldCover);
    assert.deepEqual(after.read(result.coverEntry), PNG);
    assert.match(after.read(result.coverPageEntry).toString(), /src="images\/bookmanager-cover.png"/);
    assert.equal((await listMetadataEpubImages(f.filePath)).coverEntryName, result.coverEntry);
    assert.ok(after.read('OEBPS/content.opf').toString().includes(originalMetadata));
});

test('표지가 지정되지 않은 EPUB은 본문 삽화를 덮어쓰지 않고 새 표지를 만든다', async t => {
    const f = await fixture(t);
    await replaceZipEntry(f.filePath, 'OEBPS/content.opf', `<package><metadata>${originalMetadata}</metadata><manifest><item id="art" href="images/illustration.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
    const before = archive(f.filePath);
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath);
    const after = archive(f.filePath);
    assert.notEqual(result.coverEntry, f.coverName);
    assert.notEqual(result.coverEntry, 'OEBPS/images/illustration.png');
    assert.deepEqual(after.compressed(f.coverName), before.compressed(f.coverName));
    assert.deepEqual(after.compressed('OEBPS/images/illustration.png'), before.compressed('OEBPS/images/illustration.png'));
    assert.deepEqual(after.compressed('OEBPS/chapter.xhtml'), before.compressed('OEBPS/chapter.xhtml'));
    assert.equal((await listMetadataEpubImages(f.filePath)).coverEntryName, result.coverEntry);
    assert.equal(result.readingPageOffset, 1);
});

test('앞표지를 추가하면 기존 표지 이미지와 페이지를 보존하고 새 페이지를 맨 앞에 삽입한다', async t => {
    const f = await fixture(t);
    await replaceZipEntry(f.filePath, 'OEBPS/images/bookmanager-cover.png', Buffer.from('reserved image'));
    await replaceZipEntry(f.filePath, 'OEBPS/bookmanager-cover.xhtml', '<html>reserved page</html>');
    const before = archive(f.filePath);
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath, { mode: 'add' });
    const after = archive(f.filePath);
    const opf = after.read('OEBPS/content.opf').toString();
    assert.equal(result.coverEntry, 'OEBPS/images/bookmanager-cover-2.png');
    assert.equal(result.coverPageEntry, 'OEBPS/bookmanager-cover-2.xhtml');
    assert.equal(result.readingPageOffset, 1);
    for (const name of [f.coverName, 'OEBPS/cover.xhtml', 'OEBPS/images/bookmanager-cover.png', 'OEBPS/bookmanager-cover.xhtml', 'OEBPS/chapter.xhtml']) {
        assert.deepEqual(after.compressed(name), before.compressed(name));
    }
    assert.ok(opf.includes(originalMetadata));
    assert.match(opf, /<spine>\s*<itemref idref="bookmanager-cover-page" linear="yes" \/><itemref idref="old-cover-page"\/><itemref idref="chapter"\/>/);
    assert.match(opf, /<reference type="cover" title="Cover" href="bookmanager-cover-2.xhtml" \/>/);
    assert.match(after.read('OEBPS/nav.xhtml').toString(), /epub:type="cover" href="bookmanager-cover-2.xhtml"/);
    assert.match(after.read('OEBPS/nav.xhtml').toString(), /epub:type="bodymatter" href="chapter.xhtml"/);
    assert.equal((await listMetadataEpubImages(f.filePath)).coverEntryName, result.coverEntry);
});

test('기존 표지 경로에 공백과 # 및 %가 있어도 이미지와 탐색 참조를 올바르게 인코딩한다', async t => {
    const f = await fixture(t);
    const coverName = 'OEBPS/images/표지 #100%.png';
    const pageName = 'OEBPS/표지 #100%.xhtml';
    const imageHref = coverName.slice('OEBPS/'.length).split('/').map(encodeURIComponent).join('/');
    const pageHref = encodeURIComponent(path.posix.basename(pageName));
    await replaceZipEntry(f.filePath, coverName, f.oldCover);
    await replaceZipEntry(f.filePath, pageName, f.oldPage);
    await replaceZipEntry(f.filePath, 'OEBPS/content.opf', f.opf.replaceAll('images/cover.png', imageHref).replaceAll('cover.xhtml', pageHref));
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath);
    const after = archive(f.filePath);
    assert.equal(result.coverEntry, coverName);
    assert.equal(result.coverPageEntry, pageName);
    assert.ok(after.read(pageName).toString().includes(`src="${imageHref}"`));
    assert.ok(after.read('OEBPS/content.opf').toString().includes(`type="cover" title="Cover" href="${pageHref}"`));
    assert.ok(after.read('OEBPS/nav.xhtml').toString().includes(`epub:type="cover" href="${pageHref}"`));
    assert.equal((await listMetadataEpubImages(f.filePath)).coverEntryName, coverName);
});

test('잘못된 이미지, 변경 방식, 내부 경로 및 서명은 EPUB을 바꾸기 전에 거부한다', async t => {
    for (const variant of ['image', 'mode', 'path', 'encoded-path', 'duplicate', 'package-path', 'reference', 'signature']) {
        const f = await fixture(t);
        if (variant === 'image') fs.writeFileSync(f.imagePath, 'not an image');
        if (variant === 'path') await replaceZipEntry(f.filePath, '../outside.png', PNG);
        if (variant === 'encoded-path') await replaceZipEntry(f.filePath, '%2e%2e/outside.png', PNG);
        if (variant === 'duplicate') await replaceZipEntry(f.filePath, 'OEBPS/images/%63over.png', PNG);
        if (variant === 'package-path') await replaceZipEntry(f.filePath, 'META-INF/container.xml', '<container><rootfiles><rootfile full-path="/OEBPS/content.opf"/></rootfiles></container>');
        if (variant === 'reference') await replaceZipEntry(f.filePath, 'OEBPS/content.opf', f.opf.replace('href="cover.xhtml"', 'href="../../outside.xhtml"'));
        if (variant === 'signature') await replaceZipEntry(f.filePath, 'META-INF/signatures.xml', '<signatures/>');
        const before = fs.readFileSync(f.filePath);
        await assert.rejects(writeEpubCoverOnly(f.filePath, f.imagePath, { mode: variant === 'mode' ? 'delete' : 'replace' }), undefined, variant);
        assert.deepEqual(fs.readFileSync(f.filePath), before, variant);
    }
});

test('DRM은 거부하지만 알려진 글꼴 난독화는 식별자와 글꼴을 그대로 유지하여 허용한다', async t => {
    for (const [algorithm, target, allowed] of [
        ['http://www.idpf.org/2008/embedding', 'OEBPS/fonts/book.otf', true],
        ['http://ns.adobe.com/pdf/enc#RC', 'OEBPS/fonts/book.otf', true],
        ['http://www.w3.org/2001/04/xmlenc#aes256-cbc', 'OEBPS/chapter.xhtml', false],
        ['http://www.idpf.org/2008/embedding', 'OEBPS/chapter.xhtml', false],
    ]) {
        const f = await fixture(t);
        const encryption = `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${target}"/></enc:CipherData></enc:EncryptedData></encryption>`;
        await replaceZipEntry(f.filePath, 'META-INF/encryption.xml', encryption);
        await replaceZipEntry(f.filePath, 'OEBPS/fonts/book.otf', Buffer.from('obfuscated font bytes'));
        const before = archive(f.filePath);
        if (allowed) {
            await writeEpubCoverOnly(f.filePath, f.imagePath);
            const after = archive(f.filePath);
            assert.deepEqual(after.compressed('META-INF/encryption.xml'), before.compressed('META-INF/encryption.xml'));
            assert.deepEqual(after.compressed('OEBPS/fonts/book.otf'), before.compressed('OEBPS/fonts/book.otf'));
            assert.ok(after.read('OEBPS/content.opf').toString().includes(originalMetadata));
        } else {
            await assert.rejects(writeEpubCoverOnly(f.filePath, f.imagePath), /DRM/);
            assert.deepEqual(fs.readFileSync(f.filePath), before.buffer);
        }
    }
});

test('취소되거나 파일 교체가 실패하면 전달받은 EPUB도 변경하지 않는다', async t => {
    const f = await fixture(t);
    const before = fs.readFileSync(f.filePath);
    await assert.rejects(writeEpubCoverOnly(f.filePath, f.imagePath, { shouldCancel: () => true }), { code: 'TASK_CANCELLED' });
    assert.deepEqual(fs.readFileSync(f.filePath), before);
    const originalRename = fsp.rename.bind(fsp);
    t.mock.method(fsp, 'rename', async (source, target) => {
        if (source.endsWith('.zip-update')) throw new Error('Synthetic replace failure');
        return originalRename(source, target);
    });
    await assert.rejects(writeEpubCoverOnly(f.filePath, f.imagePath), /Synthetic replace failure/);
    assert.deepEqual(fs.readFileSync(f.filePath), before);
    assert.deepEqual(fs.readdirSync(f.directory).sort(), ['book.epub', 'new-cover.png']);
});

test('PDF 표지 미리보기는 라이브러리에 저장된 로컬 표지를 먼저 읽는다', async t => {
    const f = await fixture(t);
    const pdfPath = path.join(f.directory, 'book.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\n');
    const cover = await loadMetadataCover(pdfPath, {
        libraryDb: { async getFileInfo() { return { cover_override_path: f.imagePath }; } },
    });
    assert.equal(cover, `data:image/png;base64,${PNG.toString('base64')}`);
});

test('spine 밖 선언 표지가 이미 가상 첫 장이면 새 표지의 읽기 위치 증분은 0이다', async t => {
    for (const mode of ['add', 'replace']) {
        const f = await fixture(t);
        await replaceZipEntry(f.filePath, 'OEBPS/content.opf', f.opf.replace('<itemref idref="old-cover-page"/>', ''));
        const manager = new ViewerSessionManager();
        const session = manager.create(f.filePath, { skipAdjacent: true });
        const before = await manager.getEpubText(session.id);
        assert.equal(before.chapters[0].name, f.coverName);
        const result = await writeEpubCoverOnly(f.filePath, f.imagePath, { mode });
        const after = await manager.getEpubText(session.id);
        assert.equal(result.readingPageOffset, 0, mode);
        assert.equal(after.chapters.length, before.chapters.length);
        assert.equal(after.chapters[0].name, result.coverPageEntry);
        assert.deepEqual(after.chapters.slice(1), before.chapters.slice(1));
    }
});

test('추가 표지의 스타일은 기존 본문 stylesheet와 페이지 내용을 바꾸지 않는다', async t => {
    const f = await fixture(t);
    await replaceZipEntry(f.filePath, 'OEBPS/chapter.xhtml', '<html><head><style>p { margin: 2em; text-align: left; }</style></head><body><p>원래 본문</p></body></html>');
    const manager = new ViewerSessionManager();
    const session = manager.create(f.filePath, { skipAdjacent: true });
    const before = await manager.getEpubText(session.id);
    const result = await writeEpubCoverOnly(f.filePath, f.imagePath, { mode: 'add' });
    const after = await manager.getEpubText(session.id);
    assert.equal(result.readingPageOffset, 1);
    assert.equal(after.stylesheet, before.stylesheet);
    assert.deepEqual(after.chapters.slice(1).map(({ chapterIndex, title, ...chapter }) => chapter), before.chapters.map(({ chapterIndex, title, ...chapter }) => chapter));
    assert.equal(after.chapters[2].title, before.chapters[1].title);
    const cover = archive(f.filePath).read(result.coverPageEntry).toString();
    assert.doesNotMatch(cover, /<style\b/);
    assert.match(cover, /<img[^>]*style="max-width: 100%; height: auto;"/);
});

test('표지 페이지의 본문이나 공유 스타일이 바뀌면 숫자 페이지 이동량을 추정하지 않는다', async t => {
    for (const oldPage of [
        '<html><body><p>표지에 포함된 긴 소개 본문</p><img src="images/cover.png"/></body></html>',
        '<html><head><style>p { margin: 3em; }</style></head><body><img src="images/cover.png"/></body></html>',
    ]) {
        const f = await fixture(t);
        await replaceZipEntry(f.filePath, 'OEBPS/cover.xhtml', oldPage);
        const result = await writeEpubCoverOnly(f.filePath, f.imagePath, { mode: 'replace' });
        assert.equal(result.readingPageOffset, null);
    }
});
