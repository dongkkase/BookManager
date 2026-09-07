import {
    enabledMetadataApiSourcesForBookType,
    UNIFIED_METADATA_API_SOURCE,
} from './metadataApiPolicy.js';

const SEARCH_PAGE_SIZE = 20;
const MAX_CONCURRENT_SEARCHES = 3;
const MAX_COMPARISON_LENGTH = 160;
const MAX_TITLE_LENGTH = 2048;
const MAX_TITLE_CANDIDATES = 24;
const DECORATION_PATTERN = /(?:\[|\(|【|（)\s*(?:완결|완전판|개정판|개정본|단행본|연재|전자책|합본|세트|특별판|소장판|컬러판|完結|complete(?:d)?|e-?book)\s*(?:\]|\)|】|）)/giu;
const VOLUME_SUFFIX_PATTERN = /\s*(?:(?:제|第)?\s*\d+(?:\.\d+)?(?:\s*(?:권|화|회|巻|話)?\s*[~～\-–]\s*(?:제|第)?\s*\d+(?:\.\d+)?)?\s*(?:권|화|회|巻|話)|(?:vol(?:ume)?|ch(?:apter)?|ep(?:isode)?)\.?\s*#?\s*\d+(?:\.\d+)?(?:\s*[~～\-–]\s*\d+(?:\.\d+)?)?)\s*(?:완결|完結)?\s*$/iu;

function normalizedTitle(value) {
    return String(value || '').slice(0, MAX_TITLE_LENGTH).normalize('NFKC').toLowerCase();
}

function comparableTitle(value) {
    return normalizedTitle(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function undecoratedTitle(value, query) {
    let title = normalizedTitle(value).replace(DECORATION_PATTERN, '').trim();
    for (let pass = 0; pass < 3; pass += 1) {
        const nextTitle = title.replace(VOLUME_SUFFIX_PATTERN, '').trim();
        if (!nextTitle || nextTitle === title) break;
        title = nextTitle;
    }
    const numberedTitle = title.match(/^(.+\S)\s+\d+(?:\.\d+)?$/u);
    if (numberedTitle && /\p{L}/u.test(query) && comparableTitle(numberedTitle[1]) === query) {
        title = numberedTitle[1];
    }
    return comparableTitle(title);
}

function titleCandidates(result) {
    const candidates = [];
    const seen = new Set();
    const add = (value, series = false) => {
        if (candidates.length >= MAX_TITLE_CANDIDATES) return;
        if (Array.isArray(value)) {
            for (const item of value.slice(0, MAX_TITLE_CANDIDATES)) add(item, series);
        } else if (typeof value === 'string' && value.trim()) {
            const key = `${series}:${value}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ value, series });
        }
    };
    add(result?.title);
    add(result?.metadata?.Title);
    if (result?.title && typeof result.title === 'object') {
        add(result.title.native);
        add(result.title.english);
        add(result.title.romaji);
    }
    add(result?.metadata?.Series, true);
    add(result?.metadata?.LocalizedSeries, true);
    add(result?.aliases);
    add(result?.alternativeTitles);
    add(result?.synonyms);
    add(result?.metadata?.AlternateTitle);
    add(result?.metadata?.Aliases);
    return candidates;
}

function editSimilarity(left, right) {
    const longestLength = Math.max(left.length, right.length);
    if (longestLength > MAX_COMPARISON_LENGTH) return 0;
    const maximumDistance = Math.floor(longestLength * 0.4);
    if (Math.abs(left.length - right.length) > maximumDistance) return 0;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    let current = new Array(right.length + 1);
    for (let row = 1; row <= left.length; row += 1) {
        current[0] = row;
        let smallest = row;
        for (let column = 1; column <= right.length; column += 1) {
            current[column] = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
            );
            smallest = Math.min(smallest, current[column]);
        }
        if (smallest > maximumDistance) return 0;
        [previous, current] = [current, previous];
    }
    const distance = previous[right.length];
    return distance <= maximumDistance ? 1 - distance / longestLength : 0;
}

function candidateScore(candidate, query, queryCore) {
    const title = comparableTitle(candidate.value);
    if (!title) return 0;
    if (title === query) return candidate.series ? 4000 : 5000;
    const core = undecoratedTitle(candidate.value, queryCore);
    if (core && core === queryCore) return 4000;
    const target = core || title;
    if (target.includes(queryCore) || queryCore.includes(target)) {
        const coverage = Math.min(target.length, queryCore.length) / Math.max(target.length, queryCore.length);
        return 3000 + coverage * 100;
    }
    const similarity = editSimilarity(target, queryCore);
    return similarity > 0 ? 2000 + similarity * 100 : 0;
}

export function rankMetadataSearchResults(results = [], query = '') {
    const normalizedQuery = comparableTitle(query);
    if (!normalizedQuery) return [...results];
    const queryCore = undecoratedTitle(query, normalizedQuery) || normalizedQuery;
    return results.map((result, index) => ({
        result,
        index,
        score: titleCandidates(result).reduce((best, candidate) => (
            Math.max(best, candidateScore(candidate, normalizedQuery, queryCore))
        ), 0),
    })).sort((left, right) => right.score - left.score || left.index - right.index)
        .map(entry => entry.result);
}

export function metadataSearchResultKey(result = {}, fallbackSource = '') {
    const source = result.apiSource || fallbackSource;
    if (result.id !== undefined && result.id !== null && result.id !== '') {
        return JSON.stringify([source, 'id', String(result.id)]);
    }
    const url = result.url || result.metadata?.Web;
    if (url) return JSON.stringify([source, 'url', String(url)]);
    return JSON.stringify([
        source,
        'title',
        result.title || result.metadata?.Title || result.metadata?.Series || '',
        result.author || result.metadata?.Writer || '',
        result.metadata?.Number || '',
    ]);
}

function responseEnvelope(options, overrides = {}) {
    return {
        success: true,
        api: options.apiSource,
        actualQuery: String(options.query || '').trim(),
        results: [],
        cached: false,
        hasNext: false,
        failures: [],
        ...overrides,
    };
}

function responseResults(response, source) {
    return response.results.map(result => ({ ...result, apiSource: source }));
}

function searchFailure(error) {
    return String(error?.message || error || 'Search failed');
}

export async function searchMetadata(options, fetchMetadata, { isCancelled = () => false } = {}) {
    const cancelledResponse = () => responseEnvelope(options, { success: false, cancelled: true });
    if (isCancelled()) return cancelledResponse();
    if (options.apiSource !== UNIFIED_METADATA_API_SOURCE) {
        try {
            const response = await fetchMetadata(options);
            if (isCancelled()) return cancelledResponse();
            if (response?.success === false || !Array.isArray(response?.results)) {
                return responseEnvelope(options, { ...response, success: false });
            }
            return responseEnvelope(options, {
                ...response,
                success: true,
                results: rankMetadataSearchResults(responseResults(response, options.apiSource), options.query),
                cached: Boolean(response.cached),
                hasNext: response.hasNext === true || response.results.length >= SEARCH_PAGE_SIZE,
            });
        } catch (error) {
            if (isCancelled()) return cancelledResponse();
            return responseEnvelope(options, { success: false, error: searchFailure(error) });
        }
    }

    const sources = enabledMetadataApiSourcesForBookType(options.bookType, options.apiKeys);
    if (sources.length === 0) {
        return responseEnvelope(options, { success: false, code: 'NO_ENABLED_APIS' });
    }
    const responses = new Array(sources.length);
    let nextIndex = 0;
    const worker = async () => {
        while (!isCancelled() && nextIndex < sources.length) {
            const index = nextIndex;
            nextIndex += 1;
            const source = sources[index].value;
            try {
                const response = await fetchMetadata({ ...options, apiSource: source });
                if (response?.success === false || !Array.isArray(response?.results)) {
                    responses[index] = { source, error: searchFailure(response?.error) };
                } else {
                    responses[index] = { source, response };
                }
            } catch (error) {
                responses[index] = { source, error: searchFailure(error) };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SEARCHES, sources.length) }, worker));
    if (isCancelled()) return cancelledResponse();

    const successes = responses.filter(entry => entry.response);
    const failures = responses.filter(entry => entry.error).map(entry => ({
        apiSource: entry.source,
        error: entry.error,
    }));
    if (successes.length === 0) {
        return responseEnvelope(options, { success: false, code: 'ALL_APIS_FAILED', failures });
    }
    return responseEnvelope(options, {
        results: rankMetadataSearchResults(successes.flatMap(entry => responseResults(entry.response, entry.source)), options.query),
        cached: failures.length === 0 && successes.every(entry => entry.response.cached),
        hasNext: successes.some(entry => entry.response.hasNext === true || entry.response.results.length >= SEARCH_PAGE_SIZE),
        failures,
    });
}
