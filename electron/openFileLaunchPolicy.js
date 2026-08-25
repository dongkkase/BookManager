import fs from 'node:fs';
import path from 'node:path';

import { isSupportedFileAssociationExtension } from './fileAssociationPolicy.js';

function stripWrappingQuotes(value = '') {
    const text = String(value || '').trim();
    if (text.length < 2) return text;
    const first = text[0];
    const last = text[text.length - 1];
    return ((first === '"' && last === '"') || (first === "'" && last === "'"))
        ? text.slice(1, -1)
        : text;
}

function normalizedPathKey(filePath, platform = process.platform) {
    const normalized = path.resolve(filePath).normalize('NFC');
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolveLaunchFilePaths(argv = [], options = {}) {
    const {
        workingDirectory = process.cwd(),
        platform = process.platform,
        existsSync = fs.existsSync,
        statSync = fs.statSync,
    } = options;
    const result = [];
    const seen = new Set();

    for (const argument of Array.isArray(argv) ? argv : []) {
        const value = stripWrappingQuotes(argument);
        if (!value || value.startsWith('--')) continue;
        const candidate = path.isAbsolute(value)
            ? path.normalize(value)
            : path.resolve(workingDirectory || process.cwd(), value);
        if (!isSupportedFileAssociationExtension(path.extname(candidate))) continue;
        try {
            if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
        } catch {
            continue;
        }
        const key = normalizedPathKey(candidate, platform);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(path.resolve(candidate).normalize('NFC'));
    }

    return result;
}

export function addPendingOpenFiles(queue, filePaths = [], platform = process.platform) {
    if (!Array.isArray(queue)) throw new TypeError('A pending file queue is required.');
    const known = new Set(queue.map(filePath => normalizedPathKey(filePath, platform)));
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
        const key = normalizedPathKey(filePath, platform);
        if (known.has(key)) continue;
        known.add(key);
        queue.push(filePath);
    }
    return queue;
}
