import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizeSettings, resourceSettings, resourceRemovalSelected } from './model.js';
import { inspectFont, optimizeFont } from './fonts.js';
import { inspectFontReferences } from './fontReferences.js';
import { inspectUnusedResources } from './unusedResources.js';
import { MAX_ENTRY_BYTES, optimizerError, checkCancelled, sameStat, fingerprintFile, openArchive, readEntry, verifyEntry, rewriteArchive, compressedLength } from './archive.js';

export { optimizerError } from './archive.js';
const XML_LIMIT = 16 * 1024 * 1024;
const IMAGE_LIMIT = 32 * 1024 * 1024;
const FONT_LIMIT = 32 * 1024 * 1024;
const FONT_TEXT_LIMIT = 64 * 1024 * 1024;
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
const descendants = (node, name) => Array.from(node.getElementsByTagName('*')).filter(child => child.localName?.toLowerCase() === name);

function parseXml(data) {
    if (data.length > XML_LIMIT) throw optimizerError('EPUB_TOO_LARGE');
    const encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
    let source;
    try { source = new TextDecoder(encoding, { fatal: true }).decode(data); }
    catch { throw optimizerError('EPUB_INVALID'); }
    if (/<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(source)) throw optimizerError('EPUB_INVALID');
    try {
        const document = new DOMParser({ onError: (level, message) => {
            if (level === 'warning' && message === 'Unicode replacement character detected, source encoding issues?') return;
            throw optimizerError('EPUB_INVALID');
        } }).parseFromString(source, 'application/xml');
        if (!document.documentElement) throw optimizerError('EPUB_INVALID');
        return document;
    } catch { throw optimizerError('EPUB_INVALID'); }
}

function resolveReference(base, href) {
    if (!href || /^[a-z][a-z0-9+.-]*:|^[/\\]|[\u0000-\u001f]/i.test(href)) return null;
    let resource;
    try { resource = decodeURIComponent(href.split('#')[0]).normalize('NFC'); }
    catch { return null; }
    if (/[\\?\u0000-\u001f]/.test(resource) || resource.startsWith('/')) return null;
    const name = resource ? path.posix.normalize(path.posix.join(path.posix.dirname(base), resource)) : base;
    return name === '..' || name.startsWith('../') ? null : name;
}

function inferMediaType(name) {
    return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.xhtml': 'application/xhtml+xml', '.html': 'text/html', '.htm': 'text/html', '.xml': 'application/xml', '.opf': 'application/oebps-package+xml', '.ncx': 'application/x-dtbncx+xml', '.smil': 'application/smil+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac' })[path.posix.extname(name).toLowerCase()] || 'application/octet-stream';
}

function resourceKind(mediaType, name) {
    if (mediaType.startsWith('image/')) return 'image';
    if (mediaType.startsWith('font/') || /font|opentype|woff/.test(mediaType) || /\.(ttf|otf|woff2?)$/i.test(name)) return 'font';
    if (mediaType.startsWith('audio/')) return 'audio';
    if (mediaType.startsWith('text/') || /xml|opf|ncx/.test(mediaType)) return 'text';
    return 'other';
}

function imageInfo(data, mimeType) {
    if (mimeType === 'image/png') {
        if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString('ascii', 12, 16) !== 'IHDR') return { reason: 'IMAGE_INVALID' };
        const width = data.readUInt32BE(16);
        const height = data.readUInt32BE(20);
        if (data[24] > 8) return { width, height, reason: 'IMAGE_UNSUPPORTED' };
        let end = false;
        for (let at = 8; at + 12 <= data.length;) {
            const length = data.readUInt32BE(at);
            const type = data.toString('ascii', at + 4, at + 8);
            if (at + 12 + length > data.length) return { reason: 'IMAGE_INVALID' };
            if (type === 'acTL') return { width, height, reason: 'IMAGE_ANIMATED' };
            if (type === 'IEND') { end = true; break; }
            at += 12 + length;
        }
        return end ? { width, height } : { reason: 'IMAGE_INVALID' };
    }
    if (mimeType === 'image/jpeg') {
        if (data.length < 4 || data[0] !== 255 || data[1] !== 216) return { reason: 'IMAGE_INVALID' };
        let dimensions;
        for (let at = 2; at + 3 < data.length;) {
            if (data[at++] !== 255) return { reason: 'IMAGE_INVALID' };
            while (data[at] === 255) at += 1;
            const marker = data[at++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
            if (at + 2 > data.length) return { reason: 'IMAGE_INVALID' };
            const length = data.readUInt16BE(at);
            if (length < 2 || at + length > data.length) return { reason: 'IMAGE_INVALID' };
            if (marker === 0xe2 && data.toString('ascii', at + 2, at + 6) === 'MPF\0') return { reason: 'IMAGE_ANIMATED' };
            if ([0xc0, 0xc1, 0xc2].includes(marker)) {
                if (length < 8) return { reason: 'IMAGE_INVALID' };
                dimensions = { width: data.readUInt16BE(at + 5), height: data.readUInt16BE(at + 3) };
                if (data[at + 2] !== 8 || data[at + 7] === 4) return { ...dimensions, reason: 'IMAGE_UNSUPPORTED' };
            }
            at += length;
        }
        return dimensions || { reason: 'IMAGE_INVALID' };
    }
    return { reason: 'IMAGE_UNSUPPORTED' };
}

async function inspectInternal(filePath, options = {}) {
    checkCancelled(options);
    if (path.extname(filePath).toLowerCase() !== '.epub') throw optimizerError('EPUB_INVALID');
    const archive = await openArchive(filePath);
    const entries = new Map(archive.entries.map(entry => [entry.name, entry]));
    const mimetype = entries.get('mimetype');
    if (!mimetype || !(await readEntry(filePath, mimetype, 100)).equals(Buffer.from('application/epub+zip'))) throw optimizerError('EPUB_INVALID');
    const nonstandardMimetype = mimetype.localHeaderOffset !== 0 || mimetype.method !== 0 || mimetype.localExtraLength !== 0;
    if (options.requireStandardMimetype && nonstandardMimetype) throw optimizerError('EPUB_INVALID');
    if (entries.has('META-INF/signatures.xml')) throw optimizerError('EPUB_SIGNED');
    const container = parseXml(await readEntry(filePath, entries.get('META-INF/container.xml'), XML_LIMIT));
    const roots = descendants(container, 'rootfile').filter(node => node.getAttribute('media-type') === 'application/oebps-package+xml');
    if (!roots.length || roots.length > 16) throw optimizerError('EPUB_INVALID');
    const manifest = new Map();
    const packageDocuments = [];
    const missingResources = [];
    const covers = new Set();
    const coverPages = new Set();
    const warnings = new Set();
    if (nonstandardMimetype) warnings.add('NONSTANDARD_MIMETYPE');
    let fixedLayout = false;
    let version = '';
    for (const root of roots) {
        const name = resolveReference('', root.getAttribute('full-path'));
        const document = parseXml(await readEntry(filePath, entries.get(name), XML_LIMIT));
        const packageNode = document.documentElement;
        const packageVersion = packageNode.getAttribute('version');
        if (packageNode.localName !== 'package' || !/^[23](?:\.|$)/.test(packageVersion)) throw optimizerError('EPUB_INVALID');
        if (!version || packageVersion.startsWith('2')) version = packageVersion;
        packageDocuments.push({ name, document });
        const coverIds = new Set(descendants(document, 'meta').filter(node => node.getAttribute('name') === 'cover').map(node => node.getAttribute('content')));
        fixedLayout ||= descendants(document, 'meta').some(node => node.getAttribute('property') === 'rendition:layout' && node.textContent.trim() === 'pre-paginated'
            || node.getAttribute('name') === 'fixed-layout' && node.getAttribute('content') === 'true');
        fixedLayout ||= descendants(document, 'itemref').some(node => (node.getAttribute('properties') || '').split(/\s+/).includes('rendition:layout-pre-paginated'));
        const ids = new Set();
        const manifestNode = descendants(document, 'manifest')[0];
        if (!manifestNode) throw optimizerError('EPUB_INVALID');
        const spine = descendants(document, 'spine')[0];
        if (!spine) throw optimizerError('EPUB_INVALID');
        const requiredIds = new Set(descendants(spine, 'itemref').map(node => node.getAttribute('idref')));
        if (spine.getAttribute('toc')) requiredIds.add(spine.getAttribute('toc'));
        for (const item of descendants(manifestNode, 'item')) {
            const id = item.getAttribute('id');
            if (!id || ids.has(id)) throw optimizerError('EPUB_INVALID');
            ids.add(id);
            const href = item.getAttribute('href');
            if (/^https?:\/\//i.test(href)) { warnings.add('REMOTE_RESOURCES'); continue; }
            const entryName = resolveReference(name, href);
            if (!entryName) throw optimizerError('EPUB_RESOURCE_MISSING');
            const mediaType = item.getAttribute('media-type') || inferMediaType(entryName);
            const properties = (item.getAttribute('properties') || '').split(/\s+/);
            if (!entries.has(entryName)) {
                if (requiredIds.has(id) || properties.includes('nav')) throw optimizerError('EPUB_RESOURCE_MISSING');
                missingResources.push({ packageName: name, href, name: entryName, mediaType });
                warnings.add('MISSING_RESOURCES');
                continue;
            }
            if (manifest.has(entryName) && manifest.get(entryName) !== mediaType) throw optimizerError('EPUB_INVALID');
            manifest.set(entryName, mediaType);
            if ((item.getAttribute('properties') || '').split(/\s+/).includes('cover-image') || coverIds.has(id)) covers.add(entryName);
            if ((item.getAttribute('properties') || '').split(/\s+/).includes('scripted')) warnings.add('SCRIPTED_CONTENT');
        }
        for (const reference of descendants(document, 'reference')) {
            if (!(reference.getAttribute('type') || '').split(/\s+/).includes('cover')) continue;
            const coverName = resolveReference(name, reference.getAttribute('href'));
            if (coverName && entries.has(coverName)) coverPages.add(coverName);
        }
        if ([...requiredIds].some(id => !ids.has(id))) throw optimizerError('EPUB_INVALID');
    }
    for (const coverName of coverPages) {
        if ((manifest.get(coverName) || inferMediaType(coverName)).startsWith('image/') && !coverName.endsWith('.svg')) {
            covers.add(coverName);
            continue;
        }
        if (entries.get(coverName).uncompressedSize > XML_LIMIT) continue;
        try {
            const document = parseXml(await readEntry(filePath, entries.get(coverName), XML_LIMIT));
            for (const image of [...descendants(document, 'img'), ...descendants(document, 'image')]) {
                const name = resolveReference(coverName, image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href'));
                if (name && entries.has(name) && (manifest.get(name) || inferMediaType(name)).startsWith('image/')) covers.add(name);
            }
        } catch (error) {
            if (error.code !== 'EPUB_INVALID') throw error;
        }
    }
    const encrypted = new Set();
    if (entries.has('META-INF/encryption.xml')) {
        const document = parseXml(await readEntry(filePath, entries.get('META-INF/encryption.xml'), XML_LIMIT));
        const encryptedNodes = descendants(document, 'encrypteddata');
        if (!encryptedNodes.length) throw optimizerError('EPUB_ENCRYPTED');
        for (const node of encryptedNodes) {
            const algorithm = descendants(node, 'encryptionmethod')[0]?.getAttribute('Algorithm');
            const name = resolveReference('', descendants(node, 'cipherreference')[0]?.getAttribute('URI'));
            if (!FONT_OBFUSCATION.has(algorithm) || !name || !entries.has(name) || resourceKind(manifest.get(name) || inferMediaType(name), name) !== 'font') throw optimizerError('EPUB_ENCRYPTED');
            encrypted.add(name);
        }
        warnings.add('OBFUSCATED_FONTS');
    }
    const resources = [];
    for (let index = 0; index < archive.entries.length; index += 1) {
        checkCancelled(options);
        const entry = archive.entries[index];
        if (entry.isDirectory) continue;
        const mediaType = manifest.get(entry.name) || inferMediaType(entry.name);
        const kind = resourceKind(mediaType, entry.name);
        const resource = { name: entry.name, kind, mediaType, originalSize: entry.uncompressedSize, compressedSize: entry.compressedSize, canOptimize: false, isCover: covers.has(entry.name), encrypted: encrypted.has(entry.name) };
        resource.canRecompress = !resource.encrypted && entry.name !== 'mimetype' && entry.uncompressedSize <= MAX_ENTRY_BYTES && entry.compressedSize <= MAX_ENTRY_BYTES;
        if (resource.encrypted) resource.reason = 'FONT_OBFUSCATED';
        else if (kind === 'image') {
            if (!['image/jpeg', 'image/png'].includes(mediaType)) resource.reason = 'IMAGE_UNSUPPORTED';
            else if (entry.uncompressedSize > IMAGE_LIMIT || entry.compressedSize > IMAGE_LIMIT) resource.reason = 'IMAGE_TOO_LARGE';
            else {
                Object.assign(resource, imageInfo(await readEntry(filePath, entry, IMAGE_LIMIT), mediaType));
                if (!resource.reason && (!resource.width || !resource.height || resource.width > 16384 || resource.height > 16384 || resource.width * resource.height > 32 * 1024 * 1024)) resource.reason = 'IMAGE_TOO_LARGE';
                resource.canOptimize = !resource.reason;
            }
        } else if (kind === 'font') {
            if (!manifest.has(entry.name)) resource.reason = 'FONT_REFERENCES_UNSUPPORTED';
            else if (!version.startsWith('3')) resource.reason = 'FONT_EPUB2_UNSUPPORTED';
            else if (warnings.has('SCRIPTED_CONTENT')) resource.reason = 'FONT_REFERENCES_UNSUPPORTED';
            else if (entry.uncompressedSize > FONT_LIMIT || entry.compressedSize > FONT_LIMIT) resource.reason = 'FONT_TOO_LARGE';
            else {
                const info = inspectFont(await readEntry(filePath, entry, FONT_LIMIT));
                resource.canOptimize = info.canOptimize;
                if (info.reason) resource.reason = info.reason;
            }
        }
        resources.push(resource);
        options.onProgress?.({ completed: index + 1, total: archive.entries.length, name: entry.name, percent: Math.round((index + 1) / archive.entries.length * 90), phase: 'analyzing' });
    }
    let fontTexts = null;
    const textResources = resources.filter(resource => resource.kind === 'text' || resource.mediaType === 'image/svg+xml'
        || /javascript|ecmascript/.test(resource.mediaType) || /\.(?:x?html?|xml|opf|ncx|smil|svg|css|js|mjs)$/i.test(resource.name));
    if (!textResources.some(resource => resource.originalSize > XML_LIMIT || resource.compressedSize > XML_LIMIT)
        && textResources.reduce((sum, resource) => sum + resource.originalSize, 0) <= FONT_TEXT_LIMIT) {
        fontTexts = new Map();
        for (const resource of textResources) {
            checkCancelled(options);
            fontTexts.set(resource.name, { name: resource.name, mediaType: resource.mediaType, data: await readEntry(filePath, entries.get(resource.name), XML_LIMIT) });
        }
    }
    const eligibleFonts = resources.filter(resource => resource.kind === 'font' && resource.canOptimize);
    for (const resource of eligibleFonts) {
        await setImmediate();
        checkCancelled(options);
        const references = fontTexts ? inspectFontReferences({ entryName: resource.name, textResources: [...fontTexts.values()] }) : null;
        if (!references?.canConvert) {
            resource.canOptimize = false;
            resource.reason = references?.reason || 'FONT_REFERENCES_UNSUPPORTED';
        }
    }
    await setImmediate();
    checkCancelled(options);
    const unknownManifestType = [...manifest].some(([name, type]) => resourceKind(type, name) === 'other'
        && resourceKind(inferMediaType(name), name) === 'other' && !type.startsWith('video/'));
    const unused = inspectUnusedResources({ resources, textResources: [...fontTexts?.values() || []], packageDocuments,
        protectedNames: [...covers, ...encrypted], incomplete: !fontTexts || warnings.has('SCRIPTED_CONTENT') || unknownManifestType });
    const unusedNames = new Set(unused.unusedNames);
    for (const resource of resources) {
        const protectedResource = resource.isCover || resource.encrypted || resource.name.startsWith('META-INF/') || !['image', 'font', 'audio'].includes(resource.kind);
        resource.canRemove = !protectedResource && !unused.uncertain && unusedNames.has(resource.name);
        resource.usage = protectedResource ? 'protected' : unused.uncertain ? 'unknown' : resource.canRemove ? 'unused' : 'referenced';
    }
    if (unused.uncertain && resources.some(resource => ['image', 'font', 'audio'].includes(resource.kind))) warnings.add('UNUSED_DETECTION_UNCERTAIN');
    if (fixedLayout) warnings.add('FIXED_LAYOUT');
    const fingerprint = await fingerprintFile(filePath, options);
    if (!sameStat(archive.stat, await fs.stat(filePath))) throw optimizerError('SOURCE_CHANGED');
    return { archive, entries, packageDocuments, fontTexts, analysis: { filePath, size: archive.stat.size, version, fixedLayout, resources, missingResources, warnings: [...warnings], fingerprint } };
}

export async function inspectEpub(filePath, options = {}) {
    return (await inspectInternal(filePath, options)).analysis;
}

function serializeXml(document) {
    return Buffer.from(new XMLSerializer().serializeToString(document).replace(/(<\?xml[^>]*encoding=["'])[^"']+(["'])/i, '$1UTF-8$2'), 'utf8');
}

async function prepareFonts(filePath, state, settings, temporaryDirectory, options, warnings) {
    const replacements = new Map();
    const selected = state.analysis.resources.filter(resource => resource.kind === 'font' && resourceSettings(resource, settings, state.analysis).enabled);
    if (!selected.length) return { replacements, fontPaths: new Map() };
    const texts = new Map([...state.fontTexts || []].map(([name, resource]) => [name, { ...resource }]));
    const fontPaths = new Map();
    for (const resource of selected) {
        checkCancelled(options);
        const converted = optimizeFont(await readEntry(filePath, state.entries.get(resource.name), FONT_LIMIT));
        if (!converted.optimized || compressedLength(converted.data) >= resource.compressedSize) continue;
        const references = inspectFontReferences({ entryName: resource.name, textResources: [...texts.values()] });
        if (!references.canConvert) { warnings.add(references.reason || 'FONT_REFERENCES_UNSUPPORTED'); continue; }
        for (const update of references.updates) {
            replacements.set(update.name, Buffer.from(update.data));
            texts.get(update.name).data = Buffer.from(update.data);
        }
        for (const { name, document } of state.packageDocuments) {
            let changed = false;
            for (const item of descendants(document, 'item')) {
                if (resolveReference(name, item.getAttribute('href')) !== resource.name) continue;
                item.setAttribute('media-type', 'font/woff');
                changed = true;
            }
            if (changed) replacements.set(name, serializeXml(document));
        }
        const temporaryPath = path.join(temporaryDirectory, randomUUID());
        await fs.writeFile(temporaryPath, converted.data, { flag: 'wx' });
        fontPaths.set(resource.name, temporaryPath);
    }
    return { replacements, fontPaths };
}

function prepareRemovals(state, removedNames, replacements) {
    if (!removedNames.size) return;
    for (const { name, document } of state.packageDocuments) {
        let changed = false;
        for (const manifest of descendants(document, 'manifest')) {
            for (const item of descendants(manifest, 'item')) {
                if (!removedNames.has(resolveReference(name, item.getAttribute('href')))) continue;
                item.parentNode.removeChild(item);
                changed = true;
            }
        }
        if (changed) replacements.set(name, serializeXml(document));
    }
}

async function publishOutput(temporaryPath, filePath, options) {
    const extension = path.extname(filePath);
    const base = filePath.slice(0, -extension.length);
    for (let suffix = 0; suffix < 10000; suffix += 1) {
        checkCancelled(options);
        const outputPath = `${base}.optimized${suffix ? ` (${suffix})` : ''}.epub`;
        try {
            await fs.link(temporaryPath, outputPath);
            return outputPath;
        } catch (error) {
            if (error.code === 'EEXIST') continue;
            if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
            try { await fs.copyFile(temporaryPath, outputPath, 1); return outputPath; }
            catch (copyError) { if (copyError.code === 'EEXIST') continue; throw copyError; }
        }
    }
    throw optimizerError('OUTPUT_PATH_UNAVAILABLE');
}

async function createOriginalBackup(filePath, fingerprint, options) {
    const directory = path.join(path.dirname(filePath), 'bak');
    const extension = path.extname(filePath);
    const stem = path.basename(filePath, extension);
    try {
        checkCancelled(options);
        await fs.mkdir(directory, { recursive: true });
        for (let suffix = 0; suffix < 10000; suffix += 1) {
            checkCancelled(options);
            const backupPath = path.join(directory, `${stem}${suffix ? `_${suffix}` : ''}${extension}`);
            try {
                await fs.copyFile(filePath, backupPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
            } catch (error) {
                if (error.code === 'EEXIST') continue;
                throw error;
            }
            try {
                checkCancelled(options);
                if (await fingerprintFile(backupPath, options) !== fingerprint) throw optimizerError('SOURCE_CHANGED');
                return backupPath;
            } catch (error) {
                await fs.rm(backupPath, { force: true }).catch(() => {});
                throw error;
            }
        }
        throw optimizerError('EPUB_BACKUP_FAILED');
    } catch (error) {
        if (['SOURCE_CHANGED', 'TASK_CANCELLED'].includes(error.code)) throw error;
        throw optimizerError('EPUB_BACKUP_FAILED');
    }
}

export async function optimizeEpub(filePath, input = {}, options = {}) {
    const requestedPath = filePath;
    if (options.overwrite === true && (await fs.lstat(filePath)).isSymbolicLink()) filePath = await fs.realpath(filePath);
    const settings = normalizeSettings(input);
    const state = await inspectInternal(filePath, { shouldCancel: options.shouldCancel });
    if (options.expectedFingerprint && options.expectedFingerprint !== state.analysis.fingerprint) throw optimizerError('SOURCE_CHANGED');
    const warnings = new Set(state.analysis.warnings);
    const temporaryPath = path.join(path.dirname(filePath), `.bookmanager-optimize-${randomUUID()}.epub`);
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-optimize-'));
    let backupPath = '';
    let committed = false;
    let replacementAttempted = false;
    try {
        const removedResources = state.analysis.resources.filter(resource => resourceRemovalSelected(resource, settings))
            .map(({ name, kind, compressedSize }) => ({ name, kind, compressedSize }));
        const removedNames = new Set(removedResources.map(resource => resource.name));
        const { replacements, fontPaths } = await prepareFonts(filePath, state, settings, temporaryDirectory, options, warnings);
        prepareRemovals(state, removedNames, replacements);
        const resources = new Map(state.analysis.resources.map(resource => [resource.name, resource]));
        const normalizeMimetype = warnings.has('NONSTANDARD_MIMETYPE');
        const rewriteInput = normalizeMimetype ? { ...state.archive, entries: [state.entries.get('mimetype'), ...state.archive.entries.filter(entry => entry.name !== 'mimetype')] } : state.archive;
        await rewriteArchive(filePath, temporaryPath, rewriteInput, async entry => {
            checkCancelled(options);
            await verifyEntry(filePath, entry, options);
            if (removedNames.has(entry.name)) return { remove: true };
            if (entry.name === 'mimetype') return normalizeMimetype ? { data: Buffer.from('application/epub+zip'), required: true } : null;
            if (replacements.has(entry.name)) return { data: replacements.get(entry.name), required: true };
            if (fontPaths.has(entry.name)) return { data: await fs.readFile(fontPaths.get(entry.name)), required: true };
            const resource = resources.get(entry.name);
            if (!resource || resource.encrypted) return null;
            const selected = resourceSettings(resource, settings, state.analysis);
            if (resource.kind === 'image' && selected.enabled && options.transformImage) {
                const original = await readEntry(filePath, entry, IMAGE_LIMIT);
                try {
                    const transformed = await options.transformImage({ data: original, mimeType: resource.mediaType, settings: selected, name: entry.name });
                    checkCancelled(options);
                    const data = Buffer.from(transformed?.data || transformed || []);
                    const dimensions = imageInfo(data, resource.mediaType);
                    if (!data.length || data.length > IMAGE_LIMIT || dimensions.reason || !dimensions.width || !dimensions.height) throw optimizerError('IMAGE_INVALID');
                    if (compressedLength(data) < entry.compressedSize) return { data };
                } catch (error) {
                    checkCancelled(options);
                    if (error.code === 'TASK_CANCELLED') throw error;
                    warnings.add('IMAGE_OPTIMIZATION_FAILED');
                }
            }
            if (settings.recompress && entry.uncompressedSize <= MAX_ENTRY_BYTES && entry.compressedSize <= MAX_ENTRY_BYTES) return { data: await readEntry(filePath, entry) };
            return null;
        }, options);
        checkCancelled(options);
        options.onProgress?.({ completed: 0, total: state.archive.entries.length, name: '', percent: 90, phase: 'validating' });
        const outputArchive = await openArchive(temporaryPath);
        const expectedNames = new Set(state.archive.entries.filter(entry => !removedNames.has(entry.name)).map(entry => entry.name));
        if (outputArchive.entries.length !== expectedNames.size || outputArchive.entries.some(entry => !expectedNames.has(entry.name))) throw optimizerError('EPUB_INVALID');
        for (const entry of outputArchive.entries) await verifyEntry(temporaryPath, entry, options);
        const outputState = await inspectInternal(temporaryPath, { shouldCancel: options.shouldCancel, requireStandardMimetype: true });
        if (JSON.stringify(outputState.analysis.missingResources) !== JSON.stringify(state.analysis.missingResources)) throw optimizerError('EPUB_RESOURCE_MISSING');
        if (!sameStat(state.archive.stat, await fs.stat(filePath)) || await fingerprintFile(filePath, options) !== state.analysis.fingerprint) throw optimizerError('SOURCE_CHANGED');
        const originalSize = state.analysis.size;
        const outputSize = outputArchive.stat.size;
        if (outputSize >= originalSize) return { status: 'unchanged', outputPath: null, backupPath: '', originalSize, outputSize: originalSize, savedBytes: 0, removedResources: [], warnings: [...warnings] };
        if (options.backup === true) {
            backupPath = await createOriginalBackup(filePath, state.analysis.fingerprint, options);
            if (await fingerprintFile(filePath, options) !== state.analysis.fingerprint || !sameStat(state.archive.stat, await fs.stat(filePath))) throw optimizerError('SOURCE_CHANGED');
        }
        checkCancelled(options);
        let outputPath;
        if (options.overwrite === true) {
            replacementAttempted = true;
            await fs.rename(temporaryPath, filePath);
            outputPath = requestedPath;
        } else {
            outputPath = await publishOutput(temporaryPath, filePath, options);
        }
        committed = true;
        options.onProgress?.({ completed: state.archive.entries.length, total: state.archive.entries.length, name: '', percent: 100, phase: 'complete' });
        return { status: 'saved', outputPath, backupPath, originalSize, outputSize, savedBytes: originalSize - outputSize, removedResources, warnings: [...warnings] };
    } catch (error) {
        if (backupPath && replacementAttempted) error.backupPath = backupPath;
        throw error;
    } finally {
        if (!committed && !replacementAttempted && backupPath) await fs.rm(backupPath, { force: true }).catch(() => {});
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
}
