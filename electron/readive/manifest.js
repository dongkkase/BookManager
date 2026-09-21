import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveTextMetadata } from '../textMetadataStore.js';
import { detectImageMimeType } from '../imageMagic.js';
import { READIVE_LIMITS, cleanRelativePath, fail, transferSizePolicy } from './policy.js';

const IMAGE_EXTENSIONS = new Set([
    '.avif', '.bmp', '.gif', '.heic', '.heif', '.jfif', '.jpeg', '.jpg', '.png', '.svg', '.webp',
]);
const AUDIO_EXTENSIONS = new Set([
    '.3gp', '.aac', '.amr', '.caf', '.flac', '.m4a', '.m4b', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wave', '.webm',
]);
const BOOK_EXTENSIONS = new Set([
    ...IMAGE_EXTENSIONS,
    ...AUDIO_EXTENSIONS,
    '.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.tar', '.cbt', '.pdf', '.epub', '.txt', '.text', '.log', '.md',
]);
const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX', '.git', 'node_modules']);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function readiveFileFormat(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return BOOK_EXTENSIONS.has(extension) ? IMAGE_EXTENSIONS.has(extension) ? 'image' : extension.slice(1) : null;
}

export function isReadiveSkippedName(name) {
    return SKIP_NAMES.has(name);
}

function fileIdentity(stat) {
    return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev };
}

export async function assertNoSymlinks(filePath) {
    const resolved = path.resolve(filePath);
    let current = resolved;
    while (true) {
        if ((await fs.lstat(current)).isSymbolicLink()) throw fail('symlink_not_allowed', 409);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return resolved;
}

export async function openFrozenAsset(asset) {
    await assertNoSymlinks(asset.sourcePath);
    const handle = await fs.open(asset.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || Object.entries(asset.identity).some(([key, value]) => stat[key] !== value)) throw fail('source_changed', 409);
        return handle;
    } catch (error) {
        await handle.close();
        throw error;
    }
}

async function inspectAsset(filePath, maxBytes, signal, hashCache, deferHash = false) {
    await assertNoSymlinks(filePath);
    const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > maxBytes) throw fail('transfer_hard_limit');
        if (signal?.aborted) throw fail('scan_cancelled', 409);
        const identity = fileIdentity(before);
        const cached = hashCache?.get(filePath);
        let contentHash;
        let bytes = before.size;
        if (deferHash) {
            contentHash = null;
        } else if (cached && Object.entries(identity).every(([key, value]) => cached.identity[key] === value)) {
            contentHash = cached.sha256;
        } else {
            const hash = crypto.createHash('sha256');
            bytes = 0;
            for await (const chunk of handle.createReadStream({ autoClose: false, signal, highWaterMark: 1024 ** 2 })) {
                if (signal?.aborted) throw fail('scan_cancelled', 409);
                bytes += chunk.length;
                if (bytes > maxBytes) throw fail('transfer_hard_limit');
                hash.update(chunk);
            }
            contentHash = hash.digest('hex');
        }
        const after = await handle.stat();
        if (bytes !== before.size || Object.entries(identity).some(([key, value]) => after[key] !== value)) throw fail('source_changed', 409);
        if (signal?.aborted) throw fail('scan_cancelled', 409);
        if (hashCache && contentHash) {
            hashCache.delete(filePath);
            while (hashCache.size >= 2048) hashCache.delete(hashCache.keys().next().value);
            hashCache.set(filePath, { identity, sha256: contentHash });
        }
        return { id: crypto.randomUUID(), sourcePath: filePath, identity, size: bytes, sha256: contentHash };
    } finally {
        await handle.close();
    }
}

export async function resolveFrozenAssetHash(asset, { signal, hashCache } = {}) {
    const handle = await openFrozenAsset(asset);
    await handle.close();
    const checked = await inspectAsset(asset.sourcePath, asset.size, signal, hashCache);
    if (Object.entries(asset.identity).some(([key, value]) => checked.identity[key] !== value)) throw fail('source_changed', 409);
    return checked.sha256;
}

export function summarizeEntries(entries) {
    return entries.reduce((summary, entry) => {
        if (entry.skippedReason) { summary.skipped += 1; return summary; }
        if (entry.kind === 'directory') summary.folders += 1;
        else {
            summary.files += 1;
            summary.bytes += entry.size + (entry.metadataBytes || 0) + (entry.coverBytes || 0);
            summary.metadataBytes += entry.metadataBytes || 0;
            summary.coverBytes += entry.coverBytes || 0;
        }
        return summary;
    }, { files: 0, folders: 0, bytes: 0, skipped: 0, metadataBytes: 0, coverBytes: 0 });
}

export function selectSnapshotEntries(snapshot, excludedIds = []) {
    const excluded = new Set(excludedIds);
    if (excluded.size > snapshot.entries.length || [...excluded].some(id => !snapshot.entries.some(entry => entry.id === id))) throw fail('invalid_exclusions');
    const selected = [];
    for (const entry of snapshot.entries) {
        if (excluded.has(entry.parentId)) excluded.add(entry.id);
        if (!excluded.has(entry.id) && !entry.skippedReason) selected.push(entry);
    }
    return selected;
}

export function publicSnapshot(snapshot) {
    return { id: snapshot.id, roots: snapshot.roots, entries: snapshot.entries.map(({ sourcePath, ...entry }) => entry), summary: snapshot.summary, large: snapshot.large, blocked: snapshot.blocked, warnings: snapshot.warnings };
}

export async function scanReadivePaths(paths, { libraryDb, signal, limits = READIVE_LIMITS, rootPath, preserveAncestors = true, hashCache, deferFileHashes = false } = {}) {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > limits.hardFiles + limits.hardFolders) throw fail('invalid_roots');
    const requested = [...new Set(paths.map(value => path.resolve(String(value))))];
    const normalized = requested.filter(value => !requested.some(other => other !== value && value.startsWith(other.endsWith(path.sep) ? other : other + path.sep)));
    const snapshot = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), roots: [], entries: [], assets: {}, warnings: [], blocked: false };
    let visited = 0;
    const names = new Set();
    const ancestors = new Map();
    const rootPrefix = rootPath ? rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep : null;
    const withinLibrary = sourcePath => sourcePath === rootPath || sourcePath.startsWith(rootPrefix);
    const manifestPath = sourcePath => [path.basename(rootPath) || 'Library', path.relative(rootPath, sourcePath).split(path.sep).join('/')].filter(Boolean).join('/');
    const addAncestor = async sourcePath => {
        if (ancestors.has(sourcePath)) return ancestors.get(sourcePath);
        if (!withinLibrary(sourcePath)) throw fail('invalid_library_path');
        const parentId = sourcePath === rootPath ? null : await addAncestor(path.dirname(sourcePath));
        await assertNoSymlinks(sourcePath);
        if (!(await fs.lstat(sourcePath)).isDirectory()) throw fail('source_changed', 409);
        const relativePath = manifestPath(sourcePath);
        cleanRelativePath(relativePath);
        if (relativePath.split('/').length > limits.depth + 1) throw fail('scan_hard_limit');
        const entry = { id: crypto.randomUUID(), parentId, name: path.posix.basename(relativePath), relativePath, kind: 'directory', size: 0, metadataBytes: 0, coverBytes: 0, sourcePath };
        snapshot.entries.push(entry);
        ancestors.set(sourcePath, entry.id);
        return entry.id;
    };
    const visit = async (sourcePath, relativePath, parentId, depth) => {
        if (signal?.aborted) throw fail('scan_cancelled', 409);
        if (++visited > limits.scanEntries || depth > limits.depth) throw fail('scan_hard_limit');
        cleanRelativePath(relativePath);
        const stat = await fs.lstat(sourcePath);
        const entry = { id: crypto.randomUUID(), parentId, name: path.posix.basename(relativePath), relativePath, kind: stat.isDirectory() ? 'directory' : 'file', size: 0, metadataBytes: 0, coverBytes: 0, sourcePath };
        snapshot.entries.push(entry);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
            entry.skippedReason = 'symlink_or_special_file';
            snapshot.warnings.push(entry.skippedReason);
            return;
        }
        if (stat.isDirectory()) {
            if (snapshot.entries.filter(item => item.kind === 'directory').length > limits.hardFolders) throw fail('transfer_hard_limit');
            await assertNoSymlinks(sourcePath);
            const children = [];
            const directory = await fs.opendir(sourcePath);
            for await (const child of directory) {
                if (children.length + visited >= limits.scanEntries) throw fail('scan_hard_limit');
                children.push(child);
            }
            const afterDirectory = await fs.lstat(sourcePath);
            if (!afterDirectory.isDirectory() || afterDirectory.ino !== stat.ino || afterDirectory.dev !== stat.dev
                || afterDirectory.ctimeMs !== stat.ctimeMs) throw fail('source_changed', 409);
            children.sort((left, right) => left.name.localeCompare(right.name, 'en', { numeric: true }));
            for (const child of children) {
                if (SKIP_NAMES.has(child.name)) continue;
                await visit(path.join(sourcePath, child.name), `${relativePath}/${child.name}`, entry.id, depth + 1);
            }
            return;
        }
        const extension = path.extname(sourcePath).toLowerCase();
        if (!BOOK_EXTENSIONS.has(extension)) {
            entry.skippedReason = 'unsupported_format';
            snapshot.warnings.push(entry.skippedReason);
            return;
        }
        entry.size = stat.size;
        entry.format = IMAGE_EXTENSIONS.has(extension) ? 'image' : extension.slice(1);
        if (transferSizePolicy(summarizeEntries(snapshot.entries), limits).blocked) throw fail('transfer_hard_limit');
        const asset = await inspectAsset(sourcePath, limits.hardBytes, signal, hashCache, deferFileHashes && extension !== '.txt');
        entry.assetId = asset.id;
        entry.contentHash = asset.sha256;
        snapshot.assets[asset.id] = { ...asset, kind: 'file', entryId: entry.id, mimeType: 'application/octet-stream' };
        if (extension === '.txt' && libraryDb) {
            const stored = await resolveTextMetadata(sourcePath, { libraryDb });
            if (stored) {
                if (stored.contentHash !== asset.sha256) throw fail('source_changed', 409);
                const bytes = Buffer.from(JSON.stringify(stored.metadata));
                if (bytes.length > limits.metadataBytes) throw fail('metadata_too_large');
                const metadataId = crypto.randomUUID();
                entry.metadataAssetId = metadataId;
                entry.metadataBytes = bytes.length;
                snapshot.assets[metadataId] = { id: metadataId, entryId: entry.id, kind: 'metadata', size: bytes.length, sha256: sha256(bytes), mimeType: 'application/json', base64: bytes.toString('base64') };
                entry.coverState = stored.coverPath ? 'present' : 'removed';
                if (stored.coverPath) {
                    const cover = await inspectAsset(stored.coverPath, limits.coverBytes, signal, hashCache);
                    const coverHandle = await openFrozenAsset(cover);
                    const signature = Buffer.alloc(32);
                    let signatureLength;
                    try {
                        signatureLength = (await coverHandle.read(signature, 0, signature.length, 0)).bytesRead;
                    } finally {
                        await coverHandle.close();
                    }
                    const mimeType = detectImageMimeType(signature.subarray(0, signatureLength));
                    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(mimeType)) throw fail('invalid_cover');
                    entry.coverAssetId = cover.id;
                    entry.coverBytes = cover.size;
                    snapshot.assets[cover.id] = { ...cover, kind: 'cover', entryId: entry.id, mimeType };
                }
            }
        }
        if (transferSizePolicy(summarizeEntries(snapshot.entries), limits).blocked) throw fail('transfer_hard_limit');
    };
    for (const sourcePath of normalized) {
        let rootName = path.basename(sourcePath) || (rootPath ? 'Library' : '');
        if (!rootName || ((!rootPath || !preserveAncestors) && names.has(rootName.toLocaleLowerCase('en')))) throw fail('duplicate_root_name');
        names.add(rootName.toLocaleLowerCase('en'));
        try {
            await assertNoSymlinks(sourcePath);
            if (rootPath && !withinLibrary(sourcePath)) throw fail('invalid_library_path');
            const parentId = rootPath && preserveAncestors && sourcePath !== rootPath ? await addAncestor(path.dirname(sourcePath)) : null;
            const first = snapshot.entries.length;
            const relativePath = rootPath && preserveAncestors ? manifestPath(sourcePath) : rootName;
            await visit(sourcePath, relativePath, parentId, relativePath.split('/').length - 1);
            snapshot.roots.push({ id: snapshot.entries[first].id, name: rootName, path: sourcePath });
        } catch (error) {
            if (['scan_hard_limit', 'transfer_hard_limit'].includes(error.code)) {
                snapshot.blocked = true;
                snapshot.warnings.push(error.code);
                break;
            }
            throw error;
        }
    }
    snapshot.summary = summarizeEntries(snapshot.entries);
    if (transferSizePolicy(snapshot.summary, limits).blocked) snapshot.blocked = true;
    snapshot.large = transferSizePolicy(snapshot.summary, limits).large;
    snapshot.warnings = [...new Set(snapshot.warnings)];
    return snapshot;
}
