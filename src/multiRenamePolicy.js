function splitName(filename = '') {
    const value = String(filename);
    const index = value.lastIndexOf('.');
    return index > 0
        ? { stem: value.slice(0, index), extension: value.slice(index) }
        : { stem: value, extension: '' };
}

function commonPrefix(values) {
    if (values.length === 0) return '';
    let prefix = values[0];
    for (const value of values.slice(1)) {
        while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
}

function commonSuffix(values, prefixLength) {
    if (values.length === 0) return '';
    let suffix = values[0].slice(prefixLength);
    for (const value of values.slice(1)) {
        const remainder = value.slice(prefixLength);
        while (suffix && !remainder.endsWith(suffix)) suffix = suffix.slice(1);
    }
    return suffix;
}

export function inferRenamePattern(filenames = []) {
    const stems = filenames.map(name => splitName(name).stem);
    if (stems.length === 0) return { oldPattern: '%1', newPattern: '%1' };
    const tokenRows = stems.map(stem => stem.split(/(\d+)/).filter(part => part !== ''));
    if (
        tokenRows.length > 1
        && tokenRows.every(row => row.length === tokenRows[0].length)
        && tokenRows[0].some((_, index) => new Set(tokenRows.map(row => row[index])).size > 1)
    ) {
        let variableIndex = 0;
        const pattern = tokenRows[0].map((token, index) => {
            const values = tokenRows.map(row => row[index]);
            if (new Set(values).size === 1) return token;
            variableIndex += 1;
            return `%${variableIndex}`;
        }).join('');
        return { oldPattern: pattern, newPattern: pattern };
    }
    const prefix = commonPrefix(stems);
    const suffix = commonSuffix(stems, prefix.length);
    const pattern = `${prefix}%1${suffix}`;
    return { oldPattern: pattern, newPattern: pattern };
}

export function normalPatternToRegex(pattern = '') {
    let groupIndex = 0;
    const source = String(pattern)
        .split(/(%\d+)/g)
        .map(part => {
            if (/^%\d+$/.test(part)) {
                groupIndex += 1;
                return '(.*)';
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

export function padNumbers(value = '', digits = 3) {
    return String(value).replace(/\d+/g, match => match.padStart(digits, '0'));
}

export function previewRename(file, options = {}, index = 0) {
    const oldName = file.name || String(file.path || '').split(/[\\/]/).pop() || '';
    const { stem, extension } = splitName(oldName);
    const flags = options.caseSensitive ? '' : 'i';
    let nextStem = stem;

    try {
        const javascriptReplacement = String(options.newPattern || '')
            .replace(/\\(\d+)/g, (_, group) => `$${group}`);
        if (options.folderNameMode) {
            const path = String(file.full_path || file.path || '');
            const parts = path.split(/[\\/]/);
            parts.pop();
            nextStem = parts.pop() || stem;
        } else if (options.regexMode) {
            nextStem = stem.replace(new RegExp(options.oldPattern, flags), javascriptReplacement);
        } else {
            const converted = normalPatternToRegex(options.oldPattern);
            const replacement = normalReplacementToRegex(options.newPattern)
                .replace(/\\(\d+)/g, (_, group) => `$${group}`);
            nextStem = stem.replace(new RegExp(converted.source, flags), replacement);
        }
    } catch (error) {
        return { oldName, newName: oldName, status: 'error', error: error.message, path: file.path };
    }

    if (options.padNumbers) nextStem = padNumbers(nextStem, options.numberDigits);
    if (options.addSequence) {
        const sequence = String(Number(options.sequenceStart || 0) + index)
            .padStart(Number(options.sequenceDigits || 3), '0');
        nextStem = options.sequencePosition === 'before'
            ? `${sequence}${nextStem}`
            : `${nextStem}${sequence}`;
    }

    const newName = `${nextStem}${extension}`;
    return {
        oldName,
        newName,
        status: newName === oldName ? 'unchanged' : 'ok',
        path: file.full_path || file.path,
    };
}

export function buildRenameMap(rows = []) {
    return Object.fromEntries(rows
        .filter(row => row.status === 'ok' && row.path && row.targetPath)
        .map(row => [row.path, row.targetPath]));
}
