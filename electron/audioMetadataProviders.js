import { decodeHTML } from 'entities';
import { normalizeMetadataProviderSettings } from './metadataProviderSettings.js';

const AUDIBLE_DOMAINS = {
    us: 'com', uk: 'co.uk', de: 'de', fr: 'fr', it: 'it', es: 'es',
    ca: 'ca', au: 'com.au', jp: 'co.jp', in: 'in',
};
const requestSchedules = new WeakMap();

function providerError(code) {
    return Object.assign(new Error('The audiobook metadata request could not be completed.'), { code });
}

function plainText(value) {
    return decodeHTML(String(value || '').replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
}

function names(values) {
    return Array.isArray(values) ? [...new Set(values.map(value => plainText(value?.name || value)).filter(Boolean))].join(', ') : '';
}

function imageUrl(value) {
    try {
        const url = new URL(String(value || ''), 'https://libro.fm');
        const allowedHosts = ['media-amazon.com', 'ssl-images-amazon.com', 'libro.fm'];
        const trusted = allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
        return value && trusted && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch {
        return '';
    }
}

function ratingFields(value) {
    const score = Number(value);
    return Number.isFinite(score) && score > 0 && score <= 5
        ? { RatingScore: String(score), CommunityRating: String(score * 2) } : {};
}

async function request(runtime, url) {
    const fetchJson = runtime.requestJson;
    if (typeof fetchJson !== 'function') throw providerError('API_REQUEST_FAILED');
    const now = runtime.now || Date.now;
    const sleep = runtime.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const host = new URL(url).hostname;
    let schedule = requestSchedules.get(fetchJson);
    if (!schedule) {
        schedule = new Map();
        requestSchedules.set(fetchJson, schedule);
    }
    const start = Math.max(now(), schedule.get(host) || 0);
    schedule.set(host, start + 350);
    if (start > now()) await sleep(start - now());
    return fetchJson(url, { 'User-Agent': 'BookManager (desktop metadata search)', Accept: 'application/json' }, 12000);
}

async function audibleProducts({ query, page, settings }, runtime) {
    const domain = AUDIBLE_DOMAINS[settings.audible_region];
    const direct = /^B[0-9][A-Z0-9]{8}$/i.test(query);
    if (direct && page > 1) return { products: [], hasNext: false };
    const url = new URL(`https://api.audible.${domain}/1.0/catalog/products${direct ? `/${query.toUpperCase()}` : ''}`);
    url.searchParams.set('response_groups', 'contributors,product_desc,product_attrs,media,rating,series');
    url.searchParams.set('image_sizes', '500,1024');
    if (!direct) {
        url.searchParams.set('keywords', query);
        url.searchParams.set('num_results', '20');
        url.searchParams.set('page', String(page - 1));
        url.searchParams.set('products_sort_by', 'Relevance');
        url.searchParams.set('content_type', 'Product');
    }
    const response = await request(runtime, url.href);
    const products = direct ? (response?.product ? [response.product] : null) : response?.products;
    if (!Array.isArray(products)) throw providerError('API_INVALID_RESPONSE');
    const total = Number(response.total_results);
    return { products, hasNext: !direct && (Number.isFinite(total) ? page * 20 < total : products.length >= 20) };
}

function audibleMetadata(product, region) {
    const id = String(product?.asin || '');
    if (!/^[A-Z0-9]{10}$/i.test(id) || !product?.title) return null;
    const images = Object.entries(product.product_images || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
    return {
        ID: id, Title: plainText(product.title), Album: plainText(product.title),
        Writer: names(product.authors), Narrator: names(product.narrators),
        Publisher: plainText(product.publisher_name), Summary: plainText(product.publisher_summary || product.merchandising_summary),
        CoverUrl: imageUrl(images[0]?.[1]), Web: `https://www.audible.${AUDIBLE_DOMAINS[region]}/pd/${id}`,
        Series: plainText(product.series?.[0]?.title), Volume: String(product.series?.[0]?.sequence || ''),
        PubDate: String(product.release_date || ''), Tags: names(product.thesaurus_subject_keywords),
        ...ratingFields(product.rating?.overall_distribution?.average_rating),
    };
}

function audnexusMetadata(book, region) {
    if (!book?.asin || !book?.title) throw providerError('API_INVALID_RESPONSE');
    return {
        ID: book.asin, Title: plainText(book.title), Album: plainText(book.title),
        Writer: names(book.authors), Narrator: names(book.narrators),
        Publisher: plainText(book.publisherName), Summary: plainText(book.summary || book.description),
        ISBN: String(book.isbn || ''), CoverUrl: imageUrl(book.image),
        Web: `https://www.audible.${AUDIBLE_DOMAINS[region]}/pd/${encodeURIComponent(book.asin)}`,
        PubDate: String(book.releaseDate || ''), Series: plainText(book.seriesPrimary?.name),
        Volume: String(book.seriesPrimary?.position || ''),
        Genre: names(book.genres?.filter(genre => genre.type === 'genre')),
        Tags: names(book.genres?.filter(genre => genre.type !== 'genre')),
        ...ratingFields(book.rating),
    };
}

async function searchAudnexus(options, runtime) {
    const direct = /^B[0-9][A-Z0-9]{8}$/i.test(options.query);
    if (direct && options.page > 1) return Object.assign([], { hasNext: false });
    const found = direct
        ? { products: [{ asin: options.query.toUpperCase() }], hasNext: false }
        : await audibleProducts(options, runtime);
    const ids = [...new Set(found.products.map(product => product?.asin).filter(id => /^[A-Z0-9]{10}$/i.test(id || '')))];
    const results = new Array(ids.length);
    let next = 0;
    let failure;
    const worker = async () => {
        while (!failure && next < ids.length) {
            const index = next++;
            const url = new URL(`https://api.audnex.us/books/${ids[index]}`);
            url.searchParams.set('region', options.settings.audible_region);
            try {
                results[index] = audnexusMetadata(await request(runtime, url.href), options.settings.audible_region);
            } catch (error) {
                if (Number(error?.statusCode || error?.status) !== 404) failure = error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    if (failure) throw failure;
    return Object.assign(results.filter(Boolean), { hasNext: found.hasNext });
}

async function searchLibro(options, runtime) {
    const url = new URL('https://libro.fm/api/v12/explore/search');
    url.searchParams.set('q', options.query);
    url.searchParams.set('page', String(options.page));
    url.searchParams.set('searchby', 'all');
    const response = await request(runtime, url.href);
    const collection = response?.audiobook_collection;
    if (!Array.isArray(collection?.audiobooks)) throw providerError('API_INVALID_RESPONSE');
    const seen = new Set();
    const results = collection.audiobooks.flatMap(book => {
        const isbn = String(book?.isbn || '');
        if (!/^\d{13}$/.test(isbn) || !book.title || seen.has(isbn)) return [];
        seen.add(isbn);
        return [{
            ID: isbn, ISBN: isbn, Title: plainText(book.title), Album: plainText(book.title),
            Writer: names(book.authors), Narrator: names(book.audiobook_info?.narrators),
            CoverUrl: imageUrl(book.cover_url), Web: `https://libro.fm/audiobooks/${isbn}`,
        }];
    });
    const pages = Number(collection.total_pages);
    return Object.assign(results, { hasNext: Number.isFinite(pages) ? options.page < pages : collection.audiobooks.length >= 24 });
}

export async function searchAudioMetadataProvider(provider, options = {}, runtime = {}) {
    const query = String(options.query || '').trim();
    const page = Number(options.page ?? 1);
    if (!query || !Number.isSafeInteger(page) || page < 1 || page > 10000) return [];
    const normalized = { ...options, query, page, settings: normalizeMetadataProviderSettings(options.settings) };
    try {
        if (provider === 'audnexus') return await searchAudnexus(normalized, runtime);
        if (provider === 'librofm') return await searchLibro(normalized, runtime);
        if (provider !== 'audible') throw providerError('API_REQUEST_FAILED');
        const { products, hasNext } = await audibleProducts(normalized, runtime);
        return Object.assign(products.map(product => audibleMetadata(product, normalized.settings.audible_region)).filter(Boolean), { hasNext });
    } catch (error) {
        const status = Number(error?.statusCode || error?.status);
        if (status === 429 || error?.message === 'RATE_LIMIT') throw providerError('API_RATE_LIMIT');
        if (status === 401 || status === 403) throw providerError('API_ACCESS_BLOCKED');
        if (error?.code === 'API_INVALID_RESPONSE' || error instanceof SyntaxError) throw providerError('API_INVALID_RESPONSE');
        throw providerError('API_REQUEST_FAILED');
    }
}
