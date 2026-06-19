import React from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { groupFolderFiles } from '../../folderViewState';

/**
 * ThumbnailView - 썸네일 그리드 뷰 컴포넌트
 * Python QListView (IconMode) -> React 포트
 * 
 * @param {Object} props
 * @param {string[]} props.files - 파일 데이터 배열
 * @param {string[]} props.selectedFiles - 선택된 파일 경로 배열
 * @param {Function} props.onSelect - 선택 핸들러
 * @param {Object} props.t - 번역 함수
 */
const ThumbnailView = ({
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
  const itemWidth = Math.round(82 + Number(scale || 50) * 0.68);
  const imageWidth = Math.round(72 + Number(scale || 50) * 0.52);
  const imageHeight = Math.round(imageWidth * 1.34);
  const groups = groupFolderFiles(items, groupKey, sortKey, sortOrder);

  const handleItemClick = (file, e, index) => {
    if (!onSelect || !file.path) return;

    onSelect(file.path, e, index);
  };

  return (
    <div
      className="thumbnail-grid"
      onScroll={onScroll}
      style={{
        '--thumb-item-width': `${itemWidth}px`,
        '--thumb-image-width': `${imageWidth}px`,
        '--thumb-image-height': `${imageHeight}px`,
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
              className={`thumbnail-item ${selectedFiles.includes(file.path) ? 'selected' : ''}`}
              onClick={(e) => handleItemClick(file, e, index)}
              onContextMenu={(event) => onContextMenu?.(event, file, index)}
            >
              <CoverImage
                src={file.cover}
                alt={file.name || ''}
                className="thumb-image"
                t={t}
                iconSize={24}
              />
              <span className="thumb-label">{file.name || '-'}</span>
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

export { ThumbnailView };
export default ThumbnailView;
