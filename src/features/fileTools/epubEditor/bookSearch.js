import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { findDocumentMatches, replaceSearchMatches, selectedSearchIndex } from './search.js';

// Workers only need the document schema, without DOM parsers, renderers or node views.
export function searchSchemaSpec(schema) {
    const describe = (types, keys) => Object.fromEntries(Object.entries(types).map(([name, type]) => {
        const spec = Object.fromEntries(keys.filter(key => type.spec[key] !== undefined).map(key => [key, type.spec[key]]));
        if (type.spec.attrs) spec.attrs = Object.fromEntries(Object.entries(type.spec.attrs).map(([key, attr]) => [key, Object.hasOwn(attr, 'default') ? { default: attr.default } : {}]));
        return [name, spec];
    }));
    return {
        nodes: describe(schema.nodes, ['content', 'group', 'inline', 'atom', 'marks', 'code', 'whitespace']),
        marks: describe(schema.marks, ['group', 'inclusive', 'excludes', 'spanning', 'code']),
        topNode: schema.topNodeType.name,
    };
}

export function createBookSearchIndex(spec) {
    const schema = new Schema(spec);
    const chapters = new Map();
    let ids = [];
    return {
        sync({ chapterIds, updates }) {
            const retained = new Set(chapterIds);
            for (const id of chapters.keys()) if (!retained.has(id)) chapters.delete(id);
            for (const chapter of updates) chapters.set(chapter.id, chapter.content);
            ids = chapterIds;
        },
        find(query, caseSensitive = false) {
            return ids.map(id => ({ id, count: query ? findDocumentMatches(schema.nodeFromJSON(chapters.get(id)), query, { caseSensitive }).length : 0 }));
        },
        replaceAll(query, replacement, caseSensitive = false) {
            const updates = [];
            let count = 0;
            if (!query) return { updates, count };
            for (const id of ids) {
                const doc = schema.nodeFromJSON(chapters.get(id));
                const matches = findDocumentMatches(doc, query, { caseSensitive });
                if (!matches.length) continue;
                const result = replaceSearchMatches(EditorState.create({ doc }), matches, replacement);
                if (!result.count) continue;
                result.transaction.doc.check();
                updates.push({ id, content: result.transaction.doc.toJSON() });
                count += result.count;
            }
            return { updates, count };
        },
    };
}

export function adjacentBookMatch(counts, chapterId, matches, selection, direction = 1) {
    const chapterIndex = counts.findIndex(item => item.id === chapterId);
    if (chapterIndex < 0) return null;
    const step = direction < 0 ? -1 : 1;
    const selected = selectedSearchIndex(matches, selection);
    let index = selected + step;
    if (selected < 0) {
        index = step > 0 ? matches.findIndex(match => match.from >= selection.to) : matches.findLastIndex(match => match.to <= selection.from);
    }
    if (index >= 0 && index < matches.length) return { chapterId, index };
    for (let offset = 1; offset <= counts.length; offset += 1) {
        const chapter = counts[(chapterIndex + step * offset + counts.length) % counts.length];
        const count = chapter.id === chapterId ? matches.length : chapter.count;
        if (count) return { chapterId: chapter.id, index: step > 0 ? 0 : count - 1 };
    }
    return null;
}

export function bookSearchPosition(counts, chapterId, matches, selection) {
    let total = 0;
    let chapters = 0;
    let current = 0;
    for (const chapter of counts) {
        const count = chapter.id === chapterId ? matches.length : chapter.count;
        if (chapter.id === chapterId) {
            const selected = selectedSearchIndex(matches, selection);
            if (selected >= 0) current = total + selected + 1;
        }
        total += count;
        if (count) chapters += 1;
    }
    return { total, current, chapters };
}
