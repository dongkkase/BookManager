import React from 'react';
import { FaIcon } from '../FaIcon';
import {
    viewerBookmarkStatusText,
    viewerReadingProgressText,
    viewerReadingStatusText,
} from '../../viewerStatusState';

function resolveStatus(file, status) {
    return status || file?.viewerStatus || {};
}

export function ViewerReadingStatusIcon({ file, status, t, size = 11 }) {
    const resolvedStatus = resolveStatus(file, status);
    if (!resolvedStatus.isCompleted && !resolvedStatus.hasReadingProgress) return null;
    const label = viewerReadingStatusText(resolvedStatus, t);
    return (
        <span
            className={`viewer-status-icon viewer-status-reading ${resolvedStatus.isCompleted ? 'is-complete' : 'is-progress'}`}
            title={label}
            aria-label={label}
        >
            <FaIcon name={resolvedStatus.isCompleted ? 'book' : 'bookOpen'} size={size} />
        </span>
    );
}

export function ViewerBookmarkStatusIcon({ file, status, t, size = 11 }) {
    const resolvedStatus = resolveStatus(file, status);
    if (!resolvedStatus.hasBookmarks) return null;
    const label = viewerBookmarkStatusText(resolvedStatus, t);
    return (
        <span
            className="viewer-status-icon viewer-status-bookmark"
            title={label}
            aria-label={label}
        >
            <FaIcon name="bookmark" size={size} />
        </span>
    );
}

export function ViewerStatusIcons({ file, status, t, size = 11, className = '' }) {
    const resolvedStatus = resolveStatus(file, status);
    if (!resolvedStatus.isCompleted && !resolvedStatus.hasReadingProgress && !resolvedStatus.hasBookmarks) {
        return null;
    }
    return (
        <span className={`viewer-status-icons ${className}`.trim()}>
            <ViewerReadingStatusIcon status={resolvedStatus} t={t} size={size} />
            <ViewerBookmarkStatusIcon status={resolvedStatus} t={t} size={size} />
        </span>
    );
}

export function ViewerCoverProgress({ file, status, t, className = '' }) {
    const resolvedStatus = resolveStatus(file, status);
    if (!resolvedStatus.isCompleted && !resolvedStatus.hasReadingProgress) return null;
    const rawPercent = Number(resolvedStatus.percent);
    const percent = resolvedStatus.isCompleted ? 100 : Math.max(0, Math.min(100, Number.isFinite(rawPercent) ? rawPercent : 0));
    const progressText = viewerReadingProgressText(resolvedStatus);
    const readingLabel = [viewerReadingStatusText(resolvedStatus, t), progressText].filter(Boolean).join(' ');
    return (
        <div
            className={`viewer-cover-progress ${className}${resolvedStatus.isCompleted ? ' is-complete' : ''}`.trim()}
            role="progressbar"
            aria-label={viewerReadingStatusText(resolvedStatus, t)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={readingLabel}
            title={readingLabel}
        >
            <span className="viewer-cover-progress-fill" style={{ width: `${percent}%` }} />
        </div>
    );
}

export function ViewerDetailCoverStatus({ file, status, t, size = 12 }) {
    const resolvedStatus = resolveStatus(file, status);
    if (!resolvedStatus.isCompleted && !resolvedStatus.hasReadingProgress && !resolvedStatus.hasBookmarks) return null;
    return (
        <>
            <div className="viewer-status-badge-row detail-cover-status-icons">
                <ViewerReadingStatusIcon status={resolvedStatus} t={t} size={size} />
                <ViewerBookmarkStatusIcon status={resolvedStatus} t={t} size={size} />
            </div>
            <ViewerCoverProgress status={resolvedStatus} t={t} className="detail-cover-progress" />
        </>
    );
}

export function ViewerStatusBadgeRow({ file, status, t, pageText = '', size = 10, className = '' }) {
    const resolvedStatus = resolveStatus(file, status);
    const hasStatus = resolvedStatus.isCompleted || resolvedStatus.hasReadingProgress || resolvedStatus.hasBookmarks;
    const recentReadingText = String(file?.recentReadingText || '');
    if (!pageText && !hasStatus && !recentReadingText) return null;
    return (
        <div className={`viewer-status-badge-row ${className}`.trim()}>
            {recentReadingText && (
                <span className="viewer-recent-reading-badge" title={recentReadingText}>
                    <FaIcon name="clock" size={9} />
                    <span>{recentReadingText}</span>
                </span>
            )}
            {pageText && <span className="viewer-page-count-badge">{pageText}</span>}
            <ViewerStatusIcons status={resolvedStatus} t={t} size={size} />
        </div>
    );
}
