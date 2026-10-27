import https from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MEMBER_SHEET = '/spreadsheets/d/10IYjP6cEZlQIHQqQoFWIbwgA2zs9fC2vqvgbUpE1jow/gviz/tq';
const HOST_GROUPS = {
    'www.aladin.co.kr': 'aladin',
    'store.kyobobook.co.kr': 'kyobo',
    'search.kyobobook.co.kr': 'kyobo',
    'www.cartoon.or.kr': 'cartoon',
    'cartoon.or.kr': 'cartoon',
    'kmas.or.kr': 'kmas',
    'www.kmas.or.kr': 'kmas',
    'docs.google.com': 'cartoon',
};

const failure = code => Object.assign(new Error('Author profile source could not be read.'), { code });

function endpoint(value) {
    let url;
    try { url = new URL(value); } catch { throw failure('AUTHOR_PROFILE_REQUEST_FAILED'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
        || url.href.length > 12000 || !HOST_GROUPS[url.hostname]
        || url.hostname === 'docs.google.com' && url.pathname !== MEMBER_SHEET) throw failure('AUTHOR_PROFILE_REQUEST_FAILED');
    return url;
}

function decodeText(buffer, headers) {
    try {
        const encoding = String(headers['content-encoding'] || '').toLowerCase();
        const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync }[encoding];
        if (encoding && encoding !== 'identity' && !decompress) throw new Error('encoding');
        if (decompress) buffer = decompress(buffer, { maxOutputLength: MAX_RESPONSE_BYTES });
        const declared = `${headers['content-type'] || ''} ${buffer.subarray(0, 2048).toString('ascii')}`;
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(declared)?.[1] || 'utf-8';
        return new TextDecoder(charset).decode(buffer);
    } catch {
        throw failure('AUTHOR_PROFILE_INVALID_RESPONSE');
    }
}

export function requestAuthorProfileText(value, options = {}, dependencies = {}) {
    const { request = https.request, timeoutMs = TIMEOUT_MS, now = Date.now } = dependencies;
    let initial;
    try { initial = endpoint(value); } catch (error) { return Promise.reject(error); }
    const method = options.method || 'GET';
    const body = options.body || '';
    if (!['GET', 'POST'].includes(method) || typeof body !== 'string' || Buffer.byteLength(body) > 16000
        || method === 'GET' && body) return Promise.reject(failure('AUTHOR_PROFILE_REQUEST_FAILED'));
    const headers = { 'User-Agent': 'BookManager author profiles (https://github.com/dongkkase/BookManager)', Accept: 'text/html,application/json' };
    for (const [key, item] of Object.entries(options.headers || {})) {
        if (['accept', 'content-type', 'referer', 'x-requested-with'].includes(key.toLowerCase())
            && typeof item === 'string' && !/[\r\n]/.test(item)) headers[key] = item;
    }
    if (method === 'POST') {
        headers['Content-Type'] ||= 'application/x-www-form-urlencoded; charset=UTF-8';
        headers['Content-Length'] = Buffer.byteLength(body);
    }
    return new Promise((resolve, reject) => {
        let activeRequest;
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(result);
        };
        const timer = setTimeout(() => {
            const error = failure('AUTHOR_PROFILE_TIMEOUT');
            finish(error);
            activeRequest?.destroy(error);
        }, timeoutMs);
        const load = (url, redirects = 0) => {
            try {
                activeRequest = request(url, { method, headers }, response => {
                    if (settled) { response.resume(); return; }
                    const status = response.statusCode;
                    if ([301, 302, 303, 307, 308].includes(status)) {
                        response.resume();
                        try {
                            const next = endpoint(new URL(response.headers.location, url).href);
                            if (redirects >= 3 || method !== 'GET' || HOST_GROUPS[next.hostname] !== HOST_GROUPS[initial.hostname]) throw new Error('redirect');
                            load(next, redirects + 1);
                        } catch { finish(failure('AUTHOR_PROFILE_REQUEST_FAILED')); }
                        return;
                    }
                    if (status < 200 || status >= 300) {
                        response.resume();
                        const retryAfter = response.headers['retry-after'];
                        const retryAfterMs = typeof retryAfter === 'string'
                            ? /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now() : 0;
                        const limited = status === 429 || status === 503 && retryAfterMs > 0;
                        const error = failure(limited ? 'AUTHOR_PROFILE_RATE_LIMIT'
                            : status === 401 || status === 403 ? 'AUTHOR_PROFILE_ACCESS_BLOCKED' : 'AUTHOR_PROFILE_REQUEST_FAILED');
                        if (limited && Number.isFinite(retryAfterMs) && retryAfterMs > 0) error.retryAfterMs = retryAfterMs;
                        finish(error);
                        return;
                    }
                    const chunks = [];
                    let bytes = 0;
                    response.on('data', chunk => {
                        if (settled) return;
                        bytes += Buffer.byteLength(chunk);
                        if (bytes > MAX_RESPONSE_BYTES) {
                            const error = failure('AUTHOR_PROFILE_INVALID_RESPONSE');
                            finish(error);
                            response.destroy();
                            activeRequest?.destroy(error);
                        } else chunks.push(Buffer.from(chunk));
                    });
                    response.on('end', () => {
                        if (settled) return;
                        try { finish(null, decodeText(Buffer.concat(chunks), response.headers)); }
                        catch (error) { finish(error); }
                    });
                    response.on('aborted', () => finish(failure('AUTHOR_PROFILE_REQUEST_FAILED')));
                    response.on('error', () => finish(failure('AUTHOR_PROFILE_REQUEST_FAILED')));
                });
                activeRequest.on('error', () => finish(failure('AUTHOR_PROFILE_REQUEST_FAILED')));
                if (body) activeRequest.write(body);
                activeRequest.end();
            } catch { finish(failure('AUTHOR_PROFILE_REQUEST_FAILED')); }
        };
        load(initial);
    });
}
