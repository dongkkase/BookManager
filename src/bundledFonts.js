export const DEFAULT_BUNDLED_FONT_OPTIONS = [
    { value: 'Default', label: 'Default' },
];

function uniqueByValue(options = []) {
    const seen = new Set();
    const result = [];
    for (const option of options) {
        const value = String(option?.value || '').trim();
        if (!value) continue;
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ value, label: String(option?.label || value) });
    }
    return result;
}

export function bundledFontOptionsFromFaces(fontFaces = []) {
    const faceOptions = (Array.isArray(fontFaces) ? fontFaces : [])
        .map(face => {
            const family = String(face?.family || '').trim();
            return family ? { value: family, label: family } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.label.localeCompare(b.label));
    return uniqueByValue([...DEFAULT_BUNDLED_FONT_OPTIONS, ...faceOptions]);
}

function cssString(value = '') {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function fileUrlFromPath(filePath = '') {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (!normalized) return '';
    const withPrefix = normalized.startsWith('/')
        ? `file://${normalized}`
        : `file:///${normalized}`;
    return encodeURI(withPrefix).replace(/#/g, '%23');
}

export function installBundledFontFaces(fontFaces = [], documentRef = globalThis.document) {
    if (!documentRef?.head) return;
    const styleId = 'bookmanager-bundled-font-faces';
    const previous = documentRef.getElementById(styleId);
    if (previous) previous.remove();

    const rules = (Array.isArray(fontFaces) ? fontFaces : [])
        .map(face => {
            const family = String(face?.family || '').trim();
            const url = fileUrlFromPath(face?.path);
            if (!family || !url) return '';
            const weight = Number(face.weight) || 400;
            const style = face.style === 'italic' ? 'italic' : 'normal';
            const format = face.format === 'opentype' ? 'opentype' : 'truetype';
            return [
                '@font-face {',
                `  font-family: '${cssString(family)}';`,
                `  src: url('${cssString(url)}') format('${format}');`,
                `  font-weight: ${weight};`,
                `  font-style: ${style};`,
                '  font-display: swap;',
                '}',
            ].join('\n');
        })
        .filter(Boolean)
        .join('\n\n');

    if (!rules) return;
    const style = documentRef.createElement('style');
    style.id = styleId;
    style.textContent = rules;
    documentRef.head.appendChild(style);
}
