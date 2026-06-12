import React, { useMemo } from 'react';

/**
 * FileTableView - 파일 테이블 뷰 컴포넌트
 * Python QTableView -> React 포트
 */
const FileTableView = ({
  files = [],
  sortKey = 'name',
  groupKey = 'none',
  selectedFiles = [],
  dupFiles = [],
  onSort,
  onSelect,
  onSelectAll,
  onDeselectAll,
  t
}) => {
  // 컬럼 정의 (PyQt 원본 기준)
  const columns = [
    { key: 'cover', label: ':: 커버', width: '60px', sortable: false },
    { key: 'resolution', label: ':: 해상도', width: '100px', sortable: true },
    { key: 'size', label: ':: 용량', width: '100px', sortable: true },
    { key: 'created', label: ':: 생성일', width: '150px', sortable: true },
    { key: 'series', label: ':: 시리즈', width: '200px', sortable: true },
    { key: 'name', label: ':: 파일명', width: '200px', sortable: true },
    { key: 'title', label: ':: 제목', width: '200px', sortable: true },
    { key: 'volume', label: ':: 권', width: '60px', sortable: true },
    { key: 'chapter', label: ':: 화', width: '60px', sortable: true },
    { key: 'author', label: ':: 작가', width: '120px', sortable: true },
    { key: 'modified', label: ':: 수정일', width: '150px', sortable: true },
    { key: 'series_group', label: ':: 시리즈 그룹', width: '120px', sortable: true },
    { key: 'producer', label: ':: 제작진', width: '120px', sortable: true },
    { key: 'publisher', label: ':: 출판사', width: '120px', sortable: true },
    { key: 'imprint', label: ':: 임프린트', width: '120px', sortable: true },
    { key: 'genre', label: ':: 장르', width: '120px', sortable: true },
    { key: 'total_volume', label: ':: 전체권수', width: '80px', sortable: true },
    { key: 'page_count', label: ':: 페이지수', width: '80px', sortable: true },
    { key: 'format', label: ':: 포맷', width: '80px', sortable: true }
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
          return valA - valB;
        }
        return String(valA).localeCompare(String(valB), 'ko');
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
  }, [files, sortKey, groupKey, t]);

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

  const handleRowClick = (file, e) => {
    if (!onSelect || !file.path) return;
    onSelect(file.path);
  };

  return (
    <div className="file-table-container" style={{ overflowX: 'auto', overflowY: 'auto', height: '100%', backgroundColor: '#2b2b2b' }}>
      <table className="file-table" style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', color: 'white', fontSize: '12px' }}>
        <thead style={{ position: 'sticky', top: 0, backgroundColor: '#1f1f1f', zIndex: 1 }}>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{
                  width: col.width,
                  minWidth: col.width,
                  padding: '5px',
                  border: '1px solid #444',
                  textAlign: 'left',
                  cursor: col.sortable ? 'pointer' : 'default',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap'
                }}
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
                  <td colSpan={columns.length} style={{ padding: '5px', backgroundColor: '#3a3a3a', fontWeight: 'bold' }}>
                    {groupName}
                  </td>
                </tr>
              )}
              {groupFiles.map((file, index) => (
                <tr
                  key={file.path || index}
                  style={{
                    backgroundColor: selectedFiles.includes(file.path) ? '#3a7ebf' : 'transparent',
                    cursor: 'pointer'
                  }}
                  onClick={(e) => handleRowClick(file, e)}
                >
                  <td className="cover-cell" style={{ padding: '2px', border: '1px solid #444', textAlign: 'center' }}>
                    {file.cover ? (
                      <img
                        src={file.cover}
                        alt=""
                        style={{ width: '32px', height: '44px', objectFit: 'cover' }}
                        loading="lazy"
                      />
                    ) : '-'}
                  </td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.resolution || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{formatSize(file.size)}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{formatDate(file.created)}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.series || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.name || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.title || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.volume || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.chapter || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.author || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{formatDate(file.modified)}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.series_group || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.producer || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.publisher || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.imprint || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.genre || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.total_volume || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.page_count || ''}</td>
                  <td style={{ padding: '4px', border: '1px solid #444' }}>{file.format || file.type || ''}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {files.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
          <div style={{ fontSize: '48px', opacity: 0.5 }}>📂</div>
          <div>파일이 없습니다</div>
        </div>
      )}
    </div>
  );
};

export { FileTableView };
export default FileTableView;
