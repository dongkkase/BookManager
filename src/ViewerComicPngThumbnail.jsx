import React, { useEffect, useRef, useState } from 'react';
import { createComicPageRequest } from './viewerComicResources';
import { readStaticComicPngSize, scheduleComicThumbnail } from './viewerComicThumbnail';

export default function ViewerComicPngThumbnail({ item }) {
    const canvasRef = useRef(null);
    const itemRef = useRef(item);
    itemRef.current = item;
    const [display, setDisplay] = useState(null);
    const readyRef = useRef(false);
    useEffect(() => {
        if (readyRef.current || !item.src) return undefined;
        let disposed = false;
        let request = null;
        let objectUrl = null;
        const controller = new AbortController();
        const canvas = canvasRef.current;
        const cancel = scheduleComicThumbnail(async isCancelled => {
            let bitmap = null;
            try {
                request = createComicPageRequest(item.src);
                const response = await fetch(request.url, { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error('Comic thumbnail could not be loaded.');
                const blob = await response.blob();
                if (isCancelled()) return;
                const size = await readStaticComicPngSize(blob, isCancelled);
                if (isCancelled()) return;
                if (size) {
                    const bounds = canvas?.parentElement?.getBoundingClientRect();
                    const scale = Math.min((bounds?.width || 60) / size.width, 70 / size.height);
                    const width = Math.max(1, Math.round(size.width * scale));
                    const height = Math.max(1, Math.round(size.height * scale));
                    const density = Math.min(2, window.devicePixelRatio || 1);
                    const paint = source => {
                        const context = canvas?.getContext('2d');
                        if (!context) throw new Error('Comic thumbnail canvas is unavailable.');
                        canvas.width = Math.ceil(width * density);
                        canvas.height = Math.ceil(height * density);
                        canvas.style.width = `${width}px`;
                        canvas.style.height = `${height}px`;
                        context.drawImage(source, 0, 0, canvas.width, canvas.height);
                        itemRef.current.onLoad?.({ currentTarget: { naturalWidth: size.width, naturalHeight: size.height } });
                        readyRef.current = true;
                        setDisplay({ canvas: true });
                    };
                    try {
                        bitmap = await createImageBitmap(blob, {
                            resizeWidth: Math.ceil(width * density),
                            resizeHeight: Math.ceil(height * density),
                            resizeQuality: 'high',
                        });
                        if (isCancelled()) return;
                        paint(bitmap);
                        return;
                    } catch {
                        if (isCancelled()) return;
                    }
                    // Older decoders can reject bitmap resizing. Keep original decoding
                    // inside the same slot and release it after painting the small canvas.
                    const image = new Image();
                    const sourceUrl = URL.createObjectURL(blob);
                    try {
                        await new Promise((resolve, reject) => {
                            // A detached Image may continue native decoding after abort.
                            // Wait for completion before admitting another thumbnail.
                            image.onload = resolve;
                            image.onerror = () => reject(new Error('Comic thumbnail decoding failed.'));
                            image.src = sourceUrl;
                        });
                        if (!isCancelled()) paint(image);
                    } finally {
                        image.onload = image.onerror = null;
                        image.removeAttribute('src');
                        URL.revokeObjectURL(sourceUrl);
                    }
                    return;
                }
                objectUrl = URL.createObjectURL(blob);
                setDisplay({ url: objectUrl });
            } catch {
                if (!disposed && item.page?.pageUrl && !item.src.startsWith('data:')) itemRef.current.onFallback?.();
            } finally {
                bitmap?.close();
                request?.release();
            }
        });
        return () => {
            disposed = true;
            cancel();
            controller.abort();
            request?.release();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [item.src, item.page?.pageUrl]);
    useEffect(() => {
        const canvas = canvasRef.current;
        return () => { if (canvas) canvas.width = canvas.height = 1; };
    }, []);
    return <>
        <canvas ref={canvasRef} aria-hidden="true" style={{ display: display?.canvas ? 'block' : 'none' }} />
        {display?.url && <img
            src={display.url}
            alt=""
            aria-hidden="true"
            onLoad={event => itemRef.current.onLoad?.(event)}
            onError={() => {
                if (item.page?.pageUrl && !item.src.startsWith('data:')) itemRef.current.onFallback?.();
            }}
        />}
    </>;
}
