import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_CHAPTERS, MAX_DOCUMENT_BYTES, projectError } from './model.js';

export async function atomicJson(filePath, value) {
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

export async function writeRecovery(directory, data, previous = new Map()) {
    const chapterDirectory = path.join(directory, 'chapters');
    await fs.mkdir(chapterDirectory, { recursive: true });
    const next = new Map();
    const created = [];
    try {
        for (const chapter of data.project.chapters) {
            const existing = previous.get(chapter.id);
            if (existing?.chapter === chapter) next.set(chapter.id, existing);
            else {
                const file = `${randomUUID()}.json`;
                const target = path.join(chapterDirectory, file);
                created.push(target);
                await atomicJson(target, chapter);
                next.set(chapter.id, { chapter, file });
            }
        }
        const { chapters, ...project } = data.project;
        await atomicJson(path.join(directory, 'recovery.json'), {
            ...data, recoveryVersion: 2, project,
            chapterFiles: chapters.map(chapter => next.get(chapter.id).file),
        });
    } catch (error) {
        await Promise.all(created.map(file => fs.rm(file, { force: true }).catch(() => {})));
        throw error;
    }
    const retained = new Set([...next.values()].map(item => item.file));
    const files = await fs.readdir(chapterDirectory).catch(() => []);
    await Promise.all(files.filter(file => /^[a-f0-9-]{36}\.json$/.test(file) && !retained.has(file)).map(file => fs.rm(path.join(chapterDirectory, file), { force: true }).catch(() => {})));
    return next;
}

export async function readRecoveryChapters(directory, data) {
    if (data.recoveryVersion == null) return { project: data.project, recoveryFiles: new Map() };
    if (data.recoveryVersion !== 2 || !Array.isArray(data.chapterFiles) || !data.chapterFiles.length || data.chapterFiles.length > MAX_CHAPTERS
        || new Set(data.chapterFiles).size !== data.chapterFiles.length) throw projectError('INVALID_PROJECT');
    const chapterDirectory = path.join(directory, 'chapters');
    if (!(await fs.lstat(chapterDirectory)).isDirectory()) throw projectError('INVALID_PROJECT');
    const chapters = [];
    const recoveryFiles = new Map();
    let bytes = Buffer.byteLength(JSON.stringify(data));
    for (const file of data.chapterFiles) {
        if (typeof file !== 'string' || !/^[a-f0-9-]{36}\.json$/.test(file)) throw projectError('INVALID_PROJECT');
        const target = path.join(chapterDirectory, file);
        const stat = await fs.lstat(target);
        if (!stat.isFile()) throw projectError('INVALID_PROJECT');
        bytes += stat.size;
        if (bytes > MAX_DOCUMENT_BYTES + 16384 + MAX_CHAPTERS * 48) throw projectError('PROJECT_TOO_LARGE');
        let chapter;
        try { chapter = JSON.parse(await fs.readFile(target, 'utf8')); }
        catch (error) { if (error instanceof SyntaxError) throw projectError('INVALID_PROJECT'); throw error; }
        if (!chapter || typeof chapter.id !== 'string') throw projectError('INVALID_PROJECT');
        chapters.push(chapter);
        recoveryFiles.set(chapter.id, { chapter, file });
    }
    return { project: { ...data.project, chapters }, recoveryFiles };
}
