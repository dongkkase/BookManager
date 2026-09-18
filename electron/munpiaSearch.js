import { decodeHTML } from 'entities';
import { t } from './utils/i18n.js';

function cleanMunpiaText(value = '') {
    if (typeof value !== 'string') return '';
    return decodeHTML(String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div)>/gi, '\n')
        .replace(/<[^>]+>/g, ''))
        .replace(/\r\n?/g, '\n')
        .trim();
}

export function originalMunpiaCoverUrl(value = '') {
    const source = String(value || '').trim();
    try {
        const url = new URL(source, 'https://www.munpia.com/');
        if (['http:', 'https:'].includes(url.protocol)
            && /^cdn\d*\.munpia\.com$/i.test(url.hostname)
            && /^\/v2\/files\/cover\/.+\/[A-Za-z0-9_-]+(?:\.origin\.)?$/.test(url.pathname)) {
            url.protocol = 'https:';
            if (!url.pathname.endsWith('.origin.')) url.pathname += '.origin.';
            return url.href;
        }
    } catch {
        // 문피아 원본 표지 규칙에 해당하지 않는 주소는 유지합니다.
    }
    return source;
}

function munpiaCoverUrl(value = '') {
    if (!String(value || '').trim()) return '';
    try {
        const url = new URL(String(value).trim(), 'https://www.munpia.com/');
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        url.protocol = 'https:';
        return originalMunpiaCoverUrl(url.href);
    } catch {
        return '';
    }
}

function munpiaMetadata(item) {
    const title = cleanMunpiaText(item.title);
    const genres = [item.mainGenre, item.subGenre].map(cleanMunpiaText).filter(Boolean);
    const tags = (Array.isArray(item.tag) ? item.tag : []).map(cleanMunpiaText).filter(Boolean);
    const entryCount = String(item.entryCount ?? '').trim();
    const notes = [
        item.finished === true ? '완결' : item.finished === false ? '연재 중' : '',
        item.updateAt ? `최근 업데이트: ${cleanMunpiaText(item.updateAt)}` : '',
    ].filter(Boolean);
    return {
        ID: String(item.novelId),
        Title: title,
        Series: title,
        LocalizedSeries: title,
        Writer: cleanMunpiaText(item.author),
        Penciller: cleanMunpiaText(item.illustrator),
        Summary: cleanMunpiaText(item.story),
        Genre: [...new Set(genres)].join(', '),
        Tags: [...new Set(tags)].join(', '),
        Count: /^\d+$/.test(entryCount) ? entryCount.replace(/^0+(?=\d)/, '') : '',
        AgeRating: item.adult === true ? '19세 이상' : item.adult === false ? '전체 이용가' : '',
        Web: `https://www.munpia.com/novel/detail/${item.novelId}`,
        CoverUrl: munpiaCoverUrl(item.coverUrl),
        Publisher: '',
        ISBN: '',
        PubDate: '',
        Rating: '-',
        RatingScore: '-',
        CommunityRating: '',
        Notes: notes.join('\n'),
    };
}

export async function searchMunpia(query, page = 1, requestJson) {
    const searchQuery = String(query || '').normalize('NFC').trim();
    if (!searchQuery) return [];
    const pageNumber = Number(page);
    const params = new URLSearchParams({
        query: searchQuery,
        tab: 'ALL',
        sort: 'SIMILARITY',
        novelType: 'ALL',
        finishedOnly: 'false',
        adultMode: 'true',
        page: String(Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : 0),
        size: '20',
    });
    let data;
    try {
        data = await requestJson(`https://www.munpia.com/api/v1/main/search?${params}`, {
            Accept: 'application/json',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
            Referer: 'https://www.munpia.com/',
        }, 15000);
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(t('api_response_unhandled'));
        throw error;
    }
    if (data?.code !== 'M000_00000' || !Array.isArray(data.result?.searchNovelTabDtos)) {
        throw new Error(t('api_response_unhandled'));
    }
    return data.result.searchNovelTabDtos
        .filter(item => item && /^[1-9]\d*$/.test(String(item.novelId || '')) && cleanMunpiaText(item.title))
        .map(munpiaMetadata);
}
