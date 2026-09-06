import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { checkMissingVolumes } from './tasks/missingVolumesTask.js';

function createFixture(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-missing-volumes-'));
    const libraryDir = path.join(root, 'books');
    fs.mkdirSync(libraryDir);
    const libraryDb = new LibraryDB({ dbPath: path.join(root, 'library.db'), ...options });
    t.after(async () => {
        await libraryDb.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, libraryDir, libraryDb };
}

test('누락 검사는 파일 내용과 stat을 읽거나 메타데이터를 쓰지 않고 저장된 시리즈를 사용한다', async t => {
    const { libraryDir, libraryDb } = createFixture(t);
    const firstPath = path.join(libraryDir, 'Different First Title 1.TXT');
    const thirdPath = path.join(libraryDir, 'Another Title 3.cbz');
    fs.writeFileSync(firstPath, 'text book contents');
    fs.writeFileSync(thirdPath, 'archive contents');
    await libraryDb.upsertFileInfo({ path: firstPath, series: 'Saved Series' });
    await libraryDb.upsertFileInfo({ path: thirdPath, series: 'Saved Series' });
    const getMetadata = libraryDb.getMissingVolumeMetadata.bind(libraryDb);
    let metadataReads = 0;
    t.mock.method(libraryDb, 'getMissingVolumeMetadata', async roots => {
        metadataReads += 1;
        return getMetadata(roots);
    });
    const forbidden = () => { throw new Error('Unexpected detailed file I/O'); };
    for (const method of ['stat', 'lstat', 'readFile', 'open']) t.mock.method(fsp, method, forbidden);
    for (const method of ['statSync', 'lstatSync', 'readFileSync']) t.mock.method(fs, method, forbidden);
    t.mock.method(libraryDb, 'upsertFileInfo', forbidden);

    let result;
    try {
        result = await checkMissingVolumes([libraryDir], { libraryDb });
    } finally {
        t.mock.restoreAll();
    }

    assert.equal(metadataReads, 1);
    assert.deepEqual(result, {
        missing: [{ series: 'Saved Series', missing: ['2'], folder_path: libraryDir }],
        fileCount: 2,
        cancelled: false,
        indexOnly: false,
    });
});

test('인덱스를 갱신하지 않아도 외부에서 추가하거나 삭제한 파일을 누락 검사에 반영한다', async t => {
    const { libraryDir, libraryDb } = createFixture(t);
    const firstPath = path.join(libraryDir, 'Series 1.cbz');
    const thirdPath = path.join(libraryDir, 'Series 3.cbz');
    fs.writeFileSync(firstPath, 'first');
    fs.writeFileSync(thirdPath, 'third');
    await libraryDb.upsertFileInfo({ path: firstPath, series: 'Series' });
    await libraryDb.upsertFileInfo({ path: thirdPath, series: 'Series' });
    const before = await checkMissingVolumes([libraryDir], { libraryDb });
    assert.deepEqual(before.missing[0].missing, ['2']);

    fs.unlinkSync(firstPath);
    fs.writeFileSync(path.join(libraryDir, 'Series 2.cbz'), 'new second');
    const after = await checkMissingVolumes([libraryDir], { libraryDb });

    assert.deepEqual(after, { missing: [], fileCount: 2, cancelled: false, indexOnly: false });
    assert.ok(await libraryDb.getFileInfo(firstPath));
    assert.equal(await libraryDb.getFileInfo(path.join(libraryDir, 'Series 2.cbz')), null);
});

test('중복·중첩 라이브러리는 한 번씩 탐색하고 기존 확장자와 숨김 폴더 제외 규칙을 따른다', async t => {
    const { libraryDir } = createFixture(t);
    const nested = path.join(libraryDir, 'nested');
    const hidden = path.join(libraryDir, '.hidden');
    fs.mkdirSync(nested);
    fs.mkdirSync(hidden);
    fs.writeFileSync(path.join(nested, 'Series 1.cbz'), 'one');
    fs.writeFileSync(path.join(nested, 'Series 3.TXT'), 'three');
    fs.writeFileSync(path.join(nested, 'Series 2.jpg'), 'image');
    fs.writeFileSync(path.join(hidden, 'Series 2.cbz'), 'hidden');
    const readDirectory = fsp.readdir.bind(fsp);
    const directories = [];
    t.mock.method(fsp, 'readdir', async (directory, options) => {
        directories.push(directory);
        return readDirectory(directory, options);
    });

    const result = await checkMissingVolumes([nested, libraryDir, libraryDir, nested]);

    assert.deepEqual(directories, [libraryDir, nested]);
    assert.equal(result.fileCount, 2);
    assert.deepEqual(result.missing, [{ series: 'Series', missing: ['2'], folder_path: nested }]);
});

test('경로의 Unicode 정규화가 달라도 저장된 시리즈를 연결한다', async t => {
    const { libraryDir, libraryDb } = createFixture(t, { platform: 'darwin' });
    const firstPath = path.join(libraryDir, '다른 제목 1.cbz').normalize('NFC');
    const thirdPath = path.join(libraryDir, '또 다른 제목 3.cbz').normalize('NFC');
    fs.writeFileSync(firstPath, 'one');
    fs.writeFileSync(thirdPath, 'three');
    await libraryDb.upsertFileInfo({ path: firstPath.normalize('NFD'), series: '같은 시리즈' });
    await libraryDb.upsertFileInfo({ path: thirdPath.normalize('NFD'), series: '같은 시리즈' });

    const result = await checkMissingVolumes([libraryDir], { libraryDb });

    assert.equal(result.fileCount, 2);
    assert.deepEqual(result.missing[0].missing, ['2']);
    assert.equal(result.missing[0].series, '같은 시리즈');
});

test('누락검사용 DB 조회는 와일드카드 문자를 포함한 라이브러리 범위를 정확히 제한한다', async t => {
    const { root, libraryDb } = createFixture(t);
    const requested = path.join(root, 'book_%');
    const other = path.join(root, 'book_others');
    const requestedFile = path.join(requested, 'Series 1.cbz');
    await libraryDb.upsertFileInfo({ path: requestedFile, series: 'Requested', summary: 'Unused large metadata' });
    await libraryDb.upsertFileInfo({ path: path.join(other, 'Series 3.cbz'), series: 'Other' });

    const rows = await libraryDb.getMissingVolumeMetadata([requested]);

    assert.deepEqual(rows, [{ path: libraryDb.normalizeFilePath(requestedFile), series: 'Requested' }]);
});

test('누락 검사 취소는 디렉터리를 읽은 직후에도 처리한다', async t => {
    const { libraryDir } = createFixture(t);
    fs.writeFileSync(path.join(libraryDir, 'Series 1.txt'), 'one');
    let cancelled = false;
    const readDirectory = fsp.readdir.bind(fsp);
    t.mock.method(fsp, 'readdir', async (...args) => {
        const entries = await readDirectory(...args);
        cancelled = true;
        return entries;
    });

    await assert.rejects(checkMissingVolumes([libraryDir], { shouldCancel: () => cancelled }), {
        code: 'TASK_CANCELLED',
    });
});

test('취소된 요청은 DB 조회나 파일 탐색을 시작하지 않는다', async () => {
    let queried = false;
    await assert.rejects(checkMissingVolumes(['/unused'], {
        libraryDb: { getMissingVolumeMetadata: () => { queried = true; return []; } },
        shouldCancel: () => true,
    }), { code: 'TASK_CANCELLED' });
    assert.equal(queried, false);
});

test('읽을 수 없는 라이브러리를 누락이 없는 정상 결과로 처리하지 않는다', async t => {
    const { libraryDir } = createFixture(t);
    const error = Object.assign(new Error(`Cannot read directory: ${libraryDir}`), { code: 'EACCES' });
    t.mock.method(fsp, 'readdir', async () => { throw error; });

    await assert.rejects(checkMissingVolumes([libraryDir]), error);
});

test('인덱스 전용 검사는 디스크를 탐색하지 않고 파일 인덱스와 저장된 시리즈를 함께 사용한다', async t => {
    const { root, libraryDir, libraryDb } = createFixture(t);
    const firstPath = path.join(libraryDir, 'Different Title 1.cbz');
    const thirdPath = path.join(libraryDir, 'Saved Series 3.txt');
    await libraryDb.upsertFileInfo({ path: firstPath, series: 'Saved Series' });
    await libraryDb.saveTargetIndex([
        { full_path: firstPath, target_folder: libraryDir },
        { full_path: thirdPath, target_folder: libraryDir },
        { full_path: path.join(libraryDir, '.hidden', 'Saved Series 2.cbz'), target_folder: libraryDir },
        { full_path: path.join(libraryDir, 'Saved Series 2.jpg'), target_folder: libraryDir },
        { full_path: path.join(root, 'outside', 'Saved Series 2.cbz'), target_folder: libraryDir },
    ]);
    const forbidden = () => { throw new Error('Unexpected filesystem access during indexed check'); };
    for (const method of ['readdir', 'stat', 'lstat', 'readFile', 'open']) t.mock.method(fsp, method, forbidden);
    for (const method of ['readdirSync', 'statSync', 'lstatSync', 'readFileSync']) t.mock.method(fs, method, forbidden);

    let result;
    try {
        result = await checkMissingVolumes([libraryDir], { libraryDb, indexOnly: true });
    } finally {
        t.mock.restoreAll();
    }

    assert.deepEqual(result, {
        missing: [{ series: 'Saved Series', missing: ['2'], folder_path: libraryDir }],
        fileCount: 2,
        cancelled: false,
        indexOnly: true,
    });
});

test('인덱스와 메타데이터의 경로 정규화가 달라도 같은 파일을 중복 계산하지 않는다', async t => {
    const { libraryDir, libraryDb } = createFixture(t, { platform: 'darwin' });
    const unicodeRoot = path.join(libraryDir, '책장').normalize('NFC');
    const firstPath = path.join(unicodeRoot, '서로 다른 제목 1.cbz');
    await libraryDb.upsertFileInfo({ path: firstPath.normalize('NFD'), series: 'Saved Series' });
    await libraryDb.saveTargetIndex([
        { full_path: firstPath.normalize('NFC'), target_folder: unicodeRoot },
        { full_path: path.join(unicodeRoot, 'Saved Series 3.cbz'), target_folder: unicodeRoot },
    ]);

    const result = await checkMissingVolumes([unicodeRoot, unicodeRoot.normalize('NFD')], { libraryDb, indexOnly: true });

    assert.equal(result.fileCount, 2);
    assert.deepEqual(result.missing[0].missing, ['2']);
    assert.equal(result.missing[0].series, 'Saved Series');
});

test('빈 인덱스는 파일 탐색 없이 빈 검사 결과를 반환한다', async t => {
    const forbidden = () => { throw new Error('Unexpected directory traversal'); };
    t.mock.method(fsp, 'readdir', forbidden);

    const result = await checkMissingVolumes(['/not-mounted'], {
        indexOnly: true,
        libraryDb: { getMissingVolumeMetadata: async () => [] },
    });

    assert.deepEqual(result, { missing: [], fileCount: 0, cancelled: false, indexOnly: true });
});
