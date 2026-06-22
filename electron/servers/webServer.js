import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
    ARCHIVE_EXTENSIONS,
    IMAGE_EXTENSIONS,
    archiveImageEntries,
    downloadMimeType,
    imageMimeType,
    isWithinRoot,
    naturalComparePath,
    normalizeSharingRoots,
    readArchiveImage,
    realPathOrResolved,
    resolveSharedArchive,
    resolveSharedDownload,
    safeStatSize,
    sharingText,
} from './shared/sharingCommon.js';
import {
    WEB_LIBRARY_CSS,
    WEB_LIBRARY_HTML,
    WEB_LIBRARY_JS,
} from './web/webLibraryPage.js';

const execFileAsync = promisify(execFile);
const WEB_SEARCH_LIMIT = 160;

let webDbUnavailableLogged = false;

function formatJsonError(res, status, message) {
    res.status(status).json({ error: message });
}

function hasMetadata(record = {}) {
    return Boolean(
        record.title
        || record.series
        || record.writer
        || record.publisher
        || record.genre
        || record.summary
        || record.rating
        || record.tags
    );
}

function isArchivePath(filePath = '') {
    return ARCHIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isImagePath(filePath = '') {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveWebDirectory(queryValue, roots) {
    if (!queryValue) return null;
    const requested = path.resolve(String(queryValue));
    if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) return null;
    return isWithinRoot(requested, roots) ? realPathOrResolved(requested) : null;
}

function parentDirectory(currentDir, roots) {
    if (!currentDir) return '';
    const root = roots.find(candidate => currentDir === candidate || currentDir.startsWith(candidate + path.sep));
    if (!root || currentDir === root) return '';
    const parent = path.dirname(currentDir);
    return isWithinRoot(parent, roots) ? parent : '';
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
            SELECT path, title, series, writer, publisher, genre, summary, rating, tags,
                   thumb_path, size, ext, page_count, mtime
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
        if (!webDbUnavailableLogged) {
            webDbUnavailableLogged = true;
            log(`Web indexed catalog unavailable: ${error.message}`, 'ERROR');
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

function isValidWebRecord(record = {}, roots = []) {
    return Boolean(
        record.path
        && fs.existsSync(record.path)
        && fs.statSync(record.path).isFile()
        && isArchivePath(record.path)
        && isWithinRoot(record.path, roots)
    );
}

function thumbnailPathForRecord(record = {}, roots = [], options = {}) {
    if (
        record.thumb_path
        && fs.existsSync(record.thumb_path)
        && resolveSharedDownload(record.thumb_path, roots, options)
    ) {
        return record.thumb_path;
    }
    return record.path || '';
}

function fileItemFromRecord(record = {}, roots = [], options = {}) {
    return {
        path: record.path,
        name: path.basename(record.path),
        title: record.title || path.basename(record.path),
        size: Number(record.size) || safeStatSize(record.path),
        thumb_path: thumbnailPathForRecord(record, roots, options),
        series: record.series || '',
        writer: record.writer || '',
        publisher: record.publisher || '',
        genre: record.genre || '',
        tags: record.tags || '',
        rating: record.rating || '',
        summary: record.summary || '',
    };
}

function catalogFromRows(currentDir, rows = [], roots = [], options = {}) {
    const base = path.resolve(currentDir);
    const folders = new Map();
    const files = [];

    for (const row of rows.map(normalizeIndexedRecord)) {
        if (!isValidWebRecord(row, roots)) continue;
        const relative = path.relative(base, row.path);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
        const parts = relative.split(path.sep).filter(Boolean);

        if (parts.length > 1) {
            const folderName = parts[0];
            const folderPath = path.join(base, folderName);
            if (!folders.has(folderPath)) {
                folders.set(folderPath, {
                    path: folderPath,
                    name: folderName,
                    is_library: false,
                    count: 0,
                    thumb_path: '',
                    has_subfolders: false,
                    has_metadata: false,
                });
            }
            const folder = folders.get(folderPath);
            folder.count += 1;
            folder.has_subfolders = folder.has_subfolders || parts.length > 2;
            folder.has_metadata = folder.has_metadata || hasMetadata(row);
            if (!folder.thumb_path) folder.thumb_path = thumbnailPathForRecord(row, roots, options);
        } else {
            files.push(fileItemFromRecord(row, roots, options));
        }
    }

    return {
        folders: [...folders.values()].sort((a, b) => naturalComparePath(a.name, b.name)),
        files: files.sort((a, b) => naturalComparePath(a.title || a.name, b.title || b.name)),
        source: 'database',
    };
}

function collectArchiveFiles(currentDir, limit = 10000) {
    const results = [];
    const stack = [currentDir];
    while (stack.length && results.length < limit) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        entries.sort((a, b) => naturalComparePath(a.name, b.name));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            const itemPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(itemPath);
            } else if (entry.isFile() && isArchivePath(entry.name)) {
                results.push(realPathOrResolved(itemPath));
                if (results.length >= limit) break;
            }
        }
    }
    return results.sort(naturalComparePath);
}

function scanFolderSummary(folderPath) {
    let hasSubfolders = false;
    let count = 0;
    let sample = '';
    const stack = [folderPath];
    while (stack.length && count < 10000) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const itemPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (dir === folderPath) hasSubfolders = true;
                stack.push(itemPath);
            } else if (entry.isFile() && isArchivePath(entry.name)) {
                count += 1;
                if (!sample) sample = realPathOrResolved(itemPath);
            }
        }
    }
    return { count, sample, hasSubfolders };
}

function filesystemCatalog(currentDir, roots = []) {
    const folders = [];
    const files = [];

    for (const item of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const itemPath = path.join(currentDir, item.name);
        if (item.isDirectory()) {
            const summary = scanFolderSummary(itemPath);
            folders.push({
                path: realPathOrResolved(itemPath),
                name: item.name,
                is_library: false,
                count: summary.count,
                thumb_path: summary.sample,
                has_subfolders: summary.hasSubfolders,
                has_metadata: false,
            });
        } else if (item.isFile() && isArchivePath(item.name)) {
            const resolved = realPathOrResolved(itemPath);
            const stats = fs.statSync(resolved);
            files.push(fileItemFromRecord({
                path: resolved,
                title: path.basename(resolved),
                size: stats.size,
            }, roots));
        }
    }

    return {
        folders: folders.sort((a, b) => naturalComparePath(a.name, b.name)),
        files: files.sort((a, b) => naturalComparePath(a.title || a.name, b.title || b.name)),
        source: 'filesystem',
    };
}

async function rootCatalog(roots = [], options = {}, log = () => {}) {
    const folders = [];
    for (const root of roots) {
        const rows = await safeReadIndexedRows(root, options, log);
        let count = 0;
        let sample = '';
        if (rows) {
            const validRows = rows.map(normalizeIndexedRecord).filter(row => isValidWebRecord(row, roots));
            count = validRows.length;
            sample = validRows.length ? thumbnailPathForRecord(validRows[0], roots, options) : '';
        } else {
            const summary = scanFolderSummary(root);
            count = summary.count;
            sample = summary.sample;
        }
        folders.push({
            path: root,
            name: path.basename(root) || root,
            is_library: true,
            count,
            thumb_path: sample,
            has_subfolders: true,
            has_metadata: false,
        });
    }
    return { folders, files: [], source: 'root' };
}

async function webCatalog(currentDir, roots, options = {}, log = () => {}) {
    if (!currentDir) return rootCatalog(roots, options, log);
    const rows = await safeReadIndexedRows(currentDir, options, log);
    if (rows) {
        const catalog = catalogFromRows(currentDir, rows, roots, options);
        if (catalog.folders.length || catalog.files.length) return catalog;
    }
    return filesystemCatalog(currentDir, roots);
}

function folderItemForPath(folderPath, root, record = null, roots = [], options = {}) {
    const summary = record ? null : scanFolderSummary(folderPath);
    return {
        path: folderPath,
        name: path.basename(folderPath) || folderPath,
        is_library: folderPath === root,
        count: record ? 1 : summary.count,
        thumb_path: record ? thumbnailPathForRecord(record, roots, options) : summary.sample,
        has_subfolders: record ? false : summary.hasSubfolders,
        has_metadata: record ? hasMetadata(record) : false,
    };
}

async function searchIndexedCatalog(query, roots, options = {}, log = () => {}) {
    const lowered = query.toLowerCase();
    const folders = new Map();
    const files = [];

    for (const root of roots) {
        const rows = await safeReadIndexedRows(root, options, log);
        if (!rows) return null;

        for (const row of rows.map(normalizeIndexedRecord)) {
            if (!isValidWebRecord(row, roots)) continue;
            const relative = path.relative(root, row.path);
            const parts = relative.split(path.sep).filter(Boolean);
            const fileHaystack = [
                row.path,
                row.title,
                row.series,
                row.writer,
                row.publisher,
                row.genre,
                row.tags,
            ].join(' ').toLowerCase();

            if (fileHaystack.includes(lowered) && files.length < WEB_SEARCH_LIMIT) {
                files.push(fileItemFromRecord(row, roots, options));
            }

            for (let index = 0; index < parts.length - 1; index += 1) {
                const folderName = parts[index];
                const folderPath = path.join(root, ...parts.slice(0, index + 1));
                const folderHaystack = `${folderName} ${folderPath}`.toLowerCase();
                if (!folderHaystack.includes(lowered)) continue;
                if (!folders.has(folderPath)) {
                    folders.set(folderPath, {
                        path: folderPath,
                        name: folderName,
                        is_library: false,
                        count: 0,
                        thumb_path: '',
                        has_subfolders: false,
                        has_metadata: false,
                    });
                }
                const folder = folders.get(folderPath);
                folder.count += 1;
                folder.has_subfolders = folder.has_subfolders || index < parts.length - 2;
                folder.has_metadata = folder.has_metadata || hasMetadata(row);
                if (!folder.thumb_path) folder.thumb_path = thumbnailPathForRecord(row, roots, options);
            }
        }
    }

    return {
        folders: [...folders.values()]
            .sort((a, b) => naturalComparePath(a.name, b.name))
            .slice(0, WEB_SEARCH_LIMIT),
        files: files.sort((a, b) => naturalComparePath(a.title || a.name, b.title || b.name)),
    };
}

function searchFilesystemCatalog(query, roots) {
    const lowered = query.toLowerCase();
    const folders = new Map();
    const files = [];

    for (const root of roots) {
        const stack = [root];
        while (stack.length && (folders.size + files.length) < WEB_SEARCH_LIMIT * 2) {
            const current = stack.pop();
            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const itemPath = path.join(current, entry.name);
                const haystack = `${entry.name} ${itemPath}`.toLowerCase();
                if (entry.isDirectory()) {
                    if (haystack.includes(lowered) && !folders.has(itemPath)) {
                        folders.set(itemPath, folderItemForPath(realPathOrResolved(itemPath), root));
                    }
                    stack.push(itemPath);
                } else if (entry.isFile() && isArchivePath(entry.name) && haystack.includes(lowered)) {
                    const resolved = realPathOrResolved(itemPath);
                    files.push(fileItemFromRecord({
                        path: resolved,
                        title: path.basename(resolved),
                        size: safeStatSize(resolved),
                    }, roots));
                }
            }
        }
    }

    return {
        folders: [...folders.values()]
            .sort((a, b) => naturalComparePath(a.name, b.name))
            .slice(0, WEB_SEARCH_LIMIT),
        files: files
            .sort((a, b) => naturalComparePath(a.title || a.name, b.title || b.name))
            .slice(0, WEB_SEARCH_LIMIT),
    };
}

async function webSearch(query, roots, options = {}, log = () => {}) {
    const indexed = await searchIndexedCatalog(query, roots, options, log);
    return indexed || searchFilesystemCatalog(query, roots);
}

async function folderMetadata(currentDir, roots, options = {}, log = () => {}) {
    const rows = await safeReadIndexedRows(currentDir, options, log);
    const row = rows
        ?.map(normalizeIndexedRecord)
        .find(record => isValidWebRecord(record, roots) && hasMetadata(record));
    if (!row) return {};
    return {
        title: row.title || '',
        series: row.series || '',
        writer: row.writer || '',
        publisher: row.publisher || '',
        genre: row.genre || '',
        summary: row.summary || '',
        rating: row.rating || '',
        tags: row.tags || '',
        thumb_path: thumbnailPathForRecord(row, roots, options),
    };
}

async function readPreferredThumbnail(filePath, options = {}) {
    const entries = await archiveImageEntries(filePath, options);
    if (!entries.length) return null;
    const preferred = entries.find(entry => /(^|[/\\])cover\.[^.]+$/i.test(entry.name))
        || entries.find(entry => /cover/i.test(entry.name))
        || entries[0];
    return readArchiveImage(filePath, { pageName: preferred.name }, options);
}

function sanitizeDownloadName(value = '', fallback = 'folder') {
    return String(value || fallback)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || fallback;
}

async function createFolderZip(currentDir, archiveFiles, options = {}) {
    if (!options.sevenZExe) return null;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-web-'));
    const zipPath = path.join(tempDir, `${sanitizeDownloadName(path.basename(currentDir))}.zip`);
    const relativeFiles = archiveFiles
        .map(filePath => path.relative(currentDir, filePath))
        .filter(relative => relative && !relative.startsWith('..') && !path.isAbsolute(relative));

    if (!relativeFiles.length) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return null;
    }

    try {
        await execFileAsync(options.sevenZExe, [
            'a',
            '-tzip',
            '-mx=0',
            zipPath,
            ...relativeFiles,
        ], {
            cwd: currentDir,
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
        });
    } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
    }
    return { tempDir, zipPath };
}

function sendDownloadedFile(res, filePath) {
    res.type(downloadMimeType(filePath));
    res.download(filePath, path.basename(filePath));
}

function attachNoCache(res) {
    res.setHeader('Cache-Control', 'no-store');
}

export function buildWebApp(config, options = {}, log = () => {}) {
    const app = express();
    const roots = normalizeSharingRoots(config);

    app.get('/', (_req, res) => {
        res.set('Content-Type', 'text/html; charset=utf-8').send(WEB_LIBRARY_HTML);
    });

    app.get('/index.html', (_req, res) => {
        res.set('Content-Type', 'text/html; charset=utf-8').send(WEB_LIBRARY_HTML);
    });

    app.get('/assets/web-library.css', (_req, res) => {
        res.set('Content-Type', 'text/css; charset=utf-8').send(WEB_LIBRARY_CSS);
    });

    app.get('/assets/web-library.js', (_req, res) => {
        res.set('Content-Type', 'application/javascript; charset=utf-8').send(WEB_LIBRARY_JS);
    });

    app.get('/api/list', async (req, res) => {
        attachNoCache(res);
        if (roots.length === 0) {
            formatJsonError(res, 503, sharingText(config, 'sharing_no_libraries', '공유할 라이브러리 폴더가 없습니다.'));
            return;
        }

        const requestedDir = req.query.dir;
        const currentDir = resolveWebDirectory(requestedDir, roots);
        if (requestedDir && !currentDir) {
            formatJsonError(res, 404, sharingText(config, 'sharing_folder_not_found', '폴더를 찾을 수 없습니다.'));
            return;
        }

        try {
            const catalog = await webCatalog(currentDir, roots, options, log);
            log(sharingText(config, 'sharing_web_browse', 'Web 탐색: {name}', {
                name: currentDir ? path.basename(currentDir) : sharingText(config, 'sharing_library_root', '라이브러리 루트'),
            }));
            res.json({
                current_dir: currentDir || '',
                parent_dir: parentDirectory(currentDir, roots),
                can_zip: Boolean(options.sevenZExe),
                folders: catalog.folders,
                files: catalog.files,
            });
        } catch (error) {
            log(`Web catalog error: ${error.message}`, 'ERROR');
            formatJsonError(res, 500, 'Web catalog failed');
        }
    });

    app.get('/api/search', async (req, res) => {
        attachNoCache(res);
        if (roots.length === 0) {
            formatJsonError(res, 503, sharingText(config, 'sharing_no_libraries', '공유할 라이브러리 폴더가 없습니다.'));
            return;
        }
        const query = String(req.query.q || '').trim();
        if (!query) {
            res.json({ query, can_zip: Boolean(options.sevenZExe), folders: [], files: [] });
            return;
        }
        try {
            const result = await webSearch(query, roots, options, log);
            log(sharingText(config, 'sharing_web_search', 'Web 검색: {query}', { query }));
            res.json({
                query,
                can_zip: Boolean(options.sevenZExe),
                folders: result.folders,
                files: result.files,
            });
        } catch (error) {
            log(`Web search error: ${error.message}`, 'ERROR');
            formatJsonError(res, 500, 'Web search failed');
        }
    });

    app.get(['/api/folder-meta', '/api/folder_meta'], async (req, res) => {
        attachNoCache(res);
        const currentDir = resolveWebDirectory(req.query.dir, roots);
        if (!currentDir) {
            formatJsonError(res, 404, sharingText(config, 'sharing_folder_not_found', '폴더를 찾을 수 없습니다.'));
            return;
        }
        try {
            res.json(await folderMetadata(currentDir, roots, options, log));
        } catch (error) {
            log(`Web metadata error: ${error.message}`, 'ERROR');
            formatJsonError(res, 500, 'Web metadata failed');
        }
    });

    app.get('/api/download', (req, res) => {
        const filePath = resolveSharedArchive(req.query.file, roots);
        if (!filePath) {
            formatJsonError(res, 404, sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }

        log(sharingText(config, 'sharing_web_download', 'Web 다운로드: {name}', { name: path.basename(filePath) }));
        sendDownloadedFile(res, filePath);
    });

    app.get('/api/thumbnail', async (req, res) => {
        const filePath = resolveSharedDownload(req.query.file, roots, options);
        if (!filePath) {
            formatJsonError(res, 404, sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }

        try {
            if (isImagePath(filePath)) {
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.type(imageMimeType(filePath));
                res.sendFile(filePath);
                return;
            }

            const image = await readPreferredThumbnail(filePath, options);
            if (!image) {
                formatJsonError(res, 404, 'Thumbnail not found');
                return;
            }
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.type(imageMimeType(image.entry.name)).send(image.buffer);
        } catch (error) {
            log(`Web thumbnail error: ${error.message}`, 'ERROR');
            formatJsonError(res, 500, 'Thumbnail extract failed');
        }
    });

    app.get('/api/folder-zip', async (req, res) => {
        const currentDir = resolveWebDirectory(req.query.dir, roots);
        if (!currentDir) {
            formatJsonError(res, 404, sharingText(config, 'sharing_folder_not_found', '폴더를 찾을 수 없습니다.'));
            return;
        }
        if (!options.sevenZExe) {
            formatJsonError(res, 501, sharingText(config, 'sharing_web_zip_unavailable', 'ZIP 생성 도구를 찾을 수 없습니다.'));
            return;
        }

        const archiveFiles = collectArchiveFiles(currentDir)
            .filter(filePath => isWithinRoot(filePath, [currentDir]));
        if (!archiveFiles.length) {
            formatJsonError(res, 404, sharingText(config, 'sharing_web_zip_empty', '압축할 파일이 없습니다.'));
            return;
        }

        let temp = null;
        try {
            temp = await createFolderZip(currentDir, archiveFiles, options);
            if (!temp) {
                formatJsonError(res, 500, 'Folder ZIP failed');
                return;
            }
            const downloadName = `${sanitizeDownloadName(req.query.name || path.basename(currentDir))}.zip`;
            log(sharingText(config, 'sharing_web_zip', 'Web 폴더 ZIP 생성: {name}', { name: downloadName }));
            res.type('application/zip');
            res.download(temp.zipPath, downloadName, () => {
                fs.rmSync(temp.tempDir, { recursive: true, force: true });
            });
        } catch (error) {
            if (temp?.tempDir) fs.rmSync(temp.tempDir, { recursive: true, force: true });
            log(`Web folder ZIP error: ${error.message}`, 'ERROR');
            if (!res.headersSent) formatJsonError(res, 500, 'Folder ZIP failed');
        }
    });

    return app;
}
