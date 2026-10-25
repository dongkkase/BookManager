import { metadataSearchResultKey } from './metadataSearch.js';

const STOP_CREDIT_ERRORS = new Set(['API_AUTH_REQUIRED', 'API_AUTH_FAILED', 'API_ACCESS_BLOCKED', 'API_RATE_LIMIT', 'API_DISABLED']);

function field(result, name) {
    return result?.metadata?.[name] || result?.[name] || '';
}

function sourceCover(result) {
    return result?.coverUrl || field(result, 'CoverUrl');
}

export function isComicVinePlaceholderCover(value) {
    try {
        const url = new URL(value);
        return (url.hostname === 'comicvine.gamespot.com' || /^comicvine(?:\d+)?\.cbsistatic\.com$/.test(url.hostname))
            && url.pathname.split('/').pop().toLowerCase() === '6373148-blank.png';
    } catch {
        return false;
    }
}

export function comicVineSearchThumbnail(result = {}) {
    const source = sourceCover(result);
    if (isComicVinePlaceholderCover(source)) return '';
    const cached = result.coverCacheUrl || result.coverDataUrl;
    if (cached) return cached;
    if (!result.comicVineEnrichmentDeferred || /^(?:data:|file:|bookmanager-thumbnail:)/i.test(source)) return source;
    return '';
}

export function mergeComicVineSearchEnrichment(result, update) {
    if (update.kind === 'coverSource') {
        const detail = update.result || {};
        const merged = { ...result, metadata: { ...result.metadata } };
        for (const name of ['Publisher', 'Count']) {
            const current = [result.metadata?.[name], result[name], name === 'Publisher' ? result.publisher : undefined]
                .find(value => value !== undefined && value !== null && value !== '');
            const incoming = detail.metadata?.[name] ?? detail[name];
            if ((current === undefined || current === null || current === '') && incoming !== undefined && incoming !== null && incoming !== '') {
                merged[name] = incoming;
                merged.metadata[name] = incoming;
            }
        }
        merged.publisher = result.publisher || merged.Publisher || merged.metadata.Publisher || '';
        const currentSource = sourceCover(result);
        const nextSource = sourceCover(detail);
        if ((!currentSource || isComicVinePlaceholderCover(currentSource)) && nextSource && !isComicVinePlaceholderCover(nextSource)) {
            merged.coverUrl = nextSource;
            merged.CoverUrl = nextSource;
            merged.CoverUrls = (Array.isArray(detail.CoverUrls) ? detail.CoverUrls : [nextSource]).filter(url => !isComicVinePlaceholderCover(url));
            merged.metadata.CoverUrl = nextSource;
            merged.coverCacheUrl = '';
            merged.coverDataUrl = '';
        }
        return merged;
    }
    if (update.kind === 'cover') {
        if (sourceCover(result) !== update.sourceUrl) return result;
        return {
            ...result,
            coverUrl: update.imageUrl,
            CoverUrl: update.imageUrl,
            coverCacheUrl: update.coverCacheUrl,
            metadata: { ...result.metadata, CoverUrl: update.imageUrl },
        };
    }
    if (update.kind !== 'credits') return result;
    if (update.issueId && String(result.comicVineFirstIssueId || '') !== update.issueId) return result;
    const credits = update.result || {};
    const Writer = field(result, 'Writer') || field(credits, 'Writer');
    const Penciller = field(result, 'Penciller') || field(credits, 'Penciller');
    const merged = {
        ...result,
        Writer,
        Penciller,
        author: Writer || Penciller || result.author || '',
        metadata: { ...result.metadata, Writer, Penciller },
        comicVineCreditsResolved: true,
    };
    for (const name of ['comicVineCreditsIssueId', 'comicVineCreditsIssueNumber', 'comicVineCreditsIssueWeb']) {
        if (!merged[name] && credits[name]) merged[name] = credits[name];
    }
    return merged;
}

export function createComicVineSearchEnricher({ fetchCredits, fetchCovers, cacheCover, onUpdate, isCancelled = () => false }) {
    const currentResults = new Map();
    const creditKeys = new Set();
    const coverKeys = new Set();
    const sourceKeys = new Set();
    const cachedImages = new Map();
    const creditJobs = [];
    const coverJobs = [];
    const sourceJobs = [];
    let activeCredits = 0;
    let activeCovers = 0;
    let activeSources = false;
    let creditsStopped = false;
    let cancelled = false;
    const stopped = () => cancelled || isCancelled();

    const publish = (key, update) => {
        if (!stopped()) onUpdate(key, update);
    };
    const loadCredits = async ({ key, issueId }) => {
        const result = currentResults.get(key);
        if (!result || String(result.comicVineFirstIssueId || '') !== issueId || result.comicVineCreditsResolved
            || (field(result, 'Writer') && field(result, 'Penciller'))) return;
        try {
            const response = await fetchCredits(result.id || result.ID, issueId);
            if (stopped()) return;
            if (response?.success && response.result) publish(key, { kind: 'credits', issueId, result: response.result });
            else if (STOP_CREDIT_ERRORS.has(response?.code)) creditsStopped = true;
        } catch (error) {
            if (STOP_CREDIT_ERRORS.has(error?.code)) creditsStopped = true;
        }
    };
    const loadCover = async ({ key, sourceUrl, candidates }) => {
        const result = currentResults.get(key);
        if (!result || result.coverCacheUrl || result.coverDataUrl || sourceCover(result) !== sourceUrl) return;
        for (const imageUrl of candidates) {
            if (stopped()) return;
            try {
                if (!cachedImages.has(imageUrl)) cachedImages.set(imageUrl, Promise.resolve().then(() => stopped() ? null : cacheCover(imageUrl)));
                const cached = await cachedImages.get(imageUrl);
                if (stopped()) return;
                if (!cached?.coverCacheUrl) continue;
                publish(key, { kind: 'cover', sourceUrl, imageUrl, coverCacheUrl: cached.coverCacheUrl });
                return;
            } catch {
                // 다음 이미지 크기를 시도하고 검색 결과는 그대로 유지합니다.
            }
        }
    };
    const loadCoverSources = async jobs => {
        const pending = jobs.filter(({ key }) => {
            const current = currentResults.get(key);
            return current && (!sourceCover(current) || isComicVinePlaceholderCover(sourceCover(current)));
        });
        if (pending.length === 0) return;
        try {
            const response = await fetchCovers(pending.map(job => job.id));
            if (stopped() || !response?.success || !Array.isArray(response.results)) return;
            const keysById = new Map(pending.map(({ id, key }) => [id, key]));
            for (const detail of response.results) {
                const key = keysById.get(String(detail.ID || detail.id || ''));
                if (key) publish(key, { kind: 'coverSource', result: detail });
            }
        } catch {
            // 표지 주소를 얻지 못하면 다음 검색에서 다시 시도합니다.
        }
    };
    const pump = () => {
        if (stopped()) return;
        if (!activeSources && sourceJobs.length > 0) {
            activeSources = true;
            loadCoverSources(sourceJobs.splice(0, 10)).finally(() => { activeSources = false; pump(); });
        }
        while (!creditsStopped && activeCredits < 2 && creditJobs.length > 0) {
            activeCredits += 1;
            loadCredits(creditJobs.shift()).finally(() => { activeCredits -= 1; pump(); });
        }
        while (activeCovers < 3 && coverJobs.length > 0) {
            activeCovers += 1;
            loadCover(coverJobs.shift()).finally(() => { activeCovers -= 1; pump(); });
        }
    };

    return {
        enqueue(results = [], fallbackSource = '') {
            if (stopped()) return;
            for (const result of results) {
                if ((result.apiSource || fallbackSource) !== 'Vine') continue;
                const key = metadataSearchResultKey(result, 'Vine');
                currentResults.set(key, result);
                const issueId = String(result.comicVineFirstIssueId || '');
                const creditKey = JSON.stringify([key, issueId]);
                if (typeof fetchCredits === 'function' && /^[1-9]\d*$/.test(issueId) && !creditKeys.has(creditKey)) {
                    creditKeys.add(creditKey);
                    creditJobs.push({ key, issueId });
                }
                const sourceUrl = sourceCover(result);
                const id = String(result.id || result.ID || '').replace(/^4050-/, '');
                if (typeof fetchCovers === 'function' && /^[1-9]\d*$/.test(id) && !sourceKeys.has(key)
                    && (!sourceUrl || isComicVinePlaceholderCover(sourceUrl))) {
                    sourceKeys.add(key);
                    sourceJobs.push({ key, id });
                }
                const candidates = [...new Set([sourceUrl, ...(Array.isArray(result.CoverUrls) ? result.CoverUrls : [])])]
                    .filter(url => typeof url === 'string' && /^https?:\/\//i.test(url) && !isComicVinePlaceholderCover(url)).slice(0, 3);
                const coverKey = JSON.stringify([key, sourceUrl, candidates]);
                if (typeof cacheCover === 'function' && candidates.length > 0 && !coverKeys.has(coverKey)) {
                    coverKeys.add(coverKey);
                    coverJobs.push({ key, sourceUrl, candidates });
                }
            }
            pump();
        },
        cancel() {
            cancelled = true;
            creditJobs.length = 0;
            coverJobs.length = 0;
            sourceJobs.length = 0;
        },
    };
}
