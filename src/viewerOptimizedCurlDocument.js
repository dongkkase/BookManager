import { bundledFontFilenameForUrl } from './bundledFonts.js';

function familyName(name) {
    return name.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

// Preserve CSS face descriptors (including weight ranges), replacing only the URL
// when the face is one of BookManager's own packaged fonts.
function mirrorFontStyles(source, used, sessionId) {
    const styles = new Set();
    const sessionPrefix = 'bookmanager-document://session/' + encodeURIComponent(sessionId) + '/';
    const loaded = new Set([...source.fonts].filter(face => face.status === 'loaded').map(face => familyName(face.family)));
    function visit(rules, base) {
        for (const rule of rules) {
            if (rule.type !== CSSRule.FONT_FACE_RULE) {
                if (rule.cssRules) visit(rule.cssRules, base);
                continue;
            }
            const family = familyName(rule.style.getPropertyValue('font-family'));
            const src = rule.style.getPropertyValue('src');
            const match = /^url\("([^"\\]+)"\)(?:\s+format\("[\w-]+"\))?$/i.exec(src);
            const url = match && new URL(match[1], base).href;
            let target;
            if (url?.startsWith(sessionPrefix + 'asset/')) target = url;
            else if (url) {
                const name = bundledFontFilenameForUrl(url);
                if (name) target = sessionPrefix + 'bundled-font/' + encodeURIComponent(name);
            }
            if (target) styles.add(rule.cssText.replace(match[0], () => src.replace(match[1], () => target)));
            else if (used.has(family) && loaded.has(family)) throw new Error('Font is unavailable in the EPUB capture surface.');
        }
    }
    for (const sheet of source.styleSheets) {
        if (sheet.disabled) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        visit(rules, sheet.href || source.baseURI);
    }
    return [...styles].join('\n');
}

export function optimizedCurlDocument(article, sessionId, width, height, cache) {
    const source = article.ownerDocument;
    const markup = article.outerHTML;
    const fontState = [...source.fonts].map(face => face.family + ':' + face.status).join('|');
    const previous = cache.get(article);
    if (previous && previous.markup === markup && previous.fontState === fontState &&
        previous.width === width && previous.height === height) return previous.document;

    const clone = article.cloneNode(true);
    const originals = [article, ...article.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    const declarations = new Map();
    const used = new Set();
    originals.forEach((element, index) => {
        const style = source.defaultView.getComputedStyle(element);
        if ([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) {
            style.fontFamily.split(',').forEach(name => used.add(familyName(name)));
        }
        let css = '';
        for (const property of style) {
            if (!property.startsWith('--') && property !== 'visibility') css += property + ':' + style.getPropertyValue(property) + ';';
        }
        if (!declarations.has(css)) declarations.set(css, declarations.size);
        const copy = copies[index];
        copy.removeAttribute('style');
        copy.setAttribute('data-curl-style', declarations.get(css));
        if (element.localName === 'img') {
            copy.removeAttribute('srcset');
            copy.src = element.currentSrc || element.src;
        }
    });

    let fonts;
    try { fonts = mirrorFontStyles(source, used, sessionId); } catch { return null; }
    const css = [...declarations].map(([value, id]) =>
        '[data-curl-style="' + id + '"]{' + value + 'visibility:visible;animation:none;transition:none;}'
    ).join('\n');
    // Place the measured article at the origin; its position inside the leaf is
    // restored separately when the native bitmap is drawn onto the curl canvas.
    Object.assign(clone.style, { position: 'relative', inset: 'auto', transform: 'none', margin: '0' });
    const document = {
        mode: 'optimized', width: Math.ceil(width), height: Math.ceil(height), backgroundColor: 'transparent',
        html: '<!doctype html><html><head><style data-curl-fonts>' + fonts.replaceAll('<', '\\3c ') +
            '</style><style data-curl-layout>html,body{margin:0;overflow:hidden}' + css.replaceAll('<', '\\3c ') +
            '</style></head><body>' + clone.outerHTML + '</body></html>',
    };
    cache.set(article, { markup, fontState, width, height, document });
    return document;
}
