import path from 'node:path';
import { AUDIO_EXTENSION_VALUES } from './audioMetadata.js';

export const FILE_ASSOCIATION_GROUPS = Object.freeze([
    Object.freeze({
        key: 'comic',
        viewerProgramType: 'comic',
        extensions: Object.freeze(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7']),
    }),
    Object.freeze({
        key: 'document',
        viewerProgramType: '',
        extensions: Object.freeze(['.epub', '.pdf']),
    }),
    Object.freeze({
        key: 'text',
        viewerProgramType: 'text',
        extensions: Object.freeze(['.txt', '.text', '.log', '.md']),
    }),
    Object.freeze({
        key: 'audio',
        viewerProgramType: '',
        extensions: AUDIO_EXTENSION_VALUES,
    }),
]);

export const FILE_ASSOCIATION_EXTENSIONS = Object.freeze(
    FILE_ASSOCIATION_GROUPS.flatMap(group => group.extensions),
);

const FILE_ASSOCIATION_EXTENSION_SET = new Set(FILE_ASSOCIATION_EXTENSIONS);
const FILE_ASSOCIATION_GROUP_BY_EXTENSION = new Map(
    FILE_ASSOCIATION_GROUPS.flatMap(group => (
        group.extensions.map(extension => [extension, group.key])
    )),
);

export function normalizeFileAssociationExtension(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

export function isSupportedFileAssociationExtension(value = '') {
    return FILE_ASSOCIATION_EXTENSION_SET.has(normalizeFileAssociationExtension(value));
}

export function normalizeFileAssociationExtensions(values = []) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const extension = normalizeFileAssociationExtension(value);
        if (!FILE_ASSOCIATION_EXTENSION_SET.has(extension) || seen.has(extension)) continue;
        seen.add(extension);
        result.push(extension);
    }
    return result;
}

export function fileAssociationGroupForExtension(value = '') {
    return FILE_ASSOCIATION_GROUP_BY_EXTENSION.get(normalizeFileAssociationExtension(value)) || '';
}

export function viewerTypeForAssociatedPath(filePath = '') {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    const group = fileAssociationGroupForExtension(extension);
    if (group === 'comic') return 'comic';
    if (extension === '.epub') return 'epub';
    if (extension === '.pdf') return 'pdf';
    if (group === 'text') return 'text';
    if (group === 'audio') return 'audio';
    return '';
}

export function configuredViewerTypeForAssociatedPath(filePath = '') {
    const viewerType = viewerTypeForAssociatedPath(filePath);
    return ['comic', 'epub', 'pdf', 'text'].includes(viewerType) ? viewerType : '';
}
