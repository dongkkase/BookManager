import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    ARCHIVE_EXTENSIONS,
    ARCHIVE_MIME_TYPES,
    archiveImageEntries,
    downloadMimeType,
    escapeXml,
    imageMimeType,
    isWithinRoot,
    naturalComparePath,
    normalizeSharingRootEntries,
    readArchiveImage,
    realPathOrResolved,
    resolveSharedArchive,
    resolveSharedDownload,
    safeStatSize,
    sharingText,
} from './shared/sharingCommon.js';

let opdsDbUnavailableLogged = false;

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

async function rootCatalog(rootEntries, roots, options = {}, log = () => {}) {
    const folders = [];
    for (const entry of rootEntries) {
        const root = entry.root;
        const rows = await safeReadIndexedRows(root, options, log);
        const catalog = rows ? indexedCatalogFromRows(root, rows, roots) : null;
        const sample = catalog?.files?.[0] || null;
        folders.push({
            path: root,
            title: entry.name || root,
            sample,
        });
    }
    return { folders, files: [], source: 'root' };
}

async function opdsCatalog(currentDir, roots, rootEntries, options = {}, log = () => {}) {
    if (!currentDir) return rootCatalog(rootEntries, roots, options, log);
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
    const rootEntries = normalizeSharingRootEntries(config);
    const roots = rootEntries.map(entry => entry.root);

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
            const catalog = await opdsCatalog(currentDir, roots, rootEntries, options, log);
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
