import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
    duplicateDetailRows,
    splitMetadataValues,
} from '../../detailPanelState';
import {
    DetailCoverFrame,
    DetailFieldGroup,
    DetailLine,
    DetailPanelStatusBadges,
    detailMetadataValue,
    detailPublicationDate,
    formatDate,
    formatSize,
    useDetailContentHeight,
} from './detailPanelCommon';

function metadataText(t, key, fallback) {
    const translated = t?.(key);
    return translated && translated !== key ? translated : fallback;
}

const BookDetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
    const [imageError, setImageError] = useState(false);
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);

    useEffect(() => {
        setImageError(false);
    }, [selectedFile?.path]);

    const tags = useMemo(
        () => splitMetadataValues(
            detailMetadataValue(selectedFile, 'genre', 'Genre'),
            detailMetadataValue(selectedFile, 'tags', 'Tags'),
        ),
        [selectedFile],
    );
    const duplicates = useMemo(() => duplicateDetailRows(selectedFile || {}), [selectedFile]);

    if (!selectedFile) {
        return <div className="folder-detail-panel empty"><div className="detail-empty-state">-</div></div>;
    }

    const coverAvailable = selectedFile.cover && !imageError;
    const fileName = selectedFile.name || String(selectedFile.path || selectedFile.full_path || '').split(/[\\/]/).pop();
    const title = detailMetadataValue(selectedFile, 'title', 'Title') || selectedFile.name;
    const series = detailMetadataValue(selectedFile, 'series', 'Series');
    const volume = detailMetadataValue(selectedFile, 'volume', 'Volume');
    const creators = splitMetadataValues(
        detailMetadataValue(selectedFile, 'writer', 'Writer'),
        detailMetadataValue(selectedFile, 'author', 'Author'),
        detailMetadataValue(selectedFile, 'creators'),
        detailMetadataValue(selectedFile, 'producer'),
    ).join(', ');
    const publicationDate = detailPublicationDate(selectedFile);
    const publisher = detailMetadataValue(selectedFile, 'publisher', 'Publisher');
    const isbn = detailMetadataValue(selectedFile, 'isbn', 'ISBN');
    const language = detailMetadataValue(selectedFile, 'language', 'LanguageISO');
    const rating = detailMetadataValue(selectedFile, 'rating', 'CommunityRating');
    const summary = detailMetadataValue(selectedFile, 'description', 'summary', 'Summary');
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
            <DetailPanelStatusBadges selectedFile={selectedFile} t={t} />
            <div className="folder-detail-scroll" ref={scrollRef}>
                <div className="folder-detail-content" ref={contentRef}>
                    <div className="detail-cover-section">
                        <div className="detail-cover-stack">
                            <DetailCoverFrame>
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
                            </DetailCoverFrame>
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
