import React, { useMemo, forwardRef, useRef, useState, useEffect, useCallback } from 'react';
import { FaIcon } from '../FaIcon';
import { normalizeColumnLayout } from '../../folderColumnLayout';
import {
    buildVirtualTableRows,
    groupFolderFiles,
    normalizeViewScales,
    shouldVirtualizeFolderItems,
} from '../../folderViewState';
import { useRafRubberSelection } from '../../hooks/useRafRubberSelection';
import { useFolderNavigationRestore } from '../../hooks/useFolderNavigationRestore';
import {
    applyImmediateSingleSelection,
    isPlainPrimaryClick,
} from '../../selectionVisualFeedback';
import { CoverImage, coverImageKey } from './CoverImage';
import { FolderEmptyState } from './FolderEmptyState';
import {
    ViewerBookmarkStatusIcon,
    ViewerReadingStatusIcon,
} from './ViewerStatusBadges';
import {
    viewerReadingProgressText,
    viewerReadingStatusText,
} from '../../viewerStatusState';

const STATUS_COLUMN_KEYS = new Set(['viewer_reading_status', 'viewer_bookmark_status']);
const HEADER_ICON_BY_COLUMN = {
    viewer_reading_status: 'book',
    viewer_bookmark_status: 'bookmark',
};

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
  onFileDragStart,
  onContextMenu,
  onScroll,
  onSelectAll,
  onDeselectAll,
  onClearSelection,
  onVisibleFilesChange,
    navigationRestore,
    onNavigationRestore,
  onColumnLayoutChange,
  columnLayout,
  scale = 50,
  t
    }, ref) => {
    const rubberSelectRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
    const columnResizeRef = useRef(null);
    const headerReorderRef = useRef({ active: false, moved: false, sourceKey: '', targetKey: '', startX: 0, startY: 0 });
    const selectionBoxRef = useRef(null);
    const [dragOverColumnKey, setDragOverColumnKey] = useState('');
    const [dragSourceColumnKey, setDragSourceColumnKey] = useState('');
    const [columnDragGhost, setColumnDragGhost] = useState(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [viewportWidth, setViewportWidth] = useState(0);
    const normalizedScale = normalizeViewScales({ table: scale }).table;
    const rowHeight = Math.round(36 + normalizedScale * 0.42);
    const coverSize = Math.round(32 + normalizedScale * 0.28);
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
        'ext',
        'format',
        'viewer_reading_status',
        'viewer_bookmark_status',
    ]), []);
    const numericColumnKeys = useMemo(() => new Set([
        'size', 'volume', 'chapter', 'total_volume', 'page_count',
    ]), []);
    const dateColumnKeys = useMemo(() => new Set(['created', 'modified']), []);

    const groupedData = useMemo(
        () => Array.isArray(groupedDataProp)
            ? groupedDataProp
            : groupFolderFiles(files, groupKey, sortKey, sortOrder, {
                fallbackGroupName: t('folder_group_uncategorized'),
            }),
        [files, groupedDataProp, groupKey, sortKey, sortOrder, t],
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
    const navigationRevealBounds = useMemo(() => {
        if (!navigationRestore?.revealPath || !shouldVirtualize) return null;
        const index = tableRows.findIndex(row => row.type === 'file' && row.file.path === navigationRestore.revealPath);
        return index < 0 ? null : { top: index * rowHeight, height: rowHeight };
    }, [navigationRestore?.revealPath, rowHeight, shouldVirtualize, tableRows]);
    useFolderNavigationRestore({
        containerRef: ref,
        navigationRestore,
        onNavigationRestore,
        viewportReady: viewportWidth > 0 && viewportHeight > 0,
        revealBounds: navigationRevealBounds,
        onScrollPositionChange: position => setScrollTop(current => current === position.scrollTop ? current : position.scrollTop),
    });
    const flatRows = useMemo(() => shouldVirtualize ? null : groupedData.flatMap(group => group.files), [groupedData, shouldVirtualize]);
    const fileIndexByPath = useMemo(() => {
        if (!flatRows) return null;
        const map = new Map();
        flatRows.forEach((file, index) => {
            if (file.path) map.set(file.path, index);
        });
        return map;
    }, [flatRows]);
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
    if (bytes === null || bytes === undefined || bytes === '') return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '-';
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
      if (!Number.isFinite(date.getTime())) return '';
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
            setViewportWidth(Math.max(0, Math.round(container.clientWidth || 0)));
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
        if (rubberSelectRef.current.moved) {
            rubberSelectRef.current.moved = false;
            return;
        }
        if (e.detail > 0) return;
        if (!onSelect || !file.path) return;
        onSelect(file.path, e, index);
    };

    const handleRowDoubleClick = (file, event, index) => {
        if (!file?.path || rubberSelectRef.current.moved) return;
        event.preventDefault();
        onOpenFile?.(file, event, index);
    };

    const handleRowMouseDown = (file, event, index) => {
        if (event.button !== 0 || !onSelect || !file.path) return;
        if (isPlainPrimaryClick(event)) {
            applyImmediateSingleSelection(ref?.current, event.currentTarget, '[data-file-path]');
        }
    };

    const handleRowMouseUp = (file, event, index) => {
        if (event.button !== 0 || !onSelect || !file.path) return;
        if (rubberSelectRef.current.moved) return;
        onSelect(file.path, event, index);
    };

    const getRubberContainer = useCallback(() => ref?.current || null, [ref]);
    const selectRubberPaths = useCallback(paths => onDragSelect?.(paths), [onDragSelect]);
    const rubberSelection = useRafRubberSelection({
        getContainer: getRubberContainer,
        stateRef: rubberSelectRef,
        itemSelector: '[data-file-path]',
        itemPath: element => element.dataset.filePath,
        selectionBoxRef,
        onSelectPaths: selectRubberPaths,
    });

    const startRubberSelection = (event) => {
        if (event.button !== 0 || event.target.closest('thead')) return;
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

  const renderHeaderLabel = column => {
    const icon = HEADER_ICON_BY_COLUMN[column.key];
    if (!icon) return column.label;
    return <FaIcon name={icon} size={12} title={column.label} />;
  };

    const renderCell = (file, column) => {
        const className = [
            centeredColumnKeys.has(column.key) ? 'center-cell' : '',
            numericColumnKeys.has(column.key) ? 'numeric-cell' : '',
            dateColumnKeys.has(column.key) ? 'date-cell' : '',
            column.key === 'name' || column.key === 'title' ? 'primary-cell' : '',
            column.key === 'name' ? 'file-name-cell' : '',
        ].filter(Boolean).join(' ');
        if (column.key === 'cover') {
            return (
                <td key={column.key} className="cover-cell">
                    <CoverImage
                        file={file}
                        key={coverImageKey(file)}
                        src={file.cover}
                        alt={file.name || ''}
                        className="table-cover-image"
                        t={t}
                        iconSize={file.isDirectory ? 24 : 14}
                        isDirectory={file.isDirectory}
                        showLoadingIndicator={visibleCoverPathSet.has(file.path)}
                    />
                </td>
            );
        }
        if (file.isDirectory) {
            if (column.key === 'name' || column.key === 'title') {
                return (
                    <td key={column.key} className={className} title={String(file.name ?? '')}>
                        <span className="folder-item-name">
                            <FaIcon name="folder" size={14} title={t('folder_item_type')} />
                            <span className="file-table-name-text">{file.name ?? ''}</span>
                        </span>
                    </td>
                );
            }
            if (column.key === 'ext' || column.key === 'format') {
                const value = t('folder_item_type');
                return <td key={column.key} className={className} title={value}><span className="file-table-format is-folder">{value}</span></td>;
            }
            if (dateColumnKeys.has(column.key)) {
                const value = formatDate(file[column.key] || file[column.key === 'created' ? 'ctime' : 'mtime']);
                return <td key={column.key} className={className} title={value}>{value}</td>;
            }
            if (column.key === 'folder_path' || column.key === 'path' || column.key === 'full_path') {
                const value = file[column.key] ?? file.path ?? '';
                return <td key={column.key} className={className} title={String(value)}>{value}</td>;
            }
            return <td key={column.key} className={className} />;
        }
        if (column.key === 'viewer_reading_status') {
            const status = file.viewerStatus || {};
            const hasStatus = status.isCompleted || status.hasReadingProgress;
            const rawPercent = Number(status.percent);
            const percent = status.isCompleted ? 100
                : status.percent !== null && status.percent !== undefined && status.percent !== '' && Number.isFinite(rawPercent)
                    ? Math.max(0, Math.min(100, Math.round(rawPercent))) : null;
            const label = hasStatus
                ? [viewerReadingStatusText(status, t), viewerReadingProgressText(status)].filter(Boolean).join(' ')
                : '';
            return (
                <td key={column.key} className="center-cell folder-status-cell" title={label}>
                    {hasStatus && (
                        <span className={`file-table-reading-status${status.isCompleted ? ' is-complete' : ''}`} aria-label={label}>
                            <span className="file-table-reading-summary">
                                <ViewerReadingStatusIcon file={file} t={t} />
                                {percent !== null && <span className="file-table-reading-percent">{percent}%</span>}
                            </span>
                            {percent !== null && <span className="file-table-reading-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
                        </span>
                    )}
                </td>
            );
        }
        if (column.key === 'viewer_bookmark_status') {
            return (
                <td key={column.key} className="center-cell folder-status-cell">
                    <ViewerBookmarkStatusIcon file={file} t={t} />
                </td>
            );
        }
        if (column.key === 'dup_count') {
            return (
                <td
                    key={column.key}
                    className="dup-cell"
                    title={file.duplicate_matches?.map(match => `${match.name} (${match.ratio}%)`).join('\n') || (file.dup_count > 0 ? t('dup_count_format', [file.dup_count, file.max_ratio]) : '')}
                >
                    {file.dup_count > 0 && <span className="file-table-duplicate-badge">{t('dup_count_format', [file.dup_count, file.max_ratio])}</span>}
                </td>
            );
        }
        if (dateColumnKeys.has(column.key)) {
            const value = formatDate(file[column.key]);
            return <td key={column.key} className={className} title={value}>{value}</td>;
        }
        if (column.key === 'size') {
            const value = formatSize(file.size);
            return <td key={column.key} className={className} title={value}>{value}</td>;
        }
        if (column.key === 'name' || column.key === 'title') {
            const value = file[column.key] ?? '';
            return (
                <td key={column.key} className={className} title={String(value)}>
                    <span className="file-table-name-text">{value}</span>
                    {column.key === 'name' && file.recentReadingText && (
                        <small className="file-table-name-secondary" title={file.recentReadingText}>
                            <FaIcon name="clock" size={9} />
                            <span>{file.recentReadingText}</span>
                        </small>
                    )}
                </td>
            );
        }
        const value = file[column.key] ?? '';
        if (column.key === 'ext' || column.key === 'format') {
            return <td key={column.key} className={className} title={String(value)}>{value !== '' && <span className="file-table-format">{value}</span>}</td>;
        }
        return <td key={column.key} className={className} title={String(value)}>{value}</td>;
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
	      onMouseMove={rubberSelection.update}
	      onMouseLeave={() => {
	        stopRubberSelection();
	      }}
	      onMouseUp={() => {
	        stopRubberSelection();
	      }}
	    >
      <table className="file-table" style={{ width: `${Math.max(tableWidth, 1)}px`, '--folder-row-height': `${rowHeight}px`, '--folder-cover-size': `${coverSize}px` }}>
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
                scope="col"
                aria-sort={col.sortable ? sortKey === col.key ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none' : undefined}
                className={`${col.sortable ? 'sortable' : ''} ${centeredColumnKeys.has(col.key) ? 'center-column' : ''} ${numericColumnKeys.has(col.key) ? 'numeric-column' : ''} ${dateColumnKeys.has(col.key) ? 'date-column' : ''} ${STATUS_COLUMN_KEYS.has(col.key) ? 'status-column' : ''} ${sortKey === col.key ? 'active-sort' : ''} ${dragSourceColumnKey === col.key ? 'drag-source' : ''} ${dragOverColumnKey === col.key ? 'drag-over' : ''}`}
                title={col.label}
                onClick={event => {
                    if (event.target !== event.currentTarget || !col.sortable) return;
                    if (headerReorderRef.current.moved) {
                        headerReorderRef.current.moved = false;
                        return;
                    }
                    onSort?.(col.key);
                }}
              >
                <span
                  className="file-table-header-grip"
                  onMouseDown={event => startColumnReorder(event, col)}
                  onClick={event => event.stopPropagation()}
                  title={t('column_reorder')}
                >
                  <FaIcon name="grip-vertical" size={10} />
                </span>
                {col.sortable ? (
                    <button
                        type="button"
                        className="file-table-header-button"
                        onMouseDown={() => {
                            if (!headerReorderRef.current.active) headerReorderRef.current.moved = false;
                        }}
                        onClick={() => {
                            if (headerReorderRef.current.moved) {
                                headerReorderRef.current.moved = false;
                                return;
                            }
                            onSort?.(col.key);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.stopPropagation();
                                headerReorderRef.current.moved = false;
                            }
                        }}
                    >
                        <span className="file-table-header-label">{renderHeaderLabel(col)}</span>
                        {sortKey === col.key && (
                            <span className="file-table-sort-icon" aria-hidden="true">
                                {sortOrder === 'asc' ? '▲' : '▼'}
                            </span>
                        )}
                    </button>
                ) : (
                    <span className="file-table-header-content">
                        <span className="file-table-header-label">{renderHeaderLabel(col)}</span>
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
                  draggable={Boolean(file.full_path || file.path)}
                  className={`file-row ${fileIndex % 2 ? 'is-alternate' : ''} ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
                  aria-selected={selectedFileLookup.has(file.path)}
                  onMouseDown={(event) => handleRowMouseDown(file, event, fileIndex)}
                  onMouseUp={(event) => handleRowMouseUp(file, event, fileIndex)}
                  onClick={(event) => handleRowClick(file, event, fileIndex)}
                  onDoubleClick={(event) => handleRowDoubleClick(file, event, fileIndex)}
                  onDragStart={(event) => onFileDragStart?.(event, file)}
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
            <React.Fragment key={`group:${group.name}`}>
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
                      draggable={Boolean(file.full_path || file.path)}
                      className={`file-row ${fileIndex % 2 ? 'is-alternate' : ''} ${selectedFileLookup.has(file.path) ? 'selected' : ''} ${activeSelectedPath === file.path ? 'active-selection' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
                      aria-selected={selectedFileLookup.has(file.path)}
	                  onMouseDown={(event) => handleRowMouseDown(file, event, fileIndex)}
                      onMouseUp={(event) => handleRowMouseUp(file, event, fileIndex)}
	                  onClick={(event) => handleRowClick(file, event, fileIndex)}
                      onDoubleClick={(event) => handleRowDoubleClick(file, event, fileIndex)}
	                  onDragStart={(event) => onFileDragStart?.(event, file)}
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
	        <div
              ref={selectionBoxRef}
	          className="folder-drag-selection-box"
	          style={{ display: 'none' }}
	        />
	    </div>
  );
});

export { FileTableView };
export default FileTableView;
