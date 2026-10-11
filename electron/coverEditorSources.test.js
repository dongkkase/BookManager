import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { applyCoverEditor, coverEditorCapabilities, inspectCoverEditor, listCoverEditorArchiveImages, loadCoverEditorArchiveImage, loadCoverEditorArchiveThumbnails } from './coverEditor.js';
import { listZipEntries, readZipEntry, replaceZipEntries, replaceZipEntry } from './core/zipArchive.js';
import { readComicCoverImage } from './comicCoverEditor.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');

async function fixture(t, extension = '.cbz', entries = { '001.png': PNG, '002.png': OTHER_PNG }) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-sources-test-'));
    const filePath = path.join(directory, `book${extension}`);
    await fs.writeFile(filePath, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
    await replaceZipEntries(filePath, Object.entries(entries).map(([name, content]) => ({ name, content })));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return { directory, filePath };
}

async function requestFor(filePath) {
    const stat = await fs.lstat(filePath);
    return { filePath, version: [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':') };
}

function centralOffsetFor(bytes, name) {
    let offset = bytes.readUInt32LE(bytes.length - 22 + 16);
    while (bytes.readUInt32LE(offset) === 0x02014b50) {
        const nameLength = bytes.readUInt16LE(offset + 28);
        if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8') === name) return offset;
        offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    throw new Error(`Missing ZIP entry: ${name}`);
}

async function selectedImage(t, request, options) {
    const image = await loadCoverEditorArchiveImage(request, options);
    t.after(() => fs.rm(image.cleanupDirectory, { recursive: true, force: true }));
    return image;
}

test('만화와 EPUB만 압축 내부 이미지 선택을 제공한다', async t => {
    for (const extension of ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.epub']) {
        assert.equal(coverEditorCapabilities(`book${extension}`).canSelectArchiveImage, true);
    }
    for (const extension of ['.pdf', '.txt', '.mp3']) {
        assert.equal(coverEditorCapabilities(`book${extension}`).canSelectArchiveImage, false);
        await assert.rejects(listCoverEditorArchiveImages({ filePath: `book${extension}` }), /no archive images/);
    }
    const { filePath } = await fixture(t);
    assert.equal((await inspectCoverEditor(filePath)).canSelectArchiveImage, true);
});

test('압축 이미지 목록은 지원 이미지만 정렬하고 페이지당 최대 100개를 반환한다', async t => {
    for (const extension of ['.cbz', '.epub']) {
        const entries = Object.fromEntries(Array.from({ length: 135 }, (_, index) => [`images/${135 - index}.png`, PNG]));
        Object.assign(entries, { 'notes.txt': 'note', '__MACOSX/._001.png': PNG, 'images/vector.svg': '<svg/>', 'images/folder/': '' });
        const { filePath } = await fixture(t, extension, entries);
        const request = await requestFor(filePath);
        const first = await listCoverEditorArchiveImages(request);
        assert.equal(first.entries.length, 60);
        assert.equal(first.total, 135);
        assert.equal(first.offset, 0);
        assert.deepEqual(first.entries[0], { name: 'images/1.png' });
        assert.deepEqual(first.entries[59], { name: 'images/60.png' });
        const bounded = await listCoverEditorArchiveImages({ ...request, limit: 9999 });
        assert.equal(bounded.entries.length, 100);
        const last = await listCoverEditorArchiveImages({ ...request, offset: 130 });
        assert.deepEqual(last.entries.map(entry => entry.name), ['images/131.png', 'images/132.png', 'images/133.png', 'images/134.png', 'images/135.png']);
        assert.equal(last.offset, 130);
        assert.deepEqual((await listCoverEditorArchiveImages({ ...request, offset: 999 })).entries, []);
        for (const value of [{ offset: -1 }, { offset: 1.1 }, { limit: 0 }, { limit: '10' }]) {
            await assert.rejects(listCoverEditorArchiveImages({ ...request, ...value }), /valid archive image page/);
        }
    }
});

test('내부 이미지 미리보기는 임시 복사본을 만들고 기존 저장 흐름으로 표지를 교체한다', async t => {
    const { filePath } = await fixture(t);
    const original = await fs.readFile(filePath);
    const descriptor = await inspectCoverEditor(filePath);
    const image = await selectedImage(t, { ...descriptor, entryName: '002.png' }, {
        normalizeImage(buffer, mimeType) { return { buffer, mimeType, width: 1, height: 1 }; },
    });
    assert.equal(image.entryName, '002.png');
    assert.equal(path.dirname(image.imagePath), image.cleanupDirectory);
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
    assert.equal(image.size, OTHER_PNG.length);
    assert.equal(image.dataUrl, `data:image/png;base64,${OTHER_PNG.toString('base64')}`);
    assert.match(image.imageVersion, /^[a-f0-9]{64}$/);
    assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
    assert.deepEqual(await fs.readFile(filePath), original);
    await applyCoverEditor({ ...descriptor, imagePath: image.imagePath, imageVersion: image.imageVersion, mode: 'replace', targetEntry: '001.png', backup: false });
    const updated = await fs.readFile(filePath);
    const entries = listZipEntries(updated);
    assert.deepEqual(readZipEntry(updated, entries.find(entry => entry.name === '001.png')), OTHER_PNG);
    assert.deepEqual(readZipEntry(updated, entries.find(entry => entry.name === '002.png')), OTHER_PNG);
});

test('EPUB 내부 이미지는 중첩 경로를 임시 경로로 사용하지 않고 복사한다', async t => {
    const { filePath } = await fixture(t, '.epub', { 'OEBPS/images/page.png': PNG, 'OEBPS/chapter.xhtml': '<html/>' });
    const request = await requestFor(filePath);
    const image = await selectedImage(t, { ...request, entryName: 'OEBPS/images/page.png' });
    assert.equal(path.basename(image.imagePath), 'cover.png');
    assert.deepEqual(await fs.readFile(image.imagePath), PNG);
    await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: '../page.png' }), /no longer available/);
    await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: 'OEBPS/chapter.xhtml' }), /no longer available/);
});

test('목록을 연 뒤 원본이 바뀌면 목록 및 이미지 읽기를 거절한다', async t => {
    const { filePath } = await fixture(t);
    const request = await requestFor(filePath);
    await replaceZipEntry(filePath, 'note.txt', 'external change');
    await assert.rejects(listCoverEditorArchiveImages(request), { code: 'COVER_SOURCE_CHANGED' });
    await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: '001.png' }), { code: 'COVER_SOURCE_CHANGED' });
    await assert.rejects(listCoverEditorArchiveImages({ filePath }), /Open the cover editor/);
});

test('이미지 준비 중 원본 변경과 디코딩 실패는 임시 복사본을 정리한다', async t => {
    for (const changeSource of [true, false]) {
        const { filePath } = await fixture(t);
        const before = new Set(await fs.readdir(os.tmpdir()));
        const request = await requestFor(filePath);
        await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: '002.png' }, {
            async normalizeImage(buffer, mimeType) {
                if (!changeSource) throw new Error('Image decoding failed');
                await replaceZipEntry(filePath, 'external.txt', 'changed');
                return { buffer, mimeType };
            },
        }), changeSource ? { code: 'COVER_SOURCE_CHANGED' } : /Image decoding failed/);
        assert.deepEqual((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('bookmanager-cover-source-') && !before.has(name)), []);
    }
});

test('위험한 EPUB 이미지 경로, 링크, 암호화와 중복 이름을 거절한다', async t => {
    for (const kind of ['path', 'option', 'listfile', 'link', 'encrypted', 'collision']) {
        const name = kind === 'path' ? '../001.png' : kind === 'option' ? '-001.png' : kind === 'listfile' ? '@001.png' : '001.png';
        const { filePath } = await fixture(t, '.epub', { [name]: PNG, '002.png': PNG });
        const bytes = await fs.readFile(filePath);
        const central = centralOffsetFor(bytes, name);
        if (kind === 'link') bytes.writeUInt32LE(0xa1ff0000 >>> 0, central + 38);
        if (kind === 'encrypted') bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
        if (kind === 'collision') {
            const second = centralOffsetFor(bytes, '002.png');
            Buffer.from('001.PNG').copy(bytes, second + 46);
        }
        await fs.writeFile(filePath, bytes);
        const request = await requestFor(filePath);
        await assert.rejects(listCoverEditorArchiveImages(request), /unsafe|Encrypted|duplicate/);
        await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: name }), /unsafe|Encrypted|duplicate/);
        assert.deepEqual(await fs.readFile(filePath), bytes);
    }
});

test('16MiB 초과, 위조한 이미지와 손상된 EPUB 이미지 데이터는 거절한다', async t => {
    for (const extension of ['.cbz', '.epub']) {
        const { filePath } = await fixture(t, extension, {
            'large.png': Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]),
            'fake.png': 'not an image',
        });
        const request = await requestFor(filePath);
        await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: 'large.png' }), /16 MiB/);
        await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: 'fake.png' }), /JPEG, PNG/);
    }
    const { filePath } = await fixture(t, '.epub', { '001.png': PNG });
    const bytes = await fs.readFile(filePath);
    const central = centralOffsetFor(bytes, '001.png');
    bytes.writeUInt32LE(0, central + 16);
    await fs.writeFile(filePath, bytes);
    await assert.rejects(loadCoverEditorArchiveImage({ ...await requestFor(filePath), entryName: '001.png' }), /read completely/);
});

test('압축 썸네일은 목록을 한 번 읽고 임시 이미지 없이 최대 두 개씩 생성한다', async t => {
    for (const extension of ['.cbz', '.epub']) {
        const names = Array.from({ length: 8 }, (_, index) => `images/${index + 1}.png`);
        const { filePath } = await fixture(t, extension, Object.fromEntries(names.map(name => [name, PNG])));
        const request = await requestFor(filePath);
        const original = await fs.readFile(filePath);
        const before = new Set(await fs.readdir(os.tmpdir()));
        const open = fs.open;
        let sourceOpens = 0;
        const openMock = t.mock.method(fs, 'open', async (...args) => {
            if (args[0] === filePath) sourceOpens += 1;
            return open(...args);
        });
        let active = 0;
        let maximumActive = 0;
        const result = await loadCoverEditorArchiveThumbnails({ ...request, entryNames: names }, {
            async createThumbnail(buffer, mimeType) {
                assert.deepEqual(buffer, PNG);
                assert.equal(mimeType, 'image/png');
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                await new Promise(resolve => setTimeout(resolve, 5));
                active -= 1;
                return { thumbnailDataUrl: 'data:image/png;base64,thumbnail', width: 1080, height: 1920 };
            },
            normalizeImage() { assert.fail('Thumbnails must not create full image previews.'); },
        });
        openMock.mock.restore();
        assert.equal(sourceOpens, names.length + (extension === '.cbz' ? 2 : 1));
        assert.equal(maximumActive, 2);
        assert.deepEqual(result.entries, names.map(name => ({
            name, thumbnailDataUrl: 'data:image/png;base64,thumbnail', width: 1080, height: 1920,
        })));
        assert.deepEqual(await fs.readFile(filePath), original);
        assert.deepEqual((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('bookmanager-cover-source-') && !before.has(name)), []);
    }
});

test('썸네일 요청은 중복 없는 1~8개 이름으로 제한한다', async () => {
    for (const entryNames of [undefined, [], Array(9).fill('001.png'), ['001.png', '001.png'], [null], ['']]) {
        await assert.rejects(loadCoverEditorArchiveThumbnails({ filePath: '/not-read.cbz', entryNames }), /between 1 and 8/);
    }
});

test('손상되거나 큰 썸네일 항목이 있어도 정상 이미지와 원래 순서를 유지한다', async t => {
    for (const extension of ['.cbz', '.epub']) {
        const { filePath } = await fixture(t, extension, {
            'good.png': PNG, 'crc.png': PNG,
            'large.png': Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]),
            'fake.png': 'not an image', 'decode.png': OTHER_PNG,
        });
        const bytes = await fs.readFile(filePath);
        bytes.writeUInt32LE(0, centralOffsetFor(bytes, 'crc.png') + 16);
        await fs.writeFile(filePath, bytes);
        const request = await requestFor(filePath);
        const entryNames = ['large.png', 'good.png', 'crc.png', 'fake.png', 'decode.png', 'missing.png'];
        let decoded = 0;
        const result = await loadCoverEditorArchiveThumbnails({ ...request, entryNames }, {
            createThumbnail(buffer) {
                decoded += 1;
                if (buffer.equals(OTHER_PNG)) throw new Error('Image decoding failed');
                return { thumbnailDataUrl: 'data:image/png;base64,good', width: 1, height: 1 };
            },
        });
        assert.equal(decoded, 2);
        assert.deepEqual(result.entries.map(entry => entry.name), entryNames);
        assert.match(result.entries[0].error, /16 MiB/);
        assert.equal(result.entries[1].thumbnailDataUrl, 'data:image/png;base64,good');
        assert.match(result.entries[2].error, /read completely/);
        assert.match(result.entries[3].error, /JPEG, PNG/);
        assert.match(result.entries[4].error, /decoding failed/);
        assert.match(result.entries[5].error, /no longer available/);
        for (const entry of result.entries.filter(entry => entry.error)) {
            assert.equal(entry.thumbnailDataUrl, '');
            assert.equal(entry.width, 0);
            assert.equal(entry.height, 0);
        }
        await assert.rejects(loadCoverEditorArchiveImage({ ...request, entryName: 'crc.png' }), /read completely/);
    }
});

test('썸네일은 추출 전이나 생성 중 원본 버전 변경을 전체 요청 오류로 반환한다', async t => {
    const { filePath } = await fixture(t);
    const request = await requestFor(filePath);
    await assert.rejects(loadCoverEditorArchiveThumbnails({ ...request, entryNames: ['001.png'] }, {
        async createThumbnail() {
            await replaceZipEntry(filePath, 'external.txt', 'changed');
            return { thumbnailDataUrl: 'data:image/png;base64,old', width: 1, height: 1 };
        },
    }), { code: 'COVER_SOURCE_CHANGED' });
    await assert.rejects(loadCoverEditorArchiveThumbnails({ ...request, entryNames: ['001.png'] }, {
        createThumbnail() { assert.fail('A stale source must not be read.'); },
    }), { code: 'COVER_SOURCE_CHANGED' });
});

test('썸네일 요청 취소는 진행 중인 두 항목 이후 추출을 중단한다', async t => {
    assert.deepEqual(await loadCoverEditorArchiveThumbnails({ filePath: '/not-read.cbz', entryNames: ['001.png'] }, {
        shouldCancel: () => true,
    }), { cancelled: true });
    const entryNames = Array.from({ length: 8 }, (_, index) => `${index + 1}.png`);
    const { filePath } = await fixture(t, '.cbz', Object.fromEntries(entryNames.map(name => [name, PNG])));
    let cancelled = false;
    let decoded = 0;
    const result = await loadCoverEditorArchiveThumbnails({ ...await requestFor(filePath), entryNames }, {
        shouldCancel: () => cancelled,
        async createThumbnail() {
            decoded += 1;
            await new Promise(resolve => setTimeout(resolve, 5));
            cancelled = true;
            return { thumbnailDataUrl: 'data:image/png;base64,unused', width: 1, height: 1 };
        },
    });
    assert.deepEqual(result, { cancelled: true });
    assert.ok(decoded > 0 && decoded <= 2);
});

test('7z 내부 이미지 선택과 추출 상한을 적용하고 원본을 보존한다', async t => {
    const { directory, filePath: zipPath } = await fixture(t);
    const filePath = path.join(directory, 'book.cb7');
    const source = path.join(directory, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, '001.png'), PNG);
    await fs.writeFile(path.join(source, '002.png'), OTHER_PNG);
    const sevenZExe = createRequire(import.meta.url)('7zip-bin').path7za;
    const packed = spawnSync(sevenZExe, ['a', '-t7z', filePath, '.'], { cwd: source, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const original = await fs.readFile(filePath);
    const request = await requestFor(filePath);
    assert.deepEqual((await listCoverEditorArchiveImages(request, { sevenZExe })).entries, [{ name: '001.png' }, { name: '002.png' }]);
    const image = await selectedImage(t, { ...request, entryName: '002.png' }, { sevenZExe });
    assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
    const thumbnails = await loadCoverEditorArchiveThumbnails({ ...request, entryNames: ['001.png', '002.png'] }, {
        sevenZExe,
        createThumbnail(buffer, mimeType) {
            return { thumbnailDataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, width: 1, height: 1 };
        },
    });
    assert.deepEqual(thumbnails.entries.map(entry => entry.thumbnailDataUrl), [PNG, OTHER_PNG].map(buffer => `data:image/png;base64,${buffer.toString('base64')}`));
    assert.deepEqual(await fs.readFile(filePath), original);
    await assert.rejects(readComicCoverImage(filePath, '001.png', { sevenZExe, maxImageBytes: 8 }), /too large/);
    await assert.rejects(readComicCoverImage(zipPath, '001.png', { maxImageBytes: 8 }), /too large/);
});
