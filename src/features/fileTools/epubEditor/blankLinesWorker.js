import { removeProjectBlankLines } from './blankLines.js';

self.onmessage = ({ data }) => {
    try {
        self.postMessage({ ok: true, result: removeProjectBlankLines(data.chapters, data.chapterId, data.scope) });
    } catch (error) {
        self.postMessage({ ok: false, code: error.code || 'error' });
    }
};
