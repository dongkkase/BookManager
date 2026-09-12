function cssUnescape(value = '') {
    return String(value).replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n\f]))|\\[\r\n\f]/gi, (_match, hex, character) => {
        if (!hex) return character || '';
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    });
}

function quotedEnd(source, start) {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === quote) break;
    }
    return index;
}

function ruleEnd(source, start) {
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            index = end < 0 ? source.length : end + 1;
        } else if (source[index] === '"' || source[index] === "'") {
            index = quotedEnd(source, index) - 1;
        } else if (source[index] === '(') depth += 1;
        else if (source[index] === ')') depth -= 1;
        else if (source[index] === ';' && depth === 0) return index + 1;
        else if ((source[index] === '{' || source[index] === '}') && depth === 0) return start;
    }
    return start;
}

export function epubOriginalCssParts(cssText = '') {
    const source = String(cssText || '');
    const parts = [];
    let previous = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            index = end < 0 ? source.length : end + 1;
        } else if (source[index] === '"' || source[index] === "'") {
            index = quotedEnd(source, index) - 1;
        } else if (source[index] === '@' && /^@(?:import|charset)\b/i.test(source.slice(index))) {
            const end = ruleEnd(source, index);
            if (end <= index) continue;
            parts.push({ css: source.slice(previous, index) });
            const rule = source.slice(index, end);
            const match = rule.match(/^@import\s+(?:url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*([\s\S]*);$/i);
            if (match) {
                parts.push({
                    href: cssUnescape((match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim()),
                    condition: match[6].trim(),
                });
            }
            previous = end;
            index = end - 1;
        }
    }
    parts.push({ css: source.slice(previous) });
    return parts;
}

export function wrapEpubOriginalCssImport(css = '', condition = '') {
    let remaining = String(condition || '').trim();
    const wrappers = [];
    const layer = remaining.match(/^layer(?:\(\s*([\w.-]+)\s*\))?(?=\s|$)/i);
    if (layer) {
        wrappers.push(`@layer${layer[1] ? ` ${layer[1]}` : ''}`);
        remaining = remaining.slice(layer[0].length).trim();
    }
    if (/^supports\(/i.test(remaining)) {
        let depth = 1;
        let index = remaining.indexOf('(') + 1;
        const start = index;
        for (; index < remaining.length && depth > 0; index += 1) {
            if (remaining[index] === '(') depth += 1;
            if (remaining[index] === ')') depth -= 1;
        }
        if (depth === 0) {
            const support = remaining.slice(start, index - 1).trim();
            wrappers.push(`@supports ${support.startsWith('(') ? support : `(${support})`}`);
            remaining = remaining.slice(index).trim();
        }
    }
    if (remaining) wrappers.push(`@media ${remaining}`);
    return wrappers.reduceRight((result, wrapper) => `${wrapper} {\n${result}\n}`, css);
}

export function rewriteEpubOriginalCssUrls(cssText = '', resolveAsset = () => '') {
    const source = String(cssText || '');
    let output = '';
    let previous = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            index = end < 0 ? source.length : end + 1;
        } else if (source[index] === '"' || source[index] === "'") {
            index = quotedEnd(source, index) - 1;
        } else if ((index === 0 || !/[\w-]/.test(source[index - 1])) && /^url\s*\(/i.test(source.slice(index))) {
            const match = source.slice(index).match(/^url\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)/i);
            if (!match) continue;
            const href = cssUnescape((match[1] ?? match[2] ?? match[3] ?? '').trim());
            const safeUrl = href.startsWith('#')
                ? href
                : /^data:(?:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)|font\/(?:ttf|otf|woff2?)|application\/(?:font-woff|vnd\.ms-fontobject))[;,]/i.test(href)
                    ? href
                    : resolveAsset(href);
            output += source.slice(previous, index) + `url(${JSON.stringify(safeUrl || '')})`;
            previous = index + match[0].length;
            index = previous - 1;
        }
    }
    return output + source.slice(previous);
}
