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
import { normalizeMetadataFormat } from '../metadataFormat.js';

const execFileAsync = promisify(execFile);
const WEB_SEARCH_LIMIT = 160;
const WEB_METADATA_FIELDS = [
    'title',
    'series',
    'series_group',
    'volume',
    'number',
    'writer',
    'creators',
    'penciller',
    'inker',
    'colorist',
    'letterer',
    'cover_artist',
    'publisher',
    'imprint',
    'genre',
    'volume_count',
    'total_volume',
    'page_count',
    'format',
    'manga',
    'language',
    'rating',
    'age_rating',
    'publish_date',
    'summary',
    'description',
    'characters',
    'teams',
    'locations',
    'story_arc',
    'tags',
    'notes',
    'web',
    'link',
];
const WEB_DB_SEARCH_FIELDS = [
    'path',
    'title',
    'series',
    'series_group',
    'volume',
    'number',
    'writer',
    'creators',
    'publisher',
    'imprint',
    'genre',
    'volume_count',
    'page_count',
    'format',
    'manga',
    'language',
    'rating',
    'age_rating',
    'publish_date',
    'summary',
    'characters',
    'teams',
    'locations',
    'story_arc',
    'tags',
    'notes',
    'web',
];
let webDbUnavailableLogged = false;

function formatJsonError(res, status, message) {
    res.status(status).json({ error: message });
}

function metadataFormatFromRecord(record = {}) {
    return normalizeMetadataFormat(record.format);
}

function metadataFieldValue(record = {}, field = '') {
    if (field === 'format') return metadataFormatFromRecord(record);
    return record[field];
}

function hasMetadata(record = {}) {
    return WEB_METADATA_FIELDS.some(field => String(metadataFieldValue(record, field) || '').trim());
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
            SELECT *
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

async function searchIndexedRows(root, query, options = {}) {
    if (!root) return null;
    if (typeof options.dbRowsProvider === 'function') {
        return options.dbRowsProvider(root);
    }
    if (!options.dbPath) return null;

    const { LibraryDB } = await import('../database/library_db.js');
    const db = new LibraryDB({ dbPath: options.dbPath });
    try {
        const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
        const like = `%${String(query || '').trim()}%`;
        const searchClause = WEB_DB_SEARCH_FIELDS
            .map(field => `COALESCE(${field}, '') LIKE ?`)
            .join(' OR ');
        return db.getConnection().prepare(`
            SELECT *
            FROM files
            WHERE path LIKE ?
              AND (${searchClause})
            LIMIT ?
        `).all(`${prefix}%`, ...WEB_DB_SEARCH_FIELDS.map(() => like), WEB_SEARCH_LIMIT * 20);
    } finally {
        await db.close();
    }
}

async function safeSearchIndexedRows(root, query, options = {}, log = () => {}) {
    try {
        const rows = await searchIndexedRows(root, query, options);
        return Array.isArray(rows) ? rows : null;
    } catch (error) {
        if (!webDbUnavailableLogged) {
            webDbUnavailableLogged = true;
            log(`Web indexed search unavailable: ${error.message}`, 'ERROR');
        }
        return null;
    }
}

function normalizeIndexedRecord(row = {}) {
    const filePath = row.path || row.filepath || row.file_path || row.full_path || '';
    const volumeCount = row.volume_count ?? row.total_volume ?? '';
    const summary = row.summary ?? row.description ?? '';
    const web = row.web ?? row.link ?? '';
    return {
        ...row,
        path: filePath ? realPathOrResolved(filePath) : '',
        ext: row.ext || path.extname(filePath).toLowerCase(),
        size: Number(row.size) || safeStatSize(filePath),
        mtime: row.mtime || 0,
        thumb_path: row.thumb_path || row.thumbnail || '',
        volume_count: volumeCount,
        total_volume: volumeCount,
        summary,
        description: summary,
        web,
        link: web,
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

function statMetadataForRecord(record = {}) {
    try {
        if (!record.path || !fs.existsSync(record.path)) return {};
        const stats = fs.statSync(record.path);
        return {
            ctime: stats.ctimeMs,
            created: new Date(stats.birthtimeMs).toISOString(),
            modified: new Date(stats.mtimeMs).toISOString(),
        };
    } catch {
        return {};
    }
}

function metadataFromRecord(record = {}, roots = [], options = {}) {
    const thumbPath = thumbnailPathForRecord(record, roots, options);
    const summary = record.summary || record.description || '';
    const web = record.web || record.link || '';
    const format = metadataFormatFromRecord(record);
    const stats = statMetadataForRecord(record);
    return {
        path: record.path || '',
        name: record.path ? path.basename(record.path) : '',
        title: record.title || '',
        series: record.series || '',
        series_group: record.series_group || '',
        volume: record.volume || '',
        number: record.number || '',
        writer: record.writer || '',
        creators: record.creators || '',
        penciller: record.penciller || '',
        inker: record.inker || '',
        colorist: record.colorist || '',
        letterer: record.letterer || '',
        cover_artist: record.cover_artist || '',
        publisher: record.publisher || '',
        imprint: record.imprint || '',
        genre: record.genre || '',
        volume_count: record.volume_count || record.total_volume || '',
        total_volume: record.total_volume || record.volume_count || '',
        page_count: record.page_count || '',
        format,
        manga: record.manga || '',
        language: record.language || '',
        rating: record.rating || '',
        age_rating: record.age_rating || '',
        publish_date: record.publish_date || '',
        summary,
        description: summary,
        characters: record.characters || '',
        teams: record.teams || '',
        locations: record.locations || '',
        story_arc: record.story_arc || '',
        tags: record.tags || '',
        notes: record.notes || '',
        web,
        link: web,
        resolution: record.resolution || '',
        size: Number(record.size) || safeStatSize(record.path),
        mtime: record.mtime || '',
        ctime: stats.ctime || '',
        created: stats.created || '',
        modified: stats.modified || '',
        thumb_path: thumbPath,
        cover: thumbPath,
        has_metadata: hasMetadata(record),
    };
}

function fileItemFromRecord(record = {}, roots = [], options = {}) {
    const metadata = metadataFromRecord(record, roots, options);
    return {
        path: record.path,
        name: path.basename(record.path),
        title: record.title || path.basename(record.path),
        size: Number(record.size) || safeStatSize(record.path),
        thumb_path: metadata.thumb_path,
        series: record.series || '',
        writer: record.writer || '',
        publisher: record.publisher || '',
        imprint: record.imprint || '',
        genre: record.genre || '',
        tags: record.tags || '',
        rating: record.rating || '',
        summary: metadata.summary,
        format: metadata.format,
        manga: record.manga || '',
        page_count: record.page_count || '',
        volume_count: metadata.volume_count,
        total_volume: metadata.total_volume,
        has_metadata: metadata.has_metadata,
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

function ensureFilesystemSearchFolder(folders, folderPath, root, samplePath = '') {
    const resolvedFolder = realPathOrResolved(folderPath);
    if (!folders.has(resolvedFolder)) {
        folders.set(resolvedFolder, {
            path: resolvedFolder,
            name: path.basename(resolvedFolder) || resolvedFolder,
            is_library: resolvedFolder === root,
            count: 0,
            thumb_path: '',
            has_subfolders: false,
            has_metadata: false,
        });
    }
    const folder = folders.get(resolvedFolder);
    if (samplePath) {
        folder.count += 1;
        if (!folder.thumb_path) folder.thumb_path = samplePath;
    }
    return folder;
}

function metadataSearchText(record = {}) {
    return [
        record.path,
        record.name,
        path.basename(record.path || ''),
        ...WEB_METADATA_FIELDS.map(field => metadataFieldValue(record, field)),
    ].join(' ').toLowerCase();
}

function ensureSearchFolder(folders, folderPath, root, record = null, roots = [], options = {}, countedFolders = null) {
    const resolvedFolder = realPathOrResolved(folderPath);
    if (!folders.has(resolvedFolder)) {
        folders.set(resolvedFolder, {
            path: resolvedFolder,
            name: path.basename(resolvedFolder) || resolvedFolder,
            is_library: resolvedFolder === root,
            count: 0,
            thumb_path: '',
            has_subfolders: false,
            has_metadata: false,
        });
    }
    const folder = folders.get(resolvedFolder);
    if (!countedFolders || !countedFolders.has(resolvedFolder)) {
        folder.count += 1;
        countedFolders?.add(resolvedFolder);
    }
    if (record) {
        folder.has_metadata = folder.has_metadata || hasMetadata(record);
        if (!folder.thumb_path) folder.thumb_path = thumbnailPathForRecord(record, roots, options);
    }
    return folder;
}

async function searchIndexedCatalog(query, roots, options = {}, log = () => {}) {
    const lowered = query.toLowerCase();
    const folders = new Map();

    for (const root of roots) {
        const rows = await safeSearchIndexedRows(root, query, options, log);
        if (!rows) return null;

        for (const row of rows.map(normalizeIndexedRecord)) {
            if (!isValidWebRecord(row, roots)) continue;
            const relative = path.relative(root, row.path);
            const parts = relative.split(path.sep).filter(Boolean);
            const fileHaystack = metadataSearchText(row);
            const countedFolders = new Set();

            if (fileHaystack.includes(lowered) && folders.size < WEB_SEARCH_LIMIT) {
                const parentFolder = ensureSearchFolder(
                    folders,
                    path.dirname(row.path),
                    root,
                    row,
                    roots,
                    options,
                    countedFolders,
                );
                parentFolder.has_subfolders = parentFolder.has_subfolders || parts.length > 2;
            }

            for (let index = 0; index < parts.length - 1; index += 1) {
                const folderName = parts[index];
                const folderPath = path.join(root, ...parts.slice(0, index + 1));
                const folderHaystack = `${folderName} ${folderPath}`.toLowerCase();
                if (!folderHaystack.includes(lowered)) continue;
                const folder = ensureSearchFolder(folders, folderPath, root, row, roots, options, countedFolders);
                folder.name = folderName;
                folder.has_subfolders = folder.has_subfolders || index < parts.length - 2;
            }
        }
    }

    return {
        folders: [...folders.values()]
            .sort((a, b) => naturalComparePath(a.name, b.name))
            .slice(0, WEB_SEARCH_LIMIT),
        files: [],
    };
}

function searchFilesystemCatalog(query, roots) {
    const lowered = query.toLowerCase();
    const folders = new Map();

    for (const root of roots) {
        const stack = [root];
        while (stack.length && folders.size < WEB_SEARCH_LIMIT * 2) {
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
                    if (haystack.includes(lowered)) {
                        ensureFilesystemSearchFolder(folders, itemPath, root);
                    }
                    stack.push(itemPath);
                } else if (entry.isFile() && isArchivePath(entry.name) && haystack.includes(lowered)) {
                    const resolved = realPathOrResolved(itemPath);
                    ensureFilesystemSearchFolder(folders, path.dirname(resolved), root, resolved);
                }
            }
        }
    }

    return {
        folders: [...folders.values()]
            .sort((a, b) => naturalComparePath(a.name, b.name))
            .slice(0, WEB_SEARCH_LIMIT),
        files: [],
    };
}

async function webSearch(query, roots, options = {}, log = () => {}) {
    const indexed = await searchIndexedCatalog(query, roots, options, log);
    return indexed || searchFilesystemCatalog(query, roots);
}

async function readIndexedFile(filePath, options = {}) {
    if (!filePath) return null;
    if (typeof options.dbRowsProvider === 'function') {
        const rows = await options.dbRowsProvider(path.dirname(filePath));
        return (Array.isArray(rows) ? rows : [])
            .map(normalizeIndexedRecord)
            .find(record => record.path === filePath) || null;
    }
    if (!options.dbPath) return null;

    const { LibraryDB } = await import('../database/library_db.js');
    const db = new LibraryDB({ dbPath: options.dbPath });
    try {
        return db.getConnection().prepare('SELECT * FROM files WHERE path = ?').get(filePath) || null;
    } finally {
        await db.close();
    }
}

async function safeReadIndexedFile(filePath, options = {}, log = () => {}) {
    try {
        const row = await readIndexedFile(filePath, options);
        return row ? normalizeIndexedRecord(row) : null;
    } catch (error) {
        if (!webDbUnavailableLogged) {
            webDbUnavailableLogged = true;
            log(`Web indexed metadata unavailable: ${error.message}`, 'ERROR');
        }
        return null;
    }
}

async function folderMetadata(currentDir, roots, options = {}, log = () => {}) {
    const rows = await safeReadIndexedRows(currentDir, options, log);
    const row = rows
        ?.map(normalizeIndexedRecord)
        .find(record => isValidWebRecord(record, roots) && hasMetadata(record));
    if (!row) return {};
    return metadataFromRecord(row, roots, options);
}

async function fileMetadata(filePath, roots, options = {}, log = () => {}) {
    const row = await safeReadIndexedFile(filePath, options, log);
    if (!row || !isValidWebRecord(row, roots) || !hasMetadata(row)) return {};
    return metadataFromRecord(row, roots, options);
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

    app.get(['/api/file-meta', '/api/file_meta'], async (req, res) => {
        attachNoCache(res);
        const filePath = resolveSharedArchive(req.query.file, roots);
        if (!filePath) {
            formatJsonError(res, 404, sharingText(config, 'sharing_file_not_found', '파일을 찾을 수 없습니다.'));
            return;
        }
        try {
            res.json(await fileMetadata(filePath, roots, options, log));
        } catch (error) {
            log(`Web file metadata error: ${error.message}`, 'ERROR');
            formatJsonError(res, 500, 'Web file metadata failed');
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
