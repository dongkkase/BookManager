import { newId, paragraph, safeLink } from './model.js';
import { attr, descendants, elements, epubReference, tag } from './epubImportXml.js';
import { importedImageSize } from './epubImportImages.js';

const INLINE_MARKS = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', s: 'strike', del: 'strike', strike: 'strike', code: 'code', sup: 'superscript', sub: 'subscript' };
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'pre', 'hr', 'table', 'figure', 'img', 'audio', 'svg', 'video', 'dl']);
const OMIT_TAGS = new Set(['script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input', 'button']);

function declarations(node) {
    return Object.fromEntries(attr(node, 'style').split(';').map(part => part.split(/:(.*)/s).slice(0, 2)).filter(pair => pair.length === 2).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]));
}

function color(value = '') {
    if (/^#[a-f0-9]{6}$/i.test(value)) return value;
    if (/^#[a-f0-9]{3}$/i.test(value)) return `#${value.slice(1).split('').map(char => char + char).join('')}`;
    const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb && rgb.slice(1).every(part => Number(part) <= 255)) return `#${rgb.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
    return undefined;
}

function styledMarks(node, inherited) {
    const marks = new Map(inherited.map(mark => [mark.type, mark]));
    const type = INLINE_MARKS[tag(node)];
    if (type) marks.set(type, { type });
    const css = declarations(node);
    if (/^(bold|[6-9]00)$/.test(css['font-weight'])) marks.set('bold', { type: 'bold' });
    if (/^(italic|oblique)$/.test(css['font-style'])) marks.set('italic', { type: 'italic' });
    if (/underline/.test(css['text-decoration'] || '')) marks.set('underline', { type: 'underline' });
    if (/line-through/.test(css['text-decoration'] || '')) marks.set('strike', { type: 'strike' });
    const attrs = { ...marks.get('textStyle')?.attrs };
    if (color(css.color)) attrs.color = color(css.color);
    if (color(css['background-color'])) attrs.backgroundColor = color(css['background-color']);
    if (['serif', 'sans-serif', 'monospace'].includes(css['font-family'])) attrs.fontFamily = css['font-family'];
    const size = css['font-size']?.match(/^(\d+(?:\.\d+)?)(px|rem)$/);
    if (size) {
        const pixels = Math.round(Number(size[1]) * (size[2] === 'rem' ? 16 : 1));
        if (pixels >= 10 && pixels <= 72) attrs.fontSize = `${pixels}px`;
    }
    if (Object.keys(attrs).length) marks.set('textStyle', { type: 'textStyle', attrs });
    return [...marks.values()];
}

export function importChapterContent(body, context) {
    const { source, assets, warn, links, anchors } = context;
    const registered = new Set();
    function register(element, node) {
        if (!node || element.nodeType !== 1) return;
        const ids = [attr(element, 'id'), tag(element) === 'a' ? attr(element, 'name') : ''].filter(Boolean);
        for (const id of ids) {
            if (registered.has(id)) continue;
            node.attrs ||= {};
            node.attrs.id ||= newId();
            anchors.set(id, node.attrs.id);
            registered.add(id);
        }
    }
    function imageNode(element, container = element) {
        const href = attr(element, 'src') || attr(element, 'href') || attr(element, 'xlink:href');
        const asset = assets.get(epubReference(source, href)?.name);
        if (asset?.kind !== 'image') {
            warn('EPUB_IMPORT_MEDIA', source);
            return paragraph(attr(element, 'alt') || `[${href || tag(element)}]`);
        }
        const caption = elements(container).find(node => tag(node) === 'figcaption')?.textContent || '';
        const size = importedImageSize(element, container, context.imageDimensions?.get(asset.id));
        const node = { type: 'image', attrs: { assetId: asset.id, alt: attr(element, 'alt').slice(0, 2000), caption: caption.slice(0, 2000), ...size, align: 'center', decorative: attr(element, 'role') === 'presentation' } };
        register(element, node);
        register(container, node);
        return node;
    }
    function audioNode(element, container = element) {
        const href = attr(element, 'src') || attr(elements(element).find(node => tag(node) === 'source') || {}, 'src');
        const asset = assets.get(epubReference(source, href)?.name);
        if (asset?.kind !== 'audio') { warn('EPUB_IMPORT_MEDIA', source); return paragraph(attr(element, 'title') || `[${href || 'audio'}]`); }
        const volume = Number(attr(element, 'data-bookmanager-audio-volume') || 1);
        const node = { type: 'audio', attrs: { assetId: asset.id, title: (attr(element, 'title') || asset.name).slice(0, 2000), kind: attr(element, 'data-bookmanager-audio-kind') === 'background' ? 'background' : 'effect', loop: element.hasAttribute('loop'), controls: attr(element, 'data-bookmanager-audio-controls') !== 'false', volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1 } };
        if (attr(element, 'data-bookmanager-audio-range')) warn('EPUB_IMPORT_STRUCTURE', source);
        register(element, node);
        register(container, node);
        return node;
    }
    function flow(children, inherited = [], depth = 0, blockElement = null) {
        const result = [];
        let inline = [];
        let inlineElements = [];
        const flush = force => {
            while (inline[0]?.type === 'text' && /^\s/.test(inline[0].text)) { inline[0].text = inline[0].text.replace(/^ +/, ''); if (inline[0].text) break; inline.shift(); }
            while (inline.at(-1)?.type === 'text') { inline.at(-1).text = inline.at(-1).text.replace(/ +$/, ''); if (inline.at(-1).text) break; inline.pop(); }
            if (inline.length || force || inlineElements.some(node => attr(node, 'id') || attr(node, 'name'))) {
                const heading = blockElement && /^h[1-6]$/.test(tag(blockElement));
                const node = { type: heading ? 'heading' : 'paragraph', attrs: heading ? { level: Number(tag(blockElement)[1]) } : {}, content: inline };
                const align = blockElement && (declarations(blockElement)['text-align'] || attr(blockElement, 'align'));
                if (['left', 'right', 'center', 'justify'].includes(align)) node.attrs.textAlign = align;
                if (blockElement) register(blockElement, node);
                for (const element of inlineElements) register(element, node);
                result.push(node);
            }
            inline = [];
            inlineElements = [];
        };
        function visit(node, marks, level) {
            if (level > 36) throw Object.assign(new Error('EPUB_TOO_LARGE'), { code: 'EPUB_TOO_LARGE' });
            if (node.nodeType === 3 || node.nodeType === 4) {
                const text = node.data.replace(/[\t\r\n ]+/g, ' ');
                if (text) inline.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
                return;
            }
            if (node.nodeType !== 1) return;
            const name = tag(node);
            if (OMIT_TAGS.has(name)) { warn(name === 'style' || name === 'link' ? 'EPUB_IMPORT_STYLE' : 'EPUB_IMPORT_STRUCTURE', source); return; }
            if (attr(node, 'data-bm-tts') || attr(node, 'data-bookmanager-audio-range') || attr(node, 'epub:type').includes('note')) warn('EPUB_IMPORT_STRUCTURE', source);
            if (BLOCK_TAGS.has(name)) { flush(false); result.push(...block(node, marks, level + 1)); return; }
            inlineElements.push(node);
            if (name === 'br') { inline.push({ type: 'hardBreak' }); return; }
            let next = styledMarks(node, marks);
            if (name === 'a' && attr(node, 'href')) {
                const mark = { type: 'link', attrs: { href: attr(node, 'href') } };
                links.push({ mark, source });
                next = [...next.filter(value => value.type !== 'link'), mark];
            }
            if (['ruby', 'math'].includes(name)) warn('EPUB_IMPORT_STRUCTURE', source);
            for (const child of Array.from(node.childNodes)) visit(child, next, level + 1);
        }
        for (const child of children) visit(child, inherited, depth);
        flush(Boolean(blockElement) && !result.length);
        return result;
    }
    function block(element, inherited, depth) {
        const name = tag(element);
        const marks = styledMarks(element, inherited);
        const children = Array.from(element.childNodes);
        let result;
        if (name === 'img') result = [imageNode(element)];
        else if (name === 'audio') result = [audioNode(element)];
        else if (name === 'svg') {
            const image = descendants(element, 'image')[0];
            result = [image ? imageNode(image, element) : paragraph(`[${attr(element, 'aria-label') || 'SVG'}]`)];
            if (!image) warn('EPUB_IMPORT_MEDIA', source);
        } else if (name === 'video') { warn('EPUB_IMPORT_MEDIA', source); result = [paragraph(element.textContent || '[video]')]; }
        else if (name === 'figure' && elements(element).every(node => ['img', 'audio', 'figcaption'].includes(tag(node))) && elements(element).filter(node => ['img', 'audio'].includes(tag(node))).length === 1) {
            const media = elements(element).find(node => ['img', 'audio'].includes(tag(node)));
            result = [tag(media) === 'img' ? imageNode(media, element) : audioNode(media, element)];
        } else if (name === 'hr') result = [{ type: 'horizontalRule' }];
        else if (name === 'pre') result = [{ type: 'codeBlock', content: element.textContent ? [{ type: 'text', text: element.textContent }] : [] }];
        else if (name === 'ul' || name === 'ol') {
            const items = elements(element).filter(node => tag(node) === 'li').map(item => {
                const content = flow(Array.from(item.childNodes), marks, depth);
                if (content[0]?.type !== 'paragraph') content.unshift(paragraph());
                const node = { type: 'listItem', content };
                register(item, node);
                return node;
            });
            const start = Number(attr(element, 'start') || 1);
            result = items.length ? [{ type: name === 'ul' ? 'bulletList' : 'orderedList', ...(name === 'ol' ? { attrs: { start: Number.isInteger(start) && start > 0 && start <= 100000 ? start : 1 } } : {}), content: items }] : [paragraph()];
        } else if (name === 'table') {
            const rows = elements(element).flatMap(node => ['thead', 'tbody', 'tfoot'].includes(tag(node)) ? elements(node) : [node]).filter(node => tag(node) === 'tr');
            const content = rows.map(row => ({ type: 'tableRow', content: elements(row).filter(node => ['td', 'th'].includes(tag(node))).map(cell => {
                const content = flow(Array.from(cell.childNodes), marks, depth);
                const span = key => Math.max(1, Math.min(100, Number.parseInt(attr(cell, key), 10) || 1));
                const node = { type: tag(cell) === 'th' ? 'tableHeader' : 'tableCell', attrs: { colspan: span('colspan'), rowspan: span('rowspan') }, content: content.length ? content : [paragraph()] };
                const css = declarations(cell);
                if (color(css['background-color'])) node.attrs.backgroundColor = color(css['background-color']);
                if (['top', 'middle', 'bottom'].includes(css['vertical-align'])) node.attrs.verticalAlign = css['vertical-align'];
                register(cell, node);
                return node;
            }) })).filter(row => row.content.length);
            const caption = elements(element).find(node => tag(node) === 'caption');
            result = [...(caption ? [paragraph(caption.textContent)] : []), ...(content.length ? [{ type: 'table', content }] : [paragraph()])];
        } else {
            const content = flow(children, marks, depth, /^p$|^h[1-6]$/.test(name) ? element : null);
            result = name === 'blockquote' ? [{ type: 'blockquote', content: content.length ? content : [paragraph()] }] : content;
        }
        if (!result.length && attr(element, 'id')) result.push(paragraph());
        register(element, result[0]);
        return result;
    }
    const content = flow(Array.from(body.childNodes), styledMarks(body, []));
    if (!content.length) content.push(paragraph());
    register(body, content[0]);
    return { type: 'doc', content };
}

export function resolveImportedLinks(chapters, links, warn) {
    for (const { mark, source } of links) {
        if (safeLink(mark.attrs.href) && !mark.attrs.href.startsWith('epub:')) continue;
        const reference = epubReference(source, mark.attrs.href);
        const target = chapters.get(reference?.name);
        const anchor = reference?.anchor && target?.anchors.get(reference.anchor);
        if (target && (!reference.anchor || anchor)) mark.attrs.href = `epub:${target.chapter.id}${anchor ? `#${anchor}` : ''}`;
        else { mark.type = 'discardedLink'; warn('EPUB_IMPORT_LINK', source); }
    }
    function clean(node) {
        if (node.marks) node.marks = node.marks.filter(mark => mark.type !== 'discardedLink');
        for (const child of node.content || []) clean(child);
    }
    for (const { chapter } of chapters.values()) clean(chapter.content);
}
