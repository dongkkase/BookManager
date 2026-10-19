const COVER_FIELDS = new Set([
    'cover', 'thumb_path', 'cover_file_path', 'cover_file_mtime', 'cover_file_size',
    'cover_override_path', 'coverOverridePath',
]);
const PREVIEW_ONLY_FIELDS = new Set(['cache_source', 'duplicate_matches', 'dup_count', 'max_ratio']);

export function folderCoverPreviewKey(file) {
    const path = file?.full_path || file?.path;
    return path ? `${path}|${file?.mtime ?? file?.modified ?? ''}|${file?.size ?? ''}` : '';
}

function equalValue(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    return JSON.stringify(left) === JSON.stringify(right);
}

export function folderPreviewMetadataUpdate(file, preview) {
    const changes = {};
    for (const [key, value] of Object.entries(preview || {})) {
        if (COVER_FIELDS.has(key) || PREVIEW_ONLY_FIELDS.has(key) || key === 'path' || key === 'full_path') continue;
        if (!equalValue(file?.[key], value)) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) return null;
    return { ...changes, path: file.path, isDirectory: file.isDirectory };
}

export function createFolderCoverPreviewStore({ limit = 8192, onEvict = () => {} } = {}) {
    const previews = new Map();
    const listeners = new Map();
    const notify = key => listeners.get(key)?.forEach(listener => listener());
    const remove = key => {
        if (!previews.delete(key)) return;
        onEvict(key);
        notify(key);
    };
    const store = {
        key: folderCoverPreviewKey,
        snapshot(file) {
            const entry = previews.get(folderCoverPreviewKey(file));
            if (!entry || Boolean(entry.isDirectory) !== Boolean(file?.isDirectory)) return null;
            // A scan or explicit edit may already contain a newer cover.
            if (file?.cover && file.cover !== entry.baseCover && file.cover !== entry.cover.cover) return null;
            return entry.cover;
        },
        resolve(file) {
            const cover = store.snapshot(file);
            return cover ? { ...file, ...cover } : file;
        },
        publish(file, preview) {
            const cover = Object.fromEntries(Object.entries(preview || {}).filter(([key]) => COVER_FIELDS.has(key)));
            if (Object.keys(cover).length === 0) return;
            const updatedFile = { ...file, ...preview, path: file.path, full_path: file.full_path || preview.full_path || file.path };
            const keys = new Set([folderCoverPreviewKey(file), folderCoverPreviewKey(updatedFile)]);
            for (const key of keys) {
                if (!key) continue;
                const previous = previews.get(key);
                if (previous && equalValue(previous.cover, cover)) continue;
                previews.delete(key);
                previews.set(key, { cover, baseCover: file.cover || '', isDirectory: file.isDirectory });
                notify(key);
            }
            for (const key of previews.keys()) {
                if (previews.size <= limit) break;
                if (!listeners.get(key)?.size) remove(key);
            }
        },
        subscribe(key, listener) {
            if (!key) return () => {};
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(listener);
            return () => {
                const current = listeners.get(key);
                current?.delete(listener);
                if (current?.size === 0) listeners.delete(key);
            };
        },
        clear() {
            for (const key of [...previews.keys()]) remove(key);
        },
    };
    return store;
}
