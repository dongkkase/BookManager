import { v4 as uuid } from 'uuid';
import { inspectCss, safeCss } from './css.js';
import { paragraphIndentCss, validIndentLevel, validFirstLineIndent } from './paragraphIndent.js';
import { BLOCK_STYLES, INLINE_STYLES, HIGHLIGHTS, authoringCss, parseMediaUrl } from './authoring.js';
import { normalizeParagraphFormat, paragraphFormatCss } from './paragraphFormats.js';

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'bmepub';
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 192 * 1024 * 1024;
export const STYLE_PRESETS = Object.freeze({
    literary: { font: 'serif', fontSize: 18, lineHeight: 1.9, paragraphGap: 0.8, indent: 0, color: '#282923', accent: '#58705b', background: '#fffdf8', headingScale: 1.7 },
    modern: { font: 'sans-serif', fontSize: 17, lineHeight: 1.75, paragraphGap: 1.1, indent: 0, color: '#263449', accent: '#4369a8', background: '#ffffff', headingScale: 1.9 },
    quiet: { font: 'serif', fontSize: 18, lineHeight: 2, paragraphGap: 1.2, indent: 0, color: '#453a39', accent: '#966754', background: '#fffaf4', headingScale: 1.6 },
});
const ID = /^[a-z][a-z0-9_-]{0,79}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const FONT = /^(serif|sans-serif|monospace|font-a_[a-z0-9_-]+)$/i;
const INLINE = ['text', 'hardBreak', 'footnote'];
const BLOCK = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule', 'image', 'audio', 'media', 'table', 'columns'];
const CHILDREN = {
    doc: BLOCK, paragraph: INLINE, heading: INLINE, blockquote: BLOCK,
    bulletList: ['listItem'], orderedList: ['listItem'], listItem: BLOCK,
    codeBlock: ['text'], table: ['tableRow'], tableRow: ['tableCell', 'tableHeader'],
    tableCell: BLOCK, tableHeader: BLOCK, columns: ['column'], column: BLOCK,
    text: [], hardBreak: [], horizontalRule: [], image: [], audio: [], media: [], footnote: [],
};
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle', 'inlineStyle', 'highlight', 'superscript', 'subscript']);
const ASSET_TYPES = {
    mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'],
    png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'],
    ttf: ['font', 'font/ttf'], otf: ['font', 'font/otf'], woff: ['font', 'font/woff'], woff2: ['font', 'font/woff2'],
};

export function projectError(code, detail = '') {
    return Object.assign(new Error(detail || code), { code });
}

export function newId(prefix = 'n') {
    return `${prefix}_${uuid()}`;
}

export function paragraph(text = '') {
    return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

export function createChapter(title = '') {
    return { id: newId('c'), title, inToc: true, tocTitle: '', css: '', content: { type: 'doc', content: [paragraph()] } };
}

export function createProject(template = 'blank', language = 'ko') {
    const locale = ['ko', 'en', 'ja'].includes(language) ? language : 'ko';
    const labels = {
        ko: ['제목 없는 책', '첫 번째 장', '프롤로그', '이야기의 시작', '에필로그', '들어가며', '핵심 개념', '실전 가이드'],
        en: ['Untitled book', 'First chapter', 'Prologue', 'The beginning', 'Epilogue', 'Introduction', 'Key concepts', 'Practical guide'],
        ja: ['無題の本', '最初の章', 'プロローグ', '物語の始まり', 'エピローグ', 'はじめに', '基本の考え方', '実践ガイド'],
    }[locale];
    const titles = template === 'essay' ? labels.slice(2, 5) : template === 'guide' ? labels.slice(5, 8) : [labels[1]];
    return {
        format: 'bookmanager-epub-project', version: PROJECT_VERSION, id: newId('p'), revision: 0,
        metadata: { title: labels[0], author: '', language: locale, publisher: '', date: '', description: '', rights: '', isbn: '', identifier: `urn:uuid:${uuid()}` },
        style: { ...STYLE_PRESETS[template === 'guide' ? 'modern' : 'literary'] },
        cover: { mode: 'design', assetId: '', background: '#253c34', color: '#f5f0df', subtitle: '' },
        commonCss: '', chapters: titles.map(createChapter), assets: [],
    };
}

function string(value, max = 2000) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) throw projectError('INVALID_PROJECT');
    return value;
}

function number(value, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) throw projectError('INVALID_PROJECT');
}

export function safeLink(href = '') {
    return typeof href === 'string' && !/[\u0000-\u001f\u007f]/.test(href) && /^(?:https?:\/\/[^\s<>"'\\]+|mailto:[^\s<>"'\\]+|epub:c_[a-z0-9_-]+(?:#[a-z][a-z0-9_-]*)?)$/i.test(href);
}

export function validateProject(project) {
    if (!project || project.format !== 'bookmanager-epub-project' || project.version !== PROJECT_VERSION) throw projectError('PROJECT_VERSION');
    if (!ID.test(project.id) || !Number.isSafeInteger(project.revision) || project.revision < 0) throw projectError('INVALID_PROJECT');
    if (new TextEncoder().encode(JSON.stringify(project)).length > MAX_DOCUMENT_BYTES) throw projectError('PROJECT_TOO_LARGE');
    for (const key of ['title', 'author', 'language', 'publisher', 'date', 'description', 'rights', 'isbn', 'identifier']) string(project.metadata?.[key], key === 'description' ? 20000 : 2000);
    if (!Array.isArray(project.chapters) || !project.chapters.length || project.chapters.length > 1000 || !Array.isArray(project.assets) || project.assets.length > 1000) throw projectError('INVALID_PROJECT');
    string(project.commonCss ?? '', 100000);
    const ids = new Set();
    let assetBytes = 0;
    for (const asset of project.assets) {
        if (!ID.test(asset.id) || !asset.id.startsWith('a_') || ids.has(asset.id) || !ASSET_TYPES[asset.extension] || ASSET_TYPES[asset.extension][0] !== asset.kind || ASSET_TYPES[asset.extension][1] !== asset.mime) throw projectError('INVALID_ASSET');
        ids.add(asset.id);
        string(asset.name);
        number(asset.size, 1, 20 * 1024 * 1024);
        if (!Number.isSafeInteger(asset.size)) throw projectError('INVALID_ASSET');
        assetBytes += asset.size;
    }
    if (assetBytes > MAX_PROJECT_BYTES) throw projectError('PROJECT_TOO_LARGE');
    const style = project.style || {};
    if (!FONT.test(style.font) || !COLOR.test(style.color) || !COLOR.test(style.accent) || !COLOR.test(style.background)) throw projectError('INVALID_PROJECT');
    for (const [key, min, max] of [['fontSize', 10, 32], ['lineHeight', 1, 3], ['paragraphGap', 0, 3], ['indent', 0, 3], ['headingScale', 1, 3]]) number(style[key], min, max);
    if (!['none', 'design', 'image'].includes(project.cover?.mode) || !COLOR.test(project.cover.background) || !COLOR.test(project.cover.color)) throw projectError('INVALID_PROJECT');
    string(project.cover.assetId, 80);
    string(project.cover.subtitle, 300);
    let nodes = 0;
    function visit(node, depth = 0) {
        if (++nodes > 1000000 || depth > 40 || !node || !Object.hasOwn(CHILDREN, node.type)) throw projectError('INVALID_DOCUMENT');
        if (node.type === 'text') {
            string(node.text, 2 * 1024 * 1024);
            if (!node.text.length) throw projectError('INVALID_DOCUMENT');
        }
        const attrs = node.attrs || {};
        if (attrs.id != null && !ID.test(attrs.id)) throw projectError('INVALID_DOCUMENT');
        if (attrs.indentLevel != null && (!['paragraph', 'heading'].includes(node.type) || !validIndentLevel(attrs.indentLevel))) throw projectError('INVALID_DOCUMENT');
        if (attrs.firstLineIndent != null && (!['paragraph', 'heading'].includes(node.type) || !validFirstLineIndent(attrs.firstLineIndent))) throw projectError('INVALID_DOCUMENT');
        if (attrs.textAlign != null && !['left', 'center', 'right', 'justify'].includes(attrs.textAlign)) throw projectError('INVALID_DOCUMENT');
        if (node.type === 'heading' && ![1, 2, 3, 4, 5, 6].includes(attrs.level)) throw projectError('INVALID_DOCUMENT');
        if (attrs.blockStyle != null && (!['paragraph', 'heading'].includes(node.type) || !Object.hasOwn(BLOCK_STYLES, attrs.blockStyle))) throw projectError('INVALID_DOCUMENT');
        if (attrs.paragraphFormat != null) {
            if (!['paragraph', 'heading'].includes(node.type)) throw projectError('INVALID_DOCUMENT');
            try { normalizeParagraphFormat(attrs.paragraphFormat, true); }
            catch { throw projectError('INVALID_DOCUMENT'); }
        }
        if (node.type === 'media') {
            if (!parseMediaUrl(attrs.url)) throw projectError('INVALID_LINK');
            string(attrs.title ?? '', 2000);
        }
        if (node.type === 'footnote') {
            if (!ID.test(attrs.id)) throw projectError('INVALID_DOCUMENT');
            string(attrs.text ?? '', 20000);
        }
        if (node.type === 'audio') {
            if (!ID.test(attrs.assetId)) throw projectError('INVALID_ASSET');
            string(attrs.title ?? '', 2000);
            if (!['effect', 'background'].includes(attrs.kind) || typeof attrs.loop !== 'boolean') throw projectError('INVALID_DOCUMENT');
        }
        if (node.type === 'image') {
            if (!ID.test(attrs.assetId)) throw projectError('INVALID_ASSET');
            string(attrs.alt || '');
            string(attrs.caption || '');
            number(attrs.width, 10, 100);
            if (!['left', 'center', 'right'].includes(attrs.align)) throw projectError('INVALID_DOCUMENT');
        }
        if (node.type === 'columns' && ![2, 3].includes(node.content?.length)) throw projectError('INVALID_DOCUMENT');
        if (node.type === 'listItem' && node.content?.[0]?.type !== 'paragraph') throw projectError('INVALID_DOCUMENT');
        if (node.type === 'orderedList') number(attrs.start ?? 1, 1, 100000);
        if (node.type === 'orderedList' && !Number.isInteger(attrs.start ?? 1)) throw projectError('INVALID_DOCUMENT');
        if (node.type === 'tableCell' || node.type === 'tableHeader') {
            if (attrs.backgroundColor != null && !COLOR.test(attrs.backgroundColor)) throw projectError('INVALID_DOCUMENT');
            if (attrs.verticalAlign != null && !['top', 'middle', 'bottom'].includes(attrs.verticalAlign)) throw projectError('INVALID_DOCUMENT');
            if (attrs.cellPadding != null) number(attrs.cellPadding, 0, 32);
            number(attrs.colspan ?? 1, 1, 100);
            number(attrs.rowspan ?? 1, 1, 100);
            if (![attrs.colspan ?? 1, attrs.rowspan ?? 1].every(Number.isInteger)) throw projectError('INVALID_DOCUMENT');
            if (attrs.colwidth != null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.some(width => !Number.isFinite(width) || width < 0 || width > 10000))) throw projectError('INVALID_DOCUMENT');
        }
        if (node.marks != null && !Array.isArray(node.marks)) throw projectError('INVALID_DOCUMENT');
        for (const mark of node.marks || []) {
            if (!MARKS.has(mark.type)) throw projectError('INVALID_DOCUMENT');
            const a = mark.attrs || {};
            if (mark.type === 'link' && !safeLink(a.href)) throw projectError('INVALID_LINK');
            if (mark.type === 'inlineStyle' && !Object.hasOwn(INLINE_STYLES, a.preset)) throw projectError('INVALID_DOCUMENT');
            if (mark.type === 'highlight' && !Object.hasOwn(HIGHLIGHTS, a.preset)) throw projectError('INVALID_DOCUMENT');
            if (mark.type === 'textStyle') {
                if (a.color != null && !COLOR.test(a.color)) throw projectError('INVALID_DOCUMENT');
                if (a.backgroundColor != null && !COLOR.test(a.backgroundColor)) throw projectError('INVALID_DOCUMENT');
                if (a.fontFamily != null && !FONT.test(a.fontFamily)) throw projectError('INVALID_DOCUMENT');
                if (a.fontSize != null && !/^(?:[1-6][0-9]|7[0-2])px$/.test(a.fontSize)) throw projectError('INVALID_DOCUMENT');
            }
        }
        if (node.content != null && !Array.isArray(node.content)) throw projectError('INVALID_DOCUMENT');
        for (const child of node.content || []) {
            if (!CHILDREN[node.type].includes(child.type)) throw projectError('INVALID_DOCUMENT');
            visit(child, depth + 1);
        }
        if (['doc', 'listItem', 'bulletList', 'orderedList', 'table', 'tableRow', 'tableCell', 'tableHeader', 'column', 'blockquote'].includes(node.type) && !node.content?.length) throw projectError('INVALID_DOCUMENT');
    }
    for (const chapter of project.chapters) {
        if (!ID.test(chapter.id) || !chapter.id.startsWith('c_') || ids.has(chapter.id) || chapter.content?.type !== 'doc') throw projectError('INVALID_PROJECT');
        ids.add(chapter.id);
        string(chapter.css ?? '', 100000);
        string(chapter.title);
        string(chapter.tocTitle);
        if (typeof chapter.inToc !== 'boolean') throw projectError('INVALID_PROJECT');
        visit(chapter.content);
    }
    return project;
}

export function walkDocument(node, callback) {
    callback(node);
    for (const child of node.content || []) walkDocument(child, callback);
}

export function textContent(node) {
    return node.type === 'text' ? node.text : (node.content || []).map(textContent).join(node.type === 'doc' ? '\n' : '');
}

export function duplicateChapter(chapter) {
    const copy = structuredClone(chapter);
    copy.id = newId('c');
    const idMap = new Map();
    walkDocument(copy.content, node => {
        if (node.attrs?.id) {
            const id = newId();
            idMap.set(node.attrs.id, id);
            node.attrs.id = id;
        }
    });
    walkDocument(copy.content, node => {
        for (const mark of node.marks || []) {
            if (mark.type !== 'link') continue;
            const [target, anchor] = mark.attrs.href.split('#');
            if (target === `epub:${chapter.id}`) mark.attrs.href = `epub:${copy.id}${anchor && idMap.has(anchor) ? `#${idMap.get(anchor)}` : ''}`;
        }
    });
    return copy;
}

export function inspectProject(project) {
    const issues = [];
    try { validateProject(project); } catch (error) { return [{ severity: 'error', code: error.code }]; }
    const issue = (severity, code, chapterId, nodeId) => issues.push({ severity, code, chapterId, nodeId });
    const commonCssError = inspectCss(project.commonCss).error;
    if (commonCssError) issue('error', commonCssError.code);
    if (!project.metadata.title.trim()) issue('error', 'TITLE_REQUIRED');
    try { new Intl.Locale(project.metadata.language); } catch { issue('error', 'LANGUAGE_REQUIRED'); }
    if (!project.metadata.identifier.trim()) issue('error', 'IDENTIFIER_REQUIRED');
    if (!project.metadata.author.trim()) issue('warning', 'AUTHOR_MISSING');
    if (project.cover.mode === 'none') issue('warning', 'COVER_MISSING');
    if (!project.chapters.some(chapter => chapter.inToc)) issue('error', 'TOC_EMPTY');
    const assets = new Map(project.assets.map(asset => [asset.id, asset]));
    if (project.cover.mode === 'image' && assets.get(project.cover.assetId)?.kind !== 'image') issue('error', 'COVER_ASSET_MISSING');
    if (project.style.font.startsWith('font-') && assets.get(project.style.font.slice(5))?.kind !== 'font') issue('error', 'FONT_MISSING');
    const anchors = new Map();
    for (const chapter of project.chapters) {
        const cssError = inspectCss(chapter.css).error;
        if (cssError) issue('error', cssError.code, chapter.id);
        const found = new Set();
        anchors.set(chapter.id, found);
        if (!chapter.title.trim()) issue('error', 'CHAPTER_TITLE_REQUIRED', chapter.id);
        let hasMedia = false;
        walkDocument(chapter.content, node => { if (['image', 'audio', 'media'].includes(node.type)) hasMedia = true; });
        if (!textContent(chapter.content).trim() && !hasMedia) issue('warning', 'CHAPTER_EMPTY', chapter.id);
        walkDocument(chapter.content, node => {
            if (node.attrs?.id) {
                if (found.has(node.attrs.id)) issue('error', 'DUPLICATE_ID', chapter.id, node.attrs.id);
                found.add(node.attrs.id);
            }
            if (node.type === 'footnote') {
                const noteId = `note-${node.attrs.id}`;
                if (found.has(noteId)) issue('error', 'DUPLICATE_ID', chapter.id, node.attrs.id);
                found.add(noteId);
                if (!node.attrs.text?.trim()) issue('warning', 'FOOTNOTE_EMPTY', chapter.id, node.attrs.id);
            }
            if (node.type === 'audio' && assets.get(node.attrs.assetId)?.kind !== 'audio') issue('error', 'AUDIO_MISSING', chapter.id, node.attrs.id);
            if (node.type === 'image') {
                if (assets.get(node.attrs.assetId)?.kind !== 'image') issue('error', 'IMAGE_MISSING', chapter.id, node.attrs.id);
                if (!node.attrs.alt?.trim() && !node.attrs.decorative) issue('warning', 'ALT_MISSING', chapter.id, node.attrs.id);
            }
            for (const mark of node.marks || []) {
                const font = mark.type === 'textStyle' && mark.attrs?.fontFamily;
                if (font && font.startsWith('font-') && assets.get(font.slice(5))?.kind !== 'font') issue('error', 'FONT_MISSING', chapter.id, node.attrs?.id);
            }
        });
    }
    for (const chapter of project.chapters) walkDocument(chapter.content, node => {
        for (const mark of node.marks || []) {
            if (mark.type === 'link' && mark.attrs.href.startsWith('epub:')) {
                const [target, anchor] = mark.attrs.href.slice(5).split('#');
                if (!anchors.has(target) || (anchor && !anchors.get(target).has(anchor))) issue('error', 'BROKEN_LINK', chapter.id, node.attrs?.id);
            }
        }
    });
    return issues;
}

export function xml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

export function assetFilename(asset) {
    return `${asset.id}.${asset.extension}`;
}

export function renderChapterBody(chapter, project, resolveAsset = asset => `../assets/${assetFilename(asset)}`) {
    const assets = new Map(project.assets.map(asset => [asset.id, asset]));
    const notes = [];
    function render(node) {
        const a = node.attrs || {};
        const id = a.id ? ` id="${xml(a.id)}"` : '';
        const cell = ['tableCell', 'tableHeader'].includes(node.type);
        const styles = [['paragraph', 'heading'].includes(node.type) && paragraphIndentCss(a), a.paragraphFormat && paragraphFormatCss(a.paragraphFormat, true), a.textAlign && `text-align:${a.textAlign}`, cell && a.backgroundColor && `background-color:${a.backgroundColor}`, cell && a.verticalAlign && `vertical-align:${a.verticalAlign}`, cell && a.cellPadding != null && `padding:${a.cellPadding / 16}rem`].filter(Boolean).join(';');
        const align = styles ? ` style="${styles}"` : '';
        const body = (node.content || []).map(render).join('');
        if (node.type === 'text') {
            let value = xml(node.text);
            for (const mark of node.marks || []) {
                const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', superscript: 'sup', subscript: 'sub' }[mark.type];
                if (tag) value = `<${tag}>${value}</${tag}>`;
                if (mark.type === 'inlineStyle') value = `<span class="bm-style-${xml(mark.attrs.preset)}">${value}</span>`;
                if (mark.type === 'highlight') value = `<mark class="bm-highlight-${xml(mark.attrs.preset)}">${value}</mark>`;
                if (mark.type === 'link') {
                    const href = mark.attrs.href.replace(/^epub:([^#]+)(.*)$/, '$1.xhtml$2');
                    value = `<a href="${xml(href)}">${value}</a>`;
                }
                if (mark.type === 'textStyle') {
                    const m = mark.attrs || {};
                    const css = [m.color && `color:${m.color}`, m.backgroundColor && `background-color:${m.backgroundColor}`, m.fontFamily && `font-family:${m.fontFamily}`, m.fontSize && `font-size:${Number.parseInt(m.fontSize, 10) / 16}rem`].filter(Boolean).join(';');
                    if (css) value = `<span style="${xml(css)}">${value}</span>`;
                }
            }
            return value;
        }
        const tag = { paragraph: 'p', heading: `h${a.level}`, blockquote: 'blockquote', bulletList: 'ul', orderedList: 'ol', listItem: 'li', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', column: 'div', columns: 'div' }[node.type];
        if (tag) {
            const attrs = node.type === 'orderedList' ? ` start="${a.start || 1}"` : ['tableCell', 'tableHeader'].includes(node.type) ? ` colspan="${a.colspan || 1}" rowspan="${a.rowspan || 1}"` : ['columns', 'column'].includes(node.type) ? ` class="${node.type}"` : '';
            let colgroup = '';
            if (node.type === 'table') {
                const widths = (node.content?.[0]?.content || []).flatMap(cell => Array.from({ length: cell.attrs?.colspan || 1 }, (_, index) => cell.attrs?.colwidth?.[index] || 100));
                const total = widths.reduce((sum, width) => sum + width, 0);
                colgroup = `<colgroup>${widths.map(width => `<col style="width:${(width / total * 100).toFixed(4)}%" />`).join('')}</colgroup>`;
            }
            const styleClass = ['paragraph', 'heading'].includes(node.type) && a.blockStyle ? ` class="bm-style-${xml(a.blockStyle)}"` : '';
            const formatData = a.paragraphFormat ? ` data-paragraph-format="${xml(JSON.stringify(a.paragraphFormat))}"` : '';
            return `<${tag}${id}${align}${attrs}${styleClass}${formatData}>${node.type === 'table' ? `${colgroup}<tbody>${body}</tbody>` : body || (node.type === 'paragraph' ? '<br />' : '')}</${tag}>`;
        }
        if (node.type === 'media') {
            const media = parseMediaUrl(a.url);
            if (!media) return '';
            return `<figure${id} class="external-media"><figcaption>${xml(a.title || media.provider)}</figcaption><p><a href="${xml(media.url)}">${xml(media.provider)} · ${xml(media.url)}</a></p></figure>`;
        }
        if (node.type === 'image') {
            const asset = assets.get(a.assetId);
            if (!asset) return '';
            const margin = a.align === 'center' ? '0 auto' : a.align === 'right' ? '0 0 0 auto' : '0 auto 0 0';
            return `<figure${id} style="width:${a.width}%;margin:${margin}"><img src="${xml(resolveAsset(asset))}" alt="${xml(a.decorative ? '' : a.alt || '')}"${a.decorative ? ' role="presentation"' : ''} />${a.caption ? `<figcaption>${xml(a.caption)}</figcaption>` : ''}</figure>`;
        }
        if (node.type === 'footnote') {
            notes.push(a);
            return `<sup><a${id} epub:type="noteref" role="doc-noteref" href="#note-${xml(a.id)}">${notes.length}</a></sup>`;
        }
        if (node.type === 'audio') {
            const asset = assets.get(a.assetId);
            if (!asset) return '';
            return `<figure${id} class="audio ${a.kind}"><figcaption>${xml(a.title || asset.name)}</figcaption><audio controls="controls" preload="none"${a.loop ? ' loop="loop"' : ''} src="${xml(resolveAsset(asset))}">${xml(a.title || asset.name)}</audio></figure>`;
        }
        if (node.type === 'hardBreak') return '<br />';
        if (node.type === 'horizontalRule') return `<hr${id} />`;
        if (node.type === 'codeBlock') return `<pre${id}><code>${body}</code></pre>`;
        return body;
    }
    const body = render(chapter.content);
    const footnotes = notes.map((note, index) => `<aside id="note-${xml(note.id)}" epub:type="footnote" role="doc-footnote"><p><a href="#${xml(note.id)}" role="doc-backlink">${index + 1} ↩</a> ${xml(note.text).replace(/\n/g, '<br />')}</p></aside>`).join('\n');
    return `<h1 class="chapter-title">${xml(chapter.title)}</h1>\n${body}${footnotes ? `<section class="footnotes" aria-label="${project.metadata.language.startsWith('ko') ? '각주' : 'Footnotes'}">${footnotes}</section>` : ''}`;
}

export function bookCss(project, resolveAsset = asset => `../assets/${assetFilename(asset)}`) {
    const s = project.style;
    const fonts = project.assets.filter(asset => asset.kind === 'font').map(asset => `@font-face{font-family:font-${asset.id};src:url("${resolveAsset(asset)}");}`).join('\n');
    return `${fonts}
html{color:${s.color};background:${s.background};font-family:${s.font};}
body{margin:0;padding:1.6em;font-size:${s.fontSize / 16}em;line-height:${s.lineHeight};overflow-wrap:break-word;}
p{margin:0 0 ${s.paragraphGap}em;text-indent:${s.indent}em;}
h1,h2,h3,h4,h5,h6{color:${s.accent};line-height:1.35;margin:1.3em 0 .65em;break-after:avoid;}
h1{font-size:${s.headingScale}em;}h2{font-size:${Math.max(1.2, s.headingScale * 0.8)}em;}h3{font-size:1.15em;}
h4{font-size:1.05em;}h5{font-size:1em;}h6{font-size:.9em;}
.chapter-title{margin-top:0;padding-bottom:.65em;border-bottom:1px solid ${s.accent};}
a{color:${s.accent};}blockquote{margin:1em 0;padding:.6em 1em;border-left:3px solid ${s.accent};}blockquote p{margin:0;}
img{width:100%;max-width:100%;height:auto;display:block;}figure{padding:.75em 0;break-inside:avoid;}figcaption{font-size:.85em;text-align:center;opacity:.8;}
table{border-collapse:collapse;width:100%;table-layout:fixed;margin:1em 0;}td,th{border:1px solid #aeb5b0;padding:.55em;vertical-align:top;}td p,th p{text-indent:0;}th{font-weight:bold;}
.columns{display:flex;gap:1.5em;margin:1em 0;}.column{flex:1;min-width:0;}
@media(max-width:480px){.columns{display:block;}.column{margin-bottom:1em;}}
audio{width:100%;max-width:100%;}.audio{margin:1em 0;padding:1em;border:1px solid #aeb5b0;}.footnotes{margin-top:2em;border-top:1px solid #aeb5b0;font-size:.85em;}.footnotes p{text-indent:0;margin:.8em 0;}
pre{white-space:pre-wrap;background:#eeeeea;padding:1em;}hr{border:0;border-top:1px solid #b8bdb7;margin:1.8em 0;}
.external-media{border:1px solid #aeb5b0;border-radius:6px;padding:1em;margin:1em 0;}.external-media p{text-indent:0;margin:.5em 0 0;overflow-wrap:anywhere;}
${authoringCss()}
${safeCss(project.commonCss)}
`;
}

export function chapterXhtml(chapter, project, { resolveAsset, inlineStyles = false } = {}) {
    const css = inlineStyles ? `<style>${(bookCss(project, resolveAsset) + '\n' + safeCss(chapter.css)).replace(/</g, '\\3c ')}</style>` : '<link rel="stylesheet" type="text/css" href="../styles/book.css" />' + (chapter.css ? `<link rel="stylesheet" type="text/css" href="../styles/${chapter.id}.css" />` : '');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(project.metadata.language)}" xml:lang="${xml(project.metadata.language)}"><head><meta charset="utf-8" /><title>${xml(chapter.title)}</title>${css}</head><body>${renderChapterBody(chapter, project, resolveAsset)}</body></html>`;
}

export function coverSvg(project) {
    const chunks = Array.from(project.metadata.title).reduce((lines, char, index) => {
        if (index % 14 === 0) lines.push('');
        lines[lines.length - 1] += char;
        return lines;
    }, []).slice(0, 8);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800"><rect width="1200" height="1800" fill="${project.cover.background}" /><path d="M120 190H1080M120 1560H1080" stroke="${project.cover.color}" stroke-width="2" /><g fill="${project.cover.color}" font-family="serif"><text x="120" y="330" font-size="28" letter-spacing="6">${xml(project.metadata.publisher)}</text>${chunks.map((line, i) => `<text x="120" y="${560 + i * 100}" font-size="64">${xml(line)}</text>`).join('')}<text x="120" y="1430" font-size="30">${xml(project.cover.subtitle)}</text><text x="120" y="1660" font-size="36">${xml(project.metadata.author)}</text></g></svg>`;
}
