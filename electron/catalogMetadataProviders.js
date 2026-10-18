import { decodeHTML } from 'entities';

const PAGE_SIZE = 20;
const USER_AGENT = 'BookManager (desktop metadata search)';
const REQUEST_INTERVALS = { openlibrary: 1050, itunes: 3050, hardcover: 1050, ranobedb: 1050 };
const requestSchedules = new WeakMap();
const ERROR_MESSAGES = {
    API_AUTH_REQUIRED: 'An API token is required. Check the metadata search settings.',
    API_AUTH_FAILED: 'API authentication failed. Check the metadata search settings.',
    API_RATE_LIMIT: 'The metadata service request limit was reached. Try again later.',
    API_INVALID_RESPONSE: 'The metadata service returned an invalid response.',
    API_REQUEST_FAILED: 'The metadata service request failed. Try again later.',
};

function providerError(code) {
    const error = new Error(ERROR_MESSAGES[code]);
    error.code = code;
    return error;
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function plainText(value) {
    return decodeHTML(text(value)
        .replace(/<\s*br\s*\/?\s*>|<\/\s*p\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ''))
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function strings(value) {
    return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
}

function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(number) : '';
}

function recordId(value) {
    const id = String(value ?? '');
    return /^[1-9]\d*$/.test(id) ? id : '';
}

function safeUrl(value, hosts) {
    try {
        const url = new URL(text(value));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
        if (!hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
        url.protocol = 'https:';
        return url.href;
    } catch {
        return '';
    }
}

function dateFields(value) {
    const source = String(value ?? '');
    const compact = /^\d{8}$/.test(source) ? `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}` : source;
    const match = compact.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T.*)?$/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) >= 9999) return {};
    const fields = { Year: match[1], PubDate: match[1] };
    const month = Number(match[2]);
    if (month < 1 || month > 12 || !Number.isInteger(month)) return fields;
    fields.Month = String(month);
    fields.PubDate += `-${match[2]}`;
    const day = Number(match[3]);
    const maxDay = new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate();
    if (day < 1 || day > maxDay || !Number.isInteger(day)) return fields;
    fields.Day = String(day);
    fields.PubDate += `-${match[3]}`;
    return fields;
}

function isbn(value) {
    const candidates = strings(value).map(item => item.replace(/[\s-]/g, ''));
    return candidates.find(item => /^\d{13}$/.test(item))
        || candidates.find(item => /^\d{9}[\dX]$/i.test(item)) || '';
}

function language(value) {
    const source = text(value);
    const aliases = { eng: 'en', jpn: 'ja', kor: 'ko', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', chi: 'zh', zho: 'zh', ita: 'it', por: 'pt', rus: 'ru' };
    return aliases[source] || source;
}

function ratingFields(value) {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating <= 0 || rating > 5) return {};
    return { CommunityRating: String(rating * 2), RatingScore: String(rating), Rating: `${rating} / 5.0` };
}

async function request(provider, runtime, method, ...args) {
    const fn = runtime[method];
    if (typeof fn !== 'function') throw providerError('API_REQUEST_FAILED');
    let schedule = requestSchedules.get(fn);
    if (!schedule) {
        schedule = new Map();
        requestSchedules.set(fn, schedule);
    }
    const now = typeof runtime.now === 'function' ? runtime.now() : Date.now();
    const start = Math.max(now, schedule.get(provider) || 0);
    schedule.set(provider, start + REQUEST_INTERVALS[provider]);
    const delay = start - now;
    if (delay > 0) {
        const sleep = runtime.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        await sleep(delay);
    }
    return fn(...args);
}

async function searchOpenLibrary({ query, page }, runtime) {
    const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: String(PAGE_SIZE),
        fields: 'key,title,author_name,cover_i,first_publish_year,subject,ratings_average,editions,editions.key,editions.title,editions.publisher,editions.isbn,editions.language,editions.cover_i,editions.publish_date',
    });
    const data = await request('openlibrary', runtime, 'requestJson', `https://openlibrary.org/search.json?${params}`, { 'User-Agent': USER_AGENT });
    if (!Array.isArray(data?.docs)) throw providerError('API_INVALID_RESPONSE');
    return data.docs.slice(0, PAGE_SIZE).flatMap(item => {
        if (!item || !text(item.title)) return [];
        const key = text(item.key);
        const workId = key.match(/^(?:\/works\/)?(OL\d+W)$/)?.[1];
        if (!workId) return [];
        const edition = Array.isArray(item.editions?.docs) ? item.editions.docs[0] || {} : {};
        const editionId = text(edition.key).match(/^\/books\/(OL\d+M)$/)?.[1];
        const coverId = recordId(edition.cover_i || item.cover_i);
        const subjects = strings(item.subject).slice(0, 10).join(', ');
        return [{
            ID: editionId || workId,
            Title: text(edition.title) || text(item.title),
            Series: '',
            Writer: strings(item.author_name).join(', '),
            Publisher: strings(edition.publisher).join(', '),
            ISBN: isbn(edition.isbn),
            CoverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
            Web: `https://openlibrary.org/${editionId ? `books/${editionId}` : `works/${workId}`}`,
            Genre: subjects,
            Tags: subjects,
            LanguageISO: language(strings(edition.language)[0]),
            ...dateFields(strings(edition.publish_date)[0] || edition.publish_date || item.first_publish_year),
            ...ratingFields(item.ratings_average),
        }];
    });
}

function itunesCover(item, resolution) {
    const cover = safeUrl(item.artworkUrl100 || item.artworkUrl60, ['mzstatic.com', 'itunes.apple.com']);
    if (!cover || resolution === 'standard') return cover;
    return cover.replace(/\/\d+x\d+(?:bb)?(?:-\d+)?\.(jpg|png)(?=\?|$)/i, '/1200x1200bb.$1');
}

async function searchItunes({ query, page, bookType, settings }, runtime) {
    // The public Search API has a limit parameter, but no documented pagination parameter.
    if (page > 1) return [];
    const configuredCountry = text(settings.itunes_country).toUpperCase();
    const country = /^[A-Z]{2}$/.test(configuredCountry) ? configuredCountry : 'US';
    const media = bookType === 'audio' ? 'audiobook' : 'ebook';
    const params = new URLSearchParams({ term: query, country, media, entity: media, limit: String(PAGE_SIZE) });
    const data = await request('itunes', runtime, 'requestJson', `https://itunes.apple.com/search?${params}`);
    if (!Array.isArray(data?.results)) throw providerError('API_INVALID_RESPONSE');
    return data.results.slice(0, PAGE_SIZE).flatMap(item => {
        if (!item || (media === 'ebook' ? item.kind !== 'ebook' : item.wrapperType !== 'audiobook')) return [];
        const title = text(media === 'ebook' ? item.trackName : item.collectionName);
        const id = recordId(media === 'ebook' ? item.trackId : item.collectionId);
        if (!title || !id) return [];
        const genres = strings(item.genres).filter(value => value !== 'Books').join(', ') || text(item.primaryGenreName);
        return [{
            ID: id,
            Title: title,
            ...(bookType === 'audio' ? { Album: title } : {}),
            Series: '',
            Writer: text(item.artistName),
            Summary: plainText(item.description),
            CoverUrl: itunesCover(item, settings.itunes_cover_resolution),
            Web: safeUrl(media === 'ebook' ? item.trackViewUrl : item.collectionViewUrl, ['books.apple.com', 'itunes.apple.com']),
            Genre: genres,
            Tags: genres,
            ...dateFields(item.releaseDate),
            ...ratingFields(item.averageUserRating),
        }];
    });
}

async function searchHardcover({ query, page, apiKeys }, runtime) {
    const token = text(apiKeys.hardcover).replace(/^Bearer(?:\s+|$)/i, '').trim();
    if (!token) throw providerError('API_AUTH_REQUIRED');
    if (/[\r\n]/.test(token)) throw providerError('API_AUTH_FAILED');
    const data = await request('hardcover', runtime, 'requestJsonPost', 'https://api.hardcover.app/v1/graphql', {
        query: 'query BookManagerSearch($query: String!, $page: Int!) { search(query: $query, query_type: "Book", page: $page, per_page: 20) { error results } }',
        variables: { query, page },
    }, { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT });
    if (data?.errors?.length || data?.error || data?.data?.search?.error) {
        const messages = JSON.stringify(data.errors || data.error || data.data.search.error);
        if (/throttl|rate.limit|too.many/i.test(messages)) throw providerError('API_RATE_LIMIT');
        if (/unauthori[sz]ed|(?:invalid|expired|verify|missing).{0,20}token|authentication|access.denied/i.test(messages)) throw providerError('API_AUTH_FAILED');
        throw providerError('API_REQUEST_FAILED');
    }
    let results = data?.data?.search?.results;
    if (typeof results === 'string') {
        try { results = JSON.parse(results); } catch { throw providerError('API_INVALID_RESPONSE'); }
    }
    if (!Array.isArray(results?.hits)) throw providerError('API_INVALID_RESPONSE');
    return results.hits.slice(0, PAGE_SIZE).flatMap(hit => {
        const item = hit?.document;
        const id = recordId(item?.id);
        if (!id || !text(item.title)) return [];
        const slug = /^[a-z0-9][a-z0-9-]*$/i.test(text(item.slug)) ? text(item.slug) : '';
        const series = strings(item.series_names)[0] || '';
        return [{
            ID: id,
            Title: text(item.title),
            Series: series,
            Writer: strings(item.author_names).join(', '),
            Summary: plainText(item.description),
            ISBN: isbn(item.isbns),
            CoverUrl: safeUrl(item.image?.url, ['hardcover.app', 'hardcover.imgix.net']),
            Web: slug ? `https://hardcover.app/books/${encodeURIComponent(slug)}` : `https://hardcover.app/books/${id}`,
            Genre: strings(item.genres).join(', '),
            Tags: strings(item.tags).join(', '),
            PageCount: positiveNumber(item.pages),
            Volume: series ? positiveNumber(item.featured_series_position) : '',
            ...dateFields(item.release_year),
            ...ratingFields(item.rating),
        }];
    });
}

async function searchRanobeDb({ query, page, bookType }, runtime) {
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(PAGE_SIZE), sort: 'Relevance desc' });
    if (bookType === 'audio') params.set('rf', 'audio');
    const data = await request('ranobedb', runtime, 'requestJson', `https://ranobedb.org/api/v0/releases?${params}`, { 'User-Agent': USER_AGENT });
    if (!Array.isArray(data?.releases)) throw providerError('API_INVALID_RESPONSE');
    if (Number.isFinite(Number(data.totalPages)) && page > Number(data.totalPages)) return [];
    if (data.currentPage !== undefined && Number(data.currentPage) !== page) return [];
    return data.releases.slice(0, PAGE_SIZE).flatMap(item => {
        const id = recordId(item?.id);
        if (!id || !text(item.title) || item.hidden) return [];
        const filename = text(item.image?.filename);
        const cover = /^[\w-]+\.(?:jpe?g|png|webp|avif)$/i.test(filename) ? `https://images.ranobedb.org/${filename}` : '';
        return [{
            ID: id,
            Title: text(item.title),
            Series: '',
            Writer: '',
            Summary: plainText(item.description),
            ISBN: isbn([item.isbn13]),
            PageCount: positiveNumber(item.pages),
            CoverUrl: cover,
            Web: `https://ranobedb.org/release/${id}`,
            LanguageISO: language(item.lang),
            ...dateFields(item.release_date_parsed || item.release_date),
        }];
    });
}

const searchers = { openlibrary: searchOpenLibrary, itunes: searchItunes, hardcover: searchHardcover, ranobedb: searchRanobeDb };

export async function searchCatalogMetadataProvider(provider, options = {}, runtime = {}) {
    const searcher = Object.hasOwn(searchers, provider) ? searchers[provider] : null;
    if (typeof searcher !== 'function') throw providerError('API_REQUEST_FAILED');
    const query = text(options.query);
    const page = Number(options.page ?? 1);
    if (!query || !Number.isSafeInteger(page) || page < 1 || page > 10000) return [];
    try {
        return await searcher({ ...options, query, page, apiKeys: options.apiKeys || {}, settings: options.settings || {} }, runtime);
    } catch (error) {
        if (Object.hasOwn(ERROR_MESSAGES, error?.code)) throw providerError(error.code);
        const status = Number(error?.statusCode || error?.status || error?.response?.status);
        if (status === 401 || status === 403) throw providerError('API_AUTH_FAILED');
        if (status === 429 || error?.message === 'RATE_LIMIT') throw providerError('API_RATE_LIMIT');
        if (error instanceof SyntaxError) throw providerError('API_INVALID_RESPONSE');
        throw providerError('API_REQUEST_FAILED');
    }
}
