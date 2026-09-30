import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { executeLibraryMoveAsync } from './fsOperations.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-move-progress-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (name, content = 'book') => {
        const filePath = path.join(root, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return filePath;
    };
    return { root, write };
}

function crossDevice(t, sourceRoot) {
    const rename = fs.promises.rename;
    t.mock.method(fs.promises, 'rename', async (source, destination) => {
        if (source.startsWith(sourceRoot)) throw Object.assign(new Error('Cross-device move'), { code: 'EXDEV' });
        return rename(source, destination);
    });
}

test('파일별 이동 시작·완료와 건너뛴 파일을 진행률에 반영한다', async t => {
    const f = fixture(t);
    const source = f.write('source/book.cbz');
    const skipped = f.write('source/skip.cbz');
    const destination = path.join(f.root, 'library/book.cbz');
    const existing = f.write('library/skip.cbz', 'existing');
    const updates = [];
    const result = await executeLibraryMoveAsync([
        { src: source, dest: destination }, { src: skipped, dest: existing, conflictAction: 'skip' },
    ], { onProgress: data => updates.push(data) });
    assert.equal(result.successCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.deepEqual(updates.map(data => data.progress), [0, 50, 50, 100]);
    assert.equal(updates[2].currentFile, skipped);
    assert.equal(updates.at(-1).processedCount, 2);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing');
});

test('다른 볼륨의 큰 파일은 복사 중에도 바이트 진행률을 전송한다', async t => {
    const f = fixture(t);
    const source = f.write('source/book.cbz', Buffer.alloc(1024 * 1024, 7));
    const destination = path.join(f.root, 'library/book.cbz');
    crossDevice(t, path.dirname(source));
    let now = 0;
    t.mock.method(Date, 'now', () => now += 101);
    const updates = [];
    const result = await executeLibraryMoveAsync([{ src: source, dest: destination }], { onProgress: data => updates.push(data) });
    assert.equal(result.successCount, 1);
    assert.ok(updates.some(data => data.copiedBytes > 0 && data.copiedBytes < data.totalBytes && data.progress > 0 && data.progress < 100));
    assert.equal(updates.at(-1).progress, 100);
    assert.ok(updates.every((data, index) => index === 0 || data.progress >= updates[index - 1].progress));
    assert.deepEqual(fs.readFileSync(destination), Buffer.alloc(1024 * 1024, 7));
    assert.equal(fs.existsSync(source), false);
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['book.cbz']);
});

test('폴더의 다른 볼륨 이동도 하위 파일 진행률과 빈 디렉터리를 보존한다', async t => {
    const f = fixture(t);
    const first = f.write('source/series/first.cbz', 'first');
    f.write('source/series/nested/last.epub', 'last');
    fs.mkdirSync(path.join(f.root, 'source/series/empty'));
    const source = path.dirname(first);
    const destination = path.join(f.root, 'library/series');
    crossDevice(t, source);
    const updates = [];
    const result = await executeLibraryMoveAsync([{ src: source, dest: destination }], { onProgress: data => updates.push(data) });
    assert.equal(result.successCount, 1);
    assert.ok(updates.some(data => data.currentFile.endsWith('nested/last.epub')));
    assert.equal(fs.readFileSync(path.join(destination, 'nested/last.epub'), 'utf8'), 'last');
    assert.equal(fs.statSync(path.join(destination, 'empty')).isDirectory(), true);
    assert.equal(fs.existsSync(source), false);
});

test('복사 실패는 원본을 유지하고 불완전한 파일을 정리한다', async t => {
    const f = fixture(t);
    const source = f.write('source/book.cbz', 'original');
    const destination = path.join(f.root, 'library/book.cbz');
    crossDevice(t, path.dirname(source));
    t.mock.method(fs, 'createReadStream', () => Readable.from((async function* () {
        yield Buffer.from('partial');
        throw new Error('disk read failed');
    })()));
    const result = await executeLibraryMoveAsync([{ src: source, dest: destination }], { onProgress() {} });
    assert.equal(result.successCount, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(fs.readFileSync(source, 'utf8'), 'original');
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readdirSync(path.dirname(destination)), []);
});
