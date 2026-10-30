import { createHash } from 'node:crypto';
import { decodeHTML } from 'entities';
import { normalizeAuthorProfile } from '../src/authorCatalog.js';

export const authorWebError = code => Object.assign(new Error('Author web search could not be completed.'), { code });
const text = (value, limit = 1000) => decodeHTML(String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const attributes = value => Object.fromEntries([...value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(match => [match[1].toLowerCase(), decodeHTML(match[2] ?? match[3])]));

function checkPage(html) {
    if (typeof html !== 'string' || html.length > 3 * 1024 * 1024) throw authorWebError('AUTHOR_PROFILE_INVALID_RESPONSE');
    if (/<title[^>]*>[^<]*(?:just a moment|access denied|attention required)/i.test(html)
        || /id=["'](?:challenge-form|cf-challenge-running)["']/i.test(html)) throw authorWebError('AUTHOR_PROFILE_ACCESS_BLOCKED');
}

export function parseNamuProfile(html, pageTitle) {
    checkPage(html);
    const meta = {};
    for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
        const attrs = attributes(match[1]);
        if (attrs.property) meta[attrs.property] = attrs.content;
    }
    const title = text(meta['og:title'] || pageTitle, 300);
    const fields = new Map();
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => text(cell[1]));
        if (cells.length >= 2 && !fields.has(cells[0])) fields.set(cells[0], cells[1].replace(/\[\d+\]/g, '').trim());
    }
    // A title match alone can be a place, book, or disambiguation page.
    if (!fields.has('출생') && !fields.has('본명') && !fields.has('직업')) return null;
    const overview = html.match(/<h2\b[^>]*>[\s\S]*?\bid=["']개요["'][\s\S]*?<\/h2>([\s\S]*?)(?:<h2\b|$)/i)?.[1];
    const paragraphs = overview ? [...overview.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, '')
        .matchAll(/<div\b[^>]*class=["']wiki-paragraph["'][^>]*>([\s\S]*?)<\/div>/gi)].map(match => text(match[1])).filter(Boolean) : [];
    const sourceUrl = `https://namu.wiki/w/${encodeURIComponent(title)}`;
    const date = key => (fields.get(key) || '').replace(/\s*\(\s*\d+\s*세\s*\)/g, '').trim();
    return normalizeAuthorProfile({
        provider: 'namuwiki', id: `namuwiki:${title}`, name: title.replace(/\s*\([^()]*\)$/, ''),
        alternateNames: [title], birthDate: date('출생'), deathDate: date('사망'),
        topWork: fields.get('대표작') || '', works: [],
        description: text(paragraphs.join(' ') || meta['og:description']), sourceUrl,
        photoUrl: meta['og:image'] ? new URL(meta['og:image'], 'https://namu.wiki').href : '', imageSourceUrl: sourceUrl,
    });
}

export async function searchNamuAuthors(query, request) {
    const html = await request(`https://namu.wiki/Search?${new URLSearchParams({ q: query, target: 'title' })}`);
    checkPage(html);
    if (!/<title[^>]*>[^<]*나무위키/i.test(html)) throw authorWebError('AUTHOR_PROFILE_INVALID_RESPONSE');
    const candidates = [];
    for (const heading of html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)) {
        const link = heading[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
        if (!link) continue;
        let url;
        try { url = new URL(attributes(link[1]).href, 'https://namu.wiki'); } catch { continue; }
        if (url.origin !== 'https://namu.wiki' || !url.pathname.startsWith('/w/')) continue;
        let title;
        try { title = decodeURIComponent(url.pathname.slice(3)); } catch { continue; }
        if (title.includes(':') || title.includes('/') || candidates.some(item => item.title === title)) continue;
        candidates.push({ url: url.href, title });
    }
    const rank = title => /작가|소설가|만화가|시인|漫画家|小説家/.test(title) ? 0 : title === query ? 1 : 2;
    candidates.sort((a, b) => rank(a.title) - rank(b.title));
    const profiles = [];
    let failed = false;
    for (const candidate of candidates.slice(0, 8)) {
        try {
            const profile = parseNamuProfile(await request(candidate.url), candidate.title);
            if (profile && !profiles.some(item => item.id === profile.id)) profiles.push(profile);
        } catch (error) {
            if (['AUTHOR_PROFILE_ACCESS_BLOCKED', 'AUTHOR_PROFILE_RATE_LIMIT'].includes(error?.code)) throw error;
            failed = true;
        }
    }
    if (failed) {
        if (!profiles.length) throw authorWebError('AUTHOR_PROFILE_REQUEST_FAILED');
        Object.defineProperty(profiles, 'partial', { value: true });
    }
    return profiles;
}

export function googleAuthorProfile(entry, query) {
    if (!entry || typeof entry.url !== 'string' || !text(entry.title)) return null;
    return normalizeAuthorProfile({
        provider: 'google', id: `google:${createHash('sha256').update(entry.url).digest('hex')}`,
        name: text(query, 200), description: text([entry.title, entry.description].filter(Boolean).join('\n')),
        sourceUrl: entry.url, photoUrl: entry.image || '', imageSourceUrl: entry.url,
    });
}

let googleQueue = Promise.resolve();
let googleRetryAt = 0;
const googleRequests = new Map();
const googleCancellations = new WeakMap();
export function createGoogleSearchCancellationCheck(window) {
    const version = googleCancellations.get(window);
    return () => googleCancellations.get(window) !== version || Boolean(window?.isDestroyed());
}

export function cancelGoogleAuthorSearches(window) {
    if (window) googleCancellations.set(window, (googleCancellations.get(window) || 0) + 1);
    for (const controller of googleRequests.get(window) || []) controller.abort();
}

export function searchGoogleAuthors(query, _request, options = {}) {
    const parentWindow = options.getMainWindow?.();
    const controller = new AbortController();
    if (parentWindow) {
        if (!googleRequests.has(parentWindow)) googleRequests.set(parentWindow, new Set());
        googleRequests.get(parentWindow).add(controller);
    }
    const result = googleQueue.then(async () => {
        if (controller.signal.aborted || options.isCancelled?.()) throw authorWebError('AUTHOR_PROFILE_CANCELLED');
        if (Date.now() < googleRetryAt) throw authorWebError('AUTHOR_PROFILE_ACCESS_BLOCKED');
        const { openAuthorWebSearch } = await import('./authorWebSearchWindow.js');
        if (options.getMainWindow && (!parentWindow || parentWindow.isDestroyed())) throw authorWebError('AUTHOR_PROFILE_REQUEST_FAILED');
        try { return await openAuthorWebSearch({ source: 'google', query, kind: options.photos ? 'photo' : 'profile', parentWindow, signal: controller.signal }); }
        catch (error) {
            if (error?.code === 'AUTHOR_PROFILE_ACCESS_BLOCKED') googleRetryAt = Date.now() + 60000;
            throw error;
        }
    }).finally(() => {
        const requests = googleRequests.get(parentWindow);
        requests?.delete(controller);
        if (requests?.size === 0) googleRequests.delete(parentWindow);
    });
    googleQueue = result.catch(() => {});
    return result;
}
