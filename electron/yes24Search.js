import { decodeHTML } from 'entities';
import { t } from './utils/i18n.js';

function cleanYes24Text(value = '') {
    return decodeHTML(String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div)>/gi, '\n')
        .replace(/<[^>]+>/g, ''))
        .trim();
}

function yes24Metadata(item) {
    const title = cleanYes24Text(item.title);
    const series = (Array.isArray(item.series) ? item.series : [])
        .map(value => cleanYes24Text(value?.seriesName))
        .find(Boolean) || title;
    const summaries = [item.contentDetail?.bookIntroduction, item.contentDetail?.bookSummary]
        .map(cleanYes24Text)
        .filter(Boolean);
    const score = Number(item.starScore);
    const rating = Number.isFinite(score) && score > 0 && score <= 10 ? String(score) : '';
    const pages = Number(item.pages);
    return {
        ID: String(item.itemId || item.isbn13 || item.isbn10 || item.link || title),
        Title: title,
        Series: series,
        LocalizedSeries: series,
        Writer: cleanYes24Text(item.author),
        Publisher: cleanYes24Text(item.publisher),
        ISBN: String(item.isbn13 || item.isbn10 || '').replace(/[^0-9X]/gi, ''),
        Summary: [...new Set(summaries)].join('\n\n'),
        Web: String(item.link || ''),
        CoverUrl: String(item.cover || '').replace(/^http:/, 'https:'),
        PubDate: String(item.publishDate || ''),
        PageCount: Number.isInteger(pages) && pages > 0 ? String(pages) : '',
        Rating: rating ? `${rating} / 10.0` : '-',
        RatingScore: rating || '-',
        CommunityRating: rating,
        AgeRating: item.adultYn === 'Y' ? '19세 이상' : '',
    };
}

// https://developers.yes24.com/api-doc/goods-item-list
export async function searchYes24(query, apiKey = '', page = 1, requestJson) {
    const key = String(apiKey || '').trim();
    const searchQuery = String(query || '').normalize('NFC').trim();
    if (!key) throw new Error(t('api_key_missing'));
    if (!searchQuery) return [];
    const pageNumber = Number(page);
    const params = new URLSearchParams({
        query: searchQuery,
        category: 'BOOK',
        sort: 'RELATION',
        page: String(Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1),
        pageSize: '20',
        detail: 'Y',
    });
    try {
        const data = await requestJson(`https://apis.yes24.com/v1/goods/itemList?${params}`, {
            'X-Api-Key': key,
        }, 15000);
        if (data?.success === false) {
            const error = new Error(t('api_response_unhandled'));
            error.code = data.errorCode;
            throw error;
        }
        if (data?.success !== true || !Array.isArray(data.data?.items)) {
            throw new Error(t('api_response_unhandled'));
        }
        return data.data.items
            .filter(item => item && typeof item === 'object')
            .map(yes24Metadata);
    } catch (error) {
        if (error.code === 'SEARCH_001') return [];
        if (['AUTH_001', 'AUTH_002'].includes(error.code) || error.statusCode === 401) {
            throw new Error(t('api_yes24_invalid_key'));
        }
        if (['RATE_001', 'RATE_002'].includes(error.code) || error.statusCode === 429 || error.message === 'RATE_LIMIT') {
            throw new Error(t('api_yes24_rate_limit'));
        }
        const message = error instanceof SyntaxError
            ? t('api_response_unhandled')
            : String(error.message || t('api_response_unhandled'));
        throw new Error(message.split(key).join('[REDACTED]').replace(/\byk_[A-Za-z0-9_-]+\b/g, '[REDACTED]'));
    }
}
