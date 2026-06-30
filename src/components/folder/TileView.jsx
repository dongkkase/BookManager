import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage, coverImageKey } from './CoverImage';
import {
  buildVirtualGridLayout,
  groupFolderFiles,
  shouldVirtualizeFolderItems,
  visibleVirtualRows,
} from '../../folderViewState';
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
  groupedData: groupedDataProp,
  selectedFiles = [],
  selectedFileSet,
  activeSelectedPath = '',
  onSelect,
  onOpenFile,
  onDragSelect,
  onContextMenu,
  onScroll,
  onClearSelection,
  onVisibleFilesChange,
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
  const groups = useMemo(
    () => Array.isArray(groupedDataProp)
      ? groupedDataProp
      : groupFolderFiles(items, groupKey, sortKey, sortOrder),
    [groupedDataProp, groupKey, items, sortKey, sortOrder],
  );
  const selectedFileLookup = useMemo(
    () => selectedFileSet instanceof Set ? selectedFileSet : new Set(selectedFiles),
    [selectedFileSet, selectedFiles],
  );
	  const gap = 16;
	  const padding = 16;
	  const rowHeight = imageHeight + 12 + gap;
	  const shouldVirtualize = shouldVirtualizeFolderItems(groups);
	  const columnCount = Math.max(1, Math.floor((Math.max(0, viewport.width - (padding * 2)) + gap) / (minColumnWidth + gap)));
	  const columnWidth = Math.max(minColumnWidth, (Math.max(0, viewport.width - (padding * 2) - ((columnCount - 1) * gap)) / columnCount));
    const virtualLayout = useMemo(() => shouldVirtualize
        ? buildVirtualGridLayout(groups, {
            columnCount,
            rowHeight,
            columnWidth,
            horizontalGap: gap,
            padding,
            headerHeight: 36,
            itemWidth: columnWidth,
        })
        : { rows: [], height: 1 },
    [columnCount, columnWidth, gap, groups, padding, rowHeight, shouldVirtualize]);
    const virtualRows = useMemo(() => shouldVirtualize
        ? visibleVirtualRows(virtualLayout.rows, viewport.scrollTop, viewport.height, rowHeight * 3)
        : [],
    [rowHeight, shouldVirtualize, viewport.height, viewport.scrollTop, virtualLayout.rows]);
	  const fileIndexByPath = useMemo(() => {
	    const map = new Map();
	    groups.flatMap(group => group.files).forEach((file, index) => {
	      if (file.path) map.set(file.path, index);
	    });
	    return map;
	  }, [groups]);
    const flatItems = useMemo(() => groups.flatMap(group => group.files), [groups]);
    const visibleCoverItems = useMemo(() => {
        if (shouldVirtualize) return virtualRows
            .filter(row => row.type === 'file')
            .map(row => row.file);
        if (flatItems.length === 0) return [];
        const firstRow = Math.max(0, Math.floor((viewport.scrollTop || 0) / rowHeight) - 2);
        const rowCount = Math.ceil((viewport.height || 600) / rowHeight) + 4;
        return flatItems.slice(firstRow * columnCount, (firstRow + rowCount) * columnCount);
    }, [columnCount, flatItems, rowHeight, shouldVirtualize, viewport.height, viewport.scrollTop, virtualRows]);

    useEffect(() => {
        onVisibleFilesChange?.(visibleCoverItems);
    }, [onVisibleFilesChange, visibleCoverItems]);
    const visibleCoverPathSet = useMemo(
        () => new Set(visibleCoverItems.map(file => file.path).filter(Boolean)),
        [visibleCoverItems],
    );

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

      const handleItemDoubleClick = (file, event, index) => {
        if (!file?.path || dragSelectRef.current.moved || rubberSelectRef.current.moved) return;
        event.preventDefault();
        onOpenFile?.(file, event, index);
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
          style={{ height: `${virtualLayout.height}px` }}
        >
          {virtualRows.map(row => {
            if (row.type === 'group') {
              return (
                <div
                  key={row.key}
                  className="folder-view-group-header"
                  style={{
                    position: 'absolute',
                    left: `${padding}px`,
                    top: `${row.top}px`,
                    width: `calc(100% - ${padding * 2}px)`,
                    minWidth: 0,
                  }}
                >
                  <FaIcon name="folder" />
                  {t('group_header', [row.group.name, row.group.files.length])}
                </div>
              );
            }
            const file = row.file;
            const fileIndex = row.fileIndex;
            return (
	            <div
	              key={file.path || fileIndex}
	              data-file-path={file.path}
                  className={`tile-item ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              style={{
	                position: 'absolute',
	                left: `${row.left}px`,
	                top: `${row.top}px`,
	                width: `${row.width}px`,
	              }}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
	              onMouseEnter={(event) => handleItemMouseEnter(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleItemDoubleClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <div className="tile-cover-card">
                <CoverImage
                  key={coverImageKey(file)}
                  src={file.cover}
                  alt={file.name || ''}
                  className="tile-image"
                  t={t}
                  iconSize={30}
                  showLoadingIndicator={visibleCoverPathSet.has(file.path)}
                />
              </div>
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
                  className={`tile-item ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
	              onMouseEnter={(event) => handleItemMouseEnter(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleItemDoubleClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <div className="tile-cover-card">
                <CoverImage
                  key={coverImageKey(file)}
                  src={file.cover}
                  alt={file.name || ''}
                  className="tile-image"
                  t={t}
                  iconSize={30}
                  showLoadingIndicator={visibleCoverPathSet.has(file.path)}
                />
              </div>
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
