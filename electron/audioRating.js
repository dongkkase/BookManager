import path from 'node:path';
import tagLib from 'node-taglib-sharp';

const { File, TagTypes, Id3v2UserTextInformationFrame } = tagLib;
const RATING_KEY = 'BOOKMANAGER_RATING';
const ITUNES_MEAN = 'com.bookmanager';

export function readAudioRatingTag(file) {
    const id3 = file.getTag(TagTypes.Id3v2, false);
    const xiph = file.getTag(TagTypes.Xiph, false);
    const apple = file.getTag(TagTypes.Apple, false);
    const value = id3?.frames?.find(frame => frame.description === RATING_KEY)?.text?.[0]
        || xiph?.getFieldFirstValue?.(RATING_KEY)
        || apple?.getItunesStrings?.(ITUNES_MEAN, RATING_KEY)?.[0];
    const rating = Number(value);
    return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? String(rating) : '';
}

export function writeAudioRating(filePath, rating) {
    const extension = path.extname(filePath).toLowerCase();
    const type = ['.flac', '.oga', '.ogg', '.opus'].includes(extension) ? TagTypes.Xiph
        : ['.m4a', '.m4b'].includes(extension) ? TagTypes.Apple : TagTypes.Id3v2;
    const mime = extension === '.wave' ? 'audio/wav' : undefined;
    let file = File.createFromPath(filePath, mime);
    try {
        const tag = file.getTag(type, true);
        if (!tag) throw new Error('This audio file cannot store a rating.');
        if (type === TagTypes.Xiph) tag.setFieldAsStrings(RATING_KEY, String(rating));
        else if (type === TagTypes.Apple) tag.setItunesStrings(ITUNES_MEAN, RATING_KEY, String(rating));
        else {
            let frame = tag.frames.find(item => item.description === RATING_KEY);
            if (!frame) {
                frame = Id3v2UserTextInformationFrame.fromDescription(RATING_KEY);
                tag.addFrame(frame);
            }
            frame.text = [String(rating)];
        }
        file.save();
    } finally {
        file.dispose();
    }
    file = File.createFromPath(filePath, mime);
    try {
        if (Number(readAudioRatingTag(file)) !== rating) throw new Error('Audio rating verification failed.');
    } finally {
        file.dispose();
    }
}
