import { decodeHTML } from 'entities';
import { normalizeMetadataProviderSettings } from './metadataProviderSettings.js';

const SOURCES = {
    Goodreads: { origin: 'https://www.goodreads.com', path: /^\/book\/show\/(\d+)(?:[.-][^/?#]+)?\/?$/ },
    Kobo: { origin: 'https://www.kobo.com', path: /^\/[a-z]{2}(?:\/[a-z]{2})?\/ebook\/([^/?#]+)\/?$/ },
    LubimyCzytac: { origin: 'https://lubimyczytac.pl', path: /^\/ksiazka\/(\d+)(?:\/[^/?#]+)?\/?$/ },
};
const HEADERS = { 'User-Agent': 'BookManager/3.14 metadata search', Accept: 'text/html,application/json' };

function text(value) {
    return decodeHTML(String(value ?? '').replace(/<br\s*\/?\s*>|<\/p\s*>/gi, '\n').replace(/<[^>]*>/g, ''))
        .replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function attributes(source) {
    const result = {};
    for (const match of String(source).matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        result[match[1].toLowerCase()] = decodeHTML(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
}

// Only inspect the provider's known elements; scripts are parsed as JSON separately.
function elements(html, tag, predicate = () => true) {
    const result = [];
    const opening = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
    for (const match of html.matchAll(opening)) {
        const attrs = attributes(match[1]);
        if (!predicate(attrs)) continue;
        if (['img', 'meta', 'input', 'br'].includes(tag)) {
            result.push({ attrs, inner: '' });
            continue;
        }
        const nested = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
        nested.lastIndex = match.index + match[0].length;
        let depth = 1;
        let end;
        while ((end = nested.exec(html))) {
            depth += end[1] ? -1 : 1;
            if (depth === 0) break;
        }
        if (end) result.push({ attrs, inner: html.slice(match.index + match[0].length, end.index) });
    }
    return result;
}

function hasClass(attrs, name) {
    return String(attrs.class || '').split(/\s+/).includes(name);
}

function byClass(html, tag, name) {
    return elements(html, tag, attrs => hasClass(attrs, name));
}

function htmlBody(html) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
}

function responseError(provider, code, message) {
    const error = new Error(`${provider}: ${message}`);
    error.code = code;
    return error;
}

function checkResponse(provider, html) {
    if (typeof html !== 'string' || !html.trim()) {
        throw responseError(provider, 'METADATA_RESPONSE_INVALID', 'The service returned an empty or unrecognized response.');
    }
    if (/<title[^>]*>\s*(?:Just a moment|Access denied|Challenged|Robot Check|Attention Required)/i.test(html)
        || /id=["'](?:challenge-form|challenge-error-text|captcha)["']|awswaf-captcha|\/cdn-cgi\/challenge-platform\//i.test(html)) {
        throw responseError(provider, 'METADATA_ACCESS_BLOCKED', 'The service requires browser verification or is blocking automated requests.');
    }
}

function detailUrl(provider, value) {
    try {
        const source = SOURCES[provider];
        const url = new URL(value, source.origin);
        if (url.origin !== source.origin || url.username || url.password || !source.path.test(url.pathname)) return '';
        url.search = '';
        url.hash = '';
        return url.href;
    } catch {
        return '';
    }
}

function imageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
        return '';
    }
}

function resultId(provider, url) {
    return new URL(url).pathname.match(SOURCES[provider].path)?.[1] || '';
}

function language(value) {
    const name = text(value).toLowerCase();
    const names = { english: 'en', polish: 'pl', polski: 'pl', french: 'fr', german: 'de', spanish: 'es', italian: 'it', portuguese: 'pt', dutch: 'nl', japanese: 'ja', korean: 'ko', chinese: 'zh' };
    return names[name] || (/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(name) ? name : '');
}

function dateFields(value) {
    const match = String(value || '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
    return match ? { PubDate: match[0], Year: match[1], Month: match[2] ? String(Number(match[2])) : '', Day: match[3] ? String(Number(match[3])) : '' } : {};
}

function names(value) {
    return [...new Set((Array.isArray(value) ? value : [value]).map(item => text(typeof item === 'object' ? item?.name : item)).filter(Boolean))].join(', ');
}

function ratingFields(value, maximum = 5) {
    const score = Number(String(value ?? '').replace(',', '.'));
    const best = Number(maximum);
    if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(best) || best <= 0 || score > best) return {};
    return { CommunityRating: String(Math.round(score / best * 100) / 10) };
}

function jsonScripts(html, predicate) {
    const results = [];
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!predicate(attributes(match[1]))) continue;
        try { results.push(JSON.parse(match[2])); } catch { /* Other script blocks may contain non-JSON content. */ }
    }
    return results;
}

function schemaBook(html) {
    const queue = jsonScripts(html, attrs => attrs.type === 'application/ld+json');
    while (queue.length) {
        const node = queue.shift();
        if (Array.isArray(node)) queue.push(...node);
        else if (node && typeof node === 'object') {
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            if (types.includes('Book')) return node;
            if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
        }
    }
    return null;
}

function bookSchemaMetadata(book, ratingMaximum) {
    const rating = book.aggregateRating || {};
    return {
        Title: text(book.name),
        Writer: names(book.author),
        ISBN: text(book.isbn),
        Publisher: names(book.publisher),
        Summary: text(book.description),
        PageCount: /^\d+$/.test(String(book.numberOfPages || '')) ? String(book.numberOfPages) : '',
        LanguageISO: language(book.inLanguage),
        CoverUrl: imageUrl(typeof book.image === 'object' ? book.image?.url : book.image),
        ...dateFields(book.datePublished),
        ...ratingFields(rating.ratingValue, rating.bestRating || ratingMaximum),
    };
}

function mergeNonempty(...objects) {
    return Object.assign({}, ...objects.map(object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== '' && value != null))));
}

function parseGoodreadsDetail(html, item) {
    const schema = schemaBook(html);
    const next = jsonScripts(html, attrs => attrs.id === '__NEXT_DATA__')[0];
    const state = next?.props?.pageProps?.apolloState || {};
    const book = Object.values(state).find(node => node?.__typename === 'Book' && String(node.legacyId) === item.ID);
    if (!schema && !book) throw responseError('Goodreads', 'METADATA_RESPONSE_INVALID', 'Book metadata was not found in the service response.');
    const resolve = node => node?.__ref ? state[node.__ref] : node;
    const details = book?.details || {};
    const series = book?.bookSeries?.[0];
    const contributors = [book?.primaryContributorEdge, ...(book?.secondaryContributorEdges || [])].filter(Boolean);
    const contributorNames = role => names(contributors.filter(edge => edge.role === role).map(edge => resolve(edge.node)));
    const published = Number(details.publicationTime);
    const publicationDate = Number.isFinite(published) && details.publicationTime != null ? new Date(published) : null;
    return mergeNonempty(item, schema ? bookSchemaMetadata(schema, 5) : {}, book ? {
        Title: text(book.title),
        Writer: contributorNames('Author'),
        Penciller: contributorNames('Illustrator'),
        Editor: contributorNames('Editor'),
        Summary: text(book.description),
        Series: text(resolve(series?.series)?.title),
        Volume: text(series?.userPosition),
        Genre: names((book.bookGenres || []).map(genre => genre.genre)),
        Publisher: text(details.publisher),
        ISBN: text(details.isbn13 || details.isbn),
        PageCount: details.numPages ? String(details.numPages) : '',
        LanguageISO: language(details.language?.name),
        CoverUrl: imageUrl(book.imageUrl),
        ...(publicationDate && !Number.isNaN(publicationDate.valueOf()) ? dateFields(publicationDate.toISOString()) : {}),
    } : {});
}

function parseLubimyDetail(html, item) {
    const schema = schemaBook(html);
    if (!schema) throw responseError('LubimyCzytac', 'METADATA_RESPONSE_INVALID', 'Book metadata was not found in the service response.');
    const body = htmlBody(html);
    const container = elements(body, 'section', attrs => attrs.id === 'container-book')[0]
        || elements(body, 'section', attrs => !!attrs['data-ga-book-publishers'])[0];
    const description = byClass(body, 'div', 'book__description')[0];
    const series = elements(body, 'a', attrs => /^\/cykl\//.test(attrs.href || ''))[0];
    const genre = elements(body, 'a', attrs => attrs.href === schema.genre)[0];
    return mergeNonempty(item, bookSchemaMetadata(schema, 10), {
        Publisher: text(container?.attrs['data-ga-book-publishers']),
        Genre: text(container?.attrs['data-ga-book-category'] || genre?.inner),
        Summary: text(description?.inner),
        Series: text(series?.inner).replace(/\s*\(tom\s+[^)]+\)\s*$/i, ''),
    });
}

function parseKoboDetail(html, item) {
    const body = htmlBody(html);
    const heading = byClass(body, 'h1', 'product-field').find(element => hasClass(element.attrs, 'title'));
    if (!text(heading?.inner)) throw responseError('Kobo', 'METADATA_RESPONSE_INVALID', 'Book metadata was not found in the service response.');
    const contributors = byClass(body, 'span', 'visible-contributors')[0]
        || elements(body, 'div', attrs => attrs['data-testid'] === 'contributors')[0];
    const description = elements(body, 'div', attrs => Object.hasOwn(attrs, 'data-full-synopsis'))[0]
        || elements(body, 'div', attrs => attrs.itemprop === 'description')[0];
    const metadata = byClass(body, 'div', 'bookitem-secondary-metadata')[0];
    const rows = elements(metadata?.inner || '', 'li');
    const fields = {};
    for (const row of rows) {
        const content = text(row.inner);
        const colon = content.indexOf(':');
        if (colon >= 0) fields[content.slice(0, colon).trim().toLowerCase()] = content.slice(colon + 1).trim();
    }
    const release = fields['release date'] || '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(release) ? release : /^\w+ \d{1,2}, \d{4}$/.test(release) ? new Date(`${release} 00:00:00 UTC`) : null;
    const series = byClass(body, 'span', 'product-sequence-field')[0];
    const position = text(byClass(body, 'span', 'sequenced-name-prefix')[0]?.inner).match(/\d+(?:\.\d+)?/);
    const stats = byClass(body, 'div', 'book-stats')[0];
    const pages = byClass(stats?.inner || '', 'div', 'column').find(column => elements(column.inner, 'span').some(label => /^Pages$/i.test(text(label.inner))));
    const cover = elements(body, 'meta', attrs => attrs.property === 'og:image')[0];
    const genres = elements(body, 'meta', attrs => ['genre', 'book:genre'].includes(attrs.property));
    const pageCount = fields.pages || text(elements(pages?.inner || '', 'strong')[0]?.inner);
    const isbn = (fields.isbn || fields['book id'] || '').replace(/[\s-]/g, '');
    return mergeNonempty(item, {
        Title: text(heading.inner),
        Writer: names(elements(contributors?.inner || '', 'a').map(author => text(author.inner))),
        Summary: text(description?.inner),
        Publisher: fields.publisher || (rows[0] && !text(rows[0].inner).includes(':') ? text(rows[0].inner) : ''),
        ISBN: /^(?:\d{13}|\d{9}[\dXx])$/.test(isbn) ? isbn : '',
        PageCount: /^\d+$/.test(pageCount) ? pageCount : '',
        LanguageISO: language(fields.language),
        CoverUrl: imageUrl(cover?.attrs.content),
        Genre: names(genres.map(genre => genre.attrs.content)),
        Series: text(series?.inner),
        Volume: position?.[0] || '',
        ...(date instanceof Date ? Number.isNaN(date.valueOf()) ? {} : dateFields(date.toISOString()) : dateFields(date)),
    });
}

function searchItems(provider, html) {
    const body = htmlBody(html);
    const items = [];
    const add = (url, metadata) => {
        const safe = detailUrl(provider, url);
        if (safe && metadata.Title && !items.some(item => item.Web === safe)) items.push({ ID: resultId(provider, safe), Web: safe, ...metadata });
    };
    if (provider === 'Goodreads') {
        for (const row of elements(body, 'tr', attrs => /schema\.org\/Book$/.test(attrs.itemtype || ''))) {
            const title = byClass(row.inner, 'a', 'bookTitle')[0];
            const image = byClass(row.inner, 'img', 'bookCover')[0];
            add(title?.attrs.href, { Title: text(title?.inner), Writer: names(byClass(row.inner, 'a', 'authorName').map(author => text(author.inner))), CoverUrl: imageUrl(image?.attrs.src) });
        }
    } else if (provider === 'LubimyCzytac') {
        for (const row of byClass(body, 'div', 'book-card')) {
            const title = byClass(row.inner, 'a', 'book-card__title')[0];
            const image = byClass(row.inner, 'img', 'book-card__cover-image')[0];
            const authors = byClass(row.inner, 'div', 'book-card__author')[0];
            add(title?.attrs.href, { Title: text(title?.inner), Writer: text(authors?.inner), CoverUrl: imageUrl(image?.attrs.src) });
        }
    } else {
        for (const title of elements(body, 'a', attrs => attrs['data-testid'] === 'title')) add(title.attrs.href, { Title: text(title.inner) });
        if (!items.length) for (const heading of byClass(body, 'h2', 'product-field').filter(element => hasClass(element.attrs, 'title'))) {
            const title = elements(heading.inner, 'a')[0];
            add(title?.attrs.href, { Title: text(title?.inner) });
        }
    }
    if (items.length) return items.slice(0, 20);
    const noResults = provider === 'Goodreads' ? /No results\./i.test(text(byClass(body, 'h3', 'searchSubNavContainer')[0]?.inner))
        : provider === 'LubimyCzytac' ? /niczego nie znaleźliśmy/i.test(text(body))
            : /\bno results\b|\bof 0 results\b/i.test(text(body));
    if (noResults) return [];
    throw responseError(provider, 'METADATA_RESPONSE_INVALID', 'Search results were not found in the service response. The page format may have changed.');
}

async function fetchText(provider, runtime, url, headers = HEADERS, options) {
    let html;
    try {
        html = await runtime.requestText(url, headers, 12000, options);
    } catch (cause) {
        const status = Number(cause?.statusCode || cause?.status);
        if (status === 429 || /\b429\b|RATE_LIMIT/.test(String(cause?.message))) throw responseError(provider, 'API_RATE_LIMIT', 'The service request limit was exceeded.');
        if (status === 403 || /\b403\b/.test(String(cause?.message))) throw responseError(provider, 'METADATA_ACCESS_BLOCKED', 'The service blocked the request.');
        throw cause;
    }
    checkResponse(provider, html);
    return html;
}

export async function searchWebMetadataProvider(provider, options = {}, runtime = {}) {
    if (!Object.hasOwn(SOURCES, provider)) throw new Error(`Unsupported metadata provider: ${provider}`);
    const query = String(options.query || '').trim();
    if (!query) return [];
    const requestedPage = Number(options.page);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    let html;
    let hasNext;
    if (provider === 'LubimyCzytac' && page > 1) {
        const params = new URLSearchParams({ page: String(page), listId: 'ksiazki', phrase: query, paginatorType: 'Standard' });
        const body = await fetchText(provider, runtime, `${SOURCES[provider].origin}/searcher/getNextResults/ksiazki`, {
            ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest',
        }, { method: 'POST', body: params.toString() });
        let data;
        try { data = JSON.parse(body); } catch { throw responseError(provider, 'METADATA_RESPONSE_INVALID', 'The service returned invalid pagination data.'); }
        if (data?.code !== 'OK' || typeof data.data?.content !== 'string' || !Number.isInteger(Number(data.data.count)) || data.data.count == null) throw responseError(provider, 'METADATA_RESPONSE_INVALID', 'The service returned invalid pagination data.');
        if (Number(data.data.count) === 0 || !data.data.content.trim()) return Object.assign([], { hasNext: false });
        html = data.data.content;
        hasNext = page * 10 < Number(data.data.count);
    } else {
        let path;
        let params;
        if (provider === 'Goodreads') {
            path = '/search';
            params = new URLSearchParams({ q: query, search_type: 'books', page: String(page) });
        } else if (provider === 'LubimyCzytac') {
            path = '/szukaj/ksiazki';
            params = new URLSearchParams({ phrase: query });
        } else {
            const settings = normalizeMetadataProviderSettings(options.settings);
            const country = settings.kobo_country;
            const lang = settings.kobo_language;
            path = `/${country}${lang === 'all' ? '' : `/${lang}`}/search`;
            params = new URLSearchParams({ query, fcmedia: 'Book', pageNumber: String(page) });
            if (lang !== 'all') params.set('fclanguages', lang);
        }
        html = await fetchText(provider, runtime, `${SOURCES[provider].origin}${path}?${params}`);
    }
    const items = searchItems(provider, html);
    if (hasNext === undefined) {
        const body = htmlBody(html);
        if (provider === 'Goodreads') {
            const next = byClass(body, 'a', 'next_page')[0];
            const disabledNext = byClass(body, 'span', 'next_page').some(element => hasClass(element.attrs, 'disabled'));
            hasNext = next ? !hasClass(next.attrs, 'disabled') : disabledNext ? false : items.length >= 20;
        } else if (provider === 'LubimyCzytac') {
            const next = byClass(body, 'li', 'next-page')[0];
            hasNext = next ? !hasClass(next.attrs, 'disabled') : items.length >= 10;
        } else {
            hasNext = items.length >= 12;
        }
    }
    const parse = { Goodreads: parseGoodreadsDetail, LubimyCzytac: parseLubimyDetail, Kobo: parseKoboDetail }[provider];
    let cursor = 0;
    let failure;
    const results = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
        while (!failure && cursor < items.length) {
            const index = cursor++;
            try {
                const detail = await fetchText(provider, runtime, items[index].Web);
                results[index] = parse(detail, items[index]);
            } catch (error) { failure = error; }
        }
    }));
    if (failure) throw failure;
    return Object.assign(results, { hasNext: items.length > 0 && hasNext });
}
