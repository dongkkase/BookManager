export function editorMediaRequestHeaders(details, ownerId, appId) {
    const headers = details.requestHeaders;
    if (details.webContentsId !== ownerId || details.resourceType !== 'subFrame' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(appId)) return headers;
    try {
        const url = new URL(details.url);
        if (url.origin !== 'https://www.youtube-nocookie.com' || !/^\/embed\/[\w-]{11}$/.test(url.pathname)) return headers;
    } catch { return headers; }
    const referer = Object.entries(headers).find(([name]) => name.toLowerCase() === 'referer')?.[1];
    if (typeof referer === 'string' && /^https?:\/\//i.test(referer)) return headers;
    return { ...Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'referer')), Referer: `https://${appId.toLowerCase()}/` };
}

const mediaHeaderOwners = new WeakMap();

export function installEditorMediaHeaders(webContents, appId) {
    const ownerId = webContents.id;
    const session = webContents.session;
    let owners = mediaHeaderOwners.get(session);
    if (!owners) {
        owners = new Map();
        mediaHeaderOwners.set(session, owners);
        session.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (details, callback) => {
            const requestAppId = owners.get(details.webContentsId);
            callback({ requestHeaders: requestAppId
                ? editorMediaRequestHeaders(details, details.webContentsId, requestAppId)
                : details.requestHeaders });
        });
    }
    owners.set(ownerId, appId);
    webContents.once?.('destroyed', () => owners.delete(ownerId));
}
