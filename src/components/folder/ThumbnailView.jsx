import React from 'react';

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
  selectedFiles = [],
  onSelect,
  t
}) => {
  const handleItemClick = (file, e) => {
    if (!onSelect || !file.path) return;

    if (e.ctrlKey || e.metaKey) {
      onSelect(file.path);
    } else {
      onSelect(file.path);
    }
  };

  return (
    <div className="thumbnail-grid">
      {files.map((file, index) => (
        <div
          key={file.path || index}
          className={`thumbnail-item ${selectedFiles.includes(file.path) ? 'selected' : ''}`}
          onClick={(e) => handleItemClick(file, e)}
        >
          {file.cover ? (
            <img
              src={file.cover}
              alt={file.name || ''}
              className="thumb-image"
              loading="lazy"
            />
          ) : (
            <div className="thumb-image" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              fontSize: '24px'
            }}>
              📄
            </div>
          )}
          <span className="thumb-label">{file.name || '-'}</span>
        </div>
      ))}
      {files.length === 0 && (
        <div className="empty-folder-page" style={{ gridColumn: '1 / -1' }}>
          <div className="empty-icon">📂</div>
          <div className="empty-message">{t('folder.message.noFiles') || '파일이 없습니다'}</div>
        </div>
      )}
    </div>
  );
};

export { ThumbnailView };
export default ThumbnailView;
