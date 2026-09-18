function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeTextLineEndings(text = '') {
    return String(text ?? '').replace(/\r\n?/g, '\n');
}

function isCanonicalWhitespace(value, index) {
    const code = value.charCodeAt(index);
    return code <= 0x20
        || code === 0x00a0
        || code === 0x1680
        || (code >= 0x2000 && code <= 0x200a)
        || code === 0x2028
        || code === 0x2029
        || code === 0x202f
        || code === 0x205f
        || code === 0x3000
        || code === 0xfeff;
}

function appendFixedWidthRows(rowOffsets, lineStart, lineEnd, columns) {
    for (let offset = lineStart + columns; offset < lineEnd; offset += columns) {
        rowOffsets.push(offset);
    }
}

function appendMeasuredRows(rowOffsets, value, lineStart, lineEnd, options) {
    const wrapWidth = Math.max(1, Number(options.wrapWidth) || 1);
    const measureCharacter = options.measureCharacter;
    let rowWidth = 0;
    for (let index = lineStart; index < lineEnd;) {
        const codePoint = value.codePointAt(index);
        const character = String.fromCodePoint(codePoint);
        const characterLength = character.length;
        const characterWidth = Math.max(0, Number(measureCharacter(character, rowWidth)) || 0);
        if (rowWidth > 0 && rowWidth + characterWidth > wrapWidth) {
            rowOffsets.push(index);
            rowWidth = 0;
        }
        rowWidth += Math.min(characterWidth, wrapWidth);
        index += characterLength;
    }
}

export function buildTextVisualLayout(text = '', requestedLayout = 80) {
    const value = String(text ?? '');
    const options = typeof requestedLayout === 'object' && requestedLayout !== null
        ? requestedLayout
        : {};
    const columns = Math.max(1, Math.floor(
        typeof requestedLayout === 'number' ? requestedLayout : options.columns || 80,
    ));
    const measuredWrapping = Number(options.wrapWidth) > 0
        && typeof options.measureCharacter === 'function';
    const lineStarts = [];
    const lineEnds = [];
    const rowStarts = [];
    const visualRowOffsets = [];
    const canonicalStarts = [];
    let lineStart = 0;
    let totalCanonical = 0;
    let canonicalHash = 2166136261;

    while (lineStart <= value.length) {
        let lineEnd = lineStart;
        while (lineEnd < value.length && value[lineEnd] !== '\n' && value[lineEnd] !== '\r') {
            lineEnd += 1;
        }
        lineStarts.push(lineStart);
        lineEnds.push(lineEnd);
        rowStarts.push(visualRowOffsets.length);
        canonicalStarts.push(totalCanonical);
        visualRowOffsets.push(lineStart);
        if (measuredWrapping) {
            appendMeasuredRows(visualRowOffsets, value, lineStart, lineEnd, options);
        } else {
            appendFixedWidthRows(visualRowOffsets, lineStart, lineEnd, columns);
        }
        for (let index = lineStart; index < lineEnd; index += 1) {
            if (isCanonicalWhitespace(value, index)) continue;
            totalCanonical += 1;
            canonicalHash ^= value.charCodeAt(index);
            canonicalHash = Math.imul(canonicalHash, 16777619);
        }
        if (lineEnd >= value.length) break;
        lineStart = lineEnd + (value[lineEnd] === '\r' && value[lineEnd + 1] === '\n' ? 2 : 1);
    }

    return {
        columns,
        lineStarts: Uint32Array.from(lineStarts),
        lineEnds: Uint32Array.from(lineEnds),
        rowStarts: Uint32Array.from(rowStarts),
        visualRowOffsets: Uint32Array.from(visualRowOffsets),
        canonicalStarts: Uint32Array.from(canonicalStarts),
        totalRows: visualRowOffsets.length,
        totalCanonical,
        canonicalHash: canonicalHash >>> 0,
    };
}

function lineIndexForOffset(layout, offset) {
    const lineStarts = layout?.lineStarts;
    if (!lineStarts?.length) return 0;
    let low = 0;
    let high = lineStarts.length - 1;
    let lineIndex = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (lineStarts[middle] <= offset) {
            lineIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return lineIndex;
}

function canonicalOffsetForTextOffset(text, layout, offset) {
    const value = String(text ?? '');
    if (!layout?.canonicalStarts?.length) return null;
    const lineIndex = lineIndexForOffset(layout, offset);
    const lineStart = layout.lineStarts[lineIndex];
    const lineEnd = layout.lineEnds[lineIndex];
    const offsetInLine = clamp(offset, lineStart, lineEnd);
    let canonicalOffset = layout.canonicalStarts[lineIndex];
    for (let index = lineStart; index < offsetInLine; index += 1) {
        if (!isCanonicalWhitespace(value, index)) canonicalOffset += 1;
    }
    return canonicalOffset;
}

function textOffsetForCanonicalOffset(text, layout, canonicalOffset) {
    const value = String(text ?? '');
    const canonicalStarts = layout?.canonicalStarts;
    if (!canonicalStarts?.length) return null;
    const target = clamp(canonicalOffset, 0, layout.totalCanonical);
    let low = 0;
    let high = canonicalStarts.length - 1;
    let lineIndex = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (canonicalStarts[middle] <= target) {
            lineIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    let current = canonicalStarts[lineIndex];
    const lineEnd = layout.lineEnds[lineIndex];
    for (let index = layout.lineStarts[lineIndex]; index < lineEnd; index += 1) {
        if (isCanonicalWhitespace(value, index)) continue;
        if (current >= target) return index;
        current += 1;
    }
    return lineEnd;
}

export function mapTextOffsetByCanonical(
    sourceText,
    sourceLayout,
    targetText,
    targetLayout,
    sourceOffset,
) {
    if (
        !sourceLayout
        || !targetLayout
        || sourceLayout.totalCanonical !== targetLayout.totalCanonical
        || sourceLayout.canonicalHash !== targetLayout.canonicalHash
    ) return null;
    const canonicalOffset = canonicalOffsetForTextOffset(sourceText, sourceLayout, sourceOffset);
    if (canonicalOffset === null) return null;
    return textOffsetForCanonicalOffset(targetText, targetLayout, canonicalOffset);
}

function visualRowForTextOffset(layout, offset) {
    const visualRowOffsets = layout?.visualRowOffsets;
    if (visualRowOffsets?.length) {
        let low = 0;
        let high = visualRowOffsets.length - 1;
        let rowIndex = 0;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if (visualRowOffsets[middle] <= offset) {
                rowIndex = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        const rowStart = visualRowOffsets[rowIndex];
        const rowEnd = visualRowOffsets[rowIndex + 1] ?? rowStart;
        if (rowEnd <= rowStart) return rowIndex;
        return rowIndex + clamp((offset - rowStart) / (rowEnd - rowStart), 0, 1);
    }
    if (!layout?.lineStarts?.length) return 0;
    const lineIndex = lineIndexForOffset(layout, offset);
    const lineStart = layout.lineStarts[lineIndex];
    const lineOffset = clamp(offset, lineStart, layout.lineEnds[lineIndex]) - lineStart;
    return layout.rowStarts[lineIndex] + (lineOffset / layout.columns);
}

function textOffsetForVisualRow(layout, row) {
    const visualRowOffsets = layout?.visualRowOffsets;
    if (visualRowOffsets?.length) {
        const boundedRow = clamp(row, 0, visualRowOffsets.length);
        const rowIndex = Math.min(visualRowOffsets.length - 1, Math.floor(boundedRow));
        const rowStart = visualRowOffsets[rowIndex];
        const rowEnd = visualRowOffsets[rowIndex + 1] ?? rowStart;
        return Math.round(rowStart + ((rowEnd - rowStart) * (boundedRow - rowIndex)));
    }
    const rowStarts = layout?.rowStarts;
    if (!rowStarts?.length) return 0;
    let low = 0;
    let high = rowStarts.length - 1;
    let lineIndex = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (rowStarts[middle] <= row) {
            lineIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    const rowWithinLine = Math.max(0, row - rowStarts[lineIndex]);
    const offset = layout.lineStarts[lineIndex] + Math.floor(rowWithinLine * layout.columns);
    return clamp(offset, layout.lineStarts[lineIndex], layout.lineEnds[lineIndex]);
}

export function textOffsetForEditorScroll(editor, textLength, layout = null) {
    if (!editor || textLength <= 0) return 0;
    if (editor.textOffsetAtScrollCenter) return editor.textOffsetAtScrollCenter();
    const scrollHeight = Math.max(1, editor.scrollHeight);
    const viewportCenter = clamp(editor.scrollTop + (editor.clientHeight / 2), 0, scrollHeight);
    const progress = viewportCenter / scrollHeight;
    if (layout?.totalRows > 0) {
        return textOffsetForVisualRow(layout, progress * layout.totalRows);
    }
    return Math.round(progress * textLength);
}

export function editorScrollTopForTextOffset(editor, textLength, offset, layout = null) {
    if (!editor || textLength <= 0) return 0;
    const scrollHeight = Math.max(1, editor.scrollHeight);
    const scrollRange = Math.max(0, scrollHeight - editor.clientHeight);
    const progress = layout?.totalRows > 0
        ? visualRowForTextOffset(layout, offset) / layout.totalRows
        : clamp(offset, 0, textLength) / textLength;
    const centeredTop = (progress * scrollHeight) - (editor.clientHeight / 2);
    return clamp(centeredTop, 0, scrollRange);
}

export function mapTextOffsetThroughChanges(
    changes = [],
    offset = 0,
    fromStartKey = 'sourceStart',
    fromEndKey = 'sourceEnd',
    toStartKey = 'resultStart',
    toEndKey = 'resultEnd',
) {
    if (!changes.length) return Math.max(0, offset);

    let low = 0;
    let high = changes.length - 1;
    let changeIndex = -1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const changeStart = changes[middle]?.[fromStartKey] ?? 0;
        if (changeStart <= offset) {
            changeIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (changeIndex < 0) return Math.max(0, offset);
    const change = changes[changeIndex];
    const fromStart = change?.[fromStartKey] ?? 0;
    const fromEnd = change?.[fromEndKey] ?? fromStart;
    const toStart = change?.[toStartKey] ?? 0;
    const toEnd = change?.[toEndKey] ?? toStart;
    if (offset >= fromEnd) return Math.max(0, toEnd + (offset - fromEnd));

    const fromLength = Math.max(0, fromEnd - fromStart);
    const toLength = Math.max(0, toEnd - toStart);
    if (fromLength === 0) return Math.max(0, toStart);
    const progress = clamp((offset - fromStart) / fromLength, 0, 1);
    return Math.max(0, Math.round(toStart + (toLength * progress)));
}

export function closestTextChangeIndex(changes = [], offset = 0, offsetKey = 'sourceStart') {
    if (!changes.length) return -1;

    let low = 0;
    let high = changes.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const middleOffset = changes[middle]?.[offsetKey] ?? 0;
        if (middleOffset < offset) {
            low = middle + 1;
        } else if (middleOffset > offset) {
            high = middle - 1;
        } else {
            return middle;
        }
    }

    if (low <= 0) return 0;
    if (low >= changes.length) return changes.length - 1;
    const previousOffset = changes[low - 1]?.[offsetKey] ?? 0;
    const nextOffset = changes[low]?.[offsetKey] ?? 0;
    return offset - previousOffset <= nextOffset - offset ? low - 1 : low;
}

export function findTextMatches(text = '', query = '', maximumStoredMatches = 100000) {
    const value = String(text ?? '');
    const needle = String(query ?? '');
    if (!needle) return { matches: [], totalCount: 0, truncated: false };

    const matches = [];
    const limit = Math.max(1, Math.floor(maximumStoredMatches));
    let totalCount = 0;
    let offset = 0;
    while (offset <= value.length - needle.length) {
        const matchOffset = value.indexOf(needle, offset);
        if (matchOffset < 0) break;
        totalCount += 1;
        if (matches.length < limit) matches.push(matchOffset);
        offset = matchOffset + Math.max(1, needle.length);
    }
    return {
        matches,
        totalCount,
        truncated: totalCount > matches.length,
    };
}

export function countTextLines(text = '') {
    const value = String(text ?? '');
    let lineCount = 1;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '\n') lineCount += 1;
    }
    return lineCount;
}
