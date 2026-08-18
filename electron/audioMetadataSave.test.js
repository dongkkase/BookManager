import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tagLib from 'node-taglib-sharp';
import { readAudioMetadata } from './audioMetadata.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

const {
    ByteVector,
    File: TagLibFile,
    StringType,
} = tagLib;

const M4B_FIXTURE_BASE64 = [
    'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAwNtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAMgABAAABAAAA',
    'AAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC',
    'AAACLXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAMgAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAA',
    'AAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAADIAAAQAAAEAAAAAAaVtZGlh',
    'AAAAIG1kaGQAAAAAAAAAAAAAAAAAAB9AAAAFkFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFu',
    'ZGxlcgAAAAFQbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEUc3Ri',
    'bAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAB9AAAAAAAA2ZXNkcwAAAAADgICAJQAB',
    'AASAgIAXQBUAAAAAAB9AAAAEYwWAgIAFFYhW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAAAQAABAAAAAABAAABkAAAABxz',
    'dHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABUAAAAEAAAAFHN0Y28AAAAAAAAAAQAAAy8A',
    'AAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAAgAAAAEAAABidWR0YQAAAFptZXRhAAAA',
    'AAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYy',
    'LjEyLjEwMgAAAAhmcmVlAAAAIW1kYXTeAgBMYXZjNjIuMjguMTAyAAIwQA4BGCAH',
].join('');

const FRONT_COVER = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100f5fe51b90000000049454e44ae426082',
    'hex',
);

const quickTimeType = value => ByteVector.fromString(value, StringType.Latin1);

function riffChunk(id, data) {
    const source = Buffer.from(data);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(source.length);
    return Buffer.concat([
        Buffer.from(id, 'ascii'),
        size,
        source,
        source.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0),
    ]);
}

function createWaveFixture() {
    const sampleRate = 8000;
    const channels = 1;
    const bytesPerSample = 2;
    const format = Buffer.alloc(16);
    format.writeUInt16LE(1, 0);
    format.writeUInt16LE(channels, 2);
    format.writeUInt32LE(sampleRate, 4);
    format.writeUInt32LE(sampleRate * channels * bytesPerSample, 8);
    format.writeUInt16LE(channels * bytesPerSample, 12);
    format.writeUInt16LE(bytesPerSample * 8, 14);

    const wave = Buffer.concat([
        Buffer.from('WAVE', 'ascii'),
        riffChunk('fmt ', format),
        riffChunk('data', Buffer.alloc(sampleRate * channels * bytesPerSample)),
    ]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(wave.length);
    return Buffer.concat([Buffer.from('RIFF', 'ascii'), size, wave]);
}

function metadataItem(filePath, metadata = {}) {
    return {
        checked: true,
        name: path.basename(filePath),
        filepath: filePath,
        metadata: {
            Title: '실제 파일 제목',
            Writer: '실제 파일 저자',
            Series: '실제 파일 시리즈',
            Album: '실제 파일 앨범',
            AlbumArtist: '실제 파일 앨범 아티스트',
            Composer: '실제 파일 작곡가',
            Publisher: '실제 파일 출판사',
            Summary: '실제 파일 설명',
            Genre: '소설',
            Tags: '오디오북',
            Year: 2026,
            TrackNumber: 2,
            TrackTotal: 8,
            DiscNumber: 1,
            DiscTotal: 3,
            ...metadata,
        },
    };
}

function createLibraryDb(options = {}) {
    const upserts = [];
    return {
        upserts,
        async getFileInfo(filePath) {
            return options.existing?.[filePath] || null;
        },
        async upsertFileInfo(record) {
            upserts.push(record);
            await options.onUpsert?.(record);
            if (options.upsertError) throw options.upsertError;
        },
    };
}

async function metadataArtifacts(directory) {
    return (await fs.readdir(directory)).filter(name => (
        name.includes('bookmanager_metadata')
        || name.includes('.bookmanager.metadata.')
    ));
}

test('saveMetadataItems는 지원하는 WAV의 실제 태그를 수정하고 DB에는 파일에서 다시 읽은 값을 저장한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-save-'));
    const filePath = path.join(root, 'audiobook.wav');
    const original = createWaveFixture();
    const libraryDb = createLibraryDb();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, original);

    const result = await saveMetadataItems([metadataItem(filePath)], {
        backup_on: false,
        libraryDb,
        shouldCancel: () => false,
    });

    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(result.stats.skip, []);
    assert.deepEqual(result.stats.success, ['audiobook.wav']);
    assert.notDeepEqual(await fs.readFile(filePath), original);

    const written = await readAudioMetadata(filePath, { includeCover: false });
    assert.equal(written.title, '실제 파일 제목');
    assert.equal(written.artist, '실제 파일 저자');
    assert.equal(written.grouping, '실제 파일 시리즈');
    assert.equal(written.album, '실제 파일 앨범');
    assert.equal(written.albumArtist, '실제 파일 앨범 아티스트');
    assert.equal(written.composer, '실제 파일 작곡가');
    assert.equal(written.publisher, '실제 파일 출판사');
    assert.equal(written.description, '실제 파일 설명');
    assert.equal(written.genre, '소설, 오디오북');
    assert.equal(written.year, 2026);
    assert.equal(written.trackNumber, 2);
    assert.equal(written.trackTotal, 8);
    assert.equal(written.discNumber, 1);
    assert.equal(written.discTotal, 3);
    assert.equal(written.durationSeconds, 1);
    assert.equal(written.sampleRateHz, 8000);
    assert.equal(written.channels, 1);

    assert.equal(libraryDb.upserts.length, 1);
    assert.equal(libraryDb.upserts[0].title, written.title);
    assert.equal(libraryDb.upserts[0].writer, written.artist);
    assert.equal(libraryDb.upserts[0].album, written.album);
    assert.equal(libraryDb.upserts[0].duration_seconds, written.durationSeconds);
    assert.equal(libraryDb.upserts[0].metadata_override, 0);
    assert.deepEqual(await metadataArtifacts(root), []);
});

test('backup_on은 실제 파일을 교체하기 전에 bak에 원본 바이트를 보존한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-backup-'));
    const filePath = path.join(root, 'backup.wav');
    const original = createWaveFixture();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, original);

    const result = await saveMetadataItems([metadataItem(filePath)], {
        backup_on: true,
        libraryDb: createLibraryDb(),
        shouldCancel: () => false,
    });

    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(result.stats.success, ['backup.wav']);
    assert.deepEqual(await fs.readFile(path.join(root, 'bak', 'backup.wav')), original);
    assert.notDeepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await metadataArtifacts(root), []);
});

test('임시 파일 태그 저장 후 취소하면 원본과 DB를 변경하지 않고 임시 파일을 정리한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-cancel-'));
    const filePath = path.join(root, 'cancel.wav');
    const original = createWaveFixture();
    const libraryDb = createLibraryDb();
    let cancelChecks = 0;
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, original);

    const result = await saveMetadataItems([metadataItem(filePath)], {
        backup_on: false,
        libraryDb,
        shouldCancel: () => {
            cancelChecks += 1;
            return cancelChecks >= 2;
        },
    });

    assert.equal(cancelChecks, 2);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.stats.success, []);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.equal(libraryDb.upserts.length, 0);
    assert.deepEqual(await metadataArtifacts(root), []);
});

test('DB upsert가 실패하면 원본 바이트를 복구하고 교체용 파일을 남기지 않는다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-rollback-'));
    const filePath = path.join(root, 'rollback.wav');
    const original = createWaveFixture();
    const libraryDb = createLibraryDb({ upsertError: new Error('DB write failed') });
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, original);

    const result = await saveMetadataItems([metadataItem(filePath)], {
        backup_on: false,
        libraryDb,
        shouldCancel: () => false,
    });

    assert.deepEqual(result.stats.success, []);
    assert.equal(result.stats.error.length, 1);
    assert.match(result.stats.error[0], /DB write failed/);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.equal(libraryDb.upserts.length, 1);
    assert.deepEqual(await metadataArtifacts(root), []);
});

test('내장 표지 변경은 미리보기 갱신 성공 후에만 이전 생성 썸네일을 제거한다', async t => {
    await t.test('갱신 성공', async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-thumb-success-'));
        const thumbnailDir = path.join(root, 'thumbnails');
        const filePath = path.join(root, 'covered.wav');
        const replacementPath = path.join(root, 'replacement.png');
        const previousThumbnailPath = path.join(thumbnailDir, 'previous-thumbnail.png');
        const refreshedThumbnailPath = path.join(thumbnailDir, 'refreshed-thumbnail.png');
        t.after(() => fs.rm(root, { recursive: true, force: true }));
        await fs.mkdir(thumbnailDir, { recursive: true });
        await Promise.all([
            fs.writeFile(filePath, createWaveFixture()),
            fs.writeFile(replacementPath, FRONT_COVER),
            fs.writeFile(previousThumbnailPath, Buffer.from('previous thumbnail')),
        ]);
        const libraryDb = createLibraryDb({
            existing: {
                [filePath]: {
                    path: filePath,
                    cover_override_path: '',
                    thumb_path: previousThumbnailPath,
                },
            },
        });
        const item = metadataItem(filePath);
        item.audioCoverChange = { type: 'file', filePath: replacementPath };

        const result = await saveMetadataItems([item], {
            libraryDb,
            thumbnailDir,
            shouldCancel: () => false,
            async refreshFilePreview(refreshedFilePath) {
                assert.equal(refreshedFilePath, filePath);
                assert.equal(await fs.readFile(previousThumbnailPath, 'utf8'), 'previous thumbnail');
                await fs.writeFile(refreshedThumbnailPath, Buffer.from('refreshed thumbnail'));
                return { path: filePath, thumb_path: refreshedThumbnailPath };
            },
        });

        assert.deepEqual(result.stats.error, []);
        assert.equal(await fs.stat(refreshedThumbnailPath).then(() => true), true);
        await assert.rejects(fs.stat(previousThumbnailPath), { code: 'ENOENT' });
    });

    await t.test('갱신 실패', async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-thumb-failure-'));
        const thumbnailDir = path.join(root, 'thumbnails');
        const filePath = path.join(root, 'covered.wav');
        const replacementPath = path.join(root, 'replacement.png');
        const previousThumbnailPath = path.join(thumbnailDir, 'previous-thumbnail.png');
        t.after(() => fs.rm(root, { recursive: true, force: true }));
        await fs.mkdir(thumbnailDir, { recursive: true });
        await Promise.all([
            fs.writeFile(filePath, createWaveFixture()),
            fs.writeFile(replacementPath, FRONT_COVER),
            fs.writeFile(previousThumbnailPath, Buffer.from('previous thumbnail')),
        ]);
        const libraryDb = createLibraryDb({
            existing: {
                [filePath]: {
                    path: filePath,
                    cover_override_path: '',
                    thumb_path: previousThumbnailPath,
                },
            },
        });
        const item = metadataItem(filePath);
        item.audioCoverChange = { type: 'file', filePath: replacementPath };

        const result = await saveMetadataItems([item], {
            libraryDb,
            thumbnailDir,
            shouldCancel: () => false,
            async refreshFilePreview() {
                assert.equal(await fs.readFile(previousThumbnailPath, 'utf8'), 'previous thumbnail');
                return null;
            },
        });

        assert.deepEqual(result.stats.error, []);
        assert.equal(await fs.readFile(previousThumbnailPath, 'utf8'), 'previous thumbnail');
    });
});

test('M4B의 충돌하는 설명과 출판사 태그를 저장하고 비울 때 모든 태그 경로가 일관된다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-m4b-conflict-'));
    const filePath = path.join(root, 'conflicting.m4b');
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, Buffer.from(M4B_FIXTURE_BASE64, 'base64'));

    const seeded = TagLibFile.createFromPath(filePath);
    try {
        seeded.tag.description = '기존 desc';
        seeded.tag.comment = '기존 ©cmt';
        seeded.tag.publisher = '기존 publisher';
        seeded.tag.setQuickTimeString(quickTimeType('ldes'), '기존 ldes');
        seeded.tag.setQuickTimeString(quickTimeType('©com'), '기존 ©com');
        seeded.tag.setItunesStrings('com.apple.iTunes', 'LABEL', '기존 LABEL');
        seeded.tag.setItunesStrings('com.apple.iTunes', 'NOTES', '기존 NOTES');
        seeded.save();
    } finally {
        seeded.dispose();
    }

    const conflicts = TagLibFile.createFromPath(filePath);
    try {
        assert.equal(conflicts.tag.description, '기존 desc');
        assert.equal(conflicts.tag.comment, '기존 ©cmt');
        assert.deepEqual(conflicts.tag.getQuickTimeStrings(quickTimeType('ldes')), ['기존 ldes']);
        assert.deepEqual(conflicts.tag.getQuickTimeStrings(quickTimeType('©com')), ['기존 ©com']);
        assert.equal(conflicts.tag.publisher, '기존 publisher');
        assert.deepEqual(
            conflicts.tag.getItunesStrings('com.apple.iTunes', 'LABEL'),
            ['기존 LABEL'],
        );
        assert.deepEqual(
            conflicts.tag.getItunesStrings('com.apple.iTunes', 'NOTES'),
            ['기존 NOTES'],
        );
    } finally {
        conflicts.dispose();
    }

    const saveResult = await saveMetadataItems([{
        checked: true,
        name: path.basename(filePath),
        filepath: filePath,
        metadata: {
            Summary: '새 오디오북 설명',
            Publisher: '새 오디오북 출판사',
        },
    }], {
        libraryDb: createLibraryDb(),
        shouldCancel: () => false,
    });

    assert.deepEqual(saveResult.stats.error, []);
    assert.deepEqual(saveResult.stats.success, ['conflicting.m4b']);
    const savedMetadata = await readAudioMetadata(filePath, { includeCover: false });
    assert.equal(savedMetadata.description, '새 오디오북 설명');
    assert.equal(savedMetadata.publisher, '새 오디오북 출판사');

    const saved = TagLibFile.createFromPath(filePath);
    try {
        assert.equal(saved.tag.description, '새 오디오북 설명');
        assert.equal(saved.tag.comment, '새 오디오북 설명');
        assert.deepEqual(saved.tag.getQuickTimeStrings(quickTimeType('ldes')), ['새 오디오북 설명']);
        assert.deepEqual(saved.tag.getQuickTimeStrings(quickTimeType('©com')), []);
        assert.equal(saved.tag.publisher, '새 오디오북 출판사');
        assert.deepEqual(
            saved.tag.getItunesStrings('com.apple.iTunes', 'LABEL'),
            ['새 오디오북 출판사'],
        );
        assert.deepEqual(saved.tag.getItunesStrings('com.apple.iTunes', 'NOTES'), []);
    } finally {
        saved.dispose();
    }

    const clearResult = await saveMetadataItems([{
        checked: true,
        name: path.basename(filePath),
        filepath: filePath,
        metadata: {
            Summary: '',
            Publisher: '',
        },
    }], {
        libraryDb: createLibraryDb(),
        shouldCancel: () => false,
    });

    assert.deepEqual(clearResult.stats.error, []);
    assert.deepEqual(clearResult.stats.success, ['conflicting.m4b']);
    const clearedMetadata = await readAudioMetadata(filePath, { includeCover: false });
    assert.equal(clearedMetadata.description, '');
    assert.equal(clearedMetadata.publisher, '');

    const cleared = TagLibFile.createFromPath(filePath);
    try {
        assert.equal(cleared.tag.description, undefined);
        assert.equal(cleared.tag.comment, undefined);
        assert.deepEqual(cleared.tag.getQuickTimeStrings(quickTimeType('ldes')), []);
        assert.deepEqual(cleared.tag.getQuickTimeStrings(quickTimeType('©com')), []);
        assert.equal(cleared.tag.publisher, undefined);
        assert.deepEqual(cleared.tag.getItunesStrings('com.apple.iTunes', 'LABEL'), []);
        assert.deepEqual(cleared.tag.getItunesStrings('com.apple.iTunes', 'NOTES'), []);
    } finally {
        cleared.dispose();
    }
});

test('오디오 교체는 rollback 원본을 만든 뒤 temp를 원본 경로에 rename-over한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-commit-contract-'));
    const filePath = path.join(root, 'commit.wav');
    const original = createWaveFixture();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(filePath, original);
    const originalStat = await fs.stat(filePath);
    let commitInspected = false;
    const libraryDb = createLibraryDb({
        async onUpsert() {
            const names = await fs.readdir(root);
            const holdingName = names.find(name => name.startsWith('commit.wav.bookmanager.metadata.') && name.endsWith('.old'));
            assert.ok(holdingName, 'DB commit 전에 rollback 파일이 존재해야 합니다.');
            const holdingPath = path.join(root, holdingName);
            const [sourceBytes, holdingBytes, sourceStat, holdingStat] = await Promise.all([
                fs.readFile(filePath),
                fs.readFile(holdingPath),
                fs.stat(filePath),
                fs.stat(holdingPath),
            ]);
            assert.notDeepEqual(sourceBytes, original);
            assert.deepEqual(holdingBytes, original);
            if (originalStat.ino > 0 && holdingStat.ino > 0) {
                assert.equal(holdingStat.ino, originalStat.ino);
                assert.notEqual(sourceStat.ino, originalStat.ino);
            }
            commitInspected = true;
        },
    });

    const result = await saveMetadataItems([metadataItem(filePath)], {
        libraryDb,
        shouldCancel: () => false,
    });

    assert.deepEqual(result.stats.error, []);
    assert.equal(commitInspected, true);
    assert.deepEqual(await metadataArtifacts(root), []);

    const taskSource = await fs.readFile(
        new URL('./tasks/metadataTask.js', import.meta.url),
        'utf8',
    );
    const rollbackStart = taskSource.indexOf('async function createAudioRollbackFile');
    const writerStart = taskSource.indexOf('async function writeAudioMetadataItem');
    const writerEnd = taskSource.indexOf('\nasync function persistDocumentMetadata', writerStart);
    assert.ok(rollbackStart >= 0 && writerStart > rollbackStart && writerEnd > writerStart);

    const rollbackSource = taskSource.slice(rollbackStart, writerStart);
    const linkIndex = rollbackSource.indexOf('await fsp.link(filePath, sourceHoldingPath)');
    const copyIndex = rollbackSource.indexOf('await copyAudioFileForEditing(filePath, sourceHoldingPath)');
    assert.ok(linkIndex >= 0 && copyIndex > linkIndex);
    assert.match(
        rollbackSource,
        /try\s*{[^}]*fsp\.link\(filePath, sourceHoldingPath\)[^}]*}\s*catch\s*{[^}]*copyAudioFileForEditing\(filePath, sourceHoldingPath\)/s,
    );

    const writerSource = taskSource.slice(writerStart, writerEnd);
    const createRollbackIndex = writerSource.indexOf('await createAudioRollbackFile(filePath, sourceHoldingPath)');
    const renameOverIndex = writerSource.indexOf('await fsp.rename(tempPath, filePath)');
    assert.ok(createRollbackIndex >= 0 && renameOverIndex > createRollbackIndex);
    assert.doesNotMatch(
        writerSource.slice(0, renameOverIndex),
        /await fsp\.(?:rm|unlink)\(filePath|await fsp\.rename\(filePath/,
    );
});

test('쓰기 미지원 오디오 형식은 오류 또는 건너뜀으로 보고하고 파일을 수정하지 않는다', async t => {
    for (const extension of ['.webm', '.caf']) {
        await t.test(extension, async t => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-unsupported-'));
            const filePath = path.join(root, `unsupported${extension}`);
            const original = Buffer.from(`unsupported audio fixture: ${extension}`);
            t.after(() => fs.rm(root, { recursive: true, force: true }));
            await fs.writeFile(filePath, original);

            const result = await saveMetadataItems([metadataItem(filePath)], {
                backup_on: false,
                libraryDb: createLibraryDb(),
                shouldCancel: () => false,
            });

            assert.equal(result.stats.success.length, 0);
            assert.equal(result.stats.error.length + result.stats.skip.length, 1);
            assert.match(
                [...result.stats.error, ...result.stats.skip][0],
                new RegExp(`unsupported\\${extension}`),
            );
            assert.deepEqual(await fs.readFile(filePath), original);
            assert.deepEqual(await metadataArtifacts(root), []);
        });
    }
});
