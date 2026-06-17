import React, { useMemo, forwardRef } from 'react';
import { FaIcon } from '../FaIcon';

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
  onSelectAll,
  onDeselectAll,
  scale = 50,
  t
}, ref) => {
  const rowHeight = Math.round(36 + Number(scale || 50) * 0.42);
  const coverSize = Math.round(32 + Number(scale || 50) * 0.28);
  // 컬럼 정의 (PyQt 원본 기준)
  const columns = [
    { key: 'cover', label: t('col_cover'), width: '60px', sortable: false },
    { key: 'dup_count', label: t('folder_dup_check_off').replace(/[☐☑]\s*/, ''), width: '80px', sortable: true },
    { key: 'resolution', label: t('col_res'), width: '100px', sortable: true },
    { key: 'size', label: t('col_size'), width: '100px', sortable: true },
    { key: 'created', label: t('col_ctime'), width: '150px', sortable: true },
    { key: 'series', label: t('col_series'), width: '200px', sortable: true },
    { key: 'name', label: t('col_name'), width: '240px', sortable: true },
    { key: 'title', label: t('col_title'), width: '160px', sortable: true },
    { key: 'volume', label: t('col_vol'), width: '70px', sortable: true },
    { key: 'chapter', label: t('col_num'), width: '60px', sortable: true },
    { key: 'author', label: t('col_writer'), width: '120px', sortable: true },
    { key: 'modified', label: t('col_mtime'), width: '150px', sortable: true },
    { key: 'series_group', label: t('col_series_group'), width: '120px', sortable: true },
    { key: 'producer', label: t('col_creators'), width: '120px', sortable: true },
    { key: 'publisher', label: t('col_publisher'), width: '120px', sortable: true },
    { key: 'imprint', label: t('col_imprint'), width: '120px', sortable: true },
    { key: 'genre', label: t('col_genre'), width: '140px', sortable: true },
    { key: 'total_volume', label: t('col_vol_count'), width: '90px', sortable: true },
    { key: 'page_count', label: t('col_page_count'), width: '90px', sortable: true },
    { key: 'format', label: t('col_format'), width: '80px', sortable: true }
  ];

  // 그룹화 및 정렬 처리
  const groupedData = useMemo(() => {
    if (!files || files.length === 0) return {};

    let processed = [...files];

    if (sortKey) {
      processed.sort((a, b) => {
        const valA = a[sortKey] || '';
        const valB = b[sortKey] || '';
        if (typeof valA === 'number' && typeof valB === 'number') {
          const result = valA - valB;
          return sortOrder === 'desc' ? -result : result;
        }
        const result = String(valA).localeCompare(String(valB), 'ko');
        return sortOrder === 'desc' ? -result : result;
      });
    }

    if (groupKey && groupKey !== 'none') {
      const groups = {};
      processed.forEach(file => {
        const groupValue = file[groupKey] || '미분류';
        if (!groups[groupValue]) {
          groups[groupValue] = [];
        }
        groups[groupValue].push(file);
      });
      return groups;
    }

    return { ['전체']: processed };
  }, [files, sortKey, sortOrder, groupKey, t]);

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

  return (
    <div className="file-table-container">
      <table className="file-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width, minWidth: col.width, cursor: col.sortable ? 'pointer' : 'default' }}
                onClick={() => col.sortable && onSort && onSort(col.key)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(groupedData).map(([groupName, groupFiles]) => (
            <React.Fragment key={groupName}>
              {groupName !== '전체' && (
                <tr className="group-header-row">
                  <td colSpan={columns.length}>
                    <span className="group-folder-icon"><FaIcon name="folder" /></span> {groupName}
                  </td>
                </tr>
              )}
              {groupFiles.map((file, index) => (
                <tr
                  key={file.path || index}
                  className={`${selectedFiles.includes(file.path) ? 'selected' : ''} ${file.dup_count > 0 ? 'has-duplicate' : ''}`}
                  style={{ '--folder-row-height': `${rowHeight}px`, '--folder-cover-size': `${coverSize}px` }}
                  onClick={(e) => handleRowClick(file, e, index)}
                  onContextMenu={(event) => onContextMenu?.(event, file, index)}
                >
                  <td className="cover-cell">
                    {file.cover ? (
                      <img
                        src={file.cover}
                        alt=""
                        loading="lazy"
                      />
                    ) : '-'}
                  </td>
                  <td
                    className="dup-cell"
                    title={file.duplicate_matches?.map(match => `${match.name} (${match.ratio}%)`).join('\n') || ''}
                  >
                    {file.dup_count > 0 ? `${file.dup_count}개 / ${file.max_ratio}%` : ''}
                  </td>
                  <td>{file.resolution || ''}</td>
                  <td>{formatSize(file.size)}</td>
                  <td>{formatDate(file.created)}</td>
                  <td>{file.series || ''}</td>
                  <td>{file.name || ''}</td>
                  <td>{file.title || ''}</td>
                  <td>{file.volume || ''}</td>
                  <td>{file.chapter || ''}</td>
                  <td>{file.author || ''}</td>
                  <td>{formatDate(file.modified)}</td>
                  <td>{file.series_group || ''}</td>
                  <td>{file.producer || ''}</td>
                  <td>{file.publisher || ''}</td>
                  <td>{file.imprint || ''}</td>
                  <td>{file.genre || ''}</td>
                  <td>{file.total_volume || ''}</td>
                  <td>{file.page_count || ''}</td>
                  <td>{file.format || file.type || ''}</td>
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
