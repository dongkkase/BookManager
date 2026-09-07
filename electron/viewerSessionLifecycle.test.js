import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';
import { replaceZipEntry } from './core/zipArchive.js';

test('정리된 세션의 늦은 만화 목록 응답은 고아 캐시를 만들지 않는다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-session-lifecycle-'));
    try {
        const source = path.join(root, 'book.cbz');
        await fs.writeFile(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('page'));
        let pendingSevenZip;
        const manager = new ViewerSessionManager({ getSevenZPath: () => pendingSevenZip });
        for (let batch = 0; batch < 3; batch += 1) {
            let release;
            pendingSevenZip = new Promise(resolve => { release = resolve; });
            const requests = [];
            for (let index = 0; index < 40; index += 1) {
                const session = manager.create(source, { skipAdjacent: true });
                requests.push(manager.listComicPages(session.id));
            }
            release('');
            await Promise.all(requests);
            assert.equal(manager.sessions.size, 16);
            assert.equal(manager.comicArchiveEntryCaches.size, 16);
            assert.ok([...manager.comicArchiveEntryCaches.keys()].every(id => manager.sessions.has(id)));
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('EPUB 장과 이미지의 읽기는 ZIP 목록을 재사용하고 취소 후 중단한다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-lifecycle-'));
    const originalOpen = fs.open;
    try {
        const source = path.join(root, 'book.epub');
        await fs.writeFile(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'style.css', 'p { color: #123456; }');
        for (let index = 1; index <= 3; index += 1) {
            await replaceZipEntry(source, `chapter${index}.html`, `<html><head><link rel="stylesheet" href="style.css" /></head><body><p>Chapter ${index}</p><img src="image1.png" /></body></html>`);
        }
        for (let index = 1; index <= 2; index += 1) {
            const png = Buffer.alloc(24);
            png[0] = 0x89;
            png.write('PNG', 1, 'ascii');
            png.write('IHDR', 12, 'ascii');
            png.writeUInt32BE(1200, 16);
            png.writeUInt32BE(1800, 20);
            await replaceZipEntry(source, `image${index}.png`, png);
        }
        const manager = new ViewerSessionManager();
        const session = manager.create(source, { skipAdjacent: true });
        let openCount = 0;
        let controller;
        fs.open = async (...args) => {
            if (args[0] === source) {
                openCount += 1;
                if (controller && openCount === 3) controller.abort();
            }
            return originalOpen(...args);
        };
        const result = await manager.getEpubText(session.id);
        assert.deepEqual(result.chapters.map(chapter => chapter.text), ['Chapter 1', 'Chapter 2', 'Chapter 3']);
        assert.equal(openCount, 8, '목록 1회, 이미지 2회, CSS 2회, 본문 3회만 연다');
        openCount = 0;
        controller = new AbortController();
        await assert.rejects(manager.getEpubText(session.id, { signal: controller.signal }), { name: 'AbortError' });
        assert.equal(openCount, 3, '취소한 뒤 다음 이미지와 본문을 읽지 않는다');
    } finally {
        fs.open = originalOpen;
        await fs.rm(root, { recursive: true, force: true });
    }
});
