import { searchSchemaSpec } from './bookSearch.js';

export function createBookSearchClient(worker, schema) {
    let previous = new Map();
    let sequence = 0;
    let failure = null;
    const pending = new Map();
    const fail = code => {
        failure = Object.assign(new Error(code), { code });
        for (const request of pending.values()) request.reject(failure);
        pending.clear();
    };
    worker.onmessage = ({ data }) => {
        if (!data.ok && data.id == null) { fail(data.code); return; }
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.ok) request.resolve(data.result);
        else request.reject(Object.assign(new Error(data.code), { code: data.code }));
    };
    worker.onerror = () => fail('error');
    worker.postMessage({ action: 'init', schema: searchSchemaSpec(schema) });
    return {
        sync(chapters) {
            if (failure) throw failure;
            const updates = chapters.filter(chapter => previous.get(chapter.id) !== chapter.content).map(({ id, content }) => ({ id, content }));
            const chapterIds = chapters.map(chapter => chapter.id);
            worker.postMessage({ action: 'sync', chapterIds, updates });
            previous = new Map(chapters.map(chapter => [chapter.id, chapter.content]));
        },
        request(action, options) {
            if (failure) return Promise.reject(failure);
            const id = ++sequence;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                try { worker.postMessage({ id, action, ...options }); }
                catch (error) { pending.delete(id); reject(error); }
            });
        },
        destroy() { fail('CANCELED'); worker.terminate(); },
    };
}
