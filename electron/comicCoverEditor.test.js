import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import test from 'node:test';
import { convertComicToZip, inspectComicCover, readComicCoverImage, writeComicCover } from './comicCoverEditor.js';
import { crc32, getZipEntryCompressedData, listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';

const require = createRequire(import.meta.url);
const sevenZExe = require('7zip-bin').path7za;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);

function temporary(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-comic-cover-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.cbz');
    const imagePath = path.join(directory, 'cover.png');
    fs.writeFileSync(imagePath, PNG);
    return { directory, filePath, imagePath };
}

async function zipFixture(filePath, entries) {
    fs.writeFileSync(filePath, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
    for (const [name, content] of Object.entries(entries)) await replaceZipEntry(filePath, name, content);
}

function readContents(filePath) {
    const bytes = fs.readFileSync(filePath);
    return Object.fromEntries(listZipEntries(bytes).filter(entry => !entry.isDirectory).map(entry => [entry.name, readZipEntry(bytes, entry)]));
}

function pack(sourceDirectory, filePath, type = '7z') {
    const result = spawnSync(sevenZExe, ['a', `-t${type}`, filePath, '.'], { cwd: sourceDirectory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('만화 커버 미리보기는 뷰어의 ! 우선 정렬과 숫자 순서를 따른다', async t => {
    const { filePath } = temporary(t);
    await zipFixture(filePath, { '002.png': PNG, 'Cover.jpg': JPEG, 'chapter/!first.png': PNG, '010.png': PNG, '__MACOSX/._001.jpg': JPEG });
    const result = await inspectComicCover(filePath);
    assert.equal(result.coverEntry, 'chapter/!first.png');
    assert.deepEqual(result.pages.map(page => page.name), ['chapter/!first.png', '002.png', '010.png', 'Cover.jpg']);
    assert.deepEqual(await readComicCoverImage(filePath, result.coverEntry), PNG);
    await assert.rejects(readComicCoverImage(filePath, '../page.png'), /no longer available/);
});

test('첫 페이지 교체는 이미지 형식을 맞추고 다른 압축 데이터와 메타데이터를 유지한다', async t => {
    const { filePath, imagePath } = temporary(t);
    const xml = '<ComicInfo><Title>원본 &amp; 제목</Title><Extra custom="yes">보존</Extra><PageCount>2</PageCount><Pages><Page Image="0" Type="FrontCover" ImageWidth="100" ImageHeight="200" Bookmark="first" /><Page Image="1" Bookmark="chapter" DoublePage="true" /></Pages></ComicInfo>';
    await zipFixture(filePath, { '001.jpg': JPEG, '002.jpg': JPEG, 'notes/data.bin': Buffer.alloc(2000, 0x42), 'ComicInfo.xml': xml });
    const before = fs.readFileSync(filePath);
    const retained = listZipEntries(before).find(entry => entry.name === '002.jpg');
    const compressed = getZipEntryCompressedData(before, retained);
    const result = await writeComicCover(filePath, imagePath, { mode: 'replace' });
    assert.equal(result.coverEntry, '001.png');
    assert.equal(result.pageCount, 2);
    const contents = readContents(filePath);
    assert.equal(contents['001.jpg'], undefined);
    assert.deepEqual(contents['001.png'], PNG);
    assert.deepEqual(contents['002.jpg'], JPEG);
    assert.deepEqual(contents['notes/data.bin'], Buffer.alloc(2000, 0x42));
    assert.match(contents['ComicInfo.xml'].toString(), /<Extra custom="yes">보존<\/Extra>/);
    assert.match(contents['ComicInfo.xml'].toString(), /Image="0" Type="FrontCover" Bookmark="first" ImageSize="\d+"/);
    assert.doesNotMatch(contents['ComicInfo.xml'].toString(), /ImageWidth|ImageHeight/);
    const after = fs.readFileSync(filePath);
    assert.deepEqual(getZipEntryCompressedData(after, listZipEntries(after).find(entry => entry.name === '002.jpg')), compressed);
});

test('표지 추가와 재정렬은 모든 기존 페이지와 ComicInfo의 페이지별 속성을 보존한다', async t => {
    const { filePath, imagePath } = temporary(t);
    const xml = '<?xml version="1.0" encoding="utf-8"?><ComicInfo xmlns:custom="example"><Title>Book</Title><!-- <Page Image="99" /> --><custom:Rating value="5"/><PageCount>3</PageCount><Pages><Page Image="0" Type="FrontCover" Bookmark="old-cover"/><Page Image="1" ImageWidth="1200" DoublePage="true" Bookmark="middle"/><Page Image="2" Key="last"/></Pages></ComicInfo>';
    const originals = { 'chapter/!cover.jpg': JPEG, 'part2/2.png': PNG, 'part2/10.png': Buffer.concat([PNG, Buffer.from('last')]) };
    await zipFixture(filePath, { ...originals, 'ComicInfo.xml': xml, 'book.txt': 'sidecar' });
    const result = await writeComicCover(filePath, imagePath, { mode: 'add', renumber: true });
    assert.equal(result.pageCount, 4);
    assert.equal(result.coverEntry, '0000.png');
    const contents = readContents(filePath);
    assert.deepEqual(contents['0000.png'], PNG);
    for (const [oldName, buffer] of Object.entries(originals)) assert.deepEqual(contents[result.entryMap[oldName]], buffer);
    assert.equal(contents['book.txt'].toString(), 'sidecar');
    const updated = contents['ComicInfo.xml'].toString();
    assert.match(updated, /<PageCount>4<\/PageCount>/);
    assert.match(updated, /<!-- <Page Image="99" \/> -->/);
    assert.match(updated, /<custom:Rating value="5"\/>/);
    assert.match(updated, /Image="1" Bookmark="old-cover"/);
    assert.match(updated, /Image="2" ImageWidth="1200" DoublePage="true" Bookmark="middle"/);
    assert.match(updated, /Image="3" Key="last"/);
    assert.equal((updated.match(/FrontCover/g) || []).length, 1);
    assert.equal((await inspectComicCover(filePath)).coverEntry, '0000.png');
});

test('재정렬 없는 표지 추가는 기존 이름을 유지하고 새 이미지만 맨 앞에 넣는다', async t => {
    const { filePath, imagePath } = temporary(t);
    await zipFixture(filePath, { 'chapter/!first.jpg': JPEG, 'chapter/002.png': PNG });
    const result = await writeComicCover(filePath, imagePath, { mode: 'add', renumber: false });
    assert.deepEqual(result.entryMap, { 'chapter/!first.jpg': 'chapter/!first.jpg', 'chapter/002.png': 'chapter/002.png' });
    const after = await inspectComicCover(filePath);
    assert.equal(after.coverEntry, result.coverEntry);
    assert.deepEqual(after.pages.slice(1).map(page => page.name), ['chapter/!first.jpg', 'chapter/002.png']);
});

test('잘못된 XML과 페이지 인덱스 및 저장 직전 취소는 압축 원본을 보존한다', async t => {
    for (const xml of [
        '<ComicInfo><Title>broken</ComicInfo>',
        '<!DOCTYPE ComicInfo [<!ENTITY x SYSTEM "file:///example">]><ComicInfo/>',
        '<ComicInfo><Pages><Page Image="3"/></Pages></ComicInfo>',
        '<ComicInfo><Pages><Page Image="0"/><Page Image="0"/></Pages></ComicInfo>',
    ]) {
        const { filePath, imagePath } = temporary(t);
        await zipFixture(filePath, { '001.jpg': JPEG, 'ComicInfo.xml': xml });
        const before = fs.readFileSync(filePath);
        await assert.rejects(writeComicCover(filePath, imagePath, { mode: 'add' }), /ComicInfo/);
        assert.deepEqual(fs.readFileSync(filePath), before);
    }
    const { filePath, imagePath } = temporary(t);
    await zipFixture(filePath, { '001.jpg': JPEG });
    const before = fs.readFileSync(filePath);
    await assert.rejects(writeComicCover(filePath, imagePath, { mode: 'replace', shouldCancel: () => true }), { code: 'TASK_CANCELLED' });
    assert.deepEqual(fs.readFileSync(filePath), before);
});

test('위험한 경로와 링크·암호화·대소문자 충돌을 가진 압축은 쓰기 전에 거절한다', async t => {
    for (const kind of ['path', 'link', 'encrypted', 'collision']) {
        const { filePath, imagePath } = temporary(t);
        await zipFixture(filePath, { [kind === 'path' ? '../001.jpg' : '001.jpg']: JPEG, '002.jpg': JPEG });
        let bytes = fs.readFileSync(filePath);
        const eocd = bytes.length - 22;
        const central = bytes.readUInt32LE(eocd + 16);
        if (kind === 'link') bytes.writeUInt32LE((0xa1ff0000 >>> 0), central + 38);
        if (kind === 'encrypted') bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
        if (kind === 'collision') {
            const secondCentral = central + 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
            Buffer.from('001.JPG').copy(bytes, secondCentral + 46);
        }
        fs.writeFileSync(filePath, bytes);
        await assert.rejects(writeComicCover(filePath, imagePath, { mode: 'replace' }), /Unsafe|Links|Encrypted|colliding/);
        assert.deepEqual(fs.readFileSync(filePath), bytes);
    }
});

test('페이지 재정렬이 비이미지 파일과 충돌하면 파일을 잃지 않고 거절한다', async t => {
    const { filePath, imagePath } = temporary(t);
    await zipFixture(filePath, { '001.jpg': JPEG, '0000.png/notes.txt': 'preserve' });
    const before = fs.readFileSync(filePath);
    await assert.rejects(writeComicCover(filePath, imagePath, { mode: 'add' }), /conflicts with a directory/);
    assert.deepEqual(fs.readFileSync(filePath), before);
});

test('7z와 CB7은 형식을 유지하며 삽입과 재정렬 후 본문 및 부속 파일을 보존한다', async t => {
    for (const extension of ['7z', 'cb7']) {
        const { directory, imagePath } = temporary(t);
        const content = path.join(directory, 'content');
        const filePath = path.join(directory, `native.${extension}`);
        fs.mkdirSync(path.join(content, 'chapter'), { recursive: true });
        fs.writeFileSync(path.join(content, 'chapter', '!cover.jpg'), JPEG);
        fs.writeFileSync(path.join(content, 'chapter', '002.png'), PNG);
        fs.writeFileSync(path.join(content, 'note.txt'), 'keep this');
        fs.writeFileSync(path.join(content, '.sidecar'), 'hidden metadata');
        pack(content, filePath);
        const inspected = await inspectComicCover(filePath, { sevenZExe });
        assert.equal(inspected.archiveType, '7z');
        assert.equal(inspected.pages.length, 2);
        const result = await writeComicCover(filePath, imagePath, { mode: 'add', renumber: true, sevenZExe });
        assert.equal(result.pageCount, 3);
        assert.equal((await inspectComicCover(filePath, { sevenZExe })).archiveType, '7z');
        assert.deepEqual(await readComicCoverImage(filePath, result.entryMap['chapter/!cover.jpg'], { sevenZExe }), JPEG);
        assert.deepEqual(await readComicCoverImage(filePath, '0000.png', { sevenZExe }), PNG);
        const note = spawnSync(sevenZExe, ['e', '-so', filePath, 'note.txt']);
        assert.equal(note.stdout.toString(), 'keep this');
    }
});

test('압축을 별도 CBZ로 변환할 때 원본 및 기존 대상 파일을 보존한다', async t => {
    const { directory } = temporary(t);
    const content = path.join(directory, 'content');
    fs.mkdirSync(content);
    fs.writeFileSync(path.join(content, '001.jpg'), JPEG);
    fs.writeFileSync(path.join(content, 'note.txt'), 'keep');
    const sourcePath = path.join(directory, 'source.cb7');
    const destination = path.join(directory, 'converted.cbz');
    pack(content, sourcePath);
    const before = fs.readFileSync(sourcePath);
    await convertComicToZip(sourcePath, destination, { sevenZExe });
    assert.deepEqual(fs.readFileSync(sourcePath), before);
    assert.deepEqual(readContents(destination)['001.jpg'], JPEG);
    assert.equal(readContents(destination)['note.txt'].toString(), 'keep');
    const converted = fs.readFileSync(destination);
    await assert.rejects(convertComicToZip(sourcePath, destination, { sevenZExe }), { code: 'EEXIST' });
    assert.deepEqual(fs.readFileSync(destination), converted);
});

test('네이티브 압축 검사와 이미지 읽기는 원본의 ctime 및 파일 식별자를 바꾸지 않는다', async t => {
    const { directory } = temporary(t);
    const content = path.join(directory, 'content');
    const filePath = path.join(directory, 'source.cb7');
    fs.mkdirSync(content);
    fs.writeFileSync(path.join(content, '001.jpg'), JPEG);
    pack(content, filePath);
    const before = fs.statSync(filePath, { bigint: true });
    await inspectComicCover(filePath, { sevenZExe });
    await readComicCoverImage(filePath, '001.jpg', { sevenZExe });
    const after = fs.statSync(filePath, { bigint: true });
    for (const key of ['ctimeNs', 'mtimeNs', 'ino', 'dev', 'nlink', 'size']) {
        assert.equal(after[key], before[key], `${key} must remain unchanged during preview`);
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

test('실제 RAR 컨테이너는 직접 덮어쓰지 않고 원본을 유지한 CBZ로 변환한다', async t => {
    const native7z = ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z'].find(command => {
        const result = spawnSync(command, ['i'], { encoding: 'utf8' });
        return !result.error && /\sRar\s/.test(result.stdout || '');
    });
    if (!native7z) return t.skip('A 7-Zip executable with RAR support is unavailable.');
    const { directory, imagePath } = temporary(t);
    const source = path.join(directory, 'source.cbr');
    const destination = path.join(directory, 'converted.cbz');
    const before = storedRar({ '001.jpg': JPEG, 'note.txt': Buffer.from('keep') });
    fs.writeFileSync(source, before);
    assert.equal((await inspectComicCover(source, { sevenZExe: native7z })).archiveType, 'rar');
    await assert.rejects(writeComicCover(source, imagePath, { sevenZExe: native7z }), /separate CBZ/);
    await convertComicToZip(source, destination, { sevenZExe: native7z });
    assert.deepEqual(fs.readFileSync(source), before);
    await writeComicCover(destination, imagePath, { mode: 'add' });
    assert.equal((await inspectComicCover(destination)).pages.length, 2);
    assert.equal(readContents(destination)['note.txt'].toString(), 'keep');
});
