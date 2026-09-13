import { epubOriginalCssParts, rewriteEpubOriginalCssUrls } from '../electron/epubOriginal.js';

const RESOURCE_SCHEME = /^(?:bookmanager-document:\/\/|\/api\/viewer\/epub-asset\/)/i;
const VISUAL_RESOURCE_ENTRY = /\.(?:jpe?g|png|webp|bmp|gif|svg|avif|apng|ttf|otf|woff2?|eot)$/i;
const ALLOWED_DATA = /^data:(?:image\/(?:png|jpeg|gif|webp|bmp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(?:font-[a-z0-9-]+|vnd\.ms-fontobject|x-font-[a-z0-9-]+));/i;
export const DEFAULT_EPUB_AUDIO_LABELS = Object.freeze({ play: '재생', pause: '일시정지', loading: '불러오는 중' });
const originalThemeStyles = new WeakMap();
const ORIGINAL_THEME_PROPERTIES = ['color', '-webkit-text-fill-color', 'background-color', 'background-image', 'text-shadow'];

export function getEpubOriginalAnchorRects(node) {
    const document = node?.ownerDocument;
    const viewport = document?.defaultView;
    if (!viewport || !node.isConnected) return [];
    const control = node.matches('button[data-epub-audio-id]') ? node : node.hasAttribute('data-epub-audio-anchor') ? node.querySelector('button[data-epub-audio-id]') : null;
    const target = control || node;
    const style = viewport.getComputedStyle(target);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return [];
    const direction = style.direction;
    const vertical = style.writingMode.startsWith('vertical');
    const hiddenAudio = node.hasAttribute('data-epub-audio-anchor') && node.getAttribute('data-epub-audio-controls') === 'false';
    if (style.display === 'none' && !hiddenAudio) return [];
    let previous;
    const previousInlineRect = () => {
        if (previous !== undefined) return previous;
        previous = null;
        const scope = node.parentElement?.closest('p, div, section, article, li, td, th, blockquote, figure, figcaption, body');
        for (let cursor = node; scope && cursor !== scope; cursor = cursor.parentElement) {
            for (let candidate = cursor.previousSibling; candidate; candidate = candidate.previousSibling) {
                let fragments = [];
                if (candidate.nodeType === 3 && candidate.textContent.trim()) {
                    const range = document.createRange();
                    range.selectNodeContents(candidate);
                    fragments = Array.from(range.getClientRects());
                    range.detach();
                } else if (candidate.nodeType === 1 && !candidate.matches('style, script, [hidden], [data-epub-audio-id]')) {
                    fragments = Array.from(candidate.getClientRects());
                }
                const usable = fragments.filter(rect => rect.width > 0 && rect.height > 0);
                if (usable.length) {
                    previous = usable.at(-1);
                    return previous;
                }
            }
        }
        return previous;
    };
    const rects = element => Array.from(element.getClientRects()).map(rect => {
        let left = rect.left;
        let top = rect.top;
        if (!rect.width || !rect.height) {
            const preceding = previousInlineRect();
            const sameRow = preceding && rect.top <= preceding.bottom + 0.5 && rect.bottom >= preceding.top - 0.5;
            const sameColumn = preceding && rect.left <= preceding.right + 0.5 && rect.right >= preceding.left - 0.5;
            if (!rect.width) {
                if (sameRow && Math.abs(rect.left - preceding.right) < 0.5) left -= 1;
                else if (!(sameRow && Math.abs(rect.left - preceding.left) < 0.5) && direction === 'rtl') left -= 1;
            }
            if (!rect.height) {
                if (sameColumn && Math.abs(rect.top - preceding.bottom) < 0.5) top -= 1;
                else if (!(sameColumn && Math.abs(rect.top - preceding.top) < 0.5) && vertical && direction === 'rtl') top -= 1;
            }
        }
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        return { left, top, width, height, right: left + width, bottom: top + height };
    });
    const direct = rects(target);
    if (direct.length || !hiddenAudio || control) return direct;
    let parent = node.parentElement;
    while (parent) {
        if (viewport.getComputedStyle(parent).display === 'none') return [];
        parent = parent.parentElement;
    }
    const audioOnly = [...document.body.childNodes].every(child => (
        child.nodeType === 3 ? !child.textContent.trim() : child.nodeType !== 1 || child.matches('style, [data-epub-audio-controls="false"]')
    ));
    if (audioOnly) return rects(document.documentElement).slice(0, 1);
    const originalStyle = node.getAttribute('style');
    try {
        node.style.cssText = 'all:initial!important;display:inline-block!important;position:absolute!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;font-size:0!important;line-height:0!important;direction:inherit!important;writing-mode:inherit!important;';
        return rects(node);
    } finally {
        if (originalStyle === null) node.removeAttribute('style');
        else node.setAttribute('style', originalStyle);
    }
}

export function epubOriginalViewportMetrics(pageSize, appearance, scale = 1) {
    const displayScale = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1;
    const pageWidth = Math.max(1, Math.round(Number(pageSize?.width) || 600));
    const pageHeight = Math.max(1, Math.round(Number(pageSize?.height) || 800));
    const outerWidth = pageWidth * displayScale;
    const outerHeight = pageHeight * displayScale;
    const padding = (value, extent) => Math.min(Math.max(0, Math.min(80, Number(value) || 0)), Math.max(0, (extent - 40) / 2));
    const horizontalPadding = padding(appearance?.horizontalPadding, outerWidth);
    const verticalPadding = padding(appearance?.verticalPadding, outerHeight);
    return {
        outerWidth,
        outerHeight,
        horizontalPadding,
        verticalPadding,
        width: Math.max(1, Math.floor(pageWidth - horizontalPadding * 2 / displayScale)),
        height: Math.max(1, Math.floor(pageHeight - verticalPadding * 2 / displayScale)),
        displayScale,
    };
}

export function applyEpubOriginalTheme(document, theme) {
    if (!document?.body || !document.defaultView) return null;
    const previous = originalThemeStyles.get(document);
    if (previous) {
        for (const [node, original] of previous) {
            for (const [property, { value, priority }] of original.properties) {
                if (value) node.style.setProperty(property, value, priority);
                else node.style.removeProperty(property);
            }
            if (!original.hadStyle && !node.style.length) node.removeAttribute('style');
        }
        originalThemeStyles.delete(document);
    }
    const valid = theme && document.defaultView.CSS.supports('color', String(theme.bg || '')) && document.defaultView.CSS.supports('color', String(theme.fg || ''));
    if (valid) {
        const styles = new Map();
        const remember = node => styles.set(node, {
            hadStyle: node.hasAttribute('style'),
            properties: ORIGINAL_THEME_PROPERTIES.map(property => [property, { value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) }]),
        });
        const svgColors = [...document.body.querySelectorAll('svg')].map(node => {
            const computed = document.defaultView.getComputedStyle(node);
            return { node, color: computed.color, textFill: computed.webkitTextFillColor };
        });
        const textContainers = new Set();
        const walker = document.createTreeWalker(document.body, 4);
        while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent.trim() || text.parentElement?.closest('svg, picture, canvas, video, style, script, noscript')) continue;
            let parent = text.parentElement;
            while (parent && !textContainers.has(parent)) {
                textContainers.add(parent);
                parent = parent.parentElement;
            }
        }
        const nodes = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];
        for (const node of nodes) {
            if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || node.closest('svg, picture, canvas, video') || node.localName === 'img') continue;
            remember(node);
            node.style.setProperty('color', theme.fg, 'important');
            node.style.setProperty('-webkit-text-fill-color', theme.fg, 'important');
            if (textContainers.has(node) || node === document.documentElement || node === document.body) {
                node.style.setProperty('background-color', node === document.documentElement || node === document.body ? theme.bg : 'transparent', 'important');
            }
            if (textContainers.has(node)) node.style.setProperty('background-image', 'none', 'important');
            node.style.setProperty('text-shadow', 'none', 'important');
        }
        for (const { node, color, textFill } of svgColors) {
            remember(node);
            node.style.setProperty('color', color, 'important');
            node.style.setProperty('-webkit-text-fill-color', textFill, 'important');
        }
        originalThemeStyles.set(document, styles);
        return { bg: theme.bg, fg: theme.fg };
    }
    const bodyStyle = document.defaultView.getComputedStyle(document.body);
    const rootStyle = document.defaultView.getComputedStyle(document.documentElement);
    const background = [bodyStyle.backgroundColor, rootStyle.backgroundColor].find(color => color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
    return { bg: background || '#fff', fg: bodyStyle.color || '#000' };
}

export function resolveEpubOriginalReference(value, entryName = '') {
    const reference = String(value || '').trim();
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return null;
    const hash = reference.indexOf('#');
    const path = (hash < 0 ? reference : reference.slice(0, hash)).split('?')[0];
    const anchor = hash < 0 ? '' : reference.slice(hash + 1);
    let decodedPath = path;
    let decodedAnchor = anchor;
    try { decodedPath = decodeURIComponent(path); } catch {}
    try { decodedAnchor = decodeURIComponent(anchor); } catch {}
    const segments = decodedPath.startsWith('/') ? [] : String(entryName).split('/').slice(0, -1);
    if (!decodedPath) return { entryName: String(entryName), anchor: decodedAnchor };
    for (const segment of decodedPath.replaceAll('\\', '/').split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return { entryName: segments.join('/'), anchor: decodedAnchor };
}

export function resolveEpubOriginalResource(value, entryName, resourceUrls = {}) {
    const reference = String(value || '').trim();
    if (!reference) return '';
    if (reference.startsWith('#')) return reference;
    if (ALLOWED_DATA.test(reference)) return reference;
    const approvedUrls = Object.entries(resourceUrls).filter(([name]) => VISUAL_RESOURCE_ENTRY.test(name)).map(([, url]) => url);
    const withoutFragment = reference.split('#')[0];
    if (approvedUrls.includes(withoutFragment) && (RESOURCE_SCHEME.test(reference) || /^https?:\/\//i.test(reference))) return reference;
    const target = resolveEpubOriginalReference(reference, entryName);
    if (!target || !VISUAL_RESOURCE_ENTRY.test(target.entryName) || !Object.hasOwn(resourceUrls, target.entryName)) return '';
    const resolved = String(resourceUrls[target.entryName] || '');
    if (!RESOURCE_SCHEME.test(resolved) && !/^https?:\/\//i.test(resolved)) return '';
    return `${resolved}${target.anchor ? `#${encodeURIComponent(target.anchor)}` : ''}`;
}

export function rewriteEpubOriginalViewportUnits(css, pageSize) {
    const source = String(css || '');
    const width = Number(pageSize?.width);
    const height = Number(pageSize?.height);
    if (!(width > 0 && height > 0)) return source;
    let output = '';
    let index = 0;
    let atRulePrelude = false;
    const copyQuoted = () => {
        const quote = source[index];
        const start = index++;
        while (index < source.length) {
            if (source[index] === '\\') index += 2;
            else if (source[index++] === quote) break;
        }
        output += source.slice(start, index);
    };
    while (index < source.length) {
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            const next = end < 0 ? source.length : end + 2;
            output += source.slice(index, next);
            index = next;
            continue;
        }
        if (source[index] === '"' || source[index] === "'") {
            copyQuoted();
            continue;
        }
        const url = source.slice(index, index + 4).toLowerCase() === 'url(';
        if (url && !/[\w-]/.test(source[index - 1] || '')) {
            output += source.slice(index, index + 4);
            index += 4;
            while (index < source.length) {
                if (source[index] === '"' || source[index] === "'") copyQuoted();
                else if (source[index] === '\\') {
                    output += source.slice(index, index + 2);
                    index += 2;
                } else {
                    const character = source[index++];
                    output += character;
                    if (character === ')') break;
                }
            }
            continue;
        }
        if (source[index] === '@') atRulePrelude = true;
        else if (source[index] === '{' || source[index] === ';') atRulePrelude = false;
        if (!atRulePrelude && /[\d.+-]/.test(source[index]) && !/[\w\\-]/.test(source[index - 1] || '')) {
            const dimension = source.slice(index).match(/^([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?)([dsl]?v(?:min|max|h|w))(?![\w-])/i);
            if (dimension) {
                const unit = dimension[2].toLowerCase().replace(/^[dsl]/, '');
                const basis = unit === 'vh' ? height : unit === 'vw' ? width : unit === 'vmin' ? Math.min(width, height) : Math.max(width, height);
                const pixels = Number(dimension[1]) * basis / 100;
                if (Number.isFinite(pixels)) {
                    output += `${Number(pixels.toFixed(6))}px`;
                    index += dimension[0].length;
                    continue;
                }
            }
        }
        output += source[index++];
    }
    return output;
}

export function rewriteEpubOriginalCss(css, entryName, resourceUrls, pageSize) {
    const declarations = epubOriginalCssParts(css).filter(part => typeof part.css === 'string').map(part => part.css).join('');
    const rewritten = rewriteEpubOriginalCssUrls(declarations, href => (
        resolveEpubOriginalResource(href, entryName, resourceUrls) || 'about:blank'
    ));
    return pageSize ? rewriteEpubOriginalViewportUnits(rewritten, pageSize) : rewritten;
}

function rewriteSrcset(value, entryName, resources) {
    if (/^\s*data:/i.test(value)) return '';
    return String(value || '').split(',').map(candidate => {
        const [url, ...descriptors] = candidate.trim().split(/\s+/);
        const resolved = resolveEpubOriginalResource(url, entryName, resources);
        return resolved ? `${resolved}${descriptors.length ? ` ${descriptors.join(' ')}` : ''}` : '';
    }).filter(Boolean).join(', ');
}

function replaceEpubAudioElements(document, tracks) {
    const inlineTracks = Array.isArray(tracks) ? tracks.filter(track => track?.kind === 'inline' && track.id && track.anchor) : [];
    document.querySelectorAll('audio').forEach(audio => {
        const track = inlineTracks.find(candidate => candidate.id === audio.getAttribute('data-bookmanager-audio-track'))
            || inlineTracks.find(candidate => candidate.anchor === audio.id);
        if (!track) {
            audio.remove();
            return;
        }
        const proxy = document.createElement('span');
        for (const attribute of ['id', 'class', 'style', 'hidden', 'dir', 'lang']) {
            if (audio.hasAttribute(attribute)) proxy.setAttribute(attribute, audio.getAttribute(attribute));
        }
        proxy.id = String(track.anchor);
        proxy.dataset.epubAudioId = String(track.id);
        proxy.dataset.epubAudioAnchor = String(track.anchor);
        const controls = audio.hasAttribute('controls');
        proxy.dataset.epubAudioControls = String(controls);
        if (controls) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bookmanager-epub-audio-control';
            button.dataset.epubAudioId = String(track.id);
            button.dataset.epubAudioAnchor = String(track.anchor);
            button.dataset.epubAudioTitle = String(track.title || '');
            button.setAttribute('aria-pressed', 'false');
            button.setAttribute('aria-label', `${DEFAULT_EPUB_AUDIO_LABELS.play}${track.title ? ` · ${track.title}` : ''}`);
            const icon = document.createElement('span');
            icon.className = 'bookmanager-epub-audio-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '▶';
            const label = document.createElement('span');
            label.className = 'bookmanager-epub-audio-label';
            label.textContent = button.getAttribute('aria-label');
            button.append(icon, label);
            proxy.append(button);
        }
        audio.replaceWith(proxy);
    });
}

export function buildEpubOriginalDocument(chapter, { mode = 'page', pageSize = {} } = {}) {
    const original = chapter?.original || {};
    const entryName = chapter?.name || '';
    const resources = Object.fromEntries(Object.entries(original.resourceUrls || {}).filter(([name]) => VISUAL_RESOURCE_ENTRY.test(name)));
    const width = Math.max(1, Math.round(Number(pageSize.width) || 600));
    const height = Math.max(1, Math.round(Number(pageSize.height) || 800));
    const fixed = original.layout === 'pre-paginated' && original.viewport?.width > 0 && original.viewport?.height > 0;
    const scrollViewport = mode === 'scroll' && !fixed ? { width, height } : undefined;
    const document = new DOMParser().parseFromString(String(original.html || ''), 'text/html');
    document.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, portal, form, input, button, select, textarea, base, link, video, track, source').forEach(node => node.remove());
    document.querySelectorAll('meta[http-equiv]').forEach(node => node.remove());
    document.querySelectorAll('*').forEach(node => {
        for (const attribute of Array.from(node.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || ['srcdoc', 'autofocus', 'contenteditable', 'ping', 'action', 'formaction', 'target', 'download', 'is'].includes(name)) {
                node.removeAttribute(attribute.name);
            } else if (name === 'style') {
                node.setAttribute(attribute.name, rewriteEpubOriginalCss(attribute.value, entryName, resources, scrollViewport));
            } else if (name === 'srcset') {
                node.setAttribute(attribute.name, rewriteSrcset(attribute.value, entryName, resources));
            } else if (['src', 'poster', 'background', 'href', 'xlink:href'].includes(name)) {
                const isLink = node.localName === 'a' && (name === 'href' || name === 'xlink:href');
                if (isLink) {
                    const href = attribute.value.trim();
                    if (/^https?:\/\//i.test(href)) node.setAttribute('data-original-external-link', href);
                    else {
                        const target = resolveEpubOriginalReference(href, entryName);
                        if (target) {
                            node.setAttribute('data-original-entry', target.entryName);
                            node.setAttribute('data-original-anchor', target.anchor);
                        }
                    }
                    node.setAttribute(attribute.name, '#');
                } else {
                    const resolved = resolveEpubOriginalResource(attribute.value, entryName, resources);
                    if (resolved) node.setAttribute(attribute.name, resolved);
                    else node.removeAttribute(attribute.name);
                }
            }
        }
    });
    document.querySelectorAll('style').forEach(node => {
        node.textContent = rewriteEpubOriginalCss(node.textContent, entryName, resources, scrollViewport);
    });
    replaceEpubAudioElements(document, chapter?.audioTracks);
    const csp = document.createElement('meta');
    csp.httpEquiv = 'Content-Security-Policy';
    const assetSources = new Set(['data:']);
    for (const url of Object.values(resources)) {
        try {
            const parsed = new URL(url, globalThis.location?.href || 'https://bookmanager.invalid/');
            if (['http:', 'https:'].includes(parsed.protocol)) assetSources.add(`${parsed.origin}${parsed.pathname}`);
            else if (parsed.protocol === 'bookmanager-document:') {
                const assetRoot = parsed.pathname.indexOf('/asset/');
                assetSources.add(`${parsed.protocol}//${parsed.host}${assetRoot >= 0 ? parsed.pathname.slice(0, assetRoot + 7) : parsed.pathname}`);
            }
        } catch {}
    }
    const sourceList = [...assetSources].join(' ');
    csp.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${sourceList}; font-src ${sourceList}; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    document.head.prepend(csp);
    if (original.stylesheet) {
        const stylesheet = document.createElement('style');
        stylesheet.textContent = rewriteEpubOriginalCss(original.stylesheet, entryName, resources, scrollViewport);
        document.head.insertBefore(stylesheet, document.head.querySelector('style'));
    }
    const layoutStyle = document.createElement('style');
    layoutStyle.dataset.originalLayout = 'true';
    layoutStyle.textContent = `
        [data-epub-audio-controls="false"] { display: none !important; }
        [data-epub-audio-controls="true"] { max-width: 100%; vertical-align: middle; }
        button.bookmanager-epub-audio-control {
            box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
            width: 176px; max-width: 100%; height: 32px; margin: 0; padding: 5px 9px;
            border: 1px solid currentColor; border-radius: 6px; background: transparent;
            color: inherit; font: 13px/20px sans-serif; text-align: start; vertical-align: middle;
            cursor: pointer; user-select: none; break-inside: avoid;
        }
        button.bookmanager-epub-audio-control:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        button.bookmanager-epub-audio-control[aria-pressed="true"] { background: rgb(128 128 128 / 16%); }
        button.bookmanager-epub-audio-control:disabled { cursor: default; }
        .bookmanager-epub-audio-icon { flex: 0 0 14px; text-align: center; }
        .bookmanager-epub-audio-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        ::highlight(bookmanager-search) { background: #ffd45b; color: #171717; }
        ::highlight(bookmanager-highlight-yellow) { background: rgba(255, 201, 58, 0.48); }
        ::highlight(bookmanager-highlight-green) { background: rgba(83, 214, 128, 0.46); }
        ::highlight(bookmanager-highlight-blue) { background: rgba(80, 168, 255, 0.46); }
        ::highlight(bookmanager-highlight-pink) { background: rgba(255, 125, 179, 0.48); }
        ::highlight(bookmanager-highlight-purple) { background: rgba(185, 139, 255, 0.48); }
    ` + (fixed ? `
        html { width: ${original.viewport.width}px !important; height: ${original.viewport.height}px !important; overflow: hidden !important; }
    ` : mode === 'scroll' ? `
        html { width: ${width}px !important; height: auto !important; min-height: 0 !important; overflow: hidden !important; }
    ` : `
        html { box-sizing: border-box !important; width: ${width}px !important; height: ${height}px !important; min-height: 0 !important; max-height: ${height}px !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; column-width: ${width}px !important; column-gap: 0 !important; column-fill: auto !important; column-count: auto !important; }
    `);
    document.head.append(layoutStyle);
    return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
