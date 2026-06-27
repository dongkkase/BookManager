import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import {
    buildOpdsApp,
    buildWebApp,
    buildWebdavApp,
    getSharingServerStatus,
    normalizeSharingServerType,
    normalizeSharingRoots,
    resolveWebdavPath,
    startSharingServer,
    stopAllSharingServers,
    stopSharingServer,
} from './servers/sharingServers.js';

async function withHttpServer(app, callback) {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
        await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function waitForLog(logs, pattern, timeoutMs = 500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (logs.some(item => pattern.test(item.message))) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Expected log matching ${pattern}`);
}

async function getFreePort(host = '127.0.0.1') {
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, host, resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    return port;
}

function createLibraryFixture(t) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-sharing-'));
    const library = path.join(tempRoot, 'Library A');
    const child = path.join(library, 'Series');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(child, 'Book 01.cbz'), 'archive');
    fs.writeFileSync(path.join(child, 'ignore.txt'), 'ignore');
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    return { tempRoot, library, child };
}

function md5Hex(value) {
    return crypto.createHash('md5').update(String(value)).digest('hex');
}

function digestAuthHeader({ challenge, username, password, method, uri }) {
    const realm = challenge.match(/Digest realm="([^"]+)"/)?.[1] || 'BookManager';
    const nonce = challenge.match(/nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'Digest challenge must include a nonce');
    const qop = 'auth';
    const nc = '00000001';
    const cnonce = 'bookmanager-test';
    const ha1 = md5Hex(`${username}:${realm}:${password}`);
    const ha2 = md5Hex(`${method}:${uri}`);
    const response = md5Hex(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5, response="${response}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
}

test('OPDS 루트는 등록 라이브러리를 표시하고 하위 폴더와 아카이브를 탐색한다', async t => {
    const { library, child } = createLibraryFixture(t);
    const app = buildOpdsApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const rootResponse = await fetch(`${baseUrl}/opds`);
        const rootXml = await rootResponse.text();
        assert.equal(rootResponse.status, 200);
        assert.match(rootResponse.headers.get('content-type'), /application\/xml/);
        assert.match(rootXml, /Library A/);
        assert.match(rootXml, /rel="subsection"/);

        const childResponse = await fetch(`${baseUrl}/opds?dir=${encodeURIComponent(child)}`);
        const childXml = await childResponse.text();
        assert.equal(childResponse.status, 200);
        assert.match(childXml, /Book 01\.cbz/);
        assert.match(childXml, /application\/x-cbz/);
        assert.match(childXml, /<content type="text">application\/x-cbz<\/content>/);
        assert.match(childXml, /href="\/download\?file=/);
        assert.doesNotMatch(childXml, /href="http:\/\/127\.0\.0\.1/);
        assert.doesNotMatch(childXml, /ignore\.txt/);
    });
});

test('OPDS는 기존 Python처럼 DB 인덱스 행으로 폴더와 파일 피드를 만든다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-opds-db-'));
    const library = path.join(tempRoot, 'Library A');
    const child = path.join(library, 'Indexed Series');
    const thumbnailDir = path.join(tempRoot, 'thumbnails');
    const archive = path.join(child, 'Indexed 01.cbz');
    const thumbnail = path.join(thumbnailDir, 'indexed.jpg');
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(thumbnailDir, { recursive: true });
    fs.writeFileSync(archive, 'archive');
    fs.writeFileSync(thumbnail, 'thumbnail');
    const realLibrary = fs.realpathSync(library);
    const realChild = fs.realpathSync(child);
    const realArchive = fs.realpathSync(archive);
    const realThumbnail = fs.realpathSync(thumbnail);
    const realThumbnailDir = fs.realpathSync(thumbnailDir);
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const dbRowsProvider = async currentDir => {
        if (![realLibrary, realChild].includes(currentDir)) return [];
        return [{
            path: realArchive,
            title: 'DB Indexed Title',
            summary: 'DB Summary',
            writer: 'DB Writer',
            mtime: Date.UTC(2026, 0, 1),
            thumb_path: realThumbnail,
            size: 2 * 1024 * 1024,
            ext: '.cbz',
            page_count: '12',
        }];
    };
    const app = buildOpdsApp(
        { dup_check_folders: [realLibrary] },
        () => {},
        { dbRowsProvider, thumbnailDir: realThumbnailDir },
    );

    await withHttpServer(app, async baseUrl => {
        const libraryResponse = await fetch(`${baseUrl}/opds?dir=${encodeURIComponent(realLibrary)}`);
        const libraryXml = await libraryResponse.text();
        assert.equal(libraryResponse.status, 200);
        assert.match(libraryXml, /Indexed Series/);
        assert.match(libraryXml, /\/download\?file=/);

        const childResponse = await fetch(`${baseUrl}/opds?dir=${encodeURIComponent(realChild)}`);
        const childXml = await childResponse.text();
        assert.equal(childResponse.status, 200);
        assert.match(childXml, /DB Indexed Title/);
        assert.match(childXml, /File Type: application\/x-cbz - 2\.00 MB Summary: DB Summary/);
        assert.match(childXml, /p5:count="12"/);
        assert.match(childXml, /<author><name>DB Writer<\/name><\/author>/);

        const thumbnailResponse = await fetch(`${baseUrl}/download?file=${encodeURIComponent(realThumbnail)}`);
        assert.equal(thumbnailResponse.status, 200);
        assert.match(thumbnailResponse.headers.get('content-type'), /image\/jpeg/);
        assert.equal(await thumbnailResponse.text(), 'thumbnail');
    });
});

test('OPDS는 ZIP/CBZ 썸네일과 페이지 스트리밍 라우트를 제공한다', async t => {
    const { library, child } = createLibraryFixture(t);
    const archive = path.join(child, 'Book 01.cbz');
    fs.writeFileSync(archive, Buffer.alloc(0));
    await replaceZipEntry(archive, '001.jpg', Buffer.from('page-1'));
    await replaceZipEntry(archive, '002.png', Buffer.from('page-2'));
    const app = buildOpdsApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const childResponse = await fetch(`${baseUrl}/opds?dir=${encodeURIComponent(child)}`);
        const childXml = await childResponse.text();
        assert.equal(childResponse.status, 200);
        assert.match(childXml, /rel="up"/);
        assert.match(childXml, /\/thumbnail\?file=/);
        assert.match(childXml, /vaemendis\.net\/opds-pse\/stream/);

        const thumbnail = await fetch(`${baseUrl}/thumbnail?file=${encodeURIComponent(archive)}`);
        assert.equal(thumbnail.status, 200);
        assert.match(thumbnail.headers.get('content-type'), /image\/jpeg/);
        assert.equal(await thumbnail.text(), 'page-1');

        const page = await fetch(`${baseUrl}/page?file=${encodeURIComponent(archive)}&page_num=1`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /image\/png/);
        assert.equal(await page.text(), 'page-2');

        const stream = await fetch(`${baseUrl}/stream?file=${encodeURIComponent(archive)}`);
        const streamXml = await stream.text();
        assert.equal(stream.status, 200);
        assert.match(stream.headers.get('content-type'), /application\/xml/);
        assert.match(streamXml, /Page 2/);
        assert.match(streamXml, /\/page\?file=/);
    });
});

test('OPDS 다운로드는 라이브러리 밖 경로를 차단하고 파일명을 보존한다', async t => {
    const { tempRoot, library, child } = createLibraryFixture(t);
    const archive = path.join(child, 'Book 01.cbz');
    const outside = path.join(tempRoot, 'outside.cbz');
    fs.writeFileSync(outside, 'outside');
    const app = buildOpdsApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const download = await fetch(`${baseUrl}/download?file=${encodeURIComponent(archive)}`);
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-type'), /application\/x-cbz/);
        assert.match(download.headers.get('content-disposition'), /Book 01\.cbz/);

        const blocked = await fetch(`${baseUrl}/download?file=${encodeURIComponent(outside)}`);
        assert.equal(blocked.status, 404);
    });
});

test('Web 서버는 브라우저 UI와 목록, 검색, 다운로드 API를 제공한다', async t => {
    const { tempRoot, library, child } = createLibraryFixture(t);
    const archive = path.join(child, 'Book 01.cbz');
    const outside = path.join(tempRoot, 'outside.cbz');
    fs.writeFileSync(outside, 'outside');
    const realLibrary = fs.realpathSync(library);
    const app = buildWebApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const pageResponse = await fetch(baseUrl);
        const pageHtml = await pageResponse.text();
        assert.equal(pageResponse.status, 200);
        assert.match(pageHtml, /BookManager Web Library/);
        assert.doesNotMatch(pageHtml, /ComicZIP Web Library/);
        assert.doesNotMatch(pageHtml, /onclick=/);
        assert.match(pageHtml, /\/assets\/web-library\.js/);

        const cssResponse = await fetch(`${baseUrl}/assets/web-library.css`);
        const cssText = await cssResponse.text();
        assert.equal(cssResponse.status, 200);
        assert.match(cssText, /color-scheme: dark/);
        assert.match(cssText, /object-fit: cover/);
        assert.match(cssText, /aspect-ratio: 2 \/ 3/);
        assert.match(cssText, /backdrop-filter: blur/);
        assert.match(cssText, /content: "Download"/);
        assert.match(cssText, /--orange: #f97316/);
        assert.match(cssText, /\.thumb-box::before/);
        assert.match(cssText, /linear-gradient\(180deg/);
        assert.match(cssText, /\.card-count-tag/);
        assert.match(cssText, /\.download-icon/);
        assert.match(cssText, /\.web-fa-icon/);
        assert.match(cssText, /\.load-more-button/);

        const scriptResponse = await fetch(`${baseUrl}/assets/web-library.js`);
        const scriptText = await scriptResponse.text();
        assert.equal(scriptResponse.status, 200);
        assert.match(scriptText, /addEventListener/);
        assert.match(scriptText, /상세정보/);
        assert.match(scriptText, /\/api\/file-meta/);
        assert.match(scriptText, /card-download-button/);
        assert.match(scriptText, /DOWNLOAD_ICON/);
        assert.match(scriptText, /createDownloadIcon/);
        assert.match(scriptText, /DETAIL_ICONS/);
        assert.match(scriptText, /createDetailIcon/);
        assert.match(scriptText, /appendMetadataRow\(grid, "archive", "포맷 \/ 망가\(방향\)"/);
        assert.match(scriptText, /createCardInfoTag/);
        assert.match(scriptText, /modal-open/);
        assert.match(scriptText, /responseCache/);
        assert.match(scriptText, /scrollRestoration = "manual"/);
        assert.match(scriptText, /saveCurrentScrollState/);
        assert.match(scriptText, /restoreScrollPosition/);
        assert.match(scriptText, /scrollY: next\.scrollY/);
        assert.match(scriptText, /loadMore/);
        assert.match(scriptText, /nextOffset/);
        assert.doesNotMatch(scriptText, /makeButton\("열기"/);
        assert.doesNotMatch(scriptText, /innerHTML/);

        const rootList = await (await fetch(`${baseUrl}/api/list`)).json();
        assert.equal(rootList.current_dir, '');
        assert.equal(rootList.can_zip, false);
        assert.equal(rootList.folders[0].name, 'Library A');
        assert.equal(rootList.folders[0].is_library, true);

        const childListResponse = await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(child)}`);
        const childList = await childListResponse.json();
        assert.equal(childListResponse.status, 200);
        assert.equal(childList.parent_dir, realLibrary);
        assert.equal(childList.files.length, 1);
        assert.equal(childList.files[0].name, 'Book 01.cbz');
        assert.equal(childList.files[0].title, 'Book 01.cbz');
        assert.equal(childList.folders.length, 0);

        const folderSearch = await (await fetch(`${baseUrl}/api/search?q=Series`)).json();
        assert.equal(folderSearch.folders[0].name, 'Series');

        const fileSearch = await (await fetch(`${baseUrl}/api/search?q=Book`)).json();
        assert.equal(fileSearch.folders[0].name, 'Series');
        assert.equal(fileSearch.files.length, 0);

        const download = await fetch(`${baseUrl}/api/download?file=${encodeURIComponent(archive)}`);
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-type'), /application\/x-cbz/);
        assert.match(download.headers.get('content-disposition'), /Book 01\.cbz/);
        assert.equal(await download.text(), 'archive');

        const blocked = await fetch(`${baseUrl}/api/download?file=${encodeURIComponent(outside)}`);
        assert.equal(blocked.status, 404);
    });
});

test('Web 서버 목록 API는 큰 폴더를 페이지 단위로 반환한다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-web-page-'));
    const library = path.join(tempRoot, 'Library A');
    fs.mkdirSync(library, { recursive: true });
    for (let index = 1; index <= 130; index += 1) {
        fs.writeFileSync(path.join(library, `Book ${String(index).padStart(3, '0')}.cbz`), 'archive');
    }
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const app = buildWebApp({ dup_check_folders: [library] });
    await withHttpServer(app, async baseUrl => {
        const first = await (await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(library)}&limit=50`)).json();
        assert.equal(first.files.length, 50);
        assert.equal(first.page.total, 130);
        assert.equal(first.page.has_more, true);
        assert.equal(first.page.next_offset, 50);
        assert.equal(first.files[0].name, 'Book 001.cbz');

        const last = await (await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(library)}&limit=50&offset=100`)).json();
        assert.equal(last.files.length, 30);
        assert.equal(last.page.has_more, false);
        assert.equal(last.page.next_offset, null);
        assert.equal(last.files[0].name, 'Book 101.cbz');
    });
});

test('Web 서버는 DB 인덱스로 검색 결과, 메타데이터, 직접 썸네일을 만든다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-web-db-'));
    const library = path.join(tempRoot, 'Library A');
    const child = path.join(library, 'Indexed Series');
    const thumbnailDir = path.join(tempRoot, 'thumbnails');
    const archive = path.join(child, 'Indexed 01.cbz');
    const thumbnail = path.join(thumbnailDir, 'indexed.jpg');
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(thumbnailDir, { recursive: true });
    fs.writeFileSync(archive, 'archive');
    fs.writeFileSync(thumbnail, 'thumbnail');
    const realLibrary = fs.realpathSync(library);
    const realChild = fs.realpathSync(child);
    const realArchive = fs.realpathSync(archive);
    const realThumbnail = fs.realpathSync(thumbnail);
    const realThumbnailDir = fs.realpathSync(thumbnailDir);
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const dbRowsProvider = async currentDir => {
        if (![realLibrary, realChild].includes(currentDir)) return [];
        return [{
            path: realArchive,
            title: 'DB Indexed Title',
            series: 'DB Series',
            series_group: 'DB Group',
            volume: '1',
            number: '1',
            writer: 'DB Writer',
            creators: 'DB Artist',
            publisher: 'DB Publisher',
            imprint: 'DB Label',
            genre: 'Action',
            summary: 'DB Summary',
            rating: '4.5',
            age_rating: '15+',
            publish_date: '2026-01-02',
            characters: 'Hero, Rival',
            teams: 'Team A',
            locations: 'Seoul',
            story_arc: 'Arc A',
            tags: 'tag-a, tag-b',
            notes: 'DB Notes',
            web: 'https://example.com/book',
            thumb_path: realThumbnail,
            size: 2 * 1024 * 1024,
            ext: '.cbz',
            resolution: '1200x1800',
            page_count: '12',
            volume_count: '3',
            format: 'WebComic',
            manga: 'YesAndRightToLeft',
            language: 'ko',
        }];
    };
    const app = buildWebApp(
        { dup_check_folders: [realLibrary] },
        { dbRowsProvider, thumbnailDir: realThumbnailDir },
    );

    await withHttpServer(app, async baseUrl => {
        const libraryList = await (await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(realLibrary)}`)).json();
        assert.equal(libraryList.folders.length, 1);
        assert.equal(libraryList.folders[0].name, 'Indexed Series');
        assert.equal(libraryList.folders[0].count, 1);
        assert.equal(libraryList.folders[0].has_metadata, true);
        assert.equal(libraryList.folders[0].thumb_path, realThumbnail);

        const childList = await (await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(realChild)}`)).json();
        assert.equal(childList.files.length, 1);
        assert.equal(childList.files[0].title, 'DB Indexed Title');
        assert.equal(childList.files[0].size, 2 * 1024 * 1024);
        assert.equal(childList.files[0].thumb_path, realThumbnail);
        assert.equal(childList.files[0].has_metadata, true);
        assert.equal(childList.files[0].format, 'WebComic');

        const search = await (await fetch(`${baseUrl}/api/search?q=Indexed`)).json();
        assert.equal(search.folders[0].name, 'Indexed Series');
        assert.equal(search.files.length, 0);

        const metadataSearch = await (await fetch(`${baseUrl}/api/search?q=Hero`)).json();
        assert.equal(metadataSearch.folders[0].name, 'Indexed Series');
        assert.equal(metadataSearch.files.length, 0);

        const meta = await (await fetch(`${baseUrl}/api/folder-meta?dir=${encodeURIComponent(realChild)}`)).json();
        assert.equal(meta.title, 'DB Indexed Title');
        assert.equal(meta.series, 'DB Series');
        assert.equal(meta.writer, 'DB Writer');
        assert.equal(meta.creators, 'DB Artist');
        assert.equal(meta.imprint, 'DB Label');
        assert.equal(meta.format, 'WebComic');
        assert.equal(meta.summary, 'DB Summary');
        assert.equal(meta.tags, 'tag-a, tag-b');
        assert.equal(meta.web, 'https://example.com/book');
        assert.equal(meta.characters, 'Hero, Rival');
        assert.equal(meta.thumb_path, realThumbnail);

        const fileMeta = await (await fetch(`${baseUrl}/api/file-meta?file=${encodeURIComponent(realArchive)}`)).json();
        assert.equal(fileMeta.title, 'DB Indexed Title');
        assert.equal(fileMeta.total_volume, '3');
        assert.equal(fileMeta.manga, 'YesAndRightToLeft');
        assert.equal(fileMeta.language, 'ko');
        assert.equal(fileMeta.notes, 'DB Notes');
        assert.equal(fileMeta.has_metadata, true);

        const thumbnailResponse = await fetch(`${baseUrl}/api/thumbnail?file=${encodeURIComponent(realThumbnail)}`);
        assert.equal(thumbnailResponse.status, 200);
        assert.match(thumbnailResponse.headers.get('content-type'), /image\/jpeg/);
        assert.equal(await thumbnailResponse.text(), 'thumbnail');
    });
});

test('Web 서버 상세 메타데이터는 확장자 fallback 포맷을 표시하지 않는다', async t => {
    const { library, child } = createLibraryFixture(t);
    const archive = path.join(child, 'Extension Format.cbz');
    fs.writeFileSync(archive, 'archive');
    const realLibrary = fs.realpathSync(library);
    const realChild = fs.realpathSync(child);
    const realArchive = fs.realpathSync(archive);
    const dbRowsProvider = async currentDir => {
        if (![realLibrary, realChild].includes(currentDir)) return [];
        return [{
            path: realArchive,
            title: 'Extension Format Title',
            series: 'Extension Series',
            ext: '.cbz',
            format: 'ZIP',
        }];
    };
    const app = buildWebApp({ dup_check_folders: [realLibrary] }, { dbRowsProvider });

    await withHttpServer(app, async baseUrl => {
        const childList = await (await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(realChild)}`)).json();
        assert.equal(childList.files[0].format, '');
        assert.equal(childList.files[0].has_metadata, true);

        const meta = await (await fetch(`${baseUrl}/api/file-meta?file=${encodeURIComponent(realArchive)}`)).json();
        assert.equal(meta.title, 'Extension Format Title');
        assert.equal(meta.format, '');
        assert.equal(meta.has_metadata, true);
    });
});

test('Web 서버는 ZIP/CBZ 표지를 썸네일로 추출한다', async t => {
    const { library, child } = createLibraryFixture(t);
    const archive = path.join(child, 'Book 01.cbz');
    fs.writeFileSync(archive, Buffer.alloc(0));
    await replaceZipEntry(archive, '002.png', Buffer.from('page-2'));
    await replaceZipEntry(archive, 'cover.jpg', Buffer.from('cover'));
    const app = buildWebApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const thumbnail = await fetch(`${baseUrl}/api/thumbnail?file=${encodeURIComponent(archive)}`);
        assert.equal(thumbnail.status, 200);
        assert.match(thumbnail.headers.get('content-type'), /image\/jpeg/);
        assert.equal(await thumbnail.text(), 'cover');
    });
});

test('WebDAV는 Basic Auth와 Depth 0/1 PROPFIND를 처리한다', async t => {
    const { library } = createLibraryFixture(t);
    const logs = [];
    const shareName = path.basename(library);
    const shareHref = `/${encodeURIComponent(shareName)}/`;
    const app = buildWebdavApp(
        { dup_check_folders: [library] },
        { username: 'reader', password: 'secret' },
        (message, type) => logs.push({ message, type }),
    );
    const auth = `Basic ${Buffer.from('reader:secret').toString('base64')}`;

    await withHttpServer(app, async baseUrl => {
        const optionsResponse = await fetch(baseUrl, { method: 'OPTIONS' });
        assert.equal(optionsResponse.status, 204);
        assert.equal(optionsResponse.headers.get('dav'), '1,2');
        assert.match(optionsResponse.headers.get('allow'), /PROPFIND/);
        assert.match(optionsResponse.headers.get('allow'), /LOCK/);
        assert.equal(optionsResponse.headers.get('ms-author-via'), 'DAV');
        await waitForLog(logs, /WebDAV 요청: OPTIONS \/ -> 204/);

        const preAuthStreamHead = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            method: 'HEAD',
            headers: {
                Range: 'bytes=0-8',
                'User-Agent': 'ComicGlassStream/0.0',
            },
        });
        assert.equal(preAuthStreamHead.status, 401);

        const unauthorized = await fetch(baseUrl, { method: 'PROPFIND' });
        assert.equal(unauthorized.status, 401);
        assert.match(unauthorized.headers.get('www-authenticate'), /^Basic /);
        assert.match(unauthorized.headers.get('www-authenticate'), /Digest realm="BookManager"/);
        await waitForLog(logs, /WebDAV 요청: PROPFIND \/ -> 401/);

        const badAuth = `Basic ${Buffer.from('reader:wrong').toString('base64')}`;
        const rejected = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { Authorization: badAuth, Depth: '0' },
        });
        assert.equal(rejected.status, 401);
        assert.equal(logs.at(-1)?.type, 'ERROR');

        const depthZero = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { Authorization: auth, Depth: '0' },
        });
        const depthZeroXml = await depthZero.text();
        assert.equal(depthZero.status, 207);
        assert.match(depthZeroXml, /BookManager/);
        assert.doesNotMatch(depthZeroXml, /Library A/);

        const depthOne = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { Authorization: auth, Depth: '1' },
        });
        const depthOneXml = await depthOne.text();
        assert.equal(depthOne.status, 207);
        assert.match(depthOneXml, /<d:href>\/Library%20A\/<\/d:href>/);
        assert.match(depthOneXml, /<d:displayname>Library A<\/d:displayname>/);

        const seriesPropfind = await fetch(`${baseUrl}${shareHref}Series/`, {
            method: 'PROPFIND',
            headers: { Authorization: auth, Depth: '1' },
        });
        const seriesPropfindXml = await seriesPropfind.text();
        assert.equal(seriesPropfind.status, 207);
        assert.match(seriesPropfindXml, /<d:href>\/Library%20A\/Series\/<\/d:href>/);
        assert.match(seriesPropfindXml, /<d:href>\/Library%20A\/Series\/Book%2001\.cbz<\/d:href>/);

        const infiniteDepth = await fetch(`${baseUrl}${shareHref}Series/`, {
            method: 'PROPFIND',
            headers: { Authorization: auth, Depth: 'infinity' },
        });
        const infiniteDepthXml = await infiniteDepth.text();
        assert.equal(infiniteDepth.status, 207);
        assert.match(infiniteDepthXml, /Book%2001\.cbz/);

        const noSlashDirectory = await fetch(`${baseUrl}${shareHref}Series`, {
            headers: { Authorization: auth },
            redirect: 'manual',
        });
        assert.equal(noSlashDirectory.status, 301);
        assert.equal(noSlashDirectory.headers.get('location'), '/Library%20A/Series/');

        const seriesDirectory = await fetch(`${baseUrl}${shareHref}Series/`, {
            headers: { Authorization: auth },
        });
        const seriesHtml = await seriesDirectory.text();
        assert.equal(seriesDirectory.status, 200);
        assert.match(seriesHtml, /href="\/Library%20A\/Series\/Book%2001\.cbz"/);

        const archiveResponse = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            headers: { Authorization: auth },
        });
        assert.equal(archiveResponse.status, 200);
        assert.match(archiveResponse.headers.get('content-type'), /application\/octet-stream/);
        assert.match(archiveResponse.headers.get('content-disposition'), /filename\*=UTF-8''Book%2001\.cbz/);
        assert.equal(archiveResponse.headers.get('accept-ranges'), 'bytes');
        assert.equal(archiveResponse.headers.get('content-length'), '7');
        assert.equal(await archiveResponse.text(), 'archive');
        await waitForLog(logs, /WebDAV 요청: GET .*Book%2001\.cbz -> 200/);

        const archiveHead = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            method: 'HEAD',
            headers: { Authorization: auth },
        });
        assert.equal(archiveHead.status, 200);
        assert.equal(archiveHead.headers.get('accept-ranges'), 'bytes');
        assert.equal(archiveHead.headers.get('content-length'), '7');
        assert.ok(archiveHead.headers.get('etag'));
        await waitForLog(logs, /WebDAV 요청: HEAD .*Book%2001\.cbz -> 200/);

        const streamHead = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            method: 'HEAD',
            headers: {
                Range: 'bytes=0-8',
                'User-Agent': 'ComicGlassStream/0.0',
            },
        });
        assert.equal(streamHead.status, 200);
        assert.equal(streamHead.headers.get('content-range'), null);
        assert.equal(streamHead.headers.get('content-length'), '7');

        const streamGet = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            headers: {
                Range: 'bytes=0-2',
                'User-Agent': 'ComicGlassStream/0.0',
            },
        });
        assert.equal(streamGet.status, 206);
        assert.equal(streamGet.headers.get('content-range'), 'bytes 0-2/7');
        assert.equal(await streamGet.text(), 'arc');

        const lockResponse = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            method: 'LOCK',
            headers: { Authorization: auth },
        });
        const lockXml = await lockResponse.text();
        assert.equal(lockResponse.status, 200);
        assert.match(lockResponse.headers.get('lock-token'), /^<opaquelocktoken:/);
        assert.match(lockXml, /<d:lockdiscovery>/);
        assert.match(lockXml, /Book%2001\.cbz/);

        const unlockResponse = await fetch(`${baseUrl}${shareHref}Series/Book%2001.cbz`, {
            method: 'UNLOCK',
            headers: {
                Authorization: auth,
                'Lock-Token': lockResponse.headers.get('lock-token'),
            },
        });
        assert.equal(unlockResponse.status, 204);
    });
});

test('WebDAV는 Digest 인증 클라이언트도 파일을 다운로드할 수 있다', async t => {
    const { library } = createLibraryFixture(t);
    const shareName = path.basename(library);
    const archiveUri = `/${encodeURIComponent(shareName)}/Series/Book%2001.cbz`;
    const app = buildWebdavApp(
        { dup_check_folders: [library] },
        { username: 'reader', password: 'secret' },
    );

    await withHttpServer(app, async baseUrl => {
        const challengeResponse = await fetch(baseUrl, { method: 'PROPFIND' });
        const challenge = challengeResponse.headers.get('www-authenticate') || '';
        assert.equal(challengeResponse.status, 401);
        assert.match(challenge, /Digest realm="BookManager"/);

        const archiveResponse = await fetch(`${baseUrl}${archiveUri}`, {
            headers: {
                Authorization: digestAuthHeader({
                    challenge,
                    username: 'reader',
                    password: 'secret',
                    method: 'GET',
                    uri: archiveUri,
                }),
            },
        });
        assert.equal(archiveResponse.status, 200);
        assert.match(archiveResponse.headers.get('content-type'), /application\/octet-stream/);
        assert.equal(await archiveResponse.text(), 'archive');

        const absoluteUri = `${baseUrl}${archiveUri}`;
        const absoluteDigestUriResponse = await fetch(absoluteUri, {
            headers: {
                Authorization: digestAuthHeader({
                    challenge,
                    username: 'reader',
                    password: 'secret',
                    method: 'GET',
                    uri: absoluteUri,
                }),
            },
        });
        assert.equal(absoluteDigestUriResponse.status, 200);
        assert.equal(await absoluteDigestUriResponse.text(), 'archive');

        const rangeResponse = await fetch(`${baseUrl}${archiveUri}`, {
            headers: {
                Authorization: digestAuthHeader({
                    challenge,
                    username: 'reader',
                    password: 'secret',
                    method: 'GET',
                    uri: archiveUri,
                }),
                Range: 'Bytes=0-2',
            },
        });
        assert.equal(rangeResponse.status, 206);
        assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes');
        assert.equal(rangeResponse.headers.get('content-length'), '3');
        assert.equal(rangeResponse.headers.get('content-range'), 'bytes 0-2/7');
        assert.equal(await rangeResponse.text(), 'arc');

        const multiRangeResponse = await fetch(`${baseUrl}${archiveUri}`, {
            headers: {
                Authorization: digestAuthHeader({
                    challenge,
                    username: 'reader',
                    password: 'secret',
                    method: 'GET',
                    uri: archiveUri,
                }),
                Range: 'bytes=0-1,5-6',
            },
        });
        const multiRangeBody = await multiRangeResponse.text();
        assert.equal(multiRangeResponse.status, 206);
        assert.match(multiRangeResponse.headers.get('content-type'), /multipart\/byteranges/);
        assert.ok(Number(multiRangeResponse.headers.get('content-length')) > 0);
        assert.match(multiRangeBody, /Content-Range: bytes 0-1\/7/);
        assert.match(multiRangeBody, /Content-Range: bytes 5-6\/7/);
        assert.match(multiRangeBody, /ar/);
        assert.match(multiRangeBody, /ve/);
    });
});

test('WebDAV 경로 해석은 클라이언트 Unicode 정규화 차이를 허용한다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-webdav-unicode-'));
    const library = path.join(tempRoot, 'Cafe\u0301 Library');
    const folder = path.join(library, 'Cafe\u0301 Series');
    const archive = path.join(folder, 'Cafe\u0301 01.cbz');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(archive, 'archive');
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const roots = normalizeSharingRoots({ dup_check_folders: [library] });
    const composedRequestPath = `/${encodeURIComponent('Caf\u00e9 Library')}/${encodeURIComponent('Caf\u00e9 Series')}/${encodeURIComponent('Caf\u00e9 01.cbz')}`;
    assert.equal(resolveWebdavPath(composedRequestPath, roots)?.resolved, fs.realpathSync(archive));

    const app = buildWebdavApp(
        { dup_check_folders: [library] },
        { username: 'reader', password: 'secret' },
    );
    const auth = `Basic ${Buffer.from('reader:secret').toString('base64')}`;

    await withHttpServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}${composedRequestPath}`, {
            headers: { Authorization: auth },
        });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'archive');
    });
});

test('WebDAV 경로 해석은 traversal, 잘못된 encoding, 라이브러리 밖 symlink를 차단한다', t => {
    const { tempRoot, library } = createLibraryFixture(t);
    const roots = normalizeSharingRoots({ dup_check_folders: [library] });
    const sharePath = `/${encodeURIComponent(path.basename(library))}`;

    assert.equal(resolveWebdavPath(`${sharePath}/../outside.cbz`, roots), null);
    assert.equal(resolveWebdavPath(`${sharePath}/%E0%A4%A`, roots), null);

    const outside = path.join(tempRoot, 'outside');
    const link = path.join(library, 'outside-link');
    fs.mkdirSync(outside);
    try {
        fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.equal(resolveWebdavPath(`${sharePath}/outside-link`, roots), null);
    } catch (error) {
        if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
});

test('WebDAV 루트는 Python 가상 루트처럼 라이브러리명을 노출하고 중복명을 분리한다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-webdav-shares-'));
    const first = path.join(tempRoot, 'A', 'Books');
    const second = path.join(tempRoot, 'B', 'Books');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const app = buildWebdavApp(
        { dup_check_folders: [first, second] },
        { username: 'reader', password: 'secret' },
    );
    const auth = `Basic ${Buffer.from('reader:secret').toString('base64')}`;

    await withHttpServer(app, async baseUrl => {
        const depthOne = await fetch(baseUrl, {
            method: 'PROPFIND',
            headers: { Authorization: auth, Depth: '1' },
        });
        const xml = await depthOne.text();
        assert.equal(depthOne.status, 207);
        assert.match(xml, /<d:href>\/Books\/<\/d:href>/);
        assert.match(xml, /<d:href>\/Books_1\/<\/d:href>/);
        assert.match(xml, /<d:displayname>Books_1<\/d:displayname>/);
    });
});

test('공유 서버 포트는 1024부터 65535까지만 허용한다', async () => {
    await assert.rejects(
        startSharingServer('OPDS', { port: 1023 }, {}),
        /1024부터 65535/,
    );
    await assert.rejects(
        startSharingServer('WebDAV', { port: 65536 }, {}),
        /1024부터 65535/,
    );
    await assert.rejects(
        startSharingServer('Web', { port: 1023 }, {}),
        /1024부터 65535/,
    );
});

test('Web 서버 타입은 공백이 있어도 OPDS로 fallback하지 않는다', async () => {
    const port = await getFreePort();
    assert.equal(normalizeSharingServerType('Web '), 'Web');
    assert.equal(normalizeSharingServerType(' OPDS '), 'OPDS');
    assert.equal(normalizeSharingServerType('OPDF'), null);

    try {
        await startSharingServer('Web ', { port }, {});
        const status = getSharingServerStatus();
        assert.equal(status.Web.running, true);
        assert.equal(status.OPDS.running, false);
        assert.equal(status.Web.port, port);
    } finally {
        await stopAllSharingServers();
    }
});

test('알 수 없는 공유 서버 타입은 OPDS로 시작하지 않고 거부한다', async () => {
    await assert.rejects(
        startSharingServer('OPDF', { port: 8082 }, {}),
        /지원하지 않는 서버 타입/,
    );
    assert.equal(getSharingServerStatus().OPDS.running, false);
});

test('포트 충돌 시 서버 상태를 실행 중으로 남기지 않고 오류 로그를 전달한다', async () => {
    const blocker = http.createServer();
    await new Promise(resolve => blocker.listen(0, '0.0.0.0', resolve));
    const port = blocker.address().port;
    const logs = [];

    try {
        await assert.rejects(
            startSharingServer('OPDS', { port }, {}, log => logs.push(log)),
            error => error.code === 'EADDRINUSE',
        );
        assert.equal(getSharingServerStatus().OPDS.running, false);
        assert.equal(logs.at(-1)?.type, 'ERROR');
    } finally {
        await stopSharingServer('OPDS');
        await new Promise(resolve => blocker.close(resolve));
    }
});

test('OPDS, Web, WebDAV를 동시에 실행한 뒤 모두 중지하면 포트를 해제한다', async () => {
    const firstPort = await getFreePort();
    const secondPort = await getFreePort();
    const thirdPort = await getFreePort();

    try {
        await startSharingServer('OPDS', { port: firstPort }, {});
        await startSharingServer('Web', { port: secondPort }, {});
        await startSharingServer('WebDAV', {
            port: thirdPort,
            username: 'reader',
            password: 'secret',
        }, {});
        assert.equal(getSharingServerStatus().OPDS.running, true);
        assert.equal(getSharingServerStatus().Web.running, true);
        assert.equal(getSharingServerStatus().WebDAV.running, true);
    } finally {
        await stopAllSharingServers();
    }

    assert.equal(getSharingServerStatus().OPDS.running, false);
    assert.equal(getSharingServerStatus().Web.running, false);
    assert.equal(getSharingServerStatus().WebDAV.running, false);

    const rebound = http.createServer();
    await new Promise(resolve => rebound.listen(firstPort, '127.0.0.1', resolve));
    await new Promise(resolve => rebound.close(resolve));
});

test('Web 서버 상태 URL은 브라우저 루트 주소를 반환한다', async () => {
    const port = await getFreePort();

    try {
        const result = await startSharingServer('Web', { port }, {});
        assert.equal(result.url, `http://${result.localIp}:${port}/`);
        assert.equal(getSharingServerStatus().Web.url, `http://${result.localIp}:${port}/`);
    } finally {
        await stopSharingServer('Web');
    }
});

test('HTTPS 공유 서버는 자체 서명 인증서로 https URL과 secure 상태를 반환한다', async t => {
    const port = await getFreePort();
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-sharing-cert-'));
    const logs = [];

    try {
        const result = await startSharingServer(
            'Web',
            { port, https: true, httpsCertDir: certDir },
            {},
            log => logs.push(log),
        );

        assert.equal(result.url, `https://${result.localIp}:${port}/`);
        assert.equal(getSharingServerStatus().Web.secure, true);
        assert.equal(getSharingServerStatus().Web.url, `https://${result.localIp}:${port}/`);
        assert.ok(fs.existsSync(path.join(certDir, 'bookmanager-sharing.crt')));
        assert.ok(fs.existsSync(path.join(certDir, 'bookmanager-sharing.key')));
        assert.ok(logs.some(log => /자체 서명 인증서/.test(log.message)));

        await new Promise((resolve, reject) => {
            const req = https.get(`https://127.0.0.1:${port}/`, { rejectUnauthorized: false }, res => {
                res.resume();
                res.on('end', () => {
                    try {
                        assert.equal(res.statusCode, 200);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
        });
    } finally {
        await stopSharingServer('Web');
        fs.rmSync(certDir, { recursive: true, force: true });
    }
});
