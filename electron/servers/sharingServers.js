import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.tar', '.gz']);
const ARCHIVE_MIME_TYPES = new Map([
    ['.zip', 'application/zip'],
    ['.cbz', 'application/x-cbz'],
    ['.rar', 'application/vnd.rar'],
    ['.cbr', 'application/x-cbr'],
    ['.7z', 'application/x-7z-compressed'],
    ['.cb7', 'application/x-7z-compressed'],
    ['.tar', 'application/x-tar'],
    ['.gz', 'application/gzip'],
]);
const servers = new Map();

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function realPathOrResolved(targetPath) {
    try {
        return fs.realpathSync(targetPath);
    } catch (_error) {
        return path.resolve(targetPath);
    }
}

export function normalizeSharingRoots(config = {}) {
    const candidates = [
        ...(config.libraries || []),
        ...(config.dup_check_folders || []),
    ];
    const seen = new Set();

    return candidates
        .map(item => (typeof item === 'string' ? item : item?.path))
        .filter(Boolean)
        .map(realPathOrResolved)
        .filter(root => {
            if (seen.has(root) || !fs.existsSync(root)) return false;
            seen.add(root);
            return true;
        });
}

function isWithinRoot(targetPath, roots) {
    const resolved = realPathOrResolved(targetPath);
    return roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function getLocalIp() {
    for (const items of Object.values(os.networkInterfaces())) {
        for (const item of items || []) {
            if (item.family === 'IPv4' && !item.internal) return item.address;
        }
    }
    return '127.0.0.1';
}

function archiveMimeType(filePath) {
    return ARCHIVE_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function makeOpdsFeed({ title, id, entries }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="/opds" />
${entries.join('\n')}
</feed>`;
}

function makeOpdsEntry(req, itemPath, isDirectory) {
    const name = path.basename(itemPath) || itemPath;
    const stats = fs.statSync(itemPath);
    const href = isDirectory
        ? `/opds?dir=${encodeURIComponent(itemPath)}`
        : `/download?file=${encodeURIComponent(itemPath)}`;
    const rel = isDirectory
        ? 'subsection'
        : 'http://opds-spec.org/acquisition/open-access';
    const type = isDirectory
        ? 'application/atom+xml;profile=opds-catalog;kind=navigation'
        : archiveMimeType(itemPath);

    return `  <entry>
    <id>${escapeXml(`urn:bookmanager:${itemPath}`)}</id>
    <title>${escapeXml(name)}</title>
    <updated>${stats.mtime.toISOString()}</updated>
    <link rel="${rel}" href="${escapeXml(`${req.protocol}://${req.get('host')}${href}`)}" type="${type}" />
  </entry>`;
}

function resolveOpdsDirectory(queryValue, roots) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) return null;
    return isWithinRoot(requested, roots) ? realPathOrResolved(requested) : null;
}

export function buildOpdsApp(config, log = () => {}) {
    const app = express();
    const roots = normalizeSharingRoots(config);

    app.get('/', (_req, res) => res.redirect('/opds'));

    app.get('/opds', (req, res) => {
        if (roots.length === 0) {
            res.status(503).type('text/plain').send('공유할 라이브러리 폴더가 없습니다.');
            return;
        }

        const requestedDir = req.query.dir;
        const currentDir = resolveOpdsDirectory(requestedDir, roots);
        if (requestedDir && !currentDir) {
            res.status(404).type('text/plain').send('폴더를 찾을 수 없습니다.');
            return;
        }

        const entries = currentDir
            ? fs.readdirSync(currentDir, { withFileTypes: true })
                .filter(item => item.isDirectory() || ARCHIVE_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
                .map(item => makeOpdsEntry(req, path.join(currentDir, item.name), item.isDirectory()))
            : roots.map(root => makeOpdsEntry(req, root, true));

        log(`OPDS 탐색: ${currentDir ? path.basename(currentDir) : '라이브러리 루트'}`);
        res.type('application/atom+xml; charset=utf-8').send(makeOpdsFeed({
            title: currentDir ? (path.basename(currentDir) || currentDir) : 'BookManager Library',
            id: currentDir || 'urn:bookmanager:opds:root',
            entries,
        }));
    });

    app.get('/download', (req, res) => {
        const filePath = path.resolve(String(req.query.file || ''));
        if (
            !filePath
            || !fs.existsSync(filePath)
            || !fs.statSync(filePath).isFile()
            || !isWithinRoot(filePath, roots)
        ) {
            res.status(404).type('text/plain').send('파일을 찾을 수 없습니다.');
            return;
        }

        log(`OPDS 다운로드: ${path.basename(filePath)}`);
        res.type(archiveMimeType(filePath));
        res.download(filePath, path.basename(filePath));
    });

    return app;
}

function checkBasicAuth(req, username, password) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;

    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const splitAt = decoded.indexOf(':');
        return splitAt >= 0
            && decoded.slice(0, splitAt) === username
            && decoded.slice(splitAt + 1) === password;
    } catch (_error) {
        return false;
    }
}

function webdavHrefFromFile(rootIndex, filePath, roots) {
    const relative = path.relative(roots[rootIndex], filePath)
        .split(path.sep)
        .map(encodeURIComponent)
        .join('/');
    const suffix = fs.statSync(filePath).isDirectory() && relative ? '/' : '';
    return `/lib/${rootIndex}/${relative}${suffix}`;
}

export function resolveWebdavPath(urlPath, roots) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (_error) {
        return null;
    }

    const parts = decoded.split('/').filter(Boolean);
    if (parts[0] !== 'lib') return null;

    const rootIndex = Number(parts[1]);
    if (!Number.isInteger(rootIndex) || !roots[rootIndex]) return null;

    const relativeParts = parts.slice(2);
    if (relativeParts.some(part => part === '.' || part === '..' || part.includes('\0'))) return null;

    const resolved = path.resolve(roots[rootIndex], relativeParts.join(path.sep));
    if (!fs.existsSync(resolved) || !isWithinRoot(resolved, [roots[rootIndex]])) return null;
    return { rootIndex, resolved: realPathOrResolved(resolved) };
}

function propfindItemXml({ filePath, href, displayName }) {
    const stats = filePath ? fs.statSync(filePath) : null;
    const isDirectory = !stats || stats.isDirectory();
    const contentType = isDirectory ? '' : `<d:getcontenttype>${escapeXml(archiveMimeType(filePath))}</d:getcontenttype>`;

    return `<d:response>
  <d:href>${escapeXml(href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${escapeXml(displayName || path.basename(filePath) || filePath)}</d:displayname>
      <d:getcontentlength>${isDirectory ? 0 : stats.size}</d:getcontentlength>
      <d:getlastmodified>${stats ? stats.mtime.toUTCString() : new Date(0).toUTCString()}</d:getlastmodified>
      <d:resourcetype>${isDirectory ? '<d:collection/>' : ''}</d:resourcetype>
      ${contentType}
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
}

function makePropfindResponse(req, roots, target, depth) {
    const items = [];

    if (!target) {
        items.push({ filePath: null, href: '/', displayName: 'BookManager' });
        if (depth === 1) {
            roots.forEach((root, index) => {
                items.push({ filePath: root, href: `/lib/${index}/` });
            });
        }
    } else {
        const stats = fs.statSync(target.resolved);
        const targetHref = stats.isDirectory() && !req.path.endsWith('/') ? `${req.path}/` : req.path;
        items.push({ filePath: target.resolved, href: targetHref });

        if (depth === 1 && stats.isDirectory()) {
            fs.readdirSync(target.resolved, { withFileTypes: true }).forEach(item => {
                const childPath = path.join(target.resolved, item.name);
                if (isWithinRoot(childPath, [roots[target.rootIndex]])) {
                    items.push({
                        filePath: childPath,
                        href: webdavHrefFromFile(target.rootIndex, childPath, roots),
                    });
                }
            });
        }
    }

    return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${items.map(propfindItemXml).join('')}</d:multistatus>`;
}

export function buildWebdavApp(config, options = {}, log = () => {}) {
    const app = express();
    const roots = normalizeSharingRoots(config);
    const username = String(options.username || 'user').trim() || 'user';
    const password = String(options.password || '1234').trim() || '1234';

    app.use((req, res, next) => {
        if (checkBasicAuth(req, username, password)) {
            next();
            return;
        }
        log(`WebDAV 인증 실패: ${req.ip}`, 'ERROR');
        res.setHeader('WWW-Authenticate', 'Basic realm="BookManager"');
        res.status(401).send('Authentication required');
    });

    app.use((_req, res, next) => {
        res.setHeader('DAV', '1');
        res.setHeader('Allow', 'OPTIONS, GET, HEAD, PROPFIND');
        next();
    });

    app.options('*', (_req, res) => {
        res.status(204).end();
    });

    app.get('/', (_req, res) => {
        const links = roots
            .map((root, index) => `<li><a href="/lib/${index}/">${escapeXml(path.basename(root) || root)}</a></li>`)
            .join('');
        res.type('html').send(`<html><body><h1>BookManager Library</h1><ul>${links}</ul></body></html>`);
    });

    app.propfind('*', (req, res) => {
        if (roots.length === 0) {
            res.status(503).send('공유할 라이브러리 폴더가 없습니다.');
            return;
        }

        const depthHeader = String(req.headers.depth ?? '1').toLowerCase();
        if (!['0', '1'].includes(depthHeader)) {
            res.status(403).send('Only Depth 0 and 1 are supported');
            return;
        }

        const target = req.path === '/' ? null : resolveWebdavPath(req.path, roots);
        if (req.path !== '/' && !target) {
            res.status(404).send('Not found');
            return;
        }

        log(`WebDAV 탐색: ${req.path}`);
        res.status(207)
            .type('application/xml; charset=utf-8')
            .send(makePropfindResponse(req, roots, target, Number(depthHeader)));
    });

    app.get('/lib/:rootIndex/*?', (req, res) => {
        const target = resolveWebdavPath(req.path, roots);
        if (!target) {
            res.status(404).send('Not found');
            return;
        }

        const stats = fs.statSync(target.resolved);
        if (stats.isDirectory()) {
            const links = fs.readdirSync(target.resolved)
                .map(name => `<li><a href="${encodeURIComponent(name)}">${escapeXml(name)}</a></li>`)
                .join('');
            res.type('html').send(`<html><body><h1>${escapeXml(path.basename(target.resolved))}</h1><ul>${links}</ul></body></html>`);
            return;
        }

        log(`WebDAV 다운로드: ${path.basename(target.resolved)}`);
        res.type(archiveMimeType(target.resolved));
        res.sendFile(target.resolved);
    });

    return app;
}

export function getSharingServerStatus() {
    const localIp = getLocalIp();
    return {
        localIp,
        OPDS: {
            running: servers.has('OPDS'),
            port: servers.get('OPDS')?.port || null,
            url: servers.has('OPDS') ? `http://${localIp}:${servers.get('OPDS').port}/opds` : null,
        },
        WebDAV: {
            running: servers.has('WebDAV'),
            port: servers.get('WebDAV')?.port || null,
            url: servers.has('WebDAV') ? `http://${localIp}:${servers.get('WebDAV').port}/` : null,
        },
    };
}

export async function startSharingServer(type, options = {}, config = {}, onLog = () => {}) {
    const serverType = type === 'WebDAV' ? 'WebDAV' : 'OPDS';
    if (servers.has(serverType)) {
        throw new Error(`${serverType} 서버가 이미 실행 중입니다.`);
    }

    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('포트 번호는 1024부터 65535 사이여야 합니다.');
    }

    const log = (message, logType = 'INFO') => onLog({
        type: logType === 'ERROR' ? 'ERROR' : 'INFO',
        protocol: serverType,
        message,
    });
    const app = serverType === 'WebDAV'
        ? buildWebdavApp(config, options, log)
        : buildOpdsApp(config, log);
    const server = http.createServer(app);

    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '0.0.0.0', resolve);
        });
    } catch (error) {
        server.close();
        onLog({
            type: 'ERROR',
            protocol: serverType,
            message: `포트 ${port}에서 서버를 시작하지 못했습니다: ${error.message}`,
        });
        throw error;
    }

    servers.set(serverType, { server, port });
    const localIp = getLocalIp();
    const url = serverType === 'OPDS'
        ? `http://${localIp}:${port}/opds`
        : `http://${localIp}:${port}/`;
    log(`${serverType} 서버가 시작되었습니다: ${url}`);
    return { success: true, running: true, port, localIp, url };
}

export async function stopSharingServer(type, onLog = () => {}) {
    const serverType = type === 'WebDAV' ? 'WebDAV' : 'OPDS';
    const entry = servers.get(serverType);
    if (!entry) return { success: true, running: false };

    await new Promise(resolve => entry.server.close(resolve));
    servers.delete(serverType);
    onLog({
        type: 'INFO',
        protocol: serverType,
        message: `${serverType} 서버가 중지되었습니다.`,
    });
    return { success: true, running: false };
}

export async function stopAllSharingServers(onLog = () => {}) {
    await Promise.all([...servers.keys()].map(type => stopSharingServer(type, onLog)));
}
