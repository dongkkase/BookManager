import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { decodeHTMLStrict } from 'entities';
import { projectError } from './model.js';

export const elements = node => Array.from(node.childNodes || []).filter(child => child.nodeType === 1);
export const tag = node => (node.localName || '').toLowerCase();
export const attr = (node, name) => node.getAttribute?.(name) || '';
export const descendants = (node, name) => Array.from(node.getElementsByTagName('*')).filter(child => tag(child) === name);

export function parseEpubXml(data) {
    if (data.length > 16 * 1024 * 1024) throw projectError('EPUB_TOO_LARGE');
    let source;
    try {
        const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
        source = new TextDecoder(encoding, { fatal: true }).decode(data);
    } catch { throw projectError('EPUB_INVALID'); }
    // External DTDs are never loaded. Custom entity declarations are not accepted.
    if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) throw projectError('EPUB_INVALID');
    source = source.replace(/&([a-z][a-z0-9]+);/gi, (match, name) => {
        if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return match;
        const decoded = decodeHTMLStrict(match);
        return decoded === match ? match : Array.from(decoded, char => `&#${char.codePointAt(0)};`).join('');
    });
    let document;
    try {
        document = new DOMParser({ onError: (level, message) => {
            // Fatal decoding above rejects invalid bytes; a literal U+FFFD is valid XML text.
            if (level === 'warning' && message === 'Unicode replacement character detected, source encoding issues?') return;
            throw projectError('EPUB_INVALID');
        } }).parseFromString(source, 'application/xml');
    } catch { throw projectError('EPUB_INVALID'); }
    let count = 0;
    const pending = [[document, 0]];
    while (pending.length) {
        const [node, depth] = pending.pop();
        if (++count > 500000 || depth > 64) throw projectError('EPUB_TOO_LARGE');
        for (const child of Array.from(node.childNodes || [])) pending.push([child, depth + 1]);
    }
    return document;
}

export function epubReference(base, href) {
    if (!href || /^[a-z][a-z0-9+.-]*:|^[/\\]|[\u0000-\u001f]/i.test(href)) return null;
    const hash = href.indexOf('#');
    let resource = hash < 0 ? href : href.slice(0, hash);
    let anchor = hash < 0 ? '' : href.slice(hash + 1);
    try { resource = decodeURIComponent(resource).normalize('NFC'); anchor = decodeURIComponent(anchor); }
    catch { return null; }
    if (/[\\?\u0000-\u001f]/.test(resource) || resource.startsWith('/')) return null;
    const name = resource ? path.posix.normalize(path.posix.join(path.posix.dirname(base), resource)) : base;
    if (name === '..' || name.startsWith('../')) return null;
    return { name, anchor };
}
