import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUDIO_EXTENSIONS,
    AUDIO_EXTENSION_VALUES,
    inferAudioMimeType,
    isAudioPath,
    normalizeAudioMetadata,
} from './audioMetadata.js';

test('오디오 확장자와 MIME 형식을 Readive 지원 범위에 맞춘다', () => {
    const expectedExtensions = [
        '.3gp', '.aac', '.aif', '.aiff', '.amr', '.caf', '.flac', '.m4a',
        '.m4b', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wave', '.webm',
    ];

    assert.deepEqual(AUDIO_EXTENSION_VALUES, expectedExtensions);
    assert.deepEqual([...AUDIO_EXTENSIONS], expectedExtensions);
    assert.equal(isAudioPath('/library/Book.M4B'), true);
    assert.equal(isAudioPath('file:///library/book.opus?token=value#part'), true);
    assert.equal(isAudioPath('/library/book.mp4'), false);
    assert.equal(inferAudioMimeType('/library/book.3gp'), 'audio/3gpp');
    assert.equal(inferAudioMimeType('/library/book.aiff'), 'audio/aiff');
    assert.equal(inferAudioMimeType('/library/book.m4b'), 'audio/mp4');
    assert.equal(inferAudioMimeType('/library/book.wave'), 'audio/wav');
    assert.equal(inferAudioMimeType('/library/book.unknown'), null);
});

test('music-metadata 결과를 Readive와 BookManager 필드로 정규화한다', () => {
    const metadata = normalizeAudioMetadata({
        common: {
            title: '  The\u0000  Book  ',
            artist: ' Narrator\u0000 ',
            artists: [' Narrator ', 'Author', 'Author'],
            album: '\tSeries  Name\n',
            albumartist: ' Studio ',
            composer: [' Composer One ', 'Composer\u0000 Two'],
            genre: [' Fiction ', 'Audio  Drama'],
            grouping: ' Saga ',
            publisher: [' Publisher '],
            comment: [{ text: ' Audiobook summary ' }],
            year: 2025,
            track: { no: 2, of: 12 },
            disk: { no: 1, of: 3 },
        },
        format: {
            duration: 3723.25,
            bitrate: 128000,
            sampleRate: 44100,
            codec: ' AAC LC ',
            container: ' MPEG-4 ',
            numberOfChannels: 2,
        },
    }, {
        filePath: '/library/The Book.m4b',
        fileSizeBytes: 59572000,
    });

    assert.equal(metadata.title, 'The Book');
    assert.equal(metadata.artist, 'Narrator');
    assert.deepEqual(metadata.artists, ['Narrator', 'Author']);
    assert.equal(metadata.album, 'Series Name');
    assert.equal(metadata.albumArtist, 'Studio');
    assert.equal(metadata.composer, 'Composer One, Composer Two');
    assert.deepEqual(metadata.composers, ['Composer One', 'Composer Two']);
    assert.equal(metadata.genre, 'Fiction, Audio Drama');
    assert.deepEqual(metadata.genres, ['Fiction', 'Audio Drama']);
    assert.equal(metadata.grouping, 'Saga');
    assert.equal(metadata.publisher, 'Publisher');
    assert.equal(metadata.description, 'Audiobook summary');
    assert.equal(metadata.year, 2025);
    assert.equal(metadata.trackNumber, 2);
    assert.equal(metadata.trackTotal, 12);
    assert.equal(metadata.discNumber, 1);
    assert.equal(metadata.discTotal, 3);
    assert.equal(metadata.durationSeconds, 3723.25);
    assert.equal(metadata.bitrateBitsPerSecond, 128000);
    assert.equal(metadata.sampleRateHz, 44100);
    assert.equal(metadata.codec, 'AAC LC');
    assert.equal(metadata.container, 'MPEG-4');
    assert.equal(metadata.channels, 2);
    assert.equal(metadata.fileSizeBytes, 59572000);
    assert.equal(metadata.mimeType, 'audio/mp4');
    assert.equal(metadata.book_type, 'audio');
    assert.equal(metadata.series, 'Saga');
    assert.equal(metadata.writer, 'Narrator');
    assert.equal(metadata.publisher, 'Publisher');
    assert.equal(metadata.description, 'Audiobook summary');
    assert.equal(metadata.volume, '1');
    assert.equal(metadata.chapter, '2');
    assert.equal(metadata.total_volume, '3');
    assert.equal(metadata.tags, 'Fiction, Audio Drama');
    assert.equal(metadata.date, '2025');
    assert.equal(metadata.format, 'Audiobook');
    assert.equal(metadata.has_metadata, true);
});

test('잘못된 숫자는 거부하고 기술 정보는 오디오 트랙에서 보완한다', () => {
    const metadata = normalizeAudioMetadata({
        common: {
            date: 'released 2021-04-02',
            track: { no: -1, of: '4.5' },
            disk: '2/5',
        },
        format: {
            duration: -20,
            bitrate: Number.POSITIVE_INFINITY,
            sampleRate: 0,
            numberOfChannels: 1.5,
            trackInfo: [{
                type: 'audio',
                codecName: ' Opus ',
                audio: {
                    channels: 1,
                    samplingFrequency: 48000,
                },
            }],
        },
    }, {
        filePath: '/library/book.opus',
        fileSizeBytes: -1,
    });

    assert.equal(metadata.year, 2021);
    assert.equal(metadata.trackNumber, null);
    assert.equal(metadata.trackTotal, null);
    assert.equal(metadata.discNumber, 2);
    assert.equal(metadata.discTotal, 5);
    assert.equal(metadata.durationSeconds, null);
    assert.equal(metadata.bitrateBitsPerSecond, null);
    assert.equal(metadata.sampleRateHz, 48000);
    assert.equal(metadata.codec, 'Opus');
    assert.equal(metadata.channels, 1);
    assert.equal(metadata.fileSizeBytes, null);
    assert.equal(metadata.has_metadata, true);
});

test('표지는 Buffer와 MIME으로 노출하고 includeCover 옵션을 지킨다', () => {
    const cover = Buffer.from('89504e470d0a1a0a01020304', 'hex');
    const parsed = {
        common: {
            picture: [{ data: cover, format: 'png', name: 'Cover' }],
        },
        format: {},
    };

    const included = normalizeAudioMetadata(parsed);
    assert.ok(Buffer.isBuffer(included.artwork.buffer));
    assert.notEqual(included.artwork.buffer, cover);
    assert.deepEqual(included.artwork.buffer, cover);
    assert.equal(included.artwork.mimeType, 'image/png');
    assert.equal(included.artworkBuffer, included.artwork.buffer);
    assert.equal(included.artworkMimeType, 'image/png');
    assert.equal(included.imageBuffer, included.artwork.buffer);
    assert.equal(included.imageName, 'cover.png');
    assert.equal(included.has_metadata, true);

    const excluded = normalizeAudioMetadata(parsed, { includeCover: false });
    assert.equal(excluded.artwork, null);
    assert.equal(excluded.artworkBuffer, null);
    assert.equal(excluded.artworkMimeType, null);
    assert.equal(excluded.imageBuffer, null);
    assert.equal(excluded.imageName, '');
    assert.equal(excluded.has_metadata, false);
});

test('비어 있거나 손상된 태그는 안정적인 빈 값으로 만든다', () => {
    const metadata = normalizeAudioMetadata({
        common: {
            title: '\u0000 \n ',
            artist: Number.NaN,
            artists: [null, '\t'],
            year: 'not-a-year',
            track: null,
            disk: {},
        },
        format: {
            codec: '\u0000',
            container: null,
        },
    });

    assert.equal(metadata.title, null);
    assert.equal(metadata.artist, null);
    assert.deepEqual(metadata.artists, []);
    assert.equal(metadata.year, null);
    assert.equal(metadata.trackNumber, null);
    assert.equal(metadata.discNumber, null);
    assert.equal(metadata.codec, null);
    assert.equal(metadata.container, null);
    assert.equal(metadata.mimeType, null);
    assert.equal(metadata.has_metadata, false);
    assert.equal(metadata.book_type, 'audio');
    assert.equal(metadata.series, '');
    assert.equal(metadata.writer, '');
});
