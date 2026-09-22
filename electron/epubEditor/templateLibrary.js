import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assetFilename, projectError, MAX_PROJECT_BYTES } from './model.js';
import { identifyAsset, validateAudio } from './package.js';
import { validateContentTemplate, templateAssetIds, remapTemplateAssets, MAX_CONTENT_TEMPLATES, MAX_TEMPLATE_LIBRARY_BYTES } from './contentTemplates.js';

const emptyLibrary = () => ({ version: 1, revision: 0, templates: [] });
const templateId = () => `tpl_${randomUUID()}`;
const assetId = () => `a_${randomUUID()}`;
const totalBytes = templates => [...new Map(templates.flatMap(item => item.assets).map(asset => [asset.id, asset])).values()].reduce((sum, asset) => sum + asset.size, 0);

export class ContentTemplateLibrary {
    constructor(root, writeJson) {
        this.file = path.join(root, 'content-templates.json');
        this.assetDirectory = path.join(root, 'template-assets');
        this.writeJson = writeJson;
    }

    async list() {
        try {
            if ((await fs.stat(this.file)).size > MAX_TEMPLATE_LIBRARY_BYTES) throw projectError('TEMPLATE_LIBRARY_INVALID');
            const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
            if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.templates) || value.templates.length > MAX_CONTENT_TEMPLATES) throw projectError('TEMPLATE_LIBRARY_INVALID');
            const ids = new Set();
            const names = new Set();
            for (const item of value.templates) {
                validateContentTemplate(item);
                const name = item.name.trim().toLowerCase();
                if (!item.id || ids.has(item.id) || names.has(name)) throw projectError('TEMPLATE_LIBRARY_INVALID');
                ids.add(item.id);
                names.add(name);
            }
            if (totalBytes(value.templates) > 256 * 1024 * 1024) throw projectError('TEMPLATE_LIBRARY_INVALID');
            return value;
        } catch (error) {
            if (error.code === 'ENOENT') return emptyLibrary();
            if (['EACCES', 'EPERM'].includes(error.code)) throw error;
            throw projectError('TEMPLATE_LIBRARY_INVALID');
        }
    }

    checkRevision(library, revision) {
        if (!Number.isSafeInteger(revision) || library.revision !== revision) throw projectError('TEMPLATE_CONFLICT');
    }

    find(library, id) {
        const item = library.templates.find(value => value.id === id);
        if (!item) throw projectError('TEMPLATE_MISSING');
        return item;
    }

    async readAsset(asset, directory = this.assetDirectory) {
        const file = path.join(directory, assetFilename(asset));
        const stat = await fs.stat(file).catch(() => null);
        if (!stat?.isFile() || stat.size !== asset.size) throw projectError('ASSET_MISSING');
        const data = await fs.readFile(file);
        const type = identifyAsset(data);
        if (data.length !== asset.size || type.extension !== asset.extension || type.kind !== asset.kind || type.mime !== asset.mime) throw projectError('INVALID_ASSET');
        if (type.kind === 'audio') await validateAudio(data, type);
        return data;
    }

    async asset(id, idOfAsset) {
        const item = this.find(await this.list(), id);
        const asset = item.assets.find(value => value.id === idOfAsset);
        if (!asset) throw projectError('ASSET_MISSING');
        return { data: await this.readAsset(asset), mime: asset.mime };
    }

    async save(session, input, revision, sourceTemplateId) {
        const library = await this.list();
        this.checkRevision(library, revision);
        let item = validateContentTemplate({ ...input, assets: [] }, false);
        if (item.id) this.find(library, item.id);
        if (library.templates.some(value => value.id !== item.id && value.name.toLowerCase() === item.name.toLowerCase())) throw projectError('TEMPLATE_NAME_EXISTS');
        if (!item.id && library.templates.length >= MAX_CONTENT_TEMPLATES) throw projectError('TEMPLATE_LIMIT');
        const source = sourceTemplateId || item.id;
        const stored = new Map((source ? this.find(library, source).assets : []).map(asset => [asset.id, asset]));
        const mapping = new Map();
        const copies = [];
        for (const id of templateAssetIds(item.content)) {
            const asset = stored.get(id) || session.catalog.get(id);
            if (!asset) throw projectError('ASSET_MISSING');
            if (stored.has(id)) item.assets.push(asset);
            else {
                const next = { ...asset, id: assetId() };
                mapping.set(id, next.id);
                item.assets.push(next);
                copies.push({ asset, next });
            }
        }
        item = validateContentTemplate({ ...item, id: item.id || templateId(), content: remapTemplateAssets(item.content, mapping) });
        if (totalBytes([item]) > 32 * 1024 * 1024) throw projectError('TEMPLATE_ASSET_LIMIT');
        library.templates = [...library.templates.filter(value => value.id !== item.id), item];
        library.revision += 1;
        if (Buffer.byteLength(JSON.stringify(library)) > MAX_TEMPLATE_LIBRARY_BYTES || totalBytes(library.templates) > 256 * 1024 * 1024) throw projectError('TEMPLATE_LIMIT');
        const written = [];
        try {
            await fs.mkdir(this.assetDirectory, { recursive: true });
            for (const asset of item.assets.filter(asset => stored.has(asset.id))) await this.readAsset(asset);
            for (const { asset, next } of copies) {
                const data = await this.readAsset(asset, session.assetDirectory);
                const file = path.join(this.assetDirectory, assetFilename(next));
                written.push(file);
                await fs.writeFile(file, data, { flag: 'wx' });
            }
            await this.writeJson(this.file, library);
        } catch (error) {
            await Promise.all(written.map(file => fs.rm(file, { force: true }).catch(() => {})));
            throw error;
        }
        await this.collectUnusedAssets(library);
        return { ...library, selectedId: item.id };
    }

    async remove(id, revision) {
        const library = await this.list();
        this.checkRevision(library, revision);
        this.find(library, id);
        library.templates = library.templates.filter(value => value.id !== id);
        library.revision += 1;
        await this.writeJson(this.file, library);
        await this.collectUnusedAssets(library);
        return { ...library, selectedId: null };
    }

    async collectUnusedAssets(library) {
        const used = new Set(library.templates.flatMap(item => item.assets.map(assetFilename)));
        const files = await fs.readdir(this.assetDirectory).catch(() => []);
        await Promise.all(files.filter(file => /^a_[a-f0-9-]{36}\.(png|jpg|mp3|m4a|ttf|otf|woff2?)$/.test(file) && !used.has(file)).map(file => fs.rm(path.join(this.assetDirectory, file), { force: true }).catch(() => {})));
    }

    async import(session, id, revision) {
        const library = await this.list();
        this.checkRevision(library, revision);
        const item = this.find(library, id);
        if (session.catalog.size + item.assets.length > 1000) throw projectError('TOO_MANY_ASSETS');
        if ([...session.catalog.values(), ...item.assets].reduce((sum, asset) => sum + asset.size, 0) > MAX_PROJECT_BYTES) throw projectError('PROJECT_TOO_LARGE');
        const mapping = new Map(item.assets.map(asset => [asset.id, assetId()]));
        const assets = item.assets.map(asset => ({ ...asset, id: mapping.get(asset.id) }));
        const written = [];
        try {
            for (const asset of item.assets) {
                const data = await this.readAsset(asset);
                const file = path.join(session.assetDirectory, assetFilename({ ...asset, id: mapping.get(asset.id) }));
                written.push(file);
                await fs.writeFile(file, data, { flag: 'wx' });
            }
        } catch (error) {
            await Promise.all(written.map(file => fs.rm(file, { force: true }).catch(() => {})));
            throw error;
        }
        for (const asset of assets) session.catalog.set(asset.id, asset);
        return { content: remapTemplateAssets(item.content, mapping), assets };
    }
}
