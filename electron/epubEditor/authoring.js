export const BLOCK_STYLES = {
    lead: 'font-size:1.2em;line-height:1.7',
    subtitle: 'font-size:1.1em;color:#64748b;font-style:italic',
    note: 'background:#edf5ff;color:#203e60;border-left:4px solid #6089bd;padding:.8em 1em;text-indent:0',
    warning: 'background:#fff5df;color:#6e4916;border-left:4px solid #c58a2c;padding:.8em 1em;text-indent:0',
    quotation: 'font-style:italic;border-left:3px solid #85998a;padding-left:1em',
    signature: 'text-align:right;font-style:italic',
};
export const INLINE_STYLES = {
    emphasis: 'font-weight:700;color:#9f1239',
    muted: 'color:#64748b',
    keyboard: 'font-family:monospace;background:#eef0f2;color:#263449;border:1px solid #cbd0d6;border-radius:3px;padding:0 .25em',
    small: 'font-size:.85em',
};
export const HIGHLIGHTS = {
    yellowMarker: { background: '#fff176', color: '#29291f' },
    greenMarker: { background: '#b9f6ca', color: '#193b27' },
    pinkMarker: { background: '#f8bbd0', color: '#4a2233' },
    blueMarker: { background: '#b3e5fc', color: '#173c4e' },
    redPen: { background: 'transparent', color: '#c62828' },
    greenPen: { background: 'transparent', color: '#237538' },
};

export function authoringCss(scope = '') {
    return Object.entries({ ...BLOCK_STYLES, ...INLINE_STYLES }).map(([key, value]) => `${scope}.bm-style-${key}{${value}}`).join('\n') + '\n' +
        Object.entries(HIGHLIGHTS).map(([key, value]) => `${scope}mark.bm-highlight-${key}{background-color:${value.background};color:${value.color};padding:0}`).join('\n');
}

export function parseMediaUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s<>"'\\\u0000-\u001f]/.test(value.trim())) return null;
    try {
        const url = new URL(value.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        const host = url.hostname.toLowerCase();
        let id;
        if (host === 'youtu.be') id = url.pathname.slice(1);
        else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
            id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
        }
        if (id && /^[\w-]{11}$/.test(id)) {
            const raw = url.searchParams.get('start') || url.searchParams.get('t') || '';
            const time = /^\d{1,6}$/.test(raw) ? Number(raw) : /^(?:(\d{1,3})h)?(?:(\d{1,3})m)?(?:(\d{1,3})s)?$/.exec(raw);
            const start = typeof time === 'number' ? time : time ? Number(time[1] || 0) * 3600 + Number(time[2] || 0) * 60 + Number(time[3] || 0) : 0;
            return { provider: 'YouTube', url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ''}`, embed: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}` };
        }
        if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
            const match = /^\/(?:video\/)?(\d{1,12})(?:\/([a-f0-9]{10}))?\/?$/.exec(url.pathname);
            const hash = match?.[2] || url.searchParams.get('h');
            if (match && (!hash || /^[a-f0-9]{10}$/.test(hash))) return { provider: 'Vimeo', url: `https://vimeo.com/${match[1]}${hash ? `/${hash}` : ''}`, embed: `https://player.vimeo.com/video/${match[1]}${hash ? `?h=${hash}` : ''}` };
        }
    } catch { return null; }
    return null;
}
