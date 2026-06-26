import React, { useEffect, useRef } from 'react';
import { FaIcon } from '../FaIcon';
import {
    formatDetailValue,
    splitMetadataValues,
} from '../../detailPanelState';

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
        const frame = window.requestAnimationFrame(measure);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(contentRef.current);
        const mutationObserver = typeof MutationObserver === 'function'
            ? new MutationObserver(measure)
            : null;
        mutationObserver?.observe(contentRef.current, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
        });
        for (const delay of [50, 150, 350]) {
            timeouts.push(window.setTimeout(measure, delay));
        }
        return () => {
            window.cancelAnimationFrame(frame);
            for (const timeout of timeouts) window.clearTimeout(timeout);
            observer?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [onContentHeightChange, selectedFile]);

    return { contentRef, scrollRef };
}

export function DetailFieldGroup({ fields }) {
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
                    </div>
                </React.Fragment>
            ))}
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
