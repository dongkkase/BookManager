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
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.svg']);
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
const MAX_EPUB_STYLESHEET_BYTES = 1024 * 1024;
const MAX_VIEWER_SESSIONS = 16;
const EPUB_CSS_PROPERTY_TO_REACT_STYLE = new Map([
    ['color', 'color'],
    ['background-color', 'backgroundColor'],
    ['box-sizing', 'boxSizing'],
    ['clear', 'clear'],
    ['display', 'display'],
    ['float', 'float'],
    ['font', 'font'],
    ['font-family', 'fontFamily'],
    ['font-size', 'fontSize'],
    ['font-style', 'fontStyle'],
    ['font-variant', 'fontVariant'],
    ['font-weight', 'fontWeight'],
    ['height', 'height'],
    ['letter-spacing', 'letterSpacing'],
    ['line-height', 'lineHeight'],
    ['margin', 'margin'],
    ['margin-bottom', 'marginBottom'],
    ['margin-left', 'marginLeft'],
    ['margin-right', 'marginRight'],
    ['margin-top', 'marginTop'],
    ['padding', 'padding'],
    ['padding-bottom', 'paddingBottom'],
    ['padding-left', 'paddingLeft'],
    ['padding-right', 'paddingRight'],
    ['padding-top', 'paddingTop'],
    ['max-height', 'maxHeight'],
    ['max-width', 'maxWidth'],
    ['min-height', 'minHeight'],
    ['min-width', 'minWidth'],
    ['object-fit', 'objectFit'],
    ['overflow', 'overflow'],
    ['text-align', 'textAlign'],
    ['text-align-last', 'textAlignLast'],
    ['text-decoration', 'textDecoration'],
    ['text-indent', 'textIndent'],
    ['vertical-align', 'verticalAlign'],
    ['white-space', 'whiteSpace'],
    ['width', 'width'],
]);
const EPUB_VIEWER_CONTROLLED_CSS_PROPERTIES = new Set([
    'background',
    'background-color',
    'color',
    'direction',
    'letter-spacing',
    'line-height',
    'text-orientation',
    'white-space',
    'word-break',
    'overflow-wrap',
    'writing-mode',
]);
const EPUB_CSS_UNSAFE_VALUE_PATTERN = /url\s*\(|expression\s*\(|javascript\s*:|@import|-moz-binding|behavior\s*:/i;
const EPUB_CSS_LENGTH_PATTERN = /^-?(?:\d+|\d*\.\d+)(?:px|em|rem|%|pt|pc|cm|mm|in|vh|vw|vmin|vmax)?$/i;
const EPUB_CSS_SELECTOR_UNSAFE_PATTERN = /[{};]|\b(?:script|iframe|object|embed|link|meta)\b/i;
const EPUB_CSS_FONT_SIZE_KEYWORDS = new Set([
    'xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large',
    'smaller', 'larger',
]);
const EPUB_ALLOWED_HTML_TAGS = new Set([
    'a', 'abbr', 'article', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'div',
    'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
    'i', 'img', 'li', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'section', 'small',
    'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
    'u', 'ul',
]);
const EPUB_BLOCK_HTML_TAGS = new Set([
    'article', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);
const EPUB_VOID_HTML_TAGS = new Set(['br', 'hr', 'img']);

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
    if (extension === '.svg') return 'image/svg+xml';
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

function epubAssetProtocolUrl(session, entryName) {
    const assetPath = normalizeInnerPath(entryName)
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
    return `bookmanager-document://session/${encodeURIComponent(session.id)}/asset/${assetPath}`;
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
        .replace(/<br\b[^>]*\/?>/gi, '\n')
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

function decodeXmlEntities(value = '') {
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
        .replace(/&nbsp;/g, '\u00a0')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function htmlFragmentText(value = '') {
    return decodeXmlEntities(stripHtmlToText(value)).replace(/\s+/g, ' ').trim();
}

function tagAttributes(tag = '') {
    const attrs = {};
    String(tag || '').replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (_match, name, doubleQuoted, singleQuoted, unquoted) => {
        attrs[String(name || '').toLowerCase()] = decodeXmlEntities(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
        return _match;
    });
    return attrs;
}

function sanitizeEpubClassName(value = '') {
    const classNames = String(value || '')
        .split(/\s+/)
        .map(name => name.trim())
        .filter(name => /^[\p{L}\p{N}_:-][\p{L}\p{N}_:.-]{0,127}$/u.test(name));
    return Array.from(new Set(classNames)).slice(0, 32).join(' ');
}

function normalizeCssValue(value = '') {
    return String(value || '').replace(/\s*!important\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function sanitizeCssLengthValue(value = '', options = {}) {
    const normalized = normalizeCssValue(value);
    if (options.allowAuto && /^auto$/i.test(normalized)) return 'auto';
    if (EPUB_CSS_LENGTH_PATTERN.test(normalized)) return normalized;
    return '';
}

function sanitizeCssBoxValue(value = '', options = {}) {
    const values = normalizeCssValue(value).split(/\s+/).filter(Boolean);
    if (values.length < 1 || values.length > 4) return '';
    const safeValues = values.map(part => sanitizeCssLengthValue(part, options));
    if (safeValues.some(part => !part)) return '';
    return safeValues.join(' ');
}

function sanitizeCssColorValue(value = '') {
    const normalized = normalizeCssValue(value);
    if (/^#[0-9a-f]{3,8}$/i.test(normalized)) return normalized;
    if (/^(?:rgb|hsl)a?\(\s*[-\d.]+%?(?:\s*,\s*[-\d.]+%?){2,3}\s*\)$/i.test(normalized)) {
        return normalized;
    }
    if (/^[a-z][a-z-]*$/i.test(normalized)) return normalized.toLowerCase();
    return '';
}

function sanitizeCssFontSizeValue(value = '') {
    const normalized = normalizeCssValue(value).toLowerCase();
    if (!normalized) return '';
    if (EPUB_CSS_FONT_SIZE_KEYWORDS.has(normalized)) return normalized;
    return sanitizeCssLengthValue(normalized);
}

function sanitizeCssFontValue(value = '') {
    const normalized = normalizeCssValue(value);
    if (!normalized || EPUB_CSS_UNSAFE_VALUE_PATTERN.test(normalized)) return '';
    if (/[<>{};]/u.test(normalized) || normalized.length > 220) return '';
    const hasSizeToken = normalized.split(/\s+/).some(token => {
        const sizeToken = token.split('/')[0].toLowerCase();
        return Boolean(sanitizeCssFontSizeValue(sizeToken));
    });
    return hasSizeToken ? normalized : '';
}

function sanitizeEpubCssValue(property = '', value = '') {
    const normalized = normalizeCssValue(value);
    if (!normalized || EPUB_CSS_UNSAFE_VALUE_PATTERN.test(normalized)) return '';
    switch (property) {
        case 'color':
        case 'background-color':
            return sanitizeCssColorValue(normalized);
        case 'font':
            return sanitizeCssFontValue(normalized);
        case 'font-family':
            return /^[^<>{};]{1,160}$/u.test(normalized) ? normalized : '';
        case 'font-size':
            return sanitizeCssFontSizeValue(normalized);
        case 'letter-spacing':
        case 'width':
        case 'max-width':
        case 'min-width':
        case 'height':
        case 'max-height':
        case 'min-height':
        case 'text-indent':
            return sanitizeCssLengthValue(normalized);
        case 'box-sizing':
            return /^(?:border-box|content-box)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'clear':
            return /^(?:none|left|right|both|inline-start|inline-end)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'display':
            return /^(?:none|block|inline|inline-block|flex|inline-flex|table|table-row|table-cell|list-item)$/i.test(normalized)
                ? normalized.toLowerCase()
                : '';
        case 'float':
            return /^(?:none|left|right|inline-start|inline-end)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'line-height':
            if (/^normal$/i.test(normalized)) return 'normal';
            if (/^(?:\d+|\d*\.\d+)$/.test(normalized)) return normalized;
            return sanitizeCssLengthValue(normalized);
        case 'margin':
            return sanitizeCssBoxValue(normalized, { allowAuto: true });
        case 'margin-top':
        case 'margin-right':
        case 'margin-bottom':
        case 'margin-left':
            return sanitizeCssLengthValue(normalized, { allowAuto: true });
        case 'padding':
            return sanitizeCssBoxValue(normalized);
        case 'padding-top':
        case 'padding-right':
        case 'padding-bottom':
        case 'padding-left':
            return sanitizeCssLengthValue(normalized);
        case 'object-fit':
            return /^(?:fill|contain|cover|none|scale-down)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'overflow':
            return /^(?:visible|hidden|clip|scroll|auto)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'font-style':
            return /^(?:normal|italic|oblique)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'font-variant':
            return /^(?:normal|small-caps)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'font-weight':
            return /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'text-align':
        case 'text-align-last':
            return /^(?:left|right|center|justify|start|end)$/i.test(normalized) ? normalized.toLowerCase() : '';
        case 'text-decoration':
            return /^(?:none|underline|overline|line-through)(?:\s+(?:underline|overline|line-through))*$/i.test(normalized)
                ? normalized.toLowerCase()
                : '';
        case 'vertical-align':
            if (/^(?:baseline|sub|super|text-top|text-bottom|top|bottom|middle)$/i.test(normalized)) {
                return normalized.toLowerCase();
            }
            return sanitizeCssLengthValue(normalized);
        case 'white-space':
            return /^(?:normal|pre|pre-wrap|pre-line|nowrap|break-spaces)$/i.test(normalized)
                ? normalized.toLowerCase()
                : '';
        default:
            return '';
    }
}

function sanitizeEpubCssDeclarationBlock(cssText = '') {
    const style = {};
    for (const rawDeclaration of String(cssText || '').split(';')) {
        const separatorIndex = rawDeclaration.indexOf(':');
        if (separatorIndex <= 0) continue;
        const property = rawDeclaration.slice(0, separatorIndex).trim().toLowerCase();
        if (EPUB_VIEWER_CONTROLLED_CSS_PROPERTIES.has(property)) continue;
        const reactStyleName = EPUB_CSS_PROPERTY_TO_REACT_STYLE.get(property);
        if (!reactStyleName) continue;
        const safeValue = sanitizeEpubCssValue(property, rawDeclaration.slice(separatorIndex + 1));
        if (safeValue) style[reactStyleName] = safeValue;
    }
    return style;
}

function cssPropertyNameFromReactStyle(styleName = '') {
    if (styleName.startsWith('--')) return styleName;
    return styleName.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

function stripEpubCssAtRuleStatements(cssText = '') {
    return String(cssText || '').replace(/@(?:charset|import|namespace)\b[^;{}]*;/gi, '');
}

function extractEpubCssImports(cssText = '') {
    const imports = [];
    const css = String(cssText || '').replace(
        /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^"')\s;]+))\s*\)?[^;{}]*;/gi,
        (_match, doubleQuoted, singleQuoted, bare) => {
            const href = String(doubleQuoted || singleQuoted || bare || '').trim();
            if (href) imports.push(href);
            return '';
        },
    );
    return { css, imports };
}

function sanitizeEpubCssDeclarationBlockForStylesheet(cssText = '') {
    const declarations = [];
    for (const rawDeclaration of String(cssText || '').split(';')) {
        const separatorIndex = rawDeclaration.indexOf(':');
        if (separatorIndex <= 0) continue;
        const property = rawDeclaration.slice(0, separatorIndex).trim().toLowerCase();
        const rawValue = rawDeclaration.slice(separatorIndex + 1);
        if (EPUB_VIEWER_CONTROLLED_CSS_PROPERTIES.has(property)) continue;
        const reactStyleName = EPUB_CSS_PROPERTY_TO_REACT_STYLE.get(property);
        if (!reactStyleName) continue;
        const safeValue = sanitizeEpubCssValue(property, rawValue);
        if (safeValue) declarations.push(`${cssPropertyNameFromReactStyle(reactStyleName)}: ${safeValue}`);
    }
    return declarations;
}

function sanitizeEpubCssSelectorForViewer(selector = '') {
    let normalized = String(selector || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized.startsWith('@') || EPUB_CSS_SELECTOR_UNSAFE_PATTERN.test(normalized)) return '';
    normalized = normalized
        .replace(/\b(?:html|body)(?=[\s.#:[>+~,]|$)/gi, '')
        .replace(/^\s*[>+~]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized === ',' || normalized === '>') normalized = '*';
    return `.viewer-reader-scope ${normalized}`;
}

function sanitizeEpubCssForViewer(cssText = '') {
    const rules = [];
    const source = stripEpubCssAtRuleStatements(cssText)
        .replace(/<\/style/gi, '<\\/style')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of source.matchAll(rulePattern)) {
        const selectorText = String(match[1] || '').trim();
        if (!selectorText || selectorText.startsWith('@')) continue;
        const selectors = selectorText.split(',')
            .map(sanitizeEpubCssSelectorForViewer)
            .filter(Boolean);
        if (selectors.length < 1) continue;
        const declarations = sanitizeEpubCssDeclarationBlockForStylesheet(match[2]);
        if (declarations.length < 1) continue;
        rules.push(`${selectors.join(', ')} { ${declarations.join('; ')}; }`);
    }
    return rules.join('\n');
}

function parseEpubCssRules(cssText = '') {
    const rules = [];
    const source = stripEpubCssAtRuleStatements(cssText).replace(/\/\*[\s\S]*?\*\//g, '');
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of source.matchAll(rulePattern)) {
        const selectorText = String(match[1] || '').trim();
        if (!selectorText || selectorText.startsWith('@')) continue;
        const style = sanitizeEpubCssDeclarationBlock(match[2]);
        if (Object.keys(style).length === 0) continue;
        const selectors = selectorText.split(',')
            .map(selector => selector.trim())
            .filter(selector => selector && !selector.startsWith('@'));
        if (selectors.length > 0) rules.push({ selectors, style });
    }
    return rules;
}

function selectorMatchesEpubElement(selector = '', tagName = '', className = '') {
    const normalizedTagName = String(tagName || '').toLowerCase();
    const classNames = new Set(String(className || '').split(/\s+/).filter(Boolean));
    const selectorParts = String(selector || '').trim().split(/\s+|>|\+|~/).filter(Boolean);
    let selectorPart = selectorParts[selectorParts.length - 1] || '';
    selectorPart = selectorPart
        .replace(/::?[\w-]+(?:\([^)]*\))?/g, '')
        .replace(/#[^\s.#:>+~]+/g, '');
    if (!selectorPart || selectorPart === '*') return selectorPart === '*';

    const tagMatch = selectorPart.match(/^([a-z][\w-]*)/i);
    if (tagMatch && tagMatch[1].toLowerCase() !== normalizedTagName) return false;
    const selectorClasses = Array.from(selectorPart.matchAll(/\.([^\s.#:>+~]+)/g)).map(match => match[1]);
    if (!tagMatch && selectorClasses.length === 0) return false;
    return selectorClasses.every(name => classNames.has(name));
}

function epubStyleForElement(tagName = '', attrs = {}, cssRules = []) {
    const style = {};
    const className = sanitizeEpubClassName(attrs.class || '');
    for (const rule of cssRules) {
        if (rule.selectors.some(selector => selectorMatchesEpubElement(selector, tagName, className))) {
            Object.assign(style, rule.style);
        }
    }
    Object.assign(style, sanitizeEpubCssDeclarationBlock(attrs.style || ''));
    return Object.keys(style).length > 0 ? style : undefined;
}

function normalizeEpubTagName(tagName = '') {
    const normalized = String(tagName || '').toLowerCase().replace(/^[\w-]+:/, '');
    return normalized === 'image' ? 'img' : normalized;
}

function epubBodyHtmlFromDocument(html = '') {
    const source = String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<link\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*>/gi, '');
    const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch?.[1] || source;
}

function normalizeEpubTextNode(value = '') {
    const decoded = decodeXmlEntities(value);
    if (/\u00a0/.test(decoded) && !decoded.replace(/[\s\u00a0]+/g, '')) return '\u00a0';
    const text = decoded.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    return text.trim() ? text : '';
}

function textFromEpubNodes(nodes = []) {
    const text = nodes.map(node => {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (node.tagName === 'br') return '\n';
        if (node.tagName === 'img') return '';
        return textFromEpubNodes(node.children || []);
    }).join('').replace(/[ \t\r\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    if (/\u00a0/.test(text) && !text.replace(/[\s\u00a0]+/g, '')) return '\u00a0';
    return text.trim();
}

function epubNodesContainImage(nodes = []) {
    return nodes.some(node => {
        if (!node) return false;
        if (node.tagName === 'img') return true;
        return epubNodesContainImage(node.children || []);
    });
}

function parseSafeEpubHtmlNodes(fragment = '', entryName = '', session, entries = [], cssRules = [], imageEntryNames = []) {
    const root = { tagName: 'root', children: [] };
    const stack = [root];
    const tokenPattern = /<\/?[\w:-]+(?:\s+[^<>]*)?\s*\/?>|[^<]+/g;

    for (const match of String(fragment || '').matchAll(tokenPattern)) {
        const token = match[0];
        const currentParent = stack[stack.length - 1];
        if (!token.startsWith('<')) {
            const text = normalizeEpubTextNode(token);
            if (text) currentParent.children.push({ type: 'text', text });
            continue;
        }

        const tagMatch = token.match(/^<\s*(\/)?\s*([\w:-]+)/i);
        if (!tagMatch) continue;
        const isClosingTag = Boolean(tagMatch[1]);
        const tagName = normalizeEpubTagName(tagMatch[2]);
        if (isClosingTag) {
            for (let index = stack.length - 1; index > 0; index -= 1) {
                if (stack[index].tagName === tagName) {
                    stack.length = index;
                    break;
                }
            }
            continue;
        }
        if (!EPUB_ALLOWED_HTML_TAGS.has(tagName)) continue;

        const attrs = tagAttributes(token);
        const style = epubStyleForElement(tagName, attrs, cssRules);
        const className = sanitizeEpubClassName(attrs.class || '');
        if (tagName === 'img') {
            const resolvedEntryName = resolveEpubHref(entryName, attrs.src || attrs.href || attrs['xlink:href'] || '');
            const imageEntry = findArchiveEntry(entries, resolvedEntryName);
            if (!imageEntry || !isImageEntry(imageEntry.name)) continue;
            imageEntryNames.push(imageEntry.name);
            currentParent.children.push({
                type: 'element',
                tagName,
                src: epubAssetProtocolUrl(session, imageEntry.name),
                alt: attrs.alt || path.posix.basename(imageEntry.name),
                name: imageEntry.name,
                style,
                className,
                children: [],
            });
            continue;
        }

        const node = {
            type: 'element',
            tagName,
            style,
            className,
            children: [],
        };
        currentParent.children.push(node);
        if (!EPUB_VOID_HTML_TAGS.has(tagName) && !/\/\s*>$/.test(token)) {
            stack.push(node);
        }
    }

    return root.children;
}

function epubBlocksFromNodes(nodes = []) {
    const blocks = [];
    let inlineNodes = [];

    const flushInlineNodes = () => {
        const text = textFromEpubNodes(inlineNodes);
        if (text || epubNodesContainImage(inlineNodes)) {
            blocks.push({
                type: 'html',
                text,
                nodes: inlineNodes,
                hasImage: epubNodesContainImage(inlineNodes),
            });
        }
        inlineNodes = [];
    };

    for (const node of nodes) {
        if (node?.tagName === 'img') {
            flushInlineNodes();
            blocks.push({
                type: 'image',
                src: node.src,
                alt: node.alt,
                name: node.name,
                style: node.style,
                className: node.className,
            });
            continue;
        }
        if (node?.type === 'element' && EPUB_BLOCK_HTML_TAGS.has(node.tagName)) {
            flushInlineNodes();
            const text = textFromEpubNodes([node]);
            const hasImage = epubNodesContainImage([node]);
            if (text || hasImage) {
                blocks.push({
                    type: 'html',
                    text,
                    tagName: node.tagName,
                    style: node.style,
                    className: node.className,
                    nodes: [node],
                    hasImage,
                });
            }
            continue;
        }
        inlineNodes.push(node);
    }

    flushInlineNodes();
    return blocks;
}

function extractEpubInlineCss(html = '') {
    return Array.from(String(html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
        .map(match => String(match[1] || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''))
        .join('\n');
}

function epubStylesheetEntryNamesFromHtml(html = '', entryName = '') {
    const stylesheetEntryNames = [];
    for (const match of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
        const attrs = tagAttributes(match[0]);
        const relValues = String(attrs.rel || '').toLowerCase().split(/\s+/);
        if (!relValues.includes('stylesheet') || !attrs.href) continue;
        const resolvedEntryName = resolveEpubHref(entryName, attrs.href);
        if (resolvedEntryName) stylesheetEntryNames.push(resolvedEntryName);
    }
    return stylesheetEntryNames;
}

async function readExpandedEpubStylesheet(stylesheetEntryName = '', filePath = '', entries = [], stylesheetCache = new Map(), importStack = new Set()) {
    const stylesheetEntry = findArchiveEntry(entries, stylesheetEntryName);
    if (!stylesheetEntry || stylesheetEntry.isDir) return '';
    const normalizedKey = normalizeInnerPath(stylesheetEntry.name).toLowerCase();
    const cacheKey = `expanded:${normalizedKey}`;
    if (stylesheetCache.has(cacheKey)) return stylesheetCache.get(cacheKey);
    if (importStack.has(normalizedKey) || importStack.size >= 12) return '';

    importStack.add(normalizedKey);
    try {
        let rawCss = '';
        try {
            const cssBuffer = await extractArchiveEntry(filePath, stylesheetEntry.name, '', {
                maxBytes: MAX_EPUB_STYLESHEET_BYTES,
            });
            rawCss = cssBuffer.toString('utf8');
        } catch {
            stylesheetCache.set(cacheKey, '');
            return '';
        }

        const { css, imports } = extractEpubCssImports(rawCss);
        const importedCssParts = [];
        for (const href of imports.slice(0, 32)) {
            const importedEntryName = resolveEpubHref(stylesheetEntry.name, href);
            if (!importedEntryName) continue;
            const importedCss = await readExpandedEpubStylesheet(importedEntryName, filePath, entries, stylesheetCache, importStack);
            if (importedCss) importedCssParts.push(importedCss);
        }
        const expandedCss = [...importedCssParts, css].filter(Boolean).join('\n');
        stylesheetCache.set(cacheKey, expandedCss);
        return expandedCss;
    } finally {
        importStack.delete(normalizedKey);
    }
}

async function readEpubCssRulesForHtml(html = '', entryName = '', filePath = '', entries = [], stylesheetCache = new Map()) {
    const cssParts = [];
    for (const stylesheetEntryName of epubStylesheetEntryNamesFromHtml(html, entryName)) {
        const cssText = await readExpandedEpubStylesheet(stylesheetEntryName, filePath, entries, stylesheetCache);
        if (cssText) cssParts.push(cssText);
    }
    const inlineCss = extractEpubInlineCss(html);
    if (inlineCss) cssParts.push(inlineCss);
    const cssText = cssParts.join('\n');
    return {
        rules: parseEpubCssRules(cssText),
        stylesheet: sanitizeEpubCssForViewer(cssText),
    };
}

function xmlStartTags(xml = '', tagName = '') {
    const matches = [];
    const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>`, 'gi');
    for (const match of String(xml || '').matchAll(pattern)) {
        matches.push(match[0]);
    }
    return matches;
}

function resolveEpubHref(baseEntryName = '', href = '') {
    const trimmedHref = String(href || '').trim();
    if (!trimmedHref || /^[a-z]+:/i.test(trimmedHref)) return '';
    const cleanHref = decodeXmlEntities(trimmedHref).split('#')[0].split('?')[0];
    if (!cleanHref) return '';
    if (cleanHref.startsWith('/')) return normalizeInnerPath(cleanHref);
    const baseDir = path.posix.dirname(normalizeInnerPath(baseEntryName));
    return normalizeInnerPath(path.posix.normalize(path.posix.join(baseDir, cleanHref)));
}

function findArchiveEntry(entries = [], entryName = '') {
    const normalizedEntryName = normalizeInnerPath(entryName).toLowerCase();
    return entries.find(entry => normalizeInnerPath(entry.name).toLowerCase() === normalizedEntryName) || null;
}

function parseHtmlTitle(html = '') {
    const value = String(html || '');
    const titleMatch = value.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
        || value.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
        || value.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    return htmlFragmentText(titleMatch?.[1] || '');
}

function parseEpubMetadata(opfXml = '') {
    const source = String(opfXml || '');
    const titleMatch = source.match(/<(?:\w+:)?title\b[^>]*>([\s\S]*?)<\/(?:\w+:)?title>/i);
    const creators = Array.from(source.matchAll(/<(?:\w+:)?creator\b[^>]*>([\s\S]*?)<\/(?:\w+:)?creator>/gi))
        .map(match => htmlFragmentText(match[1]))
        .filter(Boolean);
    return {
        title: htmlFragmentText(titleMatch?.[1] || ''),
        author: creators.join(', '),
    };
}

function parseEpubManifest(opfXml = '', opfPath = '') {
    const manifest = new Map();
    for (const tag of xmlStartTags(opfXml, 'item')) {
        const attrs = tagAttributes(tag);
        if (!attrs.id || !attrs.href) continue;
        manifest.set(attrs.id, {
            ...attrs,
            entryName: resolveEpubHref(opfPath, attrs.href),
        });
    }
    return manifest;
}

function parseEpubSpine(opfXml = '') {
    return xmlStartTags(opfXml, 'itemref')
        .map(tag => tagAttributes(tag).idref)
        .filter(Boolean);
}

function parseEpubNavEntries(html = '', navEntryName = '') {
    const entries = [];
    const seen = new Set();
    const linkPattern = /<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of String(html || '').matchAll(linkPattern)) {
        const entryName = resolveEpubHref(navEntryName, match[2]);
        const title = htmlFragmentText(match[3]);
        const key = entryName.toLowerCase();
        if (entryName && title && !seen.has(key)) {
            seen.add(key);
            entries.push({ entryName, title });
        }
    }
    return entries;
}

function parseEpubNavTitles(html = '', navEntryName = '') {
    return new Map(parseEpubNavEntries(html, navEntryName)
        .map(entry => [entry.entryName.toLowerCase(), entry.title]));
}

function parseEpubNcxEntries(xml = '', ncxEntryName = '') {
    const entries = [];
    const seen = new Set();
    const navPointPattern = /<navPoint\b[\s\S]*?<\/navPoint>/gi;
    for (const navPointMatch of String(xml || '').matchAll(navPointPattern)) {
        const navPoint = navPointMatch[0];
        const contentMatch = navPoint.match(/<content\b[^>]*src\s*=\s*(["'])([\s\S]*?)\1/i);
        const titleMatch = navPoint.match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
        const entryName = resolveEpubHref(ncxEntryName, contentMatch?.[2] || '');
        const title = htmlFragmentText(titleMatch?.[1] || '');
        const key = entryName.toLowerCase();
        if (entryName && title && !seen.has(key)) {
            seen.add(key);
            entries.push({ entryName, title });
        }
    }
    return entries;
}

function parseEpubNcxTitles(xml = '', ncxEntryName = '') {
    return new Map(parseEpubNcxEntries(xml, ncxEntryName)
        .map(entry => [entry.entryName.toLowerCase(), entry.title]));
}

function findEpubCoverManifestItem(manifest) {
    const manifestItems = Array.from(manifest.values());
    const coverMetaItem = manifestItems.find(item => String(item.properties || '').split(/\s+/).includes('cover-image'));
    return coverMetaItem
        || manifestItems.find(item => /^cover(?:[-_]?image)?$/i.test(item.id || '') && isImageEntry(item.entryName))
        || manifestItems.find(item => /(^|[/_-])cover[^/]*\.(jpe?g|png|webp|gif|bmp)$/i.test(item.entryName || ''))
        || null;
}

function findEpubCoverMetaId(opfXml = '') {
    const coverMeta = xmlStartTags(opfXml, 'meta')
        .map(tag => tagAttributes(tag))
        .find(attrs => String(attrs.name || '').toLowerCase() === 'cover' && attrs.content);
    return coverMeta?.content || '';
}

function epubReaderBlocksFromHtml(html = '', entryName = '', session, entries = [], cssRules = []) {
    const imageEntryNames = [];
    const bodyHtml = epubBodyHtmlFromDocument(html);
    const nodes = parseSafeEpubHtmlNodes(bodyHtml, entryName, session, entries, cssRules, imageEntryNames);
    const blocks = epubBlocksFromNodes(nodes);
    const fallbackText = blocks.length > 0 ? '' : stripHtmlToText(bodyHtml);
    return {
        blocks: blocks.length > 0 ? blocks : (fallbackText ? [{ type: 'text', text: fallbackText }] : []),
        imageEntryNames,
    };
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
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts[1] === 'asset') return null;
        const sessionId = decodeURIComponent(pathParts[0] || '');
        const session = this.sessions.get(sessionId);
        if (!session || (session.type !== 'pdf' && session.type !== 'epub')) return null;
        return {
            filePath: session.filePath,
            mime: documentMime(session.filePath),
        };
    }

    async getDocumentAssetFromRequest(requestUrl = '') {
        let url = null;
        try {
            url = new URL(requestUrl);
        } catch {
            return null;
        }
        if (url.protocol !== 'bookmanager-document:' || url.hostname !== 'session') return null;
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts[1] !== 'asset') return null;
        const sessionId = decodeURIComponent(pathParts[0] || '');
        const entryName = decodeURIComponent(pathParts.slice(2).join('/') || '');
        const session = this.sessions.get(sessionId);
        if (!session || session.type !== 'epub' || !entryName || !isImageEntry(entryName)) return null;
        const buffer = await extractArchiveEntry(session.filePath, entryName, '', {
            maxBytes: 32 * 1024 * 1024,
        });
        return {
            name: entryName,
            mime: imageMime(entryName),
            buffer,
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
        const containerEntry = findArchiveEntry(entries, 'META-INF/container.xml');
        let opfPath = '';
        let opfXml = '';
        if (containerEntry) {
            const containerBuffer = await extractArchiveEntry(session.filePath, containerEntry.name, '', {
                maxBytes: 1024 * 1024,
            });
            opfPath = decodeXmlEntities(
                containerBuffer.toString('utf8').match(/full-path\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '',
            );
        }
        const opfEntry = findArchiveEntry(entries, opfPath)
            || entries.find(entry => !entry.isDir && /\.opf$/i.test(entry.name));
        if (opfEntry) {
            opfPath = opfEntry.name;
            const opfBuffer = await extractArchiveEntry(session.filePath, opfEntry.name, '', {
                maxBytes: 4 * 1024 * 1024,
            });
            opfXml = opfBuffer.toString('utf8');
        }
        const metadata = parseEpubMetadata(opfXml);
        const manifest = parseEpubManifest(opfXml, opfPath);
        const spineEntryNames = parseEpubSpine(opfXml)
            .map(idref => manifest.get(idref)?.entryName)
            .filter(Boolean);
        const htmlEntries = entries
            .filter(entry => !entry.isDir && /\.(xhtml|html|htm)$/i.test(entry.name));
        const chapterEntryNames = spineEntryNames.length > 0
            ? spineEntryNames
            : htmlEntries
                .filter(entry => !/(^|\/)(nav|toc)\.(xhtml|html|htm)$/i.test(entry.name))
                .sort((left, right) => naturalCompare(left.name, right.name))
                .map(entry => entry.name);
        const manifestItems = Array.from(manifest.values());
        const navItem = manifestItems.find(item => String(item.properties || '').split(/\s+/).includes('nav'))
            || manifestItems.find(item => /(^|\/)(nav|toc)\.(xhtml|html|htm)$/i.test(item.entryName || ''));
        const ncxItem = manifestItems.find(item => /application\/x-dtbncx\+xml/i.test(item['media-type'] || ''))
            || manifestItems.find(item => /\.ncx$/i.test(item.entryName || ''));
        const tocTitleByEntryName = new Map();
        const tocEntries = [];
        const appendTocEntries = entriesToAppend => {
            const seen = new Set(tocEntries.map(entry => normalizeInnerPath(entry.entryName).toLowerCase()));
            for (const entry of entriesToAppend) {
                const key = normalizeInnerPath(entry.entryName).toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                tocEntries.push(entry);
            }
        };
        if (navItem?.entryName) {
            const navEntry = findArchiveEntry(entries, navItem.entryName);
            if (navEntry) {
                const navBuffer = await extractArchiveEntry(session.filePath, navEntry.name, '', {
                    maxBytes: 2 * 1024 * 1024,
                });
                appendTocEntries(parseEpubNavEntries(navBuffer.toString('utf8'), navEntry.name));
                for (const [entryName, title] of parseEpubNavTitles(navBuffer.toString('utf8'), navEntry.name)) {
                    tocTitleByEntryName.set(entryName, title);
                }
            }
        }
        if (ncxItem?.entryName) {
            const ncxEntry = findArchiveEntry(entries, ncxItem.entryName);
            if (ncxEntry) {
                const ncxBuffer = await extractArchiveEntry(session.filePath, ncxEntry.name, '', {
                    maxBytes: 2 * 1024 * 1024,
                });
                appendTocEntries(parseEpubNcxEntries(ncxBuffer.toString('utf8'), ncxEntry.name));
                for (const [entryName, title] of parseEpubNcxTitles(ncxBuffer.toString('utf8'), ncxEntry.name)) {
                    if (!tocTitleByEntryName.has(entryName)) tocTitleByEntryName.set(entryName, title);
                }
            }
        }
        const chapters = chapterEntryNames
            .map(entryName => findArchiveEntry(entries, entryName))
            .filter(Boolean)
            .slice(0, 200);
        const results = [];
        const referencedImageNames = new Set();
        const stylesheetCache = new Map();
        const stylesheetTexts = new Set();
        for (const entry of chapters) {
            const buffer = await extractArchiveEntry(session.filePath, entry.name, '', {
                maxBytes: MAX_EPUB_CHAPTER_BYTES,
            });
            const html = buffer.toString('utf8');
            const css = await readEpubCssRulesForHtml(html, entry.name, session.filePath, entries, stylesheetCache);
            if (css.stylesheet) stylesheetTexts.add(css.stylesheet);
            const { blocks, imageEntryNames } = epubReaderBlocksFromHtml(html, entry.name, session, entries, css.rules);
            for (const imageEntryName of imageEntryNames) {
                referencedImageNames.add(normalizeInnerPath(imageEntryName).toLowerCase());
            }
            const text = blocks
                .filter(block => block.type === 'text' || block.type === 'html')
                .map(block => block.text)
                .join('\n\n')
                .trim();
            if (!text && !blocks.some(block => block.type === 'image' || block.hasImage)) continue;
            const tocTitle = tocTitleByEntryName.get(normalizeInnerPath(entry.name).toLowerCase());
            results.push({
                name: entry.name,
                title: tocTitle || parseHtmlTitle(html) || path.posix.basename(entry.name),
                text,
                blocks,
            });
        }
        const coverMetaId = findEpubCoverMetaId(opfXml);
        const coverItem = (coverMetaId && manifest.get(coverMetaId)) || findEpubCoverManifestItem(manifest);
        const coverEntry = coverItem?.entryName ? findArchiveEntry(entries, coverItem.entryName) : null;
        if (coverEntry && isImageEntry(coverEntry.name) && !referencedImageNames.has(normalizeInnerPath(coverEntry.name).toLowerCase())) {
            results.unshift({
                name: coverEntry.name,
                title: '표지',
                text: '',
                blocks: [{
                    type: 'image',
                    src: epubAssetProtocolUrl(session, coverEntry.name),
                    alt: path.posix.basename(coverEntry.name),
                    name: coverEntry.name,
                }],
            });
        }
        const normalizedChapters = results.map((chapter, index) => ({
            ...chapter,
            chapterIndex: index,
        }));
        const chapterIndexByEntryName = new Map(normalizedChapters
            .map((chapter, index) => [normalizeInnerPath(chapter.name).toLowerCase(), index]));
        const toc = tocEntries
            .map((entry, index) => ({
                id: `epub-toc-${index}`,
                title: entry.title,
                entryName: entry.entryName,
                chapterIndex: chapterIndexByEntryName.get(normalizeInnerPath(entry.entryName).toLowerCase()),
            }))
            .filter(entry => Number.isInteger(entry.chapterIndex));
        return {
            metadata,
            stylesheet: Array.from(stylesheetTexts).join('\n'),
            toc: toc.length > 0
                ? toc
                : normalizedChapters.map((chapter, index) => ({
                    id: `epub-chapter-${index}`,
                    title: chapter.title || chapter.name || `Page ${index + 1}`,
                    entryName: chapter.name,
                    chapterIndex: index,
                })),
            chapters: normalizedChapters,
        };
    }
}
