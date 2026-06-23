import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
    duplicateDetailRows,
    splitMetadataValues,
} from '../../detailPanelState';
import {
    DetailFieldGroup,
    DetailLine,
    formatDate,
    formatSize,
    useDetailContentHeight,
} from './detailPanelCommon';

function metadataText(t, key, fallback) {
    const translated = t?.(key);
    return translated && translated !== key ? translated : fallback;
}

function metadataValue(file, ...keys) {
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

function publicationDateValue(year = '', month = '', day = '', fallback = '') {
    const normalizedYear = String(year || '').trim();
    if (!normalizedYear) return String(fallback || '').trim();

    return [
        normalizedYear,
        twoDigitDatePart(month),
        twoDigitDatePart(day),
    ].filter(Boolean).join('-');
}

const BookDetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
    const [imageError, setImageError] = useState(false);
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);

    useEffect(() => {
        setImageError(false);
    }, [selectedFile?.path]);

    const tags = useMemo(
        () => splitMetadataValues(
            metadataValue(selectedFile, 'genre', 'Genre'),
            metadataValue(selectedFile, 'tags', 'Tags'),
        ),
        [selectedFile],
    );
    const duplicates = useMemo(() => duplicateDetailRows(selectedFile || {}), [selectedFile]);

    if (!selectedFile) {
        return <div className="folder-detail-panel empty"><div className="detail-empty-state">-</div></div>;
    }

    const coverAvailable = selectedFile.cover && !imageError;
    const fileName = selectedFile.name || String(selectedFile.path || selectedFile.full_path || '').split(/[\\/]/).pop();
    const title = metadataValue(selectedFile, 'title', 'Title') || selectedFile.name;
    const series = metadataValue(selectedFile, 'series', 'Series');
    const volume = metadataValue(selectedFile, 'volume', 'Volume');
    const creators = splitMetadataValues(
        metadataValue(selectedFile, 'writer', 'Writer'),
        metadataValue(selectedFile, 'author', 'Author'),
        metadataValue(selectedFile, 'creators'),
        metadataValue(selectedFile, 'producer'),
    ).join(', ');
    const publishDate = metadataValue(selectedFile, 'date', 'publish_date');
    const parsedPublishDate = publishDateParts(publishDate);
    const year = metadataValue(selectedFile, 'year', 'Year') || parsedPublishDate.year;
    const month = metadataValue(selectedFile, 'month', 'Month') || parsedPublishDate.month;
    const day = metadataValue(selectedFile, 'day', 'Day') || parsedPublishDate.day;
    const publicationDate = publicationDateValue(year, month, day, publishDate);
    const publisher = metadataValue(selectedFile, 'publisher', 'Publisher');
    const isbn = metadataValue(selectedFile, 'isbn', 'ISBN');
    const language = metadataValue(selectedFile, 'language', 'LanguageISO');
    const rating = metadataValue(selectedFile, 'rating', 'CommunityRating');
    const summary = metadataValue(selectedFile, 'description', 'summary', 'Summary');
    const tagLabel = metadataText(t, 't3_f_genre_keywords_categories', '장르/키워드/카테고리');
    const bookFields = [
        ['fileLines', metadataText(t, 't3_f_series_number', '시리즈번호'), volume],
        ['user', metadataText(t, 't3_f_writer', '작가'), creators, true],
        ['building', metadataText(t, 't3_f_pub', '출판사'), publisher],
        ['calendar', metadataText(t, 'book_detail_publish_date', '발행일'), publicationDate],
        ['tag', metadataText(t, 't3_f_isbn', 'ISBN'), isbn],
        ['language', metadataText(t, 't3_f_iso', '언어 코드 (ISO)'), language],
        ['star', metadataText(t, 't3_f_rating', '평점'), rating],
    ];

    return (
        <div className="folder-detail-panel">
            {coverAvailable && <div className="folder-detail-bg" style={{ backgroundImage: `url(${selectedFile.cover})` }} />}
            <div className="folder-detail-overlay" />
            <div className="folder-detail-scroll" ref={scrollRef}>
                <div className="folder-detail-content" ref={contentRef}>
                    <div className="detail-cover-section">
                        <div className="detail-cover-stack">
                            {coverAvailable ? (
                                <img
                                    src={selectedFile.cover}
                                    alt={selectedFile.name || ''}
                                    className="detail-cover-image"
                                    onError={() => setImageError(true)}
                                />
                            ) : (
                                <div className="detail-cover-placeholder" title={t('folder_no_cover')}>
                                    <FaIcon name="bookOpen" size={42} />
                                    <span>{t('folder_no_cover')}</span>
                                </div>
                            )}
                            <div className="detail-cover-caption">
                                <div>{fileName || '-'} ({formatSize(selectedFile.size)})</div>
                                <div>{formatDate(selectedFile.created || selectedFile.ctime)}</div>
                                <div>{formatDate(selectedFile.modified || selectedFile.mtime)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="detail-metadata-section">
                        <div className="detail-heading">
                            <div className="detail-series">{series || t('info_no_series')}</div>
                            <div className="detail-title">{title || '-'}</div>
                            <div className="detail-tags" aria-label={tagLabel} title={tagLabel}>
                                {tags.length > 0 ? tags.map(tag => <span key={tag}>{tag}</span>) : <span>-</span>}
                            </div>
                        </div>

                        <div className="detail-info-card">
                            <DetailFieldGroup fields={bookFields} />
                            <section className="detail-extra">
                                <DetailLine icon="fileLines" label={metadataText(t, 't3_f_book_description', '책설명')} value={summary} plain />
                            </section>
                        </div>

                        {duplicates.length > 0 && (
                            <section className="detail-duplicates">
                                <h4>{t('dup_match_found', [duplicates.length])}</h4>
                                {duplicates.map(item => (
                                    <div key={`${item.path}-${item.name}`}>
                                        <span>{item.ratio}%</span>
                                        <strong>{item.name}</strong>
                                        <code>{item.path}</code>
                                    </div>
                                ))}
                            </section>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export { BookDetailPanel };
export default BookDetailPanel;
