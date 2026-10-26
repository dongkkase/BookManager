import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { resolveBookType } from '../../metadata/metadataTypes';
import {
    formatDetailValue,
    splitMetadataValues,
} from '../../detailPanelState';
import { ViewerDetailCoverStatus } from './ViewerStatusBadges';
import { CoverPreviewDialog } from './CoverPreviewDialog';

export function formatSize(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

export function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function detailMetadataValue(file, ...keys) {
    const sources = [file, file?.metadata, file?.full_meta];
    for (const source of sources) {
        if (!source) continue;
        for (const key of keys) {
            const value = source[key];
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                return value;
            }
        }
    }
    return '';
}

export function detailReadingTime(file, t) {
    const isAudio = resolveBookType(file || {}) === 'audio';
    const keys = isAudio
        ? ['duration_seconds', 'durationSeconds', 'DurationSeconds']
        : ['page_count', 'pages', 'pageCount', 'PageCount', 'total_pages'];
    const value = Number(detailMetadataValue(file, ...keys));
    if (!Number.isFinite(value) || value <= 0) return '-';
    const seconds = isAudio ? value : Math.floor(value) * 20;
    if (seconds <= 0) return '-';
    const minutes = Math.ceil(seconds / 60);
    return minutes >= 60
        ? t('folder.detail.hours_minutes', [Math.floor(minutes / 60).toLocaleString(), minutes % 60])
        : t('folder.detail.minutes', [minutes]);
}

function publishDateParts(value = '') {
    const match = String(value || '').trim().match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/);
    return {
        year: match?.[1] || '',
        month: match?.[2] || '',
        day: match?.[3] || '',
    };
}

function twoDigitDatePart(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.padStart(2, '0');
}

export function publicationDateValue(year = '', month = '', day = '', fallback = '') {
    const normalizedYear = String(year || '').trim();
    if (!normalizedYear) return String(fallback || '').trim();

    return [
        normalizedYear,
        twoDigitDatePart(month),
        twoDigitDatePart(day),
    ].filter(Boolean).join('-');
}

export function detailPublicationDate(file = {}) {
    const publishDate = detailMetadataValue(file, 'date', 'publish_date', 'PubDate');
    const parsedPublishDate = publishDateParts(publishDate);
    const year = detailMetadataValue(file, 'year', 'Year') || parsedPublishDate.year;
    const month = detailMetadataValue(file, 'month', 'Month') || parsedPublishDate.month;
    const day = detailMetadataValue(file, 'day', 'Day') || parsedPublishDate.day;
    return publicationDateValue(year, month, day, publishDate);
}

export function isExternalHttpLink(value = '') {
    return /^https?:\/\//i.test(String(value || '').trim());
}

export function openExternalLink(value = '') {
    const link = String(value || '').trim();
    if (!isExternalHttpLink(link)) return;
    if (window.getSelection?.()?.toString()) return;
    window.electronAPI?.openExternal?.(link);
}

export function useDetailContentHeight(selectedFile, onContentHeightChange) {
    const contentRef = useRef(null);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!selectedFile || !contentRef.current) return undefined;
        const timeouts = [];
        let frame = 0;
        const measure = () => {
            const content = contentRef.current;
            if (!content) return;
            const contentRect = content.getBoundingClientRect?.();
            const contentHeight = Math.max(
                content.scrollHeight || 0,
                content.offsetHeight || 0,
                contentRect?.height || 0,
            );
            onContentHeightChange?.(Math.ceil(contentHeight));
        };
        const scheduleMeasure = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                measure();
            });
        };
        scheduleMeasure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleMeasure) : null;
        if (observer) observer.observe(contentRef.current);
        const mutationObserver = typeof MutationObserver === 'function'
            ? new MutationObserver(scheduleMeasure)
            : null;
        mutationObserver?.observe(contentRef.current, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        for (const delay of [120, 350]) {
            timeouts.push(window.setTimeout(scheduleMeasure, delay));
        }
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            for (const timeout of timeouts) window.clearTimeout(timeout);
            observer?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [onContentHeightChange, selectedFile]);

    return { contentRef, scrollRef };
}

export function DetailFieldGroup({ fields, onEditRating, t }) {
    return (
        <div className="metadata-grid">
            {fields.map(([icon, label, value, emptyWhenMissing, type]) => (
                <React.Fragment key={label}>
                    <div className="metadata-label">
                        <FaIcon name={icon} size={12} />
                        <span>{label}</span>
                    </div>
                    <div className="metadata-value" title={formatDetailValue(value)}>
                        {type === 'link' && isExternalHttpLink(value) ? (
                            <span
                                className="metadata-link-value"
                                role="link"
                                tabIndex={0}
                                onClick={() => openExternalLink(value)}
                                onKeyDown={event => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    openExternalLink(value);
                                }}
                            >
                                {formatDetailValue(value)}
                            </span>
                        ) : emptyWhenMissing && !value ? '' : formatDetailValue(value)}
                        {icon === 'star' && onEditRating && <button type="button" className="detail-rating-edit" aria-label={t('rating_editor_title')} onClick={onEditRating}>{t('rating_edit')}</button>}
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}

export function DetailCoverFrame({ children, selectedFile, coverSrc = '', coverAlt, coverFilePath, isActive = true, t }) {
    const [preview, setPreview] = useState(null);
    const triggerRef = useRef(null);
    const filePath = coverFilePath ?? selectedFile?.full_path ?? selectedFile?.path ?? '';
    const alt = coverAlt ?? selectedFile?.title ?? selectedFile?.name ?? '';
    const canPreview = Boolean(coverSrc && isActive);

    useEffect(() => {
        setPreview(null);
    }, [coverSrc, filePath, isActive]);

    const openPreview = () => {
        if (!canPreview) return;
        triggerRef.current?.focus();
        setPreview({ src: coverSrc, filePath });
    };

    return (
        <>
            <div className={`detail-cover-frame${canPreview ? ' is-previewable' : ''}`}
                onClick={canPreview ? event => { event.stopPropagation(); openPreview(); } : undefined}>
                {children}
                {canPreview && (
                    <button ref={triggerRef} type="button" className="detail-cover-preview-button"
                        aria-label={t('cover_preview')} aria-haspopup="dialog"
                        onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.stopPropagation();
                        }} />
                )}
                <ViewerDetailCoverStatus file={selectedFile} t={t} />
            </div>
            {preview && canPreview && preview.src === coverSrc && preview.filePath === filePath && (
                <CoverPreviewDialog src={coverSrc} filePath={filePath} alt={alt} t={t} onClose={() => setPreview(null)} />
            )}
        </>
    );
}

export function DetailOpenButton({ selectedFile, onOpenFile, onMore, moreMenuOpen = false, t }) {
    if (!selectedFile || selectedFile.isDirectory || selectedFile.collectionId || !onOpenFile) return null;
    const isAudio = resolveBookType(selectedFile) === 'audio';

    const openButton = (
        <button
            type="button"
            className="btn btn-primary detail-open-button"
            onClick={() => onOpenFile(selectedFile)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
        >
            <FaIcon name={isAudio ? 'headphones' : 'bookOpen'} size={18} />
            <span>{t(isAudio ? 'folder.detail.listen' : 'folder.detail.read')}</span>
        </button>
    );

    if (!onMore) return openButton;

    return (
        <div className="detail-action-buttons">
            {openButton}
            <button
                type="button"
                className="btn detail-more-button"
                aria-label={t('folder.detail.more_actions')}
                title={t('folder.detail.more_actions')}
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                aria-controls="folder-detail-actions-menu"
                onClick={event => {
                    event.stopPropagation();
                    onMore(event, selectedFile);
                }}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                }}
            >
                <FaIcon name="ellipsisVertical" size={18} />
            </button>
        </div>
    );
}

export function DetailLine({ icon, label, value, plain = false, inline = false }) {
    const display = splitMetadataValues(value).join(', ') || '-';
    return (
        <div className={`detail-line ${plain ? 'plain' : ''} ${inline ? 'inline' : ''}`.trim()}>
            <strong><FaIcon name={icon} size={12} /><span>{label}</span></strong>
            <span>{display}</span>
        </div>
    );
}
