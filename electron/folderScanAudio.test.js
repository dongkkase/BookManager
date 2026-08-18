import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readAudioMetadata } from './audioMetadata.js';
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

test('오디오 메타데이터 편집은 실제 파일 태그를 수정하고 기술 정보를 보존한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-metadata-file-'));
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(root, 'Edited Audio.wav');
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
            Title: 'Edited Title',
            Series: 'Edited Series',
            Album: 'Edited Album',
            Writer: 'Edited Artist',
            AlbumArtist: 'Edited Album Artist',
            Composer: 'Edited Composer',
            Publisher: 'Edited Publisher',
            Summary: 'Edited Summary',
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
            backup_on: true,
            dbPath,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.notDeepEqual(fs.readFileSync(audioPath), original);
        assert.deepEqual(fs.readFileSync(path.join(root, 'bak', path.basename(audioPath))), original);

        const embedded = await readAudioMetadata(audioPath, { includeCover: false });
        assert.equal(embedded.title, 'Edited Title');
        assert.equal(embedded.grouping, 'Edited Series');
        assert.equal(embedded.series, 'Edited Series');
        assert.equal(embedded.album, 'Edited Album');
        assert.equal(embedded.artist, 'Edited Artist');
        assert.equal(embedded.albumArtist, 'Edited Album Artist');
        assert.equal(embedded.composer, 'Edited Composer');
        assert.equal(embedded.publisher, 'Edited Publisher');
        assert.equal(embedded.description, 'Edited Summary');
        assert.equal(embedded.genre, 'Mystery, Narrated, Unabridged');
        assert.deepEqual(embedded.genres, ['Mystery', 'Narrated', 'Unabridged']);
        assert.equal(embedded.year, 2026);
        assert.equal(embedded.trackNumber, 4);
        assert.equal(embedded.trackTotal, 12);
        assert.equal(embedded.discNumber, 2);
        assert.equal(embedded.discTotal, 3);
        assert.equal(embedded.durationSeconds, 1);
        assert.equal(embedded.bitrateBitsPerSecond, 128000);
        assert.equal(embedded.sampleRateHz, 8000);
        assert.equal(embedded.codec, 'PCM');
        assert.equal(embedded.container, 'WAVE');
        assert.equal(embedded.channels, 1);
        assert.equal(embedded.mimeType, 'audio/wav');

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.title, 'Edited Title');
            assert.equal(cached.series, 'Edited Series');
            assert.equal(Number(cached.volume), 2);
            assert.equal(Number(cached.number), 4);
            assert.equal(Number(cached.volume_count), 3);
            assert.equal(cached.album, 'Edited Album');
            assert.equal(cached.writer, 'Edited Artist');
            assert.equal(cached.album_artist, 'Edited Album Artist');
            assert.equal(cached.composer, 'Edited Composer');
            assert.equal(cached.publisher, 'Edited Publisher');
            assert.equal(cached.summary, 'Edited Summary');
            assert.equal(cached.genre, 'Mystery, Narrated, Unabridged');
            assert.equal(cached.tags, 'Mystery, Narrated, Unabridged');
            assert.equal(cached.publish_date, '2026');
            assert.equal(cached.duration_seconds, 1);
            assert.equal(cached.bitrate, 128000);
            assert.equal(cached.sample_rate, 8000);
            assert.equal(cached.codec, 'PCM');
            assert.equal(cached.container, 'WAVE');
            assert.equal(cached.channels, 1);
            assert.equal(Number(cached.track_number), 4);
            assert.equal(Number(cached.track_total), 12);
            assert.equal(Number(cached.disc_number), 2);
            assert.equal(Number(cached.disc_total), 3);
            assert.equal(cached.mime_type, 'audio/wav');
            assert.equal(cached.has_metadata, 1);
            assert.equal(cached.metadata_override, 0);
        } finally {
            await library.close();
        }

        const forceRefreshed = await scanFolder(root, { dbPath, force: true });
        const forceRefreshedAudio = forceRefreshed.find(file => file.path === audioPath);
        assert.ok(forceRefreshedAudio);
        assert.equal(forceRefreshedAudio.title, 'Edited Title');
        assert.equal(forceRefreshedAudio.series, 'Edited Series');
        assert.equal(forceRefreshedAudio.album, 'Edited Album');
        assert.equal(forceRefreshedAudio.writer, 'Edited Artist');
        assert.equal(forceRefreshedAudio.albumArtist, 'Edited Album Artist');
        assert.equal(forceRefreshedAudio.composer, 'Edited Composer');
        assert.equal(forceRefreshedAudio.publisher, 'Edited Publisher');
        assert.equal(forceRefreshedAudio.description, 'Edited Summary');
        assert.equal(forceRefreshedAudio.genre, 'Mystery, Narrated, Unabridged');
        assert.equal(forceRefreshedAudio.tags, 'Mystery, Narrated, Unabridged');
        assert.equal(Number(forceRefreshedAudio.volume), 2);
        assert.equal(Number(forceRefreshedAudio.chapter), 4);
        assert.equal(Number(forceRefreshedAudio.total_volume), 3);
        assert.equal(forceRefreshedAudio.trackNumber, 4);
        assert.equal(forceRefreshedAudio.trackTotal, 12);
        assert.equal(forceRefreshedAudio.discNumber, 2);
        assert.equal(forceRefreshedAudio.discTotal, 3);
        assert.equal(forceRefreshedAudio.durationSeconds, 1);
        assert.equal(forceRefreshedAudio.bitrateBitsPerSecond, 128000);
        assert.equal(forceRefreshedAudio.sampleRateHz, 8000);
        assert.equal(forceRefreshedAudio.codec, 'PCM');
        assert.equal(forceRefreshedAudio.container, 'WAVE');
        assert.equal(forceRefreshedAudio.channels, 1);
        assert.equal(forceRefreshedAudio.mimeType, 'audio/wav');
        assert.equal(forceRefreshedAudio.has_metadata, true);

        const refreshedLibrary = new LibraryDB({ dbPath });
        try {
            const refreshedCached = await refreshedLibrary.getFileInfo(audioPath);
            assert.equal(refreshedCached.title, 'Edited Title');
            assert.equal(refreshedCached.writer, 'Edited Artist');
            assert.equal(refreshedCached.album, 'Edited Album');
            assert.equal(refreshedCached.has_metadata, 1);
            assert.equal(refreshedCached.metadata_override, 0);
        } finally {
            await refreshedLibrary.close();
        }

        const reanalyzed = await analyzeMetadataInputs([audioPath], {
            dbPath,
            includeCovers: false,
        });
        const metadata = reanalyzed.items[0].metadata;
        assert.equal(metadata.Title, 'Edited Title');
        assert.equal(metadata.Series, 'Edited Series');
        assert.equal(metadata.Album, 'Edited Album');
        assert.equal(metadata.Writer, 'Edited Artist');
        assert.equal(metadata.AlbumArtist, 'Edited Album Artist');
        assert.equal(metadata.Composer, 'Edited Composer');
        assert.equal(metadata.Publisher, 'Edited Publisher');
        assert.equal(metadata.Summary, 'Edited Summary');
        assert.equal(metadata.Genre, 'Mystery, Narrated, Unabridged');
        assert.equal(metadata.Tags, 'Mystery, Narrated, Unabridged');
        assert.equal(Number(metadata.Year), 2026);
        assert.equal(Number(metadata.TrackNumber), 4);
        assert.equal(Number(metadata.TrackTotal), 12);
        assert.equal(Number(metadata.DiscNumber), 2);
        assert.equal(Number(metadata.DiscTotal), 3);
        assert.equal(metadata.DurationSeconds, 1);
        assert.equal(metadata.Bitrate, 128000);
        assert.equal(metadata.SampleRate, 8000);
        assert.equal(metadata.Codec, 'PCM');
        assert.equal(metadata.Container, 'WAVE');
        assert.equal(metadata.Channels, 1);
        assert.equal(metadata.MimeType, 'audio/wav');
        assert.equal(metadata.Format, 'Audiobook');

        const latest = await loadLatestSeriesMetadata({
            title: 'Edited Title',
            bookType: 'audio',
        }, { dbPath });
        assert.ok(latest);
        assert.equal(latest.sourcePath, audioPath);
        assert.equal(latest.metadata.Title, 'Edited Title');
        assert.equal(latest.metadata.Writer, 'Edited Artist');
        assert.equal(latest.metadata.Album, 'Edited Album');

        const renamedPath = path.join(root, 'Renamed Edited Audio.wav');
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
        assert.equal(renamedAudio.title, 'Edited Title');
        assert.equal(renamedAudio.writer, 'Edited Artist');
        assert.equal(renamedAudio.album, 'Edited Album');
        assert.equal(renamedAudio.has_metadata, true);

        const renamedLibrary = new LibraryDB({ dbPath });
        try {
            const renamedRecord = await renamedLibrary.getFileInfo(renamedPath);
            assert.equal(renamedRecord.title, 'Edited Title');
            assert.equal(renamedRecord.writer, 'Edited Artist');
            assert.equal(renamedRecord.metadata_override, 0);
        } finally {
            await renamedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('macOS NFC 메타데이터 저장은 NFD 폴더 스캔 행을 갱신하고 강제 스캔에서도 유지한다', {
    skip: process.platform !== 'darwin',
}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-unicode-save-'));
    const dbPath = path.join(root, 'library.db');
    const nfdName = '눈물을 마시는 새 1장.wav'.normalize('NFD');
    const nfcName = nfdName.normalize('NFC');
    const nfdPath = path.join(root, nfdName);
    const nfcPath = path.join(root, nfcName);

    try {
        fs.writeFileSync(nfdPath, createWaveFixture({
            title: 'Embedded Title',
            artist: 'Embedded Artist',
        }));
        const initial = await scanFolder(root, { dbPath, skipCoverExtraction: true });
        assert.equal(initial[0].title, 'Embedded Title');

        const analyzed = await analyzeMetadataInputs([nfcPath], {
            dbPath,
            includeCovers: false,
        });
        analyzed.items[0].metadata = {
            ...analyzed.items[0].metadata,
            Title: '사용자 수정 제목',
            Series: '사용자 수정 시리즈',
            Album: '사용자 수정 앨범',
            Writer: '사용자 수정 작가',
            Summary: '사용자 수정 설명',
        };
        const saved = await saveMetadataItems(analyzed.items, { dbPath });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const refreshed = await scanFolder(root, {
            dbPath,
            force: true,
            skipCoverExtraction: true,
        });
        assert.equal(refreshed[0].path, nfdPath);
        assert.equal(refreshed[0].title, '사용자 수정 제목');
        assert.equal(refreshed[0].series, '사용자 수정 시리즈');
        assert.equal(refreshed[0].album, '사용자 수정 앨범');
        assert.equal(refreshed[0].writer, '사용자 수정 작가');
        assert.equal(refreshed[0].description, '사용자 수정 설명');

        const library = new LibraryDB({ dbPath });
        try {
            const rows = library.getConnection().prepare('SELECT path, title, metadata_override FROM files').all();
            assert.equal(rows.length, 1);
            assert.equal(rows[0].path, nfdPath);
            assert.equal(rows[0].title, '사용자 수정 제목');
            assert.equal(rows[0].metadata_override, 0);
            assert.equal((await library.getFileInfo(nfcPath)).title, '사용자 수정 제목');
        } finally {
            await library.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('오디오 표지 교체는 실제 파일에 임베드되고 기존 override reset 후에도 유지된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-audio-cover-embedded-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const audioPath = path.join(libraryDir, 'Covered Book.mp3');
    const replacementPath = path.join(root, 'replacement.png');
    const replacementCover = Buffer.concat([EMBEDDED_COVER, Buffer.from('replacement-cover')]);
    const externalOverridePath = path.join(thumbnailDir, 'audio-cover-override-legacy.png');
    const externalOverrideCover = Buffer.concat([EMBEDDED_COVER, Buffer.from('legacy-external-cover')]);

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
        assert.notDeepEqual(fs.readFileSync(audioPath), originalAudio);

        const library = new LibraryDB({ dbPath });
        try {
            const cached = await library.getFileInfo(audioPath);
            assert.equal(cached.cover_override_path, '');
            assert.equal(cached.metadata_override, 0);
        } finally {
            await library.close();
        }

        const embeddedAfterReplacement = await readAudioMetadata(audioPath, { includeCover: true });
        assert.deepEqual(embeddedAfterReplacement.artworkBuffer, replacementCover);
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, { dbPath })), replacementCover);
        const loadedEmbedded = await loadMetadataCover(audioPath, {
            dbPath,
            ignoreAudioCoverOverride: true,
        });
        assert.deepEqual(dataUrlBuffer(loadedEmbedded), replacementCover);

        const reanalyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(reanalyzed.items[0].audioCoverOverride, false);
        assert.equal(reanalyzed.items[0].coverOverridePath, '');
        assert.deepEqual(dataUrlBuffer(reanalyzed.items[0].coverDataUrl), replacementCover);

        const regularScan = await scanFolder(libraryDir, { dbPath, thumbnailDir });
        assert.equal(regularScan[0].cover_override_path, '');
        const forceScan = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(forceScan[0].cover_override_path, '');
        assert.ok(forceScan[0].thumb_path);
        assert.deepEqual(fs.readFileSync(forceScan[0].thumb_path), replacementCover);

        const renamedPath = path.join(libraryDir, 'Renamed Covered Book.mp3');
        fs.renameSync(audioPath, renamedPath);
        const renameLibrary = new LibraryDB({ dbPath });
        try {
            await renameLibrary.applyLibraryMoveIndexChanges({
                fileInfoMoves: [{ src: audioPath, dest: renamedPath, recursive: false }],
            });
            assert.equal((await renameLibrary.getFileInfo(renamedPath)).cover_override_path, '');
        } finally {
            await renameLibrary.close();
        }
        const renamedScan = await scanFolder(libraryDir, { dbPath, thumbnailDir, force: true });
        assert.equal(renamedScan[0].cover_override_path, '');
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(renamedPath, { dbPath })), replacementCover);

        fs.renameSync(renamedPath, audioPath);
        const undoLibrary = new LibraryDB({ dbPath });
        try {
            await undoLibrary.applyLibraryMoveIndexChanges({
                fileInfoMoves: [{ src: renamedPath, dest: audioPath, recursive: false }],
            });
            assert.equal((await undoLibrary.getFileInfo(audioPath)).cover_override_path, '');
        } finally {
            await undoLibrary.close();
        }

        fs.mkdirSync(thumbnailDir, { recursive: true });
        fs.writeFileSync(externalOverridePath, externalOverrideCover);
        const externalOverrideLibrary = new LibraryDB({ dbPath });
        try {
            const cached = await externalOverrideLibrary.getFileInfo(audioPath);
            await externalOverrideLibrary.upsertFileInfo({
                ...cached,
                cover_override_path: externalOverridePath,
                thumb_path: externalOverridePath,
            });
        } finally {
            await externalOverrideLibrary.close();
        }
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, { dbPath })), externalOverrideCover);
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, {
            dbPath,
            ignoreAudioCoverOverride: true,
        })), replacementCover);

        const resetAnalysis = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(resetAnalysis.items[0].audioCoverOverride, true);
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
        assert.notDeepEqual(fs.readFileSync(audioPath), originalAudio);
        assert.equal(fs.existsSync(externalOverridePath), false);

        const resetLibrary = new LibraryDB({ dbPath });
        try {
            const cached = await resetLibrary.getFileInfo(audioPath);
            assert.equal(cached.cover_override_path, '');
            assert.ok(cached.thumb_path);
            assert.notEqual(cached.thumb_path, externalOverridePath);
            assert.equal(fs.existsSync(cached.thumb_path), true);
        } finally {
            await resetLibrary.close();
        }
        assert.deepEqual(dataUrlBuffer(await loadMetadataCover(audioPath, { dbPath })), replacementCover);
        const resetAnalyzed = await analyzeMetadataInputs([audioPath], { dbPath });
        assert.equal(resetAnalyzed.items[0].audioCoverOverride, false);
        assert.deepEqual(dataUrlBuffer(resetAnalyzed.items[0].coverDataUrl), replacementCover);
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
