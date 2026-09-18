import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    decodeTextCleanerBuffer,
    loadTextCleanerFile,
    saveTextCleanerFile,
    textCleanerBackupPath,
} from './textCleanerFile.js';

async function temporaryDirectory(t) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-text-cleaner-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    return directory;
}

test('텍본 파일은 BOM과 레거시 한글 인코딩을 판별한다', () => {
    assert.deepEqual(
        decodeTextCleanerBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('한글')])),
        { text: '한글', encoding: 'utf-8-bom' },
    );
    assert.deepEqual(
        decodeTextCleanerBuffer(Buffer.from('fffe5cd500ae', 'hex')),
        { text: '한글', encoding: 'utf-16le' },
    );
    assert.deepEqual(
        decodeTextCleanerBuffer(Buffer.from('c7d1b1db', 'hex')),
        { text: '한글', encoding: 'euc-kr' },
    );
});

test('BOM 없는 유효한 UTF-8은 레거시 한글 인코딩보다 우선한다', () => {
    const decoded = decodeTextCleanerBuffer(Buffer.from('서(序). 성공했다고 생각했다. 하지만……'));

    assert.equal(decoded.encoding, 'utf-8');
    assert.equal(decoded.text, '서(序). 성공했다고 생각했다. 하지만……');
});

test('인코딩 표본 뒤에 CP949 문자가 나오면 다음 후보로 전체 파일을 다시 해석한다', () => {
    const asciiPrefix = Buffer.alloc(512 * 1024, 0x61);
    const buffer = Buffer.concat([asciiPrefix, Buffer.from('c7d1b1db', 'hex')]);
    const decoded = decodeTextCleanerBuffer(buffer);

    assert.equal(decoded.encoding, 'euc-kr');
    assert.equal(decoded.text.slice(-2), '한글');
});

test('큰 텍본은 워커 스레드에서 읽고 개행을 정규화한다', async t => {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'large.txt');
    await fs.promises.writeFile(filePath, '첫 줄\r\n둘째 줄\r셋째 줄');

    const loaded = await loadTextCleanerFile(filePath, { workerThresholdBytes: 0 });

    assert.equal(loaded.text, '첫 줄\n둘째 줄\n셋째 줄');
    assert.equal(loaded.encoding, 'utf-8');
    assert.equal(loaded.snapshot.size, Buffer.byteLength('첫 줄\r\n둘째 줄\r셋째 줄'));
    assert.equal(loaded.snapshot.sha256.length, 64);
});

test('텍본 저장은 원본 바이트를 bak 파일로 보존하고 결과를 UTF-8 BOM으로 쓴다', async t => {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'novel.txt');
    const original = Buffer.from('c7d1b1db20bff8babf', 'hex');
    await fs.promises.writeFile(filePath, original);
    const loaded = await loadTextCleanerFile(filePath);

    const saved = await saveTextCleanerFile({
        filePath,
        snapshot: loaded.snapshot,
        text: '한글 원본 정리',
    });

    assert.equal(saved.backupPath, textCleanerBackupPath(filePath));
    assert.deepEqual(await fs.promises.readFile(saved.backupPath), original);
    assert.deepEqual(
        await fs.promises.readFile(filePath),
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('한글 원본 정리')]),
    );
});

test('기존 bak 파일은 날짜가 붙은 이름으로 순환 보관한다', async t => {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'novel.txt');
    const backupPath = textCleanerBackupPath(filePath);
    await fs.promises.writeFile(filePath, 'first');
    await fs.promises.writeFile(backupPath, 'older');
    const loaded = await loadTextCleanerFile(filePath);

    const saved = await saveTextCleanerFile({
        filePath,
        snapshot: loaded.snapshot,
        text: 'second',
        backup: true,
    }, { now: new Date(2026, 8, 17, 12, 34, 56) });

    assert.match(saved.rotatedBackupPath, /novel\.bak\.20260917-123456\.txt$/);
    assert.equal(await fs.promises.readFile(saved.rotatedBackupPath, 'utf8'), 'older');
    assert.equal(await fs.promises.readFile(backupPath, 'utf8'), 'first');
});

for (const existingBackup of [false, true]) {
    test(`백업을 끄고 저장하면 새 백업을 만들지 않고 기존 백업을 유지한다 (기존 백업: ${existingBackup})`, async t => {
        const directory = await temporaryDirectory(t);
        const filePath = path.join(directory, 'novel.txt');
        const backupPath = textCleanerBackupPath(filePath);
        await fs.promises.writeFile(filePath, 'original');
        if (existingBackup) await fs.promises.writeFile(backupPath, 'older');
        const loaded = await loadTextCleanerFile(filePath);

        const saved = await saveTextCleanerFile({
            filePath,
            snapshot: loaded.snapshot,
            text: '정리 결과',
            backup: false,
        });

        assert.equal(saved.backupPath, null);
        assert.equal(saved.rotatedBackupPath, null);
        assert.deepEqual(
            await fs.promises.readFile(filePath),
            Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('정리 결과')]),
        );
        assert.deepEqual(saved.snapshot, (await loadTextCleanerFile(filePath)).snapshot);
        if (existingBackup) assert.equal(await fs.promises.readFile(backupPath, 'utf8'), 'older');
        assert.deepEqual((await fs.promises.readdir(directory)).sort(), existingBackup
            ? ['novel.bak.txt', 'novel.txt'] : ['novel.txt']);
    });
}

for (const backup of [true, false]) {
    test(`결과 교체에 실패하면 원본과 기존 백업을 유지하고 임시 파일을 제거한다 (백업: ${backup})`, async t => {
        const directory = await temporaryDirectory(t);
        const filePath = path.join(directory, 'novel.txt');
        const backupPath = textCleanerBackupPath(filePath);
        await fs.promises.writeFile(filePath, 'original');
        await fs.promises.writeFile(backupPath, 'older');
        const loaded = await loadTextCleanerFile(filePath);
        const rename = fs.promises.rename;
        const failure = Object.assign(new Error('Could not replace the file'), { code: 'EACCES' });
        t.mock.method(fs.promises, 'rename', async (source, target) => {
            if (source.endsWith('.tmp') && target === filePath) throw failure;
            return rename(source, target);
        });

        await assert.rejects(
            saveTextCleanerFile({ filePath, snapshot: loaded.snapshot, text: 'result', backup }),
            error => error === failure,
        );

        assert.equal(await fs.promises.readFile(filePath, 'utf8'), 'original');
        assert.equal(await fs.promises.readFile(backupPath, 'utf8'), 'older');
        assert.deepEqual((await fs.promises.readdir(directory)).sort(), ['novel.bak.txt', 'novel.txt']);
    });
}

test('원본이 외부에서 바뀌면 백업 옵션과 관계없이 저장하지 않는다', async t => {
    const directory = await temporaryDirectory(t);
    const filePath = path.join(directory, 'novel.txt');
    await fs.promises.writeFile(filePath, 'first');
    const loaded = await loadTextCleanerFile(filePath);
    await fs.promises.writeFile(filePath, 'changed');

    for (const backup of [true, false]) {
        await assert.rejects(
            saveTextCleanerFile({ filePath, snapshot: loaded.snapshot, text: 'result', backup }),
            error => error?.code === 'SOURCE_CHANGED',
        );
    }
    assert.equal(await fs.promises.readFile(filePath, 'utf8'), 'changed');
    assert.equal(await fs.promises.access(textCleanerBackupPath(filePath)).then(() => true, () => false), false);
});
