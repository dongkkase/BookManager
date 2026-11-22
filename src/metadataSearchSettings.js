import { extensionFromFile, resolveBookType } from './metadata/metadataTypes.js';

export const METADATA_SEARCH_SETTING_TYPES = ['comic', 'epub', 'txt', 'pdf', 'audio'];

function comparisonKey(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase();
}

export function metadataSearchSettingType(file = {}) {
    file = file || {};
    const extension = extensionFromFile(file);
    if (extension === '.txt') return 'txt';
    if (extension === '.epub') return 'epub';
    const bookType = resolveBookType(file);
    return bookType === 'book' ? 'epub' : bookType;
}

export function metadataSearchTerms(value) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
    const seen = new Set();
    return values.filter(value => typeof value === 'string').map(value => value.trim()).filter(value => {
        const key = comparisonKey(value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function normalizeMetadataSearchSettings(value = {}) {
    return Object.fromEntries(METADATA_SEARCH_SETTING_TYPES.map(type => [type, {
        excludedTitleTerms: metadataSearchTerms(value?.[type]?.excludedTitleTerms),
        excludedResultTags: metadataSearchTerms(value?.[type]?.excludedResultTags),
        excludedTags: metadataSearchTerms(value?.[type]?.excludedTags),
    }]));
}

function tagValues(value) {
    return metadataSearchTerms(Array.isArray(value) ? value.flatMap(tagValues) : String(value || '').split(/[,/|\n]/));
}

export function metadataSearchResultTags(result = {}) {
    return metadataSearchTerms([
        ...tagValues(result.tags), ...tagValues(result.Tags), ...tagValues(result.metadata?.Tags),
        ...tagValues(result.Genre), ...tagValues(result.metadata?.Genre),
    ]);
}

export function isMetadataSearchTagExcluded(tag, settings = {}) {
    const key = comparisonKey(tag);
    return metadataSearchTerms(settings.excludedTags).some(value => comparisonKey(value) === key);
}

export function toggleMetadataSearchExcludedTag(settings = {}, tag) {
    const excludedTags = metadataSearchTerms(settings.excludedTags);
    return {
        ...settings,
        excludedTags: isMetadataSearchTagExcluded(tag, settings)
            ? excludedTags.filter(value => comparisonKey(value) !== comparisonKey(tag))
            : metadataSearchTerms([...excludedTags, tag]),
    };
}

export function filterMetadataSearchResults(results = [], settings = {}) {
    const titleTerms = metadataSearchTerms(settings.excludedTitleTerms).map(comparisonKey);
    const excludedTags = new Set(metadataSearchTerms(settings.excludedResultTags).map(comparisonKey));
    return results.filter(result => {
        const titles = [result.title, result.metadata?.Title].filter(value => typeof value === 'string').map(comparisonKey);
        if (titleTerms.some(term => titles.some(title => title.includes(term)))) return false;
        return !metadataSearchResultTags(result).some(tag => excludedTags.has(comparisonKey(tag)));
    });
}

export function metadataWithoutExcludedSearchTags(metadata, settings = {}, normalize = value => value) {
    const removeTags = value => {
        const next = { ...value };
        for (const field of ['Genre', 'Tags']) {
            if (next[field] === undefined) continue;
            const tags = tagValues(next[field]);
            if (tags.some(tag => isMetadataSearchTagExcluded(tag, settings))) {
                next[field] = tags.filter(tag => !isMetadataSearchTagExcluded(tag, settings)).join(', ');
            }
        }
        return next;
    };
    return removeTags(normalize(removeTags(metadata)));
}
