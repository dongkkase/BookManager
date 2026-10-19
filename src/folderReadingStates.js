const READING_STATE_BATCH_SIZE = 500;
const READING_STATE_PUBLISH_INTERVAL = 500;

export function readingStatePathKey(filePath, platform = '') {
    if (typeof filePath !== 'string') return '';
    return /^(mac|darwin)/i.test(platform) ? filePath.normalize('NFC') : filePath;
}

export function createReadingStatePathKeyResolver(platform = '') {
    const keys = new WeakMap();
    return file => {
        if (!file || typeof file !== 'object') return '';
        const path = file.full_path || file.path;
        const cached = keys.get(file);
        if (cached && cached.path === path) return cached.key;
        const key = readingStatePathKey(path, platform);
        keys.set(file, { path, key });
        return key;
    };
}

export function sameReadingStateFiles(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
        && left.every((file, index) => file === right[index] || (Boolean(file?.isDirectory) === Boolean(right[index]?.isDirectory)
            && (file?.full_path || file?.path) === (right[index]?.full_path || right[index]?.path)));
}

export function createFolderReadingStatesLoader({ request, onChange, isCurrent = () => true, now = Date.now, platform = '' }) {
    let files = null;
    let scopeKey;
    let generation = 0;
    let nextVersion = 0;
    let disposed = false;
    let running = false;
    let inFlight = null;
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
                const batch = [];
                for (const key of pending) {
                    pending.delete(key);
                    batch.push({ key, path: paths.get(key), version: versions.get(key) || 0 });
                    if (batch.length === READING_STATE_BATCH_SIZE) break;
                }
                inFlight = { generation: currentGeneration, versions: new Map(batch.map(entry => [entry.key, entry.version])) };
                const requeue = () => {
                    for (const entry of batch) {
                        if (paths.has(entry.key) && versions.get(entry.key) === entry.version) pending.add(entry.key);
                    }
                };
                try {
                    const rows = await request(batch.map(entry => entry.path));
                    if (disposed || currentGeneration !== generation) continue;
                    if (!isCurrent(files)) {
                        requeue();
                        continue;
                    }
                    const returned = new Map((Array.isArray(rows) ? rows : [])
                        .filter(row => row && typeof row.filePath === 'string' && !row.deletedAt)
                        .map(row => [readingStatePathKey(row.filePath, platform), row]));
                    let changed = false;
                    for (const entry of batch) {
                        if (paths.has(entry.key) && versions.get(entry.key) === entry.version) {
                            statesByPath.set(entry.key, returned.get(entry.key) || null);
                            changed = true;
                        }
                    }
                    if (changed && (pending.size === 0 || lastPublished === null || now() - lastPublished >= READING_STATE_PUBLISH_INTERVAL)) publish();
                } catch {
                    if (!disposed && currentGeneration === generation) {
                        requeue();
                        break;
                    }
                } finally {
                    inFlight = null;
                }
            }
        } finally {
            running = false;
        }
    };

    return {
        setFiles(nextFiles, nextScopeKey) {
            if (disposed || (files === nextFiles && scopeKey === nextScopeKey)) return;
            const scopeChanged = scopeKey !== nextScopeKey;
            files = nextFiles;
            scopeKey = nextScopeKey;
            const hadStates = statesByPath.size > 0;
            if (scopeChanged) {
                generation += 1;
                paths = new Map();
                versions = new Map();
                statesByPath = new Map();
                pending = new Set();
                lastPublished = null;
            }
            const nextPaths = new Map();
            for (const file of Array.isArray(files) ? files : []) {
                const filePath = file?.full_path || file?.path;
                if (!file?.isDirectory && filePath) nextPaths.set(readingStatePathKey(filePath, platform), filePath);
            }
            for (const key of paths.keys()) {
                if (nextPaths.has(key)) continue;
                versions.delete(key);
                statesByPath.delete(key);
                pending.delete(key);
            }
            for (const key of nextPaths.keys()) {
                if (!paths.has(key)) versions.set(key, ++nextVersion);
                const loading = inFlight?.generation === generation && inFlight.versions.get(key) === versions.get(key);
                if (!statesByPath.has(key) && !loading) pending.add(key);
            }
            paths = nextPaths;
            if (hadStates || statesByPath.size > 0) publish();
            void pump();
        },
        refresh(event = {}) {
            if (disposed) return;
            const keys = event.filePath ? [readingStatePathKey(event.filePath, platform)] : paths.keys();
            let cleared = false;
            for (const key of keys) {
                if (!paths.has(key)) continue;
                versions.set(key, ++nextVersion);
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
