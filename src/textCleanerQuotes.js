import { isProtectedTextLine } from './textCleanerPolicy.js';

export const MAX_RECORDED_QUOTE_ISSUES = 1000;
const QUOTE_PAIRS = new Map([
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』'],
]);
const CLOSING_QUOTES = new Set(QUOTE_PAIRS.values());
const WORD = /[\p{L}\p{N}]/u;

// Paragraph boundaries limit cascading warnings after a missing quote.
export function inspectTextQuotes(text = '') {
    const issues = [];
    const stack = [];
    let total = 0;
    let line = 1;
    let inFence = false;
    const record = (type, opening, end = opening.start + 1, actual = '') => {
        total += 1;
        if (issues.length >= MAX_RECORDED_QUOTE_ISSUES) return;
        issues.push({
            type, start: opening.start, end, line: opening.line,
            expected: opening.close || '', actual,
            preview: opening.preview,
        });
    };
    const flush = () => {
        for (const opening of stack) record('unclosed', opening);
        stack.length = 0;
    };

    for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
        const value = match[1];
        const fenceLine = /^\s*```/.test(value);
        if (!value.trim() || isProtectedTextLine(value, { inFence, ignoreSymbolRatio: true })) {
            flush();
        } else {
            let backslashes = 0;
            for (let index = 0; index < value.length; index += 1) {
                const character = value[index];
                const escaped = backslashes % 2 === 1;
                backslashes = character === '\\' ? backslashes + 1 : 0;
                if (escaped || (!QUOTE_PAIRS.has(character) && !CLOSING_QUOTES.has(character))) continue;
                const previous = value[index - 1] || '';
                const next = value[index + 1] || '';
                if ((character === "'" || character === '’') && WORD.test(previous) && WORD.test(next)) continue;
                const opening = stack.at(-1);
                if (opening?.close === character) {
                    stack.pop();
                    continue;
                }
                const straight = character === '"' || character === "'";
                const closingContext = previous && !/\s/u.test(previous)
                    && (!next || /[\s.,!?。？！…]/u.test(next) || /[.!?。？！…]/u.test(previous));
                if (!QUOTE_PAIRS.has(character) || (straight && closingContext)) {
                    if (opening) {
                        record('mismatch', stack.pop(), match.index + index + 1, character);
                        // If this also closes an outer quotation, recover that pair.
                        if (stack.at(-1)?.close === character) stack.pop();
                    } else {
                        record('unexpected', {
                            start: match.index + index, line,
                            preview: value.slice(Math.max(0, index - 70), index + 100),
                        }, match.index + index + 1, character);
                    }
                } else {
                    stack.push({
                        start: match.index + index, line, close: QUOTE_PAIRS.get(character),
                        preview: value.slice(Math.max(0, index - 70), index + 100),
                    });
                }
            }
        }
        if (fenceLine) inFence = !inFence;
        if (match[2]) line += 1;
    }
    flush();
    issues.sort((left, right) => left.start - right.start);
    return { issues, total, truncated: total > issues.length };
}
