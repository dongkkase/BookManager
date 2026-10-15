import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { decodeHTMLStrict } from 'entities';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import { ident } from 'css-tree/utils';
import { tokenize, tokenTypes as T } from 'css-tree/tokenizer';

const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MEDIA_KINDS = new Set(['image', 'font', 'audio']);
const REFERENCE_ATTRIBUTES = new Set(['href', 'src', 'data', 'poster', 'background', 'longdesc', 'uri', 'full-path']);
const CSS_ATTRIBUTES = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'color-profile']);
const ID_ATTRIBUTES = new Set(['idref', 'fallback', 'fallback-style', 'media-overlay', 'handler', 'toc']);
const unsupported = () => { throw new Error('UNUSED_REFERENCES_UNCERTAIN'); };
const localName = node => String(node.localName || node.nodeName || '').toLowerCase();
const cssName = name => ident.decode(name || '').toLowerCase();
const tokens = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const mediaType = resource => String(resource.mediaType || '').split(';')[0].trim().toLowerCase();

function textKind(resource) {
    const type = mediaType(resource);
    if (/playlist|mpegurl|scpls|xspf/.test(type) || /\.(?:m3u8?|pls|xspf)$/i.test(resource.name)) return 'unknown';
    if (/javascript|ecmascript/.test(type) || /\.(?:js|mjs|cjs)$/i.test(resource.name)) return 'script';
    if (type === 'text/css' || /\.css$/i.test(resource.name)) return 'css';
    if (/xml|opf|ncx/.test(type) || type === 'text/html' || /\.(?:xhtml|html|htm|xml|svg|opf|ncx|smil)$/i.test(resource.name)) return 'xml';
    if (type === 'text/plain' || resource.name === 'mimetype') return 'plain';
    if (type.startsWith('text/')) return 'unknown';
    return null;
}

function scanSrcset(source, addReference) {
    let remaining = source.trim();
    while (remaining) {
        remaining = remaining.replace(/^[\s,]+/, '');
        if (!remaining) break;
        const url = remaining.match(/^\S+/)[0];
        remaining = remaining.slice(url.length);
        if (url.endsWith(',')) {
            const candidate = url.replace(/,+$/, '');
            if (!addReference(candidate) && candidate.includes(',')) unsupported();
            continue;
        }
        if (!addReference(url) && url.includes(',')) unsupported();
        const comma = remaining.indexOf(',');
        const descriptors = (comma < 0 ? remaining : remaining.slice(0, comma)).trim();
        if (descriptors && !/^(?:\d+w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptors)) unsupported();
        remaining = comma < 0 ? '' : remaining.slice(comma + 1);
    }
}

function scanCss(source, name, addReference, context = 'stylesheet') {
    const brackets = [];
    tokenize(source, (type, start, end) => {
        if ([T.LeftCurlyBracket, T.LeftSquareBracket, T.LeftParenthesis, T.Function].includes(type)) {
            brackets.push(type === T.Function ? T.LeftParenthesis : type);
        }
        if ([T.RightCurlyBracket, T.RightSquareBracket, T.RightParenthesis].includes(type) && brackets.pop() !== type - 1) unsupported();
        if ([T.BadString, T.BadUrl].includes(type)
            || (type === T.String && source[end - 1] !== source[start])
            || (type === T.Url && source[end - 1] !== ')')
            || (type === T.Comment && !source.slice(start, end).endsWith('*/'))) unsupported();
    });
    if (brackets.length) unsupported();
    const tree = parse(source, { context, parseCustomProperty: true, onParseError: unsupported });
    walk(tree, function(node) {
        if (node.type === 'Raw') unsupported();
        if (node.type === 'Function' && ['expression', 'attr'].includes(cssName(node.name))) unsupported();
        if (node.type === 'Url' || node.type === 'String') {
            addReference(name, node.value, { remoteUnsafe: cssName(this.atrule?.name) === 'import' });
        }
    });
}

function scanXml(document, name, addReference, protectId = null) {
    if (!document?.documentElement) unsupported();
    const pending = [[document, 0]];
    let count = 0;
    while (pending.length) {
        const [node, depth] = pending.pop();
        if (++count > 500000 || depth > 256) unsupported();
        if (node.nodeType === 7 && localName(node) !== 'xml') unsupported();
        for (let child = node.firstChild; child; child = child.nextSibling) pending.push([child, depth + 1]);
        if (node.nodeType !== 1) continue;
        const tag = localName(node);
        if (['script', 'base', 'animate', 'set', 'include', 'applet'].includes(tag) || node.hasAttribute('xml:base')) unsupported();
        if (tag === 'meta' && node.getAttribute('http-equiv')?.toLowerCase() === 'refresh') unsupported();
        const manifestItem = protectId && tag === 'item' && localName(node.parentNode) === 'manifest';
        if (manifestItem && tokens(node.getAttribute('properties')).includes('scripted')) unsupported();
        for (const attribute of Array.from(node.attributes || [])) {
            const attributeName = localName(attribute);
            if (/^on[a-z]+/.test(attributeName) || attributeName === 'srcdoc') unsupported();
            if (attributeName === 'style') {
                scanCss(attribute.value, name, addReference, 'declarationList');
            } else if (CSS_ATTRIBUTES.has(attributeName)) {
                scanCss(attribute.value, name, addReference, 'value');
            } else if (['srcset', 'imagesrcset'].includes(attributeName)) {
                scanSrcset(attribute.value, value => addReference(name, value));
            } else if (REFERENCE_ATTRIBUTES.has(attributeName)) {
                if (manifestItem && attributeName === 'href') {
                    if (/css|javascript|ecmascript|html|xml/i.test(node.getAttribute('media-type') || '')
                        && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(attribute.value.trim())) unsupported();
                    continue;
                }
                const remoteUnsafe = ['iframe', 'object', 'embed'].includes(tag)
                    || tag === 'link' && tokens(node.getAttribute('rel')).some(value => value.toLowerCase() === 'stylesheet');
                addReference(name, attribute.value, { remoteUnsafe });
            } else if (tag === 'param' && attributeName === 'value') {
                addReference(name, attribute.value);
            }
            if (protectId && ID_ATTRIBUTES.has(attributeName)) {
                for (const id of tokens(attribute.value)) protectId(id);
            }
            if (protectId && attributeName === 'refines' && attribute.value.startsWith('#')) protectId(attribute.value.slice(1));
        }
        if (tag === 'style') {
            const type = node.getAttribute('type');
            if (type && type.trim().toLowerCase() !== 'text/css') unsupported();
            scanCss(node.textContent, name, addReference);
        }
        if (protectId && tag === 'meta' && node.getAttribute('name')?.toLowerCase() === 'cover') protectId(node.getAttribute('content'));
    }
}

// A resource is removable only when every retained document was inspected and no reference was found.
export function inspectUnusedResources({ resources = [], textResources = [], packageDocuments = [], protectedNames = [], incomplete = false } = {}) {
    try {
        if (incomplete || resources.length > 20000 || textResources.length > 20000) unsupported();
        const exact = new Map();
        const normalized = new Map();
        const folded = new Map();
        const used = new Set(protectedNames);
        for (const resource of resources) {
            if (typeof resource.name !== 'string' || !resource.name || exact.has(resource.name)) unsupported();
            exact.set(resource.name, resource);
            for (const [map, key] of [[normalized, resource.name.normalize('NFC')], [folded, resource.name.normalize('NFC').toLowerCase()]]) {
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(resource.name);
            }
            if (resource.isCover || resource.encrypted || /^META-INF\//i.test(resource.name)) used.add(resource.name);
            if (['script', 'unknown'].includes(textKind(resource))) unsupported();
        }
        const addReference = (base, value, { remoteUnsafe = false } = {}) => {
            const source = String(value || '').trim();
            if (!source) return;
            if (/^javascript:/i.test(source)) unsupported();
            if (/^data:/i.test(source)) {
                if (remoteUnsafe || /^data:(?:text\/|application\/(?:xml|xhtml\+xml|javascript)|image\/svg\+xml)/i.test(source)) unsupported();
                return true;
            }
            if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(source)) {
                if (remoteUnsafe) unsupported();
                if (!/^(?:https?:|mailto:|tel:|\/\/)/i.test(source)) unsupported();
                return true;
            }
            let decoded;
            try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]); }
            catch { unsupported(); }
            if (!decoded) return;
            if (/[\\\u0000-\u001f\u007f]/.test(decoded)) unsupported();
            const target = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(base), decoded));
            if (target === '..' || target.startsWith('../')) unsupported();
            const markUsed = name => {
                const resource = exact.get(name);
                if (remoteUnsafe && !MEDIA_KINDS.has(resource.kind) && !['css', 'xml', 'plain'].includes(textKind(resource))
                    && !mediaType(resource).startsWith('video/')) unsupported();
                used.add(name);
                return true;
            };
            if (exact.has(target)) return markUsed(target);
            const matches = normalized.get(target.normalize('NFC'));
            if (matches?.length === 1) return markUsed(matches[0]);
            if (matches?.length || folded.has(target.normalize('NFC').toLowerCase())) unsupported();
            return false;
        };
        const packageNames = new Set(packageDocuments.map(packageDocument => packageDocument.name));
        const scanned = new Set(packageNames);
        let totalBytes = 0;
        for (const resource of textResources) {
            if (scanned.has(resource.name)) continue;
            scanned.add(resource.name);
            const kind = textKind(resource);
            if (['script', 'unknown'].includes(kind)) unsupported();
            if (!['css', 'xml'].includes(kind)) continue;
            const data = Buffer.isBuffer(resource.data) ? resource.data : Buffer.from(resource.data || '');
            if (data.length > MAX_TEXT_BYTES || (totalBytes += data.length) > MAX_TOTAL_BYTES) unsupported();
            const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
            const encoding = source.match(/^\s*<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]
                || source.match(/^\s*@charset\s+["']([^"']+)["']/i)?.[1];
            if (encoding && !/^(utf-8|us-ascii)$/i.test(encoding)) unsupported();
            if (kind === 'css') scanCss(source, resource.name, addReference);
            else {
                if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) unsupported();
                const xml = source.replace(/&([a-z][a-z0-9]+);/gi, (match, name) => {
                    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return match;
                    const decoded = decodeHTMLStrict(match);
                    return decoded === match ? match : Array.from(decoded, char => `&#${char.codePointAt(0)};`).join('');
                });
                const document = new DOMParser({ onError: (level, message) => {
                    if (level === 'warning' && message === 'Unicode replacement character detected, source encoding issues?') return;
                    unsupported();
                } }).parseFromString(xml, 'application/xml');
                scanXml(document, resource.name, addReference);
            }
        }
        for (const resource of resources) {
            if (['css', 'xml'].includes(textKind(resource)) && !scanned.has(resource.name)) unsupported();
        }
        for (const { name, document } of packageDocuments) {
            const items = new Map();
            for (const node of Array.from(document.getElementsByTagName('*'))) {
                if (localName(node) !== 'item' || localName(node.parentNode) !== 'manifest') continue;
                const id = node.getAttribute('id');
                if (!id || items.has(id)) unsupported();
                items.set(id, node);
                if (tokens(node.getAttribute('properties')).some(property => ['cover-image', 'nav'].includes(property))) {
                    addReference(name, node.getAttribute('href'));
                }
            }
            scanXml(document, name, addReference, id => {
                const item = items.get(id);
                if (item) addReference(name, item.getAttribute('href'));
            });
        }
        return { unusedNames: resources.filter(resource => MEDIA_KINDS.has(resource.kind) && !used.has(resource.name)).map(resource => resource.name), uncertain: false };
    } catch {
        return { unusedNames: [], uncertain: true };
    }
}
