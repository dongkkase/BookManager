export const DEFAULT_TEXT_CLEANER_OPTIONS = Object.freeze({
    trimLeadingWhitespace: true,
    collapseRepeatedSpaces: true,
    joinBrokenLines: true,
});

export const MAX_RECORDED_TEXT_CHANGES = 10000;

const BOX_DRAWING_PATTERN = /[\u2500-\u257f]/g;
const SENTENCE_END_PATTERN = /[.!?。？！…][\s"'’”」』】)）》〉〕］}]*$/u;
const OPENING_LINE_PATTERN = /^[\s"'‘“「『【《〈〔［{(]*[-–—•·※◇◆○●□■▶▷►▸☆★▶]|^\s*(?:제?\s*\d+\s*(?:화|장|편)|chapter\s+\d+)\b/iu;
const TIMELINE_ENTRY_PATTERN = /^\s*\d{1,4}년\s*\d{1,2}월\s*\d{1,2}일\s*[:：]/u;
const TEXT_HEADING_PATTERN = /^\s*[-=+_*#~]{3,}\s*[\p{L}\p{N}]|(?:^|\s)제?\s*\d+\s*권\s*$/u;
const QUOTED_DIALOGUE_PATTERN = /^(?:"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』)$/u;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;
const KOREAN_PARTICLE_START_PATTERN = /^(?:은|는|이|가|을|를|의|와|과|에|에서|에게|으로|로|도|만|부터|까지)(?=\s|[.,!?。？！…]|$)/u;
const HARD_WRAP_LOCAL_WINDOW = 12;
const HAN_PHRASE_LINE_PATTERN = /^["'“‘「『]?[가-힣]+(?:\(\p{Script=Han}+\)|（\p{Script=Han}+）)(?:\s+[가-힣]+(?:\(\p{Script=Han}+\)|（\p{Script=Han}+）))*[.!?。？！…]*["'”’」』]?$/u;
const QUOTE_CLOSERS = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」', '『': '』' };
const CLOSING_QUOTES = new Set(Object.values(QUOTE_CLOSERS));

function quotedProseBoundaries(text) {
    const boundaries = new Map();
    let candidate = null;
    let inFence = false;
    for (const match of text.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
        const line = match[1];
        const trimmed = line.trim();
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            candidate = null;
            continue;
        }
        if (!trimmed) continue;
        if (!candidate && !QUOTE_CLOSERS[trimmed[0]]) continue;
        if (isProtectedTextLine(line, { inFence, ignoreSymbolRatio: true })
            || TEXT_HEADING_PATTERN.test(trimmed) || TIMELINE_ENTRY_PATTERN.test(trimmed)
            || OPENING_LINE_PATTERN.test(trimmed)) {
            candidate = null;
            continue;
        }
        if (!candidate) {
            candidate = { stack: [], boundaries: [], lastStart: null, sentenceEnd: false };
        }
        let closed = false;
        for (const quote of line.matchAll(/\\*["'“”‘’「」『』]/g)) {
            const character = quote[0].at(-1);
            const slashes = quote[0].length - 1;
            if (slashes % 2 === 1) continue;
            const index = quote.index + slashes;
            const previous = line[index - 1] || '';
            const next = line[index + 1] || '';
            if ((character === "'" || character === '’')
                && WORD_CHARACTER_PATTERN.test(previous) && WORD_CHARACTER_PATTERN.test(next)) continue;
            const straight = character === '"' || character === "'";
            // A new quoted paragraph must not close an earlier unfinished quotation.
            if (candidate.lastStart !== null && candidate.stack.length === 1
                && QUOTE_CLOSERS[character] === candidate.stack[0]
                && !line.slice(0, index).trim() && WORD_CHARACTER_PATTERN.test(next)) {
                candidate = { stack: [], boundaries: [], lastStart: null, sentenceEnd: false };
            }
            if (candidate.stack.at(-1) === character) {
                candidate.stack.pop();
                if (candidate.stack.length === 0) {
                    closed = true;
                    break;
                }
            } else {
                const closingContext = previous && !/\s/u.test(previous)
                    && (!next || /[\s.,!?。？！…]/u.test(next) || /[.!?。？！…]/u.test(previous));
                if (!QUOTE_CLOSERS[character] || (straight && closingContext)) {
                    candidate = null;
                    break;
                }
                candidate.stack.push(QUOTE_CLOSERS[character]);
            }
        }
        if (!candidate) continue;
        candidate.sentenceEnd ||= SENTENCE_END_PATTERN.test(trimmed);
        if (candidate.lastStart !== null) candidate.boundaries.push([candidate.lastStart, match.index]);
        candidate.lastStart = match.index;
        if (closed) {
            if (candidate.sentenceEnd) {
                for (const [start, nextStart] of candidate.boundaries) boundaries.set(start, nextStart);
            }
            candidate = null;
        }
    }
    return boundaries;
}

function isHanPhraseBoundary(previous, next) {
    return /[가-힣]+(?:\(\p{Script=Han}+\)|（\p{Script=Han}+）)$/u.test(previous.trimEnd())
        && /^[가-힣]+(?:\(\p{Script=Han}+\)|（\p{Script=Han}+）)/u.test(next.trimStart());
}

function stripProseDecoration(line) {
    return line.replace(/^(\s*)-{3,}/u, '$1').replace(/-{3,}(\s*)$/u, '$1');
}

function decoratedProseOffsets(text) {
    const offsets = new Set();
    if (!text.includes('---')) return offsets;
    let candidate = null;
    let inFence = false;
    for (const match of text.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)) {
        const line = match[1];
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            candidate = null;
            continue;
        }
        if (inFence) continue;
        const opening = line.match(/^\s*(-{3,})\s*\p{L}/u);
        if (opening) candidate = { marker: opening[1], starts: [] };
        if (!candidate) continue;
        const body = stripProseDecoration(line);
        if (!body.trim() || isProtectedTextLine(body)
            || (!opening && OPENING_LINE_PATTERN.test(body))) {
            candidate = null;
            continue;
        }
        candidate.starts.push(match.index);
        if (line.trimEnd().endsWith(candidate.marker)) {
            // Only paired, multiline prose with a sentence ending overrides heading protection.
            if (candidate.starts.length > 1 && SENTENCE_END_PATTERN.test(body.trimEnd())) {
                for (const start of candidate.starts) offsets.add(start);
            }
            candidate = null;
        }
    }
    return offsets;
}

export function isProtectedTextLine(line = '', state = {}) {
    const trimmed = line.trim();
    if (state.inFence || /^\s*```/.test(line)) return true;
    if (!trimmed) return false;

    const boxDrawingCount = (line.match(BOX_DRAWING_PATTERN) || []).length;
    if (boxDrawingCount >= 2) return true;
    if (/^\s*[-=+_*#~]{4,}\s*$/.test(line)) return true;
    if (/\t/.test(line) && line.split('\t').filter(part => part.trim()).length >= 2) return true;
    if ((line.match(/[|｜]/g) || []).length >= 2) return true;
    if (TEXT_HEADING_PATTERN.test(trimmed)) return false;
    if (state.inParenthesis && /^[\p{L}\p{N}][^()（）]*[)）]/u.test(trimmed)) return false;
    if (state.inHanQuote && HAN_PHRASE_LINE_PATTERN.test(trimmed)) return false;

    const columns = trimmed.split(/[^\S\r\n]{2,}/u);
    const hasColumnSpacing = columns.length >= 3
        || (columns.length === 2 && /\S[^\S\r\n]{3,}\S/u.test(trimmed));
    if (hasColumnSpacing && columns.every(column => !/\s/u.test(column))) return true;
    if (QUOTED_DIALOGUE_PATTERN.test(trimmed)
        || /^["'“‘「『].*[\p{L}\p{N}]/u.test(trimmed)) return false;
    if (state.ignoreSymbolRatio) return false;

    const visible = trimmed.replace(/\s/g, '');
    const symbols = visible.replace(/[\p{L}\p{N}]/gu, '');
    return visible.length >= 4 && symbols.length / visible.length >= 0.55;
}

function cleanLine(line, options, protectedLine) {
    if (protectedLine || !line) return line;
    let result = line;
    if (options.trimLeadingWhitespace) result = result.replace(/^[^\S\r\n]+/u, '');
    if (options.collapseRepeatedSpaces) result = result.replace(/[^\S\r\n]{2,}/gu, ' ');
    return result;
}

function joinSeparator(previousLine, nextLine) {
    const previousCharacter = previousLine.at(-1) || '';
    const nextCharacter = nextLine[0] || '';
    if (!previousCharacter || !nextCharacter) return '';
    if (/\s/u.test(previousCharacter) || /\s/u.test(nextCharacter)) return '';
    if (isHanPhraseBoundary(previousLine, nextLine)) return ' ';
    if (/[,;:，、]/u.test(previousCharacter) && WORD_CHARACTER_PATTERN.test(nextCharacter)) return ' ';
    if (/[\p{L}\p{N}]/u.test(previousCharacter) && /[\p{L}\p{N}]/u.test(nextCharacter)) {
        const bothHangul = /[가-힣]/u.test(previousCharacter) && /[가-힣]/u.test(nextCharacter);
        const bothHan = /\p{Script=Han}/u.test(previousCharacter) && /\p{Script=Han}/u.test(nextCharacter);
        return bothHangul || bothHan ? '' : ' ';
    }
    return '';
}

function isHanAnnotationBoundary(previousLine, nextLine) {
    return /[가-힣]$/u.test(previousLine)
        && /^(?:\(\p{Script=Han}+(?:\)|$)|（\p{Script=Han}+(?:）|$))/u.test(nextLine);
}

function shouldJoinBoundary(previousLine, nextLine, previousProtected, nextProtected, inHanQuote = false) {
    const previous = previousLine.trimEnd();
    const next = nextLine.trimStart();
    if (!previous || !next || previousProtected || nextProtected) return false;
    if (TIMELINE_ENTRY_PATTERN.test(previous) || TIMELINE_ENTRY_PATTERN.test(next)) return false;
    if (TEXT_HEADING_PATTERN.test(previous) || TEXT_HEADING_PATTERN.test(next)) return false;
    if (SENTENCE_END_PATTERN.test(previous)) return false;
    if (OPENING_LINE_PATTERN.test(next)) return false;
    if (inHanQuote && isHanPhraseBoundary(previous, next)) return true;
    if (/[\p{L}\p{N}][)）]+$/u.test(previous) && KOREAN_PARTICLE_START_PATTERN.test(next)) return true;
    if (isHanAnnotationBoundary(previous, next)) return true;

    const previousCharacter = previous.at(-1) || '';
    const nextCharacter = next[0] || '';
    if (!WORD_CHARACTER_PATTERN.test(previousCharacter) && !/[,;:，、]/u.test(previousCharacter)) return false;
    return WORD_CHARACTER_PATTERN.test(nextCharacter) || /^[가-힣]+[.!?。？！…]/u.test(next);
}

function detectBlankSeparatedHardWrap(text) {
    const lineLengths = [0];
    const contentLineNumbers = [];
    const contentLengths = [];
    let sourceOffset = 0;
    let lineNumber = 1;

    while (sourceOffset <= text.length) {
        let newlineIndex = -1;
        for (let index = sourceOffset; index < text.length; index += 1) {
            if (text[index] === '\n' || text[index] === '\r') {
                newlineIndex = index;
                break;
            }
        }
        const lineEnd = newlineIndex >= 0 ? newlineIndex : text.length;
        const lineLength = text.slice(sourceOffset, lineEnd).trim().length;
        lineLengths[lineNumber] = lineLength;
        if (lineLength > 0) {
            contentLineNumbers.push(lineNumber);
            contentLengths.push(lineLength);
        }
        if (newlineIndex < 0) break;
        sourceOffset = newlineIndex
            + (text[newlineIndex] === '\r' && text[newlineIndex + 1] === '\n' ? 2 : 1);
        lineNumber += 1;
    }

    let alternatingBoundaryCount = 0;
    for (const currentLineNumber of contentLineNumbers) {
        if (!lineLengths[currentLineNumber + 1] && lineLengths[currentLineNumber + 2]) {
            alternatingBoundaryCount += 1;
        }
    }

    const alternatingRatio = alternatingBoundaryCount / Math.max(1, contentLineNumbers.length);
    if (alternatingBoundaryCount < 8 || alternatingRatio < 0.6) return null;

    const wrappedLineNumbers = new Set();
    for (let index = 0; index < contentLineNumbers.length; index += 1) {
        const currentLineNumber = contentLineNumbers[index];
        if (lineLengths[currentLineNumber + 1] || !lineLengths[currentLineNumber + 2]) continue;
        const windowStart = Math.max(0, index - HARD_WRAP_LOCAL_WINDOW);
        const windowEnd = Math.min(contentLengths.length, index + HARD_WRAP_LOCAL_WINDOW + 1);
        const nearbyLengths = contentLengths.slice(windowStart, windowEnd).sort((left, right) => left - right);
        const expectedLength = nearbyLengths[Math.floor((nearbyLengths.length - 1) * 0.75)] || 0;
        const tolerance = Math.max(2, Math.round(expectedLength * 0.06));
        const similarLengthCount = nearbyLengths.filter(length => (
            Math.abs(length - expectedLength) <= tolerance
        )).length;
        const hasRepeatedWrapWidth = similarLengthCount >= Math.max(4, Math.ceil(nearbyLengths.length * 0.3));
        if (hasRepeatedWrapWidth && contentLengths[index] >= expectedLength - tolerance) {
            wrappedLineNumbers.add(currentLineNumber);
        }
    }

    return { wrappedLineNumbers };
}

function shouldJoinHardWrappedBoundary(
    previousLine,
    nextLine,
    previousProtected,
    nextProtected,
    hardWrap,
    lineNumber,
) {
    if (!hardWrap || previousProtected || nextProtected) return false;
    const previous = previousLine.trim();
    const next = nextLine.trim();
    if (!previous || !next || !hardWrap.wrappedLineNumbers.has(lineNumber)) return false;
    if (TIMELINE_ENTRY_PATTERN.test(previous) || TIMELINE_ENTRY_PATTERN.test(next)) return false;
    if (TEXT_HEADING_PATTERN.test(previous) || TEXT_HEADING_PATTERN.test(next)) return false;
    if (SENTENCE_END_PATTERN.test(previous) || CLOSING_QUOTES.has(previous.at(-1))) return false;
    if (OPENING_LINE_PATTERN.test(next)) return false;
    return WORD_CHARACTER_PATTERN.test(next[0] || '') || isHanAnnotationBoundary(previous, next);
}

function changePreview(value) {
    return value.length <= 180 ? value : `${value.slice(0, 177)}…`;
}

export function cleanText(sourceText = '', requestedOptions = {}) {
    const text = String(sourceText ?? '');
    const options = { ...DEFAULT_TEXT_CLEANER_OPTIONS, ...requestedOptions };
    const hardWrap = options.joinBrokenLines ? detectBlankSeparatedHardWrap(text) : null;
    const quoteBoundaries = options.joinBrokenLines ? quotedProseBoundaries(text) : new Map();
    const decoratedOffsets = decoratedProseOffsets(text);
    const changes = [];
    const outputChunks = [];
    let outputParts = [];
    let outputPartsLength = 0;
    let resultOffset = 0;
    let changeCount = 0;
    let protectedLineCount = 0;
    let inFence = false;
    let parenthesisDepth = 0;
    let hanQuoteCloser = null;
    let sourceOffset = 0;
    let lineNumber = 1;
    const pendingLines = [];

    const appendOutput = value => {
        outputParts.push(value);
        outputPartsLength += value.length;
        resultOffset += value.length;
        if (outputPartsLength >= 1024 * 1024) {
            outputChunks.push(outputParts.join(''));
            outputParts = [];
            outputPartsLength = 0;
        }
    };
    const recordChange = change => {
        changeCount += 1;
        if (changes.length < MAX_RECORDED_TEXT_CHANGES) changes.push(change);
    };
    const emitLine = (line, nextLine = null, skippedLines = []) => {
        const lineResultStart = resultOffset;
        appendOutput(line.cleaned);
        if (line.original !== line.cleaned) {
            recordChange({
                id: `whitespace-${line.number}`,
                type: 'whitespace',
                line: line.number,
                before: changePreview(line.original),
                after: changePreview(line.cleaned),
                sourceStart: line.start,
                sourceEnd: line.start + line.original.length,
                resultStart: lineResultStart,
                resultEnd: resultOffset,
            });
        }

        if (!line.newline) return;
        const quoteJoin = nextLine && quoteBoundaries.get(line.start) === nextLine.start;
        const directJoin = skippedLines.length === 0
            && options.joinBrokenLines
            && nextLine
            && shouldJoinBoundary(
                line.boundary, nextLine.cleaned, line.protected, nextLine.protected,
                line.hanQuote && nextLine.hanQuote,
            );
        const hardWrapJoin = skippedLines.length === 1
            && options.joinBrokenLines
            && nextLine
            && !skippedLines[0].cleaned.trim()
            && shouldJoinHardWrappedBoundary(
                line.boundary,
                nextLine.cleaned,
                line.protected,
                nextLine.protected,
                hardWrap,
                line.number,
            );
        const join = quoteJoin || directJoin || hardWrapJoin;
        if (join) {
            const quotePunctuationBoundary = quoteJoin && (
                /^["'“‘「『]+$/u.test(line.cleaned.trim())
                || /^["'”’」』]+[.!?。？！…]*$/u.test(nextLine.cleaned.trim())
            );
            const separator = quoteJoin && !directJoin && !hardWrapJoin
                && !quotePunctuationBoundary
                && !/\s$/u.test(line.cleaned) && !/^\s/u.test(nextLine.cleaned)
                ? ' ' : joinSeparator(line.cleaned, nextLine.cleaned);
            const boundaryText = line.newline
                + skippedLines.map(skippedLine => skippedLine.original + skippedLine.newline).join('');
            const lastBoundaryLine = skippedLines.at(-1) || line;
            recordChange({
                id: `line-break-${line.number}`,
                type: 'lineBreak',
                line: line.number,
                before: changePreview(boundaryText.replace(/\r/g, '\\r').replace(/\n/g, '\\n')),
                after: separator,
                sourceStart: line.start + line.original.length,
                sourceEnd: lastBoundaryLine.start
                    + lastBoundaryLine.original.length
                    + lastBoundaryLine.newline.length,
                resultStart: resultOffset,
                resultEnd: resultOffset + separator.length,
            });
            appendOutput(separator);
        } else {
            appendOutput(line.newline);
        }
        return join;
    };
    const flushPendingLines = final => {
        while (pendingLines.length > 0) {
            if (pendingLines.length === 1) {
                if (final) emitLine(pendingLines.shift());
                return;
            }
            const quoteNextStart = quoteBoundaries.get(pendingLines[0].start);
            if (quoteNextStart !== undefined) {
                if (pendingLines.at(-1).start < quoteNextStart && !final) return;
                const nextIndex = pendingLines.findIndex(line => line.start === quoteNextStart);
                if (nextIndex > 0) {
                    emitLine(pendingLines[0], pendingLines[nextIndex], pendingLines.slice(1, nextIndex));
                    pendingLines.splice(0, nextIndex);
                    continue;
                }
            }
            if (!final && pendingLines.length === 2 && !pendingLines[1].cleaned.trim()) return;

            const line = pendingLines[0];
            if (
                pendingLines.length >= 3
                && !pendingLines[1].cleaned.trim()
                && pendingLines[2].cleaned.trim()
            ) {
                const joined = emitLine(line, pendingLines[2], [pendingLines[1]]);
                pendingLines.shift();
                if (joined) pendingLines.shift();
                continue;
            }
            emitLine(line, pendingLines[1]);
            pendingLines.shift();
        }
    };

    while (sourceOffset <= text.length) {
        let newlineIndex = -1;
        for (let index = sourceOffset; index < text.length; index += 1) {
            if (text[index] === '\n' || text[index] === '\r') {
                newlineIndex = index;
                break;
            }
        }

        const lineEnd = newlineIndex >= 0 ? newlineIndex : text.length;
        const original = text.slice(sourceOffset, lineEnd);
        let newline = '';
        if (newlineIndex >= 0) {
            newline = text[newlineIndex] === '\r' && text[newlineIndex + 1] === '\n' ? '\r\n' : text[newlineIndex];
        }
        const fenceLine = /^\s*```/.test(original);
        const classificationText = decoratedOffsets.has(sourceOffset) ? stripProseDecoration(original) : original;
        const trimmed = original.trim();
        const quoteCloser = hanQuoteCloser || QUOTE_CLOSERS[trimmed[0]];
        const hanQuote = Boolean(quoteCloser && HAN_PHRASE_LINE_PATTERN.test(trimmed));
        const protectedLine = isProtectedTextLine(classificationText, {
            inFence,
            inParenthesis: parenthesisDepth > 0,
            inHanQuote: hanQuote,
        });
        hanQuoteCloser = hanQuote && !protectedLine && !/["'”’」』]$/u.test(trimmed) ? quoteCloser : null;
        if (protectedLine || !original.trim() || TEXT_HEADING_PATTERN.test(classificationText) || TIMELINE_ENTRY_PATTERN.test(original)) {
            parenthesisDepth = 0;
        } else {
            for (const character of original) {
                if (character === '(' || character === '（') parenthesisDepth += 1;
                if (character === ')' || character === '）') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
            }
        }
        if (protectedLine) protectedLineCount += 1;
        const cleaned = cleanLine(original, options, protectedLine);
        const currentLine = {
            original,
            cleaned,
            boundary: decoratedOffsets.has(sourceOffset) ? stripProseDecoration(cleaned) : cleaned,
            hanQuote,
            protected: protectedLine,
            start: sourceOffset,
            newline,
            number: lineNumber,
        };
        if (fenceLine) inFence = !inFence;
        pendingLines.push(currentLine);
        flushPendingLines(false);

        if (newlineIndex < 0) break;
        sourceOffset = newlineIndex + newline.length;
        lineNumber += 1;
    }
    flushPendingLines(true);
    if (outputParts.length > 0) outputChunks.push(outputParts.join(''));

    return {
        text: outputChunks.join(''),
        changes,
        changeCount,
        changesTruncated: changeCount > changes.length,
        protectedLineCount,
        sourceLength: text.length,
    };
}
