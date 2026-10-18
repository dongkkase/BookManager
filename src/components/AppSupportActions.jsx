import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { GITHUB_URL, READIVE_APP_STORE_URL, SPONSOR_URL } from '../appShell';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { FaIcon } from './FaIcon';
import mugHeartIcon from '../images/mug-heart.svg';
import '../styles/AppSupportActions.css';

export function AppSupportActions({ t, showToast }) {
    const [showStarDialog, setShowStarDialog] = useState(false);
    const [dialogPosition, setDialogPosition] = useState({ top: 0, left: 0 });
    const actionsRef = useRef(null);
    const closeStarDialog = useCallback(() => setShowStarDialog(false), []);
    const dialogRef = useModalAccessibility(showStarDialog, closeStarDialog);

    useLayoutEffect(() => {
        if (!showStarDialog) return undefined;
        const updatePosition = () => {
            const anchor = actionsRef.current?.getBoundingClientRect();
            const dialog = dialogRef.current?.getBoundingClientRect();
            if (!anchor || !dialog) return;
            setDialogPosition({
                top: Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - dialog.height - 12)),
                left: Math.max(12, Math.min(anchor.left, window.innerWidth - dialog.width - 12)),
            });
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        return () => window.removeEventListener('resize', updatePosition);
    }, [showStarDialog, t, dialogRef]);

    const openExternal = async (url, options) => {
        try {
            if (!window.electronAPI?.openExternal) throw new Error('External link handler unavailable');
            await window.electronAPI.openExternal(url, options);
            return true;
        } catch {
            showToast?.(t('viewer.link.open_external_failed'));
            return false;
        }
    };

    return (
        <div ref={actionsRef} className="app-support-actions" role="group" aria-label={t('support.actions')}>
            <button
                type="button"
                className="app-support-button app-support-star"
                aria-label={t('support.github')}
                aria-haspopup="dialog"
                aria-expanded={showStarDialog}
                aria-controls={showStarDialog ? 'app-support-star-dialog' : undefined}
                data-tooltip={showStarDialog ? undefined : t('support.github')}
                onClick={() => setShowStarDialog(true)}
            >
                <FaIcon name="star" size={18} />
            </button>
            <button
                type="button"
                className="app-support-button app-support-sponsor"
                aria-label={t('support.sponsor')}
                data-tooltip={t('support.sponsor')}
                onClick={() => openExternal(SPONSOR_URL)}
            >
                <span className="app-support-mug" style={{ '--support-mug-icon': `url("${mugHeartIcon}")` }} aria-hidden="true" />
            </button>
            <button
                type="button"
                className="app-support-button app-support-apple"
                aria-label={t('support.ios')}
                data-tooltip={t('support.ios')}
                onClick={() => openExternal(READIVE_APP_STORE_URL, { browser: true })}
            >
                <FaIcon name="apple" size={20} />
            </button>
            <button
                type="button"
                className="app-support-button app-support-android"
                aria-label={t('support.android')}
                aria-disabled="true"
                data-tooltip={t('support.android')}
            >
                <FaIcon name="android" size={20} />
            </button>
            {showStarDialog && (
                <div
                    className="app-support-dialog-layer"
                    onKeyDown={event => event.stopPropagation()}
                    onMouseDown={event => {
                        event.stopPropagation();
                        if (event.target === event.currentTarget) closeStarDialog();
                    }}
                >
                    <section
                        ref={dialogRef}
                        id="app-support-star-dialog"
                        className="app-support-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="app-support-star-title"
                        aria-describedby="app-support-star-description"
                        tabIndex={-1}
                        style={dialogPosition}
                    >
                        <button
                            type="button"
                            className="app-support-dialog-close"
                            aria-label={t('btn_close')}
                            onClick={closeStarDialog}
                        >
                            <FaIcon name="xmark" />
                        </button>
                        <h2 id="app-support-star-title">{t('support.star_title')}</h2>
                        <p id="app-support-star-description">{t('support.star_description')}</p>
                        <button
                            type="button"
                            className="app-support-dialog-link"
                            onClick={async () => {
                                if (await openExternal(GITHUB_URL)) closeStarDialog();
                            }}
                        >
                            <span>{t('support.star_action')}</span>
                            <FaIcon name="externalLink" size={13} />
                        </button>
                    </section>
                </div>
            )}
        </div>
    );
}
