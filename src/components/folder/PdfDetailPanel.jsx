import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
    duplicateDetailRows,
    splitMetadataValues,
} from '../../detailPanelState';
import {
    DetailFieldGroup,
    DetailLine,
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

const PdfDetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
    const [imageError, setImageError] = useState(false);
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);

    useEffect(() => {
        setImageError(false);
    }, [selectedFile?.path]);

    const keywords = useMemo(
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
    const author = detailMetadataValue(selectedFile, 'writer', 'author', 'Writer');
    const summary = detailMetadataValue(selectedFile, 'description', 'summary', 'Summary');
    const publisher = detailMetadataValue(selectedFile, 'publisher', 'Publisher');
    const isbn = detailMetadataValue(selectedFile, 'isbn', 'ISBN');
    const language = detailMetadataValue(selectedFile, 'language', 'LanguageISO');
    const rating = detailMetadataValue(selectedFile, 'rating', 'CommunityRating');
    const creator = detailMetadataValue(selectedFile, 'creator', 'Creator');
    const producer = detailMetadataValue(selectedFile, 'producer', 'Producer');
    const trapped = detailMetadataValue(selectedFile, 'trapped', 'Trapped');
    const pdfVersion = detailMetadataValue(selectedFile, 'pdf_version', 'PdfVersion');
    const publicationDate = detailPublicationDate(selectedFile);
    const keywordLabel = metadataText(t, 'pdf_f_keywords', '키워드');
    const pdfFields = [
        ['user', metadataText(t, 't3_f_writer', '저자'), author, true],
        ['building', metadataText(t, 't3_f_pub', '출판사'), publisher],
        ['calendar', metadataText(t, 'book_detail_publish_date', '발행일'), publicationDate],
        ['tag', metadataText(t, 't3_f_isbn', 'ISBN'), isbn],
        ['language', metadataText(t, 't3_f_iso', '언어 코드 (ISO)'), language],
        ['star', metadataText(t, 't3_f_rating', '평점'), rating],
        ['fileSignature', metadataText(t, 'pdf_f_version', 'PDF 버전'), pdfVersion],
        ['cube', metadataText(t, 'pdf_f_creator_tool', '생성 도구'), creator],
        ['gear', metadataText(t, 'pdf_f_producer', 'PDF 생성기'), producer],
        ['check', metadataText(t, 'pdf_f_trapped', '트래핑'), trapped],
    ];

    return (
        <div className="folder-detail-panel pdf-detail-panel">
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
                                    <FaIcon name="fileSignature" size={42} />
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
                            <div className="detail-series">{author || '-'}</div>
                            <div className="detail-title">{title || '-'}</div>
                            <div className="detail-tags" aria-label={keywordLabel} title={keywordLabel}>
                                {keywords.length > 0 ? keywords.map(keyword => <span key={keyword}>{keyword}</span>) : <span>-</span>}
                            </div>
                        </div>

                        <div className="detail-info-card">
                            <DetailFieldGroup fields={pdfFields} />
                            <section className="detail-extra">
                                <DetailLine icon="fileLines" label={metadataText(t, 'pdf_f_subject_description', '주제/설명')} value={summary} plain />
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

export { PdfDetailPanel };
export default PdfDetailPanel;
