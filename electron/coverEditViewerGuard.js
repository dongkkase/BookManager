import { normalizeAudioViewerMetadataPath as normalizePath } from './audioViewerMetadataRefresh.js';

export function createCoverEditViewerGuard(getOpenPaths) {
    const editing = new Set();
    const assertCanOpen = filePath => {
        if (editing.has(normalizePath(filePath))) {
            throw Object.assign(new Error('The cover is being saved. Open this book again after saving finishes.'), { code: 'COVER_EDIT_BUSY' });
        }
    };
    return {
        assertCanOpen,
        async run(filePath, action) {
            const key = normalizePath(filePath);
            assertCanOpen(filePath);
            if (getOpenPaths().some(openPath => normalizePath(openPath) === key)) {
                throw Object.assign(new Error('Close this book in the viewer before editing its cover.'), { code: 'COVER_VIEWER_OPEN' });
            }
            editing.add(key);
            try {
                return await action();
            } finally {
                editing.delete(key);
            }
        },
    };
}
