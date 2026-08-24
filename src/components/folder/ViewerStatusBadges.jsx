import React from 'react';
import { FaIcon } from '../FaIcon';
import {
    viewerBookmarkStatusText,
    viewerReadingProgressParts,
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

export function ViewerDetailStatusBadges({ file, status, t, size = 19, className = '' }) {
    const resolvedStatus = resolveStatus(file, status);
    const hasReadingStatus = resolvedStatus.isCompleted || resolvedStatus.hasReadingProgress;
    const hasStatus = hasReadingStatus || resolvedStatus.hasBookmarks;
    if (!hasStatus) return null;
    const { percentText, pageText } = viewerReadingProgressParts(resolvedStatus);
    const progressText = viewerReadingProgressText(resolvedStatus);
    const readingLabel = [viewerReadingStatusText(resolvedStatus, t), progressText].filter(Boolean).join(' ');
    return (
        <div className={`viewer-status-badge-row ${className}`.trim()}>
            {hasReadingStatus && (
                <span
                    className="viewer-detail-reading-status"
                    title={readingLabel}
                    aria-label={readingLabel}
                >
                    {percentText && <span className="viewer-status-percent-text">{percentText}</span>}
                    {pageText && <span className="viewer-status-page-text">{pageText}</span>}
                    <ViewerReadingStatusIcon status={resolvedStatus} t={t} size={size} />
                </span>
            )}
            <ViewerBookmarkStatusIcon status={resolvedStatus} t={t} size={size} />
        </div>
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
