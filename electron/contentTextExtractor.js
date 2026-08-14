import fsp from 'fs/promises';
import path from 'path';
import {
    listZipEntriesFromFile,
    readZipEntryFromFile,
} from './core/zipArchive.js';
import {
    decodeTextBuffer,
    ViewerSessionManager,
} from './viewerSessions.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.text', '.log', '.md']);
const EPUB_EXTENSIONS = new Set(['.epub']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const DEFAULT_MAX_UNIQUE_TOKENS = 100000;
const DEFAULT_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_PDF_SOURCE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_TOKEN_BYTES = 256;
const DEFAULT_MAX_TOTAL_TOKEN_BYTES = 4 * 1024 * 1024;
const TOKENIZATION_CHUNK_CHARS = 256 * 1024;
const TOKENIZATION_BOUNDARY_LOOKAHEAD_CHARS = 4096;
const TOKENIZER_LANGUAGE_SAMPLE_CHARS = 64 * 1024;
const EPUB_ENCRYPTION_ENTRY = 'meta-inf/encryption.xml';
const EPUB_TEXT_ENTRY_PATTERN = /\.(?:opf|xhtml|html|htm|ncx|xml)$/i;
const EPUB_FONT_ENTRY_PATTERN = /\.(?:otf|ttf|woff2?)$/i;
const WORD_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

let wordSegmenter;
let wordSegmenterResolved = false;
let pdfJsPromise;

function normalizeTokenText(value = '') {
    return String(value ?? '')
        .normalize('NFKC')
        .normalize('NFC')
        .toLowerCase();
}

function getWordSegmenter() {
    if (wordSegmenterResolved) return wordSegmenter;
    wordSegmenterResolved = true;
    try {
        wordSegmenter = typeof Intl?.Segmenter === 'function'
            ? new Intl.Segmenter(undefined, { granularity: 'word' })
            : null;
    } catch {
        wordSegmenter = null;
    }
    return wordSegmenter;
}

function needsCjkWordSegmentation(value = '') {
    const sample = String(value || '').slice(0, TOKENIZER_LANGUAGE_SAMPLE_CHARS);
    if (!sample) return false;
    let hanCount = 0;
    let hangulCount = 0;
    for (let index = 0; index < sample.length; index += 1) {
        const code = sample.codePointAt(index);
        if (code > 0xffff) index += 1;
        if (
            (code >= 0x3040 && code <= 0x30ff)
            || (code >= 0x31f0 && code <= 0x31ff)
        ) return true;
        if (
            (code >= 0x3400 && code <= 0x4dbf)
            || (code >= 0x4e00 && code <= 0x9fff)
            || (code >= 0x20000 && code <= 0x323af)
        ) hanCount += 1;
        else if (
            (code >= 0x1100 && code <= 0x11ff)
            || (code >= 0x3130 && code <= 0x318f)
            || (code >= 0xac00 && code <= 0xd7af)
        ) hangulCount += 1;
    }
    return hanCount >= 8 && hanCount > hangulCount;
}

function* iterateWordTokens(value = '') {
    const normalized = normalizeTokenText(value);
    if (!normalized) return;
    const segmenter = getWordSegmenter();
    if (!segmenter || !needsCjkWordSegmentation(normalized)) {
        for (const match of normalized.matchAll(WORD_TOKEN_PATTERN)) {
            if (match[0]) yield match[0];
        }
        return;
    }

    for (const segment of segmenter.segment(normalized)) {
        if (!segment.isWordLike) continue;
        for (const match of segment.segment.matchAll(WORD_TOKEN_PATTERN)) {
            if (match[0]) yield match[0];
        }
    }
}

function wordTokens(value = '') {
    return Array.from(iterateWordTokens(value));
}

export function tokenizeContentQuery(query = '') {
    return Array.from(new Set(wordTokens(query)));
}

function maxUniqueTokenCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_UNIQUE_TOKENS;
    return Math.max(1, Math.floor(parsed));
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.max(1, Math.floor(parsed));
}

function* tokenizationChunks(value = '') {
    const text = String(value || '');
    let start = 0;
    while (start < text.length) {
        let end = Math.min(text.length, start + TOKENIZATION_CHUNK_CHARS);
        if (end < text.length) {
            const lookahead = text.slice(end, end + TOKENIZATION_BOUNDARY_LOOKAHEAD_CHARS);
            const boundary = lookahead.search(/[^\p{L}\p{M}\p{N}'’]/u);
            if (boundary >= 0) end += boundary + 1;
            else if (/^[\uDC00-\uDFFF]$/.test(text[end])) end += 1;
        }
        yield text.slice(start, end);
        start = end;
    }
}

function createTokenAccumulator(maxUniqueTokens, options = {}) {
    const tokenSet = new Set();
    const maxTokenBytes = positiveInteger(options.maxTokenBytes, DEFAULT_MAX_TOKEN_BYTES);
    const maxTotalTokenBytes = positiveInteger(options.maxTotalTokenBytes, DEFAULT_MAX_TOTAL_TOKEN_BYTES);
    let textBytes = 0;
    let tokenBytes = 0;
    let truncated = false;
    let limitReached = false;

    return {
        addText(value = '') {
            const text = String(value || '');
            if (!text) return;
            textBytes += Buffer.byteLength(text, 'utf8');
            if (limitReached) return;
            for (const chunk of tokenizationChunks(text)) {
                for (const token of iterateWordTokens(chunk)) {
                    if (tokenSet.has(token)) continue;
                    const tokenByteLength = Buffer.byteLength(token, 'utf8');
                    if (tokenByteLength > maxTokenBytes) {
                        truncated = true;
                        continue;
                    }
                    if (
                        tokenSet.size >= maxUniqueTokens
                        || tokenBytes + tokenByteLength > maxTotalTokenBytes
                    ) {
                        truncated = true;
                        limitReached = true;
                        break;
                    }
                    tokenSet.add(token);
                    tokenBytes += tokenByteLength;
                }
                if (limitReached) break;
            }
        },
        get result() {
            return {
                tokens: Array.from(tokenSet),
                textBytes,
                truncated,
            };
        },
        get textBytes() {
            return textBytes;
        },
        get truncated() {
            return truncated;
        },
    };
}

function extractionResult(status, options = {}) {
    const tokens = Array.isArray(options.tokens) ? options.tokens : [];
    return {
        tokens,
        status,
        tokenCount: tokens.length,
        textBytes: Math.max(0, Number(options.textBytes) || 0),
        warnings: Array.from(new Set((options.warnings || []).filter(Boolean).map(String))),
    };
}

function contentExtractionAbortError() {
    const error = new Error('Content text extraction was cancelled.');
    error.name = 'AbortError';
    return error;
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    throw contentExtractionAbortError();
}

function awaitWithAbort(operation, signal) {
    if (!signal?.addEventListener) return operation;
    if (signal.aborted) return Promise.reject(contentExtractionAbortError());
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = callback => value => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            callback(value);
        };
        const handleAbort = () => finish(reject)(contentExtractionAbortError());
        signal.addEventListener('abort', handleAbort, { once: true });
        Promise.resolve(operation).then(finish(resolve), finish(reject));
    });
}

function readFileOptions(signal) {
    return signal && typeof signal.addEventListener === 'function'
        ? { signal }
        : undefined;
}

function isAbortError(error, signal) {
    return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
}

function isPdfPasswordError(error) {
    return Boolean(
        error?.name === 'PasswordException'
        || /password|encrypted pdf/i.test(error?.message || ''),
    );
}

function fileIdentity(stats) {
    return {
        size: Number(stats?.size) || 0,
        mtimeMs: Number(stats?.mtimeMs) || 0,
        ctimeMs: Number(stats?.ctimeMs) || 0,
        ino: Number(stats?.ino) || 0,
    };
}

function sameFileIdentity(left, right) {
    if (!left || !right) return false;
    if (left.size !== right.size || left.mtimeMs !== right.mtimeMs || left.ctimeMs !== right.ctimeMs) return false;
    return !left.ino || !right.ino || left.ino === right.ino;
}

function normalizedArchiveEntryName(value = '') {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC').toLowerCase();
}

function epubEncryptionBlocks(xml = '') {
    return Array.from(String(xml || '').matchAll(
        /<(?:\w+:)?EncryptedData\b[\s\S]*?<\/(?:\w+:)?EncryptedData>/gi,
    ), match => match[0]);
}

function epubEncryptionBlockProtectsText(block = '') {
    const target = block.match(/<(?:\w+:)?CipherReference\b[^>]*\bURI\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    const targetPath = (() => {
        try {
            return decodeURIComponent(target.split('#')[0].split('?')[0]);
        } catch {
            return target.split('#')[0].split('?')[0];
        }
    })();
    if (EPUB_FONT_ENTRY_PATTERN.test(targetPath)) return false;
    return !targetPath || EPUB_TEXT_ENTRY_PATTERN.test(targetPath);
}

async function epubTextIsEncrypted(filePath, signal) {
    throwIfAborted(signal);
    const entries = await listZipEntriesFromFile(filePath);
    throwIfAborted(signal);
    if (entries.some(entry => (
        Boolean(entry.flags & 0x1)
        && EPUB_TEXT_ENTRY_PATTERN.test(entry.name || '')
    ))) {
        return true;
    }

    const encryptionEntry = entries.find(entry => (
        normalizedArchiveEntryName(entry.name) === EPUB_ENCRYPTION_ENTRY
    ));
    if (!encryptionEntry) return false;
    if (encryptionEntry.flags & 0x1) return true;
    const buffer = await readZipEntryFromFile(filePath, encryptionEntry, {
        maxBytes: 1024 * 1024,
        maxCompressedBytes: 1024 * 1024,
    });
    if (!buffer) throw new Error('EPUB encryption metadata could not be read safely.');
    return epubEncryptionBlocks(buffer.toString('utf8')).some(epubEncryptionBlockProtectsText);
}

async function extractTxtTokens(filePath, accumulator, signal, options = {}) {
    const maxSourceBytes = positiveInteger(options.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES);
    const handle = await fsp.open(filePath, 'r');
    let buffer;
    let sourceTruncated = false;
    try {
        const stat = await handle.stat();
        const readLength = Math.min(Number(stat.size) || 0, maxSourceBytes);
        buffer = Buffer.allocUnsafe(readLength);
        let offset = 0;
        while (offset < readLength) {
            throwIfAborted(signal);
            const { bytesRead } = await handle.read(buffer, offset, readLength - offset, offset);
            if (bytesRead < 1) break;
            offset += bytesRead;
        }
        if (offset < buffer.length) buffer = buffer.subarray(0, offset);
        sourceTruncated = Number(stat.size) > offset;
    } finally {
        await handle.close();
    }
    throwIfAborted(signal);
    const text = decodeTextBuffer(buffer, 'auto');
    accumulator.addText(text);
    return {
        status: sourceTruncated ? 'truncated' : (text ? 'ok' : 'empty'),
        warnings: sourceTruncated
            ? [`TXT content was limited to ${maxSourceBytes} source bytes.`]
            : [],
    };
}

async function extractEpubTokens(filePath, accumulator, signal) {
    if (await epubTextIsEncrypted(filePath, signal)) {
        return {
            status: 'encrypted',
            warnings: ['EPUB spine content is encrypted.'],
        };
    }
    throwIfAborted(signal);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, {
        skipAdjacent: true,
        skipExistenceCheck: true,
    });
    const result = await manager.getEpubText(session.id, {
        signal,
        textOnly: true,
        onChapterText: chapter => accumulator.addText(chapter.text || ''),
        shouldStop: () => accumulator.truncated,
    });
    if (result.encrypted) {
        return {
            status: 'encrypted',
            warnings: result.warnings || ['EPUB spine content is encrypted.'],
        };
    }
    throwIfAborted(signal);
    if (accumulator.textBytes < 1) {
        return {
            status: 'ocr_required',
            warnings: [...(result.warnings || []), 'EPUB has no extractable spine text.'],
        };
    }
    return {
        status: result.truncated ? 'truncated' : 'ok',
        warnings: result.warnings || [],
    };
}

function pdfPageText(items = []) {
    return items.map(item => {
        const text = typeof item?.str === 'string' ? item.str : '';
        if (!text) return '';
        return `${text}${item.hasEOL ? '\n' : ' '}`;
    }).join('').trim();
}

async function pdfJs() {
    if (!pdfJsPromise) {
        pdfJsPromise = Promise.resolve()
            .then(async () => {
                if (typeof process.getBuiltinModule !== 'function') {
                    const { createRequire } = await import('node:module');
                    const require = createRequire(import.meta.url);
                    process.getBuiltinModule = moduleName => require(moduleName);
                }
                return import('pdfjs-dist/legacy/build/pdf.mjs');
            });
    }
    return pdfJsPromise;
}

async function extractPdfTokens(filePath, accumulator, signal, options = {}) {
    throwIfAborted(signal);
    const maxPdfSourceBytes = positiveInteger(
        options.maxPdfSourceBytes,
        DEFAULT_MAX_PDF_SOURCE_BYTES,
    );
    const stats = await fsp.stat(filePath);
    if (Number(stats.size) > maxPdfSourceBytes) {
        return {
            status: 'unsupported',
            warnings: [`PDF content extraction was limited to files no larger than ${maxPdfSourceBytes} bytes.`],
        };
    }
    const pdfjs = await pdfJs();
    throwIfAborted(signal);
    const buffer = await fsp.readFile(filePath, readFileOptions(signal));
    throwIfAborted(signal);
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        disableAutoFetch: true,
        isEvalSupported: false,
        useSystemFonts: true,
    });
    const abortLoading = () => {
        const destroyed = loadingTask.destroy();
        destroyed?.catch?.(() => {});
    };
    signal?.addEventListener?.('abort', abortLoading, { once: true });
    if (signal?.aborted) abortLoading();
    let document = null;
    let emptyPages = 0;
    let selectablePages = 0;
    try {
        document = await loadingTask.promise;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            throwIfAborted(signal);
            const page = await document.getPage(pageNumber);
            try {
                const textContent = await page.getTextContent();
                const text = pdfPageText(textContent.items || []);
                if (text) {
                    selectablePages += 1;
                    accumulator.addText(text);
                } else {
                    emptyPages += 1;
                }
            } finally {
                page.cleanup?.();
            }
            if (accumulator.truncated) break;
        }
    } finally {
        signal?.removeEventListener?.('abort', abortLoading);
        try {
            if (document) await document.destroy();
            else await loadingTask.destroy();
        } catch {
            // Cleanup failures must not hide the extraction status.
        }
    }

    if (selectablePages < 1) {
        return {
            status: 'ocr_required',
            warnings: ['PDF has no selectable text.'],
        };
    }
    return {
        status: 'ok',
        warnings: emptyPages > 0
            ? [`PDF contains ${emptyPages} page(s) without selectable text.`]
            : [],
    };
}

function extractorForExtension(extension) {
    if (TEXT_EXTENSIONS.has(extension)) return extractTxtTokens;
    if (EPUB_EXTENSIONS.has(extension)) return extractEpubTokens;
    if (PDF_EXTENSIONS.has(extension)) return extractPdfTokens;
    return null;
}

export async function extractContentTokens(filePath, options = {}) {
    const signal = options.signal;
    if (signal?.aborted) {
        return extractionResult('cancelled', {
            warnings: ['Content text extraction was cancelled.'],
        });
    }

    const resolvedPath = path.resolve(String(filePath || ''));
    const extractor = extractorForExtension(path.extname(resolvedPath).toLowerCase());
    if (!extractor) {
        return extractionResult('unsupported', {
            warnings: ['Unsupported content text format.'],
        });
    }

    let before;
    try {
        before = fileIdentity(await awaitWithAbort(fsp.stat(resolvedPath), signal));
    } catch (error) {
        if (isAbortError(error, signal)) {
            return extractionResult('cancelled', {
                warnings: ['Content text extraction was cancelled.'],
            });
        }
        return extractionResult('error', {
            warnings: [error?.message || String(error)],
        });
    }

    const accumulator = createTokenAccumulator(maxUniqueTokenCount(options.maxUniqueTokens), {
        maxTokenBytes: options.maxTokenBytes,
        maxTotalTokenBytes: options.maxTotalTokenBytes,
    });
    let outcome = null;
    let extractionError = null;
    try {
        outcome = await awaitWithAbort(
            extractor(resolvedPath, accumulator, signal, options),
            signal,
        );
    } catch (error) {
        extractionError = error;
    }

    let after = null;
    try {
        after = fileIdentity(await awaitWithAbort(fsp.stat(resolvedPath), signal));
    } catch (error) {
        if (!extractionError) extractionError = error;
    }

    if (isAbortError(extractionError, signal)) {
        return extractionResult('cancelled', {
            warnings: ['Content text extraction was cancelled.'],
        });
    }
    if (!sameFileIdentity(before, after)) {
        return extractionResult('changed', {
            warnings: ['The source file changed during content text extraction.'],
        });
    }
    if (isPdfPasswordError(extractionError)) {
        return extractionResult('encrypted', {
            warnings: ['PDF password is required for content text extraction.'],
        });
    }
    if (extractionError) {
        return extractionResult('error', {
            warnings: [extractionError?.message || String(extractionError)],
        });
    }

    const extracted = accumulator.result;
    const warnings = [...(outcome?.warnings || [])];
    let status = extracted.truncated || outcome?.status === 'truncated'
        ? 'truncated'
        : (outcome?.status || (extracted.textBytes > 0 ? 'ok' : 'empty'));
    if (status === 'ok' && extracted.tokens.length < 1) status = 'empty';
    if (extracted.truncated) {
        warnings.push(`Content tokens were limited to ${maxUniqueTokenCount(options.maxUniqueTokens)} unique values.`);
    }
    if (status === 'encrypted' || status === 'ocr_required' || status === 'error') {
        return extractionResult(status, {
            textBytes: extracted.textBytes,
            warnings,
        });
    }
    return extractionResult(status, {
        ...extracted,
        warnings,
    });
}
