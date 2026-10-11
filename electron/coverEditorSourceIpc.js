import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listCoverEditorArchiveImages, loadCoverEditorArchiveImage, loadCoverEditorArchiveThumbnails, loadCoverEditorImage } from './coverEditor.js';
import { downloadCoverImage, parseCoverImageUrl, selectGoogleCoverImage } from './coverImageSearch.js';
import { decodeMetadataCoverDataUrl } from './metadataCoverExport.js';
import { detectImageMimeType, supportedImageExtensionForMimeType } from './imageMagic.js';

const MAX_METADATA_IMAGE_BYTES = 16 * 1024 * 1024;

export function registerCoverEditorSourceIpc(ipcMain, options = {}) {
    const owners = new Map();
    const removeDirectory = options.removeDirectory || (directory => fs.rm(directory, { recursive: true, force: true }));
    const listImages = options.listImages || listCoverEditorArchiveImages;
    const loadImage = options.loadImage || loadCoverEditorArchiveImage;
    const loadThumbnails = options.loadThumbnails || loadCoverEditorArchiveThumbnails;
    const loadMetadataImage = options.loadMetadataImage || loadCoverEditorImage;
    const downloadImage = options.downloadImage || downloadCoverImage;
    const getClipboardImage = options.getClipboardImage || (async () => {
        const electronModule = await import('electron');
        return (electronModule.default || electronModule).clipboard.readImage();
    });
    const searchImage = options.searchImage || selectGoogleCoverImage;
    const failure = error => ({ error: error.message, code: error.code || '' });

    const releaseImage = async image => {
        image.released = true;
        if (!image.leases && !image.removed) {
            image.removed = true;
            await removeDirectory(image.directory).catch(() => {});
        }
    };

    const dispose = async owner => {
        if (owner.disposed) return;
        owner.disposed = true;
        if (owners.get(owner.sender.id) === owner) owners.delete(owner.sender.id);
        owner.sender.removeListener('destroyed', owner.onDestroyed);
        owner.sender.removeListener('did-start-navigation', owner.onNavigate);
        owner.search?.abort();
        for (const controller of owner.imports) controller.abort();
        owner.imports.clear();
        const images = [...owner.images.values()];
        owner.images.clear();
        await Promise.allSettled(images.map(releaseImage));
    };

    const getOwner = sender => {
        if (sender.isDestroyed()) throw new Error('The cover editor has closed.');
        let owner = owners.get(sender.id);
        if (owner) return owner;
        owner = { sender, images: new Map(), search: null, imports: new Set(), thumbnails: Promise.resolve(), thumbnailRequest: 0, disposed: false };
        owner.onDestroyed = () => { void dispose(owner); };
        owner.onNavigate = (_event, _url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace) void dispose(owner);
        };
        sender.once('destroyed', owner.onDestroyed);
        sender.on('did-start-navigation', owner.onNavigate);
        owners.set(sender.id, owner);
        return owner;
    };

    const retainPreview = async (owner, value) => {
        if (!value || value.cancelled) return { cancelled: true };
        const { buffer, cleanupDirectory, ...preview } = value;
        if (owner.disposed || owner.sender.isDestroyed()) {
            if (cleanupDirectory) await removeDirectory(cleanupDirectory);
            return { cancelled: true };
        }
        if (cleanupDirectory) owner.images.set(preview.imagePath, { directory: cleanupDirectory, leases: 0, released: false, removed: false });
        return preview;
    };

    ipcMain.handle('coverEditor:archiveImages', async (_event, request) => {
        try {
            return await listImages(request, await options.getOptions());
        } catch (error) {
            return failure(error);
        }
    });

    ipcMain.handle('coverEditor:archiveImage', async (event, request) => {
        try {
            const owner = getOwner(event.sender);
            const imageOptions = await options.getOptions();
            if (owner.disposed) return { cancelled: true };
            return await retainPreview(owner, await loadImage(request, imageOptions));
        } catch (error) {
            return failure(error);
        }
    });

    ipcMain.handle('coverEditor:metadataImage', async (event, request = {}) => {
        let owner;
        let cleanupDirectory = '';
        try {
            owner = getOwner(event.sender);
            const imageUrl = typeof request?.imageUrl === 'string' ? request.imageUrl.trim() : '';
            const unavailable = () => Object.assign(new Error('The selected metadata cover is not available. Search again.'), { code: 'COVER_METADATA_IMAGE_UNAVAILABLE' });
            if (!imageUrl) throw unavailable();
            const imageOptions = await options.getOptions();
            if (owner.disposed) return { cancelled: true };
            let sourcePath;
            let localSourcePath = '';
            if (/^data:/i.test(imageUrl)) {
                if (imageUrl.length > Math.ceil(MAX_METADATA_IMAGE_BYTES / 3) * 4 + 64) throw unavailable();
                const decoded = decodeMetadataCoverDataUrl(imageUrl);
                if (!decoded || decoded.buffer.length > MAX_METADATA_IMAGE_BYTES) throw unavailable();
                cleanupDirectory = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'bookmanager-cover-source-'));
                localSourcePath = path.join(cleanupDirectory, `source${decoded.extension}`);
                await fs.writeFile(localSourcePath, decoded.buffer, { flag: 'wx' });
                sourcePath = localSourcePath;
            } else {
                if (imageUrl.length > 8192) throw unavailable();
                sourcePath = await options.getMetadataCoverPath(imageUrl);
            }
            if (!sourcePath) throw unavailable();
            if (owner.disposed) {
                if (cleanupDirectory) await removeDirectory(cleanupDirectory);
                return { cancelled: true };
            }
            const image = await loadMetadataImage(sourcePath, imageOptions);
            if (!cleanupDirectory) cleanupDirectory = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'bookmanager-cover-source-'));
            const imagePath = path.join(cleanupDirectory, `cover${image.extension}`);
            await fs.writeFile(imagePath, image.buffer, { flag: 'wx' });
            if (localSourcePath) await fs.unlink(localSourcePath);
            return await retainPreview(owner, {
                ...image,
                imagePath,
                imageVersion: createHash('sha256').update(image.buffer).digest('hex'),
                cleanupDirectory,
            });
        } catch (error) {
            if (cleanupDirectory) await removeDirectory(cleanupDirectory).catch(() => {});
            return owner?.disposed ? { cancelled: true } : failure(error);
        }
    });

    const importImage = async (event, request) => {
        let owner;
        let controller;
        let cleanupDirectory = '';
        try {
            owner = getOwner(event.sender);
            controller = new AbortController();
            owner.imports.add(controller);
            const invalid = () => Object.assign(new Error('The cover image could not be imported.'), { code: 'COVER_IMAGE_IMPORT_FAILED' });
            if (!request || typeof request !== 'object' || Array.isArray(request)
                || Object.keys(request).length !== 1
                || (!Object.hasOwn(request, 'bytes') && !Object.hasOwn(request, 'url'))) throw invalid();
            let bytes;
            let imageUrl = '';
            if (Object.hasOwn(request, 'bytes')) {
                if (!(request.bytes instanceof Uint8Array)) throw invalid();
                bytes = request.bytes;
            } else {
                if (typeof request.url !== 'string' || !request.url.trim()) throw invalid();
                imageUrl = request.url.trim();
                if (/^data:/i.test(imageUrl)) {
                    if (imageUrl.length > Math.ceil(MAX_METADATA_IMAGE_BYTES / 3) * 4 + 64
                        || Buffer.byteLength(imageUrl.slice(imageUrl.indexOf(',') + 1), 'base64') > MAX_METADATA_IMAGE_BYTES) {
                        throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' });
                    }
                    const decoded = decodeMetadataCoverDataUrl(imageUrl);
                    if (!decoded) throw Object.assign(new Error('Choose a valid raster image.'), { code: 'COVER_IMAGE_INVALID' });
                    bytes = decoded.buffer;
                } else {
                    if (imageUrl.length > 8192) throw invalid();
                    parseCoverImageUrl(imageUrl);
                }
            }
            if (bytes && bytes.byteLength > MAX_METADATA_IMAGE_BYTES) {
                throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' });
            }
            if (bytes && !bytes.byteLength) throw Object.assign(new Error('Choose a valid image.'), { code: 'COVER_IMAGE_INVALID' });
            const mimeType = bytes ? detectImageMimeType(bytes) : '';
            if (bytes && !mimeType) {
                throw Object.assign(new Error('Choose a JPEG, PNG, WebP, GIF, or BMP image.'), { code: 'COVER_IMAGE_UNSUPPORTED_FORMAT' });
            }
            const imageOptions = await options.getOptions();
            if (owner.disposed) return { cancelled: true };
            let image;
            let sourcePath;
            if (bytes) {
                cleanupDirectory = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'bookmanager-cover-source-'));
                sourcePath = path.join(cleanupDirectory, `source${supportedImageExtensionForMimeType(mimeType)}`);
                await fs.writeFile(sourcePath, bytes, { flag: 'wx' });
                image = await loadMetadataImage(sourcePath, imageOptions);
            } else {
                image = await downloadImage(imageUrl, {
                    tempRoot: options.tempRoot,
                    normalizeImage: imageOptions.normalizeImage,
                    loadImage: loadMetadataImage,
                    signal: controller.signal,
                });
                cleanupDirectory = image.cleanupDirectory;
                sourcePath = image.imagePath;
            }
            controller.signal.throwIfAborted();
            const imagePath = path.join(cleanupDirectory, `imported${image.extension}`);
            await fs.writeFile(imagePath, image.buffer, { flag: 'wx' });
            await fs.unlink(sourcePath);
            return await retainPreview(owner, {
                ...image,
                imagePath,
                imageVersion: createHash('sha256').update(image.buffer).digest('hex'),
                cleanupDirectory,
            });
        } catch (error) {
            if (cleanupDirectory) await removeDirectory(cleanupDirectory).catch(() => {});
            if (owner?.disposed) return { cancelled: true };
            const code = typeof error.code === 'string' && (error.code.startsWith('COVER_IMAGE_') || error.code === 'IMAGE_SOURCE_CHANGED')
                ? error.code : 'COVER_IMAGE_IMPORT_FAILED';
            return { error: error.message, code };
        } finally {
            owner?.imports.delete(controller);
        }
    };

    ipcMain.handle('coverEditor:importImage', importImage);

    ipcMain.handle('coverEditor:clipboardImage', async event => {
        let owner;
        try {
            owner = getOwner(event.sender);
            const image = await getClipboardImage();
            if (owner.disposed || owner.sender.isDestroyed()) return { cancelled: true };
            if (!image || image.isEmpty()) return { empty: true };
            const { width, height } = image.getSize();
            if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
                throw Object.assign(new Error('Choose a valid image.'), { code: 'COVER_IMAGE_INVALID' });
            }
            if (width * height > 64000000) {
                throw Object.assign(new Error('Choose an image with no more than 64 million pixels.'), { code: 'COVER_IMAGE_TOO_MANY_PIXELS' });
            }
            return await importImage(event, { bytes: image.toPNG() });
        } catch (error) {
            if (owner?.disposed) return { cancelled: true };
            const code = typeof error.code === 'string' && error.code.startsWith('COVER_IMAGE_') ? error.code : 'COVER_IMAGE_IMPORT_FAILED';
            return { error: error.message, code };
        }
    });

    ipcMain.handle('coverEditor:archiveThumbnails', async (event, request) => {
        let owner;
        try {
            owner = getOwner(event.sender);
            const requestId = ++owner.thumbnailRequest;
            const shouldCancel = () => owner.disposed || owner.thumbnailRequest !== requestId;
            const pending = owner.thumbnails.then(async () => {
                if (shouldCancel()) return { cancelled: true };
                const imageOptions = await options.getOptions();
                if (shouldCancel()) return { cancelled: true };
                const result = await loadThumbnails(request, { ...imageOptions, shouldCancel });
                return shouldCancel() ? { cancelled: true } : result;
            });
            owner.thumbnails = pending.catch(() => {});
            return await pending;
        } catch (error) {
            return owner?.disposed ? { cancelled: true } : failure(error);
        }
    });

    ipcMain.handle('coverEditor:googleImage', async (event, request = {}) => {
        let owner;
        let controller;
        try {
            owner = getOwner(event.sender);
            if (owner.search) throw new Error('An image search is already open.');
            controller = new AbortController();
            owner.search = controller;
            const imageOptions = await options.getOptions();
            if (owner.disposed) return { cancelled: true };
            return await retainPreview(owner, await searchImage({
                parentWindow: options.getParentWindow(event.sender),
                query: request.query,
                language: options.getLanguage(),
                normalizeImage: imageOptions.normalizeImage,
                signal: controller.signal,
            }));
        } catch (error) {
            return owner?.disposed ? { cancelled: true } : failure(error);
        } finally {
            if (owner?.search === controller) owner.search = null;
        }
    });

    ipcMain.handle('coverEditor:releaseImages', async (event, request = {}) => {
        const owner = owners.get(event.sender.id);
        if (!owner) return { success: true };
        if (!request.imagePath) {
            await dispose(owner);
        } else {
            const image = owner.images.get(request.imagePath);
            if (image) {
                owner.images.delete(request.imagePath);
                await releaseImage(image);
            }
        }
        return { success: true };
    });

    return {
        async withImage(sender, imagePath, operation) {
            const image = owners.get(sender.id)?.images.get(imagePath);
            if (image) image.leases += 1;
            try {
                return await operation();
            } finally {
                if (image) {
                    image.leases -= 1;
                    if (image.released) await releaseImage(image);
                }
            }
        },
    };
}
