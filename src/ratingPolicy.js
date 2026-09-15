import { AUDIO_EXTENSIONS, BOOK_EXTENSIONS, COMIC_EXTENSIONS, extensionFromFile } from './metadata/metadataTypes.js';

export function supportsRatingEditor(file) {
    if (!file || file.isDirectory || !(file.path || file.full_path)) return false;
    const extension = extensionFromFile(file);
    return AUDIO_EXTENSIONS.has(extension) || BOOK_EXTENSIONS.has(extension) || COMIC_EXTENSIONS.has(extension);
}

export function initialRating(value) {
    const rating = Number(value);
    return Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.max(1, Math.round(rating))) : 0;
}

export function ratingStarFill(rating, index) {
    return Math.min(2, Math.max(0, rating - index * 2)) * 50;
}
