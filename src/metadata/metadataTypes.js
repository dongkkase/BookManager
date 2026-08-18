export const METADATA_BOOK_TYPE = Object.freeze({
    COMIC: 'comic',
    BOOK: 'book',
    PDF: 'pdf',
    AUDIO: 'audio',
});

export const BOOK_EXTENSIONS = new Set(['.pdf', '.epub', '.txt']);

export const COMIC_EXTENSIONS = new Set([
    '.zip',
    '.cbz',
    '.rar',
    '.cbr',
    '.7z',
    '.cb7',
]);

export const AUDIO_EXTENSIONS = new Set([
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

export function extensionFromFile(file = {}) {
    const directExt = String(file.ext || file.extension || '').trim().toLowerCase();
    if (directExt) return directExt.startsWith('.') ? directExt : `.${directExt}`;

    const sourcePath = file.path || file.filepath || file.file_path || file.full_path || file.name || '';
    const match = String(sourcePath).toLowerCase().match(/(\.[^./\\]+)$/);
    return match ? match[1] : '';
}

export function resolveBookType(file = {}) {
    const ext = extensionFromFile(file);
    if (ext === '.pdf') return METADATA_BOOK_TYPE.PDF;
    if (AUDIO_EXTENSIONS.has(ext)) return METADATA_BOOK_TYPE.AUDIO;

    const explicit = String(file.book_type || file.bookType || file.media_type || file.mediaType || '')
        .trim()
        .toLowerCase();
    if (['pdf'].includes(explicit)) return METADATA_BOOK_TYPE.PDF;
    if (['audio', 'audiobook', 'audio-book'].includes(explicit)) return METADATA_BOOK_TYPE.AUDIO;
    if (['book', 'document', 'novel'].includes(explicit)) return METADATA_BOOK_TYPE.BOOK;
    if (['comic', 'manga', 'archive'].includes(explicit)) return METADATA_BOOK_TYPE.COMIC;

    if (BOOK_EXTENSIONS.has(ext)) return METADATA_BOOK_TYPE.BOOK;
    return METADATA_BOOK_TYPE.COMIC;
}

export function isBookFile(file = {}) {
    return resolveBookType(file) === METADATA_BOOK_TYPE.BOOK;
}

export function isComicFile(file = {}) {
    return resolveBookType(file) === METADATA_BOOK_TYPE.COMIC;
}

export function isAudioFile(file = {}) {
    return resolveBookType(file) === METADATA_BOOK_TYPE.AUDIO;
}
