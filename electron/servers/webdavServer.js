import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    archiveMimeType,
    contentDispositionForFile,
    escapeXml,
    httpDate,
    isWithinRoot,
    naturalComparePath,
    normalizeSharingRoots,
    realPathOrResolved,
    sharingText,
    webdavDownloadMimeType,
    webdavEtag,
} from './shared/sharingCommon.js';

const WEBDAV_AUTH_REALM = 'BookManager';
const WEBDAV_NONCE_TTL_MS = 10 * 60 * 1000;
const WEBDAV_AUTH_GRACE_MS = 5 * 60 * 1000;

function md5Hex(value) {
    return crypto.createHash('md5').update(String(value)).digest('hex');
}

function safeStringEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodedBasicCredentials(encoded) {
    const buffer = Buffer.from(String(encoded || ''), 'base64');
    const candidates = [buffer.toString('utf8'), buffer.toString('latin1')];
    return candidates.map(decoded => {
        const splitAt = decoded.indexOf(':');
        if (splitAt < 0) return null;
        return {
            username: decoded.slice(0, splitAt),
            password: decoded.slice(splitAt + 1),
        };
    }).filter(Boolean);
}

function checkBasicAuth(req, username, password) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Basic\s+(.+)$/i);
    if (!match) return false;

    try {
        return decodedBasicCredentials(match[1]).some(credentials => (
            safeStringEqual(credentials.username, username)
            && safeStringEqual(credentials.password, password)
        ));
    } catch (_error) {
        return false;
    }
}

function parseAuthParams(value = '') {
    const params = {};
    let index = 0;

    while (index < value.length) {
        while (index < value.length && /[\s,]/.test(value[index])) index += 1;
        const keyStart = index;
        while (index < value.length && !/[\s=,]/.test(value[index])) index += 1;
        const key = value.slice(keyStart, index).toLowerCase();
        while (index < value.length && /\s/.test(value[index])) index += 1;
        if (!key || value[index] !== '=') {
            while (index < value.length && value[index] !== ',') index += 1;
            continue;
        }
        index += 1;
        while (index < value.length && /\s/.test(value[index])) index += 1;

        let paramValue = '';
        if (value[index] === '"') {
            index += 1;
            while (index < value.length) {
                const char = value[index];
                if (char === '\\' && index + 1 < value.length) {
                    paramValue += value[index + 1];
                    index += 2;
                    continue;
                }
                if (char === '"') {
                    index += 1;
                    break;
                }
                paramValue += char;
                index += 1;
            }
        } else {
            const valueStart = index;
            while (index < value.length && value[index] !== ',') index += 1;
            paramValue = value.slice(valueStart, index).trim();
        }
        params[key] = paramValue;
    }

    return params;
}

function createDigestChallenge(nonces, stale = false) {
    const nonce = crypto.randomBytes(18).toString('base64url');
    nonces.set(nonce, Date.now());
    return `Digest realm="${WEBDAV_AUTH_REALM}", qop="auth", nonce="${nonce}", algorithm=MD5${stale ? ', stale=true' : ''}`;
}

function pruneDigestNonces(nonces) {
    const now = Date.now();
    for (const [nonce, createdAt] of nonces.entries()) {
        if (now - createdAt > WEBDAV_NONCE_TTL_MS) nonces.delete(nonce);
    }
}

function checkDigestAuth(req, username, password, nonces) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Digest\s+(.+)$/i);
    if (!match) return { ok: false, digest: false };

    const params = parseAuthParams(match[1]);
    const createdAt = nonces.get(params.nonce);
    const isStale = !createdAt || Date.now() - createdAt > WEBDAV_NONCE_TTL_MS;
    if (isStale) {
        nonces.delete(params.nonce);
        return { ok: false, digest: true, stale: true };
    }

    const algorithm = String(params.algorithm || 'MD5').toUpperCase();
    const qop = String(params.qop || '').toLowerCase();
    if (
        !['MD5', 'MD5-SESS'].includes(algorithm)
        || params.username !== username
        || params.realm !== WEBDAV_AUTH_REALM
        || !params.uri
        || !params.response
        || (params.qop && qop !== 'auth')
        || (params.qop && (!params.nc || !params.cnonce))
    ) {
        return { ok: false, digest: true };
    }

    const baseHa1 = md5Hex(`${username}:${WEBDAV_AUTH_REALM}:${password}`);
    const ha1 = algorithm === 'MD5-SESS'
        ? md5Hex(`${baseHa1}:${params.nonce}:${params.cnonce}`)
        : baseHa1;
    const ha2 = md5Hex(`${req.method}:${params.uri}`);
    const expected = params.qop
        ? md5Hex(`${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${qop}:${ha2}`)
        : md5Hex(`${ha1}:${params.nonce}:${ha2}`);

    return { ok: safeStringEqual(expected, params.response), digest: true };
}

function checkWebdavAuth(req, username, password, nonces) {
    const header = req.headers.authorization || '';
    if (!header) return { ok: false, missing: true };
    if (checkBasicAuth(req, username, password)) return { ok: true };
    const digestResult = checkDigestAuth(req, username, password, nonces);
    if (digestResult.digest) return digestResult;
    return { ok: false };
}

function webdavClientKey(req) {
    return req.ip || req.socket?.remoteAddress || '';
}

function rememberWebdavAuthenticatedClient(req, authenticatedClients) {
    const key = webdavClientKey(req);
    if (key) authenticatedClients.set(key, Date.now());
}

function pruneWebdavAuthenticatedClients(authenticatedClients) {
    const now = Date.now();
    for (const [key, authenticatedAt] of authenticatedClients.entries()) {
        if (now - authenticatedAt > WEBDAV_AUTH_GRACE_MS) authenticatedClients.delete(key);
    }
}

function canUseWebdavAuthGrace(req, authenticatedClients) {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    if (!/ComicGlassStream/i.test(String(req.headers['user-agent'] || ''))) return false;

    pruneWebdavAuthenticatedClients(authenticatedClients);
    const authenticatedAt = authenticatedClients.get(webdavClientKey(req));
    return Boolean(authenticatedAt && Date.now() - authenticatedAt <= WEBDAV_AUTH_GRACE_MS);
}

function setWebdavProtocolHeaders(res) {
    const methods = 'OPTIONS, GET, HEAD, PROPFIND, LOCK, UNLOCK';
    res.setHeader('DAV', '1,2');
    res.setHeader('MS-Author-Via', 'DAV');
    res.setHeader('Allow', methods);
    res.setHeader('Public', methods);
}

function setWebdavAuthChallenge(res, nonces, stale = false) {
    pruneDigestNonces(nonces);
    setWebdavProtocolHeaders(res);
    res.setHeader('WWW-Authenticate', [
        `Basic realm="${WEBDAV_AUTH_REALM}"`,
        createDigestChallenge(nonces, stale),
    ]);
}

function sanitizeWebdavShareName(name = '', fallback = 'Library') {
    return String(name || fallback).replace(/[\\/:*?"<>|]/g, '_').trim() || fallback;
}

function buildWebdavShares(roots = []) {
    const used = new Set();
    return roots.map((root, index) => {
        const baseName = sanitizeWebdavShareName(path.basename(root) || `Library_${index + 1}`, `Library_${index + 1}`);
        let name = baseName;
        let counter = 1;
        while (used.has(name)) {
            name = `${baseName}_${counter}`;
            counter += 1;
        }
        used.add(name);
        return {
            root,
            rootIndex: index,
            name,
            href: `/${encodeURIComponent(name)}/`,
        };
    });
}

function webdavHrefFromFile(share, filePath) {
    const relative = path.relative(share.root, filePath)
        .split(path.sep)
        .map(encodeURIComponent)
        .join('/');
    const suffix = fs.statSync(filePath).isDirectory() && relative ? '/' : '';
    return `${share.href}${relative}${suffix}`;
}

function normalizeWebdavSegment(value = '') {
    return String(value).normalize('NFC');
}

function findWebdavChild(parentPath, requestedName) {
    const requested = normalizeWebdavSegment(requestedName);
    const entries = fs.readdirSync(parentPath, { withFileTypes: true });
    const matched = entries.find(entry => normalizeWebdavSegment(entry.name) === requested);
    return matched ? path.join(parentPath, matched.name) : '';
}

function resolveWebdavRelativePath(root, relativeParts) {
    let current = root;
    for (const part of relativeParts) {
        const next = findWebdavChild(current, part);
        if (!next) return '';
        current = next;
    }
    return current;
}

export function resolveWebdavPath(urlPath, roots, shares = buildWebdavShares(roots)) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (_error) {
        return null;
    }

    const parts = decoded.split('/').filter(Boolean);
    const requestedShareName = normalizeWebdavSegment(parts[0]);
    const share = shares.find(candidate => normalizeWebdavSegment(candidate.name) === requestedShareName);
    if (!share) return null;

    const relativeParts = parts.slice(1);
    if (relativeParts.some(part => part === '.' || part === '..' || part.includes('\0'))) return null;

    const resolved = relativeParts.length
        ? resolveWebdavRelativePath(share.root, relativeParts)
        : share.root;
    if (!fs.existsSync(resolved) || !isWithinRoot(resolved, [share.root])) return null;
    return { rootIndex: share.rootIndex, share, resolved: realPathOrResolved(resolved) };
}

function propfindItemXml({ filePath, href, displayName }) {
    const stats = filePath ? fs.statSync(filePath) : null;
    const isDirectory = !stats || stats.isDirectory();
    const contentType = isDirectory ? '' : `<d:getcontenttype>${escapeXml(archiveMimeType(filePath))}</d:getcontenttype>`;
    const creationDate = stats ? stats.birthtime.toISOString() : new Date(0).toISOString();
    const lastModified = stats ? httpDate(stats.mtime) : new Date(0).toUTCString();
    const etag = stats && !isDirectory ? `<d:getetag>${escapeXml(webdavEtag(stats))}</d:getetag>` : '';

    return `<d:response>
  <d:href>${escapeXml(href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${escapeXml(displayName || path.basename(filePath) || filePath)}</d:displayname>
      <d:creationdate>${escapeXml(creationDate)}</d:creationdate>
      <d:getcontentlength>${isDirectory ? 0 : stats.size}</d:getcontentlength>
      <d:getlastmodified>${escapeXml(lastModified)}</d:getlastmodified>
      ${etag}
      <d:resourcetype>${isDirectory ? '<d:collection/>' : ''}</d:resourcetype>
      ${contentType}
      <d:supportedlock/>
      <d:lockdiscovery/>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
}

function parseByteRanges(rangeHeader, size) {
    const header = String(rangeHeader || '').trim();
    if (!header) return null;
    if (!/^bytes=/i.test(header)) return { invalid: true };

    const ranges = [];
    for (const rangePart of header.replace(/^bytes=/i, '').split(',')) {
        const part = rangePart.trim();
        const match = part.match(/^(\d*)-(\d*)$/);
        if (!match) return { invalid: true };

        const [, rawStart, rawEnd] = match;
        if (!rawStart && !rawEnd) return { invalid: true };

        if (!rawStart) {
            const suffixLength = Number.parseInt(rawEnd, 10);
            if (!Number.isInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
            ranges.push({ start: Math.max(0, size - suffixLength), end: size - 1 });
            continue;
        }

        const start = Number.parseInt(rawStart, 10);
        const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
        if (
            !Number.isInteger(start)
            || !Number.isInteger(end)
            || start < 0
            || end < start
            || start >= size
        ) {
            return { invalid: true };
        }
        ranges.push({ start, end: Math.min(end, size - 1) });
    }

    return ranges.length ? ranges : { invalid: true };
}

function setWebdavFileHeaders(res, filePath, stats, extraHeaders = {}) {
    res.setHeader('Content-Type', webdavDownloadMimeType(filePath));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', webdavEtag(stats));
    res.setHeader('Last-Modified', httpDate(stats.mtime));
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Disposition', contentDispositionForFile(filePath));
    for (const [key, value] of Object.entries(extraHeaders)) {
        res.setHeader(key, value);
    }
}

function pipeWebdavFileStream(res, filePath, range = {}) {
    const stream = fs.createReadStream(filePath, range);
    stream.on('error', error => {
        if (!res.headersSent) {
            res.status(500).end('File stream failed');
            return;
        }
        res.destroy(error);
    });
    stream.pipe(res);
}

function pipeWebdavMultipartRanges(res, filePath, ranges, boundary, contentType, size) {
    const pipeNext = index => {
        const range = ranges[index];
        if (!range) {
            res.end(`--${boundary}--\r\n`);
            return;
        }

        res.write(`--${boundary}\r\n`);
        res.write(`Content-Type: ${contentType}\r\n`);
        res.write(`Content-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`);

        const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
        stream.on('error', error => {
            if (!res.headersSent) {
                res.status(500).end('File stream failed');
                return;
            }
            res.destroy(error);
        });
        stream.on('end', () => {
            res.write('\r\n');
            pipeNext(index + 1);
        });
        stream.pipe(res, { end: false });
    };

    pipeNext(0);
}

function webdavMultipartRangeLength(ranges, boundary, contentType, size) {
    return ranges.reduce((total, range) => {
        const header = `--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Range: bytes ${range.start}-${range.end}/${size}\r\n\r\n`;
        return total
            + Buffer.byteLength(header)
            + (range.end - range.start + 1)
            + Buffer.byteLength('\r\n');
    }, 0) + Buffer.byteLength(`--${boundary}--\r\n`);
}

function sendWebdavFile(req, res, filePath) {
    const stats = fs.statSync(filePath);
    const ranges = req.method === 'GET'
        ? parseByteRanges(req.headers.range, stats.size)
        : null;

    if (ranges?.invalid) {
        setWebdavFileHeaders(res, filePath, stats, {
            'Content-Range': `bytes */${stats.size}`,
        });
        res.status(416).end();
        return;
    }

    if (ranges) {
        if (ranges.length > 1) {
            const boundary = `bookmanager-${crypto.randomBytes(12).toString('hex')}`;
            const contentType = webdavDownloadMimeType(filePath);
            setWebdavFileHeaders(res, filePath, stats, {
                'Content-Type': `multipart/byteranges; boundary=${boundary}`,
                'Content-Length': webdavMultipartRangeLength(ranges, boundary, contentType, stats.size),
            });
            res.status(206);
            pipeWebdavMultipartRanges(res, filePath, ranges, boundary, contentType, stats.size);
            return;
        }

        const [range] = ranges;
        const contentLength = range.end - range.start + 1;
        setWebdavFileHeaders(res, filePath, stats, {
            'Content-Length': contentLength,
            'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
        });
        res.status(206);
        pipeWebdavFileStream(res, filePath, { start: range.start, end: range.end });
        return;
    }

    setWebdavFileHeaders(res, filePath, stats, {
        'Content-Length': stats.size,
    });
    res.status(200);
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    pipeWebdavFileStream(res, filePath);
}

function makePropfindResponse(req, shares, target, depth) {
    const items = [];

    if (!target) {
        items.push({ filePath: null, href: '/', displayName: 'BookManager' });
        if (depth === 1) {
            shares.forEach(share => {
                items.push({ filePath: share.root, href: share.href, displayName: share.name });
            });
        }
    } else {
        const stats = fs.statSync(target.resolved);
        const targetHref = webdavHrefFromFile(target.share, target.resolved);
        items.push({ filePath: target.resolved, href: targetHref });

        if (depth === 1 && stats.isDirectory()) {
            fs.readdirSync(target.resolved, { withFileTypes: true }).forEach(item => {
                const childPath = path.join(target.resolved, item.name);
                if (isWithinRoot(childPath, [target.share.root])) {
                    items.push({
                        filePath: childPath,
                        href: webdavHrefFromFile(target.share, childPath),
                    });
                }
            });
        }
    }

    return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${items.map(propfindItemXml).join('')}</d:multistatus>`;
}

function makeWebdavLockResponse(href, token) {
    return `<?xml version="1.0" encoding="utf-8"?>
<d:prop xmlns:d="DAV:">
  <d:lockdiscovery>
    <d:activelock>
      <d:locktype><d:write/></d:locktype>
      <d:lockscope><d:exclusive/></d:lockscope>
      <d:depth>0</d:depth>
      <d:owner>BookManager</d:owner>
      <d:timeout>Second-3600</d:timeout>
      <d:locktoken><d:href>${escapeXml(token)}</d:href></d:locktoken>
      <d:lockroot><d:href>${escapeXml(href)}</d:href></d:lockroot>
    </d:activelock>
  </d:lockdiscovery>
</d:prop>`;
}

function makeWebdavDirectoryHtml(target) {
    const entries = fs.readdirSync(target.resolved, { withFileTypes: true })
        .sort((a, b) => naturalComparePath(a.name, b.name))
        .map(item => {
            const childPath = path.join(target.resolved, item.name);
            const href = webdavHrefFromFile(target.share, childPath);
            const label = `${item.name}${item.isDirectory() ? '/' : ''}`;
            return `<li><a href="${escapeXml(href)}">${escapeXml(label)}</a></li>`;
        })
        .join('');
    return `<html><body><h1>${escapeXml(path.basename(target.resolved))}</h1><ul>${entries}</ul></body></html>`;
}

function summarizeHeader(value = '', maxLength = 120) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function attachWebdavRequestLog(req, res, config, log) {
    const range = req.headers.range ? ` range=${req.headers.range}` : '';
    const userAgent = req.headers['user-agent'] ? ` ua=${summarizeHeader(req.headers['user-agent'])}` : '';
    res.on('finish', () => {
        log(sharingText(
            config,
            'sharing_webdav_request',
            'WebDAV 요청: {method} {path} -> {status}{range}{ua}',
            {
                method: req.method,
                path: req.originalUrl || req.url || req.path,
                status: res.statusCode,
                range,
                ua: userAgent,
            },
        ), res.statusCode >= 400 ? 'ERROR' : 'INFO');
    });
}

export function buildWebdavApp(config, options = {}, log = () => {}) {
    const app = express();
    const roots = normalizeSharingRoots(config);
    const shares = buildWebdavShares(roots);
    const username = String(options.username || 'user').trim() || 'user';
    const password = String(options.password || '1234').trim() || '1234';
    const digestNonces = new Map();
    const authenticatedClients = new Map();

    app.use((req, res, next) => {
        attachWebdavRequestLog(req, res, config, log);
        next();
    });

    app.use((_req, res, next) => {
        setWebdavProtocolHeaders(res);
        next();
    });

    app.options('*', (_req, res) => {
        res.status(204).end();
    });

    app.use((req, res, next) => {
        const authResult = checkWebdavAuth(req, username, password, digestNonces);
        if (authResult.ok) {
            rememberWebdavAuthenticatedClient(req, authenticatedClients);
            next();
            return;
        }
        if (authResult.missing && canUseWebdavAuthGrace(req, authenticatedClients)) {
            next();
            return;
        }
        if (!authResult.missing && !authResult.stale) {
            log(sharingText(config, 'sharing_webdav_auth_failed', 'WebDAV 인증 실패: {ip}', { ip: req.ip }), 'ERROR');
        }
        setWebdavAuthChallenge(res, digestNonces, authResult.stale);
        res.status(401).send('Authentication required');
    });

    app.all('*', (req, res, next) => {
        if (req.method !== 'LOCK' && req.method !== 'UNLOCK') {
            next();
            return;
        }

        const target = req.path === '/' ? null : resolveWebdavPath(req.path, roots, shares);
        if (req.path !== '/' && !target) {
            res.status(404).send('Not found');
            return;
        }

        if (req.method === 'UNLOCK') {
            res.status(204).end();
            return;
        }

        const token = `opaquelocktoken:${crypto.randomUUID()}`;
        const href = target ? webdavHrefFromFile(target.share, target.resolved) : '/';
        res.setHeader('Lock-Token', `<${token}>`);
        res.status(200)
            .type('application/xml; charset=utf-8')
            .send(makeWebdavLockResponse(href, token));
    });

    app.get('/', (_req, res) => {
        if (shares.length === 0) {
            res.status(503).send(sharingText(config, 'sharing_no_libraries', '공유할 라이브러리 폴더가 없습니다.'));
            return;
        }
        const links = shares
            .map(share => `<li><a href="${escapeXml(share.href)}">${escapeXml(share.name)}</a></li>`)
            .join('');
        res.type('html').send(`<html><body><h1>BookManager Library</h1><ul>${links}</ul></body></html>`);
    });

    app.propfind('*', (req, res) => {
        if (roots.length === 0) {
            res.status(503).send(sharingText(config, 'sharing_no_libraries', '공유할 라이브러리 폴더가 없습니다.'));
            return;
        }

        const depthHeader = String(req.headers.depth ?? '1').toLowerCase();
        if (!['0', '1', 'infinity'].includes(depthHeader)) {
            res.status(403).send('Only Depth 0 and 1 are supported');
            return;
        }
        const depth = depthHeader === 'infinity' ? 1 : Number(depthHeader);

        const target = req.path === '/' ? null : resolveWebdavPath(req.path, roots, shares);
        if (req.path !== '/' && !target) {
            res.status(404).send('Not found');
            return;
        }

        log(sharingText(config, 'sharing_webdav_browse', 'WebDAV 탐색: {path}', { path: req.path }));
        res.status(207)
            .type('application/xml; charset=utf-8')
            .send(makePropfindResponse(req, shares, target, depth));
    });

    const handleWebdavFileRequest = (req, res) => {
        const target = resolveWebdavPath(req.path, roots, shares);
        if (!target) {
            log(sharingText(
                config,
                'sharing_webdav_not_found',
                'WebDAV 경로 없음: {method} {path}',
                { method: req.method, path: req.originalUrl || req.url || req.path },
            ), 'ERROR');
            res.status(404).send('Not found');
            return;
        }

        const stats = fs.statSync(target.resolved);
        if (stats.isDirectory()) {
            const href = webdavHrefFromFile(target.share, target.resolved);
            if (!req.path.endsWith('/')) {
                res.redirect(301, href);
                return;
            }
            res.type('html').send(makeWebdavDirectoryHtml(target));
            return;
        }

        log(sharingText(config, 'sharing_webdav_download', 'WebDAV 다운로드: {name}', { name: path.basename(target.resolved) }));
        sendWebdavFile(req, res, target.resolved);
    };

    app.head('*', handleWebdavFileRequest);
    app.get('*', handleWebdavFileRequest);

    return app;
}
