import { decodeHTML } from 'entities';
import { BoundedMemoryCache } from './boundedMemoryCache.js';

const API_BASE = 'https://comicvine.gamespot.com/api/';
const PAGE_SIZE = 10;
const VOLUME_FIELDS = 'id,name,aliases,deck,description,image,publisher,start_year,count_of_issues,site_detail_url,first_issue';
const requestSchedules = new WeakMap();
const issueCreditCaches = new WeakMap();
const volumeCoverCaches = new WeakMap();
const STOP_CREDIT_ERRORS = new Set(['API_AUTH_REQUIRED', 'API_AUTH_FAILED', 'API_ACCESS_BLOCKED', 'API_RATE_LIMIT']);

function providerError(code) {
    return Object.assign(new Error(code), { code });
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function plainText(value) {
    return decodeHTML(text(value)
        .replace(/<br\s*\/?\s*>|<\/(?:p|div)>/gi, '\n')
        .replace(/<[^>]*>/g, ''))
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function volumeId(value) {
    const id = String(value ?? '').replace(/^4050-/, '');
    return /^[1-9]\d*$/.test(id) ? id : '';
}

export function normalizeComicVineImageUrl(value) {
    try {
        const url = new URL(text(value));
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return '';
        if (/^comicvine(?:\d+)?\.cbsistatic\.com$/.test(url.hostname) && url.pathname.startsWith('/uploads/')) {
            url.hostname = 'comicvine.gamespot.com';
            url.pathname = `/a${url.pathname}`;
        }
        url.protocol = 'https:';
        return url.href;
    } catch {
        return '';
    }
}

export function isComicVineImageUrl(value) {
    try {
        const url = new URL(value);
        return url.hostname === 'comicvine.gamespot.com' && url.pathname.startsWith('/a/uploads/');
    } catch {
        return false;
    }
}

export function isComicVinePlaceholderImageUrl(value) {
    try {
        const url = new URL(value);
        return (url.hostname === 'comicvine.gamespot.com' || /^comicvine(?:\d+)?\.cbsistatic\.com$/.test(url.hostname))
            && /\/6373148-blank\.png$/i.test(url.pathname);
    } catch {
        return false;
    }
}

function coverUrls(image) {
    return [...new Set([
        image?.super_url, image?.original_url, image?.medium_url, image?.screen_large_url,
        image?.screen_url, image?.small_url, image?.thumb_url, image?.tiny_url, image?.icon_url,
    ].map(normalizeComicVineImageUrl).filter(url => url && !isComicVinePlaceholderImageUrl(url)))];
}

function creditNames(credits, roles) {
    if (!Array.isArray(credits)) return '';
    return [...new Set(credits.filter(credit => !roles || text(credit?.role).toLowerCase()
        .split(/[,;/]/).some(role => roles.includes(role.trim())))
        .map(credit => plainText(credit?.name)).filter(Boolean))].join(', ');
}

export function clearComicVineCreditsCache(requestJson) {
    issueCreditCaches.get(requestJson)?.clear();
}

export function clearComicVineCoverCache(requestJson) {
    volumeCoverCaches.get(requestJson)?.clear();
}

export async function getComicVineVolumeCovers(volumeIds, apiKey = '', requestJson, runtime = {}) {
    if (!Array.isArray(volumeIds) || volumeIds.length === 0 || volumeIds.length > PAGE_SIZE) {
        throw providerError('API_INVALID_RESPONSE');
    }
    const ids = [...new Set(volumeIds.map(volumeId))];
    if (ids.some(id => !id)) throw providerError('API_INVALID_RESPONSE');
    if (!text(apiKey)) throw providerError('API_AUTH_REQUIRED');
    let cache = volumeCoverCaches.get(requestJson);
    if (!cache) {
        cache = new BoundedMemoryCache({ maxEntries: 128, maxBytes: 4 * 1024 * 1024 });
        volumeCoverCaches.set(requestJson, cache);
    }
    const key = [...ids].sort().join('|');
    const covers = await cache.getOrLoad(key, async () => {
        const data = await request('volumes', {
            filter: `id:${key}`, limit: String(ids.length),
            field_list: 'id,image,publisher,count_of_issues',
        }, apiKey, requestJson, runtime);
        if (!Array.isArray(data.results)) throw providerError('API_INVALID_RESPONSE');
        const seen = new Set();
        return data.results.map(item => {
            const id = volumeId(item?.id);
            if (!ids.includes(id) || seen.has(id)) throw providerError('API_INVALID_RESPONSE');
            seen.add(id);
            const metadata = volumeMetadata(item);
            return {
                ID: id, CoverUrl: metadata.CoverUrl, CoverUrls: metadata.CoverUrls,
                Publisher: metadata.Publisher, Count: metadata.Count,
            };
        });
    }, { ttlMs: 60 * 60 * 1000 });
    const byId = new Map(covers.map(item => [item.ID, item]));
    return ids.map(id => byId.get(id)).filter(Boolean);
}

export async function getComicVineCreators(id, firstIssueId, apiKey = '', requestJson, runtime = {}) {
    const normalizedId = volumeId(id);
    const issueId = String(firstIssueId ?? '').trim();
    if (!normalizedId || !/^[1-9]\d*$/.test(issueId)) throw providerError('API_INVALID_RESPONSE');
    if (!text(apiKey)) throw providerError('API_AUTH_REQUIRED');
    return withIssueCreators({ first_issue: { id: issueId } }, {
        ID: normalizedId, Writer: '', Penciller: '',
    }, apiKey, requestJson, runtime);
}

async function withIssueCreators(item, metadata, apiKey, requestJson, runtime) {
    if (metadata.Writer && metadata.Penciller) return metadata;
    const id = String(item.first_issue?.id ?? '');
    if (!/^[1-9]\d*$/.test(id)) return metadata;
    let cache = issueCreditCaches.get(requestJson);
    if (!cache) {
        cache = new BoundedMemoryCache({ maxEntries: 256, maxBytes: 2 * 1024 * 1024 });
        issueCreditCaches.set(requestJson, cache);
    }
    const credits = await cache.getOrLoad(`${metadata.ID}:${id}`, async () => {
        const data = await request(`issue/4000-${id}`, {
            field_list: 'id,volume,issue_number,person_credits',
        }, apiKey, requestJson, runtime);
        const issue = data.results;
        if (!issue || Array.isArray(issue) || String(issue.id) !== id || volumeId(issue.volume?.id) !== metadata.ID
            || !Array.isArray(issue.person_credits)) {
            throw providerError('API_INVALID_RESPONSE');
        }
        return {
            Writer: creditNames(issue.person_credits, ['writer', 'script', 'story']),
            Penciller: creditNames(issue.person_credits, ['penciller', 'penciler', 'artist', 'art', 'illustrator', 'illustration']),
            comicVineCreditsIssueId: id,
            comicVineCreditsIssueNumber: String(issue.issue_number ?? item.first_issue.issue_number ?? ''),
            comicVineCreditsIssueWeb: `https://comicvine.gamespot.com/issue/4000-${id}/`,
        };
    }, { ttlMs: 60 * 60 * 1000 });
    return {
        ...metadata,
        ...credits,
        Writer: metadata.Writer || credits.Writer,
        Penciller: metadata.Penciller || credits.Penciller,
    };
}

async function withSearchCreators(volumes, apiKey, requestJson, runtime) {
    const items = volumes.map(volumeMetadata);
    let cursor = 0;
    let stopCode = '';
    const worker = async () => {
        while (!stopCode && cursor < items.length) {
            const index = cursor++;
            try {
                items[index] = await withIssueCreators(volumes[index], items[index], apiKey, requestJson, runtime);
            } catch (error) {
                const code = error.code || 'API_REQUEST_FAILED';
                items[index] = { ...items[index], comicVineCreditsError: code };
                if (STOP_CREDIT_ERRORS.has(code)) stopCode = code;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, items.length) }, worker));
    if (stopCode) {
        for (let index = cursor; index < items.length; index += 1) {
            items[index] = { ...items[index], comicVineCreditsError: stopCode };
        }
    }
    return items;
}

function volumeMetadata(item) {
    const title = plainText(item.name);
    const covers = coverUrls(item.image);
    const year = /^\d{4}$/.test(String(item.start_year || '')) ? String(item.start_year) : '';
    const count = Number(item.count_of_issues);
    const id = volumeId(item.id);
    const people = Array.isArray(item.person_credits) && item.person_credits.length ? item.person_credits : item.people;
    const characters = Array.isArray(item.character_credits) && item.character_credits.length ? item.character_credits : item.characters;
    let web = `https://comicvine.gamespot.com/volume/4050-${id}/`;
    try {
        const url = new URL(text(item.site_detail_url));
        if (url.hostname === 'comicvine.gamespot.com' && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            url.protocol = 'https:';
            web = url.href;
        }
    } catch {
        // The resource ID also provides a stable Comic Vine link.
    }
    return {
        ID: id,
        comicVineFirstIssueId: /^[1-9]\d*$/.test(String(item.first_issue?.id ?? '')) ? String(item.first_issue.id) : '',
        comicVineFirstIssueNumber: String(item.first_issue?.issue_number ?? ''),
        Title: title,
        Series: title,
        LocalizedSeries: title,
        aliases: text(item.aliases).split(/\r?\n/).filter(Boolean),
        Publisher: plainText(item.publisher?.name),
        Summary: plainText(item.description) || plainText(item.deck),
        CoverUrl: covers[0] || '',
        CoverUrls: covers,
        Web: web,
        Count: Number.isInteger(count) && count > 0 ? String(count) : '',
        Year: year,
        PubDate: year,
        Format: 'Comic',
        Writer: creditNames(people, ['writer', 'script', 'story']),
        Penciller: creditNames(people, ['penciller', 'penciler', 'artist', 'art']),
        Inker: creditNames(people, ['inker']),
        Colorist: creditNames(people, ['colorist', 'colourist']),
        Letterer: creditNames(people, ['letterer']),
        CoverArtist: creditNames(people, ['cover', 'cover artist']),
        Editor: creditNames(people, ['editor']),
        Characters: creditNames(characters),
    };
}

async function request(resource, parameters, apiKey, requestJson, runtime) {
    const key = text(apiKey);
    if (!key) throw providerError('API_AUTH_REQUIRED');
    let schedule = requestSchedules.get(requestJson);
    if (!schedule) {
        schedule = new Map();
        requestSchedules.set(requestJson, schedule);
    }
    const now = runtime.now ? runtime.now() : Date.now();
    const bucket = resource.split('/')[0];
    const start = Math.max(now, schedule.get(bucket) || 0);
    schedule.set(bucket, start + 1100);
    if (start > now) await (runtime.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(start - now);
    const params = new URLSearchParams({ api_key: key, format: 'json', ...parameters });
    let data;
    try {
        data = await requestJson(`${API_BASE}${resource}/?${params}`, {
            'User-Agent': 'BookManager (desktop metadata search)',
            Accept: 'application/json',
        }, 15000);
    } catch (error) {
        if (error?.statusCode === 401) throw providerError('API_AUTH_FAILED');
        if (error?.statusCode === 403) throw providerError('API_ACCESS_BLOCKED');
        if (error?.statusCode === 429 || error?.message === 'RATE_LIMIT') throw providerError('API_RATE_LIMIT');
        if (error instanceof SyntaxError) throw providerError('API_INVALID_RESPONSE');
        throw providerError('API_REQUEST_FAILED');
    }
    const status = Number(data?.status_code);
    if (status === 100) throw providerError('API_AUTH_FAILED');
    if (/rate.?limit|too many requests/i.test(text(data?.error))) throw providerError('API_RATE_LIMIT');
    if (status !== 1) throw providerError('API_INVALID_RESPONSE');
    return data;
}

// https://comicvine.gamespot.com/api/documentation#toc-0-30
export async function searchComicVine(query, apiKey = '', page = 1, requestJson, runtime = {}) {
    const searchQuery = text(query);
    if (!searchQuery) return [];
    const pageNumber = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const offset = (pageNumber - 1) * PAGE_SIZE;
    // Current docs specify offset; page also supports the older search endpoint contract.
    const data = await request('search', {
        resources: 'volume', query: searchQuery, limit: String(PAGE_SIZE), offset: String(offset),
        page: String(pageNumber), field_list: `${VOLUME_FIELDS},resource_type`,
    }, apiKey, requestJson, runtime);
    if (!Array.isArray(data.results)) throw providerError('API_INVALID_RESPONSE');
    const volumes = data.results.filter(item => item && volumeId(item.id) && text(item.name)
        && (!item.resource_type || item.resource_type === 'volume'));
    let items = runtime.deferCreators ? volumes.map(volumeMetadata) : await withSearchCreators(volumes, apiKey, requestJson, runtime);
    const missingCovers = items.filter(item => !item.CoverUrl).map(item => item.ID);
    if (!runtime.deferCreators && missingCovers.length > 0) {
        try {
            const covers = await getComicVineVolumeCovers(missingCovers, apiKey, requestJson, runtime);
            const byId = new Map(covers.map(item => [item.ID, item]));
            items = items.map(item => {
                const cover = byId.get(item.ID);
                return cover ? {
                    ...item, CoverUrl: cover.CoverUrl, CoverUrls: cover.CoverUrls,
                    Publisher: item.Publisher || cover.Publisher, Count: item.Count || cover.Count,
                } : item;
            });
        } catch (error) {
            items = items.map(item => item.CoverUrl ? item : { ...item, comicVineCoversError: error.code || 'API_REQUEST_FAILED' });
        }
    }
    const total = Number(data.number_of_total_results);
    const returnedOffset = Number(data.offset);
    items.hasNext = data.number_of_total_results != null && Number.isFinite(total) && total >= 0
        ? (data.offset != null && Number.isFinite(returnedOffset) ? returnedOffset : offset) + data.results.length < total
        : data.results.length >= PAGE_SIZE;
    return items;
}

// https://comicvine.gamespot.com/api/documentation#toc-0-42
export async function getComicVineVolume(id, apiKey = '', requestJson, runtime = {}) {
    const normalizedId = volumeId(id);
    if (!normalizedId) throw providerError('API_INVALID_RESPONSE');
    const data = await request(`volume/4050-${normalizedId}`, {
        field_list: `${VOLUME_FIELDS},person_credits,character_credits,people,characters`,
    }, apiKey, requestJson, runtime);
    if (!data.results || Array.isArray(data.results) || volumeId(data.results.id) !== normalizedId || !text(data.results.name)) {
        throw providerError('API_INVALID_RESPONSE');
    }
    const metadata = volumeMetadata(data.results);
    try {
        return { ...await withIssueCreators(data.results, metadata, apiKey, requestJson, runtime), comicVineDetailResolved: true };
    } catch (error) {
        return { ...metadata, comicVineCreditsError: error.code || 'API_REQUEST_FAILED' };
    }
}
