import { decodeHTML } from 'entities';

const PROFILE_LIMIT = 8;
const ALADIN_ORIGIN = 'https://www.aladin.co.kr';
const KYOBO_ORIGIN = 'https://store.kyobobook.co.kr';

function invalidResponse() {
    const error = new Error('The author profile source returned an invalid response.');
    error.code = 'AUTHOR_PROFILE_INVALID_RESPONSE';
    return error;
}

function checkAccess(html) {
    if (/<title\b[^>]*>[^<]*(?:access denied|just a moment|attention required|robot check|접근.{0,8}차단)/i.test(html)
        || /<[^>]+\bid=["'](?:challenge-form|cf-challenge-running)["']/i.test(html)) {
        const error = new Error('The author profile source is blocking this request.');
        error.code = 'AUTHOR_PROFILE_ACCESS_BLOCKED';
        throw error;
    }
}

function text(value, limit = 4000) {
    return typeof value === 'string'
        ? decodeHTML(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' '))
            .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
        : '';
}

function attributes(tag) {
    const values = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        values[match[1].toLowerCase()] = decodeHTML(match[2] ?? match[3]);
    }
    return values;
}

function authorPhoto(value, provider, id) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
        if (provider === 'aladin') {
            return url.hostname === 'image.aladin.co.kr'
                && new RegExp(`^/Author/Photo/${id}/${id}(?:_\\d+)?\\.(?:jpe?g|png|webp)$`, 'i').test(url.pathname)
                ? url.href : '';
        }
        return url.hostname === 'contents.kyobobook.co.kr'
            && new RegExp(`^/(?:sih/)?(?:fit-in/\\d+x\\d+/)?dtl/author/${id}\\.jpg$`).test(url.pathname)
            ? url.href : '';
    } catch {
        return '';
    }
}

function works(values) {
    return [...new Set(values.map(value => text(value, 300)).filter(Boolean))].slice(0, 8);
}

function rankByName(profiles, query) {
    const normalized = query.replace(/\s+/g, '').toLocaleLowerCase();
    const rank = profile => {
        const name = profile.name.replace(/\s+/g, '').toLocaleLowerCase();
        return name === normalized ? 0 : name.includes(normalized) ? 1 : 2;
    };
    return profiles.sort((left, right) => rank(left) - rank(right)).slice(0, PROFILE_LIMIT);
}

function baseProfile(provider, id, name) {
    const sourceUrl = provider === 'aladin'
        ? `${ALADIN_ORIGIN}/author/wauthor_overview.aspx?AuthorSearch=@${id}`
        : `${KYOBO_ORIGIN}/person/detail/${id}`;
    return {
        provider,
        id: `${provider}:${id}`,
        name: text(name, 300),
        alternateNames: [],
        birthDate: '',
        description: '',
        topWork: '',
        works: [],
        photoUrl: '',
        sourceUrl,
        imageSourceUrl: sourceUrl,
        authorVerified: true,
    };
}

function aladinCandidates(html) {
    checkAccess(html);
    const results = html.match(/<!--\s*검색결과 시작\s*-->([\s\S]*?)<!--\s*검색결과 끝\s*-->/);
    if (!results) throw invalidResponse();
    const seen = new Set();
    const profiles = [];
    for (const entry of results[1].matchAll(/<div\b[^>]*class=["']newbg_authorbox["'][^>]*>([\s\S]*?)<\/table>/gi)) {
        const nameLink = [...entry[1].matchAll(/<a\b([^>]*)>\s*<strong>([\s\S]*?)<\/strong>\s*<\/a>/gi)]
            .map(match => ({ href: attributes(match[1]).href, name: text(match[2], 300) }))[0];
        if (!nameLink?.name) continue;
        let url;
        try { url = new URL(nameLink.href, ALADIN_ORIGIN); } catch { continue; }
        const id = url.searchParams.get('AuthorSearch')?.match(/^@([1-9]\d{0,14})$/)?.[1];
        if (url.origin !== ALADIN_ORIGIN || url.pathname !== '/author/wauthor_overview.aspx' || !id || seen.has(id)) continue;
        seen.add(id);
        const profile = baseProfile('aladin', id, nameLink.name);
        for (const image of entry[1].matchAll(/<img\b([^>]*)>/gi)) {
            profile.photoUrl = authorPhoto(attributes(image[1]).src, 'aladin', id);
            if (profile.photoUrl) break;
        }
        profile.works = works([...entry[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
            .filter(match => attributes(match[1]).class?.split(/\s+/).includes('au_book'))
            .map(match => text(match[2]).replace(/^<|>$/g, '')));
        profile.topWork = profile.works[0] || '';
        profiles.push(profile);
    }
    return profiles;
}

function findObject(value, predicate) {
    const pending = [value];
    let visited = 0;
    while (pending.length && visited++ < 50000) {
        const item = pending.pop();
        if (!item || typeof item !== 'object') continue;
        if (!Array.isArray(item) && predicate(item)) return item;
        pending.push(...Object.values(item).filter(child => child && typeof child === 'object'));
    }
    return null;
}

function aladinDetail(html, profile) {
    checkAccess(html);
    const id = profile.id.split(':')[1];
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (attributes(script[1]).type !== 'application/ld+json') continue;
        let json;
        try { json = JSON.parse(script[2]); } catch { continue; }
        const person = findObject(json, item => item['@type'] === 'Person' && text(item.name) === profile.name);
        if (!person) continue;
        if (person.url && new URL(person.url, ALADIN_ORIGIN).href !== profile.sourceUrl) continue;
        profile.birthDate = text(person.birthDate, 100);
        profile.description = text(person.description);
        profile.photoUrl = authorPhoto(typeof person.image === 'string' ? person.image : person.image?.url, 'aladin', id) || profile.photoUrl;
        const titles = works((Array.isArray(person.owns) ? person.owns : []).filter(item => item?.['@type'] === 'Book').map(item => item.name));
        if (titles.length) profile.works = titles;
        profile.topWork = profile.works[0] || '';
        return profile;
    }
    throw invalidResponse();
}

function kyoboCandidates(response) {
    checkAccess(response);
    let json;
    try { json = JSON.parse(response); } catch { throw invalidResponse(); }
    if (json.statusCode !== 200 || json.resultCode !== '000000' || !Array.isArray(json.data?.writerList)) throw invalidResponse();
    const seen = new Set();
    return json.data.writerList.flatMap(entry => {
        const item = entry?.writerInfo;
        const id = String(item?.chrcCode ?? '');
        if (!/^\d{10}$/.test(id) || !text(item?.chrcName) || seen.has(id)) return [];
        seen.add(id);
        const profile = baseProfile('kyobo', id, item.chrcName);
        profile.alternateNames = text(item.chrcEnsnName, 300) ? [text(item.chrcEnsnName, 300)] : [];
        profile.description = text(item.chrcIntcCntt);
        profile.works = works((Array.isArray(entry.representativeBook) ? entry.representativeBook : []).map(book => book?.cmdtName));
        profile.topWork = profile.works[0] || '';
        return [profile];
    });
}

function kyoboDetail(html, profile) {
    checkAccess(html);
    const id = profile.id.split(':')[1];
    const chunks = [];
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const payload = script[1].trim().match(/^self\.__next_f\.push\(([\s\S]*)\);?$/);
        if (!payload) continue;
        try {
            const chunk = JSON.parse(payload[1]);
            if (chunk[0] === 1 && typeof chunk[1] === 'string') chunks.push(chunk[1]);
        } catch { /* Ignore non-data scripts; never execute source scripts. */ }
    }
    let person;
    for (const line of chunks.join('').split('\n')) {
        const record = line.match(/^[0-9a-f]+:([\[{][\s\S]*)$/i);
        if (!record) continue;
        try {
            person = findObject(JSON.parse(record[1]), item => item.chrcCode === id && item.chrcName && Object.hasOwn(item, 'chrcIntcCntt'));
        } catch { continue; }
        if (person) break;
    }
    if (!person) throw invalidResponse();
    profile.name = text(person.chrcName, 300) || profile.name;
    profile.description = text(person.chrcIntcCntt) || profile.description;
    profile.alternateNames = text(person.chrcEnsnName, 300) ? [text(person.chrcEnsnName, 300)] : profile.alternateNames;
    const birthDate = text(person.chrcBrdy, 100);
    const date = birthDate.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
    profile.birthDate = date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : birthDate;
    if (person.phtgYsno === 'Y') {
        for (const image of html.matchAll(/<img\b([^>]*)>/gi)) {
            profile.photoUrl = authorPhoto(attributes(image[1]).src, 'kyobo', id);
            if (profile.photoUrl) break;
        }
    }
    return profile;
}

async function withDetails(profiles, requestText, parseDetail) {
    let cursor = 0;
    let stopped = false;
    await Promise.all(Array.from({ length: Math.min(2, profiles.length) }, async () => {
        while (!stopped && cursor < profiles.length) {
            const profile = profiles[cursor++];
            try {
                parseDetail(await requestText(profile.sourceUrl), profile);
            } catch (error) {
                profiles.partial = true;
                if (['AUTHOR_PROFILE_RATE_LIMIT', 'AUTHOR_PROFILE_ACCESS_BLOCKED'].includes(error?.code)) stopped = true;
            }
        }
    }));
    return profiles;
}

export async function searchAladinAuthors(query, requestText) {
    const term = text(query, 200);
    if (!term) return [];
    const url = `${ALADIN_ORIGIN}/author/search/wauthor_search_name.aspx?SearchWord=${encodeURIComponent(term)}`;
    return withDetails(rankByName(aladinCandidates(await requestText(url)), term), requestText, aladinDetail);
}

export async function searchKyoboAuthors(query, requestText) {
    const term = text(query, 200);
    if (!term) return [];
    const url = `${KYOBO_ORIGIN}/api/gw/store/author/search?page=1&per=20&searchCode=001&searchText=${encodeURIComponent(term)}&sort=new`;
    return withDetails(rankByName(kyoboCandidates(await requestText(url)), term), requestText, kyoboDetail);
}
