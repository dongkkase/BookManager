import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
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

const OPDS_PUBLICATION_MIME_TYPES = new Map([
    ...ARCHIVE_MIME_TYPES,
    ['.pdf', 'application/pdf'],
    ['.txt', 'text/plain'],
    ['.text', 'text/plain'],
    ['.mp3', 'audio/mpeg'],
    ['.m4b', 'audio/mp4'],
    ['.m4a', 'audio/mp4'],
    ['.flac', 'audio/flac'],
]);
const OPDS_PUBLICATION_EXTENSIONS = new Set(OPDS_PUBLICATION_MIME_TYPES.keys());
const OPDS_PAGE_STREAM_EXTENSIONS = new Set([
    '.zip',
    '.cbz',
    '.rar',
    '.cbr',
    '.7z',
    '.cb7',
    '.tar',
    '.gz',
]);

function stableOpdsId(value) {
    return `urn:bookmanager:opds:${crypto.createHash('sha1').update(String(value || '')).digest('hex')}`;
}

function asExtension(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.startsWith('.') ? raw : `.${raw}`;
}

function publicationExtension(record = {}) {
    return asExtension(record.ext) || path.extname(record.path || '').toLowerCase();
}

function publicationMimeTypeForRecord(record = {}) {
    return OPDS_PUBLICATION_MIME_TYPES.get(publicationExtension(record))
        || 'application/octet-stream';
}

function publicationFormatForRecord(record = {}) {
    const extension = publicationExtension(record);
    if (extension === '.epub') return 'EPUB';
    if (extension === '.pdf') return 'PDF';
    if (extension === '.txt' || extension === '.text') return 'Text';
    if (['.mp3', '.m4b', '.m4a', '.flac'].includes(extension)) return 'Audiobook';
    return 'Archive';
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
    const mimeType = publicationMimeTypeForRecord(record);
    const publicationFormat = publicationFormatForRecord(record);
    const supportsPageStream = OPDS_PAGE_STREAM_EXTENSIONS.has(publicationExtension(record));
    const size = record.size ?? safeStatSize(filePath);
    const extent = formatSizeMb(size);
    const pageCount = numericPageCount(record.page_count);
    const encodedPath = encodeURIComponent(filePath);
    const downloadUrl = `/download?file=${encodedPath}`;
    const streamUrl = `/page?file=${encodedPath}&page_num={pageNumber}`;
    const thumbnailHref = thumbnailHrefForRecord(record, roots, options);
    const thumbnailLinks = thumbnailHref ? `
    <link rel="http://opds-spec.org/image/thumbnail" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />
    <link rel="http://opds-spec.org/image" href="${escapeXml(thumbnailHref)}" type="image/jpeg" />` : '';
    const acquisitionLink = supportsPageStream && pageCount !== '0'
        ? `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://opds-spec.org/acquisition/open-access" type="${escapeXml(mimeType)}" href="${escapeXml(downloadUrl)}" p5:count="${escapeXml(pageCount)}" />`
        : `<link rel="http://opds-spec.org/acquisition/open-access" type="${escapeXml(mimeType)}" href="${escapeXml(downloadUrl)}" />`;
    const streamLink = supportsPageStream
        ? pageCount !== '0'
            ? `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="${escapeXml(streamUrl)}" p5:count="${escapeXml(pageCount)}" />`
            : `<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="${escapeXml(streamUrl)}" />`
        : '';

    return `  <entry>
    <updated>${escapeXml(updatedIso)}</updated>
    <id>${escapeXml(stableOpdsId(filePath))}</id>
    <title>${escapeXml(`⭘ ${title}`)}</title>
    <summary>${escapeXml(`File Type: ${mimeType} - ${extent} Summary: ${summary}`)}</summary>
    <extent xmlns="http://purl.org/dc/terms/">${escapeXml(extent)}</extent>
    <format xmlns="http://purl.org/dc/terms/format">${escapeXml(publicationFormat)}</format>
    <content type="text">${escapeXml(mimeType)}</content>${thumbnailLinks}
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
    return OPDS_PAGE_STREAM_EXTENSIONS.has(publicationExtension(record))
        ? `/thumbnail?file=${encodeURIComponent(record.path)}`
        : '';
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

function escapeLikeValue(value = '') {
    return String(value).replace(/[\\%_]/g, match => `\\${match}`);
}

function isPathInsideRootWithoutIo(targetPath, roots) {
    const resolved = path.resolve(targetPath);
    return roots.some(root => {
        const relative = path.relative(root, resolved);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
}

function normalizeStoredRecord(row = {}) {
    const filePath = row.path || row.filepath || row.file_path || row.full_path || '';
    const size = Number(row.size);
    return {
        ...row,
        path: filePath ? path.resolve(filePath) : '',
        ext: row.ext || path.extname(filePath).toLowerCase(),
        size: Number.isFinite(size) ? size : 0,
        mtime: row.mtime || 0,
        thumb_path: row.thumb_path || row.thumbnail || '',
    };
}

function isStoredCatalogFile(record, roots) {
    return Boolean(
        record.path
        && OPDS_PUBLICATION_EXTENSIONS.has(path.extname(record.path).toLowerCase())
        && isPathInsideRootWithoutIo(record.path, roots)
    );
}

function mergeCatalogs(indexedCatalog, filesystemCatalogResult) {
    const folders = new Map(filesystemCatalogResult.folders.map(folder => [path.resolve(folder.path), folder]));
    const files = new Map(filesystemCatalogResult.files.map(file => [path.resolve(file.path), file]));
    for (const folder of indexedCatalog.folders) folders.set(path.resolve(folder.path), folder);
    for (const file of indexedCatalog.files) files.set(path.resolve(file.path), file);
    return {
        folders: [...folders.values()].sort((a, b) => naturalComparePath(a.title, b.title)),
        files: [...files.values()].sort((a, b) => naturalComparePath(
            a.title || path.basename(a.path),
            b.title || path.basename(b.path),
        )),
        source: 'database',
    };
}

async function readIndexedCatalog(currentDir, roots, options = {}) {
    if (!currentDir) return null;
    if (typeof options.dbRowsProvider === 'function') {
        const rows = await options.dbRowsProvider(currentDir);
        if (!Array.isArray(rows)) return null;
        const catalog = indexedCatalogFromRows(currentDir, rows, roots);
        return catalog.folders.length || catalog.files.length ? catalog : null;
    }
    if (!options.dbPath) return null;

    const { LibraryDB } = await import('../database/library_db.js');
    const db = new LibraryDB({ dbPath: options.dbPath });
    try {
        const libraryRoot = roots.find(root => {
            const relative = path.relative(root, currentDir);
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });
        if (!libraryRoot) return null;

        const connection = db.getConnection();
        const hasCurrentFolderIndex = connection.prepare(`
            SELECT 1
            FROM library_folders
            WHERE library_path = ? AND folder_path = ?
            LIMIT 1
        `).get(libraryRoot, currentDir);
        if (!hasCurrentFolderIndex) return null;

        const folders = connection.prepare(`
            SELECT folder_path, name
            FROM library_folders
            WHERE library_path = ? AND parent_path = ?
            ORDER BY name COLLATE NOCASE ASC
        `).all(libraryRoot, currentDir).map(row => ({
            path: path.resolve(row.folder_path),
            title: row.name || path.basename(row.folder_path),
            sample: null,
        })).filter(folder => isPathInsideRootWithoutIo(folder.path, roots));
        const prefix = currentDir.endsWith(path.sep) ? currentDir : `${currentDir}${path.sep}`;
        const files = connection.prepare(`
            SELECT path, title, summary, writer, mtime, thumb_path, size, ext, page_count
            FROM files
            WHERE path LIKE ? ESCAPE '\\'
              AND instr(substr(path, ?), ?) = 0
        `).all(
            `${escapeLikeValue(prefix)}%`,
            prefix.length + 1,
            path.sep,
        ).map(normalizeStoredRecord).filter(record => isStoredCatalogFile(record, roots));

        files.sort((a, b) => naturalComparePath(
            a.title || path.basename(a.path),
            b.title || path.basename(b.path),
        ));
        return mergeCatalogs(
            { folders, files, source: 'database' },
            await filesystemCatalog(currentDir),
        );
    } finally {
        await db.close();
    }
}

async function safeReadIndexedCatalog(currentDir, roots, options = {}, log = () => {}) {
    try {
        return await readIndexedCatalog(currentDir, roots, options);
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
        && OPDS_PUBLICATION_EXTENSIONS.has(path.extname(record.path).toLowerCase())
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

async function filesystemCatalog(currentDir) {
    const folders = [];
    const files = [];
    const items = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const item of items) {
        const itemPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
            folders.push({ path: itemPath, title: item.name, sample: null });
        } else if (item.isFile() && OPDS_PUBLICATION_EXTENSIONS.has(path.extname(item.name).toLowerCase())) {
            files.push({
                path: itemPath,
                title: path.basename(itemPath),
                summary: '',
                writer: 'Unknown',
                mtime: 0,
                thumb_path: '',
                size: 0,
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

function resolveOpdsDownload(queryValue, roots, options = {}) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    const extension = path.extname(requested).toLowerCase();
    if (
        OPDS_PUBLICATION_EXTENSIONS.has(extension)
        && fs.existsSync(requested)
        && fs.statSync(requested).isFile()
        && isWithinRoot(requested, roots)
    ) {
        return realPathOrResolved(requested);
    }
    return resolveSharedDownload(queryValue, roots, options);
}

function opdsDownloadMimeType(filePath) {
    const mimeType = OPDS_PUBLICATION_MIME_TYPES.get(path.extname(filePath).toLowerCase());
    return mimeType || downloadMimeType(filePath);
}

function rootCatalog(rootEntries) {
    return {
        folders: rootEntries.map(entry => ({
            path: entry.root,
            title: entry.name || entry.root,
            sample: null,
        })),
        files: [],
        source: 'root',
    };
}

async function opdsCatalog(currentDir, roots, rootEntries, options = {}, log = () => {}) {
    if (!currentDir) return rootCatalog(rootEntries);
    const catalog = await safeReadIndexedCatalog(currentDir, roots, options, log);
    if (catalog) return catalog;
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
        const filePath = resolveOpdsDownload(req.query.file, roots, options);
        if (!filePath) {
            res.status(404).type('text/plain').send(sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }

        log(sharingText(config, 'sharing_opds_download', 'OPDS 다운로드: {name}', { name: path.basename(filePath) }));
        res.type(opdsDownloadMimeType(filePath));
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
