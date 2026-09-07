import React, { useState } from 'react';
import noImage from '../images/noimage.png';

export function CoverArtwork(props) {
    return <CoverArtworkSource key={props.src || ''} {...props} />;
}

function CoverArtworkSource({ src = '', alt = '', fallbackAlt = '', className = '', fallbackClassName = className, onLoad }) {
    const [failed, setFailed] = useState(false);
    const showPlaceholder = !src || failed;

    return (
        <img
            src={showPlaceholder ? noImage : src}
            alt={showPlaceholder ? fallbackAlt : alt}
            title={showPlaceholder ? fallbackAlt || undefined : undefined}
            className={showPlaceholder ? `cover-placeholder-image ${fallbackClassName}`.trim() : className}
            onLoad={showPlaceholder ? undefined : onLoad}
            onError={showPlaceholder ? undefined : () => setFailed(true)}
        />
    );
}
