import { useEffect, useState } from 'react';
import { createComicPageRequest } from './viewerComicResources';
import { readStaticComicPngSize, scheduleComicThumbnail } from './viewerComicThumbnail';

const LOADING_PAGE = { status: 'loading', bitmap: null, width: 0, height: 0, url: '', error: null };
const MAX_TILED_PAGE_WIDTH = 8192;

export default function useComicPngPage(source = '', page) {
    const pageName = page?.name || '';
    const [state, setState] = useState(null);
    useEffect(() => {
        if (!source) return undefined;
        let disposed = false;
        let request = null;
        let bitmap = null;
        let objectUrl = '';
        const controller = new AbortController();
        setState({ ...LOADING_PAGE, source, pageName });
        const cancel = scheduleComicThumbnail(async isCancelled => {
            try {
                request = createComicPageRequest(source);
                const response = await fetch(request.url, { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error('Comic image could not be loaded.');
                const blob = await response.blob();
                if (isCancelled()) return;
                const size = await readStaticComicPngSize(blob, isCancelled);
                if (isCancelled()) return;
                let displaySize = size;
                if (size && size.width <= MAX_TILED_PAGE_WIDTH
                    && (size.height > 16384 || size.width * size.height > 32_000_000)) {
                    // Keep the CPU bitmap alive only while the page is mounted. The
                    // caller paints small visible crops and must not close this bitmap.
                    bitmap = await createImageBitmap(blob);
                    if (isCancelled()) {
                        bitmap.close();
                        bitmap = null;
                        return;
                    }
                    if (bitmap.width <= MAX_TILED_PAGE_WIDTH) {
                        setState({ ...LOADING_PAGE, source, pageName, status: 'tiled', bitmap, width: bitmap.width, height: bitmap.height });
                        return;
                    }
                    // Image orientation can turn a narrow header into a wide bitmap.
                    // Keep those pages on the original renderer's image path.
                    displaySize = { width: bitmap.width, height: bitmap.height };
                    bitmap.close();
                    bitmap = null;
                }
                objectUrl = URL.createObjectURL(blob);
                setState({ ...LOADING_PAGE, source, pageName, status: 'original', url: objectUrl, width: displaySize?.width || 0, height: displaySize?.height || 0 });
            } catch (error) {
                if (!disposed && !isCancelled()) setState({ ...LOADING_PAGE, source, pageName, status: 'error', error });
            } finally {
                request?.release();
            }
        }, { priority: 0 });
        return () => {
            disposed = true;
            cancel();
            controller.abort();
            request?.release();
            bitmap?.close();
            bitmap = null;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [pageName, source]);
    return source && state?.source === source && state.pageName === pageName ? state : LOADING_PAGE;
}
