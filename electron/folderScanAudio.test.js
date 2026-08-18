import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import {
    analyzeMetadataInputs,
    loadMetadataCover,
    loadLatestSeriesMetadata,
    saveMetadataItems,
} from './tasks/metadataTask.js';
import { scanFolder } from './tasks/folderScanTask.js';

function riffChunk(id, data) {
    const source = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(source.length);
    return Buffer.concat([
        Buffer.from(id, 'ascii'),
        size,
        source,
        source.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0),
    ]);
}

function riffInfoValue(value) {
    const source = Buffer.from(`${value}\0`, 'utf8');
    return source.length % 2 === 0 ? source : Buffer.concat([source, Buffer.alloc(1)]);
}

function createWaveFixture(options = {}) {
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

    const info = Buffer.concat([
        Buffer.from('INFO', 'ascii'),
        riffChunk('INAM', riffInfoValue(options.title || 'Embedded Title')),
        riffChunk('IART', riffInfoValue(options.artist || 'Embedded Artist')),
        riffChunk('IPRD', riffInfoValue(options.album || 'Embedded Album')),
        riffChunk('IGNR', riffInfoValue('Fiction')),
        riffChunk('ICRD', riffInfoValue('2024-05-06')),
        riffChunk('ITRK', riffInfoValue('2/7')),
    ]);
    const waveChunks = [
        Buffer.from('WAVE', 'ascii'),
        riffChunk('fmt ', format),
    ];
    if (options.includeMetadata !== false) waveChunks.push(riffChunk('LIST', info));
    waveChunks.push(riffChunk('data', Buffer.alloc(sampleRate * channels * bytesPerSample)));
    const wave = Buffer.concat(waveChunks);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(wave.length);
    return Buffer.concat([Buffer.from('RIFF', 'ascii'), size, wave]);
}

function syncSafeId3Size(value) {
    return Buffer.from([
        (value >> 21) & 0x7f,
        (value >> 14) & 0x7f,
        (value >> 7) & 0x7f,
        value & 0x7f,
    ]);
}

function id3Frame(id, data) {
    const header = Buffer.alloc(10);
    header.write(id, 0, 'ascii');
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
}

const EMBEDDED_COVER = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100f5fe51b90000000049454e44ae426082',
    'hex',
);

function dataUrlBuffer(dataUrl = '') {
    return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
}

function createMp3Fixture(options = {}) {
    const textFrame = (id, value) => id3Frame(
        id,
        Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')]),
    );
    const frames = [
        textFrame('TIT2', options.title || 'MP3 Title'),
        textFrame('TPE1', 'MP3 Artist'),
    ];
    if (options.includeCover !== false) {
        frames.push(id3Frame('APIC', Buffer.concat([
            Buffer.from([0]),
            Buffer.from('image/png\0', 'binary'),
            Buffer.from([3, 0]),
            EMBEDDED_COVER,
        ])));
    }
    const tagFrames = Buffer.concat(frames);
    const id3Tag = Buffer.concat([
        Buffer.from('ID3\x03\0\0', 'binary'),
        syncSafeId3Size(tagFrames.length),
        tagFrames,
    ]);
    const audioFrames = Buffer.alloc(417 * 4);
    for (let offset = 0; offset < audioFrames.length; offset += 417) {
        audioFrames[offset] = 0xff;
        audioFrames[offset + 1] = 0xfb;
        audioFrames[offset + 2] = 0x90;
        audioFrames[offset + 3] = 0x64;
    }
    return Buffer.concat([id3Tag, audioFrames]);
}

test('폴더 스캔은 오디오 메타데이터를 DB에 저장하고 유효한 캐시를 재사용한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-audio-'));
    const libraryDir = path.join(root, 'library');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Tagged Audio.wav');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(audioPath, createWaveFixture());

        const first = await scanFolder(libraryDir, {
            dbPath,
            skipCoverExtraction: true,
        });

        assert.equal(first.length, 1);
        assert.equal(first[0].book_type, 'audio');
        assert.equal(first[0].title, 'Embedded Title');
        assert.equal(first[0].series, 'Embedded Album');
        assert.equal(first[0].writer, 'Embedded Artist');
        assert.equal(first[0].genre, 'Fiction');
        assert.equal(first[0].date, '2024');
        assert.equal(first[0].chapter, '2');
        assert.equal(first[0].trackNumber, 2);
        assert.equal(first[0].trackTotal, 7);
        assert.equal(first[0].durationSeconds, 1);
        assert.equal(first[0].bitrateBitsPerSecond, 128000);
        assert.equal(first[0].sampleRateHz, 8000);
        assert.equal(first[0].codec, 'PCM');
        assert.equal(first[0].container, 'WAVE');
        assert.equal(first[0].channels, 1);
        assert.equal(first[0].mimeType, 'audio/wav');
        assert.equal(first[0].format, 'Audiobook');
        assert.equal(first[0].has_metadata, true);

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.book_type, 'audio');
            assert.equal(cached.title, 'Embedded Title');
            assert.equal(cached.album, 'Embedded Album');
            assert.equal(cached.writer, 'Embedded Artist');
            assert.equal(cached.has_metadata, 1);
            assert.equal(cached.duration_seconds, 1);
            assert.equal(cached.bitrate, 128000);
            assert.equal(cached.sample_rate, 8000);
            assert.equal(cached.codec, 'PCM');
            assert.equal(cached.container, 'WAVE');
            assert.equal(cached.channels, 1);
            assert.equal(Number(cached.track_number), 2);
            assert.equal(Number(cached.track_total), 7);
            assert.equal(cached.mime_type, 'audio/wav');
        } finally {
            await library.close();
        }

        const originalStat = fs.statSync(audioPath);
        fs.writeFileSync(audioPath, Buffer.alloc(originalStat.size));
        fs.utimesSync(audioPath, originalStat.atime, originalStat.mtime);

        const originalWarn = console.warn;
        const warnings = [];
        let second;
        try {
            console.warn = (...args) => warnings.push(args.join(' '));
            second = await scanFolder(libraryDir, {
                dbPath,
                skipCoverExtraction: true,
            });
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(second.length, 1);
        assert.equal(second[0].title, 'Embedded Title');
        assert.equal(second[0].album, 'Embedded Album');
        assert.equal(second[0].durationSeconds, 1);
        assert.equal(second[0].trackNumber, 2);
        assert.equal(second[0].mimeType, 'audio/wav');
        assert.equal(warnings.some(message => message.includes('Failed to extract archive metadata')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('오디오 메타데이터 편집은 원본 파일을 바꾸지 않고 DB에서 다시 로드한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-metadata-db-'));
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(root, 'DB Only Audio.wav');
    const original = createWaveFixture();

    try {
        fs.writeFileSync(audioPath, original);
        const analyzed = await analyzeMetadataInputs([audioPath], {
            dbPath,
            includeCovers: false,
        });
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].bookType, 'audio');
        assert.equal(analyzed.items[0].metadata.Title, 'Embedded Title');

        analyzed.items[0].metadata = {
            ...analyzed.items[0].metadata,
            Title: 'DB Title',
            Series: 'DB Series',
            Album: 'DB Album',
            Writer: 'DB Artist',
            AlbumArtist: 'DB Album Artist',
            Composer: 'DB Composer',
            Summary: 'DB Summary',
            Genre: 'Mystery',
            Tags: 'Narrated, Unabridged',
            Year: '2026',
            TrackNumber: '4',
            TrackTotal: '12',
            DiscNumber: '2',
            DiscTotal: '3',
            DurationSeconds: '3456.75',
            Bitrate: '96000',
            SampleRate: '48000',
            Codec: 'AAC LC',
            Container: 'MPEG-4',
            Channels: '2',
            MimeType: 'audio/mp4',
            Format: 'Audiobook',
        };

        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            dbPath,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(audioPath), original);

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.title, 'DB Title');
            assert.equal(cached.series, 'DB Series');
            assert.equal(cached.volume, '2');
            assert.equal(cached.number, '4');
            assert.equal(cached.volume_count, '3');
            assert.equal(cached.album, 'DB Album');
            assert.equal(cached.writer, 'DB Artist');
            assert.equal(cached.album_artist, 'DB Album Artist');
            assert.equal(cached.composer, 'DB Composer');
            assert.equal(cached.publish_date, '2026');
            assert.equal(cached.duration_seconds, 3456.75);
            assert.equal(cached.bitrate, 96000);
            assert.equal(cached.sample_rate, 48000);
            assert.equal(cached.codec, 'AAC LC');
            assert.equal(cached.container, 'MPEG-4');
            assert.equal(cached.channels, 2);
            assert.equal(cached.track_number, '4');
            assert.equal(cached.track_total, '12');
            assert.equal(cached.disc_number, '2');
            assert.equal(cached.disc_total, '3');
            assert.equal(cached.mime_type, 'audio/mp4');
            assert.equal(cached.has_metadata, 1);
            assert.equal(cached.metadata_override, 1);
        } finally {
            await library.close();
        }

        const refreshed = await scanFolder(root, { dbPath });
        assert.equal(refreshed[0].title, 'DB Title');
        assert.equal(refreshed[0].writer, 'DB Artist');
        assert.equal(refreshed[0].album, 'DB Album');
        assert.equal(refreshed[0].volume, '2');
        assert.equal(refreshed[0].chapter, '4');
        assert.equal(refreshed[0].total_volume, '3');
        assert.equal(refreshed[0].has_metadata, true);

        const forceRefreshed = await scanFolder(root, { dbPath, force: true });
        assert.equal(forceRefreshed[0].title, 'DB Title');
        assert.equal(forceRefreshed[0].writer, 'DB Artist');
        assert.equal(forceRefreshed[0].album, 'DB Album');
        assert.equal(forceRefreshed[0].has_metadata, true);

        const refreshedLibrary = new LibraryDB({ dbPath });
        try {
            const refreshedCached = await refreshedLibrary.getFileInfo(audioPath);
            assert.equal(refreshedCached.title, 'DB Title');
            assert.equal(refreshedCached.writer, 'DB Artist');
            assert.equal(refreshedCached.album, 'DB Album');
            assert.equal(refreshedCached.has_metadata, 1);
            assert.equal(refreshedCached.metadata_override, 1);
        } finally {
            await refreshedLibrary.close();
        }

        const reanalyzed = await analyzeMetadataInputs([audioPath], {
            dbPath,
            includeCovers: false,
        });
        const metadata = reanalyzed.items[0].metadata;
        assert.equal(metadata.Title, 'DB Title');
        assert.equal(metadata.Series, 'DB Series');
        assert.equal(metadata.Album, 'DB Album');
        assert.equal(metadata.Writer, 'DB Artist');
        assert.equal(metadata.AlbumArtist, 'DB Album Artist');
        assert.equal(metadata.Composer, 'DB Composer');
        assert.equal(metadata.Summary, 'DB Summary');
        assert.equal(metadata.Genre, 'Mystery');
        assert.equal(metadata.Tags, 'Narrated, Unabridged');
        assert.equal(metadata.Year, '2026');
        assert.equal(metadata.TrackNumber, '4');
        assert.equal(metadata.TrackTotal, '12');
        assert.equal(metadata.DiscNumber, '2');
        assert.equal(metadata.DiscTotal, '3');
        assert.equal(metadata.DurationSeconds, 3456.75);
        assert.equal(metadata.Bitrate, 96000);
        assert.equal(metadata.SampleRate, 48000);
        assert.equal(metadata.Codec, 'AAC LC');
        assert.equal(metadata.Container, 'MPEG-4');
        assert.equal(metadata.Channels, 2);
        assert.equal(metadata.MimeType, 'audio/mp4');
        assert.equal(metadata.Format, 'Audiobook');

        const latest = await loadLatestSeriesMetadata({
            title: 'DB Title',
            bookType: 'audio',
        }, { dbPath });
        assert.ok(latest);
        assert.equal(latest.sourcePath, audioPath);
        assert.equal(latest.metadata.Title, 'DB Title');
        assert.equal(latest.metadata.Writer, 'DB Artist');
        assert.equal(latest.metadata.Album, 'DB Album');

        const renamedPath = path.join(root, 'Renamed DB Only Audio.wav');
        fs.renameSync(audioPath, renamedPath);
        const renameLibrary = new LibraryDB({ dbPath });
        try {
            const moved = await renameLibrary.applyLibraryMoveIndexChanges({
                fileInfoMoves: [{ src: audioPath, dest: renamedPath, recursive: false }],
            });
            assert.equal(moved.movedFileInfoCount, 1);
            assert.equal(await renameLibrary.getFileInfo(audioPath), null);
        } finally {
            await renameLibrary.close();
        }

        const renamedRefresh = await scanFolder(root, { dbPath, force: true });
        const renamedAudio = renamedRefresh.find(file => file.path === renamedPath);
        assert.ok(renamedAudio);
        assert.equal(renamedAudio.title, 'DB Title');
        assert.equal(renamedAudio.writer, 'DB Artist');
        assert.equal(renamedAudio.album, 'DB Album');
        assert.equal(renamedAudio.has_metadata, true);

        const renamedLibrary = new LibraryDB({ dbPath });
        try {
            const renamedRecord = await renamedLibrary.getFileInfo(renamedPath);
            assert.equal(renamedRecord.title, 'DB Title');
            assert.equal(renamedRecord.writer, 'DB Artist');
            assert.equal(renamedRecord.metadata_override, 1);
        } finally {
            await renamedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('오디오 표지 override는 원본을 바꾸지 않고 스캔과 이름 변경 왕복에서 유지되며 reset으로 복귀한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-override-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Covered Book.mp3');
    const replacementPath = path.join(root, 'replacement.png');
    const replacementCover = Buffer.concat([EMBEDDED_COVER, Buffer.from('replacement-cover')]);

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        const originalAudio = createMp3Fixture({ title: 'Covered Book' });
        fs.writeFileSync(audioPath, originalAudio);
        fs.writeFileSync(replacementPath, replacementCover);
        await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });

        const analyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(analyzed.items[0].audioCoverOverride, false);
        analyzed.items[0].audioCoverChange = {
            type: 'file',
            filePath: replacementPath,
            label: 'replacement.png',
        };
        const saved = await saveMetadataItems(analyzed.items, {
            dbPath,
            thumbnailDir,
            thumbnailEncoder: async buffer => ({ buffer, extension: '.png' }),
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(audioPath), originalAudio);

        const library = new LibraryDB({ dbPath });
        let overridePath;
        try {
            const cached = await library.getFileInfo(audioPath);
            overridePath = cached.cover_override_path;
            assert.match(path.basename(overridePath), /^audio-cover-override-.*\.png$/);
            assert.equal(cached.thumb_path, overridePath);
            assert.equal(fs.existsSync(overridePath), true);
            assert.deepEqual(fs.readFileSync(overridePath), replacementCover);
        } finally {
            await library.close();
        }

        const loadedOverride = await loadMetadataCover(audioPath, { dbPath });
        assert.deepEqual(dataUrlBuffer(loadedOverride), replacementCover);
        const loadedEmbedded = await loadMetadataCover(audioPath, {
            dbPath,
            ignoreAudioCoverOverride: true,
        });
        assert.deepEqual(dataUrlBuffer(loadedEmbedded), EMBEDDED_COVER);

        const reanalyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(reanalyzed.items[0].audioCoverOverride, true);
        assert.equal(reanalyzed.items[0].coverOverridePath, overridePath);
        assert.deepEqual(dataUrlBuffer(reanalyzed.items[0].coverDataUrl), replacementCover);

        const regularScan = await scanFolder(libraryDir, { dbPath, thumbnailDir });
        assert.equal(regularScan[0].cover_override_path, overridePath);
        assert.equal(regularScan[0].thumb_path, overridePath);
        const forceScan = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(forceScan[0].cover_override_path, overridePath);
        assert.equal(forceScan[0].thumb_path, overridePath);
        assert.deepEqual(fs.readFileSync(overridePath), replacementCover);

        const renamedPath = path.join(libraryDir, 'Renamed Covered Book.mp3');
        fs.renameSync(audioPath, renamedPath);
        const renameLibrary = new LibraryDB({ dbPath });
        try {
            await renameLibrary.applyLibraryMoveIndexChanges({
                fileInfoMoves: [{ src: audioPath, dest: renamedPath, recursive: false }],
            });
            assert.equal((await renameLibrary.getFileInfo(renamedPath)).cover_override_path, overridePath);
        } finally {
            await renameLibrary.close();
        }
        const renamedScan = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(renamedScan[0].thumb_path, overridePath);

        fs.renameSync(renamedPath, audioPath);
        const undoLibrary = new LibraryDB({ dbPath });
        try {
            await undoLibrary.applyLibraryMoveIndexChanges({
                fileInfoMoves: [{ src: renamedPath, dest: audioPath, recursive: false }],
            });
            assert.equal((await undoLibrary.getFileInfo(audioPath)).cover_override_path, overridePath);
        } finally {
            await undoLibrary.close();
        }

        const resetAnalysis = await analyzeMetadataInputs([audioPath], { dbPath });
        resetAnalysis.items[0].audioCoverChange = { type: 'reset' };
        const reset = await saveMetadataItems(resetAnalysis.items, {
            dbPath,
            thumbnailDir,
            refreshFilePreview: async filePath => {
                const files = await scanFolder(path.dirname(filePath), {
                    dbPath,
                    thumbnailDir,
                    force: true,
                });
                return files.find(file => file.path === filePath) || null;
            },
        });
        assert.equal(reset.stats.success.length, 1, reset.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(audioPath), originalAudio);
        assert.equal(fs.existsSync(overridePath), false);

        const resetLibrary = new LibraryDB({ dbPath });
        try {
            const cached = await resetLibrary.getFileInfo(audioPath);
            assert.equal(cached.cover_override_path, '');
            assert.ok(cached.thumb_path);
            assert.notEqual(cached.thumb_path, overridePath);
            assert.equal(fs.existsSync(cached.thumb_path), true);
        } finally {
            await resetLibrary.close();
        }
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, { dbPath })), EMBEDDED_COVER);
        const resetAnalyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(resetAnalyzed.items[0].audioCoverOverride, false);
        assert.deepEqual(dataUrlBuffer(resetAnalyzed.items[0].coverDataUrl), EMBEDDED_COVER);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('누락된 오디오 표지 override는 임베디드 표지로 대체되고 강제 스캔에서 정리된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-missing-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Missing Override.mp3');
    const missingPath = path.join(thumbnailDir, 'audio-cover-override-missing.png');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(audioPath, createMp3Fixture({ title: 'Missing Override' }));
        await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            await library.upsertFileInfo({
                ...cached,
                cover_override_path: missingPath,
                thumb_path: missingPath,
            });
        } finally {
            await library.close();
        }

        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, { dbPath })), EMBEDDED_COVER);
        const analyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(analyzed.items[0].audioCoverOverride, false);
        assert.deepEqual(dataUrlBuffer(analyzed.items[0].coverDataUrl), EMBEDDED_COVER);

        const refreshed = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(refreshed[0].cover_override_path, '');
        assert.ok(refreshed[0].thumb_path);
        assert.notEqual(refreshed[0].thumb_path, missingPath);
        const refreshedLibrary = new LibraryDB({ dbPath });
        try {
            const cached = await refreshedLibrary.getFileInfo(audioPath);
            assert.equal(cached.cover_override_path, '');
            assert.ok(cached.thumb_path);
        } finally {
            await refreshedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('오디오 표지 DB 저장 실패는 새 관리 파일을 회수하고 기존 override를 유지한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-rollback-'));
    const thumbnailDir = path.join(root, 'thumbnails');
    const audioPath = path.join(root, 'Rollback Book.mp3');
    const replacementPath = path.join(root, 'replacement.png');
    const previousOverridePath = path.join(thumbnailDir, 'audio-cover-override-previous.png');
    const originalAudio = createMp3Fixture({ title: 'Rollback Book' });

    try {
        fs.mkdirSync(thumbnailDir, { recursive: true });
        fs.writeFileSync(audioPath, originalAudio);
        fs.writeFileSync(replacementPath, Buffer.concat([EMBEDDED_COVER, Buffer.from('replacement')]));
        fs.writeFileSync(previousOverridePath, Buffer.concat([EMBEDDED_COVER, Buffer.from('previous')]));
        const result = await saveMetadataItems([{
            filepath: audioPath,
            name: path.basename(audioPath),
            checked: true,
            metadata: { Title: 'Rollback Book', Format: 'Audiobook' },
            audioCoverChange: { type: 'file', filePath: replacementPath },
        }], {
            thumbnailDir,
            libraryDb: {
                getFileInfo: async () => ({
                    path: audioPath,
                    cover_override_path: previousOverridePath,
                    thumb_path: previousOverridePath,
                }),
                upsertFileInfo: async () => {
                    throw new Error('simulated DB failure');
                },
            },
        });

        assert.equal(result.stats.success.length, 0);
        assert.equal(result.stats.error.length, 1);
        assert.match(result.stats.error[0], /simulated DB failure/);
        assert.deepEqual(fs.readFileSync(audioPath), originalAudio);
        assert.equal(fs.existsSync(previousOverridePath), true);
        assert.deepEqual(
            fs.readdirSync(thumbnailDir).sort(),
            [path.basename(previousOverridePath)],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('동일한 파일명의 오디오 부분 저장 결과는 성공한 절대 경로만 식별한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-save-paths-'));
    const successfulPath = path.join(root, 'first', 'Same Title.mp3');
    const failedPath = path.join(root, 'second', 'Same Title.mp3');

    try {
        fs.mkdirSync(path.dirname(successfulPath), { recursive: true });
        fs.mkdirSync(path.dirname(failedPath), { recursive: true });
        fs.writeFileSync(successfulPath, createMp3Fixture());
        fs.writeFileSync(failedPath, createMp3Fixture());
        const result = await saveMetadataItems([
            {
                filepath: successfulPath,
                name: path.basename(successfulPath),
                checked: true,
                metadata: { Title: 'Successful', Format: 'Audiobook' },
            },
            {
                filepath: failedPath,
                name: path.basename(failedPath),
                checked: true,
                metadata: { Title: 'Failed', Format: 'Audiobook' },
            },
        ], {
            libraryDb: {
                getFileInfo: async () => null,
                upsertFileInfo: async record => {
                    if (record.path === failedPath) throw new Error('simulated partial failure');
                },
            },
        });

        assert.deepEqual(result.stats.success, ['Same Title.mp3']);
        assert.deepEqual(result.stats.successPaths, [
            path.resolve(successfulPath).replace(/\\/g, '/').normalize('NFC'),
        ]);
        assert.equal(result.stats.error.length, 1);
        assert.match(result.stats.error[0], /simulated partial failure/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('이미지가 아닌 .png 오디오 표지는 저장하지 않고 원본과 기존 override를 유지한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-invalid-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Invalid Cover.mp3');
    const invalidReplacementPath = path.join(root, 'not-an-image.png');
    const previousOverridePath = path.join(thumbnailDir, 'audio-cover-override-previous.png');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.mkdirSync(thumbnailDir, { recursive: true });
        const originalAudio = createMp3Fixture({ title: 'Invalid Cover' });
        fs.writeFileSync(audioPath, originalAudio);
        fs.writeFileSync(invalidReplacementPath, 'this is plain text', 'utf8');
        fs.writeFileSync(previousOverridePath, EMBEDDED_COVER);
        await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });

        const library = new LibraryDB({ dbPath });
        let titleBefore;
        try {
            const cached = await library.getFileInfo(audioPath);
            titleBefore = cached.title;
            await library.upsertFileInfo({
                ...cached,
                cover_override_path: previousOverridePath,
                thumb_path: previousOverridePath,
            });
        } finally {
            await library.close();
        }
        const thumbnailFilesBefore = fs.readdirSync(thumbnailDir).sort();

        const result = await saveMetadataItems([{
            filepath: audioPath,
            name: path.basename(audioPath),
            checked: true,
            metadata: { Title: 'Must Not Be Stored', Format: 'Audiobook' },
            audioCoverChange: { type: 'file', filePath: invalidReplacementPath },
        }], {
            dbPath,
            thumbnailDir,
        });

        assert.equal(result.stats.success.length, 0);
        assert.equal(result.stats.error.length, 1);
        assert.match(result.stats.error[0], /not a supported image file/i);
        assert.deepEqual(fs.readFileSync(audioPath), originalAudio);
        assert.deepEqual(fs.readFileSync(previousOverridePath), EMBEDDED_COVER);
        assert.deepEqual(fs.readdirSync(thumbnailDir).sort(), thumbnailFilesBefore);

        const persistedLibrary = new LibraryDB({ dbPath });
        try {
            const persisted = await persistedLibrary.getFileInfo(audioPath);
            assert.equal(persisted.cover_override_path, previousOverridePath);
            assert.equal(persisted.thumb_path, previousOverridePath);
            assert.equal(persisted.title, titleBefore);
        } finally {
            await persistedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('태그 없는 오디오는 파일명 제목과 has_metadata false를 캐시에서도 유지한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-empty-tags-'));
    const libraryDir = path.join(root, 'library');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Chapter 01.wav');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(audioPath, createWaveFixture({ includeMetadata: false }));

        const first = await scanFolder(libraryDir, {
            dbPath,
            skipCoverExtraction: true,
        });
        assert.equal(first.length, 1);
        assert.equal(first[0].title, 'Chapter 01');
        assert.equal(first[0].has_metadata, false);

        const second = await scanFolder(libraryDir, {
            dbPath,
            skipCoverExtraction: true,
        });
        assert.equal(second.length, 1);
        assert.equal(second[0].title, 'Chapter 01');
        assert.equal(second[0].has_metadata, false);

        const analyzed = await analyzeMetadataInputs([audioPath], {
            dbPath,
            includeCovers: false,
        });
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].metadata.Title, 'Chapter 01');
        assert.equal(analyzed.items[0].hasAudioMetadata, false);

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.has_metadata, 0);
        } finally {
            await library.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('빈 문자열 구 캐시 플래그가 있는 오디오는 일반 스캔에서 태그를 다시 추출한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-legacy-cache-'));
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(root, 'Legacy Cached Audio.wav');

    try {
        fs.writeFileSync(audioPath, createWaveFixture({
            title: 'Embedded Tagged Title',
            artist: 'Embedded Artist',
        }));
        const stat = fs.statSync(audioPath);
        const library = new LibraryDB({ dbPath });
        try {
            await library.upsertFileInfo({
                path: audioPath,
                ext: '.wav',
                title: 'Legacy Stub',
                mtime: stat.mtimeMs / 1000,
                size: stat.size,
            });
            const stub = await library.getFileInfo(audioPath);
            assert.equal(stub.has_metadata, '');
            assert.equal(stub.metadata_override, '');
        } finally {
            await library.close();
        }

        const files = await scanFolder(root, {
            dbPath,
            skipCoverExtraction: true,
        });
        const audio = files.find(file => file.path === audioPath);
        assert.ok(audio);
        assert.equal(audio.title, 'Embedded Tagged Title');
        assert.equal(audio.writer, 'Embedded Artist');
        assert.equal(audio.has_metadata, true);

        const refreshedLibrary = new LibraryDB({ dbPath });
        try {
            const refreshed = await refreshedLibrary.getFileInfo(audioPath);
            assert.equal(refreshed.has_metadata, 1);
            assert.equal(refreshed.metadata_override, 0);
        } finally {
            await refreshedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('사용자 override가 없는 오디오 분석은 오래된 DB 캐시보다 현재 파일 태그를 우선한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-fresh-tags-'));
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(root, 'Changed Audio.wav');

    try {
        fs.writeFileSync(audioPath, createWaveFixture({ title: 'Old Title', artist: 'Old Artist' }));
        await scanFolder(root, { dbPath, skipCoverExtraction: true });

        fs.writeFileSync(audioPath, createWaveFixture({ title: 'New Title', artist: 'New Artist' }));
        const analyzed = await analyzeMetadataInputs([audioPath], {
            dbPath,
            includeCovers: false,
        });

        assert.equal(analyzed.items[0].metadata.Title, 'New Title');
        assert.equal(analyzed.items[0].metadata.Writer, 'New Artist');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('표지가 제거된 오디오를 다시 스캔하면 이전 썸네일 캐시도 제거한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-refresh-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Book.mp3');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(audioPath, createMp3Fixture({ title: 'With Cover' }));
        const first = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(first[0].title, 'With Cover');
        assert.ok(first[0].thumb_path);
        assert.equal(fs.existsSync(first[0].thumb_path), true);
        const previousThumbnail = first[0].thumb_path;

        fs.writeFileSync(audioPath, createMp3Fixture({ title: 'Without Cover', includeCover: false }));
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(audioPath, future, future);
        const refreshed = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(refreshed[0].title, 'Without Cover');
        assert.equal(refreshed[0].thumb_path, '');
        assert.equal(refreshed[0].cover, '');
        assert.equal(fs.existsSync(previousThumbnail), false);

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.thumb_path, '');
        } finally {
            await library.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
