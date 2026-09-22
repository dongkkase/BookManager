export const MAX_TEXT_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_IMPORT_CHARACTERS = 30000000;
export const MAX_TEXT_IMPORT_PARAGRAPHS = 300000;
export const MAX_TEXT_PARAGRAPH_CHARACTERS = 2000000;
export const TEXT_CHAPTER_CHARACTERS = 100000;
export const TEXT_CHAPTER_PARAGRAPHS = 1000;

export function splitTextImportDocument(document) {
    const documents = [];
    let content = [];
    let characters = 0;
    for (const node of document.content || []) {
        const length = (node.content || []).reduce((total, child) => total + (child.text?.length || 0), 0);
        if (content.length && (content.length >= TEXT_CHAPTER_PARAGRAPHS || characters + 1 + length > TEXT_CHAPTER_CHARACTERS)) {
            documents.push({ type: 'doc', content });
            content = [];
            characters = 0;
        }
        characters += (content.length ? 1 : 0) + length;
        content.push(node);
    }
    if (content.length) documents.push({ type: 'doc', content });
    return documents;
}
