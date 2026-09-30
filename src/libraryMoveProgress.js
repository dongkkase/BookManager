import { normalizeLibraryKey } from './folderLibraryStatus.js';

export function createLibraryMoveProgress({ requestId, files = [], getPreview, onProgress }) {
    const covers = new Map(files.filter(file => file.cover)
        .map(file => [normalizeLibraryKey(file.full_path || file.path), file.cover]));
    const attempted = new Set();
    let latest = null;
    let pending = null;
    let loading = false;
    let disposed = false;

    const publish = () => {
        if (disposed || !latest) return;
        const indexing = latest.libraryPhase === 'indexing';
        const percent = Math.max(0, Math.min(100, Number(latest.progress) || 0));
        onProgress({
            ...latest,
            percent: Math.round(percent),
            progress: indexing ? 78 + percent * 0.16 : 25 + percent * 0.45,
            currentItemCover: covers.get(normalizeLibraryKey(latest.currentFile)) || '',
            slideItemReady: !indexing,
        });
    };

    const pump = async () => {
        if (loading || disposed || !getPreview) return;
        loading = true;
        try {
            while (pending && !disposed) {
                const event = pending;
                pending = null;
                for (const filePath of [...new Set([event.currentFile, event.destinationFile].filter(Boolean))]) {
                    if (disposed) break;
                    try {
                        const result = await getPreview(filePath);
                        if (disposed) break;
                        if (!result?.file?.cover) continue;
                        covers.set(normalizeLibraryKey(event.currentFile), result.file.cover);
                        if (latest?.currentFile === event.currentFile) publish();
                        break;
                    } catch { /* A moved source can still be previewed at its destination. */ }
                }
            }
        } finally {
            loading = false;
        }
    };

    return {
        handle(event) {
            if (disposed || event?.task !== 'folder:libraryMove' || event.requestId !== requestId) return;
            latest = event;
            publish();
            if (event.libraryPhase === 'indexing' || !event.currentFile || covers.has(normalizeLibraryKey(event.currentFile))) return;
            const key = `${event.currentFile}:${event.destinationFile}:${event.processedCount}`;
            if (attempted.has(key)) return;
            attempted.add(key);
            pending = event;
            void pump();
        },
        dispose() {
            disposed = true;
            pending = null;
        },
    };
}
