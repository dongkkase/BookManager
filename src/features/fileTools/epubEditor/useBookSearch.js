import { useEffect, useRef, useState } from 'react';
import { createBookSearchClient } from './bookSearchClient.js';

export default function useBookSearch({ editor, chapters, query, caseSensitive, enabled }) {
    const client = useRef(null);
    const [snapshot, setSnapshot] = useState(null);
    useEffect(() => {
        if (!enabled || !editor) return;
        const worker = new Worker(new URL('./bookSearchWorker.js', import.meta.url), { type: 'module' });
        const current = createBookSearchClient(worker, editor.schema);
        client.current = current;
        return () => { current.destroy(); client.current = null; };
    }, [editor, enabled]);
    useEffect(() => {
        if (!enabled || !client.current) return;
        let active = true;
        const current = client.current;
        const timer = setTimeout(async () => {
            try {
                current.sync(chapters);
                const counts = await current.request('find', { query, caseSensitive });
                if (active) setSnapshot({ chapters, query, caseSensitive, counts });
            } catch (error) {
                if (active && error.code !== 'CANCELED') setSnapshot({ chapters, query, caseSensitive, error });
            }
        }, 150);
        return () => { active = false; clearTimeout(timer); };
    }, [editor, enabled, chapters, query, caseSensitive]);
    const ready = enabled && snapshot?.chapters === chapters && snapshot.query === query && snapshot.caseSensitive === caseSensitive;
    return {
        counts: ready ? snapshot.counts : null,
        error: ready ? snapshot.error : null,
        searching: enabled && !!query && !ready,
        replaceAll: async (currentChapters, replacement) => {
            const current = client.current;
            if (!current) throw Object.assign(new Error(), { code: 'CANCELED' });
            current.sync(currentChapters);
            return current.request('replaceAll', { query, caseSensitive, replacement });
        },
    };
}
