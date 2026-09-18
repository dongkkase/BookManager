export const FILE_TOOL_CATEGORIES = Object.freeze([
    { id: 'text', labelKey: 'tools.category.text' },
    { id: 'conversion', labelKey: 'tools.category.conversion' },
    { id: 'archive-image', labelKey: 'tools.category.archive_image' },
    { id: 'document-ai', labelKey: 'tools.category.document_ai' },
]);

export const FILE_TOOLS = Object.freeze([
    {
        id: 'text-cleaner',
        category: 'text',
        labelKey: 'tools.item.text_cleaner',
        icon: 'fileLines',
        tone: 'blue',
        status: 'available',
        target: { type: 'tool', toolId: 'text-cleaner' },
    },
    {
        id: 'text-encoding',
        category: 'text',
        labelKey: 'tools.item.text_encoding',
        icon: 'language',
        tone: 'cyan',
        status: 'planned',
    },
    {
        id: 'text-split-merge',
        category: 'text',
        labelKey: 'tools.item.text_split_merge',
        icon: 'copy',
        tone: 'violet',
        status: 'planned',
    },
    {
        id: 'txt-to-epub',
        category: 'conversion',
        labelKey: 'tools.item.txt_to_epub',
        icon: 'book',
        tone: 'green',
        status: 'planned',
    },
    {
        id: 'txt-to-pdf',
        category: 'conversion',
        labelKey: 'tools.item.txt_to_pdf',
        icon: 'file',
        tone: 'red',
        status: 'planned',
    },
    {
        id: 'images-to-pdf',
        category: 'conversion',
        labelKey: 'tools.item.images_to_pdf',
        icon: 'image',
        tone: 'orange',
        status: 'planned',
    },
    {
        id: 'archive-organizer',
        category: 'archive-image',
        labelKey: 'tools.item.archive_organizer',
        icon: 'archive',
        tone: 'violet',
        status: 'available',
        target: { type: 'tab', tabId: 'organizer' },
    },
    {
        id: 'inner-renamer',
        category: 'archive-image',
        labelKey: 'tools.item.inner_renamer',
        icon: 'fileSignature',
        tone: 'cyan',
        status: 'available',
        target: { type: 'tab', tabId: 'renamer' },
    },
    {
        id: 'image-resizer',
        category: 'archive-image',
        labelKey: 'tools.item.image_resizer',
        icon: 'sliders',
        tone: 'blue',
        status: 'planned',
    },
    {
        id: 'ai-upscaler',
        category: 'archive-image',
        labelKey: 'tools.item.ai_upscaler',
        icon: 'wand',
        tone: 'pink',
        status: 'planned',
    },
    {
        id: 'metadata-manager',
        category: 'document-ai',
        labelKey: 'tools.item.metadata_manager',
        icon: 'bookOpen',
        tone: 'green',
        status: 'available',
        target: { type: 'tab', tabId: 'metadata' },
    },
    {
        id: 'pdf-split-merge',
        category: 'document-ai',
        labelKey: 'tools.item.pdf_split_merge',
        icon: 'layer-group',
        tone: 'red',
        status: 'planned',
    },
    {
        id: 'pdf-ocr',
        category: 'document-ai',
        labelKey: 'tools.item.pdf_ocr',
        icon: 'search',
        tone: 'orange',
        status: 'planned',
    },
]);

export function fileToolsByCategory(categoryId) {
    return FILE_TOOLS.filter(tool => tool.category === categoryId);
}

export function isTextCleanerPath(filePath = '') {
    return /\.txt$/i.test(String(filePath));
}

export function firstTextCleanerPath(paths = []) {
    return paths.find(isTextCleanerPath) || '';
}
