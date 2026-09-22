import fs from 'node:fs/promises';
import path from 'node:path';
import { isUtf8 } from 'node:buffer';
import { newId, paragraph, projectError } from './model.js';
import { MAX_TEXT_IMPORT_BYTES, MAX_TEXT_IMPORT_CHARACTERS, MAX_TEXT_IMPORT_PARAGRAPHS, MAX_TEXT_PARAGRAPH_CHARACTERS, splitTextImportDocument } from './textImportLimits.js';

export { MAX_TEXT_IMPORT_BYTES } from './textImportLimits.js';
const ENCODINGS = ['auto', 'utf-8', 'utf-16le', 'utf-16be', 'euc-kr', 'shift_jis'];

function detectEncoding(buffer) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8-bom';
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';
    if (isUtf8(buffer)) return 'utf-8';
    const sample = buffer.subarray(0, 512 * 1024);
    const candidates = ['euc-kr', 'shift_jis'].map(encoding => {
        const decoder = new TextDecoder(encoding);
        const text = decoder.decode(sample, { stream: sample.length < buffer.length });
        let invalid = 0;
        let hangul = 0;
        let visible = 0;
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            if (code === 0xfffd) invalid += 120;
            if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) invalid += 80;
            if (code >= 0xac00 && code <= 0xd7a3) hangul += 1;
            if (!(code === 0x20 || (code >= 0x09 && code <= 0x0d) || code === 0xa0 || code === 0xfeff)) visible += 1;
        }
        return { encoding, score: invalid - hangul / Math.max(1, visible) * 30 };
    });
    return candidates.sort((a, b) => a.score - b.score)[0].encoding;
}

function decodeInChunks(buffer, encoding) {
    const decoder = new TextDecoder(encoding === 'utf-8-bom' ? 'utf-8' : encoding, { fatal: true });
    const chunks = [];
    // Keep decoder allocations bounded and retain multibyte characters across chunk boundaries.
    for (let offset = 0; offset < buffer.length; offset += 65536) chunks.push(decoder.decode(buffer.subarray(offset, offset + 65536), { stream: true }));
    chunks.push(decoder.decode());
    return chunks.join('');
}

export function textImportDocument(source) {
    const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n');
    if (/[\u0000-\u0008\u000b\u000e-\u001f\ufffe\uffff]/u.test(text)) throw projectError('TEXT_NOT_PLAIN');
    if (!text.trim()) throw projectError('TEXT_EMPTY');
    if (text.length > MAX_TEXT_IMPORT_CHARACTERS) throw projectError('TEXT_TOO_LARGE');
    const lines = text.split('\n', MAX_TEXT_IMPORT_PARAGRAPHS + 1);
    if (lines.length > MAX_TEXT_IMPORT_PARAGRAPHS) throw projectError('TEXT_TOO_LARGE');
    if (lines.some(line => line.length > MAX_TEXT_PARAGRAPH_CHARACTERS)) throw projectError('TEXT_PARAGRAPH_TOO_LARGE');
    const document = { type: 'doc', content: lines.map(line => ({ ...paragraph(line), attrs: { id: newId() } })) };
    return { document, chapterCount: splitTextImportDocument(document).length, preview: text.slice(0, 4000), characters: text.length, paragraphs: lines.length };
}

export async function readTextImport(filePath, encoding = 'auto') {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.txt') throw projectError('TEXT_FILE_REQUIRED');
    if (!ENCODINGS.includes(encoding)) throw projectError('TEXT_ENCODING');
    const handle = await fs.open(filePath, 'r');
    let buffer;
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw projectError('TEXT_FILE_REQUIRED');
        if (stat.size > MAX_TEXT_IMPORT_BYTES) throw projectError('TEXT_TOO_LARGE');
        buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_TEXT_IMPORT_BYTES + 1));
        let total = 0;
        while (total < buffer.length) {
            const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
            if (!bytesRead) break;
            total += bytesRead;
        }
        if (total > stat.size) throw projectError('EXTERNAL_CHANGE');
        buffer = buffer.subarray(0, total);
    } finally { await handle.close(); }
    const info = { name: path.basename(filePath), title: path.basename(filePath, path.extname(filePath)), encoding };
    try {
        const detected = encoding === 'auto' ? detectEncoding(buffer) : encoding;
        const text = decodeInChunks(buffer, detected);
        return { ...info, encoding: detected, ...textImportDocument(text) };
    } catch (error) {
        return { ...info, error: ['TEXT_NOT_PLAIN', 'TEXT_EMPTY', 'TEXT_TOO_LARGE', 'TEXT_PARAGRAPH_TOO_LARGE'].includes(error.code) ? error.code : 'TEXT_ENCODING' };
    }
}
