import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildOpdsApp,
    buildWebdavApp,
    getSharingServerStatus,
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

test('OPDS 루트는 등록 라이브러리를 표시하고 하위 폴더와 아카이브를 탐색한다', async t => {
    const { library, child } = createLibraryFixture(t);
    const app = buildOpdsApp({ dup_check_folders: [library] });

    await withHttpServer(app, async baseUrl => {
        const rootResponse = await fetch(`${baseUrl}/opds`);
        const rootXml = await rootResponse.text();
        assert.equal(rootResponse.status, 200);
        assert.match(rootXml, /Library A/);
        assert.match(rootXml, /rel="subsection"/);

        const childResponse = await fetch(`${baseUrl}/opds?dir=${encodeURIComponent(child)}`);
        const childXml = await childResponse.text();
        assert.equal(childResponse.status, 200);
        assert.match(childXml, /Book 01\.cbz/);
        assert.match(childXml, /application\/x-cbz/);
        assert.doesNotMatch(childXml, /ignore\.txt/);
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

test('WebDAV는 Basic Auth와 Depth 0/1 PROPFIND를 처리한다', async t => {
    const { library } = createLibraryFixture(t);
    const logs = [];
    const app = buildWebdavApp(
        { dup_check_folders: [library] },
        { username: 'reader', password: 'secret' },
        (message, type) => logs.push({ message, type }),
    );
    const auth = `Basic ${Buffer.from('reader:secret').toString('base64')}`;

    await withHttpServer(app, async baseUrl => {
        const unauthorized = await fetch(baseUrl, { method: 'PROPFIND' });
        assert.equal(unauthorized.status, 401);
        assert.match(unauthorized.headers.get('www-authenticate'), /^Basic /);
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
        assert.match(depthOneXml, /Library A/);

        const archiveResponse = await fetch(`${baseUrl}/lib/0/Series/Book%2001.cbz`, {
            headers: { Authorization: auth },
        });
        assert.equal(archiveResponse.status, 200);
        assert.match(archiveResponse.headers.get('content-type'), /application\/x-cbz/);
    });
});

test('WebDAV 경로 해석은 traversal, 잘못된 encoding, 라이브러리 밖 symlink를 차단한다', t => {
    const { tempRoot, library } = createLibraryFixture(t);
    const roots = normalizeSharingRoots({ dup_check_folders: [library] });

    assert.equal(resolveWebdavPath('/lib/0/../outside.cbz', roots), null);
    assert.equal(resolveWebdavPath('/lib/0/%E0%A4%A', roots), null);

    const outside = path.join(tempRoot, 'outside');
    const link = path.join(library, 'outside-link');
    fs.mkdirSync(outside);
    try {
        fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.equal(resolveWebdavPath('/lib/0/outside-link', roots), null);
    } catch (error) {
        if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    }
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

test('OPDS와 WebDAV를 동시에 실행한 뒤 모두 중지하면 포트를 해제한다', async () => {
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const firstPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const secondPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));

    try {
        await startSharingServer('OPDS', { port: firstPort }, {});
        await startSharingServer('WebDAV', {
            port: secondPort,
            username: 'reader',
            password: 'secret',
        }, {});
        assert.equal(getSharingServerStatus().OPDS.running, true);
        assert.equal(getSharingServerStatus().WebDAV.running, true);
    } finally {
        await stopAllSharingServers();
    }

    assert.equal(getSharingServerStatus().OPDS.running, false);
    assert.equal(getSharingServerStatus().WebDAV.running, false);

    const rebound = http.createServer();
    await new Promise(resolve => rebound.listen(firstPort, '127.0.0.1', resolve));
    await new Promise(resolve => rebound.close(resolve));
});
