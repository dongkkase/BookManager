import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { translate } from '../../src/utils/i18n.js';
import { listZipEntriesFromFile, readZipEntryFromFile } from '../core/zipArchive.js';

const execFileAsync = promisify(execFile);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.tar', '.gz', '.epub']);
const NATIVE_IMAGE_ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const ARCHIVE_MIME_TYPES = new Map([
    ['.zip', 'application/zip'],
    ['.cbz', 'application/x-cbz'],
    ['.rar', 'application/vnd.rar'],
    ['.cbr', 'application/x-cbr'],
    ['.7z', 'application/x-7z-compressed'],
    ['.cb7', 'application/x-7z-compressed'],
    ['.tar', 'application/x-tar'],
    ['.gz', 'application/gzip'],
    ['.epub', 'application/epub+zip'],
]);
const servers = new Map();
let opdsDbUnavailableLogged = false;
const WEBDAV_AUTH_REALM = 'BookManager';
const WEBDAV_NONCE_TTL_MS = 10 * 60 * 1000;
const WEBDAV_AUTH_GRACE_MS = 5 * 60 * 1000;

function sharingLanguage(config = {}) {
    return ['ko', 'en', 'ja'].includes(config.language)
        ? config.language
        : ['ko', 'en', 'ja'].includes(config.lang) ? config.lang : 'ko';
}

function sharingText(config, key, fallback, values) {
    const translated = translate(key, sharingLanguage(config), values);
    return translated && translated !== key ? translated : fallback;
}

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

function webdavDownloadMimeType(_filePath) {
    return 'application/octet-stream';
}

function contentDispositionForFile(filePath) {
    const filename = path.basename(filePath);
    const fallbackName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
    return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function imageMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.bmp') return 'image/bmp';
    return 'image/jpeg';
}

function httpDate(value) {
    return value instanceof Date ? value.toUTCString() : new Date(value).toUTCString();
}

function webdavEtag(stats) {
    return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

function naturalComparePath(a = '', b = '') {
    return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: 'base',
    });
}

function stableOpdsId(value) {
    return `urn:bookmanager:opds:${crypto.createHash('sha1').update(String(value || '')).digest('hex')}`;
}

function asExtension(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.startsWith('.') ? raw : `.${raw}`;
}

function archiveMimeTypeForRecord(record = {}) {
    return ARCHIVE_MIME_TYPES.get(asExtension(record.ext) || path.extname(record.path || '').toLowerCase())
        || 'application/zip';
}

function formatSizeMb(size) {
    const value = Number(size) || 0;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function numericPageCount(value) {
    const count = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(count) && count > 0 ? String(count) : '0';
}

function makeOpdsFeed({ title, id, entries, links = [], updatedIso = new Date().toISOString() }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${escapeXml(updatedIso)}</updated>
  <author><name>BookManager</name></author>
${links.join('\n')}
${entries.join('\n')}
</feed>`;
}

function makeOpdsFolderEntry({ folderPath, title, thumbnailHref = '', updatedIso }) {
    const folderUrl = `/opds?dir=${encodeURIComponent(folderPath)}`;
    const thumbnailLinks = thumbnailHref ? `
    <link rel="http://opds-spec.org/image/thumbnail" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />
    <link rel="http://opds-spec.org/image" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />` : '';
    return `  <entry>
    <title>${escapeXml(title || path.basename(folderPath) || folderPath)}</title>
    <id>${escapeXml(stableOpdsId(folderUrl))}</id>
    <updated>${escapeXml(updatedIso)}</updated>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="${escapeXml(folderUrl)}" />${thumbnailLinks}
  </entry>`;
}

function makeOpdsFileEntry(record, { updatedIso, roots, options }) {
    const filePath = record.path;
    const title = record.title || path.basename(filePath);
    const summary = record.summary || '';
    const writer = record.writer || 'Unknown';
    const mimeType = archiveMimeTypeForRecord(record);
    const size = record.size || safeStatSize(filePath);
    const extent = formatSizeMb(size);
    const pageCount = numericPageCount(record.page_count);
    const encodedPath = encodeURIComponent(filePath);
    const downloadUrl = `/download?file=${encodedPath}`;
    const streamUrl = `/page?file=${encodedPath}&page_num={pageNumber}`;
    const thumbnailHref = thumbnailHrefForRecord(record, roots, options);
    const acquisitionLink = pageCount !== '0'
        ? `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://opds-spec.org/acquisition/open-access" type="${escapeXml(mimeType)}" href="${escapeXml(downloadUrl)}" p5:count="${escapeXml(pageCount)}" />`
        : `<link rel="http://opds-spec.org/acquisition/open-access" type="${escapeXml(mimeType)}" href="${escapeXml(downloadUrl)}" />`;
    const streamLink = pageCount !== '0'
        ? `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="${escapeXml(streamUrl)}" p5:count="${escapeXml(pageCount)}" />`
        : `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="${escapeXml(streamUrl)}" />`;

    return `  <entry>
    <updated>${escapeXml(updatedIso)}</updated>
    <id>${escapeXml(stableOpdsId(filePath))}</id>
    <title>${escapeXml(`⭘ ${title}`)}</title>
    <summary>${escapeXml(`File Type: ${mimeType} - ${extent} Summary: ${summary}`)}</summary>
    <extent xmlns="http://purl.org/dc/terms/">${escapeXml(extent)}</extent>
    <format xmlns="http://purl.org/dc/terms/format">Archive</format>
    <content type="text">${escapeXml(mimeType)}</content>
    <link rel="http://opds-spec.org/image/thumbnail" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />
    <link rel="http://opds-spec.org/image" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />
    ${acquisitionLink}
    ${streamLink}
    <author><name>${escapeXml(writer)}</name></author>
  </entry>`;
}

function resolveOpdsDirectory(queryValue, roots) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) return null;
    return isWithinRoot(requested, roots) ? realPathOrResolved(requested) : null;
}

function safeStatSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function normalizeOptionalRoot(rootPath) {
    if (!rootPath) return '';
    try {
        if (!fs.existsSync(rootPath)) return '';
        return realPathOrResolved(rootPath);
    } catch {
        return '';
    }
}

function isSharedThumbnailFile(filePath, options = {}) {
    const thumbnailDir = normalizeOptionalRoot(options.thumbnailDir);
    return Boolean(
        thumbnailDir
        && IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
        && isWithinRoot(filePath, [thumbnailDir])
    );
}

function resolveSharedArchive(queryValue, roots) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    if (
        !fs.existsSync(requested)
        || !fs.statSync(requested).isFile()
        || !ARCHIVE_EXTENSIONS.has(path.extname(requested).toLowerCase())
        || !isWithinRoot(requested, roots)
    ) {
        return null;
    }
    return realPathOrResolved(requested);
}

function resolveSharedDownload(queryValue, roots, options = {}) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) return null;
    const extension = path.extname(requested).toLowerCase();
    if (ARCHIVE_EXTENSIONS.has(extension) && isWithinRoot(requested, roots)) {
        return realPathOrResolved(requested);
    }
    if (isSharedThumbnailFile(requested, options)) {
        return realPathOrResolved(requested);
    }
    return null;
}

function downloadMimeType(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
        ? imageMimeType(filePath)
        : archiveMimeType(filePath);
}

function thumbnailHrefForRecord(record = {}, roots = [], options = {}) {
    const thumbnailPath = record.thumb_path || record.thumbnail || '';
    if (
        thumbnailPath
        && fs.existsSync(thumbnailPath)
        && resolveSharedDownload(thumbnailPath, roots, options)
    ) {
        return `/download?file=${encodeURIComponent(thumbnailPath)}`;
    }
    return `/thumbnail?file=${encodeURIComponent(record.path)}`;
}

async function listSevenZipImageEntries(filePath, sevenZExe = '') {
    if (!sevenZExe) return [];
    const { stdout } = await execFileAsync(sevenZExe, ['l', '-ba', '-slt', filePath], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });
    return stdout
        .split(/\r?\n/)
        .filter(line => line.startsWith('Path = '))
        .map(line => line.slice(7).trim())
        .filter(name => (
            name
            && !name.includes('__MACOSX')
            && IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())
        ))
        .map(name => ({ name, isDirectory: false, source: '7z' }))
        .sort((a, b) => naturalComparePath(a.name, b.name));
}

async function archiveImageEntries(filePath, options = {}) {
    if (!NATIVE_IMAGE_ARCHIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return listSevenZipImageEntries(filePath, options.sevenZExe);
    }
    const entries = await listZipEntriesFromFile(filePath);
    return entries
        .filter(entry => (
            !entry.isDirectory
            && !entry.name.includes('__MACOSX')
            && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ))
        .map(entry => ({ ...entry, source: 'zip' }))
        .sort((a, b) => naturalComparePath(a.name, b.name));
}

async function readArchiveImage(filePath, { pageName = '', pageIndex = null } = {}, options = {}) {
    const entries = await archiveImageEntries(filePath, options);
    if (entries.length === 0) return null;
    let entry = null;
    if (pageName) {
        const normalizedName = String(pageName).replace(/\\/g, '/');
        entry = entries.find(item => item.name === normalizedName);
    } else if (Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < entries.length) {
        entry = entries[pageIndex];
    } else {
        entry = entries[0];
    }
    if (!entry) return null;
    let buffer = null;
    if (entry.source === 'zip') {
        buffer = await readZipEntryFromFile(filePath, entry, {
            maxBytes: 80 * 1024 * 1024,
            maxCompressedBytes: 80 * 1024 * 1024,
        });
    } else if (entry.source === '7z' && options.sevenZExe) {
        const result = await execFileAsync(options.sevenZExe, ['e', '-so', filePath, entry.name], {
            encoding: 'buffer',
            maxBuffer: 80 * 1024 * 1024,
        });
        buffer = Buffer.from(result.stdout);
    }
    return buffer ? { buffer, entry } : null;
}

function opdsNavigationLinks(currentDir, roots) {
    const currentHref = currentDir ? `/opds?dir=${encodeURIComponent(currentDir)}` : '/opds';
    const links = [
        `  <link rel="self" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${escapeXml(currentHref)}" />`,
        `  <link rel="start" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="/opds" />`,
    ];
    if (currentDir) {
        const root = roots.find(candidate => currentDir === candidate || currentDir.startsWith(candidate + path.sep));
        const parent = root && currentDir !== root ? path.dirname(currentDir) : '';
        const upHref = parent ? `/opds?dir=${encodeURIComponent(parent)}` : '/opds';
        links.push(`  <link rel="up" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="${escapeXml(upHref)}" title="Up" />`);
    }
    return links;
}

async function readIndexedRows(currentDir, options = {}) {
    if (!currentDir) return null;
    if (typeof options.dbRowsProvider === 'function') {
        return options.dbRowsProvider(currentDir);
    }
    if (!options.dbPath) return null;

    const { LibraryDB } = await import('../database/library_db.js');
    const db = new LibraryDB({ dbPath: options.dbPath });
    try {
        const prefix = currentDir.endsWith(path.sep) ? currentDir : `${currentDir}${path.sep}`;
        return db.getConnection().prepare(`
            SELECT path, title, summary, writer, mtime, thumb_path, size, ext, page_count
            FROM files
            WHERE path LIKE ?
        `).all(`${prefix}%`);
    } finally {
        await db.close();
    }
}

async function safeReadIndexedRows(currentDir, options = {}, log = () => {}) {
    try {
        const rows = await readIndexedRows(currentDir, options);
        return Array.isArray(rows) ? rows : null;
    } catch (error) {
        if (!opdsDbUnavailableLogged) {
            opdsDbUnavailableLogged = true;
            log(`OPDS indexed catalog unavailable: ${error.message}`, 'ERROR');
        }
        return null;
    }
}

function normalizeIndexedRecord(row = {}) {
    const filePath = row.path || row.filepath || row.file_path || row.full_path || '';
    return {
        ...row,
        path: filePath ? realPathOrResolved(filePath) : '',
        ext: row.ext || path.extname(filePath).toLowerCase(),
        size: Number(row.size) || safeStatSize(filePath),
        mtime: row.mtime || 0,
        thumb_path: row.thumb_path || row.thumbnail || '',
    };
}

function isValidCatalogFile(record, roots) {
    return Boolean(
        record.path
        && fs.existsSync(record.path)
        && fs.statSync(record.path).isFile()
        && ARCHIVE_EXTENSIONS.has(path.extname(record.path).toLowerCase())
        && isWithinRoot(record.path, roots)
    );
}

function indexedCatalogFromRows(currentDir, rows = [], roots = []) {
    const folders = new Map();
    const files = [];
    const base = path.resolve(currentDir);

    for (const row of rows.map(normalizeIndexedRecord)) {
        if (!isValidCatalogFile(row, roots)) continue;
        const relative = path.relative(base, row.path);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const parts = relative.split(path.sep).filter(Boolean);
        if (parts.length > 1) {
            const folderName = parts[0];
            const folderPath = path.join(base, folderName);
            if (!folders.has(folderName)) {
                folders.set(folderName, {
                    path: folderPath,
                    title: folderName,
                    sample: null,
                });
            }
            if (parts.length === 2 && !folders.get(folderName).sample) {
                folders.get(folderName).sample = row;
            }
        } else {
            files.push(row);
        }
    }

    files.sort((a, b) => naturalComparePath(a.title || path.basename(a.path), b.title || path.basename(b.path)));
    return {
        folders: [...folders.values()].sort((a, b) => naturalComparePath(a.title, b.title)),
        files,
        source: 'database',
    };
}

function filesystemCatalog(currentDir) {
    const folders = [];
    const files = [];
    for (const item of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const itemPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
            folders.push({ path: itemPath, title: item.name, sample: null });
        } else if (item.isFile() && ARCHIVE_EXTENSIONS.has(path.extname(item.name).toLowerCase())) {
            const stats = fs.statSync(itemPath);
            files.push({
                path: itemPath,
                title: path.basename(itemPath),
                summary: '',
                writer: 'Unknown',
                mtime: stats.mtimeMs,
                thumb_path: '',
                size: stats.size,
                ext: path.extname(itemPath).toLowerCase(),
                page_count: '',
            });
        }
    }
    return {
        folders: folders.sort((a, b) => naturalComparePath(a.title, b.title)),
        files: files.sort((a, b) => naturalComparePath(a.title, b.title)),
        source: 'filesystem',
    };
}

async function rootCatalog(roots, options = {}, log = () => {}) {
    const folders = [];
    for (const root of roots) {
        const rows = await safeReadIndexedRows(root, options, log);
        const catalog = rows ? indexedCatalogFromRows(root, rows, roots) : null;
        const sample = catalog?.files?.[0] || null;
        folders.push({
            path: root,
            title: root,
            sample,
        });
    }
    return { folders, files: [], source: 'root' };
}

async function opdsCatalog(currentDir, roots, options = {}, log = () => {}) {
    if (!currentDir) return rootCatalog(roots, options, log);
    const rows = await safeReadIndexedRows(currentDir, options, log);
    if (rows) {
        const catalog = indexedCatalogFromRows(currentDir, rows, roots);
        if (catalog.folders.length || catalog.files.length) return catalog;
    }
    return filesystemCatalog(currentDir);
}

function catalogEntries(catalog, roots, options, updatedIso) {
    const folderEntries = catalog.folders.map(folder => makeOpdsFolderEntry({
        folderPath: folder.path,
        title: folder.title,
        thumbnailHref: folder.sample ? thumbnailHrefForRecord(folder.sample, roots, options) : '',
        updatedIso,
    }));
    const fileEntries = catalog.files.map(file => makeOpdsFileEntry(file, {
        updatedIso,
        roots,
        options,
    }));
    return [...folderEntries, ...fileEntries];
}

export function buildOpdsApp(config, log = () => {}, options = {}) {
    const app = express();
    const roots = normalizeSharingRoots(config);

    app.get('/', (_req, res) => res.redirect('/opds'));

    app.get('/opds', async (req, res) => {
        if (roots.length === 0) {
            res.status(503).type('text/plain').send(sharingText(config, 'sharing_no_libraries', '공유할 라이브러리 폴더가 없습니다.'));
            return;
        }

        const requestedDir = req.query.dir;
        const currentDir = resolveOpdsDirectory(requestedDir, roots);
        if (requestedDir && !currentDir) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_folder_not_found', '폴더를 찾을 수 없습니다.'));
            return;
        }

        try {
            const updatedIso = new Date().toISOString();
            const catalog = await opdsCatalog(currentDir, roots, options, log);
            const entries = catalogEntries(catalog, roots, options, updatedIso);

            log(sharingText(config, 'sharing_opds_browse', 'OPDS 탐색: {name}', {
                name: currentDir ? path.basename(currentDir) : sharingText(config, 'sharing_library_root', '라이브러리 루트'),
            }));
            res.set('Content-Type', 'application/xml; charset=utf-8').send(makeOpdsFeed({
                title: currentDir ? `Folder: ${path.basename(currentDir) || currentDir}` : 'BookManager Library',
                id: currentDir ? stableOpdsId(currentDir) : 'urn:bookmanager:opds:root',
                entries,
                links: opdsNavigationLinks(currentDir, roots),
                updatedIso,
            }));
        } catch (error) {
            log(`OPDS catalog error: ${error.message}`, 'ERROR');
            res.status(500).type('text/plain').send('OPDS catalog failed');
        }
    });

    app.get('/download', (req, res) => {
        const filePath = resolveSharedDownload(req.query.file, roots, options);
        if (!filePath) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }

        log(sharingText(config, 'sharing_opds_download', 'OPDS 다운로드: {name}', { name: path.basename(filePath) }));
        res.type(downloadMimeType(filePath));
        res.download(filePath, path.basename(filePath));
    });

    app.get('/thumbnail', async (req, res) => {
        const filePath = resolveSharedArchive(req.query.file, roots);
        if (!filePath) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }
        try {
            const image = await readArchiveImage(filePath, {}, options);
            if (!image) {
                res.status(404).type('text/plain').send('Thumbnail not found');
                return;
            }
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.type(imageMimeType(image.entry.name)).send(image.buffer);
        } catch (error) {
            log(`Thumbnail extract error: ${error.message}`, 'ERROR');
            res.status(500).type('text/plain').send('Thumbnail extract failed');
        }
    });

    app.get('/stream', async (req, res) => {
        const filePath = resolveSharedArchive(req.query.file, roots);
        if (!filePath) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }
        try {
            const entries = await archiveImageEntries(filePath, options);
            const nowIso = new Date().toISOString();
            const encodedFile = encodeURIComponent(filePath);
            const feedEntries = entries.map((entry, index) => {
                const pageHref = `/page?file=${encodedFile}&page=${encodeURIComponent(entry.name)}`;
                return `  <entry>
    <id>${escapeXml(`urn:bookmanager:${filePath}:${entry.name}`)}</id>
    <title>${escapeXml(`Page ${index + 1}`)}</title>
    <updated>${nowIso}</updated>
    <link rel="http://opds-spec.org/acquisition" href="${escapeXml(pageHref)}" type="${imageMimeType(entry.name)}" />
  </entry>`;
            });
            res.set('Content-Type', 'application/xml; charset=utf-8').send(makeOpdsFeed({
                title: `${path.basename(filePath)} - Pages`,
                id: `urn:bookmanager:stream:${filePath}`,
                entries: feedEntries,
                links: opdsNavigationLinks(null, roots),
                updatedIso: nowIso,
            }));
        } catch (error) {
            log(`Stream feed error: ${error.message}`, 'ERROR');
            res.status(500).type('text/plain').send('Stream feed failed');
        }
    });

    app.get('/page', async (req, res) => {
        const filePath = resolveSharedArchive(req.query.file, roots);
        if (!filePath) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }
        const rawPageIndex = req.query.page_num;
        const pageIndex = rawPageIndex === undefined || rawPageIndex === null
            ? null
            : Number.parseInt(String(rawPageIndex), 10);
        try {
            const image = await readArchiveImage(filePath, {
                pageName: req.query.page ? String(req.query.page) : '',
                pageIndex,
            }, options);
            if (!image) {
                res.status(404).type('text/plain').send('Page not found');
                return;
            }
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.type(imageMimeType(image.entry.name)).send(image.buffer);
        } catch (error) {
            log(`Page extract error: ${error.message}`, 'ERROR');
            res.status(500).type('text/plain').send('Page extract failed');
        }
    });

    return app;
}

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
        throw new Error(sharingText(config, 'sharing_server_already_running', '{server} 서버가 이미 실행 중입니다.', { server: serverType }));
    }

    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(sharingText(config, 'sharing_invalid_port', '포트 번호는 1024부터 65535 사이여야 합니다.'));
    }

    const log = (message, logType = 'INFO') => onLog({
        type: logType === 'ERROR' ? 'ERROR' : 'INFO',
        protocol: serverType,
        message,
    });
    const app = serverType === 'WebDAV'
        ? buildWebdavApp(config, options, log)
        : buildOpdsApp(config, log, options);
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
            message: sharingText(config, 'sharing_start_failed', '포트 {port}에서 서버를 시작하지 못했습니다: {msg}', { port, msg: error.message }),
        });
        throw error;
    }

    servers.set(serverType, { server, port });
    const localIp = getLocalIp();
    const url = serverType === 'OPDS'
        ? `http://${localIp}:${port}/opds`
        : `http://${localIp}:${port}/`;
    log(sharingText(config, 'sharing_started', '{server} 서버가 시작되었습니다: {url}', { server: serverType, url }));
    return { success: true, running: true, port, localIp, url };
}

export async function stopSharingServer(type, onLog = () => {}, config = {}) {
    const serverType = type === 'WebDAV' ? 'WebDAV' : 'OPDS';
    const entry = servers.get(serverType);
    if (!entry) return { success: true, running: false };

    await new Promise(resolve => entry.server.close(resolve));
    servers.delete(serverType);
    onLog({
        type: 'INFO',
        protocol: serverType,
        message: sharingText(config, 'sharing_stopped', '{server} 서버가 중지되었습니다.', { server: serverType }),
    });
    return { success: true, running: false };
}

export async function stopAllSharingServers(onLog = () => {}, config = {}) {
    await Promise.all([...servers.keys()].map(type => stopSharingServer(type, onLog, config)));
}
