import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import { ident } from 'css-tree/utils';
import { tokenize, tokenTypes as T } from 'css-tree/tokenizer';

const MAX_TEXT_SIZE = 16 * 1024 * 1024;
const XML_TYPES = new Set(['application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml']);
const unsupported = () => { throw new Error('FONT_REFERENCES_UNSUPPORTED'); };
const cssName = value => ident.decode(value || '').toLowerCase();

function reference(base, value) {
    if (!value || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) return null;
    let decoded;
    try { decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]).normalize('NFC'); }
    catch { unsupported(); }
    if (/[\\\u0000-\u001f]/.test(decoded)) unsupported();
    const name = decoded.startsWith('/') ? path.posix.normalize(decoded.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
    return { name, suffix: /[?#]/.test(value) };
}

function rewriteCss(source, name, entryName, context = 'stylesheet') {
    const edits = [];
    const brackets = [];
    tokenize(source, (type, start, end) => {
        if ([T.LeftCurlyBracket, T.LeftSquareBracket, T.LeftParenthesis, T.Function].includes(type)) {
            brackets.push(type === T.Function ? T.LeftParenthesis : type);
        }
        if ([T.RightCurlyBracket, T.RightSquareBracket, T.RightParenthesis].includes(type)
            && brackets.pop() !== type - 1) unsupported();
        if ([T.BadString, T.BadUrl].includes(type)
            || (type === T.String && source[end - 1] !== source[start])
            || (type === T.Url && source[end - 1] !== ')')
            || (type === T.Comment && !source.slice(start, end).endsWith('*/'))) unsupported();
    });
    if (brackets.length) unsupported();
    const tree = parse(source, {
        context,
        positions: true,
        parseCustomProperty: true,
        onParseError: unsupported,
    });
    walk(tree, function(node) {
        const fontSource = cssName(this.atrule?.name) === 'font-face' && cssName(this.declaration?.property) === 'src';
        if (fontSource && (node.type === 'Raw' || (node.type === 'Function' && !['local', 'format'].includes(cssName(node.name))))) unsupported();
        if (node.type !== 'Url') return;
        const resolved = reference(name, node.value);
        if (resolved?.name !== entryName) return;
        if (!fontSource || resolved.suffix || this.declaration.value.type !== 'Value') unsupported();
        const values = this.declaration.value.children.toArray();
        const index = values.indexOf(node);
        if (index < 0) unsupported();
        const after = [];
        for (let next = index + 1; next < values.length; next++) {
            if (values[next].type === 'Operator' && values[next].value === ',') break;
            after.push(values[next]);
        }
        if (!after.length) {
            edits.push({ start: node.loc.end.offset, end: node.loc.end.offset, value: ' format("woff")' });
            return;
        }
        if (after.length !== 1 || after[0].type !== 'Function' || cssName(after[0].name) !== 'format') unsupported();
        const args = after[0].children.toArray();
        const format = args.length === 1 ? args[0].type === 'String' ? args[0].value.toLowerCase()
            : args[0].type === 'Identifier' ? cssName(args[0].name) : '' : '';
        if (!['truetype', 'opentype', 'woff'].includes(format)) unsupported();
        if (format !== 'woff') edits.push({ start: after[0].loc.start.offset, end: after[0].loc.end.offset, value: 'format("woff")' });
    });
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
    }
    return source;
}

function rewriteXml(source, name, entryName) {
    if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) unsupported();
    const document = new DOMParser({ onError: unsupported }).parseFromString(source, 'application/xml');
    let changed = false;
    const nodes = Array.from(document.getElementsByTagName('*'));
    for (const node of nodes) {
        const tag = (node.localName || '').toLowerCase();
        if (tag === 'script' || tag === 'base' || node.hasAttribute('xml:base')) unsupported();
        for (const attribute of Array.from(node.attributes || [])) {
            const attributeName = attribute.name.toLowerCase();
            if (/^on[a-z]+/.test(attributeName)) unsupported();
            if (attributeName === 'style') {
                const updated = rewriteCss(attribute.value, name, entryName, 'declarationList');
                if (updated !== attribute.value) { node.setAttribute(attribute.name, updated); changed = true; }
                continue;
            }
            if (['href', 'src', 'xlink:href', 'data'].includes(attributeName)) {
                if (/^\s*javascript:/i.test(attribute.value)) unsupported();
                const resolved = reference(name, attribute.value);
                if (resolved?.name !== entryName) continue;
                if (resolved.suffix || tag !== 'link' || !/\bpreload\b/i.test(node.getAttribute('rel') || '')
                    || (node.getAttribute('as') || '').toLowerCase() !== 'font') unsupported();
                node.setAttribute('type', 'font/woff');
                changed = true;
            }
        }
        if (tag === 'style') {
            const type = node.getAttribute('type');
            if (type && type.toLowerCase() !== 'text/css') unsupported();
            const updated = rewriteCss(node.textContent, name, entryName);
            if (updated !== node.textContent) { node.textContent = updated; changed = true; }
        }
    }
    return changed ? new XMLSerializer().serializeToString(document) : source;
}

export function inspectFontReferences({ entryName, textResources = [] }) {
    const updates = [];
    try {
        if (typeof entryName !== 'string' || !entryName) unsupported();
        for (const resource of textResources) {
            const mediaType = String(resource.mediaType || '').toLowerCase().split(';')[0];
            if (/javascript|ecmascript/.test(mediaType) || /\.(?:js|mjs)$/i.test(resource.name)) unsupported();
            const css = mediaType === 'text/css' || /\.css$/i.test(resource.name);
            const xml = XML_TYPES.has(mediaType) || /\.(?:xhtml|html|htm|svg)$/i.test(resource.name);
            if (!css && !xml) continue;
            const buffer = Buffer.isBuffer(resource.data) ? resource.data : Buffer.from(resource.data || '');
            if (buffer.length > MAX_TEXT_SIZE) unsupported();
            const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            const encoding = source.match(/^\s*<\?xml\b[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]
                || source.match(/^\s*@charset\s+["']([^"']+)["']/i)?.[1];
            if (encoding && !/^(utf-8|us-ascii)$/i.test(encoding)) unsupported();
            const updated = css ? rewriteCss(source, resource.name, entryName) : rewriteXml(source, resource.name, entryName);
            if (updated !== source) updates.push({ name: resource.name, data: Buffer.from(updated, 'utf8') });
        }
        return { canConvert: true, reason: null, updates };
    } catch {
        return { canConvert: false, reason: 'FONT_REFERENCES_UNSUPPORTED', updates: [] };
    }
}
