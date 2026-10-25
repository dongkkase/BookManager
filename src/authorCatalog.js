import { createFolderCharacterIndexBuilder } from './folderCharacterIndex.js';

const catalogCache = new WeakMap();

export function authorKey(name) {
    return String(name || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function authorNames(file) {
    const candidate = file && Object.hasOwn(file, 'writer') ? file.writer : file?.author;
    const value = typeof candidate === 'string' ? candidate : '';
    return [...new Map(String(value).split(/[,;|\n]+/).map(name => {
        const cleaned = name.normalize('NFC').trim().replace(/\s+/g, ' ');
        return [authorKey(cleaned), cleaned];
    }).filter(([key]) => key)).values()];
}

function* authorCatalogSteps(files, language) {
    if (!Array.isArray(files)) return [];
    const authors = new Map();
    const namesByWriter = new Map();
    let processed = 0;
    for (const file of files) {
        if (++processed % 512 === 0) yield;
        const path = [file?.full_path, file?.path].find(value => typeof value === 'string' && value.trim());
        if (!path || file.isDirectory || file.is_folder) continue;
        const writer = Object.hasOwn(file, 'writer') ? file.writer : file.author;
        if (typeof writer !== 'string' || !writer.trim()) continue;
        if (!namesByWriter.has(writer)) namesByWriter.set(writer, authorNames(file).map(name => ({ key: authorKey(name), name })));
        const addedAt = Date.parse(file.readingListAddedAt);
        for (const { key, name } of namesByWriter.get(writer)) {
            if (!authors.has(key)) authors.set(key, { key, name, books: [], paths: new Set(), lastAdded: 0 });
            const author = authors.get(key);
            if (!author.paths.has(path)) {
                author.paths.add(path);
                author.books.push(file);
                if (Number.isFinite(addedAt)) author.lastAdded = Math.max(author.lastAdded, addedAt);
            }
        }
    }
    const index = createFolderCharacterIndexBuilder(language);
    const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' });
    const result = [];
    for (const { paths, ...author } of authors.values()) {
        if (++processed % 128 === 0) yield;
        result.push({ ...author, initial: index([{ name: author.name, path: author.key }])[0].label });
    }
    return result.sort((left, right) => collator.compare(left.name, right.name));
}

export function buildAuthorCatalog(files = [], language = 'ko') {
    const steps = authorCatalogSteps(files, language);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
}

function cachedCatalogs(files) {
    let cached = catalogCache.get(files);
    if (!cached) {
        cached = new Map();
        catalogCache.set(files, cached);
    }
    return cached;
}

export function getAuthorCatalog(files = [], language = 'ko') {
    if (!Array.isArray(files)) return [];
    const cached = cachedCatalogs(files);
    if (!cached.has(language)) cached.set(language, buildAuthorCatalog(files, language));
    return cached.get(language);
}

function yieldCatalogWork() {
    if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
    return new Promise(resolve => setTimeout(resolve, 0));
}

export async function prepareAuthorCatalog(files, language = 'ko', { isCurrent = () => true, yieldTask = yieldCatalogWork } = {}) {
    if (!Array.isArray(files)) return [];
    const cached = cachedCatalogs(files);
    if (cached.has(language)) return cached.get(language);
    const steps = authorCatalogSteps(files, language);
    let started = performance.now();
    while (isCurrent()) {
        const step = steps.next();
        if (step.done) {
            if (!cached.has(language)) cached.set(language, step.value);
            return cached.get(language);
        }
        if (performance.now() - started >= 8) {
            await yieldTask();
            started = performance.now();
        }
    }
    return null;
}

export function buildAuthorIndex(authors, language = 'ko') {
    const groups = new Map();
    for (const author of authors) {
        const group = groups.get(author.initial);
        if (group) group.count += 1;
        else groups.set(author.initial, { name: author.name, path: author.key, count: 1 });
    }
    return createFolderCharacterIndexBuilder(language)([...groups.values()]).map(entry => ({
        ...entry, count: groups.get(entry.label).count,
    }));
}

export function authorInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (Array.from(parts[0])[0] + Array.from(parts.at(-1))[0]).toLocaleUpperCase();
    return Array.from(parts[0] || '?').slice(0, 2).join('').toLocaleUpperCase();
}

export function authorHue(name) {
    return Array.from(authorKey(name)).reduce((hash, letter) => (hash * 31 + letter.codePointAt(0)) % 360, 0);
}

function publicPhotoSourceUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(value)) return '';
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host) || host.includes(':')) return '';
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
            const [first, second, third] = host.split('.').map(Number);
            if (first === 0 || first === 10 || first === 127 || first >= 224
                || (first === 100 && second >= 64 && second <= 127)
                || (first === 169 && second === 254)
                || (first === 172 && second >= 16 && second <= 31)
                || (first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2))))
                || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
                || (first === 203 && second === 0 && third === 113)) return '';
        }
        return url.href;
    } catch {
        return '';
    }
}

export function normalizeAuthorProfile(profile) {
    if (!profile || typeof profile.id !== 'string') return null;
    const plainText = value => typeof value === 'string'
        ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1000) : '';
    const text = key => plainText(profile[key]);
    const list = (value, limit) => Array.isArray(value) ? [...new Set(value.map(plainText).filter(Boolean))].slice(0, limit) : [];
    const provider = profile.provider || (/^OL[1-9]\d{0,14}A$/.test(profile.id) ? 'openlibrary' : '');
    const override = profile.photoOverride;
    const overrideSourceUrl = publicPhotoSourceUrl(override?.sourceUrl);
    const overrideQuery = plainText(override?.query).replace(/\s+/g, ' ').slice(0, 200);
    const photoOverride = typeof override?.id === 'string' && /^[a-f\d]{64}$/.test(override.id) && overrideSourceUrl && overrideQuery
        ? { id: override.id, sourceUrl: overrideSourceUrl, query: overrideQuery } : null;
    let sourceUrl = '';
    let photoUrl = '';
    let entityId = typeof profile.entityId === 'string' && /^Q[1-9]\d{0,14}$/.test(profile.entityId) ? profile.entityId : '';
    if (provider === 'openlibrary' && /^OL[1-9]\d{0,14}A$/.test(profile.id)) {
        sourceUrl = `https://openlibrary.org/authors/${profile.id}`;
        if (profile.hasPhoto !== false && profile.photoUrl !== '') photoUrl = `https://covers.openlibrary.org/a/olid/${profile.id}-M.jpg?default=false`;
    } else if (provider === 'wikidata' && /^Q[1-9]\d{0,14}$/.test(profile.id)) {
        sourceUrl = `https://www.wikidata.org/wiki/${profile.id}`;
        entityId = profile.id;
    } else if (provider === 'wikipedia') {
        const page = /^wikipedia:(ko|ja|en):([1-9]\d{0,14})$/.exec(profile.id);
        if (page) sourceUrl = `https://${page[1]}.wikipedia.org/?curid=${page[2]}`;
    } else if (provider === 'naver' && photoOverride && profile.id === photoOverride.id) {
        sourceUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(photoOverride.query)}`;
    }
    if (!sourceUrl) return null;
    const safeWikimediaUrl = (value, image) => {
        if (typeof value !== 'string' || value.length > 2048) return '';
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return '';
            const path = decodeURIComponent(url.pathname);
            if (/[\u0000-\u001f\u007f\\]/.test(path)) return '';
            if (image) {
                if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)
                    || !/^\/wikipedia\/(?:commons|ko|ja|en)\/(?:thumb\/)?[a-f\d]\/[a-f\d]{2}\/.+\.(?:jpe?g|png|gif|webp)$/i.test(path)) return '';
            } else if (!['commons.wikimedia.org', 'ko.wikipedia.org', 'ja.wikipedia.org', 'en.wikipedia.org'].includes(url.hostname)
                || !/^\/wiki\/File:[^/]+$/i.test(path)) return '';
            return url.href;
        } catch {
            return '';
        }
    };
    if (provider !== 'openlibrary') photoUrl = safeWikimediaUrl(profile.photoUrl, true);
    return {
        id: profile.id,
        provider,
        name: text('name'),
        birthDate: text('birthDate'),
        deathDate: text('deathDate'),
        topWork: text('topWork'),
        alternateNames: list(profile.alternateNames || profile.aliases, provider === 'openlibrary' ? 8 : 32),
        works: list(profile.works, 32),
        description: text('description'),
        photoUrl: photoOverride ? `bookmanager-thumbnail://author-photo/${photoOverride.id}.png` : photoUrl,
        sourceUrl,
        entityId,
        authorVerified: typeof profile.authorVerified === 'boolean' ? profile.authorVerified : undefined,
        imageSourceUrl: photoOverride ? photoOverride.sourceUrl : safeWikimediaUrl(profile.imageSourceUrl, false),
        imageLicense: photoOverride ? '' : text('imageLicense'),
        imageArtist: photoOverride ? '' : text('imageArtist'),
        ...(photoOverride ? { photoOverride } : {}),
    };
}
