import path from 'node:path';
import { decodeHTMLStrict } from 'entities';
import { AUDIO_EXTENSIONS, inferAudioMimeType } from './audioMetadata.js';

export const MAX_EPUB_AUDIO_BYTES = 256 * 1024 * 1024;
export const EPUB_AUDIO_CACHE_BYTES = 64 * 1024 * 1024;

export function isEpubAudioEntry(entryName = '') {
    const extension = path.posix.extname(String(entryName).toLowerCase());
    return AUDIO_EXTENSIONS.has(extension) || extension === '.mp4';
}

export function epubAudioMime(entryName = '') {
    return path.posix.extname(String(entryName).toLowerCase()) === '.mp4' ? 'audio/mp4' : inferAudioMimeType(entryName);
}

function attributes(tag = '') {
    const result = {};
    const source = String(tag).replace(/\/\s*>$/, '>');
    for (const match of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        result[match[1].toLowerCase()] = decodeHTMLStrict(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
}

function escapeAttribute(value = '') {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeAnchor(value = '') {
    return String(value).replace(/[\u0000-\u0020<>"']/g, '').slice(0, 160);
}

function plainText(html = '') {
    return decodeHTMLStrict(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function withoutNonContent(html = '') {
    return String(html).replace(/<!--[\s\S]*?-->|<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, match => ' '.repeat(match.length));
}

export function parseEpubAudioClock(value = '') {
    const text = String(value).trim().replace(/^npt=/i, '');
    if (!text) return null;
    const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (clock) {
        const hours = Number(clock[1] || 0);
        const minutes = Number(clock[2]);
        const seconds = Number(clock[3]);
        return minutes < 60 && seconds < 60 ? (hours * 3600) + (minutes * 60) + seconds : null;
    }
    const count = text.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(h|min|s|ms)?$/i);
    if (!count) return null;
    const scale = { h: 3600, min: 60, s: 1, ms: 0.001 }[String(count[2] || 's').toLowerCase()];
    const seconds = Number(count[1]) * scale;
    return Number.isFinite(seconds) ? seconds : null;
}

export function prepareEpubInlineAudio(html = '', entryName = '', resolveSource = () => null) {
    const source = String(html);
    const searchable = withoutNonContent(source);
    const existingIds = new Set(Array.from(searchable.matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
        .map(match => safeAnchor(decodeHTMLStrict(match[1] ?? match[2] ?? ''))));
    const tracks = [];
    const replacements = [];
    let index = 0;
    const audioPattern = /<(?:\w+:)?audio\b(?:"[^"]*"|'[^']*'|[^'">])*\/>|<(?:\w+:)?audio\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/(?:\w+:)?audio\s*>/gi;
    for (const match of searchable.matchAll(audioPattern)) {
        index += 1;
        const raw = source.slice(match.index, match.index + match[0].length);
        const opening = raw.match(/^<(?:\w+:)?audio\b(?:"[^"]*"|'[^']*'|[^'">])*>/i)?.[0] || '';
        const attrs = attributes(opening);
        const candidates = attrs.src ? [attrs.src] : [];
        for (const child of raw.matchAll(/<(?:\w+:)?source\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
            const childAttrs = attributes(child[0]);
            if (childAttrs.src) candidates.push(childAttrs.src);
        }
        const resolved = candidates.map(href => resolveSource(entryName, href)).filter(Boolean);
        const sources = resolved.filter((item, position) => resolved.findIndex(other => other.src === item.src) === position)
            .map(item => ({ src: item.src, type: item.type }));
        if (sources.length < 1) continue;
        const id = `inline:${entryName}:${index}`;
        let anchor = safeAnchor(attrs.id);
        if (!anchor) {
            anchor = `bookmanager-epub-audio-${index}`;
            while (existingIds.has(anchor)) anchor += '-audio';
        }
        existingIds.add(anchor);
        const title = plainText(attrs.title || attrs['aria-label'] || path.posix.basename(resolved[0].name || '') || `Audio ${index}`).slice(0, 240);
        tracks.push({ id, kind: 'inline', anchor, title, sources, clipBegin: 0, clipEnd: null, loop: Object.hasOwn(attrs, 'loop') });
        const originalOpening = opening.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/i, '')
            .replace(/\s*\/?>$/, ending => ` id="${escapeAttribute(anchor)}" data-bookmanager-audio-track="${escapeAttribute(id)}"${ending}`);
        replacements.push({
            start: match.index,
            end: match.index + raw.length,
            original: originalOpening + raw.slice(opening.length),
            optimized: `<span id="${escapeAttribute(anchor)}" data-bookmanager-audio-track="${escapeAttribute(id)}"></span>`,
        });
    }
    const replace = key => {
        let result = '';
        let offset = 0;
        for (const replacement of replacements) {
            result += source.slice(offset, replacement.start) + replacement[key];
            offset = replacement.end;
        }
        return result + source.slice(offset);
    };
    return { html: replace('original'), optimizedHtml: replace('optimized'), tracks };
}

export function parseEpubMediaOverlay(smil = '', smilEntryName = '', resolveSource = () => null, resolveText = () => null) {
    const tracks = [];
    let index = 0;
    for (const match of withoutNonContent(smil).matchAll(/<(?:\w+:)?par\b[^>]*>([\s\S]*?)<\/(?:\w+:)?par\s*>/gi)) {
        index += 1;
        const textTag = match[1].match(/<(?:\w+:)?text\b[^>]*>/i)?.[0];
        const audioTag = match[1].match(/<(?:\w+:)?audio\b[^>]*>/i)?.[0];
        if (!textTag || !audioTag) continue;
        const text = resolveText(smilEntryName, attributes(textTag).src || '');
        const attrs = attributes(audioTag);
        const audio = resolveSource(smilEntryName, attrs.src || '');
        if (!text || !audio) continue;
        const clipBegin = attrs.clipbegin ? parseEpubAudioClock(attrs.clipbegin) : 0;
        const clipEnd = attrs.clipend ? parseEpubAudioClock(attrs.clipend) : null;
        if (clipBegin === null || (attrs.clipend && (clipEnd === null || clipEnd <= clipBegin))) continue;
        tracks.push({
            id: `overlay:${smilEntryName}:${index}`,
            kind: 'overlay',
            entryName: text.entryName,
            anchor: text.anchor || '',
            title: path.posix.basename(audio.name || '') || `Audio ${index}`,
            sources: [{ src: audio.src, type: audio.type }],
            clipBegin,
            clipEnd,
            loop: false,
        });
    }
    return tracks;
}

export function epubAssetResponseData(asset, rangeHeader = '', method = 'GET') {
    const size = asset.buffer.length;
    const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': asset.mime,
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*',
    };
    let start = 0;
    let end = size - 1;
    if (rangeHeader) {
        const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
        if (match?.[1]) {
            start = Number(match[1]);
            end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        } else if (match?.[2] && Number(match[2]) > 0) {
            start = Math.max(0, size - Number(match[2]));
        } else {
            start = size;
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
            return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' }, body: null };
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    return {
        status: rangeHeader ? 206 : 200,
        headers,
        body: method === 'HEAD' ? null : asset.buffer.subarray(start, end + 1),
    };
}
