import React, { useRef, useState } from 'react';
import { useFolderCoverPreview } from './FolderCoverPreviewContext';
import { useCoverFadeIn } from '../../hooks/useCoverFadeIn';

function FolderLayerImage({ src }) {
    const imageRef = useRef(null);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    useCoverFadeIn(imageRef, src, loaded && !failed);

    return (
        <img
            ref={imageRef}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            style={{ opacity: 0, transition: 'none', visibility: failed ? 'hidden' : 'visible' }}
            onLoad={event => {
                if (event.currentTarget.naturalWidth > 0) setLoaded(true);
            }}
            onError={() => setFailed(true)}
        />
    );
}

export function FolderThumbnailLayers({ file }) {
    const preview = useFolderCoverPreview(file);
    const covers = preview?.folder_covers || [];

    return <>
        {[['back', covers[1]], ['middle', covers[0]]].map(([layer, cover]) => (
            <span key={layer} className={`folder-cover-layer is-${layer}`} aria-hidden="true">
                {cover?.cover && (
                    <FolderLayerImage key={cover.cover} src={cover.cover} />
                )}
            </span>
        ))}
    </>;
}
