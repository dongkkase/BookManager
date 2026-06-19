const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeExternalUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : '';
    } catch (_error) {
        return '';
    }
}
