import { createBookSearchIndex } from './bookSearch.js';

let index;
self.onmessage = ({ data }) => {
    try {
        if (data.action === 'init') index = createBookSearchIndex(data.schema);
        else if (data.action === 'sync') index.sync(data);
        else {
            const result = data.action === 'replaceAll'
                ? index.replaceAll(data.query, data.replacement, data.caseSensitive)
                : index.find(data.query, data.caseSensitive);
            self.postMessage({ id: data.id, ok: true, result });
        }
    } catch (error) {
        self.postMessage({ id: data.id, ok: false, code: error.code || 'error' });
    }
};
