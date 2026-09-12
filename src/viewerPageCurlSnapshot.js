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

async function snapshotFontStyles(families) {
    const rules = [];
    const visit = styleRules => {
        for (const rule of styleRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
                const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').toLowerCase();
                if ([...families].some(value => value.includes(family))) rules.push(rule);
            } else if (rule.cssRules) visit(rule.cssRules);
        }
    };
    for (const sheet of document.styleSheets) {
        try { visit(sheet.cssRules); } catch { /* External stylesheets can disallow CSSOM access. */ }
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

async function snapshotReaderPage(node, width, height, pixelRatio) {
    const clone = node.cloneNode(true);
    const originals = [node, ...node.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];
    const families = new Set();
    originals.forEach((original, index) => {
        const copy = copies[index];
        const computed = getComputedStyle(original);
        for (const property of computed) copy.style.setProperty(property, computed.getPropertyValue(property));
        copy.style.visibility = 'visible';
        copy.style.animation = 'none';
        copy.style.transition = 'none';
        families.add(computed.fontFamily.replace(/["']/g, '').toLowerCase());
        if (original instanceof HTMLImageElement) {
            copy.removeAttribute('srcset');
            copy.src = inlineImage(original);
        }
    });
    Object.assign(clone.style, {
        position: 'relative', left: 'auto', top: 'auto', margin: '0', transform: 'none',
        width: `${width}px`, height: `${height}px`,
    });
    const fontStyles = await snapshotFontStyles(families);
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
