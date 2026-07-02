import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import {
    listZipEntriesFromFile,
    readZipEntryFromFile,
} from './core/zipArchive.js';
import { missingBinaryMessage } from './binaryPolicy.js';

const COMIC_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const EPUB_EXTENSIONS = new Set(['.epub']);
const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.log', '.md']);
const SUPPORTED_VIEWER_EXTENSIONS = new Set([
    ...COMIC_EXTENSIONS,
    ...PDF_EXTENSIONS,
    ...EPUB_EXTENSIONS,
    ...TEXT_EXTENSIONS,
]);
const MAX_TEXT_BYTES = 24 * 1024 * 1024;
const MAX_EPUB_CHAPTER_BYTES = 8 * 1024 * 1024;
const MAX_VIEWER_SESSIONS = 16;

function normalizeInnerPath(entryPath = '') {
    return String(entryPath || '').replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC');
}

function naturalCompare(left, right) {
    return String(left || '').localeCompare(String(right || ''), 'ko', {
        numeric: true,
        sensitivity: 'base',
    });
}

function isImageEntry(entryPath = '') {
    return IMAGE_EXTENSIONS.has(path.extname(entryPath).toLowerCase());
}

function imageMime(entryPath = '') {
    const extension = path.extname(entryPath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.bmp') return 'image/bmp';
    return 'image/jpeg';
}

function documentMime(filePath = '') {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.pdf') return 'application/pdf';
    if (extension === '.epub') return 'application/epub+zip';
    return 'application/octet-stream';
}

function documentProtocolUrl(session) {
    return `bookmanager-document://session/${encodeURIComponent(session.id)}/${encodeURIComponent(session.fileName)}`;
}

function comicPageProtocolUrl(session, entryName) {
    return `bookmanager-comic://session/${encodeURIComponent(session.id)}/${encodeURIComponent(entryName)}`;
}

function viewerTypeForPath(filePath = '') {
    const extension = path.extname(filePath).toLowerCase();
    if (COMIC_EXTENSIONS.has(extension)) return 'comic';
    if (PDF_EXTENSIONS.has(extension)) return 'pdf';
    if (EPUB_EXTENSIONS.has(extension)) return 'epub';
    if (TEXT_EXTENSIONS.has(extension)) return 'text';
    return 'unsupported';
}

function bufferToDataUrl(buffer, mime) {
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

function stripHtmlToText(html = '') {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<\/(p|div|section|article|h[1-6]|li|br)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function parseComicReadingDirection(xml = '') {
    const mangaMatch = String(xml || '').match(/<Manga>\s*([^<]+)\s*<\/Manga>/i);
    const readingDirectionMatch = String(xml || '').match(/<ReadingDirection>\s*([^<]+)\s*<\/ReadingDirection>/i);
    const raw = `${mangaMatch?.[1] || ''} ${readingDirectionMatch?.[1] || ''}`.toLowerCase();
    if (raw.includes('righttoleft') || raw.includes('right-to-left') || raw.includes('rtl')) return 'rtl';
    return 'ltr';
}

function decodeWithEncoding(buffer, encodingName, options = {}) {
    return new TextDecoder(encodingName, options).decode(buffer);
}

function scoreDecodedText(text = '') {
    const value = String(text || '');
    const replacementCount = (value.match(/\uFFFD/g) || []).length;
    const controlCount = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
    const hangulCount = (value.match(/[가-힣]/g) || []).length;
    const visibleCount = value.replace(/\s/g, '').length || 1;
    return (replacementCount * 120) + (controlCount * 80) - ((hangulCount / visibleCount) * 30);
}

function decodeTextBuffer(buffer, encoding = 'auto') {
    const selected = String(encoding || 'auto').toLowerCase();
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf8');
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString('utf16le');
    }
    const encodings = selected === 'auto'
        ? ['utf-8', 'euc-kr', 'windows-949', 'shift_jis']
        : [selected];
    let best = null;
    for (const encodingName of encodings) {
        try {
            const decoded = encodingName === 'utf-8'
                ? decodeWithEncoding(buffer, encodingName, { fatal: selected !== 'auto' })
                : decodeWithEncoding(buffer, encodingName);
            const score = scoreDecodedText(decoded);
            if (!best || score < best.score) {
                best = { text: decoded, score };
            }
            if (selected !== 'auto') return decoded;
        } catch {
            // 지원하지 않는 인코딩은 다음 후보를 시도합니다.
        }
    }
    return best?.text || buffer.toString('utf8');
}

function run7z(sevenZExe, args, options = {}) {
    return new Promise((resolve, reject) => {
        if (!sevenZExe) {
            reject(new Error(missingBinaryMessage('7z')));
            return;
        }
        const child = spawn(sevenZExe, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        let stdoutLength = 0;
        child.stdout.on('data', chunk => {
            const nextChunk = Buffer.from(chunk);
            stdoutLength += nextChunk.length;
            if (options.maxBuffer && stdoutLength > options.maxBuffer) {
                child.kill();
                reject(new Error('Extracted data is too large.'));
                return;
            }
            stdoutChunks.push(nextChunk);
        });
        child.stderr.on('data', chunk => stderrChunks.push(Buffer.from(chunk)));
        child.on('error', reject);
        child.on('close', code => {
            const stdout = Buffer.concat(stdoutChunks);
            const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
            if (code !== 0) {
                reject(new Error(stderr || `7z exited with code ${code}`));
                return;
            }
            resolve(stdout);
        });
    });
}

async function listWith7z(filePath, sevenZExe) {
    const stdout = (await run7z(sevenZExe, ['l', '-slt', filePath], {
        maxBuffer: 20 * 1024 * 1024,
    })).toString('utf8');
    const entries = [];
    let current = null;
    for (const line of stdout.split(/\r?\n/)) {
        const index = line.indexOf(' = ');
        if (index < 0) continue;
        const key = line.slice(0, index);
        const value = line.slice(index + 3);
        if (key === 'Path') {
            if (current?.name) entries.push(current);
            current = { name: normalizeInnerPath(value), isDir: false, size: 0, encrypted: false };
        } else if (current && key === 'Attributes') {
            current.isDir = value.includes('D');
        } else if (current && key === 'Size') {
            current.size = Number(value) || 0;
        } else if (current && key === 'Encrypted') {
            current.encrypted = value === '+';
        }
    }
    if (current?.name) entries.push(current);
    const archivePath = normalizeInnerPath(path.resolve(filePath)).toLowerCase();
    const archiveName = path.basename(filePath).normalize('NFC').toLowerCase();
    return entries.filter(entry => {
        const entryName = normalizeInnerPath(entry.name).toLowerCase();
        return entryName !== archivePath && entryName !== archiveName;
    });
}

async function listArchiveEntries(filePath, sevenZExe) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.zip' || extension === '.cbz' || extension === '.epub') {
        try {
            const entries = await listZipEntriesFromFile(filePath);
            if (entries.length > 0) {
                return entries.map(entry => ({
                    name: normalizeInnerPath(entry.name),
                    isDir: Boolean(entry.isDirectory),
                    size: entry.uncompressedSize || entry.compressedSize || 0,
                    encrypted: Boolean(entry.flags & 0x1),
                    zipEntry: entry,
                }));
            }
        } catch {
            if (!sevenZExe) throw new Error('ZIP entries could not be read.');
        }
    }
    return listWith7z(filePath, sevenZExe);
}

async function extractArchiveEntry(filePath, entryName, sevenZExe, options = {}) {
    const extension = path.extname(filePath).toLowerCase();
    const normalizedEntryName = normalizeInnerPath(entryName);
    if (extension === '.zip' || extension === '.cbz' || extension === '.epub') {
        const entries = await listZipEntriesFromFile(filePath);
        const entry = entries.find(item => normalizeInnerPath(item.name) === normalizedEntryName);
        if (!entry) throw new Error(`${entryName} not found`);
        const buffer = await readZipEntryFromFile(filePath, entry, {
            maxBytes: options.maxBytes,
            maxCompressedBytes: options.maxCompressedBytes,
        });
        if (buffer) return buffer;
        if (!sevenZExe) throw new Error(`${entryName} extraction failed`);
    }
    return run7z(sevenZExe, ['x', '-so', filePath, normalizedEntryName], {
        maxBuffer: options.maxBytes || 500 * 1024 * 1024,
    });
}

function sameViewerPath(left = '', right = '') {
    const normalizedLeft = path.resolve(left).normalize('NFC');
    const normalizedRight = path.resolve(right).normalize('NFC');
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}

function listSiblingViewerFiles(filePath = '') {
    try {
        const folderPath = path.dirname(filePath);
        return fs.readdirSync(folderPath, { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => path.join(folderPath, entry.name))
            .filter(entryPath => SUPPORTED_VIEWER_EXTENSIONS.has(path.extname(entryPath).toLowerCase()))
            .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'ko', {
                numeric: true,
                sensitivity: 'base',
            }));
    } catch {
        return [];
    }
}

function adjacentBookState(filePath = '') {
    const entries = listSiblingViewerFiles(filePath);
    const currentIndex = entries.findIndex(entryPath => sameViewerPath(entryPath, filePath));
    return {
        hasPrevious: currentIndex > 0,
        hasNext: currentIndex >= 0 && currentIndex < entries.length - 1,
    };
}

export class ViewerSessionManager {
    constructor(options = {}) {
        this.getSevenZPath = options.getSevenZPath || (async () => '');
        this.sessions = new Map();
        this.currentSessionId = '';
        this.nextSessionSeq = 1;
    }

    pruneSessions() {
        while (this.sessions.size > MAX_VIEWER_SESSIONS) {
            const oldestSessionId = this.sessions.keys().next().value;
            if (!oldestSessionId || oldestSessionId === this.currentSessionId) return;
            this.sessions.delete(oldestSessionId);
        }
    }

    create(filePath) {
        const normalizedPath = path.resolve(filePath || '');
        if (!normalizedPath || !fs.existsSync(normalizedPath)) {
            throw new Error('File not found.');
        }
        const type = viewerTypeForPath(normalizedPath);
        if (type === 'unsupported') {
            throw new Error('Unsupported viewer format.');
        }
        const session = {
            id: `${Date.now().toString(36)}-${this.nextSessionSeq.toString(36)}`,
            filePath: normalizedPath,
            fileName: path.basename(normalizedPath),
            extension: path.extname(normalizedPath).toLowerCase(),
            type,
            adjacent: adjacentBookState(normalizedPath),
            createdAt: new Date().toISOString(),
        };
        this.nextSessionSeq += 1;
        this.sessions.set(session.id, session);
        this.currentSessionId = session.id;
        this.pruneSessions();
        return session;
    }

    createAdjacent(sessionId, direction = 1) {
        const session = this.get(sessionId);
        const entries = listSiblingViewerFiles(session.filePath);
        const currentIndex = entries.findIndex(filePath => sameViewerPath(filePath, session.filePath));
        if (currentIndex < 0) throw new Error('Current book was not found in its folder.');
        const nextIndex = currentIndex + (Number(direction) < 0 ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= entries.length) {
            throw new Error('No adjacent book.');
        }
        return this.create(entries[nextIndex]);
    }

    current() {
        return this.sessions.get(this.currentSessionId) || null;
    }

    get(sessionId = '') {
        const session = this.sessions.get(sessionId || this.currentSessionId);
        if (!session) throw new Error('Viewer session not found.');
        return session;
    }

    async listComicPages(sessionId) {
        const session = this.get(sessionId);
        if (session.type !== 'comic') throw new Error('This file is not a comic archive.');
        const sevenZExe = await this.getSevenZPath();
        const entries = await listArchiveEntries(session.filePath, sevenZExe);
        const comicInfoEntry = entries.find(entry => !entry.isDir && path.posix.basename(entry.name).toLowerCase() === 'comicinfo.xml');
        let readingDirection = 'ltr';
        if (comicInfoEntry) {
            try {
                const buffer = await extractArchiveEntry(session.filePath, comicInfoEntry.name, sevenZExe, {
                    maxBytes: 2 * 1024 * 1024,
                });
                readingDirection = parseComicReadingDirection(buffer.toString('utf8'));
            } catch {
                readingDirection = 'ltr';
            }
        }
        const images = entries
            .filter(entry => !entry.isDir && !entry.encrypted && isImageEntry(entry.name))
            .sort((left, right) => naturalCompare(left.name, right.name));
        return {
            readingDirection,
            pages: images.map((entry, index) => ({
                index,
                name: entry.name,
                basename: path.posix.basename(entry.name),
                size: Number(entry.size) || 0,
                mime: imageMime(entry.name),
                pageUrl: comicPageProtocolUrl(session, entry.name),
            })),
        };
    }

    async getComicPage(sessionId, entryName) {
        const pageData = await this.getComicPageData(sessionId, entryName);
        return {
            name: entryName,
            dataUrl: bufferToDataUrl(pageData.buffer, pageData.mime),
        };
    }

    async getComicPageData(sessionId, entryName) {
        const session = this.get(sessionId);
        if (session.type !== 'comic') throw new Error('This file is not a comic archive.');
        const sevenZExe = await this.getSevenZPath();
        const buffer = await extractArchiveEntry(session.filePath, entryName, sevenZExe, {
            maxBytes: 500 * 1024 * 1024,
        });
        return {
            name: entryName,
            mime: imageMime(entryName),
            buffer,
        };
    }

    async getDocumentData(sessionId) {
        const session = this.get(sessionId);
        if (session.type !== 'pdf' && session.type !== 'epub') {
            throw new Error('This file is not a document.');
        }
        const mime = documentMime(session.filePath);
        return {
            mime,
            documentUrl: documentProtocolUrl(session),
        };
    }

    resolveDocumentRequest(requestUrl = '') {
        let url = null;
        try {
            url = new URL(requestUrl);
        } catch {
            return null;
        }
        if (url.protocol !== 'bookmanager-document:' || url.hostname !== 'session') return null;
        const sessionId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '');
        const session = this.sessions.get(sessionId);
        if (!session || (session.type !== 'pdf' && session.type !== 'epub')) return null;
        return {
            filePath: session.filePath,
            mime: documentMime(session.filePath),
        };
    }

    async getComicPageDataFromRequest(requestUrl = '') {
        let url = null;
        try {
            url = new URL(requestUrl);
        } catch {
            return null;
        }
        if (url.protocol !== 'bookmanager-comic:' || url.hostname !== 'session') return null;
        const pathParts = url.pathname.split('/').filter(Boolean);
        const sessionId = decodeURIComponent(pathParts[0] || '');
        const entryName = decodeURIComponent(pathParts[1] || '');
        if (!sessionId || !entryName) return null;
        return this.getComicPageData(sessionId, entryName);
    }

    async getText(sessionId, options = {}) {
        const session = this.get(sessionId);
        if (session.type !== 'text') throw new Error('This file is not a text document.');
        const stat = await fsp.stat(session.filePath);
        if (stat.size > MAX_TEXT_BYTES) throw new Error('Text file is too large.');
        const buffer = await fsp.readFile(session.filePath);
        return {
            encoding: options.encoding || 'auto',
            text: decodeTextBuffer(buffer, options.encoding || 'auto'),
        };
    }

    async getEpubText(sessionId) {
        const session = this.get(sessionId);
        if (session.type !== 'epub') throw new Error('This file is not an EPUB document.');
        const entries = await listArchiveEntries(session.filePath, '');
        const chapters = entries
            .filter(entry => !entry.isDir && /\.(xhtml|html|htm)$/i.test(entry.name))
            .filter(entry => !/(^|\/)(nav|toc)\.(xhtml|html|htm)$/i.test(entry.name))
            .sort((left, right) => naturalCompare(left.name, right.name))
            .slice(0, 200);
        const results = [];
        for (const entry of chapters) {
            const buffer = await extractArchiveEntry(session.filePath, entry.name, '', {
                maxBytes: MAX_EPUB_CHAPTER_BYTES,
            });
            const text = stripHtmlToText(buffer.toString('utf8'));
            if (!text) continue;
            results.push({
                name: entry.name,
                title: path.posix.basename(entry.name),
                text,
            });
        }
        return { chapters: results };
    }
}
