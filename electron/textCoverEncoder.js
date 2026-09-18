import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectImageMimeType } from './imageMagic.js';

const execFileAsync = promisify(execFile);

export async function encodeTextCover(buffer, { cwebpExe, normalizeImage } = {}) {
    const mimeType = detectImageMimeType(buffer);
    if (mimeType === 'image/webp') return buffer;
    if (!cwebpExe) throw new Error('The WebP encoder is unavailable. The text cover was not saved.');
    if (!['image/png', 'image/jpeg'].includes(mimeType)) {
        buffer = await normalizeImage?.(buffer);
    }
    const inputMimeType = detectImageMimeType(buffer);
    if (!['image/png', 'image/jpeg'].includes(inputMimeType)) {
        throw new Error('The text cover could not be decoded for WebP conversion.');
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-text-cover-'));
    try {
        const inputPath = path.join(directory, inputMimeType === 'image/png' ? 'input.png' : 'input.jpg');
        const outputPath = path.join(directory, 'output.webp');
        await fs.writeFile(inputPath, buffer);
        await execFileAsync(cwebpExe, [
            inputPath, '-q', '85', '-metadata', 'none', '-mt', '-quiet', '-o', outputPath,
        ], {
            windowsHide: true,
            timeout: 30000,
            maxBuffer: 2 * 1024 * 1024,
        });
        const encoded = await fs.readFile(outputPath);
        if (detectImageMimeType(encoded) !== 'image/webp') {
            throw new Error('The text cover could not be converted to WebP.');
        }
        return encoded;
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}
