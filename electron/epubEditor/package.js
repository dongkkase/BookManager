import fs from 'node:fs/promises';
import { safeCss } from './css.js';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32, listZipEntries, getZipEntryCompressedData } from '../core/zipArchive.js';
import { MAX_PROJECT_BYTES, MAX_DOCUMENT_BYTES, validateProject, inspectProject, projectError, assetFilename, chapterXhtml, bookCss, coverSvg, xml, walkDocument, textContent } from './model.js';

export async function writePackage(filePath, entries, onProgress = () => {}) {
    const file = await fs.open(filePath, 'wx');
    let offset = 0;
    const central = [];
    const write = async buffer => {
        let done = 0;
        while (done < buffer.length) {
            const result = await file.write(buffer, done, buffer.length - done, offset);
            if (!result.bytesWritten) throw projectError('WRITE_FAILED');
            done += result.bytesWritten;
            offset += result.bytesWritten;
        }
    };
    try {
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const data = entry.path ? await fs.readFile(entry.path) : Buffer.from(entry.data);
            if (data.length > (entry.name === 'project.json' ? MAX_DOCUMENT_BYTES : MAX_PROJECT_BYTES)) throw projectError('PROJECT_TOO_LARGE');
            const compressed = entry.store ? data : deflateRawSync(data);
            const name = Buffer.from(entry.name, 'utf8');
            const start = offset;
            const checksum = crc32(data);
            const header = Buffer.alloc(30);
            header.writeUInt32LE(0x04034b50, 0);
            header.writeUInt16LE(20, 4);
            header.writeUInt16LE(0x800, 6);
            header.writeUInt16LE(entry.store ? 0 : 8, 8);
            header.writeUInt16LE(0x21, 12);
            header.writeUInt32LE(checksum, 14);
            header.writeUInt32LE(compressed.length, 18);
            header.writeUInt32LE(data.length, 22);
            header.writeUInt16LE(name.length, 26);
            await write(header);
            await write(name);
            await write(compressed);
            const record = Buffer.alloc(46);
            record.writeUInt32LE(0x02014b50, 0);
            record.writeUInt16LE(20, 4);
            header.copy(record, 6, 4, 28);
            record.writeUInt32LE(start, 42);
            central.push(record, name);
            onProgress(Math.round((index + 1) / entries.length * 90));
        }
        const centralOffset = offset;
        for (const record of central) await write(record);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(entries.length, 8);
        end.writeUInt16LE(entries.length, 10);
        end.writeUInt32LE(offset - centralOffset, 12);
        end.writeUInt32LE(centralOffset, 16);
        await write(end);
        await file.sync();
    } finally {
        await file.close();
    }
}

function assetEntries(project, assetDirectory, prefix = 'assets/') {
    return project.assets.map(asset => ({ name: `${prefix}${assetFilename(asset)}`, path: path.join(assetDirectory, assetFilename(asset)), store: true }));
}

export async function saveProjectPackage(filePath, project, assetDirectory, onProgress) {
    validateProject(project);
    await verifyAssets(project, assetDirectory);
    await writePackage(filePath, [
        { name: 'project.json', data: JSON.stringify(project) },
        ...assetEntries(project, assetDirectory),
    ], onProgress);
}

export async function verifyAssets(project, directory) {
    for (const asset of project.assets) {
        const stat = await fs.stat(path.join(directory, assetFilename(asset))).catch(() => null);
        if (!stat?.isFile() || stat.size !== asset.size) throw projectError('ASSET_MISSING');
    }
}

export async function openProjectPackage(filePath, assetDirectory) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_PROJECT_BYTES + MAX_DOCUMENT_BYTES + 1024 * 1024) throw projectError('PROJECT_TOO_LARGE');
    const buffer = await fs.readFile(filePath);
    if (buffer.length !== stat.size) throw projectError('EXTERNAL_CHANGE');
    const entries = listZipEntries(buffer);
    if (!entries.length || entries.length > 1001) throw projectError('INVALID_PROJECT');
    const names = new Set();
    let total = 0;
    for (const entry of entries) {
        if (names.has(entry.name) || (entry.flags & 1) || ![0, 8].includes(entry.method) || (entry.externalAttrs >>> 16 & 0xf000) === 0xa000) throw projectError('INVALID_PROJECT');
        if (entry.name !== 'project.json' && !/^assets\/[a-z][a-z0-9_-]{0,79}\.(png|jpg|ttf|otf|woff2?|mp3|m4a)$/i.test(entry.name)) throw projectError('INVALID_PROJECT');
        names.add(entry.name);
        total += entry.uncompressedSize;
    }
    if (total > MAX_PROJECT_BYTES + MAX_DOCUMENT_BYTES) throw projectError('PROJECT_TOO_LARGE');
    const read = entry => {
        if (!entry) throw projectError('INVALID_PROJECT');
        const limit = entry.name === 'project.json' ? MAX_DOCUMENT_BYTES : 20 * 1024 * 1024;
        if (entry.uncompressedSize > limit) throw projectError('PROJECT_TOO_LARGE');
        const compressed = getZipEntryCompressedData(buffer, entry);
        if (!compressed) throw projectError('INVALID_PROJECT');
        const data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: limit });
        if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) throw projectError('INVALID_PROJECT');
        return data;
    };
    const project = validateProject(JSON.parse(read(entries.find(entry => entry.name === 'project.json')).toString('utf8')));
    if (entries.length !== project.assets.length + 1) throw projectError('INVALID_PROJECT');
    await fs.mkdir(assetDirectory, { recursive: true });
    for (const asset of project.assets) {
        const data = read(entries.find(entry => entry.name === `assets/${assetFilename(asset)}`));
        if (data.length !== asset.size || identifyAsset(data).extension !== asset.extension) throw projectError('INVALID_ASSET');
        if (asset.kind === 'audio') await validateAudio(data, asset);
        await fs.writeFile(path.join(assetDirectory, assetFilename(asset)), data, { flag: 'wx' });
    }
    return project;
}

export function identifyAsset(buffer) {
    if (buffer.length < 12 || buffer.length > 20 * 1024 * 1024) throw projectError('INVALID_ASSET');
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mime: 'image/png', kind: 'image' };
    if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { extension: 'jpg', mime: 'image/jpeg', kind: 'image' };
    if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 6) !== 0 && (buffer[2] & 0xf0) !== 0xf0)) return { extension: 'mp3', mime: 'audio/mpeg', kind: 'audio' };
    if (buffer.toString('ascii', 4, 8) === 'ftyp' && ['M4A ', 'isom', 'mp41', 'mp42'].includes(buffer.toString('ascii', 8, 12))) return { extension: 'm4a', mime: 'audio/mp4', kind: 'audio' };
    const signatures = { OTTO: 'otf', wOFF: 'woff', wOF2: 'woff2' };
    const extension = signatures[buffer.toString('ascii', 0, 4)] || (buffer.readUInt32BE(0) === 0x00010000 ? 'ttf' : '');
    if (extension) return { extension, mime: `font/${extension}`, kind: 'font' };
    throw projectError('INVALID_ASSET');
}

export async function validateAudio(data, asset) {
    try {
        const { parseBuffer } = await import('music-metadata');
        const { format } = await parseBuffer(data, { mimeType: asset.mime }, { skipCovers: true });
        const codec = asset.extension === 'mp3' ? /^MPEG .* Layer 3$/ : /^MPEG-4\/AAC$/;
        if (!codec.test(format.codec || '') || !format.sampleRate || format.trackInfo?.some(track => track.type === 1)) throw projectError('INVALID_ASSET');
    } catch { throw projectError('INVALID_ASSET'); }
}

export function epubTextEntries(project, modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) {
    validateProject(project);
    if (inspectProject(project).some(issue => issue.severity === 'error')) throw projectError('VALIDATION_FAILED');
    const m = project.metadata;
    const coverAsset = project.assets.find(asset => asset.id === project.cover.assetId);
    const hasCover = project.cover.mode !== 'none';
    const coverHref = project.cover.mode === 'image' ? `assets/${assetFilename(coverAsset)}` : 'cover.svg';
    const manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
        '<item id="css" href="styles/book.css" media-type="text/css" />',
        ...project.chapters.filter(chapter => chapter.css).map(chapter => `<item id="css-${chapter.id}" href="styles/${chapter.id}.css" media-type="text/css" />`),
        ...project.chapters.map(chapter => `<item id="${chapter.id}" href="text/${chapter.id}.xhtml" media-type="application/xhtml+xml" />`),
        ...project.assets.map(asset => `<item id="${asset.id}" href="assets/${assetFilename(asset)}" media-type="${asset.mime}"${project.cover.mode === 'image' && asset.id === coverAsset.id ? ' properties="cover-image"' : ''} />`),
    ];
    if (hasCover) manifest.push('<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" />');
    if (project.cover.mode === 'design') manifest.push('<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image" />');
    const metadata = [`<dc:identifier id="book-id">${xml(m.identifier)}</dc:identifier>`, `<dc:title>${xml(m.title)}</dc:title>`, `<dc:language>${xml(m.language)}</dc:language>`, `<meta property="dcterms:modified">${modified}</meta>`];
    for (const [key, tag] of [['author', 'creator'], ['publisher', 'publisher'], ['description', 'description'], ['rights', 'rights']]) if (m[key]) metadata.push(`<dc:${tag}>${xml(m[key])}</dc:${tag}>`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.date)) metadata.push(`<dc:date>${xml(m.date)}</dc:date>`);
    if (m.isbn.trim()) metadata.push(`<dc:identifier>urn:isbn:${xml(m.isbn.trim())}</dc:identifier>`);
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xml(m.language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata.join('')}</metadata><manifest>${manifest.join('')}</manifest><spine>${hasCover ? '<itemref idref="cover-page" />' : ''}${project.chapters.map(chapter => `<itemref idref="${chapter.id}" />`).join('')}</spine></package>`;
    const toc = project.chapters.filter(chapter => chapter.inToc).map(chapter => {
        const headings = [];
        const stack = [];
        walkDocument(chapter.content, node => {
            if (node.type !== 'heading' || !node.attrs?.id || !textContent(node).trim()) return;
            const item = { node, children: [] };
            while (stack.length && stack.at(-1).node.attrs.level >= node.attrs.level) stack.pop();
            (stack.length ? stack.at(-1).children : headings).push(item);
            stack.push(item);
        });
        const renderHeadings = items => items.length ? `<ol>${items.map(({ node, children }) => `<li><a href="text/${chapter.id}.xhtml#${node.attrs.id}">${xml(textContent(node))}</a>${renderHeadings(children)}</li>`).join('')}</ol>` : '';
        const children = renderHeadings(headings);
        return `<li><a href="text/${chapter.id}.xhtml">${xml(chapter.tocTitle || chapter.title)}</a>${children}</li>`;
    }).join('');
    const nav = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(m.language)}" xml:lang="${xml(m.language)}"><head><title>${xml(m.title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${xml(m.title)}</h1><ol>${toc}</ol></nav><nav epub:type="landmarks"><h2>Landmarks</h2><ol>${hasCover ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>' : ''}<li><a epub:type="bodymatter" href="text/${project.chapters[0].id}.xhtml">${xml(project.chapters[0].title)}</a></li></ol></nav></body></html>`;
    const entries = [
        { name: 'mimetype', data: 'application/epub+zip', store: true },
        { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>' },
        { name: 'EPUB/package.opf', data: packageXml },
        { name: 'EPUB/nav.xhtml', data: nav },
        { name: 'EPUB/styles/book.css', data: bookCss(project) },
        ...project.chapters.filter(chapter => chapter.css).map(chapter => ({ name: `EPUB/styles/${chapter.id}.css`, data: safeCss(chapter.css) })),
        ...project.chapters.map(chapter => ({ name: `EPUB/text/${chapter.id}.xhtml`, data: chapterXhtml(chapter, project) })),
    ];
    if (project.cover.mode === 'design') entries.push({ name: 'EPUB/cover.svg', data: coverSvg(project) });
    if (hasCover) entries.push({ name: 'EPUB/cover.xhtml', data: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="${xml(m.language)}" xml:lang="${xml(m.language)}"><head><title>${xml(m.title)}</title><style>body{margin:0;text-align:center;}img{max-width:100%;max-height:100vh;}</style></head><body><img src="${coverHref}" alt="${xml(m.title)}" /></body></html>` });
    return entries;
}

export async function exportEpubPackage(filePath, project, assetDirectory, onProgress) {
    await verifyAssets(project, assetDirectory);
    await writePackage(filePath, [...epubTextEntries(project), ...assetEntries(project, assetDirectory, 'EPUB/assets/')], onProgress);
}
