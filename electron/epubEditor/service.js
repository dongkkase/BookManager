import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createProject, validateProject, projectError, assetFilename, MAX_DOCUMENT_BYTES, MAX_PROJECT_BYTES } from './model.js';
import { identifyAsset, verifyAssets, validateAudio } from './package.js';
import { validateCssPreset, validatePresetLibrary, presetError, MAX_CSS_PRESETS, MAX_PRESET_FILE_BYTES } from './cssPresets.js';
import { ContentTemplateLibrary } from './templateLibrary.js';
import { normalizeParagraphFormat, validateParagraphFormatLibrary, paragraphFormatError, MAX_PARAGRAPH_FORMATS, MAX_PARAGRAPH_FORMAT_BYTES } from './paragraphFormats.js';

const RECOVERY_ID = /^s_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function fingerprint(filePath) {
    try {
        const handle = await fs.open(filePath, 'r');
        try {
            const hash = createHash('sha256');
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            return hash.digest('hex');
        } finally { await handle.close(); }
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function atomicJson(filePath, value) {
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
        const handle = await fs.open(temporary, 'wx');
        try {
            await handle.writeFile(JSON.stringify(value));
            await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(temporary, filePath);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

export class EpubEditorService {
    constructor(root) {
        this.root = root;
        this.sessions = new Map();
        this.queues = new Map();
        this.jobs = new Map();
        this.previews = new Set();
        this.templateLibrary = new ContentTemplateLibrary(root, atomicJson);
    }

    session(id, owner) {
        const session = this.sessions.get(id);
        if (!session || session.owner !== owner) throw projectError('SESSION_CLOSED');
        return session;
    }

    async exclusive(key, fn) {
        const previous = this.queues.get(key) || Promise.resolve();
        const next = previous.catch(() => {}).then(fn);
        this.queues.set(key, next);
        try { return await next; } finally { if (this.queues.get(key) === next) this.queues.delete(key); }
    }

    async cssPresets() {
        const file = path.join(this.root, 'css-presets.json');
        try {
            if ((await fs.stat(file)).size > MAX_PRESET_FILE_BYTES) throw presetError('PRESET_LIBRARY_INVALID');
            return validatePresetLibrary(JSON.parse(await fs.readFile(file, 'utf8')));
        } catch (error) {
            if (error.code === 'ENOENT') return { version: 1, revision: 0, presets: [] };
            if (error instanceof SyntaxError) throw presetError('PRESET_LIBRARY_INVALID');
            throw error;
        }
    }

    async changeCssPreset(preset, revision, remove = false) {
        return this.exclusive('css-presets', async () => {
            const library = await this.cssPresets();
            if (!Number.isSafeInteger(revision) || library.revision !== revision) throw presetError('PRESET_CONFLICT');
            const item = remove ? { id: preset?.id } : validateCssPreset(preset);
            const index = library.presets.findIndex(value => value.id === item.id);
            if ((remove || item.id) && index < 0) throw presetError('PRESET_MISSING');
            if (remove) library.presets.splice(index, 1);
            else {
                if (library.presets.some(value => value.id !== item.id && value.name.trim().toLowerCase() === item.name.toLowerCase())) throw presetError('PRESET_NAME_EXISTS');
                if (index < 0 && library.presets.length >= MAX_CSS_PRESETS) throw presetError('PRESET_LIMIT');
                item.id ||= `css_${randomUUID()}`;
                if (index < 0) library.presets.push(item);
                else library.presets[index] = item;
            }
            library.revision += 1;
            if (Buffer.byteLength(JSON.stringify(library)) > MAX_PRESET_FILE_BYTES) throw presetError('PRESET_LIMIT');
            await fs.mkdir(this.root, { recursive: true });
            await atomicJson(path.join(this.root, 'css-presets.json'), library);
            return { ...library, selectedId: remove ? null : item.id };
        });
    }

    async paragraphFormats() {
        const file = path.join(this.root, 'paragraph-formats.json');
        try {
            if ((await fs.stat(file)).size > MAX_PARAGRAPH_FORMAT_BYTES) throw paragraphFormatError('PARAGRAPH_FORMAT_LIBRARY_INVALID');
            return validateParagraphFormatLibrary(JSON.parse(await fs.readFile(file, 'utf8')));
        } catch (error) {
            if (error.code === 'ENOENT') return { version: 1, revision: 0, formats: [] };
            if (error instanceof SyntaxError) throw paragraphFormatError('PARAGRAPH_FORMAT_LIBRARY_INVALID');
            throw error;
        }
    }

    async changeParagraphFormat(format, revision, remove = false) {
        return this.exclusive('paragraph-formats', async () => {
            const library = await this.paragraphFormats();
            if (!Number.isSafeInteger(revision) || library.revision !== revision) throw paragraphFormatError('PARAGRAPH_FORMAT_CONFLICT');
            const item = remove ? { id: format?.id } : normalizeParagraphFormat(format);
            const index = library.formats.findIndex(value => value.id === item.id);
            if ((remove || item.id) && index < 0) throw paragraphFormatError('PARAGRAPH_FORMAT_MISSING');
            if (remove) library.formats.splice(index, 1);
            else {
                if (library.formats.some(value => value.id !== item.id && value.name.toLowerCase() === item.name.toLowerCase())) throw paragraphFormatError('PARAGRAPH_FORMAT_NAME_EXISTS');
                if (index < 0 && library.formats.length >= MAX_PARAGRAPH_FORMATS) throw paragraphFormatError('PARAGRAPH_FORMAT_LIMIT');
                item.id ||= `pf_${randomUUID()}`;
                if (index < 0) library.formats.push(item);
                else library.formats[index] = item;
            }
            library.revision += 1;
            if (Buffer.byteLength(JSON.stringify(library)) > MAX_PARAGRAPH_FORMAT_BYTES) throw paragraphFormatError('PARAGRAPH_FORMAT_LIMIT');
            await fs.mkdir(this.root, { recursive: true });
            await atomicJson(path.join(this.root, 'paragraph-formats.json'), library);
            return { ...library, selectedId: remove ? null : item.id };
        });
    }

    async newSession(owner) {
        const id = `s_${randomUUID()}`;
        const directory = path.join(this.root, id);
        await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
        const session = { id, owner, directory, assetDirectory: path.join(directory, 'assets'), project: null, savedPath: null, savedHash: null, savedRevision: -1, catalog: new Map() };
        this.sessions.set(id, session);
        return session;
    }

    async contentTemplates() {
        return this.exclusive('content-templates', () => this.templateLibrary.list());
    }

    async saveContentTemplate(owner, id, template, revision, sourceTemplateId) {
        return this.exclusive('content-templates', () => this.templateLibrary.save(this.session(id, owner), template, revision, sourceTemplateId));
    }

    async deleteContentTemplate(templateId, revision) {
        return this.exclusive('content-templates', () => this.templateLibrary.remove(templateId, revision));
    }

    async contentTemplateAsset(templateId, assetId) {
        return this.exclusive('content-templates', () => this.templateLibrary.asset(templateId, assetId));
    }

    async importContentTemplate(owner, id, templateId, revision) {
        return this.exclusive('content-templates', () => this.exclusive(`${id}:assets`, () => this.templateLibrary.import(this.session(id, owner), templateId, revision)));
    }

    async readText(owner, id, { filePath, sourceId, encoding = 'auto', operationId }) {
        const session = this.session(id, owner);
        if (filePath) session.textSource = { id: `text_${randomUUID()}`, filePath };
        else if (!sourceId || session.textSource?.id !== sourceId) throw projectError('TEXT_SOURCE_MISSING');
        const source = session.textSource;
        const result = await this.runWorker(owner, operationId, { operation: 'textImport', filePath: source.filePath, encoding });
        this.session(id, owner);
        return { ...result, sourceId: source.id };
    }

    snapshot(session) {
        return { sessionId: session.id, project: session.project, savedPath: session.savedPath, savedRevision: session.savedRevision };
    }

    async create(owner, template, language) {
        const session = await this.newSession(owner);
        session.project = createProject(template, language);
        await this.persist(session);
        return this.snapshot(session);
    }

    async persist(session) {
        await atomicJson(path.join(session.directory, 'recovery.json'), {
            project: session.project, savedPath: session.savedPath, savedHash: session.savedHash,
            savedRevision: session.savedRevision, updatedAt: new Date().toISOString(),
        });
    }

    acceptProject(session, project) {
        validateProject(project);
        if (project.id !== session.project.id) throw projectError('INVALID_PROJECT');
        for (const asset of project.assets) {
            const original = session.catalog.get(asset.id);
            if (!original || original.extension !== asset.extension || original.size !== asset.size || original.mime !== asset.mime || original.kind !== asset.kind) throw projectError('INVALID_ASSET');
        }
        return structuredClone(project);
    }

    async recoveries(limit = 20) {
        const directories = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
        const result = [];
        for (const directory of directories) {
            if (!directory.isDirectory() || !RECOVERY_ID.test(directory.name)) continue;
            try {
                const filePath = path.join(this.root, directory.name, 'recovery.json');
                const stat = await fs.lstat(filePath);
                if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES + 16384) continue;
                const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
                if (typeof data.project?.metadata?.title !== 'string' || typeof data.updatedAt !== 'string') continue;
                result.push({ id: directory.name, title: data.project.metadata.title, updatedAt: data.updatedAt, savedPath: data.savedPath });
            } catch { /* Incomplete recovery writes are not offered. */ }
        }
        return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
    }

    async manageRecovery(id, action) {
        if (typeof id !== 'string' || !RECOVERY_ID.test(id)) throw projectError('INVALID_PROJECT');
        return this.exclusive('recovery-management', () => this.exclusive(id, async () => {
            if (this.sessions.has(id)) throw projectError('PROJECT_BUSY');
            return action();
        }));
    }

    async recoveryDirectory(id) {
        const directory = path.join(this.root, id);
        const stat = await fs.lstat(directory).catch(error => {
            if (error.code === 'ENOENT') throw projectError('RECOVERY_MISSING');
            throw error;
        });
        if (!stat.isDirectory()) throw projectError('INVALID_PROJECT');
        return directory;
    }

    async readRecovery(id) {
        const directory = await this.recoveryDirectory(id);
        const filePath = path.join(directory, 'recovery.json');
        const stat = await fs.lstat(filePath).catch(error => {
            if (error.code === 'ENOENT') throw projectError('RECOVERY_MISSING');
            throw error;
        });
        if (!stat.isFile()) throw projectError('INVALID_PROJECT');
        if (stat.size > MAX_DOCUMENT_BYTES + 16384) throw projectError('PROJECT_TOO_LARGE');
        let data;
        try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch (error) {
            if (error instanceof SyntaxError) throw projectError('INVALID_PROJECT');
            throw error;
        }
        validateProject(data.project);
        const assetDirectory = path.join(directory, 'assets');
        if (!(await fs.lstat(assetDirectory)).isDirectory()) throw projectError('INVALID_PROJECT');
        for (const asset of data.project.assets) {
            const assetStat = await fs.lstat(path.join(assetDirectory, assetFilename(asset))).catch(() => null);
            if (!assetStat?.isFile()) throw projectError('ASSET_MISSING');
        }
        await verifyAssets(data.project, assetDirectory);
        return { ...data, id, directory, assetDirectory, catalog: new Map(data.project.assets.map(asset => [asset.id, asset])) };
    }

    async restore(owner, id) {
        return this.manageRecovery(id, async () => {
            const session = { ...await this.readRecovery(id), owner };
            this.sessions.set(id, session);
            return this.snapshot(session);
        });
    }

    async deleteRecovery(id) {
        return this.manageRecovery(id, async () => {
            const directory = await this.recoveryDirectory(id);
            await fs.rm(directory, { recursive: true });
            return { projects: await this.recoveries() };
        });
    }

    async duplicateRecovery(owner, id, language = 'ko') {
        return this.manageRecovery(id, async () => {
            const source = await this.readRecovery(id);
            const names = new Set((await this.recoveries(Infinity)).map(item => item.title));
            const locale = ['ko', 'en', 'ja'].includes(language) ? language : 'ko';
            const title = source.project.metadata.title.trim() || { ko: '제목 없는 책', en: 'Untitled book', ja: '無題の本' }[locale];
            const copyLabel = { ko: '복사본', en: 'Copy', ja: 'コピー' }[locale];
            let duplicatedTitle;
            for (let index = 1; !duplicatedTitle || names.has(duplicatedTitle); index += 1) {
                const suffix = ` (${copyLabel}${index > 1 ? ` ${index}` : ''})`;
                const baseTitle = title.slice(0, 2000 - suffix.length).replace(/[\uD800-\uDBFF]$/, '');
                duplicatedTitle = `${baseTitle}${suffix}`;
            }
            const session = await this.newSession(owner);
            try {
                session.project = structuredClone(source.project);
                session.project.id = `p_${randomUUID()}`;
                session.project.revision = 0;
                session.project.metadata.identifier = `urn:uuid:${randomUUID()}`;
                session.project.metadata.title = duplicatedTitle;
                validateProject(session.project);
                for (const asset of session.project.assets) {
                    const filename = assetFilename(asset);
                    await fs.copyFile(path.join(source.assetDirectory, filename), path.join(session.assetDirectory, filename), constants.COPYFILE_EXCL);
                }
                await verifyAssets(session.project, session.assetDirectory);
                await this.persist(session);
            } catch (error) {
                await fs.rm(session.directory, { recursive: true, force: true });
                throw error;
            } finally {
                this.sessions.delete(session.id);
            }
            return { projects: await this.recoveries(), duplicatedId: session.id };
        });
    }

    async recovery(owner, id, project) {
        const session = this.session(id, owner);
        const snapshot = this.acceptProject(session, project);
        return this.exclusive(id, async () => {
            if (snapshot.revision >= session.project.revision) {
                const previous = session.project;
                session.project = snapshot;
                try { await this.persist(session); } catch (error) { session.project = previous; throw error; }
            }
            return { revision: session.project.revision };
        });
    }

    runWorker(owner, operationId, data, onProgress = () => {}) {
        if (typeof operationId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(operationId) || this.jobs.has(operationId)) throw projectError('INVALID_OPERATION');
        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: data, execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')) });
            const job = { owner, worker, canceled: false };
            this.jobs.set(operationId, job);
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                this.jobs.delete(operationId);
                if (job.canceled) reject(projectError('CANCELED'));
                else if (error) reject(error);
                else resolve(value);
            };
            worker.on('message', message => {
                if (message.type === 'progress') onProgress(message.value);
                if (message.type === 'result') finish(null, message.result);
                if (message.type === 'error') finish(projectError(message.code, message.message));
            });
            worker.on('error', error => finish(error));
            worker.on('exit', () => { if (!settled) finish(projectError(job.canceled ? 'CANCELED' : 'FILE_FAILED')); });
        });
    }

    async open(owner, filePath, operationId, onProgress) {
        const session = await this.newSession(owner);
        try {
            const initialHash = await fingerprint(filePath);
            session.project = await this.runWorker(owner, operationId, { operation: 'open', filePath, assetDirectory: session.assetDirectory }, onProgress);
            if (await fingerprint(filePath) !== initialHash) throw projectError('EXTERNAL_CHANGE');
            session.savedPath = filePath;
            session.savedHash = initialHash;
            session.savedRevision = session.project.revision;
            session.catalog = new Map(session.project.assets.map(asset => [asset.id, asset]));
            await this.persist(session);
            return this.snapshot(session);
        } catch (error) {
            this.sessions.delete(session.id);
            await fs.rm(session.directory, { recursive: true, force: true });
            throw error;
        }
    }

    async addAsset(owner, id, filePath, kind) {
        return this.exclusive(`${id}:assets`, async () => {
            const session = this.session(id, owner);
            if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) throw projectError('INVALID_ASSET_PATH');
            if (session.catalog.size >= 1000) throw projectError('TOO_MANY_ASSETS');
            const stat = await fs.stat(filePath);
            if (!stat.isFile()) throw projectError('ASSET_FILE_REQUIRED');
            if (stat.size > 20 * 1024 * 1024) throw projectError('ASSET_TOO_LARGE');
            const data = await fs.readFile(filePath);
            const type = identifyAsset(data);
            if (kind && type.kind !== kind) throw projectError('INVALID_ASSET');
            if (type.kind === 'audio') await validateAudio(data, type);
            if (data.length + [...session.catalog.values()].reduce((sum, asset) => sum + asset.size, 0) > MAX_PROJECT_BYTES) throw projectError('PROJECT_TOO_LARGE');
            const asset = { id: `a_${randomUUID()}`, ...type, name: path.basename(filePath), size: data.length };
            await fs.writeFile(path.join(session.assetDirectory, assetFilename(asset)), data, { flag: 'wx' });
            session.catalog.set(asset.id, asset);
            return { asset };
        });
    }

    async importAssets(owner, id, paths, kind) {
        this.session(id, owner);
        if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw projectError('INVALID_ASSET_BATCH');
        const assets = [];
        const rejected = [];
        for (const filePath of new Set(paths)) {
            try {
                const { asset } = await this.addAsset(owner, id, filePath, kind);
                assets.push(asset);
            } catch (error) {
                rejected.push({ name: typeof filePath === 'string' ? path.basename(filePath) : '', code: error.code || 'FILE_FAILED' });
            }
        }
        return { assets, rejected };
    }

    async editImage(owner, id, assetId, input) {
        return this.exclusive(`${id}:assets`, async () => {
            const session = this.session(id, owner);
            const source = session.catalog.get(assetId);
            if (!source) throw projectError('ASSET_MISSING');
            if (source.kind !== 'image') throw projectError('INVALID_ASSET');
            if (!(input instanceof ArrayBuffer) && !(input instanceof Uint8Array && input.buffer instanceof ArrayBuffer)) throw projectError('INVALID_ASSET');
            if (input.byteLength > 20 * 1024 * 1024) throw projectError('ASSET_TOO_LARGE');
            if (session.catalog.size >= 1000) throw projectError('TOO_MANY_ASSETS');
            if (input.byteLength + [...session.catalog.values()].reduce((sum, asset) => sum + asset.size, 0) > MAX_PROJECT_BYTES) throw projectError('PROJECT_TOO_LARGE');
            const data = Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
            const type = identifyAsset(data);
            if (type.extension !== 'png') throw projectError('INVALID_ASSET');
            await this.runWorker(owner, `edited-image-${randomUUID()}`, { operation: 'validateEditedImage', data });
            this.session(id, owner);
            const stem = path.parse(source.name).name.slice(0, 1900).replace(/[\uD800-\uDBFF]$/, '') || 'image';
            const asset = { id: `a_${randomUUID()}`, ...type, name: `${stem}-edited.png`, size: data.length };
            const filePath = path.join(session.assetDirectory, assetFilename(asset));
            let created = false;
            try {
                const handle = await fs.open(filePath, 'wx');
                created = true;
                try { await handle.writeFile(data); await handle.sync(); }
                finally { await handle.close(); }
                this.session(id, owner);
                session.catalog.set(asset.id, asset);
                return { asset };
            } catch (error) {
                if (created) await fs.rm(filePath, { force: true }).catch(() => {});
                throw error;
            }
        });
    }

    async asset(owner, id, assetId) {
        const session = this.session(id, owner);
        const asset = session.catalog.get(assetId);
        if (!asset) throw projectError('ASSET_MISSING');
        return { data: await fs.readFile(path.join(session.assetDirectory, assetFilename(asset))), mime: asset.mime };
    }

    async write(owner, id, project, target, operation, operationId, onProgress = () => {}) {
        const session = this.session(id, owner);
        const snapshot = this.acceptProject(session, project);
        return this.exclusive(id, () => this.exclusive(`path:${path.resolve(target)}`, async () => {
            if (operation === 'export' && target === session.savedPath) throw projectError('INVALID_TARGET');
            const expected = await fingerprint(target);
            if (operation === 'save' && target === session.savedPath && expected !== session.savedHash) throw projectError('EXTERNAL_CHANGE');
            const temporary = path.join(path.dirname(target), `.bookmanager-epub-${randomUUID()}.tmp`);
            try {
                await this.runWorker(owner, operationId, { operation, filePath: temporary, project: snapshot, assetDirectory: session.assetDirectory }, onProgress);
                const writtenHash = operation === 'save' ? await fingerprint(temporary) : null;
                if (await fingerprint(target) !== expected) throw projectError('EXTERNAL_CHANGE');
                if (expected === null) {
                    await fs.link(temporary, target);
                    await fs.unlink(temporary);
                } else {
                    await fs.rename(temporary, target);
                }
                if (operation === 'save') {
                    session.savedPath = target;
                    session.savedHash = writtenHash;
                    session.savedRevision = snapshot.revision;
                }
                if (snapshot.revision >= session.project.revision) session.project = snapshot;
                let recoveryWarning = false;
                try { await this.persist(session); } catch { recoveryWarning = true; }
                onProgress(100);
                return { filePath: target, revision: snapshot.revision, recoveryWarning };
            } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
        }));
    }

    async preview(owner, id, project, operationId, onProgress = () => {}) {
        const session = this.session(id, owner);
        const snapshot = this.acceptProject(session, project);
        return this.exclusive(id, async () => {
            this.session(id, owner);
            const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-preview-'));
            this.previews.add(directory);
            const title = String(snapshot.metadata.title || 'book').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || 'book';
            const filePath = path.join(directory, `${title}.epub`);
            try {
                await this.runWorker(owner, operationId, { operation: 'export', filePath, project: snapshot, assetDirectory: session.assetDirectory }, onProgress);
                this.session(id, owner);
                return { filePath, revision: snapshot.revision };
            } catch (error) {
                await this.releasePreview(filePath);
                throw error;
            }
        });
    }

    async releasePreview(filePath) {
        const directory = path.dirname(filePath);
        if (!this.previews.has(directory)) return;
        await fs.rm(directory, { recursive: true, force: true });
        this.previews.delete(directory);
    }

    async cancel(owner, operationId) {
        const job = this.jobs.get(operationId);
        if (!job || job.owner !== owner) return { canceled: false };
        job.canceled = true;
        await job.worker.terminate();
        return { canceled: true };
    }

    async close(owner, id) {
        this.session(id, owner);
        await this.exclusive(id, () => this.sessions.delete(id));
    }

    async dispose(owner) {
        const sessionIds = [...this.sessions.entries()].filter(([, session]) => owner == null || session.owner === owner).map(([id]) => id);
        await Promise.all([...this.jobs.entries()].filter(([, job]) => owner == null || job.owner === owner).map(([id, job]) => this.cancel(job.owner, id)));
        await Promise.allSettled([...this.queues.values()]);
        for (const id of sessionIds) this.sessions.delete(id);
        if (owner == null) await Promise.all([...this.previews].map(directory => this.releasePreview(path.join(directory, 'preview.epub'))));
    }
}
