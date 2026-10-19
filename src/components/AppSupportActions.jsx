import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { GITHUB_URL, READIVE_APP_STORE_URL, SPONSOR_URL } from '../appShell';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { FaIcon } from './FaIcon';
import '../styles/AppSupportActions.css';

/*! Derived from Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc. */
const MUG_HEART_PATH = 'M184 48C170.7 48 160 58.7 160 72C160 110.9 183.4 131.4 199.1 145.1L200.2 146.1C216.5 160.4 224 167.9 224 184C224 197.3 234.7 208 248 208C261.3 208 272 197.3 272 184C272 145.1 248.6 124.6 232.9 110.9L231.8 109.9C215.5 95.7 208 88.1 208 72C208 58.7 197.3 48 184 48zM128 256C110.3 256 96 270.3 96 288L96 480C96 533 139 576 192 576L384 576C425.8 576 461.4 549.3 474.5 512L480 512C550.7 512 608 454.7 608 384C608 313.3 550.7 256 480 256L128 256zM480 448L480 320C515.3 320 544 348.7 544 384C544 419.3 515.3 448 480 448zM320 72C320 58.7 309.3 48 296 48C282.7 48 272 58.7 272 72C272 110.9 295.4 131.4 311.1 145.1L312.2 146.1C328.5 160.4 336 167.9 336 184C336 197.3 346.7 208 360 208C373.3 208 384 197.3 384 184C384 145.1 360.6 124.6 344.9 110.9L343.8 109.9C327.5 95.7 320 88.1 320 72z M 282 348.44 L 288 356.72 L 294 348.44 C 304 334.6 320.08 326.4 337.16 326.4 C 366.56 326.4 390.4 350.24 390.4 379.64 L 390.4 380.68 C 390.4 425.56 334.44 477.68 305.24 499.96 C 300.28 503.72 294.2 505.6 288 505.6 C 281.8 505.6 275.68 503.76 270.76 499.96 C 241.56 477.68 185.6 425.56 185.6 380.68 L 185.6 379.64 C 185.6 350.24 209.44 326.4 238.84 326.4 C 255.92 326.4 272 334.6 282 348.44 z';

function SupportButtonVisual({ children }) {
    return (
        <span className="app-support-button-visual" aria-hidden="true">
            <span className="app-support-button-icon">{children}</span>
            <span className="app-support-button-burst" />
        </span>
    );
}

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
                <SupportButtonVisual><FaIcon name="star" size={16} /></SupportButtonVisual>
            </button>
            <button
                type="button"
                className="app-support-button app-support-sponsor"
                aria-label={t('support.sponsor')}
                data-tooltip={t('support.sponsor')}
                onClick={() => openExternal(SPONSOR_URL)}
            >
                <SupportButtonVisual>
                    <svg className="app-support-mug" viewBox="0 0 640 640" aria-hidden="true" focusable="false">
                        <path fillRule="evenodd" d={MUG_HEART_PATH} />
                    </svg>
                </SupportButtonVisual>
            </button>
            <span className="app-support-divider" aria-hidden="true" />
            <button
                type="button"
                className="app-support-button app-support-apple"
                aria-label={t('support.ios')}
                data-tooltip={t('support.ios')}
                onClick={() => openExternal(READIVE_APP_STORE_URL, { browser: true })}
            >
                <FaIcon name="apple" size={18} />
            </button>
            <button
                type="button"
                className="app-support-button app-support-android"
                aria-label={t('support.android')}
                aria-disabled="true"
                data-tooltip={t('support.android')}
            >
                <FaIcon name="android" size={18} />
            </button>
                <div
                    className={`app-support-dialog-layer${showStarDialog ? ' is-open' : ''}`}
                    aria-hidden={!showStarDialog}
                    inert={showStarDialog ? undefined : ''}
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
        </div>
    );
}
