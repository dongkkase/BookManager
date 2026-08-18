import fs from 'node:fs/promises';
import { parseFile, selectCover } from 'music-metadata';
import tagLib from 'node-taglib-sharp';

const { File: TagLibFile } = tagLib;

export const AUDIO_EXTENSION_VALUES = Object.freeze([
    '.3gp',
    '.aac',
    '.aif',
    '.aiff',
    '.amr',
    '.caf',
    '.flac',
    '.m4a',
    '.m4b',
    '.mp3',
    '.oga',
    '.ogg',
    '.opus',
    '.wav',
    '.wave',
    '.webm',
]);

export const AUDIO_EXTENSIONS = new Set(AUDIO_EXTENSION_VALUES);

export const AUDIO_MIME_TYPES = Object.freeze({
    '.3gp': 'audio/3gpp',
    '.aac': 'audio/aac',
    '.aif': 'audio/aiff',
    '.aiff': 'audio/aiff',
    '.amr': 'audio/amr',
    '.caf': 'audio/x-caf',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.m4b': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.webm': 'audio/webm',
});

const AUDIO_FORMATS_WITHOUT_MUSIC_METADATA_PARSERS = new Set(['.amr', '.caf']);
const TAGLIB_AUDIO_MIME_TYPES = Object.freeze({
    '.aac': 'taglib/aac',
    '.aif': 'taglib/aif',
    '.aiff': 'taglib/aiff',
    '.flac': 'taglib/flac',
    '.m4a': 'taglib/m4a',
    '.m4b': 'taglib/m4b',
    '.mp3': 'taglib/mp3',
    '.oga': 'taglib/oga',
    '.ogg': 'taglib/ogg',
    '.opus': 'taglib/opus',
    '.wav': 'taglib/wav',
    '.wave': 'audio/wav',
});

function extensionFromPath(filePath = '') {
    const withoutQuery = String(filePath ?? '').split(/[?#]/, 1)[0].trim().toLowerCase();
    const match = withoutQuery.match(/\.[^./\\]+$/);
    return match?.[0] || '';
}

function normalizeText(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    const normalized = String(value)
        .replace(/\u0000/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || null;
}

function normalizeTextList(value) {
    const values = Array.isArray(value) ? value : [value];
    const result = [];
    const seen = new Set();

    for (const item of values) {
        const normalized = normalizeText(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function normalizeCommentList(value) {
    const values = Array.isArray(value) ? value : [value];
    return normalizeTextList(values.map(item => (
        item && typeof item === 'object' && !Array.isArray(item) ? item.text : item
    )));
}

function normalizeGenreList(value) {
    const values = Array.isArray(value) ? value : [value];
    return normalizeTextList(values.flatMap(item => String(item ?? '').split(/[;,]/)));
}

function normalizeNumber(value, options = {}) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const normalizedText = typeof value === 'string' ? normalizeText(value) : value;
    if (normalizedText === null || normalizedText === '') return null;
    const numberValue = Number(normalizedText);
    const minimum = options.minimum ?? 0;
    if (!Number.isFinite(numberValue) || numberValue < minimum) return null;
    if (options.integer === true && !Number.isInteger(numberValue)) return null;
    if (Number.isFinite(options.maximum) && numberValue > options.maximum) return null;
    return numberValue;
}

function normalizePositiveNumber(value) {
    return normalizeNumber(value, { minimum: Number.MIN_VALUE });
}

function normalizePositiveInteger(value) {
    return normalizeNumber(value, { minimum: 1, integer: true });
}

function normalizeYear(common = {}) {
    for (const value of [common.year, common.originalyear]) {
        const year = normalizeNumber(value, { minimum: 1, maximum: 9999, integer: true });
        if (year !== null) return year;
    }

    for (const value of [common.date, common.originaldate, common.releasedate]) {
        const text = normalizeText(value);
        const match = text?.match(/(?:^|\D)(\d{4})(?:\D|$)/);
        const year = normalizeNumber(match?.[1], { minimum: 1, maximum: 9999, integer: true });
        if (year !== null) return year;
    }

    return null;
}

function normalizeNumberPair(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return {
            number: normalizePositiveInteger(value.no),
            total: normalizePositiveInteger(value.of),
        };
    }

    const text = normalizeText(value);
    const match = text?.match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
    return {
        number: normalizePositiveInteger(match?.[1]),
        total: normalizePositiveInteger(match?.[2]),
    };
}

function normalizeArtworkMimeType(value, buffer) {
    const normalized = normalizeText(value)?.toLowerCase() || '';
    const aliases = {
        bmp: 'image/bmp',
        gif: 'image/gif',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        'image/jpg': 'image/jpeg',
    };
    if (aliases[normalized]) return aliases[normalized];
    if (normalized.startsWith('image/')) return normalized;
    if (!buffer) return null;

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        return 'image/png';
    }
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
        return 'image/gif';
    }
    if (buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'image/webp';
    }
    if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
        return 'image/bmp';
    }
    return null;
}

function normalizeArtwork(pictures, includeCover) {
    if (!includeCover || !Array.isArray(pictures)) return null;
    const usablePictures = pictures.filter(picture => {
        const data = picture?.data;
        return Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer;
    });
    if (usablePictures.length === 0) return null;

    const picture = selectCover(usablePictures) || usablePictures[0];
    const buffer = Buffer.from(picture.data);
    if (buffer.length === 0) return null;
    return {
        buffer,
        mimeType: normalizeArtworkMimeType(picture.format, buffer),
    };
}

function artworkFileName(mimeType) {
    const extensions = {
        'image/bmp': '.bmp',
        'image/gif': '.gif',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
    };
    const extension = extensions[mimeType] || '';
    return extension ? `cover${extension}` : '';
}

function firstAudioTrack(format = {}) {
    if (!Array.isArray(format.trackInfo)) return null;
    return format.trackInfo.find(track => track?.type === 1 || track?.type === 'audio' || track?.audio) || null;
}

export function isAudioPath(filePath = '') {
    return AUDIO_EXTENSIONS.has(extensionFromPath(filePath));
}

export function inferAudioMimeType(filePath = '') {
    return AUDIO_MIME_TYPES[extensionFromPath(filePath)] || null;
}

export function normalizeAudioMetadata(parsed = {}, options = {}) {
    const common = parsed?.common && typeof parsed.common === 'object' ? parsed.common : {};
    const technical = parsed?.format && typeof parsed.format === 'object' ? parsed.format : {};
    const tagMetadata = options.tagMetadata && typeof options.tagMetadata === 'object'
        ? options.tagMetadata
        : {};
    const includeCover = options.includeCover !== false;
    const title = normalizeText(common.title) || normalizeText(tagMetadata.title);
    const listedArtists = normalizeTextList(
        Array.isArray(common.artists) && common.artists.length > 0
            ? common.artists
            : tagMetadata.performers,
    );
    const taggedArtist = normalizeText(common.artist)
        || normalizeText(tagMetadata.artist)
        || listedArtists[0]
        || null;
    const artists = listedArtists.length > 0
        ? listedArtists
        : normalizeTextList(taggedArtist);
    const artist = taggedArtist || (artists.length > 0 ? artists.join(', ') : null);
    const album = normalizeText(common.album) || normalizeText(tagMetadata.album);
    const albumArtist = normalizeText(common.albumartist) || normalizeText(tagMetadata.albumArtist);
    const composers = normalizeTextList(
        Array.isArray(common.composer) && common.composer.length > 0
            ? common.composer
            : tagMetadata.composers,
    );
    const composer = composers.length > 0 ? composers.join(', ') : null;
    const genres = normalizeGenreList(
        Array.isArray(common.genre) && common.genre.length > 0
            ? common.genre
            : tagMetadata.genres,
    );
    const genre = genres.length > 0 ? genres.join(', ') : null;
    const year = normalizeYear(common)
        ?? normalizeNumber(tagMetadata.year, { minimum: 1, maximum: 9999, integer: true });
    const track = normalizeNumberPair(common.track);
    const disc = normalizeNumberPair(common.disk);
    if (track.number === null) track.number = normalizePositiveInteger(tagMetadata.trackNumber);
    if (track.total === null) track.total = normalizePositiveInteger(tagMetadata.trackTotal);
    if (disc.number === null) disc.number = normalizePositiveInteger(tagMetadata.discNumber);
    if (disc.total === null) disc.total = normalizePositiveInteger(tagMetadata.discTotal);
    const grouping = normalizeText(common.grouping) || normalizeText(tagMetadata.grouping);
    const taggedPublisher = normalizeText(tagMetadata.publisher);
    const publishers = taggedPublisher
        ? [taggedPublisher]
        : normalizeTextList([
            ...(Array.isArray(common.publisher) ? common.publisher : [common.publisher]),
            ...(Array.isArray(common.label) ? common.label : [common.label]),
        ]);
    const publisher = publishers.join(', ') || null;
    const descriptions = [
        normalizeText(tagMetadata.description),
        normalizeText(tagMetadata.comment),
        normalizeText(common.longDescription),
        ...normalizeTextList(common.description),
        ...normalizeCommentList(common.comment),
    ].filter(Boolean);
    const description = descriptions[0] || null;
    const audioTrack = firstAudioTrack(technical);
    const durationSeconds = normalizeNumber(technical.duration);
    const bitrateBitsPerSecond = normalizePositiveNumber(technical.bitrate);
    const sampleRateHz = normalizePositiveNumber(technical.sampleRate)
        ?? normalizePositiveNumber(audioTrack?.audio?.samplingFrequency);
    const codec = normalizeText(technical.codec) || normalizeText(audioTrack?.codecName);
    const container = normalizeText(technical.container);
    const channels = normalizePositiveInteger(technical.numberOfChannels)
        ?? normalizePositiveInteger(audioTrack?.audio?.channels);
    const fileSizeBytes = normalizeNumber(options.fileSizeBytes, { integer: true });
    const mimeType = normalizeText(options.mimeType) || inferAudioMimeType(options.filePath);
    const artwork = normalizeArtwork(common.picture, includeCover);
    const hasMetadata = Boolean(
        title
        || artist
        || album
        || albumArtist
        || composer
        || genre
        || grouping
        || publisher
        || description
        || year !== null
        || track.number !== null
        || track.total !== null
        || disc.number !== null
        || disc.total !== null
        || artwork,
    );

    return {
        title,
        artist,
        artists,
        album,
        albumArtist,
        composer,
        composers,
        genre,
        genres,
        grouping,
        publisher,
        description,
        year,
        trackNumber: track.number,
        trackTotal: track.total,
        discNumber: disc.number,
        discTotal: disc.total,
        durationSeconds,
        bitrateBitsPerSecond,
        sampleRateHz,
        codec,
        container,
        channels,
        fileSizeBytes,
        mimeType,
        artwork,
        artworkBuffer: artwork?.buffer || null,
        artworkMimeType: artwork?.mimeType || null,
        book_type: 'audio',
        series: grouping || album || '',
        volume: disc.number === null ? '' : String(disc.number),
        chapter: track.number === null ? '' : String(track.number),
        writer: artist || '',
        publisher: publisher || '',
        page_count: '',
        total_volume: disc.total === null ? '' : String(disc.total),
        description: description || '',
        tags: genres.join(', '),
        date: year === null ? '' : String(year),
        format: 'Audiobook',
        has_metadata: hasMetadata,
        imageBuffer: artwork?.buffer || null,
        imageName: artworkFileName(artwork?.mimeType),
    };
}

function readTagLibMetadata(filePath) {
    const extension = extensionFromPath(filePath);
    const mimeType = TAGLIB_AUDIO_MIME_TYPES[extension];
    if (!mimeType) return {};

    let audioFile = null;
    try {
        audioFile = TagLibFile.createFromPath(filePath, mimeType);
        const tag = audioFile.tag;
        return {
            title: tag.title,
            artist: tag.firstPerformer,
            performers: tag.performers,
            album: tag.album,
            albumArtist: tag.firstAlbumArtist,
            composers: tag.composers,
            genres: tag.genres,
            grouping: tag.grouping,
            publisher: tag.publisher,
            description: tag.description,
            comment: tag.comment,
            year: tag.year,
            trackNumber: tag.track,
            trackTotal: tag.trackCount,
            discNumber: tag.disc,
            discTotal: tag.discCount,
        };
    } catch {
        return {};
    } finally {
        audioFile?.dispose();
    }
}

async function parseAudioFile(filePath, options) {
    try {
        return await parseFile(filePath, options);
    } catch (error) {
        const canUseEmptyMetadata = AUDIO_FORMATS_WITHOUT_MUSIC_METADATA_PARSERS.has(
            extensionFromPath(filePath),
        ) && ['CouldNotDetermineFileTypeError', 'UnsupportedFileTypeError'].includes(error?.name);
        if (!canUseEmptyMetadata) throw error;
        return { common: {}, format: {} };
    }
}

export async function readAudioMetadata(filePath, options = {}) {
    const normalizedPath = String(filePath ?? '');
    const includeCover = options.includeCover !== false;
    const [parsed, stats, tagMetadata] = await Promise.all([
        parseAudioFile(normalizedPath, {
            duration: true,
            skipCovers: !includeCover,
        }),
        fs.stat(normalizedPath),
        Promise.resolve().then(() => readTagLibMetadata(normalizedPath)),
    ]);

    return normalizeAudioMetadata(parsed, {
        filePath: normalizedPath,
        fileSizeBytes: stats.size,
        includeCover,
        mimeType: options.mimeType,
        tagMetadata,
    });
}
