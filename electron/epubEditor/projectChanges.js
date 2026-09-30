import { MAX_CHAPTERS, projectError } from './model.js';

export function projectChanges(previous, next) {
    const known = new Map(previous.chapters.map(chapter => [chapter.id, chapter]));
    const { chapters, ...project } = next;
    return {
        baseRevision: previous.revision,
        project,
        chapterIds: chapters.map(chapter => chapter.id),
        chapters: chapters.filter(chapter => known.get(chapter.id) !== chapter),
    };
}

export function applyProjectChanges(previous, changes) {
    if (!changes || changes.baseRevision !== previous.revision) throw projectError('RECOVERY_CONFLICT');
    const { project, chapterIds, chapters } = changes;
    if (!project || project.id !== previous.id || !Number.isSafeInteger(project.revision) || project.revision <= previous.revision || 'chapters' in project
        || !Array.isArray(chapterIds) || !chapterIds.length || chapterIds.length > MAX_CHAPTERS || new Set(chapterIds).size !== chapterIds.length
        || !Array.isArray(chapters) || chapters.length > chapterIds.length) throw projectError('INVALID_PROJECT');
    const known = new Map(previous.chapters.map(chapter => [chapter.id, chapter]));
    const updated = new Set();
    for (const chapter of chapters) {
        if (!chapter || !chapterIds.includes(chapter.id) || updated.has(chapter.id)) throw projectError('INVALID_PROJECT');
        updated.add(chapter.id);
        known.set(chapter.id, chapter);
    }
    return { ...project, chapters: chapterIds.map(id => {
        const chapter = known.get(id);
        if (!chapter) throw projectError('INVALID_PROJECT');
        return chapter;
    }) };
}
