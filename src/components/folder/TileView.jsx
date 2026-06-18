import React from 'react';
import { FaIcon } from '../FaIcon';

/**
 * TileView - 타일 뷰 컴포넌트
 * Python QListView (TileMode) -> React 포트
 * 
 * @param {Object} props
 * @param {string[]} props.files - 파일 데이터 배열
 * @param {string[]} props.selectedFiles - 선택된 파일 경로 배열
 * @param {Function} props.onSelect - 선택 핸들러
 * @param {Object} props.t - 번역 함수
 */
const TileView = ({
  files = [],
  fileData = [],
  selectedFiles = [],
  onSelect,
  onContextMenu,
  scale = 50,
  t
}) => {
  const items = files.length > 0 ? files : fileData;
  const imageWidth = Math.round(72 + Number(scale || 50) * 0.58);
  const imageHeight = Math.round(imageWidth * 1.32);
  const minColumnWidth = Math.round(280 + Number(scale || 50) * 2.1);
  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const handleItemClick = (file, e, index) => {
    if (!onSelect || !file.path) return;

    onSelect(file.path, e, index);
  };

  return (
    <div
      className="tile-grid"
      style={{
        '--tile-image-width': `${imageWidth}px`,
        '--tile-image-height': `${imageHeight}px`,
        '--tile-min-column-width': `${minColumnWidth}px`,
      }}
    >
      {items.map((file, index) => (
        <div
          key={file.path || index}
          className={`tile-item ${selectedFiles.includes(file.path) ? 'selected' : ''}`}
          onClick={(e) => handleItemClick(file, e, index)}
          onContextMenu={(event) => onContextMenu?.(event, file, index)}
        >
          {file.cover ? (
            <img
              src={file.cover}
              alt={file.name || ''}
              className="tile-image"
              loading="lazy"
            />
          ) : (
            <div className="tile-image" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              fontSize: '32px'
            }}>
              <FaIcon name="file" size={30} />
            </div>
          )}
          <div className="tile-info">
            <div className="tile-title">{file.name || '-'}</div>
            <div className="tile-meta">
              {file.series && <span>{file.series}</span>}
              {file.volume && <span> | Vol.{file.volume}</span>}
              <span> | {formatSize(file.size)}</span>
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="empty-folder-page" style={{ gridColumn: '1 / -1' }}>
          <div className="empty-icon"><FaIcon name="folder" size={32} /></div>
          <div className="empty-message">{t('folder.message.noFiles') || '파일이 없습니다'}</div>
        </div>
      )}
    </div>
  );
};

export { TileView };
export default TileView;
