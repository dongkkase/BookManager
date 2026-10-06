import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { crc32, getZipEntryCompressedData, listZipEntries } from '../core/zipArchive.js';
import { assetFilename, createChapter, createProject, MAX_CHAPTERS, MAX_PROJECT_BYTES, newId, projectError, validateProject } from './model.js';
import { identifyAsset, validateAudio } from './package.js';
import { attr, descendants, elements, epubReference, parseEpubXml, tag } from './epubImportXml.js';
import { importChapterContent, resolveImportedLinks } from './epubImportContent.js';
import { importedImageDimensions } from './epubImportImages.js';

const MAX_EPUB_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

async function readArchive(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw projectError('EPUB_INVALID');
    if (stat.size > MAX_EPUB_BYTES) throw projectError('EPUB_TOO_LARGE');
    const buffer = await fs.readFile(filePath);
    if (buffer.length !== stat.size) throw projectError('EXTERNAL_CHANGE');
    let entries;
    try { entries = listZipEntries(buffer); } catch { throw projectError('EPUB_INVALID'); }
    if (!entries.length || entries.length > 10000) throw projectError('EPUB_INVALID');
    const files = new Map();
    let total = 0;
    for (const entry of entries) {
        const name = entry.name;
        if (files.has(name) || /^[\/\\]|[\\\u0000-\u001f]/.test(name) || name.split('/').some(part => part === '..' || part === '.') || (entry.externalAttrs >>> 16 & 0xf000) === 0xa000) throw projectError('EPUB_INVALID');
        if (entry.flags & 1) throw projectError('EPUB_ENCRYPTED');
        if (![0, 8].includes(entry.method)) throw projectError('EPUB_INVALID');
        total += entry.uncompressedSize;
        if (total > MAX_EXPANDED_BYTES) throw projectError('EPUB_TOO_LARGE');
        files.set(name, entry);
    }
    const read = name => {
        const entry = files.get(name);
        if (!entry) throw projectError('EPUB_RESOURCE_MISSING', name);
        if (entry.uncompressedSize > 20 * 1024 * 1024) throw projectError('EPUB_TOO_LARGE');
        try {
            const compressed = getZipEntryCompressedData(buffer, entry);
            if (!compressed) throw projectError('EPUB_INVALID');
            const data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 20 * 1024 * 1024 });
            if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) throw projectError('EPUB_INVALID');
            return data;
        } catch (error) {
            if (error.code === 'EPUB_INVALID') throw error;
            throw projectError('EPUB_INVALID');
        }
    };
    if (read('mimetype').toString('utf8').trim() !== 'application/epub+zip') throw projectError('EPUB_INVALID');
    if (files.has('META-INF/encryption.xml')) {
        const encrypted = parseEpubXml(read('META-INF/encryption.xml'));
        if (descendants(encrypted, 'encrypteddata').length) throw projectError('EPUB_ENCRYPTED');
    }
    return { files, read };
}

export async function importEpubPackage(filePath, assetDirectory, language = 'ko', onProgress = () => {}) {
    const { files, read } = await readArchive(filePath);
    const container = parseEpubXml(read('META-INF/container.xml'));
    const root = descendants(container, 'rootfile').find(node => attr(node, 'media-type') === 'application/oebps-package+xml') || descendants(container, 'rootfile')[0];
    const opfPath = epubReference('', attr(root || {}, 'full-path'))?.name;
    if (!opfPath) throw projectError('EPUB_INVALID');
    const opf = parseEpubXml(read(opfPath));
    if (tag(opf.documentElement) !== 'package') throw projectError('EPUB_INVALID');
    const metadata = elements(opf.documentElement).find(node => tag(node) === 'metadata');
    const manifestNode = elements(opf.documentElement).find(node => tag(node) === 'manifest');
    const spine = elements(opf.documentElement).find(node => tag(node) === 'spine');
    if (!metadata || !manifestNode || !spine) throw projectError('EPUB_INVALID');
    const project = createProject('blank', language);
    project.cover.mode = 'none';
    const warnings = new Map();
    const warn = (code, name) => {
        if (!warnings.has(code)) warnings.set(code, new Set());
        warnings.get(code).add(name);
    };
    const value = name => elements(metadata).filter(node => tag(node) === name).map(node => node.textContent.trim()).filter(Boolean).join(', ');
    for (const [key, name] of [['title', 'title'], ['author', 'creator'], ['language', 'language'], ['publisher', 'publisher'], ['description', 'description'], ['rights', 'rights']]) {
        const text = value(name);
        if (text) project.metadata[key] = text.slice(0, key === 'description' ? 20000 : 2000);
    }
    if (!value('title')) project.metadata.title = path.basename(filePath, path.extname(filePath)).slice(0, 2000);
    project.metadata.language = elements(metadata).find(node => tag(node) === 'language')?.textContent.trim().slice(0, 2000) || project.metadata.language;
    const identifier = elements(metadata).find(node => tag(node) === 'identifier' && attr(node, 'id') === attr(opf.documentElement, 'unique-identifier'));
    project.metadata.identifier = (identifier?.textContent.trim() || value('identifier') || project.metadata.identifier).slice(0, 2000);
    project.metadata.isbn = (elements(metadata).find(node => tag(node) === 'identifier' && (/isbn/i.test(attr(node, 'opf:scheme')) || /^urn:isbn:/i.test(node.textContent)))?.textContent.trim().replace(/^urn:isbn:/i, '') || '').slice(0, 2000);
    project.metadata.date = value('date').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
    const manifest = new Map();
    for (const node of elements(manifestNode).filter(node => tag(node) === 'item')) {
        const id = attr(node, 'id');
        const reference = epubReference(opfPath, attr(node, 'href'));
        if (!id || manifest.has(id)) throw projectError('EPUB_INVALID');
        manifest.set(id, { id, name: reference?.name, mime: attr(node, 'media-type'), properties: attr(node, 'properties').split(/\s+/) });
    }
    const assets = new Map();
    const imageDimensions = new Map();
    let assetBytes = 0;
    await fs.mkdir(assetDirectory, { recursive: true });
    const items = [...manifest.values()];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.mime === 'text/css') warn('EPUB_IMPORT_STYLE', item.name || item.id);
        if (!/^(image\/|audio\/|font\/|application\/(?:vnd\.ms-opentype|font-|x-font-))/.test(item.mime)) continue;
        if (!item.name || !/\.(png|jpe?g|webp|mp3|m4a|ttf|otf|woff2?)$/i.test(item.name)) { warn('EPUB_IMPORT_MEDIA', item.name || item.id); continue; }
        if (assets.has(item.name)) continue;
        if (!files.has(item.name)) { warn('EPUB_IMPORT_MISSING_ASSET', item.name); continue; }
        const data = read(item.name);
        let type;
        try {
            type = identifyAsset(data);
            if (type.kind === 'audio') await validateAudio(data, type);
        } catch { warn('EPUB_IMPORT_MEDIA', item.name); continue; }
        assetBytes += data.length;
        if (assets.size >= 1000 || assetBytes > MAX_PROJECT_BYTES) throw projectError('EPUB_TOO_LARGE');
        const asset = { id: newId('a'), ...type, name: path.posix.basename(item.name).slice(0, 2000), size: data.length };
        await fs.writeFile(path.join(assetDirectory, assetFilename(asset)), data, { flag: 'wx' });
        project.assets.push(asset);
        assets.set(item.name, asset);
        if (type.kind === 'image') imageDimensions.set(asset.id, importedImageDimensions(data, type.extension));
        onProgress(Math.round((index + 1) / items.length * 35));
    }
    const coverId = elements(metadata).find(node => tag(node) === 'meta' && attr(node, 'name') === 'cover');
    const coverItem = items.find(item => item.properties.includes('cover-image')) || manifest.get(attr(coverId || {}, 'content'));
    if (assets.get(coverItem?.name)?.kind === 'image') project.cover = { ...project.cover, mode: 'image', assetId: assets.get(coverItem.name).id };
    const titles = new Map();
    const nav = items.find(item => item.properties.includes('nav') && item.name);
    const ncx = manifest.get(attr(spine, 'toc')) || items.find(item => item.mime === 'application/x-dtbncx+xml');
    if (nav || ncx) {
        const item = nav || ncx;
        const doc = parseEpubXml(read(item.name));
        if (nav) {
            const toc = descendants(doc, 'nav').find(node => /(?:^|\s)toc(?:\s|$)/.test(attr(node, 'epub:type')) || attr(node, 'role') === 'doc-toc');
            for (const link of toc ? descendants(toc, 'a') : []) {
                const target = epubReference(item.name, attr(link, 'href'));
                if (target && !titles.has(target.name)) titles.set(target.name, link.textContent.trim());
            }
        } else {
            for (const point of descendants(doc, 'navpoint')) {
                const target = epubReference(item.name, attr(elements(point).find(node => tag(node) === 'content') || {}, 'src'));
                const label = elements(point).find(node => tag(node) === 'navlabel')?.textContent.trim();
                if (target && label && !titles.has(target.name)) titles.set(target.name, label);
            }
        }
    }
    const chapterItems = elements(spine).filter(node => tag(node) === 'itemref').map(node => manifest.get(attr(node, 'idref')));
    if (!chapterItems.length || chapterItems.length > MAX_CHAPTERS) throw projectError('EPUB_INVALID');
    const chapters = new Map();
    const links = [];
    for (let index = 0; index < chapterItems.length; index += 1) {
        const item = chapterItems[index];
        if (!item?.name || !['application/xhtml+xml', 'text/html'].includes(item.mime)) throw projectError('EPUB_UNSUPPORTED_DOCUMENT');
        if (chapters.has(item.name)) throw projectError('EPUB_INVALID');
        const doc = parseEpubXml(read(item.name));
        const body = descendants(doc, 'body')[0];
        if (!body) throw projectError('EPUB_INVALID');
        const title = titles.get(item.name) || descendants(doc, 'title')[0]?.textContent.trim() || descendants(body, 'h1')[0]?.textContent.trim() || path.posix.basename(item.name);
        const chapter = createChapter(title.slice(0, 2000));
        const anchors = new Map();
        if (descendants(doc, 'style').length || descendants(doc, 'link').some(node => attr(node, 'rel').split(/\s+/).includes('stylesheet')) || Array.from(doc.getElementsByTagName('*')).some(node => attr(node, 'style') || attr(node, 'class'))) warn('EPUB_IMPORT_STYLE', item.name);
        chapter.content = importChapterContent(body, { source: item.name, assets, imageDimensions, anchors, links, warn });
        chapters.set(item.name, { chapter, anchors });
        onProgress(35 + Math.round((index + 1) / chapterItems.length * 60));
    }
    resolveImportedLinks(chapters, links, warn);
    project.chapters = [...chapters.values()].map(({ chapter }) => chapter);
    if (project.cover.mode === 'image' && project.chapters.length > 1) {
        const first = project.chapters[0];
        const blocks = first.content.content;
        if (blocks.length === 1 && blocks[0].type === 'image' && blocks[0].attrs.assetId === project.cover.assetId && !blocks[0].attrs.caption && !links.some(({ mark }) => mark.type === 'link' && mark.attrs.href.split('#')[0] === `epub:${first.id}`)) project.chapters.shift();
    }
    validateProject(project);
    onProgress(100);
    return { project, warnings: [...warnings].map(([code, names]) => ({ code, count: names.size, names: [...names].slice(0, 20) })) };
}
