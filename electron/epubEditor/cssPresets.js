import { inspectCss } from './css.js';

export const MAX_CSS_LENGTH = 100000;
export const MAX_CSS_PRESETS = 100;
export const MAX_PRESET_FILE_BYTES = 4 * 1024 * 1024;

export const BUILTIN_CSS_PRESETS = [
    { id: 'builtin-reading', nameKey: 'presetReading', descriptionKey: 'presetReadingHint', css: 'p {\n    line-height: 1.8;\n    margin: 0 0 0.8em;\n    text-indent: 1em;\n    orphans: 2;\n    widows: 2;\n}\n' },
    { id: 'builtin-heading', nameKey: 'presetHeadings', descriptionKey: 'presetHeadingsHint', css: 'h1, h2, h3 {\n    line-height: 1.4;\n    margin: 1.5em 0 0.7em;\n    break-after: avoid;\n    page-break-after: avoid;\n}\nh2 {\n    border-bottom: 1px solid #b8bdb7;\n    padding-bottom: 0.4em;\n}\n' },
    { id: 'builtin-quote', nameKey: 'presetQuote', descriptionKey: 'presetQuoteHint', css: 'blockquote {\n    margin: 1.2em 0;\n    padding: 0.8em 1em;\n    border-left: 3px solid #789d87;\n    background-color: #f2f5f2;\n    color: #303b33;\n}\nblockquote p {\n    text-indent: 0;\n    margin: 0;\n}\n' },
    { id: 'builtin-table', nameKey: 'presetTable', descriptionKey: 'presetTableHint', css: 'table {\n    border-collapse: collapse;\n    width: 100%;\n    margin: 1em 0;\n}\nth, td {\n    border: 1px solid #aeb5b0;\n    padding: 0.6em;\n    vertical-align: top;\n}\nth {\n    background-color: #e8eee9;\n    color: #24362b;\n}\nth p, td p {\n    text-indent: 0;\n    margin: 0;\n}\n' },
    { id: 'builtin-figure', nameKey: 'presetFigure', descriptionKey: 'presetFigureHint', css: 'figure {\n    break-inside: avoid;\n    page-break-inside: avoid;\n}\nfigure img {\n    max-width: 100%;\n    height: auto;\n}\nfigcaption {\n    font-size: 0.85em;\n    line-height: 1.5;\n    text-align: center;\n    margin-top: 0.5em;\n}\n' },
    { id: 'builtin-footnote', nameKey: 'presetNotes', descriptionKey: 'presetNotesHint', css: '.footnotes {\n    margin-top: 2em;\n    padding-top: 1em;\n    border-top: 1px solid #aeb5b0;\n    font-size: 0.85em;\n    line-height: 1.6;\n}\n.footnotes p {\n    text-indent: 0;\n    margin-bottom: 0.6em;\n}\n' },
];

export function presetError(code) { return Object.assign(new Error(code), { code }); }

export function validateCssPreset(preset) {
    if (!preset || typeof preset !== 'object' || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.trim().length > 80 ||
        typeof preset.description !== 'string' || preset.description.length > 240 || typeof preset.css !== 'string' || !preset.css.trim() || preset.css.length > MAX_CSS_LENGTH ||
        (preset.id != null && !/^css_[a-f0-9-]{36}$/.test(preset.id))) throw presetError('PRESET_INVALID');
    const error = inspectCss(preset.css).error;
    if (error) throw presetError(error.code);
    return { ...(preset.id ? { id: preset.id } : {}), name: preset.name.trim(), description: preset.description.trim(), css: preset.css };
}

export function validatePresetLibrary(value) {
    if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.presets) || value.presets.length > MAX_CSS_PRESETS) throw presetError('PRESET_LIBRARY_INVALID');
    const ids = new Set();
    const names = new Set();
    try {
        for (const item of value.presets) {
            validateCssPreset(item);
            const name = item.name.trim().toLowerCase();
            if (!item.id || ids.has(item.id) || names.has(name)) throw presetError('PRESET_LIBRARY_INVALID');
            ids.add(item.id);
            names.add(name);
        }
    } catch { throw presetError('PRESET_LIBRARY_INVALID'); }
    return value;
}

export function applyCssPreset(current, css, mode = 'append') {
    if (!['append', 'replace'].includes(mode) || typeof current !== 'string' || typeof css !== 'string' || !css.trim()) throw presetError('PRESET_INVALID');
    const result = mode === 'replace' || !current.trim() ? css : `${current.replace(/\s+$/, '')}\n\n${css}`;
    if (result.length > MAX_CSS_LENGTH) throw presetError('CSS_TOO_LARGE');
    const error = inspectCss(result).error;
    if (error) throw presetError(error.code);
    return result;
}
