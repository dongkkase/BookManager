import React, { useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { groupFolderFiles } from '../../folderViewState';
import { FolderEmptyState } from './FolderEmptyState';

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
  activeSelectedPath = '',
  onSelect,
  onDragSelect,
  onContextMenu,
  onScroll,
  onClearSelection,
  sortKey = 'name',
  sortOrder = 'asc',
  groupKey = 'none',
  scale = 50,
  t
	}) => {
	  const dragSelectRef = useRef({ active: false, moved: false });
	  const containerRef = useRef(null);
	  const rubberSelectRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
	  const [selectionBox, setSelectionBox] = useState(null);
	  const items = files.length > 0 ? files : fileData;
  const imageWidth = Math.round(72 + Number(scale || 50) * 1.08);
  const itemWidth = imageWidth + 24;
  const imageHeight = Math.round(imageWidth * 1.42);
	  const groups = groupFolderFiles(items, groupKey, sortKey, sortOrder);
	  const fileIndexByPath = useMemo(() => {
	    const map = new Map();
	    groups.flatMap(group => group.files).forEach((file, index) => {
	      if (file.path) map.set(file.path, index);
	    });
	    return map;
	  }, [groups]);

	  const handleItemClick = (file, e, index) => {
	    if (dragSelectRef.current.moved || rubberSelectRef.current.moved) {
	      dragSelectRef.current.moved = false;
	      rubberSelectRef.current.moved = false;
	      return;
	    }
	    if (e.detail > 0) return;
	    if (!onSelect || !file.path) return;

	    onSelect(file.path, e, index);
	  };

	  const handleItemMouseDown = (file, event, index) => {
	    if (event.button !== 0 || !onSelect || !file.path) return;
	    dragSelectRef.current = { active: true, moved: false };
	    onSelect(file.path, event, index);
	  };

	  const handleItemMouseEnter = (file, event, index) => {
	    if (!dragSelectRef.current.active || !onSelect || !file.path) return;
	    dragSelectRef.current.moved = true;
	    onSelect(file.path, { ...event, shiftKey: true }, index);
	  };

	  const stopDragSelect = () => {
	    dragSelectRef.current.active = false;
	  };

	  const updateRubberSelection = (event) => {
	    const state = rubberSelectRef.current;
	    const container = containerRef.current;
	    if (!state.active || !container) return;
	    const rect = container.getBoundingClientRect();
	    const left = Math.min(state.startX, event.clientX);
	    const top = Math.min(state.startY, event.clientY);
	    const right = Math.max(state.startX, event.clientX);
	    const bottom = Math.max(state.startY, event.clientY);
	    const moved = Math.abs(event.clientX - state.startX) > 3 || Math.abs(event.clientY - state.startY) > 3;
	    rubberSelectRef.current.moved = moved;
	    if (!moved) return;
	    setSelectionBox({
	      left: left - rect.left + container.scrollLeft,
	      top: top - rect.top + container.scrollTop,
	      width: right - left,
	      height: bottom - top,
	    });
	    const selected = Array.from(container.querySelectorAll('[data-file-path]'))
	      .filter(element => {
	        const itemRect = element.getBoundingClientRect();
	        return itemRect.right >= left
	          && itemRect.left <= right
	          && itemRect.bottom >= top
	          && itemRect.top <= bottom;
	      })
	      .map(element => element.dataset.filePath)
	      .filter(Boolean);
	    onDragSelect?.(selected);
	  };

  const displayRating = file => (
    file.rating
    || file.score
    || file.metadata?.rating
    || file.full_meta?.rating
    || ''
  );

  const displayPages = file => (
    file.page_count
    || file.pages
    || file.metadata?.page_count
    || file.full_meta?.page_count
    || ''
  );

	  const startRubberSelection = (event) => {
	    if (event.button !== 0) return;
	    rubberSelectRef.current = {
	      active: true,
	      moved: false,
	      startX: event.clientX,
	      startY: event.clientY,
	    };
	    setSelectionBox(null);
	  };

	  const stopRubberSelection = () => {
	    rubberSelectRef.current.active = false;
	    setSelectionBox(null);
	  };

  return (
	    <div
	      ref={containerRef}
	      className="thumbnail-grid"
	      onScroll={onScroll}
	      onClick={event => {
	        if (rubberSelectRef.current.moved) {
	          rubberSelectRef.current.moved = false;
	          return;
	        }
	        if (event.target === event.currentTarget) onClearSelection?.();
	      }}
	      onMouseDown={startRubberSelection}
	      onMouseMove={updateRubberSelection}
	      onMouseLeave={() => {
	        stopDragSelect();
	        stopRubberSelection();
	      }}
	      onMouseUp={() => {
	        stopDragSelect();
	        stopRubberSelection();
	      }}
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
	          {group.files.map((file, index) => {
	            const fileIndex = fileIndexByPath.get(file.path) ?? index;
	            return (
	            <div
	              key={file.path || index}
	              data-file-path={file.path}
	              className={`thumbnail-item ${selectedFiles.includes(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
	              onMouseEnter={(event) => handleItemMouseEnter(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <div className="thumbnail-cover-card">
                <CoverImage
                  src={file.cover}
                  alt={file.name || ''}
                  className="thumb-image"
                  t={t}
                  iconSize={24}
                />
                {displayRating(file) && (
                  <span className="thumbnail-rating-badge">★ {displayRating(file)}</span>
                )}
                {displayPages(file) && (
                  <span className="thumbnail-page-badge">{displayPages(file)}p</span>
                )}
                <span className="thumb-label">{file.name || '-'}</span>
              </div>
	            </div>
	            );
	          })}
        </React.Fragment>
      ))}
	      {items.length === 0 && (
	        <FolderEmptyState t={t} />
	      )}
	      {selectionBox && (
	        <div
	          className="folder-drag-selection-box"
	          style={{
	            left: `${selectionBox.left}px`,
	            top: `${selectionBox.top}px`,
	            width: `${selectionBox.width}px`,
	            height: `${selectionBox.height}px`,
	          }}
	        />
	      )}
	    </div>
  );
};

export { ThumbnailView };
export default ThumbnailView;
