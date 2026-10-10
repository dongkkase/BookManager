import { decodeHTML } from 'entities';
import { parseKmasDetailHtml } from './kmasDetail.js';
import { t } from './utils/i18n.js';

const KMAS_ORIGIN = 'https://www.kmas.or.kr';
const KMAS_PAGE_SIZE = 10;

function cleanText(value = '') {
    return decodeHTML(String(value ?? '').replace(/<[^>]*>/g, '')).trim();
}

export function kmasSearchParams(query, page = 1) {
    const pageNumber = Number(page);
    return new URLSearchParams({
        index: 'distribution',
        pageIndex: String(Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1),
        recordCountPerPage: String(KMAS_PAGE_SIZE),
        grpField: '',
        grpCd: '',
        dtlSearch: 'N',
        sort: '$relevance desc',
        before: 'Y',
        category: '1',
        target1: 'all',
        target2: 'all',
        target3: 'all',
        keyword: '',
        keyword1: String(query || '').normalize('NFC').trim(),
        kindOpr1: 'AND',
        keyword2: '',
        kindOpr2: 'AND',
        keyword3: '',
        pusryStartDate: '',
        pusryEndDate: '',
        pusryStartDateEnd: '',
        pusryEndDateEnd: '',
        fnshYn: 'A',
        ageGradCd: '',
        pblcateYn: 'A',
    });
}

function kmasMetadata(item) {
    const title = cleanText(item.TITLE_N || item.TITLE);
    const date = String(item.PUSRY_BEGIN_DE || '').match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    const imageId = String(item.FILE_IMAGE_ID || '').trim();
    return {
        ID: String(item.MASTR_ID),
        Title: title,
        Series: title,
        LocalizedSeries: title,
        Writer: cleanText(item.SNTNC_WRITR_NM),
        Penciller: cleanText(item.PICTR_WRITR_NM),
        Publisher: cleanText(item.PLSCMPN_ID_NM || item.PLTFOM_CD_NM),
        Summary: cleanText(item.OUTLINE_N || item.OUTLINE),
        Genre: cleanText(item.MAIN_GENRE_CD_NM),
        ISBN: cleanText(item.ISBN),
        AgeRating: cleanText(item.AGE_GRAD_NM),
        PubDate: date ? `${date[1]}-${date[2]}-${date[3]}` : '',
        Year: date?.[1] || '',
        Month: date ? String(Number(date[2])) : '',
        Day: date ? String(Number(date[3])) : '',
        Notes: item.FNSH_YN === 'Y' ? '완결' : item.FNSH_YN === 'N' ? '연재 중' : '',
        Web: `${KMAS_ORIGIN}/search/detail/${item.MASTR_ID}`,
        CoverUrl: imageId ? `${KMAS_ORIGIN}/common/file/atchmnflDownload.ajax?${new URLSearchParams({ fileImageId: imageId })}` : '',
        Format: 'Webtoon',
        LanguageISO: 'ko',
        Manga: 'No',
    };
}

export function parseKmasSearchResponse(data, page = 1) {
    if (data?.result === 'fail' && data.resultMsg === '검색하신 조건에 해당하는 정보가 없습니다.') return [];
    if (data?.result !== 'success' || !Array.isArray(data.allDataObj?.dataList)) {
        throw new Error(cleanText(data?.resultMsg || data?.vaildErrorMsg) || t('api_response_unhandled'));
    }
    const total = Number(data.pageInfo?.totalRecordCount);
    const pageNumber = Number(kmasSearchParams('', page).get('pageIndex'));
    const hasNext = Number.isFinite(total)
        ? pageNumber * KMAS_PAGE_SIZE < total
        : data.allDataObj.dataList.length >= KMAS_PAGE_SIZE;
    const seen = new Set();
    return data.allDataObj.dataList.filter(item => {
        const id = String(item?.MASTR_ID || '');
        if (!/^[1-9]\d*$/.test(id) || seen.has(id) || String(item.LIST_SE_CD) !== '1'
            || !cleanText(item.TITLE_N || item.TITLE)) return false;
        seen.add(id);
        return true;
    }).map(item => ({ ...kmasMetadata(item), kmasHasNext: hasNext }));
}

export async function searchKmas(query, page = 1, requestText) {
    const params = kmasSearchParams(query, page);
    if (!params.get('keyword1')) return [];
    const searchUrl = `${KMAS_ORIGIN}/search/searchDetail?${params}`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
        Referer: `${KMAS_ORIGIN}/`,
    };
    // 검색 화면의 세션을 준비한 뒤 #resultList를 채우는 동일한 요청을 보냅니다.
    await requestText(searchUrl, headers, 12000);
    const body = await requestText(`${KMAS_ORIGIN}/search/engin/callDetailApi.ajax`, {
        ...headers,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: KMAS_ORIGIN,
        Referer: searchUrl,
    }, 12000, { method: 'POST', body: params.toString() });
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        throw new Error(t('api_response_unhandled'));
    }
    const results = parseKmasSearchResponse(data, page);
    let cursor = 0;
    const worker = async () => {
        while (cursor < results.length) {
            const index = cursor++;
            const item = results[index];
            try {
                const html = await requestText(item.Web, { ...headers, Referer: searchUrl }, 10000);
                const detail = parseKmasDetailHtml(html);
                results[index] = {
                    ...item,
                    ...Object.fromEntries(Object.entries(detail).filter(([, value]) => String(value ?? '').trim())),
                    ID: item.ID,
                    Web: item.Web,
                };
            } catch {
                // 상세 페이지를 읽지 못해도 검색 응답의 메타데이터는 유지합니다.
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, results.length) }, worker));
    return results;
}
