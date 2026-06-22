const EXTENSION_PATTERN = /(\.[^./\\]+)$/;
const TRAILING_VOLUME_PATTERN = /([ \t._-]*(?:(?:제\s*)?\d+(?:\.\d+)?\s*(?:권|화)|(?:v|vol\.?|volume)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*[\])）】}]*)?)$/i;

export function splitMetadataFileDisplayName(name = '') {
    const text = String(name || '');
    const extensionMatch = text.match(EXTENSION_PATTERN);
    if (!extensionMatch) return { head: text, tail: '' };

    const extension = extensionMatch[1];
    const stem = text.slice(0, -extension.length);
    const volumeMatch = stem.match(TRAILING_VOLUME_PATTERN);
    if (!volumeMatch) return { head: stem, tail: extension };

    const volumeSuffix = volumeMatch[1];
    const head = stem.slice(0, -volumeSuffix.length);
    if (!head) return { head: '', tail: `${stem}${extension}` };
    return { head, tail: `${volumeSuffix}${extension}` };
}
