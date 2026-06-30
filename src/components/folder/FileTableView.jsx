import React, { useMemo, forwardRef, useRef, useState, useEffect } from 'react';
import { FaIcon } from '../FaIcon';
import { normalizeColumnLayout } from '../../folderColumnLayout';
import {
    buildVirtualTableRows,
    groupFolderFiles,
    shouldVirtualizeFolderItems,
} from '../../folderViewState';
import { CoverImage, coverImageKey } from './CoverImage';
import { FolderEmptyState } from './FolderEmptyState';

/**
 * FileTableView - 파일 테이블 뷰 컴포넌트
 * Python QTableView -> React 포트
 */
const FileTableView = forwardRef(({
  files = [],
  groupedData: groupedDataProp,
  sortKey = 'name',
  sortOrder = 'asc',
  groupKey = 'none',
  selectedFiles = [],
  selectedFileSet,
  activeSelectedPath = '',
  dupFiles = [],
  onSort,
  onSelect,
  onOpenFile,
  onDragSelect,
  onContextMenu,
  onScroll,
  onSelectAll,
  onDeselectAll,
  onClearSelection,
  onVisibleFilesChange,
  onColumnLayoutChange,
  columnLayout,
  scale = 50,
  t
    }, ref) => {
    const dragSelectRef = useRef({ active: false, moved: false });
    const rubberSelectRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
    const columnResizeRef = useRef(null);
    const headerReorderRef = useRef({ active: false, moved: false, sourceKey: '', targetKey: '', startX: 0, startY: 0 });
    const [selectionBox, setSelectionBox] = useState(null);
    const [dragOverColumnKey, setDragOverColumnKey] = useState('');
    const [dragSourceColumnKey, setDragSourceColumnKey] = useState('');
    const [columnDragGhost, setColumnDragGhost] = useState(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const rowHeight = Math.round(36 + Number(scale || 50) * 0.42);
    const coverSize = Math.round(32 + Number(scale || 50) * 0.28);
    const normalizedLayout = useMemo(() => normalizeColumnLayout(columnLayout), [columnLayout]);
  const columns = useMemo(() => normalizeColumnLayout(columnLayout)
    .filter(column => column.visible)
    .map(column => ({
      ...column,
      sortable: column.sortable !== false,
      label: column.key === 'dup_count'
        ? t(column.labelKey).replace(/[☐☑]\s*/, '')
        : t(column.labelKey),
    })), [columnLayout, t]);
    const tableWidth = useMemo(
        () => columns.reduce((total, column) => total + Number(column.width || 0), 0),
        [columns],
    );
    const centeredColumnKeys = useMemo(() => new Set([
        'resolution',
        'size',
        'created',
        'volume',
        'chapter',
        'modified',
        'ext',
        'total_volume',
        'page_count',
        'format',
    ]), []);

    const groupedData = useMemo(
        () => Array.isArray(groupedDataProp)
            ? groupedDataProp
            : groupFolderFiles(files, groupKey, sortKey, sortOrder),
        [files, groupedDataProp, groupKey, sortKey, sortOrder],
    );
    const selectedFileLookup = useMemo(
        () => selectedFileSet instanceof Set ? selectedFileSet : new Set(selectedFiles),
        [selectedFileSet, selectedFiles],
    );
    const tableRows = useMemo(() => buildVirtualTableRows(groupedData), [groupedData]);
    const shouldVirtualize = shouldVirtualizeFolderItems(groupedData);
    const virtualRows = shouldVirtualize ? tableRows : [];
    const virtualBuffer = 12;
    const virtualStartIndex = shouldVirtualize
        ? Math.max(0, Math.floor(scrollTop / rowHeight) - virtualBuffer)
        : 0;
    const virtualVisibleCount = shouldVirtualize
        ? Math.ceil((viewportHeight || 600) / rowHeight) + (virtualBuffer * 2)
        : 0;
    const virtualEndIndex = shouldVirtualize
        ? Math.min(virtualRows.length, virtualStartIndex + virtualVisibleCount)
        : 0;
    const virtualVisibleRows = shouldVirtualize
        ? virtualRows.slice(virtualStartIndex, virtualEndIndex)
        : [];
    const virtualTopPadding = virtualStartIndex * rowHeight;
    const virtualBottomPadding = Math.max(0, (virtualRows.length - virtualEndIndex) * rowHeight);
    const fileIndexByPath = useMemo(() => {
        const map = new Map();
        groupedData.flatMap(group => group.files).forEach((file, index) => {
            if (file.path) map.set(file.path, index);
        });
        return map;
    }, [groupedData]);
    const flatRows = useMemo(() => groupedData.flatMap(group => group.files), [groupedData]);
    const visibleCoverRows = useMemo(() => {
        if (shouldVirtualize) return virtualVisibleRows
            .filter(row => row.type === 'file')
            .map(row => row.file);
        if (flatRows.length === 0) return [];
        const firstIndex = Math.max(0, Math.floor((scrollTop || 0) / rowHeight) - 8);
        const visibleCount = Math.ceil((viewportHeight || 600) / rowHeight) + 16;
        return flatRows.slice(firstIndex, firstIndex + visibleCount);
    }, [flatRows, rowHeight, scrollTop, shouldVirtualize, viewportHeight, virtualVisibleRows]);

    useEffect(() => {
        onVisibleFilesChange?.(visibleCoverRows);
    }, [onVisibleFilesChange, visibleCoverRows]);
    const visibleCoverPathSet = useMemo(
        () => new Set(visibleCoverRows.map(file => file.path).filter(Boolean)),
        [visibleCoverRows],
    );

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

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

    const commitColumnLayout = (nextLayout, persist = false) => {
        onColumnLayoutChange?.(nextLayout, persist);
    };

    const resizeColumn = (columnKey, width, persist = false) => {
        const nextLayout = normalizedLayout.map(column => (
            column.key === columnKey
                ? { ...column, width: Math.max(40, Math.min(600, Math.round(width))) }
                : column
        ));
        commitColumnLayout(nextLayout, persist);
    };

    const moveColumnTo = (sourceKey, targetKey) => {
        if (!sourceKey || !targetKey || sourceKey === targetKey) return;
        const sourceIndex = normalizedLayout.findIndex(column => column.key === sourceKey);
        const targetIndex = normalizedLayout.findIndex(column => column.key === targetKey);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const nextLayout = [...normalizedLayout];
        const [sourceColumn] = nextLayout.splice(sourceIndex, 1);
        nextLayout.splice(targetIndex, 0, sourceColumn);
        commitColumnLayout(nextLayout, true);
    };

    const startColumnResize = (event, column) => {
        event.preventDefault();
        event.stopPropagation();
        columnResizeRef.current = {
            key: column.key,
            startX: event.clientX,
            startWidth: column.width,
        };
        document.body.classList.add('is-resizing-table-column');
    };

    const startColumnReorder = (event, column) => {
        if (event.button !== 0 || event.target.closest('.file-table-column-resizer')) return;
        const headerCell = event.currentTarget.closest('[data-column-key]');
        const rect = headerCell?.getBoundingClientRect();
        if (!rect) return;
        headerReorderRef.current = {
            active: true,
            moved: false,
            sourceKey: column.key,
            targetKey: column.key,
            startX: event.clientX,
            startY: event.clientY,
        };
        setDragSourceColumnKey(column.key);
        setColumnDragGhost({
            x: rect.left,
            y: rect.top,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
            label: column.label,
        });
    };

    useEffect(() => {
        const handleMouseMove = event => {
            const state = columnResizeRef.current;
            if (state) {
                event.preventDefault();
                resizeColumn(state.key, state.startWidth + event.clientX - state.startX);
                return;
            }

            const reorderState = headerReorderRef.current;
            if (!reorderState.active) return;
            const moved = Math.abs(event.clientX - reorderState.startX) > 4 || Math.abs(event.clientY - reorderState.startY) > 4;
            if (!moved) return;
            event.preventDefault();
            headerReorderRef.current.moved = true;
            document.body.classList.add('is-reordering-table-column');
            setColumnDragGhost(current => current ? {
                ...current,
                x: event.clientX - current.offsetX,
                y: event.clientY - current.offsetY,
            } : null);
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-column-key]');
            const targetKey = target?.dataset?.columnKey || '';
            if (targetKey) {
                headerReorderRef.current.targetKey = targetKey;
                setDragOverColumnKey(targetKey);
            }
        };
        const handleMouseUp = event => {
            const state = columnResizeRef.current;
            if (state) {
                columnResizeRef.current = null;
                document.body.classList.remove('is-resizing-table-column');
                resizeColumn(state.key, state.startWidth + event.clientX - state.startX, true);
                return;
            }

            const reorderState = headerReorderRef.current;
            if (!reorderState.active) return;
            headerReorderRef.current = { active: false, moved: reorderState.moved, sourceKey: '', targetKey: '', startX: 0, startY: 0 };
            document.body.classList.remove('is-reordering-table-column');
            setDragSourceColumnKey('');
            setDragOverColumnKey('');
            setColumnDragGhost(null);
            if (reorderState.moved) {
                event.preventDefault();
                moveColumnTo(reorderState.sourceKey, reorderState.targetKey);
            }
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.body.classList.remove('is-resizing-table-column');
            document.body.classList.remove('is-reordering-table-column');
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [normalizedLayout, onColumnLayoutChange]);

    useEffect(() => {
        const container = ref?.current;
        if (!container) return undefined;
        const updateViewportHeight = () => {
            setViewportHeight(Math.max(0, Math.round(container.clientHeight || 0)));
        };
        updateViewportHeight();
        if (typeof ResizeObserver !== 'function') {
            window.addEventListener('resize', updateViewportHeight);
            return () => window.removeEventListener('resize', updateViewportHeight);
        }
        const observer = new ResizeObserver(updateViewportHeight);
        observer.observe(container);
        return () => observer.disconnect();
    }, [ref]);

    const handleContainerScroll = event => {
        setScrollTop(event.currentTarget.scrollTop || 0);
        onScroll?.(event);
    };

    const handleRowClick = (file, e, index) => {
        if (dragSelectRef.current.moved || rubberSelectRef.current.moved) {
            dragSelectRef.current.moved = false;
            rubberSelectRef.current.moved = false;
            return;
        }
        if (e.detail > 0) return;
        if (!onSelect || !file.path) return;
        onSelect(file.path, e, index);
    };

    const handleRowDoubleClick = (file, event, index) => {
        if (!file?.path || dragSelectRef.current.moved || rubberSelectRef.current.moved) return;
        event.preventDefault();
        onOpenFile?.(file, event, index);
    };

    const handleRowMouseDown = (file, event, index) => {
        if (event.button !== 0 || !onSelect || !file.path) return;
        dragSelectRef.current = { active: true, moved: false };
        onSelect(file.path, event, index);
    };

    const handleRowMouseEnter = (file, event, index) => {
        if (!dragSelectRef.current.active || !onSelect || !file.path) return;
        dragSelectRef.current.moved = true;
        onSelect(file.path, { ...event, shiftKey: true }, index);
    };

    const stopDragSelect = () => {
        dragSelectRef.current.active = false;
    };

    const updateRubberSelection = (event) => {
        const state = rubberSelectRef.current;
        const container = ref?.current;
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
        if (event.button !== 0 || event.target.closest('thead')) return;
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

  const renderCell = (file, column) => {
    const className = centeredColumnKeys.has(column.key) ? 'center-cell' : undefined;
    if (column.key === 'cover') {
      return (
        <td key={column.key} className="cover-cell">
          <CoverImage
            key={coverImageKey(file)}
            src={file.cover}
            alt={file.name || ''}
            className="table-cover-image"
            t={t}
            iconSize={14}
            showLoadingIndicator={visibleCoverPathSet.has(file.path)}
          />
        </td>
      );
    }
    if (column.key === 'dup_count') {
      return (
        <td
          key={column.key}
          className="dup-cell"
          title={file.duplicate_matches?.map(match => `${match.name} (${match.ratio}%)`).join('\n') || ''}
        >
          {file.dup_count > 0 ? t('dup_count_format', [file.dup_count, file.max_ratio]) : ''}
        </td>
      );
    }
    if (column.key === 'created' || column.key === 'modified') {
      return <td key={column.key} className={className}>{formatDate(file[column.key])}</td>;
    }
    if (column.key === 'size') return <td key={column.key} className={className}>{formatSize(file.size)}</td>;
    return <td key={column.key} className={className}>{file[column.key] || ''}</td>;
  };

  return (
    <div
      ref={ref}
      className="file-table-container"
      onScroll={handleContainerScroll}
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
	    >
      <table className="file-table" style={{ width: `${Math.max(tableWidth, 1)}px` }}>
        <colgroup>
          {columns.map(column => (
            <col key={column.key} style={{ width: `${column.width}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                data-column-key={col.key}
                className={`${col.sortable ? 'sortable' : ''} ${centeredColumnKeys.has(col.key) ? 'center-column' : ''} ${sortKey === col.key ? 'active-sort' : ''} ${dragSourceColumnKey === col.key ? 'drag-source' : ''} ${dragOverColumnKey === col.key ? 'drag-over' : ''}`}
                onClick={() => {
                  if (headerReorderRef.current.moved) {
                    headerReorderRef.current.moved = false;
                    return;
                  }
                  if (col.sortable && onSort) onSort(col.key);
                }}
              >
                <span
                  className="file-table-header-grip"
                  onMouseDown={event => startColumnReorder(event, col)}
                  title={t('column_reorder')}
                >
                  <FaIcon name="grip-vertical" size={10} />
                </span>
                <span className="file-table-header-label">{col.label}</span>
                {sortKey === col.key && (
                  <span className="file-table-sort-icon" aria-hidden="true">
                    {sortOrder === 'asc' ? '▲' : '▼'}
                  </span>
                )}
                <span
                  className="file-table-column-resizer"
                  onMouseDown={event => startColumnResize(event, col)}
                  onClick={event => event.stopPropagation()}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shouldVirtualize ? (
            <>
              {virtualTopPadding > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: `${virtualTopPadding}px`, padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualVisibleRows.map((row, relativeIndex) => {
                if (row.type === 'group') {
                    return (
                      <tr key={row.key || `group-${virtualStartIndex + relativeIndex}`} className="group-header-row">
                        <td colSpan={columns.length}>
                          <span className="group-folder-icon"><FaIcon name="folder" /></span>
                          {t('group_header', [row.group.name, row.group.files.length])}
                        </td>
                      </tr>
                    );
                }
                const file = row.file;
                const fileIndex = row.fileIndex;
                return (
                <tr
                  key={file.path || fileIndex}
                  data-file-path={file.path}
                  className={`${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
                  style={{ '--folder-row-height': `${rowHeight}px`, '--folder-cover-size': `${coverSize}px` }}
                  onMouseDown={(event) => handleRowMouseDown(file, event, fileIndex)}
                  onMouseEnter={(event) => handleRowMouseEnter(file, event, fileIndex)}
                  onClick={(event) => handleRowClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleRowDoubleClick(file, event, fileIndex)}
                  onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
                >
                  {columns.map(column => renderCell(file, column))}
                </tr>
                );
              })}
              {virtualBottomPadding > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: `${virtualBottomPadding}px`, padding: 0, border: 0 }} />
                </tr>
              )}
            </>
          ) : groupedData.map(group => (
            <React.Fragment key={group.name || 'all'}>
              {group.name && (
                <tr className="group-header-row">
                  <td colSpan={columns.length}>
                    <span className="group-folder-icon"><FaIcon name="folder" /></span>
                    {t('group_header', [group.name, group.files.length])}
                  </td>
                </tr>
              )}
	              {group.files.map((file, index) => {
	                const fileIndex = fileIndexByPath.get(file.path) ?? index;
	                return (
	                <tr
	                  key={file.path || index}
	                  data-file-path={file.path}
                      className={`${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
	                  style={{ '--folder-row-height': `${rowHeight}px`, '--folder-cover-size': `${coverSize}px` }}
	                  onMouseDown={(event) => handleRowMouseDown(file, event, fileIndex)}
	                  onMouseEnter={(event) => handleRowMouseEnter(file, event, fileIndex)}
	                  onClick={(event) => handleRowClick(file, event, fileIndex)}
                      onDoubleClick={(event) => handleRowDoubleClick(file, event, fileIndex)}
	                  onContextMenu={(event) => onContextMenu?.(event, file, fileIndex)}
	                >
	                  {columns.map(column => renderCell(file, column))}
	                </tr>
	                );
	              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
          {columnDragGhost && (
            <div
              className="file-table-column-drag-ghost"
              style={{
                left: `${columnDragGhost.x}px`,
                top: `${columnDragGhost.y}px`,
                width: `${columnDragGhost.width}px`,
                height: `${columnDragGhost.height}px`,
              }}
            >
              <span className="file-table-column-drag-grip"><FaIcon name="grip-vertical" size={10} /></span>
              <span className="file-table-column-drag-label">{columnDragGhost.label}</span>
            </div>
          )}
	      {files.length === 0 && (
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
});

export { FileTableView };
export default FileTableView;
