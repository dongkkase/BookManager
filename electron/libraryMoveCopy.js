import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function copyLibraryMovePath(source, destination, onProgress) {
    const temporary = path.join(path.dirname(destination), `.bookmanager-move-${randomUUID()}.tmp`);
    const entries = [];
    let totalBytes = 0;
    let copiedBytes = 0;
    const collect = async (src, dest) => {
        const stat = await fs.promises.lstat(src);
        entries.push({ src, dest, stat });
        if (stat.isFile()) totalBytes += stat.size;
        if (stat.isDirectory()) {
            for (const name of await fs.promises.readdir(src)) {
                await collect(path.join(src, name), path.join(dest, name));
            }
        }
    };
    await collect(source, temporary);
    try {
        for (const { src, dest, stat } of entries) {
            const currentDestination = path.join(destination, path.relative(temporary, dest));
            const report = () => onProgress?.({ currentFile: src, destinationFile: currentDestination, copiedBytes, totalBytes });
            report();
            if (stat.isDirectory()) {
                await fs.promises.mkdir(dest, { recursive: true, mode: stat.mode });
            } else if (stat.isFile()) {
                await pipeline(
                    fs.createReadStream(src),
                    new Transform({
                        transform(chunk, _encoding, callback) {
                            copiedBytes += chunk.length;
                            report();
                            callback(null, chunk);
                        },
                    }),
                    fs.createWriteStream(dest, { flags: 'wx', mode: stat.mode }),
                );
                await fs.promises.chmod(dest, stat.mode);
            } else {
                await fs.promises.cp(src, dest, { verbatimSymlinks: true });
            }
        }
        await fs.promises.rename(temporary, destination);
        await fs.promises.rm(source, { recursive: true, force: false });
    } finally {
        await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
}
