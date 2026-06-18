import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.tar', '.gz']);
const servers = new Map();

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeRoots(config = {}) {
  const candidates = [
    ...(config.libraries || []),
    ...(config.dup_check_folders || []),
  ];
  const seen = new Set();
  return candidates
    .map(item => (typeof item === 'string' ? item : item?.path))
    .filter(Boolean)
    .map(root => path.resolve(root))
    .filter(root => {
      if (seen.has(root) || !fs.existsSync(root)) return false;
      seen.add(root);
      return true;
    });
}

function isWithinRoot(filePath, roots) {
  const resolved = path.resolve(filePath);
  return roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function safeDirFromQuery(queryValue, roots) {
  if (!queryValue) return roots[0] || null;
  const decoded = path.resolve(String(queryValue));
  return isWithinRoot(decoded, roots) ? decoded : null;
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) {
        return item.address;
      }
    }
  }
  return '127.0.0.1';
}

function makeOpdsFeed({ title, id, entries }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${new Date().toISOString()}</updated>
${entries.join('\n')}
</feed>`;
}

function makeNavigationEntry(req, itemPath, isDirectory) {
  const name = path.basename(itemPath);
  const stats = fs.statSync(itemPath);
  const href = isDirectory
    ? `/opds?dir=${encodeURIComponent(itemPath)}`
    : `/download?file=${encodeURIComponent(itemPath)}`;
  const rel = isDirectory
    ? 'subsection'
    : 'http://opds-spec.org/acquisition/open-access';
  const type = isDirectory ? 'application/atom+xml;profile=opds-catalog' : 'application/zip';

  return `  <entry>
    <id>${escapeXml(itemPath)}</id>
    <title>${escapeXml(name)}</title>
    <updated>${stats.mtime.toISOString()}</updated>
    <link rel="${rel}" href="${escapeXml(`${req.protocol}://${req.get('host')}${href}`)}" type="${type}" />
  </entry>`;
}

function buildOpdsApp(config, log) {
  const app = express();
  const roots = normalizeRoots(config);

  app.get('/', (_req, res) => res.redirect('/opds'));

  app.get('/opds', (req, res) => {
    if (roots.length === 0) {
      res.status(503).type('text/plain').send('공유할 라이브러리 폴더가 없습니다.');
      return;
    }

    const currentDir = safeDirFromQuery(req.query.dir, roots);
    if (!currentDir || !fs.existsSync(currentDir)) {
      res.status(404).type('text/plain').send('폴더를 찾을 수 없습니다.');
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .filter(item => item.isDirectory() || ARCHIVE_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
      .map(item => makeNavigationEntry(req, path.join(currentDir, item.name), item.isDirectory()));

    res.type('application/atom+xml; charset=utf-8').send(makeOpdsFeed({
      title: path.basename(currentDir) || currentDir,
      id: currentDir,
      entries,
    }));
  });

  app.get('/download', (req, res) => {
    const filePath = path.resolve(String(req.query.file || ''));
    if (!filePath || !isWithinRoot(filePath, roots) || !fs.existsSync(filePath)) {
      res.status(404).type('text/plain').send('파일을 찾을 수 없습니다.');
      return;
    }
    log(`다운로드 요청: ${path.basename(filePath)}`);
    res.download(filePath);
  });

  return app;
}

function checkBasicAuth(req, username, password) {
  if (!username && !password) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const splitAt = decoded.indexOf(':');
    return decoded.slice(0, splitAt) === username && decoded.slice(splitAt + 1) === password;
  } catch (_error) {
    return false;
  }
}

function webdavHrefFromFile(rootIndex, filePath, roots) {
  const relative = path.relative(roots[rootIndex], filePath).split(path.sep).map(encodeURIComponent).join('/');
  return `/lib/${rootIndex}/${relative}${fs.statSync(filePath).isDirectory() && relative ? '/' : ''}`;
}

function resolveWebdavPath(urlPath, roots) {
  const parts = decodeURIComponent(urlPath).split('/').filter(Boolean);
  if (parts[0] !== 'lib') return null;
  const rootIndex = Number(parts[1]);
  if (!Number.isInteger(rootIndex) || !roots[rootIndex]) return null;
  const relative = parts.slice(2).join(path.sep);
  const resolved = path.resolve(roots[rootIndex], relative);
  return isWithinRoot(resolved, [roots[rootIndex]]) ? { rootIndex, resolved } : null;
}

function makePropfindResponse(req, roots, target) {
  const items = [];
  if (!target) {
    roots.forEach((root, index) => items.push({ rootIndex: index, filePath: root, href: `/lib/${index}/` }));
  } else {
    const stats = fs.statSync(target.resolved);
    items.push({ rootIndex: target.rootIndex, filePath: target.resolved, href: req.path.endsWith('/') ? req.path : `${req.path}/` });
    if (stats.isDirectory()) {
      fs.readdirSync(target.resolved, { withFileTypes: true }).forEach(item => {
        const childPath = path.join(target.resolved, item.name);
        items.push({ rootIndex: target.rootIndex, filePath: childPath, href: webdavHrefFromFile(target.rootIndex, childPath, roots) });
      });
    }
  }

  const responses = items.map(({ filePath, href }) => {
    const stats = fs.statSync(filePath);
    const isDirectory = stats.isDirectory();
    return `<d:response>
  <d:href>${escapeXml(href)}</d:href>
  <d:propstat>
    <d:prop>
      <d:displayname>${escapeXml(path.basename(filePath) || filePath)}</d:displayname>
      <d:getcontentlength>${isDirectory ? 0 : stats.size}</d:getcontentlength>
      <d:getlastmodified>${stats.mtime.toUTCString()}</d:getlastmodified>
      <d:resourcetype>${isDirectory ? '<d:collection/>' : ''}</d:resourcetype>
    </d:prop>
    <d:status>HTTP/1.1 200 OK</d:status>
  </d:propstat>
</d:response>`;
  }).join('');

  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}

function buildWebdavApp(config, options, log) {
  const app = express();
  const roots = normalizeRoots(config);
  const username = options.username || '';
  const password = options.password || '';

  app.use((req, res, next) => {
    if (checkBasicAuth(req, username, password)) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="ComicZIP Optimizer"');
    res.status(401).send('Authentication required');
  });

  app.get('/', (_req, res) => {
    const links = roots.map((root, index) => `<li><a href="/lib/${index}/">${escapeXml(path.basename(root) || root)}</a></li>`).join('');
    res.type('html').send(`<html><body><h1>ComicZIP Library</h1><ul>${links}</ul></body></html>`);
  });

  app.propfind('*', (req, res) => {
    if (roots.length === 0) {
      res.status(503).send('공유할 라이브러리 폴더가 없습니다.');
      return;
    }
    const target = req.path === '/' ? null : resolveWebdavPath(req.path, roots);
    if (req.path !== '/' && (!target || !fs.existsSync(target.resolved))) {
      res.status(404).send('Not found');
      return;
    }
    res.status(207).type('application/xml; charset=utf-8').send(makePropfindResponse(req, roots, target));
  });

  app.get('/lib/:rootIndex/*?', (req, res) => {
    const target = resolveWebdavPath(req.path, roots);
    if (!target || !fs.existsSync(target.resolved)) {
      res.status(404).send('Not found');
      return;
    }
    const stats = fs.statSync(target.resolved);
    if (stats.isDirectory()) {
      const links = fs.readdirSync(target.resolved).map(name => `<li><a href="${encodeURIComponent(name)}">${escapeXml(name)}</a></li>`).join('');
      res.type('html').send(`<html><body><h1>${escapeXml(path.basename(target.resolved))}</h1><ul>${links}</ul></body></html>`);
      return;
    }
    log(`WebDAV 파일 요청: ${path.basename(target.resolved)}`);
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
    await stopSharingServer(serverType, onLog);
  }

  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('올바른 포트 번호를 입력하세요.');
  }

  const log = message => onLog({ type: serverType, message });
  const app = serverType === 'WebDAV'
    ? buildWebdavApp(config, options, log)
    : buildOpdsApp(config, log);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });

  servers.set(serverType, { server, port });
  const localIp = getLocalIp();
  const url = serverType === 'OPDS' ? `http://${localIp}:${port}/opds` : `http://${localIp}:${port}/`;
  log(`${serverType} 서버가 시작되었습니다: ${url}`);
  return { success: true, running: true, port, localIp, url };
}

export async function stopSharingServer(type, onLog = () => {}) {
  const serverType = type === 'WebDAV' ? 'WebDAV' : 'OPDS';
  const entry = servers.get(serverType);
  if (!entry) {
    return { success: true, running: false };
  }
  await new Promise(resolve => entry.server.close(resolve));
  servers.delete(serverType);
  onLog({ type: serverType, message: `${serverType} 서버가 중지되었습니다.` });
  return { success: true, running: false };
}
