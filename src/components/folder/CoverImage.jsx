import React, { useEffect, useState } from 'react';
import { FaIcon } from '../FaIcon';

function CoverImage({ src, alt = '', className = '', t, iconSize = 24 }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
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
      {!loaded && <span className="folder-cover-spinner" aria-label={t('folder_cover_img')} />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={loaded ? 'loaded' : ''}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export { CoverImage };
