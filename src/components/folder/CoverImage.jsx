import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';

function coverImageKey(file = {}) {
  return [
    file.cover || '',
    file.mtime ?? file.modified ?? '',
    file.size ?? '',
  ].join('|');
}

function CoverImage({ src, alt = '', className = '', t, iconSize = 24, showLoadingIndicator = true }) {
  const imageRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (!src || typeof window === 'undefined') return undefined;
    const image = imageRef.current;
    if (!image) return undefined;
    let disposed = false;

    const applyImageState = () => {
      if (disposed || imageRef.current !== image || !image.complete) return;
      if (image.naturalWidth > 0) setLoaded(true);
      else setFailed(true);
    };

    const frameId = window.requestAnimationFrame(applyImageState);
    const eagerTimer = window.setTimeout(() => {
      if (disposed || imageRef.current !== image || image.complete) return;
      image.loading = 'eager';
      image.src = src;
    }, 250);

    if (typeof image.decode === 'function') {
      image.decode()
        .then(() => {
          if (!disposed && imageRef.current === image) setLoaded(true);
        })
        .catch(applyImageState);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(eagerTimer);
    };
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`${className} folder-cover-placeholder`} title={t('folder_no_cover')}>
        <FaIcon name="file" size={iconSize} />
        <span>{t('folder_no_cover')}</span>
      </div>
    );
  }

  return (
    <div className={`${className} folder-cover-loading`}>
      {showLoadingIndicator && !loaded && <span className="folder-cover-spinner" aria-hidden="true" />}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        loading="lazy"
        className={loaded ? 'loaded' : ''}
        onLoad={event => {
          if (event.currentTarget.naturalWidth > 0) setLoaded(true);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export { CoverImage, coverImageKey };
