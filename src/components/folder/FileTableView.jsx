import React, { useMemo, forwardRef } from 'react';
import { FaIcon } from '../FaIcon';
import { normalizeColumnLayout } from '../../folderColumnLayout';
import { groupFolderFiles } from '../../folderViewState';
import { CoverImage } from './CoverImage';

/**
 * FileTableView - 파일 테이블 뷰 컴포넌트
 * Python QTableView -> React 포트
 */
const FileTableView = forwardRef(({
  files = [],
  sortKey = 'name',
  sortOrder = 'asc',
  groupKey = 'none',
  selectedFiles = [],
  dupFiles = [],
  onSort,
  onSelect,
  onContextMenu,
  onScroll,
  onSelectAll,
  onDeselectAll,
  columnLayout,
  scale = 50,
  t
}, ref) => {
  const rowHeight = Math.round(36 + Number(scale || 50) * 0.42);
  const coverSize = Math.round(32 + Number(scale || 50) * 0.28);
  const columns = useMemo(() => normalizeColumnLayout(columnLayout)
    .filter(column => column.visible)
    .map(column => ({
      ...column,
      sortable: column.sortable !== false,
      label: column.key === 'dup_count'
        ? t(column.labelKey).replace(/[☐☑]\s*/, '')
        : t(column.labelKey),
    })), [columnLayout, t]);

  const groupedData = useMemo(
    () => groupFolderFiles(files, groupKey, sortKey, sortOrder),
    [files, groupKey, sortKey, sortOrder],
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

  const handleRowClick = (file, e, index) => {
    if (!onSelect || !file.path) return;
    onSelect(file.path, e, index);
  };

  const renderCell = (file, column) => {
    if (column.key === 'cover') {
      return (
        <td key={column.key} className="cover-cell">
          <CoverImage
            src={file.cover}
            alt={file.name || ''}
            className="table-cover-image"
            t={t}
            iconSize={14}
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
          {file.dup_count > 0 ? `${file.dup_count}개 / ${file.max_ratio}%` : ''}
        </td>
      );
    }
    if (column.key === 'size') return <td key={column.key}>{formatSize(file.size)}</td>;
    if (column.key === 'created' || column.key === 'modified') {
      return <td key={column.key}>{formatDate(file[column.key])}</td>;
    }
    return <td key={column.key}>{file[column.key] || ''}</td>;
  };

  return (
    <div ref={ref} className="file-table-container" onScroll={onScroll}>
      <table className="file-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: `${col.width}px`, minWidth: `${col.width}px`, cursor: col.sortable ? 'pointer' : 'default' }}
                onClick={() => col.sortable && onSort && onSort(col.key)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupedData.map(group => (
            <React.Fragment key={group.name || 'all'}>
              {group.name && (
                <tr className="group-header-row">
                  <td colSpan={columns.length}>
                    <span className="group-folder-icon"><FaIcon name="folder" /></span>
                    {t('group_header', [group.name, group.files.length])}
                  </td>
                </tr>
              )}
              {group.files.map((file, index) => (
                <tr
                  key={file.path || index}
                  className={`${selectedFiles.includes(file.path) ? 'selected' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
                  style={{ '--folder-row-height': `${rowHeight}px`, '--folder-cover-size': `${coverSize}px` }}
                  onClick={(e) => handleRowClick(file, e, index)}
                  onContextMenu={(event) => onContextMenu?.(event, file, index)}
                >
                  {columns.map(column => renderCell(file, column))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {files.length === 0 && (
        <div className="empty-folder-page">
          <div style={{ fontSize: '48px', opacity: 0.5 }}><FaIcon name="folder" size={48} /></div>
          <div>파일이 없습니다</div>
        </div>
      )}
    </div>
  );
});

export { FileTableView };
export default FileTableView;
