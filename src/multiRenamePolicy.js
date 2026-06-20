function splitName(filename = '') {
    const value = String(filename);
    const index = value.lastIndexOf('.');
    return index > 0
        ? { stem: value.slice(0, index), extension: value.slice(index) }
        : { stem: value, extension: '' };
}

function tokenizeFilename(filename = '') {
    return String(filename).match(/(\p{L}+|\d+|\s+|[^\p{L}\d\s_]+|_)/gu) || [];
}

function matchingRefIndexes(refTokens, tokens) {
    const lengths = Array.from({ length: refTokens.length + 1 }, () => (
        Array(tokens.length + 1).fill(0)
    ));
    for (let i = refTokens.length - 1; i >= 0; i -= 1) {
        for (let j = tokens.length - 1; j >= 0; j -= 1) {
            lengths[i][j] = refTokens[i] === tokens[j]
                ? lengths[i + 1][j + 1] + 1
                : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    }

    const indexes = new Set();
    let i = 0;
    let j = 0;
    while (i < refTokens.length && j < tokens.length) {
        if (refTokens[i] === tokens[j]) {
            indexes.add(i);
            i += 1;
            j += 1;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return indexes;
}

export function inferRenamePattern(filenames = []) {
    const names = filenames.map(name => String(name || '').split(/[\\/]/).pop() || '').filter(Boolean);
    if (names.length === 0) return { oldPattern: '%1', newPattern: '%1' };

    const refTokens = tokenizeFilename(names[0]);
    const commonMask = Array(refTokens.length).fill(true);
    for (const name of names.slice(1)) {
        const matches = matchingRefIndexes(refTokens, tokenizeFilename(name));
        for (let index = 0; index < commonMask.length; index += 1) {
            commonMask[index] = commonMask[index] && matches.has(index);
        }
    }

    let pattern = '';
    let variableIndex = 1;
    let inDiff = false;
    for (let index = 0; index < refTokens.length; index += 1) {
        if (commonMask[index]) {
            inDiff = false;
            pattern += refTokens[index];
        } else if (!inDiff) {
            pattern += `%${variableIndex}`;
            variableIndex += 1;
            inDiff = true;
        }
    }
    if (!pattern) pattern = '%1';
    return { oldPattern: pattern, newPattern: pattern };
}

export function normalPatternToRegex(pattern = '') {
    let groupIndex = 0;
    const source = String(pattern)
        .split(/(%\d+)/g)
        .map(part => {
            if (/^%\d+$/.test(part)) {
                groupIndex += 1;
                return '(.*?)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
    return { source: `^${source}$`, groupCount: groupIndex };
}

export function normalReplacementToRegex(pattern = '') {
    return String(pattern).replace(/%(\d+)/g, (_, index) => `\\${index}`);
}

export function regexReplacementToNormal(pattern = '') {
    return String(pattern).replace(/\\(\d+)/g, (_, index) => `%${index}`);
}

export function regexPatternToNormal(pattern = '') {
    let index = 1;
    return String(pattern).replace(/\(\.\*\?\)|\(\.\*\)|\(\\d\+\)/g, () => {
        const replacement = `%${index}`;
        index += 1;
        return replacement;
    });
}

export function padNumbers(value = '', digits = 3) {
    return String(value).replace(/\d+/g, match => match.padStart(digits, '0'));
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacementToJs(value = '') {
    return String(value).replace(/\\(\d+)/g, (_, group) => `$${group}`);
}

function pathDirname(filePath = '') {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return separatorIndex >= 0 ? value.slice(0, separatorIndex) : '';
}

function joinSiblingPath(filePath = '', filename = '') {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    if (separatorIndex < 0) return filename;
    return `${value.slice(0, separatorIndex + 1)}${filename}`;
}

function applyPythonStyleWildcardPattern(currentName, oldPattern, newPattern, flags) {
    const tokens = String(oldPattern).split(/(%\d+|\*|\?)/g).filter(Boolean);
    const variableMap = new Map();
    let groupIndex = 1;
    let patternSource = '';

    for (const token of tokens) {
        if (/^%\d+$/.test(token)) {
            variableMap.set(groupIndex, Number(token.slice(1)));
            patternSource += '(.*?)';
            groupIndex += 1;
        } else if (token === '*') {
            patternSource += '(.*?)';
            groupIndex += 1;
        } else if (token === '?') {
            patternSource += '(.)';
            groupIndex += 1;
        } else {
            patternSource += escapeRegExp(token);
        }
    }

    const match = String(currentName).match(new RegExp(`^${patternSource}$`, flags));
    if (!match) return currentName;

    const extracted = new Map();
    for (const [group, variable] of variableMap.entries()) {
        extracted.set(variable, match[group] || '');
    }
    return String(newPattern).replace(/%(\d+)/g, (source, variable) => (
        extracted.has(Number(variable)) ? extracted.get(Number(variable)) : source
    ));
}

export function previewRename(file, options = {}, index = 0) {
    const oldName = file.name || String(file.path || '').split(/[\\/]/).pop() || '';
    const oldPath = file.full_path || file.path || '';
    const { stem, extension } = splitName(oldName);
    const oldPattern = String(options.oldPattern || '');
    const newPattern = String(options.newPattern || '');
    const patternIncludesExtension = Boolean(extension && (
        (oldPattern && oldPattern.toLowerCase().includes(extension.toLowerCase()))
        || (newPattern && newPattern.toLowerCase().includes(extension.toLowerCase()))
    ));
    const currentExtension = patternIncludesExtension ? '' : extension;
    let currentName = patternIncludesExtension ? oldName : stem;
    const flags = options.caseSensitive ? 'g' : 'gi';
    let status = 'ok';
    let error = '';

    try {
        if (oldPattern) {
            if (options.regexMode) {
                currentName = currentName.replace(new RegExp(oldPattern, flags), replacementToJs(newPattern));
            } else if (!/%\d+|\*|\?/.test(oldPattern)) {
                currentName = currentName.replace(new RegExp(escapeRegExp(oldPattern), flags), newPattern);
            } else {
                currentName = applyPythonStyleWildcardPattern(
                    currentName,
                    oldPattern,
                    newPattern,
                    options.caseSensitive ? '' : 'i',
                );
            }
        } else if (newPattern) {
            currentName = newPattern.replace(/%(\d+)/g, stem);
        }

        if (options.padNumbers) currentName = padNumbers(currentName, options.numberDigits);
        if (options.addSequence) {
            const sequence = String(Number(options.sequenceStart || 0) + index)
                .padStart(Number(options.sequenceDigits || 3), '0');
            currentName = options.sequencePosition === 'before'
                ? `${sequence}_${currentName}`
                : `${currentName}_${sequence}`;
        }
    } catch (caughtError) {
        status = 'invalid';
        error = caughtError.message;
    }

    const newName = `${currentName}${currentExtension}`;
    if (/[\\/:*?"<>|]/.test(newName)) status = 'invalid';

    return {
        oldName,
        newName,
        status,
        error,
        path: oldPath,
        targetPath: joinSiblingPath(oldPath, newName),
        directory: pathDirname(oldPath),
    };
}

export async function resolveRenamePreviewConflicts(rows = [], exists = async () => false) {
    const seen = new Set();
    const resolved = [];
    for (const row of rows) {
        let status = row.status;
        if (status === 'ok' && row.targetPath !== row.path) {
            const normalizedTarget = String(row.targetPath || '').toLowerCase();
            if (seen.has(normalizedTarget) || await exists(row.targetPath)) {
                status = 'conflict';
            }
        }
        seen.add(String(row.targetPath || '').toLowerCase());
        resolved.push({ ...row, status });
    }
    return resolved;
}

export function folderNameRenamePattern(currentPattern = '', folderName = '', regexMode = false) {
    const variableSymbol = regexMode ? '\\\\' : '%';
    const match = String(currentPattern).match(new RegExp(`^(.*?)(${variableSymbol}\\d+)(.*)$`));
    if (match) return `${folderName} ${match[2]}${match[3]}`;
    return `${folderName} ${regexMode ? '\\\\1' : '%1'}`;
}

export function buildRenameMap(rows = []) {
    return Object.fromEntries(rows
        .filter(row => (
            row.status === 'ok'
            && row.path
            && row.targetPath
            && row.oldName !== row.newName
        ))
        .map(row => [row.path, row.targetPath]));
}
