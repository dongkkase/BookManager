export const MAX_PARAGRAPH_FORMATS = 100;
export const MAX_PARAGRAPH_FORMAT_BYTES = 512 * 1024;
export const PARAGRAPH_FORMAT_BASES = ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'];
export const DEFAULT_PARAGRAPH_FORMAT = {
    name: '', description: '', base: 'paragraph', font: 'inherit', fontSize: null,
    bold: null, italic: null, color: null, backgroundColor: null,
    lineHeight: null, spaceBefore: null, spaceAfter: null,
    alignment: null, indentLevel: 0, firstLineIndent: null,
};

export function paragraphFormatError(code) { return Object.assign(new Error(code), { code }); }

export function normalizeParagraphFormat(value, requireId = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'id' && !Object.hasOwn(DEFAULT_PARAGRAPH_FORMAT, key))) throw paragraphFormatError('PARAGRAPH_FORMAT_INVALID');
    const format = { ...DEFAULT_PARAGRAPH_FORMAT, ...value };
    const invalid = () => { throw paragraphFormatError('PARAGRAPH_FORMAT_INVALID'); };
    if ((requireId || format.id != null) && !/^pf_[a-f0-9-]{36}$/.test(format.id || '')) invalid();
    if (typeof format.name !== 'string' || !format.name.trim() || format.name.trim().length > 80 || /[\u0000-\u001f]/u.test(format.name)) invalid();
    if (typeof format.description !== 'string' || format.description.length > 240 || /[\u0000-\u001f]/u.test(format.description)) invalid();
    if (!PARAGRAPH_FORMAT_BASES.includes(format.base) || !['inherit', 'serif', 'sans-serif', 'monospace'].includes(format.font)) invalid();
    for (const key of ['color', 'backgroundColor']) if (format[key] !== null && (typeof format[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(format[key]))) invalid();
    for (const key of ['bold', 'italic']) if (format[key] !== null && typeof format[key] !== 'boolean') invalid();
    for (const [key, min, max] of [['fontSize', 10, 72], ['lineHeight', 1, 3], ['spaceBefore', 0, 5], ['spaceAfter', 0, 5], ['firstLineIndent', -3, 3]]) {
        if (format[key] !== null && (!Number.isFinite(format[key]) || format[key] < min || format[key] > max)) invalid();
    }
    if (format.fontSize !== null && !Number.isInteger(format.fontSize)) invalid();
    if (!Number.isInteger(format.indentLevel) || format.indentLevel < 0 || format.indentLevel > 8) invalid();
    if (format.alignment !== null && !['left', 'center', 'right', 'justify'].includes(format.alignment)) invalid();
    return { ...format, name: format.name.trim(), description: format.description.trim() };
}

export function paragraphFormatStyle(format, exported = false) {
    if (!format) return {};
    format = { ...DEFAULT_PARAGRAPH_FORMAT, ...format };
    return Object.fromEntries([
        ['fontFamily', format.font !== 'inherit' ? format.font : null],
        ['fontSize', format.fontSize != null ? exported ? `${format.fontSize / 16}rem` : `${format.fontSize}px` : null],
        ['fontWeight', format.bold === null ? null : format.bold ? '700' : '400'],
        ['fontStyle', format.italic === null ? null : format.italic ? 'italic' : 'normal'],
        ['color', format.color], ['backgroundColor', format.backgroundColor],
        ['lineHeight', format.lineHeight],
        ['marginTop', format.spaceBefore !== null ? `${format.spaceBefore}em` : null],
        ['marginBottom', format.spaceAfter !== null ? `${format.spaceAfter}em` : null],
    ].filter(([, value]) => value != null));
}

export function paragraphFormatCss(format, exported = false) {
    return Object.entries(paragraphFormatStyle(format, exported)).map(([key, value]) => `${key.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)}:${value}`).join(';');
}

export function validateParagraphFormatLibrary(value) {
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.formats) || value.formats.length > MAX_PARAGRAPH_FORMATS) throw paragraphFormatError('PARAGRAPH_FORMAT_LIBRARY_INVALID');
    try {
        const formats = value.formats.map(item => normalizeParagraphFormat(item, true));
        if (new Set(formats.map(item => item.id)).size !== formats.length || new Set(formats.map(item => item.name.toLowerCase())).size !== formats.length) throw new Error();
        return { version: 1, revision: value.revision, formats };
    } catch { throw paragraphFormatError('PARAGRAPH_FORMAT_LIBRARY_INVALID'); }
}
