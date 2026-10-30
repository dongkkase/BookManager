import https from 'node:https';
import { BoundedMemoryCache } from './boundedMemoryCache.js';
import { requestAuthorProfileText } from './authorProfileWebRequest.js';
import { searchAladinAuthors, searchKyoboAuthors } from './bookstoreAuthorProfiles.js';
import { searchCartoonAuthors, searchKmasAuthors } from './comicsAuthorProfiles.js';
import { createGoogleSearchCancellationCheck, searchGoogleAuthors, searchNamuAuthors } from './authorWebProfiles.js';

const WEB_SOURCES = { aladin: searchAladinAuthors, kyobo: searchKyoboAuthors, cartoon: searchCartoonAuthors, kmas: searchKmasAuthors, google: searchGoogleAuthors, namuwiki: searchNamuAuthors };
const SOURCE_IDS = ['wikidata', 'wikipedia', 'openlibrary', ...Object.keys(WEB_SOURCES)];

const PROFILE_LIMIT = 8;
const WIKIPEDIA_LIMIT = 4;
const REQUEST_INTERVAL_MS = 1050;
const REQUEST_TIMEOUT_MS = 12000;
const RATE_LIMIT_BACKOFF_MS = 60000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MANUAL_CACHE_TTL_MS = 7 * CACHE_TTL_MS;
const MANUAL_CACHE_NAMESPACE = 'author-profiles-v1';
const USER_AGENT = 'BookManager author profiles (https://github.com/dongkkase/BookManager)';
const ERROR_MESSAGES = {
    AUTHOR_PROFILE_INVALID_QUERY: 'Enter an author name of up to 200 characters.',
    AUTHOR_PROFILE_INVALID_SOURCE: 'Choose an available author profile source.',
    AUTHOR_PROFILE_ACCESS_BLOCKED: 'The author profile source is blocking this request.',
    AUTHOR_PROFILE_CANCELLED: 'Author profile search was cancelled.',
    AUTHOR_PROFILE_UNTRUSTED_SENDER: 'Author profiles are only available in the main library window.',
    AUTHOR_PROFILE_RATE_LIMIT: 'The author profile service is receiving too many requests. Try again later.',
    AUTHOR_PROFILE_TIMEOUT: 'The author profile request timed out. Try again later.',
    AUTHOR_PROFILE_INVALID_RESPONSE: 'The author profile service returned an invalid response.',
    AUTHOR_PROFILE_REQUEST_FAILED: 'Author profiles could not be loaded. Try again later.',
};

function profileError(code) {
    const error = new Error(ERROR_MESSAGES[code]);
    error.code = code;
    return error;
}

function cleanText(value, limit = 300) {
    return typeof value === 'string'
        ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
}

function normalizeProfiles(data) {
    if (!Array.isArray(data?.docs)) throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
    const seen = new Set();
    return data.docs.slice(0, PROFILE_LIMIT).flatMap(item => {
        const id = typeof item?.key === 'string' ? item.key.replace(/^\/authors\//, '') : '';
        const name = cleanText(item?.name);
        if (!/^OL[1-9]\d{0,14}A$/.test(id) || !name || seen.has(id)) return [];
        seen.add(id);
        return [{
            id,
            provider: 'openlibrary',
            name,
            alternateNames: Array.isArray(item.alternate_names)
                ? [...new Set(item.alternate_names.slice(0, 12).map(value => cleanText(value)).filter(Boolean))] : [],
            birthDate: cleanText(item.birth_date, 100),
            deathDate: cleanText(item.death_date, 100),
            topWork: cleanText(item.top_work),
            works: cleanText(item.top_work) ? [cleanText(item.top_work)] : [],
            photoUrl: `https://covers.openlibrary.org/a/olid/${id}-M.jpg?default=false`,
            sourceUrl: `https://openlibrary.org/authors/${id}`,
        }];
    });
}

export function requestAuthorProfilesJson(url, { get = https.get, timeoutMs = REQUEST_TIMEOUT_MS, now = Date.now } = {}) {
    let target;
    try {
        target = new URL(url);
    } catch {
        return Promise.reject(profileError('AUTHOR_PROFILE_REQUEST_FAILED'));
    }
    const endpoint = target.origin === 'https://openlibrary.org' && target.pathname === '/search/authors.json'
        || ['https://www.wikidata.org', 'https://commons.wikimedia.org', 'https://ko.wikipedia.org', 'https://ja.wikipedia.org', 'https://en.wikipedia.org'].includes(target.origin)
            && target.pathname === '/w/api.php';
    if (!endpoint || target.href.length > 12000 || target.username || target.password || target.hash) {
        return Promise.reject(profileError('AUTHOR_PROFILE_REQUEST_FAILED'));
    }
    return new Promise((resolve, reject) => {
        let request;
        let settled = false;
        const timeout = setTimeout(() => {
            const error = profileError('AUTHOR_PROFILE_TIMEOUT');
            finish(error);
            request?.destroy(error);
        }, timeoutMs);
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(result);
        };
        try {
            request = get(target, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            }, response => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    response.resume();
                    const retryAfter = response.headers?.['retry-after'];
                    const retryAfterMs = typeof retryAfter === 'string'
                        ? /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now()
                        : 0;
                    const rateLimited = response.statusCode === 429 || response.statusCode === 503 && retryAfterMs > 0;
                    const error = profileError(rateLimited ? 'AUTHOR_PROFILE_RATE_LIMIT' : 'AUTHOR_PROFILE_REQUEST_FAILED');
                    if (rateLimited && Number.isFinite(retryAfterMs) && retryAfterMs > 0) error.retryAfterMs = retryAfterMs;
                    finish(error);
                    return;
                }
                let bytes = 0;
                const chunks = [];
                response.on('data', chunk => {
                    if (settled) return;
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > MAX_RESPONSE_BYTES) {
                        const error = profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
                        finish(error);
                        response.destroy();
                        request.destroy(error);
                        return;
                    }
                    chunks.push(Buffer.from(chunk));
                });
                response.on('end', () => {
                    try {
                        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
                    } catch {
                        finish(profileError('AUTHOR_PROFILE_INVALID_RESPONSE'));
                    }
                });
                response.on('error', () => finish(profileError('AUTHOR_PROFILE_REQUEST_FAILED')));
                response.on('aborted', () => finish(profileError('AUTHOR_PROFILE_REQUEST_FAILED')));
            });
            request.on('error', error => finish(ERROR_MESSAGES[error.code] ? error : profileError('AUTHOR_PROFILE_REQUEST_FAILED')));
        } catch {
            finish(profileError('AUTHOR_PROFILE_REQUEST_FAILED'));
        }
    });
}

function queryLanguage(query) {
    if (/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/.test(query)) return 'ko';
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(query)) return 'ja';
    return 'en';
}

function nameKey(value) {
    return cleanText(value).normalize('NFC').toLocaleLowerCase('en-US');
}

function apiUrl(host, params) {
    return `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })}`;
}

function entityValues(entity, property) {
    return Array.isArray(entity?.claims?.[property]) ? entity.claims[property]
        .filter(claim => claim?.rank !== 'deprecated' && claim?.mainsnak?.snaktype === 'value')
        .map(claim => claim.mainsnak.datavalue?.value).filter(value => value !== undefined).slice(0, 12) : [];
}

function entityIds(entity, property) {
    return entityValues(entity, property).map(value => value?.id).filter(id => /^Q[1-9]\d{0,14}$/.test(id));
}

function isHuman(entity) {
    return /^Q[1-9]\d{0,14}$/.test(entity?.id) && entityIds(entity, 'P31').includes('Q5');
}

function isAuthor(entity) {
    const occupations = ['Q36180', 'Q49757', 'Q4853732', 'Q644687', 'Q715301'];
    return entityIds(entity, 'P106').some(id => occupations.includes(id))
        || translatedValues(entity, 'descriptions', 'en').some(value => /\b(?:writer|author|novelist|poet|mangaka|cartoonist|illustrator|essayist|journalist|playwright|historian|philosopher|comics? artist)\b|작가|소설가|시인|만화가|저술가|수필가|삽화가|漫画家|作家|小説家|著作家|詩人|翻訳家|イラストレーター/i.test(value));
}

function translatedValues(entity, property, language) {
    return [...new Set([language, 'ko', 'ja', 'en'])].flatMap(key => {
        const values = entity?.[property]?.[key];
        return (Array.isArray(values) ? values : [values]).map(item => cleanText(item?.value, 600)).filter(Boolean);
    });
}

function entityDate(entity, property) {
    const value = entityValues(entity, property)[0];
    if (!/^[+-]\d{4,16}-\d{2}-\d{2}T/.test(value?.time)) return '';
    const date = value.time.split('T')[0].replace(/^\+/, '');
    return value.precision >= 11 ? date : value.precision >= 10 ? date.slice(0, -3) : date.slice(0, -6);
}

function imageName(value) {
    if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f|#?]/.test(value)) return '';
    const name = value.replace(/^(?:File|Image|파일|ファイル|画像):/i, '').trim();
    return /\.(?:jpe?g|png|webp|gif)$/i.test(name) ? name : '';
}

function imageKey(value) {
    return value.replace(/^(?:File|Image|파일|ファイル|画像):/i, '').replace(/_/g, ' ').normalize('NFC');
}

function safeImageUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
        const url = new URL(value);
        if ([...url.searchParams.keys()].some(key => !['utm_source', 'utm_campaign', 'utm_content'].includes(key))) return '';
        url.search = '';
        return ['https://upload.wikimedia.org', 'https://thumb.wikimedia.org'].includes(url.origin)
            && !url.username && !url.password && !url.search && !url.hash
            && /^\/wikipedia\/(?:commons|ko|ja|en)\//.test(url.pathname)
            && /\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname) ? url.href : '';
    } catch {
        return '';
    }
}

function metadataText(value) {
    if (typeof value !== 'string') return '';
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return cleanText(value.slice(0, 6000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
            if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
            const codePoint = /^#x/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
        }), 600);
}

function imageProfile(page, host) {
    const info = page?.imageinfo?.[0];
    const name = imageName(page?.title);
    const photoUrl = safeImageUrl(info?.thumburl);
    if (!name || !photoUrl || !/^image\/(?:jpeg|png|webp|gif)$/.test(info.thumbmime || info.mime)
        || !(info.thumbwidth > 0 && info.thumbwidth <= 640 && info.thumbheight > 0 && info.thumbheight <= 640)) return null;
    let sourceHost = host;
    try {
        const descriptionUrl = new URL(info.descriptionurl);
        if (descriptionUrl.origin === 'https://commons.wikimedia.org') sourceHost = 'commons.wikimedia.org';
    } catch {
        // A fixed host and the validated file name provide a safe attribution link.
    }
    return {
        photoUrl,
        imageSourceUrl: `https://${sourceHost}/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}`,
        imageLicense: metadataText(info.extmetadata?.LicenseShortName?.value),
        imageArtist: metadataText(info.extmetadata?.Artist?.value),
    };
}

function responsePages(data) {
    if (!data?.query || !Array.isArray(data.query.pages)) throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
    return data.query.pages;
}

export function createAuthorProfileService({ requestJson = requestAuthorProfilesJson, requestText = requestAuthorProfileText, webSearchers = WEB_SOURCES, resultCache, getMainWindow, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const cache = new BoundedMemoryCache({ maxEntries: 128, maxBytes: 1024 * 1024, now });
    const responses = new BoundedMemoryCache({ maxEntries: 128, maxBytes: 4 * 1024 * 1024, now });
    const providers = new Map();
    const manualRequests = new Map();

    function cachedManualSearch(key, source, load) {
        if (!resultCache) return cache.getOrLoad(key, load, { ttlMs: MANUAL_CACHE_TTL_MS });
        if (manualRequests.has(key)) return manualRequests.get(key);
        const request = (async () => {
            try {
                const entry = await resultCache.get(MANUAL_CACHE_NAMESPACE, key);
                if (entry?.expiresAt > now() && entry.expiresAt <= now() + MANUAL_CACHE_TTL_MS
                    && Array.isArray(entry.value) && entry.value.length <= PROFILE_LIMIT
                    && entry.value.every(profile => profile && profile.provider === source
                        && typeof profile.id === 'string' && typeof profile.name === 'string')) return entry.value;
            } catch { /* Search remains available when the cache cannot be read. */ }
            const profiles = await load();
            if (!profiles.partial) {
                try { await resultCache.set(MANUAL_CACHE_NAMESPACE, key, profiles); }
                catch { /* A cache write failure must not discard search results. */ }
            }
            return profiles;
        })().finally(() => { manualRequests.delete(key); });
        manualRequests.set(key, request);
        return request;
    }

    function request(url, textOptions, responseKeys) {
        const responseKey = textOptions ? `text:${textOptions.method || 'GET'}:${url}:${textOptions.body || ''}` : url;
        responseKeys?.add(responseKey);
        return responses.getOrLoad(responseKey, () => {
            const host = new URL(url).host;
            let state = providers.get(host);
            if (!state) {
                state = { queue: Promise.resolve(), nextRequestAt: 0, retryAt: 0 };
                providers.set(host, state);
            }
            const result = state.queue.then(async () => {
                if (state.retryAt > now()) throw profileError('AUTHOR_PROFILE_RATE_LIMIT');
                const delay = Math.max(0, state.nextRequestAt - now());
                if (delay) await sleep(delay);
                state.nextRequestAt = now() + REQUEST_INTERVAL_MS;
                try {
                    if (textOptions) {
                        const text = await requestText(url, textOptions);
                        if (typeof text !== 'string' || !text.trim()) throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
                        return text;
                    }
                    const data = await requestJson(url);
                    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) {
                        throw profileError(['ratelimited', 'maxlag'].includes(data?.error?.code)
                            ? 'AUTHOR_PROFILE_RATE_LIMIT' : 'AUTHOR_PROFILE_INVALID_RESPONSE');
                    }
                    const target = new URL(url);
                    const action = target.searchParams.get('action');
                    if (host === 'openlibrary.org' && !Array.isArray(data.docs)
                        || action === 'wbsearchentities' && !Array.isArray(data.search)
                        || action === 'wbgetentities' && (!data.entities || typeof data.entities !== 'object' || Array.isArray(data.entities))
                        || action === 'query' && !(Array.isArray(data.query?.pages) || data.batchcomplete && !data.query)) {
                        throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
                    }
                    return data;
                } catch (error) {
                    if (error?.code === 'AUTHOR_PROFILE_RATE_LIMIT') {
                        const retryAfterMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0;
                        state.retryAt = now() + Math.max(RATE_LIMIT_BACKOFF_MS, retryAfterMs);
                    }
                    throw error;
                }
            });
            state.queue = result.catch(() => {});
            return result;
        }, { ttlMs: CACHE_TTL_MS });
    }

    async function getEntities(ids, labelsOnly = false) {
        const uniqueIds = [...new Set(ids.filter(id => /^Q[1-9]\d{0,14}$/.test(id)))].sort().slice(0, 48);
        if (!uniqueIds.length) return {};
        const data = await request(apiUrl('www.wikidata.org', {
            action: 'wbgetentities', ids: uniqueIds.join('|'), languages: 'ko|ja|en',
            props: labelsOnly ? 'labels|aliases' : 'labels|aliases|descriptions|claims',
        }));
        if (!data.entities || typeof data.entities !== 'object' || Array.isArray(data.entities)) throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
        return data.entities;
    }

    async function getImages(names, host = 'commons.wikimedia.org') {
        const uniqueNames = [...new Set(names.map(imageName).filter(Boolean))].sort().slice(0, PROFILE_LIMIT);
        if (!uniqueNames.length) return new Map();
        const pages = responsePages(await request(apiUrl(host, {
            action: 'query', titles: uniqueNames.map(name => `File:${name}`).join('|'), prop: 'imageinfo',
            iiprop: 'url|mime|thumbmime|extmetadata', iiurlwidth: '320', iiurlheight: '400',
            iiextmetadatafilter: 'Artist|LicenseShortName',
        })));
        const images = new Map();
        for (const page of pages.slice(0, PROFILE_LIMIT)) {
            const profile = imageProfile(page, host);
            if (profile) images.set(imageKey(page.title), profile);
        }
        return images;
    }

    async function entityProfiles(entities, language, attempt) {
        const humans = entities.filter(isHuman).slice(0, PROFILE_LIMIT);
        const workIds = humans.flatMap(entity => entityIds(entity, 'P800').slice(0, 6));
        const workEntities = await attempt(() => getEntities(workIds, true), {});
        return humans.map(entity => {
            const names = [...new Set([...translatedValues(entity, 'labels', language), ...translatedValues(entity, 'aliases', language)])];
            const works = [...new Set(entityIds(entity, 'P800').flatMap(id => [
                ...translatedValues(workEntities[id], 'labels', language), ...translatedValues(workEntities[id], 'aliases', language),
            ]))].slice(0, 24);
            return {
                id: entity.id, entityId: entity.id, provider: 'wikidata', authorVerified: isAuthor(entity), name: names[0] || '', alternateNames: names.slice(1, 25),
                birthDate: entityDate(entity, 'P569'), deathDate: entityDate(entity, 'P570'), topWork: works[0] || '', works,
                description: translatedValues(entity, 'descriptions', language)[0] || '', photoUrl: '',
                sourceUrl: `https://www.wikidata.org/wiki/${entity.id}`,
            };
        }).filter(profile => profile.name);
    }

    async function searchWikidata(query, language, attempt) {
        const data = await request(apiUrl('www.wikidata.org', {
            action: 'wbsearchentities', search: query, language, uselang: language, type: 'item', limit: String(PROFILE_LIMIT),
        }));
        if (!Array.isArray(data.search)) throw profileError('AUTHOR_PROFILE_INVALID_RESPONSE');
        const ids = data.search.slice(0, PROFILE_LIMIT).map(item => item?.id).filter(id => /^Q[1-9]\d{0,14}$/.test(id));
        const entities = await getEntities(ids);
        const humans = ids.map(id => entities[id]).filter(isHuman);
        const [profiles, images] = await Promise.all([
            entityProfiles(humans, language, attempt),
            attempt(() => getImages(humans.map(entity => entityValues(entity, 'P18')[0])), new Map()),
        ]);
        return profiles.map(profile => ({ ...profile, ...images.get(imageKey(imageName(entityValues(entities[profile.id], 'P18')[0]))) }));
    }

    async function searchWikipedia(query, language, attempt) {
        const host = `${language}.wikipedia.org`;
        const data = await request(apiUrl(host, {
            action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: String(WIKIPEDIA_LIMIT),
            prop: 'pageimages|pageprops', piprop: 'name', pilicense: 'free', ppprop: 'wikibase_item|disambiguation',
        }));
        if (data?.batchcomplete && !data.query) return [];
        const pages = responsePages(data).filter(page => page?.ns === 0 && Number.isSafeInteger(page.pageid) && page.pageid > 0
            && /^Q[1-9]\d{0,14}$/.test(page.pageprops?.wikibase_item) && !Object.hasOwn(page.pageprops, 'disambiguation')).slice(0, WIKIPEDIA_LIMIT);
        const entities = await getEntities(pages.map(page => page.pageprops.wikibase_item));
        const humanPages = pages.filter(page => isHuman(entities[page.pageprops.wikibase_item]));
        const [profiles, images] = await Promise.all([
            entityProfiles(humanPages.map(page => entities[page.pageprops.wikibase_item]), language, attempt),
            attempt(() => getImages(humanPages.map(page => page.pageimage), host), new Map()),
        ]);
        return humanPages.flatMap(page => {
            const profile = profiles.find(candidate => candidate.entityId === page.pageprops.wikibase_item);
            const title = cleanText(page.title, 300);
            if (!profile || !title) return [];
            return [{
                ...profile, id: `wikipedia:${language}:${page.pageid}`, provider: 'wikipedia',
                alternateNames: [...new Set([...profile.alternateNames, title.replace(/\s*\([^()]*\)$/, '')])].slice(0, 24),
                sourceUrl: `https://${host}/?curid=${page.pageid}`,
                ...images.get(imageKey(imageName(page.pageimage))),
            }];
        });
    }

    const service = {
        async search(name, options) {
            if (typeof name !== 'string' || name.length > 200 || !cleanText(name)) throw profileError('AUTHOR_PROFILE_INVALID_QUERY');
            const query = cleanText(name, 200).normalize('NFC');
            const source = options?.source || 'all';
            if (source !== 'all' && !SOURCE_IDS.includes(source)) throw profileError('AUTHOR_PROFILE_INVALID_SOURCE');
            const allSources = options?.allSources === true || source !== 'all';
            if (allSources && source === 'all') {
                const sources = ['wikidata', 'wikipedia', 'openlibrary', ...Object.keys(webSearchers)];
                const settled = await Promise.allSettled(sources.map(provider => service.search(query, { source: provider, photos: options?.photos === true })));
                const failedSources = [];
                const profiles = [];
                let firstError;
                for (const [index, result] of settled.entries()) {
                    if (result.status === 'fulfilled') {
                        profiles.push(...result.value);
                        if (result.value.partial) failedSources.push(...result.value.failedSources);
                    } else {
                        firstError ||= result.reason;
                        failedSources.push({ source: sources[index], code: ERROR_MESSAGES[result.reason?.code] ? result.reason.code : 'AUTHOR_PROFILE_REQUEST_FAILED' });
                    }
                }
                if (!profiles.length && firstError) {
                    const error = profileError(ERROR_MESSAGES[firstError?.code] ? firstError.code : 'AUTHOR_PROFILE_REQUEST_FAILED');
                    error.failedSources = failedSources;
                    throw error;
                }
                const seen = new Set();
                const sorted = profiles.sort((a, b) => Number(Boolean(b.photoUrl)) - Number(Boolean(a.photoUrl)))
                    .filter(profile => !seen.has(profile.id) && seen.add(profile.id)).slice(0, PROFILE_LIMIT * SOURCE_IDS.length);
                if (failedSources.length) {
                    Object.defineProperty(sorted, 'partial', { value: true });
                    Object.defineProperty(sorted, 'failedSources', { value: failedSources });
                }
                return sorted;
            }
            const includes = value => source === 'all' || source === value;
            const isCancelled = source === 'google' ? createGoogleSearchCancellationCheck(getMainWindow?.()) : undefined;
            const cacheKey = `${allSources ? source : 'auto'}${source === 'google' && options?.photos ? ':photos' : ''}:${query.toLocaleLowerCase('en-US')}`;
            const load = async () => {
                const language = queryLanguage(query);
                const errors = [];
                const failedSources = new Map();
                let successes = 0;
                const attempt = async (load, fallback, provider) => {
                    try {
                        const value = await load();
                        successes += 1;
                        return value;
                    } catch (error) {
                        errors.push(error);
                        if (provider) failedSources.set(provider, {
                            source: provider, code: ERROR_MESSAGES[error?.code] ? error.code : 'AUTHOR_PROFILE_REQUEST_FAILED',
                        });
                        return fallback;
                    }
                };
                const webRequests = allSources ? Object.entries(webSearchers).filter(([provider]) => includes(provider)).map(([provider, search]) =>
                    attempt(async () => {
                        const responseKeys = new Set();
                        let successful = false;
                        try {
                            const found = await search(query, (url, requestOptions = {}) => request(url, requestOptions, responseKeys),
                                { photos: options?.photos === true, getMainWindow, isCancelled });
                            if (found.partial) failedSources.set(provider, { source: provider, code: 'AUTHOR_PROFILE_REQUEST_FAILED' });
                            successful = !found.partial;
                            return found.slice(0, PROFILE_LIMIT);
                        } finally {
                            if (!successful) for (const key of responseKeys) responses.delete(key);
                        }
                    }, [], provider)) : [];
                const profiles = includes('wikidata') ? await attempt(() => searchWikidata(query, language,
                    (load, fallback) => attempt(load, fallback, 'wikidata')), [], 'wikidata') : [];
                const hasExactPhoto = () => {
                    const matches = profiles.filter(profile => profile.authorVerified
                        && [profile.name, ...profile.alternateNames].some(value => nameKey(value) === nameKey(query)));
                    return matches.some(profile => profile.photoUrl) && new Set(matches.map(profile => profile.entityId || profile.id)).size === 1;
                };
                for (const wikiLanguage of [...new Set([language, 'en'])]) {
                    if (!includes('wikipedia') || !allSources && hasExactPhoto()) break;
                    profiles.push(...await attempt(() => searchWikipedia(query, wikiLanguage,
                        (load, fallback) => attempt(load, fallback, 'wikipedia')), [], 'wikipedia'));
                }
                if (includes('openlibrary') && (allSources || !hasExactPhoto())) {
                    profiles.push(...await attempt(async () => {
                        const params = new URLSearchParams({ q: query, limit: String(PROFILE_LIMIT) });
                        return normalizeProfiles(await request(`https://openlibrary.org/search/authors.json?${params}`));
                    }, [], 'openlibrary'));
                }
                profiles.push(...(await Promise.all(webRequests)).flat());
                if ((!successes || !profiles.length) && errors.length) {
                    const error = profileError(ERROR_MESSAGES[errors[0]?.code] ? errors[0].code : 'AUTHOR_PROFILE_REQUEST_FAILED');
                    error.failedSources = [...failedSources.values()];
                    throw error;
                }
                const seen = new Set();
                const sorted = profiles.sort((a, b) => Number(Boolean(b.photoUrl)) - Number(Boolean(a.photoUrl)))
                    .filter(profile => !seen.has(profile.id) && seen.add(profile.id)).slice(0, PROFILE_LIMIT * (allSources ? SOURCE_IDS.length : 3));
                if (errors.length || failedSources.size) {
                    Object.defineProperty(sorted, 'partial', { value: true });
                    Object.defineProperty(sorted, 'failedSources', { value: [...failedSources.values()] });
                }
                return sorted;
            };
            const result = await (allSources ? cachedManualSearch(cacheKey, source, load)
                : cache.getOrLoad(cacheKey, load, { ttlMs: CACHE_TTL_MS }));
            if (result.partial) cache.delete(cacheKey);
            return result;
        },
    };
    return service;
}

export function registerAuthorProfilesIpc({ ipcMain, getMainWindow, resultCache, service = createAuthorProfileService({ resultCache, getMainWindow }) }) {
    ipcMain.handle('authors:searchProfiles', async (event, name, options) => {
        try {
            const window = getMainWindow?.();
            if (!window || window.isDestroyed() || window.webContents !== event.sender
                || event.sender.isDestroyed() || (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) {
                throw profileError('AUTHOR_PROFILE_UNTRUSTED_SENDER');
            }
            const sourceOptions = { allSources: options?.allSources === true };
            if (options?.photos === true) sourceOptions.photos = true;
            if (options?.source !== undefined) sourceOptions.source = options.source;
            const profiles = await service.search(name, sourceOptions);
            return { success: true, profiles, ...(profiles.partial ? { partial: true, failedSources: profiles.failedSources || [] } : {}) };
        } catch (error) {
            const code = ERROR_MESSAGES[error?.code] ? error.code : 'AUTHOR_PROFILE_REQUEST_FAILED';
            return { success: false, profiles: [], error: ERROR_MESSAGES[code], code, ...(error?.failedSources ? { failedSources: error.failedSources } : {}) };
        }
    });
}
