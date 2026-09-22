import { Fragment, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { prepareTemplateContent, TEMPLATE_CHAPTER, MAX_TEMPLATE_BYTES } from '../../../../electron/epubEditor/contentTemplates.js';
import { projectError } from '../../../../electron/epubEditor/model.js';

export function captureTemplate(state, chapterId, wholeChapter = false) {
    if (!wholeChapter && state.selection.empty) throw projectError('TEMPLATE_SELECTION_REQUIRED');
    const fragment = wholeChapter ? state.doc.content : state.selection.content().content;
    if (fragment.size > MAX_TEMPLATE_BYTES) throw projectError('TEMPLATE_TOO_LARGE');
    let content = fragment.toJSON() || [{ type: 'paragraph' }];
    if (content.every(node => ['tableCell', 'tableHeader'].includes(node.type))) content = [{ type: 'tableRow', content }];
    if (content.every(node => node.type === 'tableRow')) content = [{ type: 'table', content }];
    if (content.every(node => node.type === 'listItem')) content = [{ type: 'bulletList', content }];
    if (content.every(node => ['text', 'hardBreak', 'footnote'].includes(node.type))) content = [{ type: 'paragraph', content }];
    if (content.every(node => node.type === 'column')) content = [{ type: 'columns', content }];
    const complete = node => {
        for (const child of node.content || []) complete(child);
        if (node.type === 'listItem' && node.content?.[0]?.type !== 'paragraph') node.content.unshift({ type: 'paragraph' });
        if (node.type === 'columns') while (node.content.length < 2) node.content.push({ type: 'column', content: [{ type: 'paragraph' }] });
    };
    content.forEach(complete);
    if (new TextEncoder().encode(JSON.stringify(content)).length > MAX_TEMPLATE_BYTES) throw projectError('TEMPLATE_TOO_LARGE');
    return prepareTemplateContent({ type: 'doc', content }, chapterId);
}

export function templateInsertionTransaction(state, content, chapterId) {
    const prepared = prepareTemplateContent(content, TEMPLATE_CHAPTER, chapterId).content;
    const doc = state.schema.nodeFromJSON(prepared);
    doc.check();
    const tr = closeHistory(state.tr).replaceSelection(new Slice(Fragment.from(doc.content), 0, 0));
    if (!tr.docChanged) throw projectError('TEMPLATE_INSERT_FAILED');
    tr.setStoredMarks(null);
    return tr.scrollIntoView();
}
