import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';
import { replaceZipEntry } from './core/zipArchive.js';

function pngHeader(width, height) {
    const buffer = Buffer.alloc(24);
    buffer[0] = 0x89;
    buffer.write('PNG', 1, 'ascii');
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

function silentWav(durationSeconds = 1, sampleRate = 8000) {
    const sampleCount = Math.max(1, Math.round(durationSeconds * sampleRate));
    const dataLength = sampleCount * 2;
    const buffer = Buffer.alloc(44 + dataLength);
    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

test('TXT 뷰어 세션은 24MB를 초과하는 파일을 읽는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-large-text-'));
    try {
        const textPath = path.join(root, 'large.txt');
        const text = `${'가'.repeat(8 * 1024 * 1024)}끝`;
        fs.writeFileSync(textPath, text, 'utf8');
        assert.equal(fs.statSync(textPath).size > 24 * 1024 * 1024, true);

        const manager = new ViewerSessionManager();
        const session = manager.create(textPath);
        const result = await manager.getText(session.id, { encoding: 'utf-8' });

        assert.equal(result.text.length, text.length);
        assert.equal(result.text.endsWith('끝'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('뷰어 세션 제한을 넘어도 리더와 오디오의 최신 세션을 각각 유지한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-session-kinds-'));
    try {
        const readerPath = path.join(root, 'reader.pdf');
        fs.writeFileSync(readerPath, '');

        const manager = new ViewerSessionManager();
        const reader = manager.create(readerPath, { skipAdjacent: true });
        let firstAudio = null;
        let latestAudio = null;

        for (let index = 1; index <= 24; index += 1) {
            const audioPath = path.join(root, `track-${index}.mp3`);
            fs.writeFileSync(audioPath, '');
            latestAudio = manager.create(audioPath, { skipAdjacent: true });
            if (!firstAudio) firstAudio = latestAudio;
        }

        assert.equal(manager.sessions.size, 16);
        assert.equal(manager.get(reader.id), reader);
        assert.equal(manager.current('reader'), reader);
        assert.equal(manager.current('audio'), latestAudio);
        assert.equal(manager.current(), latestAudio);
        assert.throws(() => manager.get(firstAudio.id), /Viewer session not found\./);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('뷰어 세션은 같은 폴더의 이전권/다음권 가능 여부를 계산한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-adjacent-'));
    try {
        const firstPath = path.join(root, '01.pdf');
        const secondPath = path.join(root, '02.pdf');
        const thirdPath = path.join(root, '03.pdf');
        const ignoredPath = path.join(root, 'cover.jpg');
        fs.writeFileSync(firstPath, '');
        fs.writeFileSync(secondPath, '');
        fs.writeFileSync(thirdPath, '');
        fs.writeFileSync(ignoredPath, '');

        const manager = new ViewerSessionManager();
        const first = manager.create(firstPath);
        assert.deepEqual(first.adjacent, { hasPrevious: false, hasNext: true });
        assert.throws(() => manager.createAdjacent(first.id, -1), /No adjacent book\./);

        const second = manager.createAdjacent(first.id, 1);
        assert.equal(second.filePath, path.resolve(secondPath));
        assert.deepEqual(second.adjacent, { hasPrevious: true, hasNext: true });
        assert.equal(
            manager.resolveDocumentRequest(`bookmanager-document://session/${encodeURIComponent(first.id)}/01.pdf`).filePath,
            path.resolve(firstPath),
        );

        const third = manager.createAdjacent(second.id, 1);
        assert.equal(third.filePath, path.resolve(thirdPath));
        assert.deepEqual(third.adjacent, { hasPrevious: true, hasNext: false });
        assert.throws(() => manager.createAdjacent(third.id, 1), /No adjacent book\./);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('오디오북 뷰어 세션은 같은 폴더의 오디오만 자연 정렬하고 범위 스트리밍 URL을 제공한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-audio-'));
    try {
        const firstPath = path.join(root, 'Track 1.mp3');
        const secondPath = path.join(root, 'Track 2.wav');
        const thirdPath = path.join(root, 'Track 10.m4b');
        const coverOverridePath = path.join(root, 'audio-cover-override.png');
        const coverOverride = Buffer.concat([pngHeader(1, 1), Buffer.from('audio-cover-override')]);
        fs.writeFileSync(firstPath, 'not-real-mp3');
        fs.writeFileSync(secondPath, silentWav());
        fs.writeFileSync(thirdPath, 'not-real-m4b');
        fs.writeFileSync(path.join(root, 'Track 3.pdf'), 'pdf');
        fs.writeFileSync(coverOverridePath, coverOverride);

        const manager = new ViewerSessionManager({
            getAudioLibraryRecord: async filePath => filePath === path.resolve(secondPath) ? {
                metadata_override: 1,
                title: 'DB Audio Title',
                series: 'DB Series',
                writer: 'DB Narrator',
                album: 'DB Album',
                album_artist: 'DB Album Artist',
                composer: 'DB Composer',
                genre: 'Fiction',
                publish_date: '2026',
                track_number: '2',
                track_total: '10',
                disc_number: '1',
                disc_total: '2',
                duration_seconds: 345.5,
                bitrate: 96000,
                sample_rate: 48000,
                codec: 'AAC LC',
                container: 'MPEG-4',
                channels: 2,
                mime_type: 'audio/mp4',
                cover_override_path: coverOverridePath,
            } : null,
        });
        const session = manager.create(secondPath);
        assert.equal(session.type, 'audio');
        assert.deepEqual(session.adjacent, { hasPrevious: true, hasNext: true });

        const queue = manager.listAudioQueue(session.id);
        assert.equal(queue.currentIndex, 1);
        assert.deepEqual(queue.items.map(item => item.fileName), [
            'Track 1.mp3',
            'Track 2.wav',
            'Track 10.m4b',
        ]);
        assert.deepEqual(queue.items.map(item => item.current), [false, true, false]);

        const next = manager.createAdjacent(session.id, 1);
        assert.equal(next.filePath, path.resolve(thirdPath));
        assert.equal(next.type, 'audio');
        const selected = manager.createAudioQueueItem(next.id, 'Track 1.mp3');
        assert.equal(selected.filePath, path.resolve(firstPath));

        const audioData = await manager.getAudioData(session.id);
        assert.equal(audioData.mime, 'audio/wav');
        assert.match(audioData.documentUrl, /^bookmanager-document:\/\/session\//);
        assert.equal(audioData.metadata.title, 'DB Audio Title');
        assert.equal(audioData.metadata.artist, 'DB Narrator');
        assert.equal(audioData.metadata.album, 'DB Album');
        assert.equal(audioData.metadata.trackNumber, 2);
        assert.equal(audioData.metadata.durationSeconds, 345.5);
        assert.equal(audioData.metadata.mimeType, 'audio/mp4');
        assert.match(audioData.metadata.artworkDataUrl, /^data:image\/png;base64,/);
        assert.deepEqual(
            Buffer.from(audioData.metadata.artworkDataUrl.split(',')[1], 'base64'),
            coverOverride,
        );
        assert.equal('artworkBuffer' in audioData.metadata, false);

        const request = manager.resolveDocumentRequest(audioData.documentUrl);
        assert.equal(request.filePath, path.resolve(secondPath));
        assert.equal(request.mime, 'audio/wav');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 뷰어 세션은 하위 폴더의 느낌표 접두 페이지를 가장 먼저 정렬한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-comic-first-page-prefix-'));
    try {
        const comicPath = path.join(root, 'First Page Prefix.cbz');
        fs.writeFileSync(comicPath, Buffer.alloc(0));
        await replaceZipEntry(comicPath, '001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(comicPath, '010.jpg', Buffer.from('page-10'));
        await replaceZipEntry(comicPath, 'extra/!000.jpg', Buffer.from('cover'));

        const manager = new ViewerSessionManager();
        const session = manager.create(comicPath, { skipAdjacent: true });
        const listed = await manager.listComicPages(session.id);

        assert.deepEqual(listed.pages.map(page => page.name), [
            'extra/!000.jpg',
            '001.jpg',
            '010.jpg',
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 뷰어 세션은 macOS AppleDouble 메타데이터를 페이지에서 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-comic-macos-metadata-'));
    try {
        const comicPath = path.join(root, 'Mac Metadata.cbz');
        const firstPage = pngHeader(1200, 1800);
        fs.writeFileSync(comicPath, Buffer.alloc(0));
        await replaceZipEntry(comicPath, '1.png', firstPage);
        await replaceZipEntry(comicPath, '__MACOSX/._1.png', Buffer.from('apple-double'));
        await replaceZipEntry(comicPath, '._2.png', Buffer.from('apple-double'));
        await replaceZipEntry(
            comicPath,
            '__MACOSX/ComicInfo.xml',
            '<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>',
        );

        const manager = new ViewerSessionManager();
        const session = manager.create(comicPath, { skipAdjacent: true });
        const listed = await manager.listComicPages(session.id);

        assert.equal(listed.readingDirection, 'ltr');
        assert.deepEqual(listed.pages.map(page => page.name), ['1.png']);
        assert.equal(manager.comicArchiveEntryCaches.get(session.id)?.zipEntries.size, 1);
        const pageData = await manager.getComicPageData(session.id, '1.png');
        assert.deepEqual(pageData.buffer, firstPage);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 뷰어 세션은 페이지 요청에 ZIP 엔트리 캐시를 재사용하고 파일 변경 시 폐기한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-comic-cache-'));
    try {
        const comicPath = path.join(root, 'Cached.cbz');
        const firstPage = Buffer.concat([pngHeader(1200, 1800), Buffer.from('first')]);
        const updatedPage = Buffer.concat([pngHeader(1400, 2100), Buffer.from('updated-page')]);
        fs.writeFileSync(comicPath, Buffer.alloc(0));
        await replaceZipEntry(comicPath, 'ComicInfo.xml', '<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>');
        await replaceZipEntry(comicPath, '001.png', firstPage);
        await replaceZipEntry(comicPath, '002.png', pngHeader(1200, 1800));

        const manager = new ViewerSessionManager();
        const session = manager.create(comicPath, { skipAdjacent: true });
        const listed = await manager.listComicPages(session.id);

        assert.equal(listed.readingDirection, 'rtl');
        assert.deepEqual(listed.pages.map(page => page.name), ['001.png', '002.png']);
        const archiveEntryCache = manager.comicArchiveEntryCaches.get(session.id);
        assert.ok(archiveEntryCache);
        assert.equal(archiveEntryCache.zipEntries.size, 3);
        assert.deepEqual(Object.keys(archiveEntryCache.zipEntries.get('001.png')).sort(), [
            'compressedSize',
            'localHeaderOffset',
            'method',
            'name',
            'uncompressedSize',
        ]);

        const originalOpen = fsp.open;
        let comicOpenCount = 0;
        fsp.open = async (...args) => {
            if (path.resolve(String(args[0])) === path.resolve(comicPath)) comicOpenCount += 1;
            return originalOpen(...args);
        };
        let pageData = null;
        try {
            pageData = await manager.getComicPageData(session.id, '001.png');
        } finally {
            fsp.open = originalOpen;
        }
        assert.deepEqual(pageData.buffer, firstPage);
        assert.equal(comicOpenCount, 1);

        await replaceZipEntry(comicPath, '001.png', updatedPage);
        pageData = await manager.getComicPageData(session.id, '001.png');
        assert.deepEqual(pageData.buffer, updatedPage);
        assert.equal(manager.comicArchiveEntryCaches.has(session.id), false);

        await manager.listComicPages(session.id);
        assert.equal(manager.comicArchiveEntryCaches.has(session.id), true);
        for (let index = 0; index < 16; index += 1) {
            const documentPath = path.join(root, `${String(index).padStart(2, '0')}.pdf`);
            fs.writeFileSync(documentPath, 'pdf');
            manager.create(documentPath, { skipAdjacent: true });
        }
        assert.equal(manager.sessions.has(session.id), false);
        assert.equal(manager.comicArchiveEntryCaches.has(session.id), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 확장자의 비 ZIP 압축 파일은 엔트리 캐시 없이 7z fallback으로 읽는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-comic-7z-fallback-'));
    try {
        const inputPath = path.join(root, 'input');
        const comicPath = path.join(root, 'Mismatched.cbz');
        const pageBuffer = pngHeader(900, 1400);
        fs.mkdirSync(inputPath);
        fs.writeFileSync(path.join(inputPath, '001.png'), pageBuffer);
        const packed = spawnSync(sevenZExe, ['a', '-t7z', comicPath, '001.png'], {
            cwd: inputPath,
            stdio: 'ignore',
        });
        assert.equal(packed.status, 0);

        const manager = new ViewerSessionManager({ getSevenZPath: async () => sevenZExe });
        const session = manager.create(comicPath, { skipAdjacent: true });
        const listed = await manager.listComicPages(session.id);

        assert.deepEqual(listed.pages.map(page => page.name), ['001.png']);
        assert.equal(manager.comicArchiveEntryCaches.has(session.id), false);
        const pageData = await manager.getComicPageData(session.id, '001.png');
        assert.deepEqual(pageData.buffer, pageBuffer);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 뷰어 세션은 목차 제목과 내부 이미지를 읽기 페이지 데이터로 변환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-epub-'));
    try {
        const epubPath = path.join(root, 'Sample.epub');
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            `<?xml version="1.0"?>
            <container>
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" />
                </rootfiles>
            </container>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            `<package>
                <metadata>
                    <dc:title>&ldquo;샘플&rdquo; &amp;ldquo;</dc:title>
                    <dc:creator>Caf&eacute;</dc:creator>
                    <meta name="cover" content="cover-image" />
                </metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image" />
                    <item id="style" href="styles/book.css" media-type="text/css" />
                    <item id="base-style" href="styles/base.css" media-type="text/css" />
                    <item id="cover-wrapper" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg" />
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml" />
                    <item id="img1" href="images/illus.png" media-type="image/png" />
                </manifest>
                <spine>
                    <itemref idref="cover-wrapper" />
                    <itemref idref="chap1" />
                    <itemref idref="chap2" />
                </spine>
            </package>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/cover.xhtml',
            `<html>
                <head><title>표지</title></head>
                <body>
                    <div class="cover-wrap">
                        <svg viewBox="0 0 600 900" width="100%" height="100%">
                            <image width="600" height="900" xlink:href="images/cover.png" />
                        </svg>
                    </div>
                </body>
            </html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/nav.xhtml',
            `<nav><ol>
                <li><a href="chap1.xhtml">&ldquo;프롤로그&rdquo;</a></li>
                <li><a href="chap2.xhtml">삽화 장면</a></li>
            </ol></nav>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap1.xhtml',
            `<html>
                <head>
                    <link rel="stylesheet" href="styles/book.css" />
                    <style>
                        .inline-note { text-align: right; color: #445566; font: 18px serif; background-image: url("https://example.invalid/bad.png"); }
                    </style>
                </head>
                <body>
                    <div class="img_center" style="width: 8%; margin: 0 auto;">
                        <img class="logo-mark" src="images/logo.png" alt="&ldquo;문장&rdquo; &amp;ldquo;" />
                    </div>
                    <h1>Section0001.xhtml</h1>
                    <p>&nbsp;</p>
                    <p>&#160;</p>
                    <p class="lead"><strong>본문입니다.</strong></p>
                    <p class="entities">&ldquo;인용&rdquo; &lsquo;작은따옴표&rsquo; &hellip; &mdash; &copy; &eacute; &#x1F600; &#x110000; &amp;ldquo; &lt;script&gt;</p>
                    <p class="line-breaks">첫 줄<br/>둘째 줄<br />셋째 줄</p>
                    <p class="normal">보통입니다.</p>
                    <p class="inline-note" style="letter-spacing: 2px; white-space: pre-wrap; writing-mode: vertical-rl; background-image: url(javascript:alert(1));"><span>인라인입니다.</span></p>
                    <figure class="image-frame" style="display: block; width: 80%; text-align: center;">
                        <img class="illustration" src="images/illus.png" alt="삽화1" />
                    </figure>
                </body>
            </html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap2.xhtml',
            `<html><body>
                <p>다음 장입니다.</p>
                <table summary="등급표">
                    <tbody>
                        <tr><td colspan="3" rowspan="2" valign="top">마법부 등급</td><th scope="col">위험도</th></tr>
                        <tr><td>XXXXX</td></tr>
                    </tbody>
                </table>
            </body></html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/styles/book.css',
            `@charset "utf-8";
            @import "base.css";
            .lead { color: #123456; text-align: center; margin-bottom: 12px; font-size: 21px; line-height: 2; padding: 14px; background-color: #ffffff; word-break: break-all; background-image: url("https://example.invalid/skip.png"); }
            .normal { font-size: 100%; }
            .img_center { text-align: center; margin: 0em 1em; padding: 4px; }
            .image-frame { max-width: 360px; margin-left: auto; margin-right: auto; overflow-wrap: anywhere; }
            img.illustration { margin-top: 8px; width: 50%; }`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/styles/base.css',
            `h1 { text-align: center; margin: 0 0 18px; padding: 6px; }`,
        );
        await replaceZipEntry(epubPath, 'OEBPS/images/cover.png', Buffer.from('cover'));
        await replaceZipEntry(epubPath, 'OEBPS/images/logo.png', pngHeader(32, 48));
        await replaceZipEntry(epubPath, 'OEBPS/images/illus.png', Buffer.from('illus'));

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath);
        const result = await manager.getEpubText(session.id);

        assert.equal(result.chapters[0].name, 'OEBPS/cover.xhtml');
        assert.equal(result.chapters[0].title, '표지');
        assert.equal(result.chapters[0].blocks[0].type, 'html');
        assert.equal(result.chapters[0].blocks[0].hasImage, true);
        const coverImageNode = result.chapters[0].blocks[0].nodes[0].children.find(node => node.tagName === 'img');
        assert.match(coverImageNode.src, /^bookmanager-document:\/\/session\//);
        assert.match(coverImageNode.src, /\/asset\/OEBPS\/images\/cover\.png$/);
        assert.equal(coverImageNode.name, 'OEBPS/images/cover.png');
        const coverAsset = await manager.getDocumentAssetFromRequest(coverImageNode.src);
        assert.equal(coverAsset.mime, 'image/png');
        assert.equal(coverAsset.buffer.toString(), 'cover');
        assert.equal(result.metadata.title, '“샘플” &ldquo;');
        assert.equal(result.metadata.author, 'Café');
        assert.equal(result.chapters[1].title, '“프롤로그”');
        assert.equal(result.toc[0].title, '“프롤로그”');
        assert.equal(result.chapters[1].blocks.some(block => block.hasImage), true);
        assert.match(result.stylesheet, /\.viewer-reader-scope h1 \{ text-align: center; margin: 0 0 18px; padding: 6px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.lead \{ text-align: center; margin-bottom: 12px; font-size: 21px; padding: 14px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.inline-note \{ text-align: right; font: 18px serif; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.normal \{ font-size: 100%; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.img_center \{ text-align: center; margin: 0em 1em; padding: 4px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.image-frame \{ max-width: 360px; margin-left: auto; margin-right: auto; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope img\.illustration \{ margin-top: 8px; width: 50%; \}/);
        assert.doesNotMatch(result.stylesheet, /--viewer-epub-font-scale/);
        assert.doesNotMatch(result.stylesheet, /example\.invalid|javascript:/);
        const leadBlock = result.chapters[1].blocks.find(block => block.text === '본문입니다.');
        assert.deepEqual(leadBlock.style, {
            textAlign: 'center',
            marginBottom: '12px',
            fontSize: '21px',
            padding: '14px',
        });
        assert.equal(leadBlock.className, 'lead');
        assert.equal(leadBlock.nodes[0].tagName, 'p');
        assert.equal(leadBlock.nodes[0].className, 'lead');
        assert.deepEqual(leadBlock.nodes[0].style, {
            textAlign: 'center',
            marginBottom: '12px',
            fontSize: '21px',
            padding: '14px',
        });
        assert.equal(leadBlock.nodes[0].children[0].tagName, 'strong');
        const entityBlock = result.chapters[1].blocks.find(block => block.className === 'entities');
        assert.equal(entityBlock.text, '“인용” ‘작은따옴표’ … — © é 😀 � &ldquo; <script>');
        assert.equal(entityBlock.nodes[0].children[0].text, '“인용” ‘작은따옴표’ … — © é 😀 � &ldquo; <script>');
        assert.equal(entityBlock.nodes[0].children.some(node => node.tagName === 'script'), false);
        const lineBreakBlock = result.chapters[1].blocks.find(block => block.className === 'line-breaks');
        assert.equal(lineBreakBlock.text, '첫 줄\n둘째 줄\n셋째 줄');
        assert.doesNotMatch(lineBreakBlock.text, /br\/>/);
        assert.equal(lineBreakBlock.nodes[0].children.filter(node => node.tagName === 'br').length, 2);
        const normalBlock = result.chapters[1].blocks.find(block => block.text === '보통입니다.');
        assert.equal(normalBlock.className, 'normal');
        assert.deepEqual(normalBlock.style, { fontSize: '100%' });
        assert.deepEqual(normalBlock.nodes[0].style, { fontSize: '100%' });
        const inlineBlock = result.chapters[1].blocks.find(block => block.text === '인라인입니다.');
        assert.deepEqual(inlineBlock.style, {
            textAlign: 'right',
            font: '18px serif',
        });
        assert.equal(inlineBlock.className, 'inline-note');
        assert.deepEqual(inlineBlock.nodes[0].style, {
            textAlign: 'right',
            font: '18px serif',
        });
        assert.equal(inlineBlock.nodes[0].className, 'inline-note');
        assert.equal(inlineBlock.nodes[0].children[0].tagName, 'span');
        const logoBlock = result.chapters[1].blocks.find(block => block.className === 'img_center');
        const logoNode = logoBlock.nodes[0];
        const logoImageNode = logoNode.children.find(node => node.tagName === 'img');
        assert.equal(logoNode.className, 'img_center');
        assert.equal(logoImageNode.className, 'logo-mark');
        assert.equal(logoImageNode.alt, '“문장” &ldquo;');
        assert.equal(logoImageNode.naturalWidth, 32);
        assert.equal(logoImageNode.naturalHeight, 48);
        assert.equal(logoNode.style.textAlign, 'center');
        assert.equal(logoNode.style.margin, '0 auto');
        assert.equal(logoNode.style.padding, '4px');
        assert.equal(logoNode.style.width, '8%');

        const headingBlock = result.chapters[1].blocks.find(block => block.tagName === 'h1');
        assert.equal(headingBlock.nodes[0].tagName, 'h1');
        assert.equal(headingBlock.nodes[0].style.textAlign, 'center');
        assert.equal(headingBlock.nodes[0].style.margin, '0 0 18px');
        assert.equal(headingBlock.nodes[0].style.padding, '6px');
        const blankBlocks = result.chapters[1].blocks.filter(block => (
            block.tagName === 'p'
            && block.text === '\u00a0'
            && block.nodes?.[0]?.children?.[0]?.text === '\u00a0'
        ));
        assert.equal(blankBlocks.length, 2);

        const imageBlock = result.chapters[1].blocks.find(block => block.className === 'image-frame');
        const figureNode = imageBlock.nodes[0];
        const imageNode = figureNode.children.find(node => node.tagName === 'img');
        assert.equal(imageBlock.text, '');
        assert.equal(figureNode.tagName, 'figure');
        assert.equal(figureNode.className, 'image-frame');
        assert.equal(imageNode.className, 'illustration');
        assert.equal(figureNode.style.display, 'block');
        assert.equal(figureNode.style.width, '80%');
        assert.equal(figureNode.style.textAlign, 'center');
        assert.equal(figureNode.style.maxWidth, '360px');
        assert.equal(figureNode.style.marginLeft, 'auto');
        assert.equal(figureNode.style.marginRight, 'auto');
        assert.equal(imageNode.style.marginTop, '8px');
        assert.equal(imageNode.style.width, '50%');
        assert.equal(result.chapters[2].title, '삽화 장면');
        const tableBlock = result.chapters[2].blocks.find(block => block.tagName === 'table');
        const tableNode = tableBlock.nodes[0];
        const tableCell = tableNode.children[0].children[0].children[0];
        const tableHeading = tableNode.children[0].children[0].children[1];
        assert.equal(tableNode.attributes.summary, '등급표');
        assert.equal(tableCell.attributes.colSpan, 3);
        assert.equal(tableCell.attributes.rowSpan, 2);
        assert.equal(tableCell.attributes.valign, 'top');
        assert.equal(tableHeading.attributes.scope, 'col');

        const asset = await manager.getDocumentAssetFromRequest(imageNode.src);
        assert.equal(asset.mime, 'image/png');
        assert.equal(asset.buffer.toString(), 'illus');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 뷰어 세션은 파일명만 남은 표지 페이지를 이미지로 복구한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-epub-cover-'));
    try {
        const epubPath = path.join(root, 'FilenameCover.epub');
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            `<?xml version="1.0"?>
            <container>
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" />
                </rootfiles>
            </container>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            `<package>
                <metadata><meta name="cover" content="cover-image" /></metadata>
                <manifest>
                    <item id="cover-image" href="images/bookmanager-cover.webp" media-type="image/webp" />
                    <item id="cover-wrapper" href="cover.xhtml" media-type="application/xhtml+xml" />
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                </manifest>
                <spine>
                    <itemref idref="cover-wrapper" />
                    <itemref idref="chap1" />
                </spine>
            </package>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/cover.xhtml',
            `<html>
                <head><title>표지</title></head>
                <body><p>bookmanager-cover.webp</p></body>
            </html>`,
        );
        await replaceZipEntry(epubPath, 'OEBPS/chap1.xhtml', '<html><body><p>본문입니다.</p></body></html>');
        await replaceZipEntry(epubPath, 'OEBPS/images/bookmanager-cover.webp', Buffer.from('cover'));

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath);
        const result = await manager.getEpubText(session.id);

        assert.equal(result.chapters[0].title, '표지');
        assert.equal(result.chapters[0].text, '');
        assert.equal(result.chapters[0].blocks[0].type, 'image');
        assert.match(result.chapters[0].blocks[0].src, /\/asset\/OEBPS\/images\/bookmanager-cover\.webp$/);
        assert.equal(result.chapters[0].blocks[0].alt, 'bookmanager-cover.webp');
        assert.equal(result.chapters[1].text, '본문입니다.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 뷰어 세션은 HTML 주석을 제거하고 컨테이너 문단을 개별 블록으로 나눈다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-epub-comments-'));
    try {
        const epubPath = path.join(root, 'Comments.epub');
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            `<?xml version="1.0"?>
            <container>
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" />
                </rootfiles>
            </container>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            `<package>
                <manifest>
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                    <item id="img1" href="images/scene.jpg" media-type="image/jpeg" />
                </manifest>
                <spine>
                    <itemref idref="chap1" />
                </spine>
            </package>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap1.xhtml',
            `<html>
                <body>
                    <div class="chapter-wrap">
                        <p>첫 문단입니다.</p>
                        <!-- 편집용 주석은 표시하지 않아야 한다. -->
                        <p>둘째 문단입니다.<!-- 인라인 주석 --></p>
                        <p class="image"><img src="images/scene.jpg" alt="삽화" /></p>
                        <p>셋째 문단입니다.</p>
                    </div>
                </body>
            </html>`,
        );
        await replaceZipEntry(epubPath, 'OEBPS/images/scene.jpg', Buffer.from('image'));

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath);
        const result = await manager.getEpubText(session.id);
        const blocks = result.chapters[0].blocks;

        assert.equal(blocks.some(block => block.tagName === 'div' && block.className === 'chapter-wrap'), false);
        assert.deepEqual(blocks.map(block => block.text), [
            '첫 문단입니다.',
            '둘째 문단입니다.',
            '',
            '셋째 문단입니다.',
        ]);
        assert.equal(blocks.some(block => /<!--|-->|!-/.test(block.text || '')), false);
        const imageBlock = blocks.find(block => block.hasImage);
        assert.equal(imageBlock.tagName, 'p');
        assert.equal(imageBlock.className, 'image');
        assert.equal(imageBlock.nodes[0].children[0].name, 'OEBPS/images/scene.jpg');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 뷰어 세션은 내부 링크, hr, 포함 폰트를 읽기 데이터로 보존한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-epub-links-fonts-'));
    try {
        const epubPath = path.join(root, 'LinksFonts.epub');
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            `<?xml version="1.0"?>
            <container>
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" />
                </rootfiles>
            </container>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            `<package>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="style" href="styles/book.css" media-type="text/css" />
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                    <item id="font1" href="fonts/BookSerif-Regular.ttf" media-type="font/ttf" />
                    <item id="hidden-img" href="images/hidden.png" media-type="image/png" />
                </manifest>
                <spine>
                    <itemref idref="chap1" />
                </spine>
            </package>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/nav.xhtml',
            `<nav><ol>
                <li><a href="chap1.xhtml#start">시작</a></li>
                <li><a href="chap1.xhtml#note1">각주</a></li>
            </ol></nav>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap1.xhtml',
            `<html>
                <head><link rel="stylesheet" href="styles/book.css" /></head>
                <body>
                    <p id="start">본문입니다. <a href="#note1">각주로 이동</a> <a href="https://example.com/help">외부 링크</a></p>
                    <hr />
                    <p><img class="hidden-image" src="images/hidden.png" alt="" /></p>
                    <p id="note1">각주 내용입니다.</p>
                </body>
            </html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/styles/book.css',
            `@font-face {
                font-family: 'Book Serif';
                src: url("../fonts/BookSerif-Regular.ttf") format("truetype");
                font-weight: 400;
                font-style: normal;
            }
            .hidden-image { display: none; width: 12px; }`,
        );
        await replaceZipEntry(epubPath, 'OEBPS/fonts/BookSerif-Regular.ttf', Buffer.from('font-data'));
        await replaceZipEntry(epubPath, 'OEBPS/images/hidden.png', Buffer.from('hidden-image'));

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath);
        const result = await manager.getEpubText(session.id);
        const blocks = result.chapters[0].blocks;

        assert.equal(result.toc.length, 2);
        assert.equal(result.toc[0].anchor, 'start');
        assert.equal(result.toc[1].anchor, 'note1');
        const startBlock = blocks.find(block => block.anchors?.includes('start'));
        const linkNode = startBlock.nodes[0].children.find(node => node.tagName === 'a' && node.targetEntryName);
        const externalLinkNode = startBlock.nodes[0].children.find(node => node.tagName === 'a' && node.externalHref);
        assert.equal(linkNode.targetEntryName, 'OEBPS/chap1.xhtml');
        assert.equal(linkNode.targetAnchor, 'note1');
        assert.equal(externalLinkNode.externalHref, 'https://example.com/help');
        assert.equal(blocks.some(block => block.tagName === 'hr'), true);
        assert.equal(blocks.some(block => block.anchors?.includes('note1')), true);
        const hiddenImageBlock = blocks.find(block => block.hasImage);
        const hiddenImageNode = hiddenImageBlock.nodes[0].children.find(node => node.tagName === 'img');
        assert.equal(hiddenImageNode.alt, '');
        assert.equal(hiddenImageNode.style.display, undefined);
        assert.equal(hiddenImageNode.style.width, '12px');

        const bookFont = result.fonts.find(font => font.family === 'Book Serif');
        assert.ok(bookFont);
        assert.equal(bookFont.entryName, 'OEBPS/fonts/BookSerif-Regular.ttf');
        assert.equal(bookFont.format, 'truetype');
        assert.match(result.stylesheet, /@font-face/);
        assert.match(result.stylesheet, /font-family: 'Book Serif'/);
        assert.match(result.stylesheet, /bookmanager-document:\/\/session\/[^/]+\/asset\/OEBPS\/fonts\/BookSerif-Regular\.ttf/);
        const fontAsset = await manager.getDocumentAssetFromRequest(bookFont.src);
        assert.equal(fontAsset.mime, 'font/ttf');
        assert.equal(fontAsset.buffer.toString(), 'font-data');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
