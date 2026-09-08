const READING_STATE_BATCH_SIZE = 500;
const READING_STATE_PUBLISH_INTERVAL = 500;

export function readingStatePathKey(filePath, platform = '') {
    if (typeof filePath !== 'string') return '';
    return /^(mac|darwin)/i.test(platform) ? filePath.normalize('NFC') : filePath;
}

export function sameReadingStateFiles(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
        && left.every((file, index) => Boolean(file?.isDirectory) === Boolean(right[index]?.isDirectory)
            && (file?.full_path || file?.path) === (right[index]?.full_path || right[index]?.path));
}

export function createFolderReadingStatesLoader({ request, onChange, isCurrent = () => true, now = Date.now, platform = '' }) {
    let files = null;
    let generation = 0;
    let disposed = false;
    let running = false;
    let paths = new Map();
    let versions = new Map();
    let statesByPath = new Map();
    let pending = new Set();
    let lastPublished = null;

    const publish = () => {
        if (disposed || !isCurrent(files)) return;
        lastPublished = now();
        onChange({ files, statesByPath: new Map(statesByPath) });
    };

    const pump = async () => {
        if (running || disposed || typeof request !== 'function') return;
        running = true;
        try {
            while (!disposed && pending.size > 0) {
                if (!isCurrent(files)) break;
                const currentGeneration = generation;
                const currentFiles = files;
                const batch = [];
                for (const key of pending) {
                    pending.delete(key);
                    batch.push({ key, path: paths.get(key), version: versions.get(key) || 0 });
                    if (batch.length === READING_STATE_BATCH_SIZE) break;
                }
                try {
                    const rows = await request(batch.map(entry => entry.path));
                    if (disposed || currentGeneration !== generation || !isCurrent(currentFiles)) continue;
                    const returned = new Map((Array.isArray(rows) ? rows : [])
                        .filter(row => row && typeof row.filePath === 'string' && !row.deletedAt)
                        .map(row => [readingStatePathKey(row.filePath, platform), row]));
                    for (const entry of batch) {
                        if ((versions.get(entry.key) || 0) === entry.version) {
                            statesByPath.set(entry.key, returned.get(entry.key) || null);
                        }
                    }
                    if (pending.size === 0 || lastPublished === null || now() - lastPublished >= READING_STATE_PUBLISH_INTERVAL) publish();
                } catch {
                    if (!disposed && currentGeneration === generation && isCurrent(currentFiles)) {
                        pending.clear();
                    }
                }
            }
        } finally {
            running = false;
        }
    };

    return {
        setFiles(nextFiles) {
            if (disposed || files === nextFiles) return;
            files = nextFiles;
            generation += 1;
            paths = new Map();
            for (const file of Array.isArray(files) ? files : []) {
                const filePath = file?.full_path || file?.path;
                if (!file?.isDirectory && filePath) paths.set(readingStatePathKey(filePath, platform), filePath);
            }
            versions = new Map();
            statesByPath = new Map();
            pending = new Set(paths.keys());
            lastPublished = null;
            void pump();
        },
        refresh(event = {}) {
            if (disposed) return;
            const keys = event.filePath ? [readingStatePathKey(event.filePath, platform)] : paths.keys();
            let cleared = false;
            for (const key of keys) {
                if (!paths.has(key)) continue;
                versions.set(key, (versions.get(key) || 0) + 1);
                pending.add(key);
                if (event.removed || event.cleared) {
                    statesByPath.set(key, null);
                    cleared = true;
                }
            }
            if (cleared) publish();
            void pump();
        },
        dispose() {
            disposed = true;
            generation += 1;
            pending.clear();
            paths.clear();
            statesByPath.clear();
        },
    };
}
