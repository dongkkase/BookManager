import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeAuthorProfile } from '../src/authorCatalog.js';
import { downloadCoverImage } from './coverImageSearch.js';
import { decodeCoverEditorImage } from './coverEditorImageDecoder.js';
import { detectImageMimeType } from './imageMagic.js';
import { decodeMetadataCoverDataUrl } from './metadataCoverExport.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_SIZE = 512;
const REQUEST_TIMEOUT_MS = 12000;
const ERROR_MESSAGES = {
    AUTHOR_PHOTO_INVALID_PROFILE: 'Choose a valid author profile photo.',
    AUTHOR_PHOTO_UNTRUSTED_SENDER: 'Author photos are only available in the main library window.',
    AUTHOR_PHOTO_IMAGE_FAILED: 'The author photo could not be loaded.',
    AUTHOR_PHOTO_STORAGE_FAILED: 'The author photo could not be saved.',
    AUTHOR_PHOTO_CANCELLED: 'The author photo request was cancelled.',
    AUTHOR_PHOTO_TIMEOUT: 'The author photo request timed out.',
    AUTHOR_PHOTO_TOO_LARGE: 'Choose a photo no larger than 16 MiB.',
};

const photoError = code => Object.assign(new Error(ERROR_MESSAGES[code]), { code });
const photoId = buffer => createHash('sha256').update(buffer).digest('hex');

function validPng(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.length > MAX_PHOTO_BYTES
        || detectImageMimeType(buffer) !== 'image/png' || buffer.toString('ascii', 12, 16) !== 'IHDR') return false;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 && width <= MAX_PHOTO_SIZE && height <= MAX_PHOTO_SIZE;
}

async function resizePhoto(buffer, size) {
    const image = await decodeCoverEditorImage(buffer);
    const { width, height } = image.getSize();
    const scale = Math.min(1, size / Math.max(width, height));
    const resized = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
    return { buffer: resized.toPNG(), mimeType: 'image/png', ...resized.getSize() };
}

async function readStoredPhoto(directory, photo) {
    try {
        const filename = path.join(directory, `${photo.id}.png`);
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.size > MAX_PHOTO_BYTES) return false;
        const buffer = await fs.readFile(filename);
        return validPng(buffer) && photoId(buffer) === photo.id;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw photoError('AUTHOR_PHOTO_STORAGE_FAILED');
    }
}

export function registerAuthorProfilePhotosIpc(options) {
    const { ipcMain, getMainWindow, getPhotoDirectory } = options;
    const downloadImage = options.downloadImage || downloadCoverImage;
    const resizeImage = options.resizeImage || resizePhoto;
    const owners = new Map();
    let queue = Promise.resolve();
    let queued = 0;

    const disposeOwner = owner => {
        owner.disposed = true;
        for (const controller of owner.controllers) controller.abort(photoError('AUTHOR_PHOTO_CANCELLED'));
        owners.delete(owner.sender);
        owner.sender.removeListener('destroyed', owner.onDestroyed);
        owner.sender.removeListener('did-start-navigation', owner.onNavigate);
    };
    const getOwner = event => {
        const window = getMainWindow?.();
        if (!window || window.isDestroyed() || window.webContents !== event.sender || event.sender.isDestroyed()
            || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw photoError('AUTHOR_PHOTO_UNTRUSTED_SENDER');
        let owner = owners.get(event.sender);
        if (!owner) {
            owner = { sender: event.sender, controllers: new Set(), requests: new Map(), disposed: false };
            owner.onDestroyed = () => disposeOwner(owner);
            owner.onNavigate = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) disposeOwner(owner); };
            event.sender.once('destroyed', owner.onDestroyed);
            event.sender.on('did-start-navigation', owner.onNavigate);
            owners.set(event.sender, owner);
        }
        return owner;
    };

    const savePhoto = async (profile, controller) => {
        controller.signal.throwIfAborted();
        let directory;
        try { directory = await getPhotoDirectory(); }
        catch { throw photoError('AUTHOR_PHOTO_STORAGE_FAILED'); }
        controller.signal.throwIfAborted();
        const existing = profile.photoOverride || profile.storedPhoto;
        if (existing && await readStoredPhoto(directory, existing)) {
            controller.signal.throwIfAborted();
            return { id: existing.id, sourceUrl: existing.sourceUrl };
        }
        if (profile.photoOverride) throw photoError('AUTHOR_PHOTO_STORAGE_FAILED');
        const sourceUrl = profile.storedPhoto?.sourceUrl || profile.photoUrl;
        let downloaded;
        let temporaryPath;
        const timer = setTimeout(() => controller.abort(photoError('AUTHOR_PHOTO_TIMEOUT')), options.timeoutMs || REQUEST_TIMEOUT_MS);
        try {
            downloaded = await downloadImage(sourceUrl, {
                signal: controller.signal,
                timeoutMs: (options.timeoutMs || REQUEST_TIMEOUT_MS) + 1000,
                maxBytes: MAX_IMAGE_BYTES,
                tempRoot: options.tempRoot,
                normalizeImage: buffer => resizeImage(buffer, MAX_PHOTO_SIZE),
            });
            controller.signal.throwIfAborted();
            if (!validPng(downloaded?.buffer) || !(downloaded.width > 0 && downloaded.height > 0
                && downloaded.width <= MAX_PHOTO_SIZE && downloaded.height <= MAX_PHOTO_SIZE)) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            const id = photoId(downloaded.buffer);
            try {
                await fs.mkdir(directory, { recursive: true, mode: 0o700 });
                controller.signal.throwIfAborted();
                temporaryPath = path.join(directory, `.${id}.${randomUUID()}.tmp`);
                await (options.writePhotoFile || fs.writeFile)(temporaryPath, downloaded.buffer, { flag: 'wx', mode: 0o600 });
                controller.signal.throwIfAborted();
                await fs.rename(temporaryPath, path.join(directory, `${id}.png`));
            } catch (error) {
                if (controller.signal.aborted) throw controller.signal.reason;
                throw photoError('AUTHOR_PHOTO_STORAGE_FAILED');
            }
            controller.signal.throwIfAborted();
            return { id, sourceUrl };
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            throw error;
        } finally {
            clearTimeout(timer);
            if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
            if (downloaded?.cleanupDirectory) await fs.rm(downloaded.cleanupDirectory, { recursive: true, force: true }).catch(() => {});
        }
    };

    ipcMain.handle('authors:saveProfilePhoto', async (event, value, requestOptions = {}) => {
        try {
            const owner = getOwner(event);
            const profile = normalizeAuthorProfile(value);
            if (!profile?.photoUrl || value?.storedPhoto && !profile.storedPhoto && !profile.photoOverride
                || value?.photoOverride && !profile.photoOverride) throw photoError('AUTHOR_PHOTO_INVALID_PROFILE');
            const sourceUrl = profile.photoOverride?.sourceUrl || profile.storedPhoto?.sourceUrl || profile.photoUrl;
            const key = `${profile.photoOverride?.id || profile.storedPhoto?.id || ''}:${sourceUrl}`;
            let request = owner.requests.get(key);
            if (!request) {
                if (queued >= 64) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
                const controller = new AbortController();
                owner.controllers.add(controller);
                queued += 1;
                request = queue.then(() => savePhoto(profile, controller)).finally(() => {
                    queued -= 1;
                    owner.controllers.delete(controller);
                    owner.requests.delete(key);
                });
                queue = request.catch(() => {});
                owner.requests.set(key, request);
            }
            const photo = await request;
            if (requestOptions?.includeDataUrl === true) {
                if (owner.disposed) throw photoError('AUTHOR_PHOTO_CANCELLED');
                const buffer = await fs.readFile(path.join(await getPhotoDirectory(), `${photo.id}.png`));
                if (!validPng(buffer) || photoId(buffer) !== photo.id) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
                return {
                    success: true,
                    photo: profile.photoOverride || {
                        ...photo, source: profile.provider, query: profile.name || profile.id,
                        imageSourceUrl: profile.imageSourceUrl, imageArtist: profile.imageArtist, imageLicense: profile.imageLicense,
                    },
                    dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
                };
            }
            return { success: true, photo };
        } catch (error) {
            const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'AUTHOR_PHOTO_IMAGE_FAILED';
            return { success: false, code, error: ERROR_MESSAGES[code] };
        }
    });

    ipcMain.handle('authors:importPhoto', async (event, value) => {
        let owner;
        let controller;
        try {
            owner = getOwner(event);
            if (typeof value?.dataUrl !== 'string') throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            if (value.dataUrl.length > Math.ceil(MAX_IMPORT_BYTES / 3) * 4 + 64) throw photoError('AUTHOR_PHOTO_TOO_LARGE');
            const decoded = decodeMetadataCoverDataUrl(value.dataUrl);
            if (!decoded) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            if (decoded.buffer.length > MAX_IMPORT_BYTES) throw photoError('AUTHOR_PHOTO_TOO_LARGE');
            const sourcePhoto = value.photo ? normalizeAuthorProfile({
                provider: 'local', id: value.photo.id, photoOverride: value.photo,
            })?.photoOverride : null;
            if (value.photo && !sourcePhoto) throw photoError('AUTHOR_PHOTO_INVALID_PROFILE');
            if (queued >= 64) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            controller = new AbortController();
            owner.controllers.add(controller);
            queued += 1;
            const request = queue.then(async () => {
                controller.signal.throwIfAborted();
                const image = await resizeImage(decoded.buffer, MAX_PHOTO_SIZE);
                controller.signal.throwIfAborted();
                if (!validPng(image?.buffer) || !(image.width > 0 && image.height > 0
                    && image.width <= MAX_PHOTO_SIZE && image.height <= MAX_PHOTO_SIZE)) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
                const id = photoId(image.buffer);
                let temporaryPath;
                try {
                    const directory = await getPhotoDirectory();
                    controller.signal.throwIfAborted();
                    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
                    controller.signal.throwIfAborted();
                    temporaryPath = path.join(directory, `.${id}.${randomUUID()}.tmp`);
                    await (options.writePhotoFile || fs.writeFile)(temporaryPath, image.buffer, { flag: 'wx', mode: 0o600 });
                    controller.signal.throwIfAborted();
                    await fs.rename(temporaryPath, path.join(directory, `${id}.png`));
                } catch (error) {
                    if (controller.signal.aborted) throw controller.signal.reason;
                    throw photoError('AUTHOR_PHOTO_STORAGE_FAILED');
                } finally {
                    if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
                }
                controller.signal.throwIfAborted();
                return {
                    success: true,
                    photo: { ...(sourcePhoto || { source: 'local', sourceUrl: '', query: '' }), id },
                    dataUrl: `data:image/png;base64,${image.buffer.toString('base64')}`,
                };
            }).finally(() => { queued -= 1; });
            queue = request.catch(() => {});
            return await request;
        } catch (error) {
            const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : 'AUTHOR_PHOTO_IMAGE_FAILED';
            return { success: false, code, error: ERROR_MESSAGES[code] };
        } finally {
            owner?.controllers.delete(controller);
        }
    });

    return { dispose: () => { for (const owner of owners.values()) disposeOwner(owner); } };
}
