import { replaceText, searchText } from '../textCleanerFindReplace.js';

self.onmessage = ({ data }) => {
    try {
        const result = data.type === 'replace'
            ? replaceText(data.text, data.query, data.replacement, data.options, data)
            : searchText(data.text, data.query, data.options);
        self.postMessage({ ok: true, result });
    } catch (error) {
        self.postMessage({ ok: false, code: error instanceof SyntaxError ? 'invalid_regex' : 'search_failed' });
    }
};
