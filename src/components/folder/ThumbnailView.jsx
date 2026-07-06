import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage, coverImageKey } from './CoverImage';
import {
  buildVirtualGridLayout,
  groupFolderFiles,
  shouldVirtualizeFolderItems,
  visibleVirtualRows,
} from '../../folderViewState';
import { useRafRubberSelection } from '../../hooks/useRafRubberSelection';
import {
  applyImmediateSingleSelection,
  isPlainPrimaryClick,
} from '../../selectionVisualFeedback';
import { FolderEmptyState } from './FolderEmptyState';
import { ViewerStatusBadgeRow } from './ViewerStatusBadges';

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
	  const containerRef = useRef(null);
	  const rubberSelectRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
      const selectionBoxRef = useRef(null);
	  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
	  const items = files.length > 0 ? files : fileData;
  const imageWidth = Math.round(72 + Number(scale || 50) * 1.08);
  const itemWidth = imageWidth + 24;
  const imageHeight = Math.round(imageWidth * 1.42);
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
	  const gapX = 18;
	  const gapY = 16;
	  const padding = 10;
	  const rowHeight = imageHeight + 10 + gapY;
	  const shouldVirtualize = shouldVirtualizeFolderItems(groups);
	  const columnCount = Math.max(1, Math.floor((Math.max(0, viewport.width - (padding * 2)) + gapX) / (itemWidth + gapX)));
    const virtualLayout = useMemo(() => shouldVirtualize
        ? buildVirtualGridLayout(groups, {
            columnCount,
            rowHeight,
            columnWidth: itemWidth,
            horizontalGap: gapX,
            padding,
            headerHeight: 36,
            itemWidth,
        })
        : { rows: [], height: 1 },
    [columnCount, gapX, groups, itemWidth, padding, rowHeight, shouldVirtualize]);
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

	  const handleItemClick = (file, e, index) => {
	    if (rubberSelectRef.current.moved) {
	      rubberSelectRef.current.moved = false;
	      return;
	    }
	    if (e.detail > 0) return;
	    if (!onSelect || !file.path) return;

	    onSelect(file.path, e, index);
      };

      const handleItemDoubleClick = (file, event, index) => {
        if (!file?.path || rubberSelectRef.current.moved) return;
        event.preventDefault();
        onOpenFile?.(file, event, index);
      };

	  const handleItemMouseDown = (file, event, index) => {
	    if (event.button !== 0 || !onSelect || !file.path) return;
        if (isPlainPrimaryClick(event)) {
          applyImmediateSingleSelection(containerRef.current, event.currentTarget, '[data-file-path]');
        }
	  };

      const handleItemMouseUp = (file, event, index) => {
        if (event.button !== 0 || !onSelect || !file.path) return;
        if (rubberSelectRef.current.moved) return;
	    onSelect(file.path, event, index);
	  };

      const getRubberContainer = useCallback(() => containerRef.current, []);
      const selectRubberPaths = useCallback(paths => onDragSelect?.(paths), [onDragSelect]);
      const rubberSelection = useRafRubberSelection({
        getContainer: getRubberContainer,
        stateRef: rubberSelectRef,
        itemSelector: '[data-file-path]',
        itemPath: element => element.dataset.filePath,
        selectionBoxRef,
        onSelectPaths: selectRubberPaths,
      });

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
        rubberSelection.begin();
	    rubberSelectRef.current = {
	      active: true,
	      moved: false,
	      startX: event.clientX,
	      startY: event.clientY,
	    };
	  };

	  const stopRubberSelection = () => {
        rubberSelection.commit();
	    rubberSelectRef.current.active = false;
	  };

  return (
	    <div
	      ref={containerRef}
	      className={`thumbnail-grid ${shouldVirtualize ? 'is-virtualized' : ''}`}
	      onScroll={handleGridScroll}
	      onClick={event => {
	        if (rubberSelectRef.current.moved) {
	          rubberSelectRef.current.moved = false;
	          return;
	        }
	        if (event.target === event.currentTarget) onClearSelection?.();
	      }}
	      onMouseDown={startRubberSelection}
	      onMouseMove={rubberSelection.update}
	      onMouseLeave={() => {
	        stopRubberSelection();
	      }}
	      onMouseUp={() => {
	        stopRubberSelection();
	      }}
      style={{
        '--thumb-item-width': `${itemWidth}px`,
        '--thumb-image-width': `${imageWidth}px`,
        '--thumb-image-height': `${imageHeight}px`,
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
                  className={`thumbnail-item ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              style={{
	                position: 'absolute',
	                left: `${row.left}px`,
	                top: `${row.top}px`,
	              }}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
                  onMouseUp={(event) => handleItemMouseUp(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleItemDoubleClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <div className="thumbnail-cover-card">
                <CoverImage
                  key={coverImageKey(file)}
                  src={file.cover}
                  alt={file.name || ''}
                  className="thumb-image"
                  t={t}
                  iconSize={24}
                  showLoadingIndicator={visibleCoverPathSet.has(file.path)}
                />
                {displayRating(file) && (
                  <span className="thumbnail-rating-badge">★ {displayRating(file)}</span>
                )}
                <ViewerStatusBadgeRow
                  file={file}
                  t={t}
                  pageText={displayPages(file) ? `${displayPages(file)}p` : ''}
                  className="thumbnail-status-row"
                />
                <span className="thumb-label">{file.name || '-'}</span>
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
                  className={`thumbnail-item ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''}`}
	              onMouseDown={(event) => handleItemMouseDown(file, event, fileIndex)}
                  onMouseUp={(event) => handleItemMouseUp(file, event, fileIndex)}
	              onClick={(event) => handleItemClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleItemDoubleClick(file, event, fileIndex)}
	              onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	            >
              <div className="thumbnail-cover-card">
                <CoverImage
                  key={coverImageKey(file)}
                  src={file.cover}
                  alt={file.name || ''}
                  className="thumb-image"
                  t={t}
                  iconSize={24}
                  showLoadingIndicator={visibleCoverPathSet.has(file.path)}
                />
                {displayRating(file) && (
                  <span className="thumbnail-rating-badge">★ {displayRating(file)}</span>
                )}
                <ViewerStatusBadgeRow
                  file={file}
                  t={t}
                  pageText={displayPages(file) ? `${displayPages(file)}p` : ''}
                  className="thumbnail-status-row"
                />
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
	        <div
              ref={selectionBoxRef}
	          className="folder-drag-selection-box"
	          style={{ display: 'none' }}
	        />
	    </div>
  );
};

export { ThumbnailView };
export default ThumbnailView;
