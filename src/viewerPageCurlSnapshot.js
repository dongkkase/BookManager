import { createEpubCurlCapture } from './viewerEpubCurlCapture.js';

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
        if (!node.style.cssText.includes('url(')) continue;
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
                })).catch(() => {
                    if (fontDataCache.get(url) === pending) fontDataCache.delete(url);
                    return null;
                });
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

function copySnapshotStyle(original, copy) {
    const computed = original.ownerDocument.defaultView.getComputedStyle(original);
    copy.style.cssText = Array.from(computed, property => `${property}:${computed.getPropertyValue(property)};`).join('');
    copy.style.visibility = 'visible';
    copy.style.animation = 'none';
    copy.style.transition = 'none';
    return computed;
}

function cloneVisibleTextColumn(source, families) {
    const root = source.documentElement;
    const body = source.body;
    if (!source.head.querySelector('style[data-original-layout]') || body.childElementCount < 32 ||
        body.querySelector(':not(p,h1,h2,h3,h4,h5,h6), :scope > * *')) return null;
    const rootStyle = source.defaultView.getComputedStyle(root);
    const bodyStyle = source.defaultView.getComputedStyle(body);
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (rootStyle.writingMode !== 'horizontal-tb' || rootStyle.direction !== 'ltr' ||
        parseFloat(rootStyle.columnWidth) !== width || parseFloat(rootStyle.columnGap) !== 0 ||
        [rootStyle, bodyStyle].some(style => style.backgroundImage !== 'none' || style.boxShadow !== 'none' ||
            style.transform !== 'none' || style.opacity !== '1' || style.filter !== 'none' ||
            ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0)) ||
        (bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && bodyStyle.backgroundColor !== rootStyle.backgroundColor)) return null;
    const authorStyles = [...source.querySelectorAll('style:not([data-original-layout])')].map(style => style.textContent).join(' ');
    if (/::?(before|after|first-line|first-letter)|(?:background|border|box-shadow|transform|position|float|column|writing-mode|display)\s*:/i.test(authorStyles)) return null;

    const page = document.createElement('div');
    page.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${rootStyle.backgroundColor}`;
    for (const node of body.childNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return null;
            continue;
        }
        const rects = node.getClientRects();
        if (![...rects].some(rect => rect.width && rect.height && rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height)) continue;
        const first = rects[0];
        const copy = node.cloneNode(true);
        const style = copySnapshotStyle(node, copy);
        if (style.display !== 'block' || style.position !== 'static' || style.transform !== 'none' || style.writingMode !== 'horizontal-tb') return null;
        style.fontFamily.split(',').forEach(family => families.add(family.replace(/["']/g, '').trim().toLowerCase()));
        Object.assign(copy.style, { boxSizing: 'border-box', margin: '0', width: `${first.width}px` });
        if (rects.length === 1) {
            // Position a wrapper so the publisher's logical inset properties cannot override the coordinates.
            const block = document.createElement('div');
            block.style.cssText = `position:absolute;left:${first.left}px;top:${first.top}px;width:${first.width}px;height:${first.height}px`;
            block.append(copy);
            page.append(block);
        } else {
            // Start this paragraph at its actual height in its first column so the browser
            // wraps the same lines across the page boundary, including widows and orphans.
            const columns = document.createElement('div');
            columns.style.cssText = `position:absolute;left:${first.left}px;top:0;width:${first.width}px;height:${height}px;column-width:${first.width}px;column-gap:${width - first.width}px;column-fill:auto`;
            const spacer = document.createElement('div');
            spacer.style.height = `${first.top}px`;
            Object.assign(copy.style, { height: 'auto', breakBefore: 'auto', breakAfter: 'auto' });
            columns.append(spacer, copy);
            page.append(columns);
        }
    }
    return page;
}

function cloneReaderSnapshot(node, families, documents) {
    const clone = node.cloneNode(true);
    const originals = [node, ...node.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((original, index) => {
        const media = original.closest('.viewer-epub-inline-media');
        if (media && media !== original) return;
        const copy = copies[index];
        copy.removeAttribute('data-bookmanager-curl-style');
        const computed = copySnapshotStyle(original, copy);
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
            const column = cloneVisibleTextColumn(sourceDocument, families);
            if (column) {
                viewport.append(column);
            } else {
                // A cloned document cannot scroll, so move its columns inside the iframe-sized clip.
                const offset = document.createElement('div');
                offset.style.transform = `translate(${-sourceDocument.documentElement.scrollLeft}px, ${-sourceDocument.documentElement.scrollTop}px)`;
                offset.style.transformOrigin = 'top left';
                const content = cloneReaderSnapshot(sourceDocument.documentElement, families, documents);
                content.style.overflow = 'visible';
                content.querySelectorAll('head, script, style, link, meta').forEach(element => element.remove());
                offset.append(content);
                viewport.append(offset);
            }
            copy.replaceWith(viewport);
        }
    });
    return clone;
}

function shareSnapshotStyles(clones) {
    const styles = new Map();
    for (const clone of clones) {
        if (clone.querySelector('style, link[rel="stylesheet"]')) continue;
        for (const node of [clone, ...clone.querySelectorAll('[style]')]) {
            const value = node.style.cssText;
            if (!value) continue;
            if (!styles.has(value)) styles.set(value, []);
            styles.get(value).push(node);
        }
    }
    const rules = [];
    for (const [value, nodes] of styles) {
        if (nodes.length < 2) continue;
        const name = `s${rules.length}`;
        nodes.forEach(node => {
            node.removeAttribute('style');
            node.setAttribute('data-bookmanager-curl-style', name);
        });
        rules.push(`[data-bookmanager-curl-style="${name}"]{${value}}`);
    }
    return rules.join('\n');
}

async function snapshotReaderPages(entries) {
    const families = new Set();
    const documents = new Set(entries.map(entry => entry.node.ownerDocument));
    const clones = entries.map(({ node, width, height }) => {
        const clone = cloneReaderSnapshot(node, families, documents);
        Object.assign(clone.style, {
            position: 'relative', left: 'auto', top: 'auto', margin: '0', transform: 'none',
            width: `${width}px`, height: `${height}px`,
        });
        return clone;
    });
    const [fontStyles] = await Promise.all([
        snapshotFontStyles(families, documents),
        documents.size > 1 ? Promise.all(clones.map(inlineOriginalSnapshotResources)) : undefined,
    ]);
    // Resource URLs must be embedded before repeated inline styles become shared rules.
    const sharedStyles = shareSnapshotStyles(clones);
    const serializer = new XMLSerializer();
    const width = entries.reduce((total, entry) => total + entry.width, 0);
    const height = Math.max(...entries.map(entry => entry.height));
    let left = 0;
    const fragments = clones.map((clone, index) => {
        const entry = entries[index];
        const fragment = `<foreignObject x="${left}" y="0" width="${entry.width}" height="${entry.height}" overflow="hidden">${serializer.serializeToString(clone)}</foreignObject>`;
        left += entry.width;
        return fragment;
    });
    const styles = `${fontStyles}\n${sharedStyles}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>${styles}</style>${fragments.join('')}</svg>`;
    const image = new Image();
    let atlas;
    const canvases = [];
    try {
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        if (entries.length === 1) {
            const canvas = makeCanvas(width, height, entries[0].pixelRatio);
            canvases.push(canvas);
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvases;
        }
        const pixelRatio = Math.max(...entries.map(entry => entry.pixelRatio));
        atlas = makeCanvas(width, height, pixelRatio);
        atlas.getContext('2d').drawImage(image, 0, 0, atlas.width, atlas.height);
        left = 0;
        for (const entry of entries) {
            const canvas = makeCanvas(entry.width, entry.height, entry.pixelRatio);
            canvases.push(canvas);
            canvas.getContext('2d').drawImage(atlas,
                left * atlas.width / width, 0, entry.width * atlas.width / width, entry.height * atlas.height / height,
                0, 0, canvas.width, canvas.height);
            left += entry.width;
        }
        return canvases;
    } catch (error) {
        canvases.forEach(canvas => { canvas.width = 0; canvas.height = 0; });
        throw error;
    } finally {
        if (atlas) { atlas.width = 0; atlas.height = 0; }
        image.src = '';
    }
}

async function snapshotReaderPage(node, width, height, pixelRatio) {
    return (await snapshotReaderPages([{ node, width, height, pixelRatio }]))[0];
}

export async function snapshotPageCurlLeaves(requests, { epubSessionId, nativeCapture = createEpubCurlCapture(epubSessionId) } = {}) {
    const nativePages = await nativeCapture?.read(requests);
    const results = new Array(requests.length);
    const groups = new Map();
    const pending = [];
    const individually = (request, index) => {
        pending.push(snapshotPageCurlLeaf(request.node, request).then(
            value => { results[index] = { status: 'fulfilled', value }; },
            reason => { results[index] = { status: 'rejected', reason }; },
        ));
    };
    requests.forEach((request, index) => {
        if (nativePages?.[index]) {
            results[index] = { status: 'fulfilled', value: nativePages[index] };
            return;
        }
        const { node, width, height, pixelRatio = 1 } = request;
        const reader = node?.querySelector('.viewer-text-page');
        const bounds = node?.getBoundingClientRect();
        // Separate iframe documents can redefine fonts; inline SVG can reuse fragment IDs.
        if (!reader || node.classList.contains('is-blank') || reader.querySelector('iframe, svg, style, link[rel="stylesheet"]')
            || !(bounds.width / width > 0 && bounds.height / height > 0)) {
            individually(request, index);
            return;
        }
        if (!groups.has(reader.ownerDocument)) groups.set(reader.ownerDocument, []);
        groups.get(reader.ownerDocument).push({ ...request, node: reader, pixelRatio, request, index });
    });
    for (const entries of groups.values()) {
        const width = entries.reduce((total, entry) => total + entry.width, 0);
        const height = Math.max(...entries.map(entry => entry.height));
        const ratio = Math.max(...entries.map(entry => entry.pixelRatio));
        if (entries.length < 2 || Math.max(width, height) * ratio > 8192 || width * height * ratio ** 2 > 32 * 1024 * 1024) {
            entries.forEach(entry => individually(entry.request, entry.index));
            continue;
        }
        pending.push(snapshotReaderPages(entries).then(canvases => {
            entries.forEach((entry, index) => {
                results[entry.index] = {
                    status: 'fulfilled',
                    value: { image: canvases[index], frame: { x: entry.x || 0, y: 0, width: entry.width, height: entry.height } },
                };
            });
        }, reason => {
            entries.forEach(entry => { results[entry.index] = { status: 'rejected', reason }; });
        }));
    }
    await Promise.all(pending);
    return results;
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
