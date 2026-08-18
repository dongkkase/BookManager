import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tagLib from 'node-taglib-sharp';
import {
    AudioMetadataVerificationError,
    UnsupportedAudioMetadataFormatError,
    WRITABLE_AUDIO_EXTENSION_VALUES,
    isAudioMetadataWriteSupported,
    normalizeAudioMetadataEdits,
    verifyAudioMetadataWrite,
    writeAudioMetadataFile,
} from './audioMetadataWriter.js';

const {
    ByteVector,
    File: TagLibFile,
    Id3v2FrameClassType,
    Id3v2FrameIdentifier,
    Id3v2FrameIdentifiers,
    Id3v2TextInformationFrame,
    Id3v2UserTextInformationFrame,
    Picture,
    PictureType,
    TagTypes,
} = tagLib;

const OLD_FRONT_COVER = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100f5fe51b90000000049454e44ae426082',
    'hex',
);
const NEW_FRONT_COVER = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606460f80f0001060100a5f645400000000049454e44ae426082',
    'hex',
);
const BACK_COVER = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
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

function createMp3Fixture() {
    const frame = Buffer.alloc(288, 0x55);
    Buffer.from('ffe348c4000000034800000000', 'hex').copy(frame);
    Buffer.from('LAME4.0').copy(frame, 13);
    return Buffer.concat([frame, frame, frame, frame]);
}

function addId3UserText(id3, description, value) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description);
    frame.text = [value];
    id3.addFrame(frame);
}

function addId3NativeText(id3, identifier, value) {
    const frameIdentifier = new Id3v2FrameIdentifier(identifier, identifier, undefined);
    const frame = Id3v2TextInformationFrame.fromIdentifier(frameIdentifier);
    frame.text = [value];
    id3.addFrame(frame);
}

function seedEditableId3Aliases(filePath) {
    const musicFile = TagLibFile.createFromPath(filePath);
    try {
        const id3 = musicFile.getTag(TagTypes.Id3v2, false);
        addId3UserText(id3, 'Artists', '이전 참여 작가');
        addId3UserText(id3, 'DISCOGS_ARTISTS', '이전 디스코그스 작가');
        addId3UserText(id3, 'DISCOGS_ARTIST_NAME', '이전 디스코그스 작가명');
        addId3UserText(id3, 'DISCOGS_ALBUM_ARTISTS', '이전 앨범 아티스트');
        addId3UserText(id3, 'STYLE', '이전 스타일');
        addId3NativeText(id3, 'GRP1', '이전 시리즈');
        addId3NativeText(id3, 'TDES', '이전 설명');
        musicFile.save();
    } finally {
        musicFile.dispose();
    }
}

function picture(mimeType, data, coverType, description) {
    return Picture.fromFullData(
        ByteVector.fromByteArray(data),
        coverType,
        mimeType,
        description,
    );
}

async function createTaggedWave(filePath) {
    await fs.writeFile(filePath, createWaveFixture());
    const mimeType = path.extname(filePath).toLowerCase() === '.wave' ? 'audio/wav' : undefined;
    const musicFile = TagLibFile.createFromPath(filePath, mimeType);
    try {
        musicFile.tag.title = 'Old Title';
        musicFile.tag.performers = ['Old Artist'];
        musicFile.tag.grouping = 'Old Series';
        musicFile.tag.album = 'Old Album';
        musicFile.tag.albumArtists = ['Old Album Artist'];
        musicFile.tag.composers = ['Old Composer'];
        musicFile.tag.publisher = 'Old Publisher';
        musicFile.tag.comment = 'Old Summary';
        musicFile.tag.genres = ['Old Genre'];
        musicFile.tag.year = 2001;
        musicFile.tag.track = 1;
        musicFile.tag.trackCount = 4;
        musicFile.tag.disc = 1;
        musicFile.tag.discCount = 2;
        musicFile.tag.pictures = [
            picture('image/png', OLD_FRONT_COVER, PictureType.FrontCover, 'Old Front'),
            picture('image/jpeg', BACK_COVER, PictureType.BackCover, 'Keep Back'),
        ];
        musicFile.save();
    } finally {
        musicFile.dispose();
    }
}

test('쓰기 지원 확장자를 제한하고 나머지는 명확한 오류로 거부한다', async () => {
    assert.deepEqual(WRITABLE_AUDIO_EXTENSION_VALUES, [
        '.aac', '.aif', '.aiff', '.flac', '.m4a', '.m4b', '.mp3', '.oga',
        '.ogg', '.opus', '.wav', '.wave',
    ]);
    assert.equal(isAudioMetadataWriteSupported('/library/BOOK.M4B'), true);
    assert.equal(isAudioMetadataWriteSupported('/library/book.webm'), false);
    assert.equal(isAudioMetadataWriteSupported('/library/book.caf'), false);

    await assert.rejects(
        writeAudioMetadataFile('/library/book.webm', {}),
        error => error instanceof UnsupportedAudioMetadataFormatError
            && error.code === 'AUDIO_METADATA_UNSUPPORTED'
            && error.extension === '.webm',
    );
});

test('편집 필드를 태그 속성으로 정규화하고 기술 필드는 포함하지 않는다', () => {
    const normalized = normalizeAudioMetadataEdits({
        Title: '  제목  ',
        Writer: ' 작가 ',
        Album: ' 앨범 ',
        Series: ' 시리즈 ',
        AlbumArtist: ' 앨범 아티스트 ',
        Composer: ' 작곡가 ',
        Publisher: ' 출판사 ',
        Summary: ' 설명\n두 번째 줄 ',
        Genre: ' 소설; 드라마 ',
        Tags: '드라마, 완독',
        Year: '2026',
        TrackNumber: 3,
        TrackTotal: '12',
        DiscNumber: 1,
        DiscTotal: '2',
        DurationSeconds: 999,
        Bitrate: 1,
        SampleRate: 1,
        Codec: '수정 금지',
        Container: '수정 금지',
        Channels: 99,
        MimeType: 'text/plain',
    });

    assert.deepEqual(normalized, {
        title: '제목',
        artist: '작가',
        series: '시리즈',
        album: '앨범',
        albumArtist: '앨범 아티스트',
        composer: '작곡가',
        publisher: '출판사',
        comment: '설명\n두 번째 줄',
        genres: ['소설', '드라마', '완독'],
        year: 2026,
        trackNumber: 3,
        trackTotal: 12,
        discNumber: 1,
        discsTotal: 2,
    });
    assert.equal('DurationSeconds' in normalized, false);
    assert.throws(
        () => normalizeAudioMetadataEdits({ Year: '2026.5' }),
        /Year 항목은 1 이상 9999 이하의 정수여야 합니다/,
    );
    assert.throws(
        () => normalizeAudioMetadataEdits({ TrackNumber: 0 }),
        /TrackNumber 항목은 1 이상/,
    );
});

test('WAV 실제 파일의 태그와 앞표지를 수정하고 다른 그림은 보존한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-writer-'));
    const filePath = path.join(tempDir, 'audiobook.wav');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await createTaggedWave(filePath);

    const result = await writeAudioMetadataFile(filePath, {
        Title: '새 제목',
        Writer: '새 작가',
        Album: '새 앨범',
        Series: '사용하지 않을 시리즈',
        AlbumArtist: '새 앨범 아티스트',
        Composer: '새 작곡가',
        Publisher: '새 출판사',
        Summary: '새 설명\n두 번째 줄',
        Genre: '오디오 드라마; 소설',
        Tags: '소설, 완독',
        Year: 2026,
        TrackNumber: 3,
        TrackTotal: 12,
        DiscNumber: 2,
        DiscTotal: 4,
        DurationSeconds: 999,
        Bitrate: 1,
        SampleRate: 1,
        Codec: '수정하지 않음',
        Container: '수정하지 않음',
        Channels: 99,
        MimeType: 'text/plain',
    }, {
        cover: {
            buffer: NEW_FRONT_COVER,
            mimeType: 'image/png',
        },
    });

    assert.equal(result.metadata.title, '새 제목');
    assert.equal(result.metadata.artist, '새 작가');
    assert.equal(result.metadata.grouping, '사용하지 않을 시리즈');
    assert.equal(result.metadata.series, '사용하지 않을 시리즈');
    assert.equal(result.metadata.album, '새 앨범');
    assert.equal(result.metadata.albumArtist, '새 앨범 아티스트');
    assert.equal(result.metadata.composer, '새 작곡가');
    assert.equal(result.metadata.publisher, '새 출판사');
    assert.equal(result.metadata.description, '새 설명 두 번째 줄');
    assert.equal(result.metadata.genre, '오디오 드라마, 소설, 완독');
    assert.equal(result.metadata.year, 2026);
    assert.equal(result.metadata.trackNumber, 3);
    assert.equal(result.metadata.trackTotal, 12);
    assert.equal(result.metadata.discNumber, 2);
    assert.equal(result.metadata.discTotal, 4);
    assert.equal(result.metadata.durationSeconds, 1);
    assert.equal(result.metadata.sampleRateHz, 8000);
    assert.equal(result.metadata.channels, 1);
    assert.deepEqual(result.metadata.artworkBuffer, NEW_FRONT_COVER);
    assert.equal(result.pictureCount, 2);

    const written = TagLibFile.createFromPath(filePath, 'audio/wav');
    try {
        assert.equal(written.tag.grouping, '사용하지 않을 시리즈');
        assert.equal(written.tag.publisher, '새 출판사');
        assert.equal(written.tag.comment, '새 설명\n두 번째 줄');
        assert.deepEqual(written.tag.genres, ['오디오 드라마', '소설', '완독']);
        assert.equal(written.tag.pictures?.length, 2);
        const front = written.tag.pictures.find(item => item.type === PictureType.FrontCover);
        const back = written.tag.pictures.find(item => item.type === PictureType.BackCover);
        assert.deepEqual(Buffer.from(front.data.toByteArray()), NEW_FRONT_COVER);
        assert.equal(front.description, 'Old Front');
        assert.deepEqual(Buffer.from(back.data.toByteArray()), BACK_COVER);
        assert.equal(back.description, 'Keep Back');
    } finally {
        written.dispose();
    }
});

test('M4B 실제 파일에서 시리즈와 출판사, 설명, 장르 및 표지를 왕복한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-m4b-'));
    const filePath = path.join(tempDir, 'audiobook.m4b');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await fs.writeFile(filePath, Buffer.from(M4B_FIXTURE_BASE64, 'base64'));

    const result = await writeAudioMetadataFile(filePath, {
        Series: '눈물을 마시는 새',
        Publisher: '황금가지',
        Summary: '구출대 오디오북\n두 번째 줄',
        Genre: '판타지',
        Tags: '완독, 한국 소설',
    }, {
        cover: {
            buffer: NEW_FRONT_COVER,
            mimeType: 'image/png',
        },
    });

    assert.equal(result.metadata.grouping, '눈물을 마시는 새');
    assert.equal(result.metadata.series, '눈물을 마시는 새');
    assert.equal(result.metadata.publisher, '황금가지');
    assert.equal(result.metadata.description, '구출대 오디오북 두 번째 줄');
    assert.equal(result.metadata.genre, '판타지, 완독, 한국 소설');
    assert.deepEqual(result.metadata.genres, ['판타지', '완독', '한국 소설']);
    assert.deepEqual(result.metadata.artworkBuffer, NEW_FRONT_COVER);
    assert.equal(result.pictureCount, 1);

    const written = TagLibFile.createFromPath(filePath);
    try {
        assert.equal(written.tag.grouping, '눈물을 마시는 새');
        assert.equal(written.tag.publisher, '황금가지');
        assert.equal(written.tag.comment, '구출대 오디오북\n두 번째 줄');
        assert.deepEqual(written.tag.genres, ['판타지', '완독', '한국 소설']);
        assert.equal(written.tag.pictures?.length, 1);
        const front = written.tag.pictures[0];
        assert.equal(front.type, PictureType.FrontCover);
        assert.deepEqual(Buffer.from(front.data.toByteArray()), NEW_FRONT_COVER);
    } finally {
        written.dispose();
    }
});

test('빈 편집값은 실제 태그를 제거하고 표지는 선택하지 않으면 유지한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-clear-'));
    const filePath = path.join(tempDir, 'audiobook.wave');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await createTaggedWave(filePath);

    const result = await writeAudioMetadataFile(filePath, {
        Title: '',
        Writer: null,
        Album: '   ',
        Series: '',
        AlbumArtist: undefined,
        Composer: '',
        Publisher: null,
        Summary: '',
        Genre: '',
        Tags: '',
        Year: '',
        TrackNumber: null,
        TrackTotal: '',
        DiscNumber: undefined,
        DiscTotal: '',
    });

    assert.equal(result.metadata.title, null);
    assert.equal(result.metadata.artist, null);
    assert.equal(result.metadata.album, null);
    assert.equal(result.metadata.year, null);
    assert.equal(result.metadata.trackNumber, null);
    assert.equal(result.metadata.discNumber, null);
    assert.deepEqual(result.metadata.artworkBuffer, OLD_FRONT_COVER);

    const written = TagLibFile.createFromPath(filePath, 'audio/wav');
    try {
        assert.equal(written.tag.title, undefined);
        assert.equal(written.tag.grouping, undefined);
        assert.equal(written.tag.publisher, undefined);
        assert.equal(written.tag.comment, undefined);
        assert.equal(written.tag.pictures?.length, 2);
    } finally {
        written.dispose();
    }
});

test('MP3 출판사와 연도를 비우면 ID3 별칭 태그도 실제 파일에서 제거한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-mp3-alias-'));
    const filePath = path.join(tempDir, 'audiobook.mp3');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await fs.writeFile(filePath, createMp3Fixture());

    const seeded = TagLibFile.createFromPath(filePath);
    try {
        const id3 = seeded.getTag(TagTypes.Id3v2, false);
        id3.version = 3;
        const label = Id3v2UserTextInformationFrame.fromDescription('DISCOGS_LABEL');
        label.text = ['이전 레이블'];
        id3.addFrame(label);
        const originalYear = Id3v2TextInformationFrame.fromIdentifier(
            Id3v2FrameIdentifiers.TDOR,
        );
        originalYear.text = ['1999'];
        id3.addFrame(originalYear);
        seeded.save();
    } finally {
        seeded.dispose();
    }

    const result = await writeAudioMetadataFile(filePath, {
        Publisher: '',
        Year: '',
    });

    assert.equal(result.metadata.publisher, '');
    assert.equal(result.metadata.year, null);

    const written = TagLibFile.createFromPath(filePath);
    try {
        const id3 = written.getTag(TagTypes.Id3v2, false);
        const userTextFrames = id3.getFramesByClassType(
            Id3v2FrameClassType.UserTextInformationFrame,
        );
        assert.equal(
            userTextFrames.some(frame => frame.description === 'DISCOGS_LABEL'),
            false,
        );
        assert.equal(id3.getTextAsString(Id3v2FrameIdentifiers.TDOR), undefined);
        assert.equal(id3.getTextAsString(Id3v2FrameIdentifiers.TDRC), undefined);
        assert.equal(id3.getTextAsString(Id3v2FrameIdentifiers.TYER), undefined);
    } finally {
        written.dispose();
    }
});

test('MP3 편집 필드를 저장하고 비우면 충돌하는 ID3 별칭을 실제 파일에서 제거한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-mp3-edit-alias-'));
    const filePath = path.join(tempDir, 'audiobook.mp3');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await fs.writeFile(filePath, createMp3Fixture());
    seedEditableId3Aliases(filePath);

    const saved = await writeAudioMetadataFile(filePath, {
        Writer: '새 작가',
        Series: '새 시리즈',
        AlbumArtist: '새 앨범 아티스트',
        Summary: '새 설명',
        Genre: '새 장르',
    });

    assert.equal(saved.metadata.artist, '새 작가');
    assert.equal(saved.metadata.grouping, '새 시리즈');
    assert.equal(saved.metadata.albumArtist, '새 앨범 아티스트');
    assert.equal(saved.metadata.description, '새 설명');
    assert.equal(saved.metadata.genre, '새 장르');

    const aliasDescriptions = new Set([
        'ARTISTS',
        'DISCOGS_ARTISTS',
        'DISCOGS_ARTIST_NAME',
        'DISCOGS_ALBUM_ARTISTS',
        'STYLE',
    ]);
    const aliasFrameIds = new Set(['GRP1', 'TDES']);
    const written = TagLibFile.createFromPath(filePath);
    try {
        const id3 = written.getTag(TagTypes.Id3v2, false);
        assert.equal(
            id3.getFramesByClassType(Id3v2FrameClassType.UserTextInformationFrame)
                .some(frame => aliasDescriptions.has(frame.description.toUpperCase())),
            false,
        );
        assert.equal(
            id3.frames.some(frame => aliasFrameIds.has(frame.frameId.toString())),
            false,
        );
        assert.deepEqual(written.tag.performers, ['새 작가']);
        assert.equal(written.tag.grouping, '새 시리즈');
        assert.deepEqual(written.tag.albumArtists, ['새 앨범 아티스트']);
        assert.equal(written.tag.description, '새 설명');
        assert.deepEqual(written.tag.genres, ['새 장르']);
    } finally {
        written.dispose();
    }

    seedEditableId3Aliases(filePath);
    const cleared = await writeAudioMetadataFile(filePath, {
        Writer: '',
        Series: '',
        AlbumArtist: '',
        Summary: '',
        Genre: '',
        Tags: '',
    });

    assert.equal(cleared.metadata.artist, null);
    assert.equal(cleared.metadata.grouping, null);
    assert.equal(cleared.metadata.albumArtist, null);
    assert.equal(cleared.metadata.description, '');
    assert.equal(cleared.metadata.genre, null);

    const emptied = TagLibFile.createFromPath(filePath);
    try {
        const id3 = emptied.getTag(TagTypes.Id3v2, false);
        assert.equal(
            id3.getFramesByClassType(Id3v2FrameClassType.UserTextInformationFrame)
                .some(frame => aliasDescriptions.has(frame.description.toUpperCase())),
            false,
        );
        assert.equal(
            id3.frames.some(frame => aliasFrameIds.has(frame.frameId.toString())),
            false,
        );
        assert.deepEqual(emptied.tag.performers, []);
        assert.equal(emptied.tag.grouping, undefined);
        assert.deepEqual(emptied.tag.albumArtists, []);
        assert.equal(emptied.tag.description, undefined);
        assert.deepEqual(emptied.tag.genres, []);
    } finally {
        emptied.dispose();
    }
});

test('검증 helper는 실제 태그 불일치를 보고한다', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-audio-verify-'));
    const filePath = path.join(tempDir, 'audiobook.wav');
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    await createTaggedWave(filePath);

    await assert.rejects(
        verifyAudioMetadataWrite(filePath, {
            Title: '기대 제목',
            Writer: 'Old Artist',
            Series: 'Old Series',
            Album: 'Old Album',
            AlbumArtist: 'Old Album Artist',
            Composer: 'Old Composer',
            Publisher: 'Old Publisher',
            Summary: 'Old Summary',
            Genre: 'Old Genre',
            Year: 2001,
            TrackNumber: 1,
            TrackTotal: 4,
            DiscNumber: 1,
            DiscTotal: 2,
        }),
        error => error instanceof AudioMetadataVerificationError
            && error.code === 'AUDIO_METADATA_VERIFICATION_FAILED'
            && error.mismatches.some(message => message.includes('title')),
    );
});
