import React, { useEffect, useRef, useState } from 'react';
import { parseMediaUrl } from '../../../electron/epubEditor/authoring.js';
import '../../styles/epubInlineMedia.css';

export default function EpubInlineMedia({ url, title, active = true, className = '', style, ...props }) {
    const containerRef = useRef(null);
    const [visible, setVisible] = useState(false);
    const media = parseMediaUrl(url);
    useEffect(() => {
        setVisible(false);
        if (!active || !containerRef.current) return undefined;
        const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [active, url]);
    if (!media) return null;
    return (
        <div
            {...props}
            ref={containerRef}
            className={`viewer-epub-inline-media ${className}`.trim()}
            data-epub-media-title={title || media.provider}
            style={style}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
        >
            {active && visible && (
                <iframe
                    key={media.embed}
                    src={media.embed}
                    title={title || media.provider}
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    allow="fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                />
            )}
        </div>
    );
}
