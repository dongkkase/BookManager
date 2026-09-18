import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { findBinaryPath } from './binaryPolicy.js';
import { encodeTextCover } from './textCoverEncoder.js';
import { applyTxtSeriesCover, shouldAutoUseTxtSearchCover } from '../src/txtMetadataPolicy.js';
import {
    analyzeMetadataInputs,
    loadMetadataCover,
    loadLatestSeriesMetadata,
    metadataWriteSupport,
    saveMetadataItems,
} from './tasks/metadataTask.js';

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-text-task-'));
    const dbPath = path.join(root, 'BookManagerData', 'library.db');
    const source = path.join(root, '원래 제목 01.txt');
    const cover = path.join(root, 'cover.png');
    fs.writeFileSync(source, '원본 텍스트 본문\r\n둘째 줄');
    fs.writeFileSync(cover, PNG);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, dbPath, source, cover };
}

test('filename-only legacy TXT database rows remain eligible for automatic search covers', async t => {
    const { dbPath, source } = fixture(t);
    const db = new LibraryDB({ dbPath });
    try {
        const stat = fs.statSync(source);
        await db.upsertFileInfo({
            path: source,
            ext: '.txt',
            title: path.basename(source, '.txt'),
            series: '원래 제목',
            volume: '1',
            mtime: stat.mtimeMs / 1000,
            size: stat.size,
            has_metadata: '',
            metadata_override: '',
        });
        const analyzed = (await analyzeMetadataInputs([source], { libraryDb: db })).items[0];
        assert.equal(analyzed.hasTextMetadata, true);
        assert.equal(shouldAutoUseTxtSearchCover(analyzed), true);
        assert.equal(shouldAutoUseTxtSearchCover({
            ...analyzed,
            metadata: { ...analyzed.metadata, Writer: '검색한 작가' },
        }), true);
    } finally {
        await db.close();
    }
});

test('TXT metadata saves complete editable fields in the DB without changing the source', async t => {
    const { dbPath, source, cover } = fixture(t);
    const before = fs.readFileSync(source);
    const beforeStat = fs.statSync(source);
    const initial = (await analyzeMetadataInputs([source], { dbPath })).items[0];
    assert.equal(metadataWriteSupport(source).supported, true);
    assert.equal(initial.metadataStorage, 'database');
    assert.equal(initial.hasTextMetadata, false);
    assert.match(initial.textContentHash, /^[a-f0-9]{64}$/);

    const metadata = {
        Title: 'DB에 입력한 제목',
        Writer: '저자',
        Series: '',
        Volume: '',
        Publisher: '출판사',
        Year: '2026',
        Month: '9',
        Day: '6',
        ISBN: '9780000000000',
        Genre: '소설',
        Tags: 'TXT, 보관',
        Summary: '첫째 줄\n둘째 줄',
        LanguageISO: '',
        CommunityRating: '0',
    };
    const saved = await saveMetadataItems([{
        ...initial,
        metadata,
        txtCoverChange: { type: 'file', filePath: cover },
    }], { dbPath });
    assert.deepEqual(saved.stats.error, []);
    assert.deepEqual(saved.stats.successPaths, [source]);
    assert.equal(saved.textMetadataUpdates.length, 1);
    assert.equal(path.basename(path.dirname(saved.textMetadataUpdates[0].textCoverPath)), 'text-thumbnails');
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal(fs.statSync(source).mtimeMs, beforeStat.mtimeMs);

    const reopened = (await analyzeMetadataInputs([source], {
        dbPath,
        includeCachedMetadata: false,
    })).items[0];
    assert.equal(reopened.hasTextMetadata, true);
    for (const [key, value] of Object.entries(metadata)) assert.equal(reopened.metadata[key], value, key);
    assert.equal(reopened.coverDataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.equal(await loadMetadataCover(source, { dbPath }), reopened.coverDataUrl);
});

test('TXT volume and chapter numbers remain independent through DB saves and reloads', async t => {
    const { dbPath, source } = fixture(t);
    const before = fs.readFileSync(source);
    const beforeStat = fs.statSync(source);
    let item = (await analyzeMetadataInputs([source], { dbPath })).items[0];
    const db = new LibraryDB({ dbPath });
    try {
        for (const number of ['1064', '551', '12.5', '1-551', '0', '']) {
            const saved = await saveMetadataItems([{
                ...item,
                metadata: { ...item.metadata, Series: '같은 시리즈', Volume: '2', Number: number },
            }], { dbPath });
            assert.deepEqual(saved.stats.error, []);
            assert.deepEqual(saved.stats.successPaths, [source]);

            item = (await analyzeMetadataInputs([source], {
                dbPath,
                includeCachedMetadata: false,
            })).items[0];
            assert.equal(item.metadata.Volume, '2');
            assert.equal(item.metadata.Number, number);
            const record = await db.getFileInfo(source);
            assert.equal(record.volume, '2');
            assert.equal(record.number, number);
            assert.deepEqual(fs.readFileSync(source), before);
            assert.equal(fs.statSync(source).mtimeMs, beforeStat.mtimeMs);
        }
    } finally {
        await db.close();
    }
});

test('TXT filename defaults remain eligible before and after saving completion labels and volume ranges', async t => {
    const { root, dbPath } = fixture(t);
    for (const name of ['[완결] 소설 1.txt', '소설 1.5권.txt', '소설 1~5권.txt']) {
        const source = path.join(root, name);
        fs.writeFileSync(source, `본문 ${name}`);
        const initial = (await analyzeMetadataInputs([source], { dbPath })).items[0];
        assert.equal(shouldAutoUseTxtSearchCover(initial), true, name);
        const saved = await saveMetadataItems([initial], { dbPath });
        assert.deepEqual(saved.stats.error, []);
        const reopened = (await analyzeMetadataInputs([source], { dbPath })).items[0];
        assert.equal(reopened.hasTextMetadata, true);
        assert.equal(shouldAutoUseTxtSearchCover(reopened), true, name);
        assert.equal(shouldAutoUseTxtSearchCover({
            ...reopened,
            originalMetadata: { ...reopened.originalMetadata, Writer: '저장된 작가' },
        }), false, name);
    }
});

test('TXT metadata and cover reconnect after rename and index deletion, and remain searchable', async t => {
    const { root, dbPath, source, cover } = fixture(t);
    const saved = await saveMetadataItems([{
        filepath: source,
        metadata: { Title: '별의 여행', Writer: 'DB저자', Volume: '2' },
        txtCoverChange: { type: 'file', filePath: cover },
    }], { dbPath });
    assert.deepEqual(saved.stats.error, []);
    const moved = path.join(root, '새 폴더', '새 파일명.txt');
    fs.mkdirSync(path.dirname(moved));
    fs.renameSync(source, moved);
    const db = new LibraryDB({ dbPath });
    try {
        db.getConnection().exec('DELETE FROM files');
        const item = (await analyzeMetadataInputs([moved], { libraryDb: db })).items[0];
        assert.equal(item.metadata.Title, '별의 여행');
        assert.equal(item.metadata.Writer, 'DB저자');
        assert.equal(item.textCoverPath, saved.textMetadataUpdates[0].textCoverPath);
        const record = await db.getFileInfo(moved);
        assert.equal(record.writer, 'DB저자');
        const found = await db.searchFiles('DB저자', [root]);
        assert.equal(found.some(row => row.path === db.normalizeFilePath(moved)), true);
        const latest = await loadLatestSeriesMetadata({ title: '별의 여행', bookType: 'book' }, { libraryDb: db });
        assert.equal(latest.metadata.Title, '별의 여행');
        assert.equal(latest.metadata.Writer, 'DB저자');
    } finally {
        await db.close();
    }
});

test('TXT cover removal persists and an invalid replacement leaves saved data intact', async t => {
    const { root, dbPath, source, cover } = fixture(t);
    await saveMetadataItems([{
        filepath: source,
        metadata: { Title: '저장된 제목' },
        txtCoverChange: { type: 'file', filePath: cover },
    }], { dbPath });
    const badCover = path.join(root, 'invalid.png');
    fs.writeFileSync(badCover, 'not an image');
    const failed = await saveMetadataItems([{
        filepath: source,
        metadata: { Title: '실패한 제목' },
        txtCoverChange: { type: 'file', filePath: badCover },
    }], { dbPath });
    assert.equal(failed.stats.error.length, 1);
    assert.equal(failed.textMetadataUpdates.length, 0);
    const unchanged = (await analyzeMetadataInputs([source], { dbPath })).items[0];
    assert.equal(unchanged.metadata.Title, '저장된 제목');
    assert.ok(unchanged.coverDataUrl);

    const reset = await saveMetadataItems([{
        ...unchanged,
        txtCoverChange: { type: 'reset' },
    }], { dbPath });
    assert.deepEqual(reset.stats.error, []);
    assert.equal(reset.textMetadataUpdates[0].textCoverPath, '');
    assert.equal(await loadMetadataCover(source, { dbPath }), '');
});

test('series cover application copies a stored TXT cover while retaining each volume content identity', async t => {
    const { root, dbPath, source, cover } = fixture(t);
    const second = path.join(root, '원래 제목 02.txt');
    fs.writeFileSync(second, '둘째 권의 서로 다른 본문\r\n다음 줄');
    const originalContents = new Map([source, second].map(filePath => [filePath, fs.readFileSync(filePath)]));
    const initialSave = await saveMetadataItems([
        {
            filepath: source,
            metadata: { Title: '첫째 권 제목', Series: '같은 시리즈', Volume: '1', Writer: '저자' },
            txtCoverChange: { type: 'file', filePath: cover },
        },
        {
            filepath: second,
            metadata: { Title: '둘째 권 제목', Series: '같은 시리즈', Volume: '2', Writer: '저자' },
        },
    ], { dbPath });
    assert.deepEqual(initialSave.stats.error, []);
    const before = (await analyzeMetadataInputs([source, second], { dbPath })).items;
    const sourceItem = before.find(item => item.filepath === source);
    const targetItem = before.find(item => item.filepath === second);
    assert.equal(sourceItem.txtCoverChange, undefined);
    assert.ok(sourceItem.textCoverPath);
    assert.equal(targetItem.textCoverPath, '');
    assert.equal(sourceItem.group, targetItem.group);
    assert.notEqual(sourceItem.textContentHash, targetItem.textContentHash);
    fs.unlinkSync(cover);

    const applied = applyTxtSeriesCover(before, sourceItem);
    const updatedTarget = applied.find(item => item.filepath === second);
    assert.equal(applied.find(item => item.filepath === source), sourceItem);
    assert.equal(updatedTarget.txtCoverChange.type, 'file');
    assert.equal(updatedTarget.txtCoverChange.filePath, sourceItem.textCoverPath);
    assert.equal(updatedTarget.coverDataUrl, sourceItem.coverDataUrl);
    assert.equal(updatedTarget.textContentHash, targetItem.textContentHash);
    assert.equal(updatedTarget.textCoverPath, targetItem.textCoverPath);
    assert.deepEqual(updatedTarget.originalMetadata, targetItem.originalMetadata);

    const saved = await saveMetadataItems(applied, { dbPath });
    assert.deepEqual(saved.stats.error, []);
    assert.deepEqual(saved.stats.successPaths.sort(), [source, second].sort());
    const reopened = (await analyzeMetadataInputs([source, second], {
        dbPath,
        includeCachedMetadata: false,
    })).items;
    const reopenedSource = reopened.find(item => item.filepath === source);
    const reopenedTarget = reopened.find(item => item.filepath === second);
    assert.equal(reopenedSource.textCoverPath, sourceItem.textCoverPath);
    assert.notEqual(reopenedTarget.textCoverPath, reopenedSource.textCoverPath);
    for (const item of reopened) {
        const previous = before.find(candidate => candidate.filepath === item.filepath);
        assert.equal(item.textContentHash, previous.textContentHash);
        assert.deepEqual(item.metadata, previous.metadata);
        assert.equal(item.coverDataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
        assert.deepEqual(fs.readFileSync(item.textCoverPath), PNG);
        assert.deepEqual(fs.readFileSync(item.filepath), originalContents.get(item.filepath));
    }
});

test('TXT save rejects a source changed after analysis while other batch items still save', async t => {
    const { root, dbPath, source } = fixture(t);
    const initial = (await analyzeMetadataInputs([source], { dbPath })).items[0];
    const second = path.join(root, 'second.txt');
    fs.writeFileSync(second, '별개의 본문');
    fs.writeFileSync(source, '외부에서 교체한 본문');
    const result = await saveMetadataItems([
        { ...initial, metadata: { Title: '잘못 연결되면 안 됨' } },
        { filepath: second, metadata: { Title: '정상 저장' } },
    ], { dbPath });
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.stats.successPaths, [second]);
    assert.deepEqual(result.textMetadataUpdates.map(item => item.filepath), [second]);
    const analyzed = await analyzeMetadataInputs([source, second], { dbPath });
    assert.notEqual(analyzed.items.find(item => item.filepath === source).metadata.Title, '잘못 연결되면 안 됨');
    assert.equal(analyzed.items.find(item => item.filepath === second).metadata.Title, '정상 저장');
});

test('TXT metadata saves and reloads a WebP cover and reuses its bytes across series volumes', async t => {
    const cwebpExe = findBinaryPath('cwebp');
    if (!cwebpExe) return t.skip('cwebp executable is not available');
    const { root, dbPath, source, cover } = fixture(t);
    const originalText = fs.readFileSync(source);
    const originalImage = fs.readFileSync(new URL('../src/images/app-1024.png', import.meta.url));
    fs.writeFileSync(cover, originalImage);
    const options = { dbPath, textCoverEncoder: buffer => encodeTextCover(buffer, { cwebpExe }) };
    const saved = await saveMetadataItems([{
        filepath: source,
        metadata: { Title: 'WebP 표지' },
        txtCoverChange: { type: 'file', filePath: cover },
    }], options);
    assert.deepEqual(saved.stats.error, []);
    const coverPath = saved.textMetadataUpdates[0].textCoverPath;
    assert.equal(path.extname(coverPath), '.webp');
    const encoded = fs.readFileSync(coverPath);
    const dataUrl = `data:image/webp;base64,${encoded.toString('base64')}`;
    assert.equal(await loadMetadataCover(source, { dbPath }), dataUrl);
    const reopened = (await analyzeMetadataInputs([source], { dbPath })).items[0];
    assert.equal(reopened.coverDataUrl, dataUrl);
    assert.deepEqual(fs.readFileSync(source), originalText);
    assert.deepEqual(fs.readFileSync(cover), originalImage);

    const second = path.join(root, 'second.txt');
    fs.writeFileSync(second, '둘째 권 본문');
    const reused = await saveMetadataItems([{
        filepath: second,
        metadata: { Title: '둘째 권' },
        txtCoverChange: { type: 'file', filePath: coverPath },
    }], options);
    assert.deepEqual(reused.stats.error, []);
    assert.deepEqual(fs.readFileSync(reused.textMetadataUpdates[0].textCoverPath), encoded);
});

test('TXT WebP conversion failures preserve saved metadata and cover files', async t => {
    const { dbPath, source, cover } = fixture(t);
    const saved = await saveMetadataItems([{
        filepath: source,
        metadata: { Title: '저장된 제목' },
        txtCoverChange: { type: 'file', filePath: cover },
    }], { dbPath });
    const coverPath = saved.textMetadataUpdates[0].textCoverPath;
    for (const textCoverEncoder of [
        buffer => encodeTextCover(buffer),
        async () => PNG,
        async () => { throw new Error('conversion failed'); },
    ]) {
        const failed = await saveMetadataItems([{
            filepath: source,
            metadata: { Title: '실패한 제목' },
            txtCoverChange: { type: 'file', filePath: cover },
        }], { dbPath, textCoverEncoder });
        assert.equal(failed.stats.error.length, 1);
        assert.deepEqual(failed.stats.successPaths, []);
        assert.deepEqual(failed.textMetadataUpdates, []);
        const reopened = (await analyzeMetadataInputs([source], { dbPath })).items[0];
        assert.equal(reopened.metadata.Title, '저장된 제목');
        assert.equal(reopened.textCoverPath, coverPath);
        assert.deepEqual(fs.readFileSync(coverPath), PNG);
        assert.deepEqual(fs.readdirSync(path.dirname(coverPath)), [path.basename(coverPath)]);
    }
});
