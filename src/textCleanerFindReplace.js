export const DEFAULT_TEXT_SEARCH_OPTIONS = Object.freeze({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
});

function searchExpression(query, options) {
    const pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = '[\\p{L}\\p{N}\\p{M}_]';
    const flags = options.caseSensitive ? 'gmu' : 'gimu';
    const expression = new RegExp(pattern, flags);
    return options.wholeWord
        ? new RegExp(`(?<!${word})(?:${pattern})(?!${word})`, flags) : expression;
}

function* textMatches(text, query, options) {
    if (!query) return;
    const expression = searchExpression(query, options);
    let match;
    while ((match = expression.exec(text)) !== null) {
        yield match;
        if (!match[0].length) {
            expression.lastIndex += text.codePointAt(expression.lastIndex) > 0xffff ? 2 : 1;
        }
    }
}

export function searchText(text, query, options = DEFAULT_TEXT_SEARCH_OPTIONS, limit = 100000) {
    const matches = [];
    const ends = [];
    let totalCount = 0;
    for (const match of textMatches(text, query, options)) {
        totalCount += 1;
        if (matches.length < limit) {
            matches.push(match.index);
            ends.push(match.index + match[0].length);
        }
    }
    return { matches, ends, totalCount, truncated: totalCount > matches.length };
}

export function preserveTextCase(original, replacement) {
    if (original.toUpperCase() === original.toLowerCase()) return replacement;
    if (original === original.toUpperCase()) return replacement.toUpperCase();
    if (original === original.toLowerCase()) return replacement.toLowerCase();
    const originalParts = original.split(/([-_])/u);
    const replacementParts = replacement.split(/([-_])/u);
    if (originalParts.length > 1 && originalParts.length === replacementParts.length) {
        return replacementParts.map((part, index) => index % 2
            ? part : preserveTextCase(originalParts[index], part)).join('');
    }
    const [first, ...rest] = Array.from(original);
    if (first !== first.toLowerCase() && rest.join('') === rest.join('').toLowerCase()) {
        const [head = '', ...tail] = Array.from(replacement);
        return head.toUpperCase() + tail.join('').toLowerCase();
    }
    return replacement;
}

function replacementText(template, match, text, options) {
    let replacement = template;
    if (options.regex) {
        replacement = template.replace(/\\([nrt\\])|\$(\$|&|`|'|\d{1,2}|<[^>]+>)/gu, (token, escape, capture) => {
            if (escape) return { n: '\n', r: '\r', t: '\t', '\\': '\\' }[escape];
            if (capture === '$') return '$';
            if (capture === '&') return match[0];
            if (capture === '`') return text.slice(0, match.index);
            if (capture === "'") return text.slice(match.index + match[0].length);
            if (capture.startsWith('<')) return match.groups
                ? (match.groups[capture.slice(1, -1)] ?? '') : token;
            const index = Number(capture);
            if (index > 0 && index < match.length) return match[index] ?? '';
            const first = Number(capture[0]);
            return capture.length === 2 && first > 0 && first < match.length
                ? (match[first] ?? '') + capture[1] : token;
        });
    }
    replacement = replacement.replace(/\r\n?/g, '\n');
    return options.preserveCase ? preserveTextCase(match[0], replacement) : replacement;
}

export function replaceText(text, query, replacement, options = DEFAULT_TEXT_SEARCH_OPTIONS, { all = false, start = 0 } = {}) {
    const chunks = [];
    let firstMatch = null;
    let previousEnd = 0;
    let count = 0;
    let nextOffset = start;
    let change = null;
    for (const match of textMatches(text, query, options)) {
        firstMatch ??= match;
        if (!all && match.index < start) continue;
        const insert = replacementText(replacement, match, text, options);
        const end = match.index + match[0].length;
        count += 1;
        if (!all) {
            change = { from: match.index, to: end, insert };
            nextOffset = match.index + insert.length;
            if (!match[0].length) nextOffset += text.codePointAt(end) > 0xffff ? 2 : 1;
            break;
        }
        chunks.push(text.slice(previousEnd, match.index), insert);
        previousEnd = end;
    }
    if (!all && !change && firstMatch) {
        return replaceText(text, query, replacement, options, { start: firstMatch.index });
    }
    if (all && count) {
        chunks.push(text.slice(previousEnd));
        change = { from: 0, to: text.length, insert: chunks.join('') };
        nextOffset = 0;
    }
    const result = change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;
    return { change, count, nextOffset, search: searchText(result, query, options) };
}
