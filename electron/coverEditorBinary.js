import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { binaryCandidates } from './binaryPolicy.js';

const execFileAsync = promisify(execFile);

export async function resolveCoverEditorSevenZPath(preferredPath, options = {}) {
    const candidates = options.candidatePaths || binaryCandidates('7z', {
        resourcesPath: process.resourcesPath,
        executableDir: options.executableDir,
        projectRoot: fileURLToPath(new URL('..', import.meta.url)),
    });
    for (const candidate of new Set([preferredPath, ...candidates].filter(Boolean))) {
        try {
            await fs.access(candidate, constants.X_OK);
            const { stdout } = await execFileAsync(candidate, ['i'], {
                windowsHide: true,
                timeout: 3000,
                maxBuffer: 256 * 1024,
            });
            if (/\sRar(?:5)?\s/.test(stdout)) return candidate;
        } catch {
            // Continue past unavailable binaries or unsupported capability queries.
        }
    }
    return preferredPath || null;
}
