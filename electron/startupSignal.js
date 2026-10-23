import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const READY_FILE_NAME = 'BookManager-startup.ready';

export async function signalPortableStartupReady({
    env = process.env,
    platform = process.platform,
    tempDir = os.tmpdir(),
    fsPromises = fs.promises,
    pathApi = path,
    reducedMotion = true,
} = {}) {
    try {
        const readyFile = env?.BOOKMANAGER_STARTUP_READY_FILE;
        if (platform !== 'win32' || typeof readyFile !== 'string'
            || !pathApi.isAbsolute(readyFile) || pathApi.basename(readyFile) !== READY_FILE_NAME) {
            return false;
        }

        const [realTempDir, realMarkerDir] = await Promise.all([
            fsPromises.realpath(tempDir),
            fsPromises.realpath(pathApi.dirname(readyFile)),
        ]);
        const relativeDir = pathApi.relative(realTempDir, realMarkerDir);
        if (!relativeDir || relativeDir === '..' || relativeDir.startsWith(`..${pathApi.sep}`)
            || pathApi.isAbsolute(relativeDir)) {
            return false;
        }

        // The launcher owns this per-launch scratch directory and removes it after startup.
        await fsPromises.writeFile(pathApi.join(realMarkerDir, READY_FILE_NAME), `ready\n${reducedMotion ? 'reduced' : 'animate'}\n`, {
            flag: 'wx',
            mode: 0o600,
        });
        return true;
    } catch {
        // A closed launcher or unwritable marker must never prevent the main window opening.
        return false;
    }
}
