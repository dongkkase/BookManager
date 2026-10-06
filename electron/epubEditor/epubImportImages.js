import { clampImageWidth } from './imageSizing.js';
import { attr, tag } from './epubImportXml.js';
import { webpDimensions } from './webp.js';

export function importedImageDimensions(data, extension) {
    if (extension === 'webp') return webpDimensions(data);
    if (extension === 'png' && data.length >= 24 && data.toString('ascii', 12, 16) === 'IHDR') {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    if (extension === 'jpg') {
        let offset = 2;
        while (offset + 3 < data.length && data[offset] === 0xff) {
            while (data[offset] === 0xff) offset += 1;
            const marker = data[offset++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
            if (offset + 2 > data.length) break;
            const length = data.readUInt16BE(offset);
            if (length < 2 || offset + length > data.length) break;
            if (length >= 8 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
            }
            offset += length;
        }
    }
    return null;
}

function dimension(element, name) {
    const css = Object.fromEntries(attr(element, 'style').split(';').map(part => part.split(/:(.*)/s).slice(0, 2)).filter(pair => pair.length === 2).map(([key, value]) => [key.trim().toLowerCase(), value.trim().replace(/\s*!important\s*$/i, '')]));
    const value = css[name] ?? attr(element, name);
    const match = value?.match(/^(\d+(?:\.\d+)?|\.\d+)(px|%)?$/i);
    return match && Number(match[1]) > 0 ? { width: Number(match[1]), widthUnit: match[2]?.toLowerCase() || 'px' } : null;
}

export function importedImageSize(element, container, dimensions) {
    const ancestors = [];
    for (let node = element.parentNode; node?.nodeType === 1 && tag(node) !== 'html'; node = node.parentNode) ancestors.unshift(node);
    let size = null;
    for (const node of [...ancestors, element]) {
        // SVG image dimensions describe its coordinate system, not its displayed size.
        if (node === element && tag(container) === 'svg' && size) continue;
        const width = dimension(node, 'width');
        if (width) size = width.widthUnit === '%' && size ? { ...size, width: size.width * width.width / 100 } : width;
    }
    if (!size && dimensions?.width > 0 && dimensions?.height > 0) {
        const height = dimension(element, 'height');
        size = { width: height?.widthUnit === 'px' ? height.width * dimensions.width / dimensions.height : dimensions.width, widthUnit: 'px' };
    }
    size ||= { width: 100, widthUnit: '%' };
    return { width: clampImageWidth(Math.round(size.width * 100) / 100, size.widthUnit), widthUnit: size.widthUnit };
}
