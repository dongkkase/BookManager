import React from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { groupFolderFiles } from '../../folderViewState';

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
  onScroll,
  sortKey = 'name',
  sortOrder = 'asc',
  groupKey = 'none',
  scale = 50,
  t
}) => {
  const items = files.length > 0 ? files : fileData;
  const imageWidth = Math.round(72 + Number(scale || 50) * 0.58);
  const imageHeight = Math.round(imageWidth * 1.32);
  const minColumnWidth = Math.round(280 + Number(scale || 50) * 2.1);
  const groups = groupFolderFiles(items, groupKey, sortKey, sortOrder);
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
      onScroll={onScroll}
      style={{
        '--tile-image-width': `${imageWidth}px`,
        '--tile-image-height': `${imageHeight}px`,
        '--tile-min-column-width': `${minColumnWidth}px`,
      }}
    >
      {groups.map(group => (
        <React.Fragment key={group.name || 'all'}>
          {group.name && (
            <div className="folder-view-group-header">
              <FaIcon name="folder" />
              {t('group_header', [group.name, group.files.length])}
            </div>
          )}
          {group.files.map((file, index) => (
            <div
              key={file.path || index}
              className={`tile-item ${selectedFiles.includes(file.path) ? 'selected' : ''}`}
              onClick={(e) => handleItemClick(file, e, index)}
              onContextMenu={(event) => onContextMenu?.(event, file, index)}
            >
              <CoverImage
                src={file.cover}
                alt={file.name || ''}
                className="tile-image"
                t={t}
                iconSize={30}
              />
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
        </React.Fragment>
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
