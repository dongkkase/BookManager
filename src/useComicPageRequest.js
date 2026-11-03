import { useLayoutEffect, useState } from 'react';
import { createComicPageRequest } from './viewerComicResources';

export function useComicPageRequest(source = '') {
    const managed = source.startsWith('bookmanager-comic:') && Boolean(globalThis.window?.viewerAPI?.cancelComicPageRequest);
    const [request, setRequest] = useState(null);
    useLayoutEffect(() => {
        if (!managed) return undefined;
        const next = createComicPageRequest(source);
        setRequest({ source, url: next.url });
        return () => next.release();
    }, [managed, source]);
    return managed ? (request?.source === source ? request.url : '') : source;
}
