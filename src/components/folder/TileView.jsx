import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { groupFolderFiles } from '../../folderViewState';
import { FolderEmptyState } from './FolderEmptyState';

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
	  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
  const items = files.length > 0 ? files : fileData;
  const imageWidth = Math.round(72 + Number(scale || 50) * 0.58);
  const imageHeight = Math.round(imageWidth * 1.32);
  const minColumnWidth = Math.max(260, imageWidth + Math.round(180 + Number(scale || 50) * 1.4));
	  const groups = groupFolderFiles(items, groupKey, sortKey, sortOrder);
	  const gap = 16;
	  const padding = 16;
	  const rowHeight = imageHeight + 12 + gap;
	  const shouldVirtualize = groupKey === 'none' && groups.length === 1 && items.length > 1000;
	  const columnCount = shouldVirtualize
	    ? Math.max(1, Math.floor((Math.max(0, viewport.width - (padding * 2)) + gap) / (minColumnWidth + gap)))
	    : 1;
	  const columnWidth = shouldVirtualize
	    ? Math.max(minColumnWidth, (Math.max(0, viewport.width - (padding * 2) - ((columnCount - 1) * gap)) / columnCount))
	    : minColumnWidth;
	  const totalRows = shouldVirtualize ? Math.ceil(groups[0].files.length / columnCount) : 0;
	  const bufferRows = 3;
	  const startRow = shouldVirtualize ? Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - bufferRows) : 0;
	  const endRow = shouldVirtualize
	    ? Math.min(totalRows, Math.ceil((viewport.scrollTop + (viewport.height || 600)) / rowHeight) + bufferRows)
	    : 0;
	  const virtualStartIndex = startRow * columnCount;
	  const virtualEndIndex = shouldVirtualize ? Math.min(groups[0].files.length, endRow * columnCount) : 0;
	  const virtualFiles = shouldVirtualize ? groups[0].files.slice(virtualStartIndex, virtualEndIndex) : [];
	  const fileIndexByPath = useMemo(() => {
	    const map = new Map();
	    groups.flatMap(group => group.files).forEach((file, index) => {
	      if (file.path) map.set(file.path, index);
	    });
	    return map;
	  }, [groups]);

	  useEffect(() => {
	    const container = containerRef.current;
	    if (!container) return undefined;
	    const updateViewport = () => {
	      setViewport(current => ({
	        ...current,
	        width: Math.max(0, Math.round(container.clientWidth || 0)),
	        height: Math.max(0, Math.round(container.clientHeight || 0)),
	        scrollTop: container.scrollTop || 0,
	      }));
	    };
	    updateViewport();
	    if (typeof ResizeObserver !== 'function') {
	      window.addEventListener('resize', updateViewport);
	      return () => window.removeEventListener('resize', updateViewport);
	    }
	    const observer = new ResizeObserver(updateViewport);
	    observer.observe(container);
	    return () => observer.disconnect();
	  }, []);

	  const handleGridScroll = event => {
	    const nextScrollTop = event.currentTarget.scrollTop || 0;
	    setViewport(current => current.scrollTop === nextScrollTop ? current : {
	      ...current,
	      scrollTop: nextScrollTop,
	    });
	    onScroll?.(event);
	  };
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
  const firstValue = (...values) => values.find(value => String(value || '').trim()) || '';
  const compactValues = values => values
    .map(value => String(value || '').trim())
    .filter(Boolean);

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
	      className={`tile-grid ${shouldVirtualize ? 'is-virtualized' : ''}`}
	      onScroll={handleGridScroll}
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
        '--tile-image-width': `${imageWidth}px`,
        '--tile-image-height': `${imageHeight}px`,
        '--tile-min-column-width': `${minColumnWidth}px`,
      }}
    >
      {shouldVirtualize ? (
        <div
          className="folder-virtual-grid-spacer"
          style={{ height: `${Math.max(1, totalRows * rowHeight)}px` }}
        >
          {virtualFiles.map((file, relativeIndex) => {
            const fileIndex = virtualStartIndex + relativeIndex;
            const row = Math.floor(fileIndex / columnCount);
            const column = fileIndex % columnCount;
            return (
	            <div
	              key={file.path || fileIndex}
	              data-file-path={file.path}
	              className={`tile-item ${selectedFiles.includes(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              style={{
	                position: 'absolute',
	                left: `${padding + column * (columnWidth + gap)}px`,
	                top: `${padding + row * rowHeight}px`,
	                width: `${columnWidth}px`,
	              }}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
	              onMouseEnter={(event) => handleItemMouseEnter(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <CoverImage
                src={file.cover}
                alt={file.name || ''}
                className="tile-image"
                t={t}
                iconSize={30}
              />
              <div className="tile-info">
                <div className="tile-title">{file.title || file.name || '-'}</div>
                <div className="tile-meta-line">
                  {compactValues([
                    firstValue(file.writer, file.author, file.creators),
                    file.publisher,
                    file.genre,
                  ]).join(' · ') || '-'}
                </div>
                <div className="tile-meta-line">
                  {compactValues([
                    file.page_count ? `${file.page_count}p` : '',
                  ]).join('  ·  ') || '-'}
                  {file.rating && (
                    <>
                      <span className="tile-meta-separator"> · </span>
                      <FaIcon name="star" className="tile-rating-star" size={10} /> {file.rating}
                    </>
                  )}
                </div>
                <div className="tile-summary">
                  {firstValue(file.description, file.summary, t('info_no_summary'))}
                </div>
	              </div>
	            </div>
            );
          })}
        </div>
      ) : groups.map(group => (
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
	              className={`tile-item ${selectedFiles.includes(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
	              onMouseEnter={(event) => handleItemMouseEnter(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <CoverImage
                src={file.cover}
                alt={file.name || ''}
                className="tile-image"
                t={t}
                iconSize={30}
              />
              <div className="tile-info">
                <div className="tile-title">{file.title || file.name || '-'}</div>
                <div className="tile-meta-line">
                  {compactValues([
                    firstValue(file.writer, file.author, file.creators),
                    file.publisher,
                    file.genre,
                  ]).join(' · ') || '-'}
                </div>
                <div className="tile-meta-line">
                  {compactValues([
                    file.page_count ? `${file.page_count}p` : '',
                  ]).join('  ·  ') || '-'}
                  {file.rating && (
                    <>
                      <span className="tile-meta-separator"> · </span>
                      <FaIcon name="star" className="tile-rating-star" size={10} /> {file.rating}
                    </>
                  )}
                </div>
                <div className="tile-summary">
                  {firstValue(file.description, file.summary, t('info_no_summary'))}
                </div>
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

export { TileView };
export default TileView;
