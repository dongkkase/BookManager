import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../FaIcon';
import {
    duplicateDetailRows,
    splitMetadataValues,
    visibleDetailTags,
} from '../../detailPanelState';
import {
    DetailFieldGroup,
    DetailLine,
    detailPublicationDate,
    formatDate,
    formatSize,
    useDetailContentHeight,
} from './detailPanelCommon';

const ComicDetailPanel = ({ selectedFile = null, onContentHeightChange, t }) => {
    const [imageError, setImageError] = useState(false);
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);

    useEffect(() => {
        setImageError(false);
    }, [selectedFile?.path]);

    const tags = useMemo(
        () => visibleDetailTags(selectedFile || {}, []),
        [selectedFile],
    );
    const duplicates = useMemo(() => duplicateDetailRows(selectedFile || {}), [selectedFile]);

    if (!selectedFile) {
        return <div className="folder-detail-panel empty"><div className="detail-empty-state">-</div></div>;
    }

    const coverAvailable = selectedFile.cover && !imageError;
    const creators = splitMetadataValues(
        selectedFile.writer,
        selectedFile.penciller,
        selectedFile.inker,
        selectedFile.colorist,
        selectedFile.letterer,
        selectedFile.cover_artist,
    ).join(', ');
    const leftFields = [
        ['user', t('col_creators'), creators, true],
        ['building', t('col_publisher'), selectedFile.publisher],
        ['fileLines', t('col_page_count'), selectedFile.page_count],
        ['bookOpen', t('col_vol_count'), selectedFile.total_volume],
        ['archive', `${t('col_format')} / ${t('col_manga')}`, [selectedFile.format, selectedFile.manga].filter(Boolean).join(' / ')],
        ['star', t('col_rating'), selectedFile.rating],
        ['child', t('col_age_rating'), selectedFile.age_rating],
        ['calendar', t('col_pub_date'), detailPublicationDate(selectedFile)],
        ['link', t('col_web'), selectedFile.link, false, 'link'],
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
                                    <FaIcon name="file" size={42} />
                                    <span>{t('folder_no_cover')}</span>
                                </div>
                            )}
                            <div className="detail-cover-caption">
                                <div>{t('col_res')}: {selectedFile.resolution || '-'}, ({formatSize(selectedFile.size)})</div>
                                <div>{formatDate(selectedFile.created || selectedFile.ctime)}</div>
                                <div>{formatDate(selectedFile.modified || selectedFile.mtime)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="detail-metadata-section">
                        <div className="detail-heading">
                            <div className="detail-series">{selectedFile.series || t('info_no_series')}</div>
                            <div className="detail-title">{selectedFile.title || selectedFile.name || '-'}</div>
                            <div className="detail-tags">
                                {tags.length > 0 ? tags.map(tag => <span key={tag}>{tag}</span>) : <span>-</span>}
                            </div>
                        </div>

                        <div className="detail-info-card">
                            <DetailFieldGroup fields={leftFields} />
                            <section className="detail-extra">
                                <DetailLine icon="fileLines" label={t('col_summary')} value={selectedFile.description || t('info_no_summary')} plain />
                                <DetailLine icon="users" label={t('col_characters')} value={selectedFile.characters} inline />
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

export { ComicDetailPanel };
export default ComicDetailPanel;
