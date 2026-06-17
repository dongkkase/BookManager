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

  // 메타데이터 필드 정의
  const metadataFields = [
    { key: 'name', labelKey: 'folder.columns.name' },
    { key: 'series', labelKey: 'folder.columns.series' },
    { key: 'title', labelKey: 'folder.columns.title' },
    { key: 'volume', labelKey: 'folder.columns.volume' },
    { key: 'issue', labelKey: 'folder.columns.issue' },
    { key: 'writer', labelKey: 'folder.columns.writer' },
    { key: 'size', labelKey: 'folder.columns.size' },
    { key: 'modified', labelKey: 'folder.columns.modified' },
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

  return (
    <div className="folder-detail-panel">
      <div className="folder-detail-bg" style={bgStyle}></div>
      <div className="folder-detail-overlay"></div>
      
      <div className="folder-detail-content">
        {/* 좌측: 커버 이미지 */}
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
              <div className="placeholder-icon">📄</div>
              <div className="placeholder-text">No Cover</div>
            </div>
          )}
        </div>

        {/* 우측: 메타데이터 그리드 */}
        <div className="detail-metadata-section">
          <div className="metadata-grid">
            {metadataFields.map((field) => (
              <React.Fragment key={field.key}>
                <div className="metadata-label">
                  {t(field.labelKey) || field.key}
                </div>
                <div className="metadata-value" title={String(formatValue(field.key, selectedFile[field.key]))}>
                  {formatValue(field.key, selectedFile[field.key])}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export { DetailPanel };
export default DetailPanel;
