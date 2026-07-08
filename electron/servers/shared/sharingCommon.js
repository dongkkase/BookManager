import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { translate } from '../../../src/utils/i18n.js';
import { listZipEntriesFromFile, readZipEntryFromFile } from '../../core/zipArchive.js';

const execFileAsync = promisify(execFile);

export const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.tar', '.gz', '.epub']);
export const NATIVE_IMAGE_ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
export const ARCHIVE_MIME_TYPES = new Map([
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

function sharingLanguage(config = {}) {
    return ['ko', 'en', 'ja'].includes(config.language)
        ? config.language
        : ['ko', 'en', 'ja'].includes(config.lang) ? config.lang : 'ko';
}

export function sharingText(config, key, fallback, values) {
    const translated = translate(key, sharingLanguage(config), values);
    return translated && translated !== key ? translated : fallback;
}

export function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function realPathOrResolved(targetPath) {
    try {
        return fs.realpathSync(targetPath);
    } catch (_error) {
        return path.resolve(targetPath);
    }
}

export function normalizeSharingRoots(config = {}) {
    return normalizeSharingRootEntries(config).map(entry => entry.root);
}

function sharingLibraryPathKey(value = '') {
    return String(value || '').trim().replace(/[\\/]+$/, '').toLowerCase();
}

function sharingLibraryEntryFromValue(value) {
    const rawPath = typeof value === 'string' ? value : value?.path;
    const entryPath = String(rawPath || '').trim();
    if (!entryPath) return null;
    return {
        path: entryPath,
        alias: typeof value === 'string' ? '' : String(value?.alias || '').trim(),
        group: typeof value === 'string' ? '' : String(value?.group || '').trim(),
    };
}

function normalizeSharingLibraryEntries(config = {}) {
    const pathValues = [
        ...(config.libraries || []),
        ...(config.dup_check_folders || []),
    ];
    const metadataValues = [
        ...(config.library_entries || []),
        ...pathValues,
    ];
    const metadata = new Map();
    for (const value of metadataValues) {
        const entry = sharingLibraryEntryFromValue(value);
        if (!entry) continue;
        const key = sharingLibraryPathKey(entry.path);
        const previous = metadata.get(key) || { path: entry.path, alias: '', group: '' };
        metadata.set(key, {
            path: previous.path || entry.path,
            alias: previous.alias || entry.alias,
            group: previous.group || entry.group,
        });
    }

    const sourceValues = pathValues.length > 0 ? pathValues : config.library_entries || [];
    const seen = new Set();
    const entries = [];
    for (const value of sourceValues) {
        const entry = sharingLibraryEntryFromValue(value);
        if (!entry) continue;
        const key = sharingLibraryPathKey(entry.path);
        if (seen.has(key)) continue;
        seen.add(key);
        const meta = metadata.get(key);
        entries.push({
            path: entry.path,
            alias: meta?.alias || '',
            group: meta?.group || '',
        });
    }
    return entries;
}

export function normalizeSharingRootEntries(config = {}) {
    const seen = new Set();
    const entries = [];
    for (const entry of normalizeSharingLibraryEntries(config)) {
        const root = realPathOrResolved(entry.path);
        if (seen.has(root) || !fs.existsSync(root)) continue;
        seen.add(root);
        entries.push({
            ...entry,
            root,
            name: entry.alias || path.basename(root) || root,
        });
    }
    return entries;
}

export function isWithinRoot(targetPath, roots) {
    const resolved = realPathOrResolved(targetPath);
    return roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function isIpv4LinkLocal(address) {
    return String(address || '').startsWith('169.254.');
}

export function listLocalIpAddresses() {
    const addresses = [];
    const seen = new Set();
    const pushAddress = (address, name, internal = false) => {
        if (!address || seen.has(address)) return;
        seen.add(address);
        addresses.push({
            address,
            name: name || address,
            family: 'IPv4',
            internal: Boolean(internal),
            linkLocal: isIpv4LinkLocal(address),
        });
    };

    pushAddress('127.0.0.1', 'Loopback', true);
    for (const [name, items] of Object.entries(os.networkInterfaces())) {
        for (const item of items || []) {
            if (item.family !== 'IPv4') continue;
            pushAddress(item.address, name, item.internal);
        }
    }
    return addresses.sort((a, b) => {
        const aScore = (a.internal ? 2 : 0) + (a.linkLocal ? 4 : 0);
        const bScore = (b.internal ? 2 : 0) + (b.linkLocal ? 4 : 0);
        if (aScore !== bScore) return aScore - bScore;
        return a.address.localeCompare(b.address, undefined, { numeric: true });
    });
}

export function getLocalIp() {
    return listLocalIpAddresses().find(item => !item.internal && !item.linkLocal)?.address
        || listLocalIpAddresses().find(item => !item.internal)?.address
        || '127.0.0.1';
}

export function normalizeLocalIpAddress(value) {
    const requested = String(value || '').trim();
    const addresses = listLocalIpAddresses();
    return addresses.find(item => item.address === requested)?.address || getLocalIp();
}

export function archiveMimeType(filePath) {
    return ARCHIVE_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

export function webdavDownloadMimeType(_filePath) {
    return 'application/octet-stream';
}

export function contentDispositionForFile(filePath) {
    const filename = path.basename(filePath);
    const fallbackName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
    return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function imageMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.bmp') return 'image/bmp';
    return 'image/jpeg';
}

export function httpDate(value) {
    return value instanceof Date ? value.toUTCString() : new Date(value).toUTCString();
}

export function webdavEtag(stats) {
    return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

export function naturalComparePath(a = '', b = '') {
    return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: 'base',
    });
}

export function safeStatSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

export function normalizeOptionalRoot(rootPath) {
    if (!rootPath) return '';
    try {
        if (!fs.existsSync(rootPath)) return '';
        return realPathOrResolved(rootPath);
    } catch {
        return '';
    }
}

export function isSharedThumbnailFile(filePath, options = {}) {
    const thumbnailDir = normalizeOptionalRoot(options.thumbnailDir);
    return Boolean(
        thumbnailDir
        && IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
        && isWithinRoot(filePath, [thumbnailDir])
    );
}

export function resolveSharedArchive(queryValue, roots) {
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

export function resolveSharedDownload(queryValue, roots, options = {}) {
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

export function downloadMimeType(filePath) {
    return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
        ? imageMimeType(filePath)
        : archiveMimeType(filePath);
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

export async function archiveImageEntries(filePath, options = {}) {
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

export async function readArchiveImage(filePath, { pageName = '', pageIndex = null } = {}, options = {}) {
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
