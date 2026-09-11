import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { listZipEntriesFromFile, readZipEntryFromFile, replaceZipEntries } from './core/zipArchive.js';
import { detectImageMimeType, supportedImageExtensionForMimeType } from './imageMagic.js';
import { runMetadataProcess } from './metadataProcess.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.svg']);
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;

function cancelled(options) {
    if (options.shouldCancel?.()) throw Object.assign(new Error('Comic cover editing cancelled.'), { code: 'TASK_CANCELLED' });
}

function entryKey(name) {
    return String(name).replace(/\\/g, '/').normalize('NFC').toLowerCase();
}

function pageCompare(left, right) {
    const a = left.name.replace(/\\/g, '/').normalize('NFC');
    const b = right.name.replace(/\\/g, '/').normalize('NFC');
    const firstA = path.posix.basename(a).startsWith('!');
    const firstB = path.posix.basename(b).startsWith('!');
    if (firstA !== firstB) return firstA ? -1 : 1;
    return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });
}

function isPage(entry) {
    const parts = entry.name.replace(/\\/g, '/').split('/');
    return !entry.isDirectory && !parts.some(part => part === '__MACOSX' || part.startsWith('._'))
        && IMAGE_EXTENSIONS.has(path.posix.extname(entry.name).toLowerCase());
}

function validateEntries(entries) {
    const names = new Map();
    for (const entry of entries) {
        const name = entry.name.replace(/\\/g, '/');
        const parts = name.replace(/\/$/, '').split('/');
        if (!name || name.startsWith('/') || /[\x00-\x1f\x7f:]/.test(name)
            || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
                || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
            throw new Error(`Unsafe archive entry path: ${entry.name}`);
        }
        if (entry.encrypted || (entry.flags & 1)) throw new Error('Encrypted comic archives cannot be edited.');
        const unixType = (entry.externalAttrs >>> 16) & 0xf000;
        if (entry.link || (unixType && unixType !== 0x8000 && unixType !== 0x4000)) {
            throw new Error(`Links and special files cannot be edited: ${entry.name}`);
        }
        const key = entryKey(name).replace(/\/$/, '');
        if (names.has(key)) throw new Error(`Duplicate or case-colliding archive entry: ${entry.name}`);
        names.set(key, entry);
    }
    for (const [key] of names) {
        const parts = key.split('/');
        for (let count = 1; count < parts.length; count += 1) {
            const parent = names.get(parts.slice(0, count).join('/'));
            if (parent && !parent.isDirectory) throw new Error(`Archive file conflicts with a directory: ${parent.name}`);
        }
    }
}

async function strictProcess(command, args, options = {}) {
    cancelled(options);
    if (!command) throw new Error('7-Zip is required to edit this comic archive.');
    const result = await runMetadataProcess(command, args, { maxBytes: 32 * 1024 * 1024, ...options });
    if (result.code !== 0) throw new Error(result.stderr || '7-Zip could not process every archive entry.');
    cancelled(options);
    return result;
}

async function withArchiveAlias(filePath, action) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comic-source-'));
    const alias = path.join(directory, 'source.archive');
    try {
        await fs.copyFile(filePath, alias, fsConstants.COPYFILE_FICLONE);
        return await action(alias);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

async function archiveType(filePath) {
    const handle = await fs.open(filePath, 'r');
    try {
        const bytes = Buffer.alloc(8);
        await handle.read(bytes, 0, bytes.length, 0);
        if (bytes.subarray(0, 2).toString('ascii') === 'PK') return 'zip';
        if (bytes.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'))) return '7z';
        if (bytes.subarray(0, 6).equals(Buffer.from('526172211a07', 'hex'))) return 'rar';
        throw new Error('Unsupported or damaged comic archive.');
    } finally {
        await handle.close();
    }
}

async function inspectArchive(filePath, options = {}) {
    cancelled(options);
    const type = await archiveType(filePath);
    let entries;
    if (type === 'zip') {
        entries = await listZipEntriesFromFile(filePath);
        if (!entries.length) throw new Error('The comic archive has no editable entries.');
        entries = entries.map(entry => ({ ...entry, size: entry.uncompressedSize }));
    } else {
        const result = await withArchiveAlias(filePath, alias => strictProcess(options.sevenZExe, ['l', '-slt', alias], options));
        const separator = result.stdout.match(/^----------\r?$/m);
        if (!separator) throw new Error('7-Zip returned an incomplete archive listing.');
        const header = result.stdout.slice(0, separator.index);
        const volumes = Number(header.match(/^Volumes = (\d+)/m)?.[1] || 1);
        const volumeIndex = Number(header.match(/^Volume Index = (\d+)/m)?.[1] || 0);
        if (volumes > 1 || volumeIndex > 0 || /^Multivolume = \+/m.test(header)) throw new Error('Split comic archives cannot be edited.');
        entries = result.stdout.slice(separator.index + separator[0].length).trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map(block => {
            const fields = Object.fromEntries(block.split(/\r?\n/).map(line => {
                const index = line.indexOf(' = ');
                return index < 0 ? [] : [line.slice(0, index), line.slice(index + 3)];
            }).filter(pair => pair.length === 2));
            return {
                name: fields.Path || '',
                size: Number(fields.Size) || 0,
                isDirectory: fields.Folder === '+' || /^D/.test(fields.Attributes || '') || /(?:^| )d[rwx-]{9}/.test(fields.Attributes || ''),
                encrypted: fields.Encrypted === '+',
                link: Boolean(fields['Symbolic Link'] || fields['Hard Link'] || /(?:^| )[lbcps][rwxstST-]{9}/.test(fields.Attributes || '')),
            };
        });
    }
    validateEntries(entries);
    const pages = entries.filter(isPage).sort(pageCompare);
    const comicInfoEntries = entries.filter(entry => !entry.isDirectory && path.posix.basename(entry.name.replace(/\\/g, '/')).toLowerCase() === 'comicinfo.xml');
    if (comicInfoEntries.length > 1) throw new Error('Multiple ComicInfo.xml files make page metadata ambiguous.');
    return { type, entries, pages, comicInfoEntry: comicInfoEntries[0] || null };
}

export async function inspectComicCover(filePath, options = {}) {
    const archive = await inspectArchive(filePath, options);
    return {
        archiveType: archive.type,
        pages: archive.pages.map(entry => ({ name: entry.name, size: entry.size })),
        coverEntry: archive.pages[0]?.name || '',
    };
}

async function readEntry(filePath, entry, type, options, maxBytes) {
    if (entry.size > maxBytes) throw new Error(`Archive entry is too large: ${entry.name}`);
    if (type === 'zip') {
        const buffer = await readZipEntryFromFile(filePath, entry, { maxBytes, maxCompressedBytes: maxBytes });
        if (buffer) return buffer;
    }
    const result = await withArchiveAlias(filePath, alias => strictProcess(options.sevenZExe, ['e', '-so', '-spd', alias, entry.name], {
        ...options, binary: true, maxBytes,
    }));
    return result.buffer;
}

export async function readComicCoverImage(filePath, entryName, options = {}) {
    const archive = await inspectArchive(filePath, options);
    const entry = archive.pages.find(page => page.name === entryName);
    if (!entry) throw new Error('The selected comic page is no longer available.');
    return readEntry(filePath, entry, archive.type, options, MAX_IMAGE_BYTES);
}

function xmlNodes(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('ComicInfo XML declarations with external entities are unsupported.');
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/g;
    const nodes = [];
    const stack = [];
    let previousEnd = 0;
    for (const match of xml.matchAll(tokens)) {
        if (xml.slice(previousEnd, match.index).includes('<')) throw new Error('ComicInfo.xml is malformed.');
        previousEnd = match.index + match[0].length;
        if (/^<[/!?]?\?|^<!/.test(match[0])) continue;
        const name = match[0].match(/^<\/?([\w:.-]+)/)[1];
        if (match[0].startsWith('</')) {
            const node = stack.pop();
            if (!node || node.name !== name) throw new Error('ComicInfo.xml has mismatched elements.');
            node.closeStart = match.index;
            node.end = previousEnd;
        } else {
            const node = { name, localName: name.split(':').at(-1).toLowerCase(), start: match.index, openEnd: previousEnd, end: previousEnd, raw: match[0], parent: stack.at(-1) || null, selfClosing: /\/\s*>$/.test(match[0]) };
            nodes.push(node);
            if (!node.selfClosing) stack.push(node);
        }
    }
    if (stack.length || xml.slice(previousEnd).includes('<')) throw new Error('ComicInfo.xml is incomplete.');
    const roots = nodes.filter(node => !node.parent);
    if (roots.length !== 1 || roots[0].localName !== 'comicinfo') throw new Error('ComicInfo.xml has no unambiguous ComicInfo root.');
    return { nodes, root: roots[0] };
}

function attribute(tag, name) {
    return tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

function setAttribute(tag, name, value) {
    const pattern = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
    if (value === null) return tag.replace(pattern, '');
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
    return tag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

function updateComicInfo(xml, oldPages, nextPages, entryMap, coverEntry, coverSize) {
    const { nodes, root } = xmlNodes(xml);
    if (root.selfClosing) return updateComicInfo(xml.replace(root.raw, root.raw.replace(/\/\s*>$/, `></${root.name}>`)), oldPages, nextPages, entryMap, coverEntry, coverSize);
    const changes = [];
    const nextIndex = new Map(nextPages.map((page, index) => [page.name, index]));
    const pagesNodes = nodes.filter(node => node.parent === root && node.localName === 'pages');
    const countNodes = nodes.filter(node => node.parent === root && node.localName === 'pagecount');
    if (pagesNodes.length > 1 || countNodes.length > 1) throw new Error('ComicInfo.xml contains ambiguous page metadata.');
    const pageContainer = pagesNodes[0];
    const indices = new Set();
    let hasCover = false;
    for (const page of nodes.filter(node => node.parent === pageContainer && node.localName === 'page')) {
        const oldIndex = attribute(page.raw, 'Image');
        if (!/^\d+$/.test(oldIndex || '') || !oldPages[Number(oldIndex)] || indices.has(Number(oldIndex))) throw new Error('ComicInfo.xml has invalid or duplicate page indexes.');
        indices.add(Number(oldIndex));
        const newName = entryMap[oldPages[Number(oldIndex)].name];
        const index = nextIndex.get(newName);
        if (index === undefined) throw new Error('ComicInfo.xml page could not be preserved.');
        let tag = setAttribute(page.raw, 'Image', String(index));
        const isCover = newName === coverEntry;
        if (isCover) {
            tag = setAttribute(tag, 'Type', 'FrontCover');
            tag = setAttribute(tag, 'ImageSize', String(coverSize));
            tag = setAttribute(setAttribute(tag, 'ImageWidth', null), 'ImageHeight', null);
            hasCover = true;
        } else if (/\bFrontCover\b/i.test(attribute(tag, 'Type') || '')) {
            const type = attribute(tag, 'Type').replace(/\bFrontCover\b/gi, '').replace(/^[,\s]+|[,\s]+$/g, '');
            tag = setAttribute(tag, 'Type', type || null);
        }
        changes.push({ start: page.start, end: page.openEnd, value: tag });
    }
    const prefix = root.name.includes(':') ? `${root.name.split(':')[0]}:` : '';
    const containerName = pageContainer?.name || root.name;
    const pagePrefix = containerName.includes(':') ? `${containerName.split(':')[0]}:` : '';
    const coverTag = `<${pagePrefix}Page Image="${nextIndex.get(coverEntry)}" Type="FrontCover" ImageSize="${coverSize}" />`;
    if (!hasCover) {
        if (pageContainer?.selfClosing) changes.push({ start: pageContainer.start, end: pageContainer.end, value: pageContainer.raw.replace(/\/\s*>$/, `>${coverTag}</${pageContainer.name}>`) });
        else if (pageContainer) changes.push({ start: pageContainer.closeStart, end: pageContainer.closeStart, value: `    ${coverTag}\n` });
        else changes.push({ start: root.closeStart, end: root.closeStart, value: `    <${prefix}Pages>${coverTag}</${prefix}Pages>\n` });
    }
    if (countNodes[0]) {
        const count = countNodes[0];
        changes.push({ start: count.start, end: count.end, value: `${count.raw.replace(/\/\s*>$/, '>')}${nextPages.length}</${count.name}>` });
    } else changes.push({ start: root.closeStart, end: root.closeStart, value: `    <${prefix}PageCount>${nextPages.length}</${prefix}PageCount>\n` });
    changes.sort((a, b) => b.start - a.start);
    let next = xml;
    for (const change of changes) next = next.slice(0, change.start) + change.value + next.slice(change.end);
    return next;
}

function buildPlan(archive, extension, options) {
    const mode = options.mode || 'replace';
    if (!['replace', 'add'].includes(mode)) throw new Error('Unsupported comic cover edit mode.');
    const renumber = options.renumber ?? mode === 'add';
    const target = mode === 'replace' ? (options.targetEntry || archive.pages[0]?.name) : '';
    if (mode === 'replace' && !archive.pages.some(page => page.name === target)) throw new Error('The cover page to replace is no longer available.');
    const occupied = new Set(archive.entries.filter(entry => !isPage(entry)).map(entry => entryKey(entry.name).replace(/\/$/, '')));
    const entryMap = {};
    let coverEntry = '';
    if (renumber) {
        const width = Math.max(4, String(archive.pages.length + (mode === 'add' ? 1 : 0)).length);
        if (mode === 'add') coverEntry = `${String(0).padStart(width, '0')}${extension}`;
        archive.pages.forEach((page, index) => {
            entryMap[page.name] = `${String(index + (mode === 'add' ? 1 : 0)).padStart(width, '0')}${page.name === target ? extension : path.posix.extname(page.name)}`;
            if (page.name === target) coverEntry = entryMap[page.name];
        });
    } else {
        for (const page of archive.pages) entryMap[page.name] = page.name;
        if (mode === 'replace') {
            coverEntry = `${target.slice(0, -path.posix.extname(target).length)}${extension}`;
            entryMap[target] = coverEntry;
        } else {
            const allNames = new Set(archive.entries.map(entry => entryKey(entry.name)));
            for (let count = 1; count <= 512; count += 1) {
                const candidate = `!${' '.repeat(count - 1)}0000-cover${extension}`;
                if (!allNames.has(entryKey(candidate)) && archive.pages.every(page => pageCompare({ name: candidate }, page) < 0)) {
                    coverEntry = candidate;
                    break;
                }
            }
            if (!coverEntry) throw new Error('Please enable page renumbering to insert this cover as the first page.');
        }
    }
    const nextPages = archive.pages.map(page => ({ ...page, name: entryMap[page.name] }));
    if (mode === 'add') nextPages.push({ name: coverEntry, size: 0 });
    nextPages.sort(pageCompare);
    for (const page of nextPages) {
        const key = entryKey(page.name);
        if (occupied.has(key)) throw new Error(`The new page name conflicts with another archive entry: ${page.name}`);
        occupied.add(key);
    }
    const nextEntries = archive.entries.filter(entry => !isPage(entry)).concat(nextPages);
    validateEntries(nextEntries);
    return { mode, target, entryMap, coverEntry, nextPages };
}

async function extractNative(filePath, directory, archive, options) {
    await withArchiveAlias(filePath, alias => strictProcess(options.sevenZExe, ['x', alias, `-o${directory}`, '-y'], options));
    const files = new Map();
    const walk = async relative => {
        for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
            const innerPath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Archive extraction produced a link or special file.');
            if (files.has(entryKey(innerPath))) throw new Error('Archive extraction produced colliding paths.');
            files.set(entryKey(innerPath), { name: innerPath, isDirectory: entry.isDirectory() });
            if (entry.isDirectory()) await walk(innerPath);
        }
    };
    await walk('');
    for (const entry of archive.entries) {
        const extracted = files.get(entryKey(entry.name).replace(/\/$/, ''));
        if (!extracted || extracted.isDirectory !== Boolean(entry.isDirectory)) throw new Error(`Archive entry was not extracted: ${entry.name}`);
        if (!entry.isDirectory && (await fs.stat(path.join(directory, extracted.name))).size !== entry.size) throw new Error(`Archive entry size changed during extraction: ${entry.name}`);
    }
    return files;
}

async function packNative(directory, destination, type, options) {
    await strictProcess(options.sevenZExe, ['a', type === '7z' ? '-t7z' : '-tzip', destination, '.', '-mx=0', '-mmt=on'], { ...options, cwd: directory });
    await strictProcess(options.sevenZExe, ['t', destination], options);
}

function verifyFiles(entries, expected) {
    const files = entries.filter(entry => !entry.isDirectory);
    const actual = new Map(files.map(entry => [entryKey(entry.name), entry.size]));
    if (files.length !== expected.length || expected.some(entry => actual.get(entryKey(entry.name)) !== entry.size)) {
        throw new Error('The rewritten comic archive did not preserve all expected files.');
    }
}

export async function convertComicToZip(sourcePath, destinationPath, options = {}) {
    const archive = await inspectArchive(sourcePath, options);
    if (path.resolve(sourcePath) === path.resolve(destinationPath)) throw new Error('Comic conversion requires a separate destination.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comic-convert-'));
    const output = path.join(directory, 'output.zip');
    const content = path.join(directory, 'content');
    try {
        await fs.mkdir(content);
        await extractNative(sourcePath, content, archive, options);
        await packNative(content, output, 'zip', options);
        const result = await inspectArchive(output, options);
        verifyFiles(result.entries, archive.entries.filter(entry => !entry.isDirectory));
        cancelled(options);
        await fs.copyFile(output, destinationPath, 1);
        return { pageCount: result.pages.length, coverEntry: result.pages[0]?.name || '', archiveType: 'zip' };
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

export async function writeComicCover(filePath, imagePath, options = {}) {
    const archive = await inspectArchive(filePath, options);
    if (archive.type === 'rar') throw new Error('RAR/CBR cover editing requires conversion to a separate CBZ file.');
    const imageStat = await fs.stat(imagePath);
    if (!imageStat.isFile() || imageStat.size > MAX_IMAGE_BYTES || !imageStat.size) throw new Error('The cover must be an image no larger than 64 MiB.');
    const image = await fs.readFile(imagePath);
    const extension = supportedImageExtensionForMimeType(detectImageMimeType(image));
    if (!extension) throw new Error('Choose a PNG, JPEG, WebP, GIF, or BMP cover image.');
    const plan = buildPlan(archive, extension, options);
    const xml = archive.comicInfoEntry
        ? (await readEntry(filePath, archive.comicInfoEntry, archive.type, options, MAX_XML_BYTES)).toString('utf8')
        : '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n</ComicInfo>\n';
    if (/encoding\s*=\s*["'](?!utf-?8["'])/i.test(xml) || xml.includes('\ufffd')) throw new Error('ComicInfo.xml must use UTF-8 to preserve its metadata.');
    const updatedXml = updateComicInfo(xml, archive.pages, plan.nextPages, plan.entryMap, plan.coverEntry, image.length);
    const xmlName = archive.comicInfoEntry?.name || 'ComicInfo.xml';
    cancelled(options);
    if (archive.type === 'zip') {
        await replaceZipEntries(filePath, [
            { name: plan.coverEntry, content: image, options: { store: true } },
            { name: xmlName, content: updatedXml },
        ], {
            shouldCancel: options.shouldCancel,
            removeEntries: plan.target ? [plan.target] : [],
            renameEntries: Object.entries(plan.entryMap).filter(([from, to]) => from !== plan.target && from !== to).map(([from, to]) => ({ from, to })),
        });
    } else {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comic-edit-'));
        const content = path.join(directory, 'content');
        const holding = path.join(directory, 'pages');
        const output = path.join(directory, 'output.7z');
        try {
            await fs.mkdir(content);
            await fs.mkdir(holding);
            const extracted = await extractNative(filePath, content, archive, options);
            let index = 0;
            const moves = [];
            for (const page of archive.pages) {
                const oldPath = path.join(content, extracted.get(entryKey(page.name)).name);
                if (page.name === plan.target) await fs.rm(oldPath);
                else {
                    const held = path.join(holding, String(index++));
                    await fs.rename(oldPath, held);
                    moves.push({ held, target: path.join(content, plan.entryMap[page.name]) });
                }
            }
            for (const move of moves) {
                await fs.mkdir(path.dirname(move.target), { recursive: true });
                await fs.rename(move.held, move.target);
            }
            await fs.mkdir(path.dirname(path.join(content, plan.coverEntry)), { recursive: true });
            await fs.writeFile(path.join(content, plan.coverEntry), image);
            await fs.writeFile(path.join(content, archive.comicInfoEntry ? extracted.get(entryKey(xmlName)).name : xmlName), updatedXml);
            await packNative(content, output, '7z', options);
            const prepared = await inspectArchive(output, options);
            verifyFiles(prepared.entries, [
                ...archive.entries.filter(entry => !entry.isDirectory && !isPage(entry) && entry !== archive.comicInfoEntry),
                ...plan.nextPages.map(page => ({ name: page.name, size: page.name === plan.coverEntry ? image.length : page.size })),
                { name: xmlName, size: Buffer.byteLength(updatedXml) },
            ]);
            cancelled(options);
            const nearSource = path.join(path.dirname(filePath), `.bookmanager-comic-${randomUUID()}.7z`);
            try {
                await fs.copyFile(output, nearSource);
                cancelled(options);
                await fs.rename(nearSource, filePath);
            } finally {
                await fs.rm(nearSource, { force: true });
            }
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    }
    const nextPageIndexes = new Map(plan.nextPages.map((page, index) => [page.name, index]));
    return {
        pageCount: plan.nextPages.length,
        oldPageCount: archive.pages.length,
        pageIndexMap: archive.pages.map(page => nextPageIndexes.get(plan.entryMap[page.name])),
        entryMap: plan.entryMap,
        coverEntry: plan.coverEntry,
    };
}
