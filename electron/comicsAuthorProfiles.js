import { createHash } from 'node:crypto';
import { decodeHTML } from 'entities';

const PROFILE_LIMIT = 8;
const CARTOON_SOURCE_URL = 'https://www.cartoon.or.kr/all-member';
const CARTOON_MEMBERS_URL = 'https://docs.google.com/spreadsheets/d/10IYjP6cEZlQIHQqQoFWIbwgA2zs9fC2vqvgbUpE1jow/gviz/tq?tqx=out:json&sheet=%EC%A0%84%EC%B2%B4%ED%9A%8C%EC%9B%90';
const KMAS_ORIGIN = 'https://www.kmas.or.kr';

function invalidResponse() {
    const error = new Error('The author profile service returned an invalid response.');
    error.code = 'AUTHOR_PROFILE_INVALID_RESPONSE';
    return error;
}

function plainText(value, limit = 600) {
    return typeof value === 'string'
        ? value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
}

function htmlText(value, limit = 600) {
    return plainText(decodeHTML(String(value || '')
        .replace(/<!--[^]*?-->/g, ' ')
        .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')), limit);
}

function titleText(value, limit = 300) {
    return plainText(value, limit).replace(/</g, '〈').replace(/>/g, '〉');
}

function comparable(value) {
    return titleText(value, 1200).toLowerCase();
}

export function parseCartoonMembers(text, query) {
    const term = comparable(query);
    if (!term) return [];
    const match = String(text || '').match(/google\.visualization\.Query\.setResponse\(\s*([\s\S]*)\s*\);?\s*$/);
    let data;
    try {
        data = JSON.parse(match?.[1] || '');
    } catch {
        throw invalidResponse();
    }
    const { cols, rows } = data?.table || {};
    if (data?.status !== 'ok' || !Array.isArray(cols) || !Array.isArray(rows) || rows.length > 10000) throw invalidResponse();
    const nameColumn = cols.findIndex(column => column?.label === '이름');
    const workColumn = cols.findIndex(column => column?.label === '대표작');
    if (nameColumn < 0 || workColumn < 0) throw invalidResponse();
    const matches = [];
    const seen = new Set();
    for (const row of rows) {
        const name = titleText(row?.c?.[nameColumn]?.v, 200);
        const topWork = titleText(row?.c?.[workColumn]?.v);
        if (!name || !comparable(`${name} ${topWork}`).includes(term) || seen.has(name)) continue;
        seen.add(name);
        matches.push({
            provider: 'cartoon',
            id: `cartoon:${createHash('sha256').update(name).digest('hex')}`,
            name,
            alternateNames: [],
            birthDate: '',
            description: topWork ? `대표작: ${topWork}` : '',
            topWork,
            works: topWork ? [topWork] : [],
            photoUrl: '',
            sourceUrl: CARTOON_SOURCE_URL,
            imageSourceUrl: '',
            authorVerified: true,
        });
        if (matches.length === PROFILE_LIMIT) break;
    }
    return matches;
}

export async function searchCartoonAuthors(query, requestText) {
    if (!plainText(query)) return [];
    // The association's member directory loads this public sheet in its own page script.
    return parseCartoonMembers(await requestText(CARTOON_MEMBERS_URL), query);
}

function imageUrlFromHtml(html) {
    const image = html.match(/<img\b[^>]*>/i)?.[0];
    const src = image?.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!src) return '';
    let url;
    try {
        url = new URL(decodeHTML(src), KMAS_ORIGIN);
    } catch {
        return '';
    }
    const fileId = url.searchParams.get('fileImageId');
    if (url.protocol !== 'https:' || !['www.kmas.or.kr', 'kmas.or.kr'].includes(url.hostname)
        || url.username || url.password || url.port || url.hash
        || !/^\/common\/file\/atchmnflDownload\.ajax(?:;jsessionid=[a-z0-9]+)?$/i.test(url.pathname)
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fileId || '')) return '';
    // Session path parameters belong to the source page and must not be saved with portraits.
    return `${KMAS_ORIGIN}/common/file/atchmnflDownload.ajax?fileImageId=${fileId}`;
}

export function parseKmasAuthorList(html) {
    const grid = String(html || '').match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bboard-grid\b[^"']*["'][^>]*>([\s\S]*?)<\/ul\s*>/i)?.[1];
    if (grid === undefined) throw invalidResponse();
    const profiles = [];
    const seen = new Set();
    for (const anchor of grid.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a\s*>/gi)) {
        const id = decodeHTML(anchor[1]).match(/\bfnWritrDetail\(\s*['"](\d{10})['"]\s*\)/)?.[1];
        const name = htmlText(anchor[2].match(/<strong\b[^>]*>([\s\S]*?)<\/strong\s*>/i)?.[1], 200);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        const topWork = htmlText(anchor[2].match(/<span\b[^>]*\bclass\s*=\s*["'][^"']*\bexp\b[^"']*["'][^>]*>([\s\S]*?)<\/span\s*>/i)?.[1], 300);
        const sourceUrl = `${KMAS_ORIGIN}/archive/writrList/detail/${id}`;
        const photoUrl = imageUrlFromHtml(anchor[2]);
        profiles.push({
            provider: 'kmas',
            id: `kmas:${id}`,
            name,
            alternateNames: [],
            birthDate: '',
            description: topWork ? `대표작: ${topWork}` : '',
            topWork,
            works: topWork ? topWork.split(/\s*,\s*/).filter(Boolean).slice(0, 8) : [],
            photoUrl,
            sourceUrl,
            imageSourceUrl: photoUrl ? sourceUrl : '',
            authorVerified: true,
        });
        if (profiles.length === PROFILE_LIMIT) break;
    }
    if (!profiles.length && !/\bboard-nodata\b/.test(grid)) throw invalidResponse();
    return profiles;
}

export function parseKmasAuthorDetail(html, profile) {
    const basic = String(html || '').match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bvd-basic-con\b[^"']*["'][^>]*>([\s\S]*?)<\/ul\s*>/i)?.[1];
    const name = htmlText(basic?.match(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/i)?.[1], 200);
    if (!basic || !name || comparable(name) !== comparable(profile.name)) throw invalidResponse();
    const fields = new Map();
    for (const item of basic.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
        const spans = [...item[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span\s*>/gi)];
        if (spans.length === 2) fields.set(htmlText(spans[0][1]), htmlText(spans[1][1]));
    }
    const birthDate = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(fields.get('출생') || '') ? fields.get('출생') : '';
    const introduction = String(html || '').match(/<div\b[^>]*\bid\s*=\s*["']contents["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
    const portrait = String(html || '').match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bvd-image\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1];
    const photoUrl = imageUrlFromHtml(portrait || '') || profile.photoUrl;
    return {
        ...profile,
        birthDate,
        description: htmlText(introduction) || profile.description,
        photoUrl,
        imageSourceUrl: photoUrl ? profile.sourceUrl : '',
    };
}

export async function searchKmasAuthors(query, requestText) {
    const term = plainText(query, 200);
    if (!term) return [];
    const url = new URL('/archive/writrList', KMAS_ORIGIN);
    url.searchParams.set('searchWritrNm', term);
    const profiles = parseKmasAuthorList(await requestText(url.href));
    let cursor = 0;
    let partial = false;
    let stopped = false;
    const hydrate = async () => {
        while (!stopped && cursor < profiles.length) {
            const index = cursor++;
            const profile = profiles[index];
            try {
                profiles[index] = parseKmasAuthorDetail(await requestText(profile.sourceUrl), profile);
            } catch (error) {
                partial = true;
                if (['AUTHOR_PROFILE_RATE_LIMIT', 'AUTHOR_PROFILE_ACCESS_BLOCKED'].includes(error?.code)) stopped = true;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, profiles.length) }, hydrate));
    if (partial) Object.defineProperty(profiles, 'partial', { value: true });
    return profiles;
}
