function makeCanvas(width, height, pixelRatio) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
    canvas.height = Math.max(1, Math.ceil(height * pixelRatio));
    return canvas;
}

function inlineImage(image) {
    const canvas = makeCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
    try {
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas.toDataURL();
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

const fontDataCache = new Map();
const originalResourceCache = new Map();

async function inlineOriginalSnapshotResources(clone) {
    const loadResource = rawUrl => {
        const resolved = new URL(rawUrl, document.baseURI);
        const fragment = resolved.hash;
        resolved.hash = '';
        const url = resolved.href;
        if (!originalResourceCache.has(url)) {
            const pending = fetch(url, { signal: AbortSignal.timeout(600) }).then(response => {
                if (!response.ok) throw new Error('Page curl embedded resource unavailable.');
                return response.blob();
            }).then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }));
            originalResourceCache.set(url, pending);
            if (originalResourceCache.size > 24) originalResourceCache.delete(originalResourceCache.keys().next().value);
        }
        return originalResourceCache.get(url).then(data => `${data}${fragment}`);
    };
    const replacements = [];
    for (const node of [clone, ...clone.querySelectorAll('[style]')]) {
        for (const property of node.style) {
            const value = node.style.getPropertyValue(property);
            if (!value.includes('url(')) continue;
            replacements.push((async () => {
                let nextValue = value;
                for (const [token, doubleQuoted, singleQuoted, bare] of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
                    const url = (doubleQuoted ?? singleQuoted ?? bare).trim();
                    if (!url || /^(?:data:|#)/i.test(url)) continue;
                    nextValue = nextValue.replace(token, `url("${await loadResource(url)}")`);
                }
                node.style.setProperty(property, nextValue);
            })());
        }
    }
    for (const image of clone.querySelectorAll('image')) {
        for (const attribute of ['href', 'xlink:href']) {
            const url = image.getAttribute(attribute);
            if (!url || /^(?:data:|#)/i.test(url)) continue;
            replacements.push(loadResource(url).then(data => image.setAttribute(attribute, data)));
        }
    }
    await Promise.all(replacements);
}

async function snapshotFontStyles(families, documents = [document]) {
    const rules = [];
    const visit = (styleRules, loadedFamilies) => {
        for (const rule of styleRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
                const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').toLowerCase();
                if (loadedFamilies.has(family) && families.has(family)) rules.push(rule);
            } else if (rule.cssRules) visit(rule.cssRules, loadedFamilies);
        }
    };
    for (const sourceDocument of documents) {
        // Unused fallback fonts can add megabytes to every leaf without painting any text.
        const loadedFamilies = new Set([...sourceDocument.fonts]
            .filter(face => face.status === 'loaded')
            .map(face => face.family.replace(/["']/g, '').toLowerCase()));
        for (const sheet of sourceDocument.styleSheets) {
            try { visit(sheet.cssRules, loadedFamilies); } catch { /* External stylesheets can disallow CSSOM access. */ }
        }
    }
    return (await Promise.all(rules.map(async rule => {
        let source = rule.cssText;
        const urls = [...source.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)];
        for (const [token, rawUrl] of urls) {
            const url = new URL(rawUrl, rule.parentStyleSheet?.href || document.baseURI).href;
            if (!fontDataCache.has(url)) {
                const pending = fetch(url, { signal: AbortSignal.timeout(600) }).then(response => {
                    if (!response.ok) throw new Error('Page curl font unavailable.');
                    return response.blob();
                }).then(blob => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                })).catch(() => null);
                fontDataCache.set(url, pending);
                if (fontDataCache.size > 16) fontDataCache.delete(fontDataCache.keys().next().value);
            }
            const data = await fontDataCache.get(url);
            if (!data) return '';
            source = source.replace(token, `url("${data}")`);
        }
        return source;
    }))).join('\n');
}

function cloneReaderSnapshot(node, families, documents) {
    const clone = node.cloneNode(true);
    const originals = [node, ...node.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((original, index) => {
        const media = original.closest('.viewer-epub-inline-media');
        if (media && media !== original) return;
        const copy = copies[index];
        const computed = original.ownerDocument.defaultView.getComputedStyle(original);
        for (const property of computed) copy.style.setProperty(property, computed.getPropertyValue(property));
        copy.style.visibility = 'visible';
        copy.style.animation = 'none';
        copy.style.transition = 'none';
        if (media === original) {
            // Remote players cannot be copied into a canvas; replace only their snapshot contents.
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;padding:12px;overflow:hidden;background:#101214;color:#fff;font:14px/1.4 sans-serif;text-align:center;text-indent:0;writing-mode:horizontal-tb;';
            placeholder.textContent = `▶ ${original.dataset.epubMediaTitle || original.querySelector('iframe')?.title || ''}`.trim();
            copy.replaceChildren(placeholder);
            return;
        }
        if ([...original.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())) {
            computed.fontFamily.split(',').forEach(family => families.add(family.replace(/["']/g, '').trim().toLowerCase()));
        }
        if (original.localName === 'img') {
            copy.removeAttribute('srcset');
            copy.src = inlineImage(original);
        }
        if (original.localName === 'iframe') {
            const sourceDocument = original.contentDocument;
            if (!original.classList.contains('viewer-epub-original-frame')
                || original.dataset.originalReady !== 'true' || !sourceDocument?.body) {
                throw new Error('Page curl embedded document is not ready.');
            }
            documents.add(sourceDocument);
            const viewport = document.createElement('div');
            viewport.style.cssText = copy.style.cssText;
            viewport.style.overflow = 'hidden';
            // A cloned document cannot scroll, so move its columns inside the iframe-sized clip.
            const offset = document.createElement('div');
            offset.style.transform = `translate(${-sourceDocument.documentElement.scrollLeft}px, ${-sourceDocument.documentElement.scrollTop}px)`;
            offset.style.transformOrigin = 'top left';
            const content = cloneReaderSnapshot(sourceDocument.documentElement, families, documents);
            content.style.overflow = 'visible';
            content.querySelectorAll('head, script, style, link, meta').forEach(element => element.remove());
            offset.append(content);
            viewport.append(offset);
            copy.replaceWith(viewport);
        }
    });
    return clone;
}

async function snapshotReaderPage(node, width, height, pixelRatio) {
    const families = new Set();
    const documents = new Set([node.ownerDocument]);
    const clone = cloneReaderSnapshot(node, families, documents);
    Object.assign(clone.style, {
        position: 'relative', left: 'auto', top: 'auto', margin: '0', transform: 'none',
        width: `${width}px`, height: `${height}px`,
    });
    const [fontStyles] = await Promise.all([
        snapshotFontStyles(families, documents),
        documents.size > 1 ? inlineOriginalSnapshotResources(clone) : undefined,
    ]);
    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>${fontStyles.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</style><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = makeCanvas(width, height, pixelRatio);
    try {
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    } catch (error) {
        canvas.width = 0;
        canvas.height = 0;
        throw error;
    } finally {
        image.src = '';
    }
}

function imagePaintRect(image, rect) {
    const style = getComputedStyle(image);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (style.objectFit === 'fill' || !sourceWidth || !sourceHeight) return rect;
    const fitScale = style.objectFit === 'cover'
        ? Math.max(rect.width / sourceWidth, rect.height / sourceHeight)
        : Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
    const width = sourceWidth * fitScale;
    const height = sourceHeight * fitScale;
    const position = style.objectPosition.split(/\s+/);
    const offset = (value, available) => value?.endsWith('%')
        ? available * Number.parseFloat(value) / 100 : Number.parseFloat(value) || 0;
    return {
        x: rect.x + offset(position[0], rect.width - width),
        y: rect.y + offset(position[1] || '50%', rect.height - height),
        width, height,
    };
}

export async function snapshotPageCurlLeaf(node, { width, height, x = 0, pixelRatio = 1 }) {
    const frame = { x, y: 0, width, height };
    if (!node || node.classList.contains('is-blank')) {
        return { image: makeCanvas(1, 1, 1), frame, blank: true };
    }
    const leafRect = node.getBoundingClientRect();
    const scaleX = leafRect.width / width;
    const scaleY = leafRect.height / height;
    if (!(scaleX > 0 && scaleY > 0)) throw new Error('Page curl surface is not laid out.');
    const reader = node.querySelector('.viewer-text-page');
    if (reader) return { image: await snapshotReaderPage(reader, width, height, pixelRatio), frame };

    const quality = node.querySelector('[data-high-quality-ready="true"] .viewer-comic-quality-canvas');
    const source = node.querySelector('.viewer-pdf-canvas') || quality || node.querySelector('.viewer-comic-image');
    if (!source || !(source.naturalWidth || source.width)) throw new Error('Page curl image is not ready.');
    const rect = source.getBoundingClientRect();
    const box = {
        x: (rect.left - leafRect.left) / scaleX,
        y: (rect.top - leafRect.top) / scaleY,
        width: rect.width / scaleX,
        height: rect.height / scaleY,
    };
    const painted = imagePaintRect(source, box);
    const left = Math.max(0, box.x, painted.x);
    const top = Math.max(0, box.y, painted.y);
    const right = Math.min(width, box.x + box.width, painted.x + painted.width);
    const bottom = Math.min(height, box.y + box.height, painted.y + painted.height);
    if (right <= left || bottom <= top) throw new Error('Page curl image has no visible area.');
    const canvas = makeCanvas(right - left, bottom - top, pixelRatio);
    try {
        const context = canvas.getContext('2d');
        context.scale(canvas.width / (right - left), canvas.height / (bottom - top));
        context.drawImage(source, painted.x - left, painted.y - top, painted.width, painted.height);
    } catch (error) {
        canvas.width = 0;
        canvas.height = 0;
        throw error;
    }
    return { image: canvas, frame: { x: x + left, y: top, width: right - left, height: bottom - top } };
}

export function releasePageCurlSnapshots(entries) {
    for (const entry of entries) {
        entry.image.width = 0;
        entry.image.height = 0;
    }
}
