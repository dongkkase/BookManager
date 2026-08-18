import path from 'node:path';
import { Worker } from 'node:worker_threads';
import tagLib from 'node-taglib-sharp';
import { readAudioMetadata } from './audioMetadata.js';

const {
    ByteVector,
    File: TagLibFile,
    Id3v2FrameClassType,
    Id3v2FrameIdentifiers,
    Picture,
    PictureType,
    StringType,
    TagTypes,
} = tagLib;

export const WRITABLE_AUDIO_EXTENSION_VALUES = Object.freeze([
    '.aac',
    '.aif',
    '.aiff',
    '.flac',
    '.m4a',
    '.m4b',
    '.mp3',
    '.oga',
    '.ogg',
    '.opus',
    '.wav',
    '.wave',
]);

export const WRITABLE_AUDIO_EXTENSIONS = new Set(WRITABLE_AUDIO_EXTENSION_VALUES);

const UINT32_MAX = 0xffffffff;
const PUBLISHER_ALIAS_KEYS = Object.freeze([
    'LABEL',
    'PUBLISHER',
    'DISCOGS_LABEL',
]);
const ARTIST_ALIAS_KEYS = Object.freeze([
    'ARTISTS',
    'DISCOGS_ARTISTS',
    'DISCOGS_ARTIST_NAME',
]);
const ALBUM_ARTIST_ALIAS_KEYS = Object.freeze([
    'DISCOGS_ALBUM_ARTISTS',
]);
const GENRE_ALIAS_KEYS = Object.freeze([
    'STYLE',
]);
const YEAR_ALIAS_KEYS = Object.freeze([
    'ORIGINALYEAR',
    'ORIGINALDATE',
    'RELEASEDATE',
    'DISCOGS_DATE',
    'DISCOGS_RELEASED',
]);
const TOTAL_ALIAS_KEYS = Object.freeze([
    'TOTALTRACKS',
    'TOTALDISCS',
]);
const CONFLICTING_METADATA_ALIAS_KEYS = Object.freeze([
    ...PUBLISHER_ALIAS_KEYS,
    ...ARTIST_ALIAS_KEYS,
    ...ALBUM_ARTIST_ALIAS_KEYS,
    ...GENRE_ALIAS_KEYS,
    ...YEAR_ALIAS_KEYS,
    ...TOTAL_ALIAS_KEYS,
]);
const APPLE_METADATA_ALIAS_KEYS = Object.freeze([
    'LABEL',
    'DISCOGS_LABEL',
    ...ARTIST_ALIAS_KEYS,
    'Band',
    ...ALBUM_ARTIST_ALIAS_KEYS,
    ...GENRE_ALIAS_KEYS,
    ...YEAR_ALIAS_KEYS,
    ...TOTAL_ALIAS_KEYS,
]);
const ID3_NATIVE_ALIAS_FRAME_IDS = new Set(['GRP1', 'TDES']);

function extensionFromPath(filePath = '') {
    return path.extname(String(filePath ?? '')).toLowerCase();
}

function displayExtension(filePath = '') {
    return extensionFromPath(filePath) || '확장자 없음';
}

export class UnsupportedAudioMetadataFormatError extends Error {
    constructor(filePath) {
        const extension = displayExtension(filePath);
        super(`오디오 메타데이터 쓰기를 지원하지 않는 형식입니다: ${extension}`);
        this.name = 'UnsupportedAudioMetadataFormatError';
        this.code = 'AUDIO_METADATA_UNSUPPORTED';
        this.extension = extensionFromPath(filePath);
    }
}

export class AudioMetadataVerificationError extends Error {
    constructor(mismatches) {
        super(`오디오 메타데이터 저장 검증에 실패했습니다: ${mismatches.join(', ')}`);
        this.name = 'AudioMetadataVerificationError';
        this.code = 'AUDIO_METADATA_VERIFICATION_FAILED';
        this.mismatches = mismatches;
    }
}

export function isAudioMetadataWriteSupported(filePath = '') {
    return WRITABLE_AUDIO_EXTENSIONS.has(extensionFromPath(filePath));
}

function requireWritableAudioPath(filePath) {
    if (!isAudioMetadataWriteSupported(filePath)) {
        throw new UnsupportedAudioMetadataFormatError(filePath);
    }
}

function openTagLibFile(filePath) {
    const mimeType = extensionFromPath(filePath) === '.wave' ? 'audio/wav' : undefined;
    return TagLibFile.createFromPath(filePath, mimeType);
}

function normalizeNullableText(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized || null;
}

function normalizeTextList(...values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
        const parts = Array.isArray(value) ? value : [value];
        for (const part of parts) {
            for (const candidate of String(part ?? '').split(/[;,]/)) {
                const normalized = normalizeNullableText(candidate);
                if (!normalized || seen.has(normalized)) continue;
                seen.add(normalized);
                result.push(normalized);
            }
        }
    }
    return result;
}

function normalizeNullableInteger(value, fieldName, maximum = UINT32_MAX) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;

    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
        throw new TypeError(`${fieldName} 항목은 1 이상 ${maximum} 이하의 정수여야 합니다.`);
    }
    return normalized;
}

export function normalizeAudioMetadataEdits(metadata = {}) {
    return Object.freeze({
        title: normalizeNullableText(metadata.Title),
        artist: normalizeNullableText(metadata.Writer),
        series: normalizeNullableText(metadata.Series),
        album: normalizeNullableText(metadata.Album),
        albumArtist: normalizeNullableText(metadata.AlbumArtist),
        composer: normalizeNullableText(metadata.Composer),
        publisher: normalizeNullableText(metadata.Publisher),
        comment: normalizeNullableText(metadata.Summary),
        genres: Object.freeze(normalizeTextList(metadata.Genre, metadata.Tags)),
        year: normalizeNullableInteger(metadata.Year, 'Year', 9999),
        trackNumber: normalizeNullableInteger(metadata.TrackNumber, 'TrackNumber'),
        trackTotal: normalizeNullableInteger(metadata.TrackTotal, 'TrackTotal'),
        discNumber: normalizeNullableInteger(metadata.DiscNumber, 'DiscNumber'),
        discsTotal: normalizeNullableInteger(metadata.DiscTotal, 'DiscTotal'),
    });
}

function normalizeCover(cover) {
    if (cover === null || cover === undefined) return null;
    const source = cover.buffer;
    if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) {
        throw new TypeError('오디오북 표지는 Buffer 또는 Uint8Array 형식이어야 합니다.');
    }

    const buffer = Buffer.from(source);
    if (buffer.length === 0) {
        throw new TypeError('빈 오디오북 표지는 저장할 수 없습니다.');
    }

    const mimeType = normalizeNullableText(cover.mimeType)?.toLowerCase();
    if (!mimeType?.startsWith('image/')) {
        throw new TypeError('오디오북 표지 MIME 형식은 image/* 형식이어야 합니다.');
    }

    return {
        buffer,
        mimeType,
        description: normalizeNullableText(cover.description),
    };
}

function normalizeAliasKey(value) {
    return String(value ?? '').trim().replace(/[\s_-]+/g, '').toUpperCase();
}

function removeId3UserTextAliases(tag, aliases) {
    const normalizedAliases = new Set(aliases.map(normalizeAliasKey));
    const frames = tag.getFramesByClassType(Id3v2FrameClassType.UserTextInformationFrame);
    for (const frame of frames) {
        if (normalizedAliases.has(normalizeAliasKey(frame.description))) {
            tag.removeFrame(frame);
        }
    }
}

function removeId3NativeAliases(tag) {
    for (const frame of [...tag.frames]) {
        if (ID3_NATIVE_ALIAS_FRAME_IDS.has(frame.frameId?.toString())) {
            tag.removeFrame(frame);
        }
    }
}

function removeConflictingMetadataAliases(musicFile, metadata) {
    const id3 = musicFile.getTag(TagTypes.Id3v2, false);
    if (id3) {
        removeId3UserTextAliases(id3, CONFLICTING_METADATA_ALIAS_KEYS);
        removeId3NativeAliases(id3);
        id3.removeFrames(Id3v2FrameIdentifiers.TDOR);
        id3.removeFrames(Id3v2FrameIdentifiers.TDRL);
        if (metadata.year === null) {
            id3.removeFrames(Id3v2FrameIdentifiers.TDRC);
            id3.removeFrames(Id3v2FrameIdentifiers.TYER);
        }
    }

    const xiph = musicFile.getTag(TagTypes.Xiph, false);
    if (xiph) {
        for (const key of CONFLICTING_METADATA_ALIAS_KEYS) {
            xiph.setFieldAsStrings(key);
        }
    }

    const ape = musicFile.getTag(TagTypes.Ape, false);
    if (ape) {
        for (const key of CONFLICTING_METADATA_ALIAS_KEYS) {
            ape.setStringValues(key, []);
        }
    }

    const apple = musicFile.getTag(TagTypes.Apple, false);
    if (apple) {
        for (const key of APPLE_METADATA_ALIAS_KEYS) {
            apple.setItunesStrings('com.apple.iTunes', key);
        }
    }
}

function setEditableFields(musicFile, metadata) {
    const tag = musicFile.tag;
    removeConflictingMetadataAliases(musicFile, metadata);

    tag.title = metadata.title || undefined;
    tag.performers = metadata.artist ? [metadata.artist] : [];
    tag.grouping = metadata.series || undefined;
    tag.album = metadata.album || undefined;
    tag.albumArtists = metadata.albumArtist ? [metadata.albumArtist] : [];
    tag.composers = metadata.composer ? [metadata.composer] : [];
    tag.publisher = metadata.publisher || undefined;
    tag.description = metadata.comment || undefined;
    tag.comment = metadata.comment || undefined;
    tag.genres = [...metadata.genres];
    tag.year = metadata.year || 0;
    tag.track = metadata.trackNumber || 0;
    tag.trackCount = metadata.trackTotal || 0;
    tag.disc = metadata.discNumber || 0;
    tag.discCount = metadata.discsTotal || 0;

    if (typeof tag.setItunesStrings === 'function' && typeof tag.setQuickTimeString === 'function') {
        tag.setItunesStrings(
            'com.apple.iTunes',
            'LABEL',
            ...(metadata.publisher ? [metadata.publisher] : []),
        );
        tag.setItunesStrings('com.apple.iTunes', 'NOTES');
        tag.setQuickTimeString(
            ByteVector.fromString('ldes', StringType.Latin1),
            metadata.comment || undefined,
        );
        tag.setQuickTimeString(ByteVector.fromString('©com', StringType.Latin1), undefined);
    }
}

function replaceFrontCover(pictures, cover) {
    const existingPictures = Array.isArray(pictures) ? pictures : [];
    const firstFrontCover = existingPictures.find(picture => picture.type === PictureType.FrontCover);
    const replacement = Picture.fromFullData(
        ByteVector.fromByteArray(cover.buffer),
        PictureType.FrontCover,
        cover.mimeType,
        cover.description ?? firstFrontCover?.description ?? '',
    );

    const result = [];
    let inserted = false;
    for (const picture of existingPictures) {
        if (picture.type === PictureType.FrontCover) {
            if (!inserted) {
                result.push(replacement);
                inserted = true;
            }
            continue;
        }
        result.push(picture);
    }
    if (!inserted) result.unshift(replacement);
    return result;
}

function appReadableText(value) {
    return value?.replace(/\s+/g, ' ').trim() || null;
}

function comparableReaderMetadata(metadata = {}) {
    return {
        title: metadata.title ?? null,
        artist: metadata.artist ?? null,
        grouping: metadata.grouping ?? null,
        album: metadata.album ?? null,
        albumArtist: metadata.albumArtist ?? null,
        composer: metadata.composer ?? null,
        publisher: metadata.publisher || null,
        description: metadata.description || null,
        genre: metadata.genre ?? null,
        year: metadata.year ?? null,
        trackNumber: metadata.trackNumber ?? null,
        trackTotal: metadata.trackTotal ?? null,
        discNumber: metadata.discNumber ?? null,
        discTotal: metadata.discTotal ?? null,
    };
}

function expectedReaderMetadata(metadata) {
    return {
        title: appReadableText(metadata.title),
        artist: appReadableText(metadata.artist),
        grouping: appReadableText(metadata.series),
        album: appReadableText(metadata.album),
        albumArtist: appReadableText(metadata.albumArtist),
        composer: appReadableText(metadata.composer),
        publisher: appReadableText(metadata.publisher),
        description: appReadableText(metadata.comment),
        genre: metadata.genres.length > 0 ? metadata.genres.join(', ') : null,
        year: metadata.year,
        trackNumber: metadata.trackNumber,
        trackTotal: metadata.trackTotal,
        discNumber: metadata.discNumber,
        discTotal: metadata.discsTotal,
    };
}

function addMismatch(mismatches, field, actual, expected) {
    if (actual !== expected) {
        mismatches.push(`${field} (기대: ${String(expected)}, 실제: ${String(actual)})`);
    }
}

function verifyNativeMetadata(mismatches, musicFile, expected) {
    const tag = musicFile.tag;
    const actual = {
        title: normalizeNullableText(tag.title),
        artist: normalizeNullableText(tag.performers?.join(', ')),
        series: normalizeNullableText(tag.grouping),
        album: normalizeNullableText(tag.album),
        albumArtist: normalizeNullableText(tag.albumArtists?.join(', ')),
        composer: normalizeNullableText(tag.composers?.join(', ')),
        publisher: normalizeNullableText(tag.publisher),
        comment: normalizeNullableText(tag.comment),
        year: tag.year || null,
        trackNumber: tag.track || null,
        trackTotal: tag.trackCount || null,
        discNumber: tag.disc || null,
        discsTotal: tag.discCount || null,
    };
    for (const field of Object.keys(actual)) {
        addMismatch(mismatches, field, actual[field], expected[field]);
    }
    const genres = tag.genres || [];
    if (JSON.stringify(genres) !== JSON.stringify(expected.genres)) {
        mismatches.push(`genres (기대: ${expected.genres.join('; ')}, 실제: ${genres.join('; ')})`);
    }
}

function verifyFrontCover(mismatches, musicFile, cover) {
    if (!cover) return;
    const frontCovers = (musicFile.tag.pictures || [])
        .filter(picture => picture.type === PictureType.FrontCover);
    if (frontCovers.length !== 1) {
        mismatches.push(`frontCoverCount (기대: 1, 실제: ${frontCovers.length})`);
        return;
    }

    const actual = frontCovers[0];
    addMismatch(mismatches, 'frontCoverMimeType', actual.mimeType?.toLowerCase() || null, cover.mimeType);
    if (!Buffer.from(actual.data.toByteArray()).equals(cover.buffer)) {
        mismatches.push('frontCoverData');
    }
}

export async function verifyAudioMetadataWrite(filePath, metadata = {}, options = {}) {
    requireWritableAudioPath(filePath);
    const expected = normalizeAudioMetadataEdits(metadata);
    const cover = normalizeCover(options.cover);
    const readerMetadata = await readAudioMetadata(filePath, { includeCover: true });
    const musicFile = openTagLibFile(filePath);
    const mismatches = [];
    let pictureCount = 0;
    const readerActual = comparableReaderMetadata(readerMetadata);
    const readerExpected = expectedReaderMetadata(expected);

    for (const field of Object.keys(readerExpected)) {
        addMismatch(mismatches, `readAudioMetadata.${field}`, readerActual[field], readerExpected[field]);
    }
    try {
        verifyNativeMetadata(mismatches, musicFile, expected);
        verifyFrontCover(mismatches, musicFile, cover);
        pictureCount = musicFile.tag.pictures?.length || 0;
    } finally {
        musicFile.dispose();
    }

    if (cover && !readerMetadata.artworkBuffer?.equals(cover.buffer)) {
        mismatches.push('readAudioMetadata.artworkBuffer');
    }
    if (mismatches.length > 0) {
        throw new AudioMetadataVerificationError(mismatches);
    }

    return {
        metadata: readerMetadata,
        normalized: expected,
        pictureCount,
    };
}

export async function writeAudioMetadataFileInProcess(tempFilePath, metadata = {}, options = {}) {
    requireWritableAudioPath(tempFilePath);
    const normalized = normalizeAudioMetadataEdits(metadata);
    const cover = normalizeCover(options.cover);
    const musicFile = openTagLibFile(tempFilePath);

    try {
        setEditableFields(musicFile, normalized);
        if (cover) {
            musicFile.tag.pictures = replaceFrontCover(musicFile.tag.pictures, cover);
        }
        musicFile.save();
    } finally {
        musicFile.dispose();
    }

    return verifyAudioMetadataWrite(tempFilePath, metadata, { cover });
}

function reviveWriterResult(result = {}) {
    const metadata = result.metadata && typeof result.metadata === 'object'
        ? { ...result.metadata }
        : result.metadata;
    if (metadata?.artwork?.buffer) {
        metadata.artwork = {
            ...metadata.artwork,
            buffer: Buffer.from(metadata.artwork.buffer),
        };
    }
    for (const field of ['artworkBuffer', 'imageBuffer']) {
        if (metadata?.[field]) metadata[field] = Buffer.from(metadata[field]);
    }
    return { ...result, metadata };
}

function writerErrorFromPayload(payload = {}) {
    if (payload.code === 'AUDIO_METADATA_VERIFICATION_FAILED') {
        return new AudioMetadataVerificationError(payload.mismatches || []);
    }
    if (payload.code === 'AUDIO_METADATA_UNSUPPORTED') {
        return new UnsupportedAudioMetadataFormatError(payload.filePath || payload.extension || '');
    }
    const error = new Error(payload.message || '오디오 메타데이터 저장 worker가 실패했습니다.');
    error.name = payload.name || 'Error';
    error.code = payload.code;
    if (payload.stack) error.stack = payload.stack;
    return error;
}

export async function writeAudioMetadataFile(tempFilePath, metadata = {}, options = {}) {
    requireWritableAudioPath(tempFilePath);
    normalizeAudioMetadataEdits(metadata);
    normalizeCover(options.cover);
    if (options.useWorker === false) {
        return writeAudioMetadataFileInProcess(tempFilePath, metadata, options);
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./audioMetadataWriterWorker.js', import.meta.url), {
            workerData: {
                filePath: tempFilePath,
                metadata,
                cover: options.cover || null,
            },
        });
        let settled = false;
        const finish = callback => value => {
            if (settled) return;
            settled = true;
            callback(value);
        };
        const succeed = finish(result => resolve(reviveWriterResult(result)));
        const fail = finish(reject);

        worker.once('message', message => {
            if (message?.error) fail(writerErrorFromPayload(message.error));
            else succeed(message?.result || {});
        });
        worker.once('error', fail);
        worker.once('exit', code => {
            if (code !== 0) fail(new Error(`오디오 메타데이터 저장 worker가 종료 코드 ${code}로 끝났습니다.`));
        });
    });
}
