import React from 'react';
import { FaIcon } from './FaIcon';
import workingAnimation from '../images/rainbow cat remix.gif';

export function AppLockOverlay({
    isAppLocked,
    useLibraryScanSlide,
    lockIsLibraryIndexing,
    lockThumbnailItems,
    lockAriaLabel,
    lockCurrentItem,
    lockCurrentItemName,
    lockMessage,
}) {
    if (!isAppLocked) return null;

    if (useLibraryScanSlide) {
        return (
            <div className="app-library-scan-slide" role="status" aria-live="polite" aria-label={lockAriaLabel}>
                <div className={`app-library-scan-stage ${lockIsLibraryIndexing ? 'is-indexing' : ''}`}>
                    {lockIsLibraryIndexing ? (
                        <div className="app-library-indexing-visual">
                            <img className="app-library-indexing-image" src={workingAnimation} alt="" />
                        </div>
                    ) : lockThumbnailItems.length > 0 ? (
                        <div className="app-library-scan-rail">
                            {lockThumbnailItems.map(item => (
                                <div
                                    className={`app-library-scan-card ${item.src ? '' : 'is-placeholder'}`}
                                    key={item.key || item.src || item.path || item.name}
                                >
                                    {item.src ? (
                                        <img
                                            className="app-library-scan-thumbnail"
                                            src={item.src}
                                            alt=""
                                        />
                                    ) : (
                                        <div className="app-library-scan-placeholder" aria-hidden="true">
                                            <FaIcon name="bookOpen" size={24} />
                                        </div>
                                    )}
                                    {item.name && (
                                        <span className="app-library-scan-caption" title={item.path || item.name}>
                                            {item.name}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="app-library-scan-empty">
                            <span>{lockCurrentItemName || lockMessage}</span>
                        </div>
                    )}
                </div>
                <div className="app-library-scan-info">
                    <span className="app-library-scan-message">{lockMessage}</span>
                    {lockCurrentItem && (
                        <span className="app-library-scan-current" title={lockCurrentItem}>
                            {lockCurrentItemName}
                        </span>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="app-lock-screen" role="status" aria-live="polite" aria-label={lockAriaLabel}>
            {lockThumbnailItems.length > 0 ? (
                <div className="app-lock-thumbnail-stage">
                    <div className="app-lock-thumbnail-rail">
                        {lockThumbnailItems.map(item => (
                            <div
                                className={`app-lock-thumbnail-frame ${item.src ? '' : 'is-placeholder'}`}
                                key={item.key || item.src || item.path || item.name}
                            >
                                {item.src ? (
                                    <img
                                        className="app-lock-thumbnail"
                                        src={item.src}
                                        alt=""
                                    />
                                ) : (
                                    <div className="app-lock-thumbnail-placeholder" aria-hidden="true">
                                        <FaIcon name="bookOpen" size={28} />
                                    </div>
                                )}
                                {item.name && (
                                    <span className="app-lock-thumbnail-caption" title={item.path || item.name}>
                                        {item.name}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <img className="app-lock-working-image" src={workingAnimation} alt="" />
            )}
            <span>{lockMessage}</span>
            {lockCurrentItem && (
                <span className="app-lock-current-file" title={lockCurrentItem}>
                    {lockCurrentItemName}
                </span>
            )}
        </div>
    );
}
