import React, { useState, useEffect } from 'react';

/**
 * DetailPanel - 하단 상세 정보 패널
 * Python PyQt6의 DetailBackgroundWidget 포트
 * 
 * 선택된 파일의 커버 이미지와 메타데이터를 표시합니다.
 * 
 * Props:
 *   selectedFile: 선택된 파일 데이터 객체 (null 가능)
 *   t: 번역 함수
 */
const DetailPanel = ({ selectedFile = null, t }) => {
  const [imageError, setImageError] = useState(false);

  // 선택 파일 변경 시 이미지 에러 리셋
  useEffect(() => {
    setImageError(false);
  }, [selectedFile]);

  const handleImageError = () => {
    setImageError(true);
  };

  const metadataFields = [
    { key: 'producer', labelKey: 'col_creators' },
    { key: 'publisher', labelKey: 'col_publisher' },
    { key: 'page_count', labelKey: 'col_page_count' },
    { key: 'total_volume', labelKey: 'col_vol_count' },
    { key: 'format', labelKey: 'col_format' },
    { key: 'rating', labelKey: 'col_rating' },
    { key: 'age_rating', labelKey: 'col_age_rating' },
    { key: 'date', labelKey: 'col_pub_date' },
  ];

  // 파일 크기 포맷팅
  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Number(bytes);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  };

  // 값 포맷팅
  const formatValue = (key, value) => {
    if (key === 'size' && typeof value === 'number') {
      return formatSize(value);
    }
    return value || '-';
  };

  // 선택된 파일이 없는 경우
  if (!selectedFile) {
    return (
      <div className="folder-detail-panel empty">
        <div className="detail-empty-state">
          {t('folder.detail.no_selection') || '파일을 선택하세요'}
        </div>
      </div>
    );
  }

  const bgStyle = selectedFile.cover && !imageError ? { backgroundImage: `url(${selectedFile.cover})` } : {};
  const title = selectedFile.title || selectedFile.name || '-';
  const series = selectedFile.series || t('info_no_series');
  const volume = selectedFile.volume ? `${selectedFile.volume}권` : '';
  const tags = [selectedFile.genre, selectedFile.format, selectedFile.publisher].filter(Boolean).flatMap(value => String(value).split(/[;,]/)).slice(0, 6);

  return (
    <div className="folder-detail-panel">
      <div className="folder-detail-bg" style={bgStyle}></div>
      <div className="folder-detail-overlay"></div>
      
      <div className="folder-detail-content">
        <div className="detail-cover-section">
          {selectedFile.cover && !imageError ? (
            <img
              src={selectedFile.cover}
              alt={selectedFile.name || ''}
              className="detail-cover-image"
              onError={handleImageError}
            />
          ) : (
            <div className="detail-cover-placeholder">
              <div className="placeholder-icon">▧</div>
            </div>
          )}
        </div>

        <div className="detail-metadata-section">
          <div className="detail-heading">
            <div className="detail-series">{series}</div>
            <div className="detail-title">{title} {volume}</div>
            <div className="detail-tags">
              {tags.length > 0 ? tags.map(tag => <span key={tag}>{tag}</span>) : <span>-</span>}
            </div>
          </div>

          <div className="detail-info-card">
            <div className="metadata-grid">
              {metadataFields.map((field) => (
                <React.Fragment key={field.key}>
                  <div className="metadata-label">{t(field.labelKey)}</div>
                  <div className="metadata-value" title={String(formatValue(field.key, selectedFile[field.key]))}>
                    {formatValue(field.key, selectedFile[field.key])}
                  </div>
                </React.Fragment>
              ))}
            </div>
            <div className="detail-extra">
              <div className="detail-extra-title">{t('meta_summary')}</div>
              <p>{selectedFile.description || t('info_no_summary')}</p>
              <dl>
                <dt>{t('info_arc_team_loc')}</dt>
                <dd>- / - / -</dd>
                <dt>{t('col_characters')}</dt>
                <dd>-</dd>
                <dt>{t('col_web')}</dt>
                <dd>{selectedFile.link || '-'}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export { DetailPanel };
export default DetailPanel;
