import React, { useState, useRef, useEffect } from 'react';

/**
 * 폴더 탭 툴바 컴포넌트
 * 그룹화, 정렬, 뷰 모드 토글, 하위 폴더 포함, 중복 검사 버튼 포함
 */
function FolderToolbar({ t, viewMode, setViewMode, sortKey, setSortKey, groupKey, setGroupKey, includeSubfolders, setIncludeSubfolders, enableDupCheck, setEnableDupCheck, onRefresh }) {
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const sortRef = useRef(null);
  const groupRef = useRef(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setSortDropdownOpen(false);
      }
      if (groupRef.current && !groupRef.current.contains(event.target)) {
        setGroupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 정렬 옵션
  const sortOptions = [
    { key: 'name', label: t('folder.columns.name') || '이름' },
    { key: 'size', label: t('folder.columns.size') || '크기' },
    { key: 'modified', label: t('folder.columns.modified') || '수정일' },
    { key: 'series', label: t('folder.columns.series') || '시리즈' },
    { key: 'volume', label: t('folder.columns.volume') || '권' },
  ];

  // 그룹화 옵션
  const groupOptions = [
    { key: 'none', label: t('folder.toolbar.no_group') || '없음' },
    { key: 'series', label: t('folder.columns.series') || '시리즈' },
    { key: 'volume', label: t('folder.columns.volume') || '권' },
    { key: 'type', label: t('folder.toolbar.group_by_type') || '파일 유형' },
  ];

  return (
    <div className="folder-toolbar">
      {/* 그룹화 그룹 */}
      <div className="toolbar-group">
        <div className="toolbar-dropdown" ref={groupRef}>
          <button
            className="toolbar-btn"
            onClick={() => { setGroupDropdownOpen(!groupDropdownOpen); setSortDropdownOpen(false); }}
          >
            <span className="btn-icon">📑</span>
            {t('folder.toolbar.group_by') || '그룹화'}
          </button>
          {groupDropdownOpen && (
            <div className="dropdown-menu">
              {groupOptions.map(opt => (
                <div
                  key={opt.key}
                  className={`dropdown-item ${groupKey === opt.key ? 'active' : ''}`}
                  onClick={() => { setGroupKey(opt.key); setGroupDropdownOpen(false); }}
                >
                  <span className="check-mark">{groupKey === opt.key ? '✓' : ''}</span>
                  {opt.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 정렬 그룹 */}
      <div className="toolbar-group">
        <div className="toolbar-dropdown" ref={sortRef}>
          <button
            className="toolbar-btn"
            onClick={() => { setSortDropdownOpen(!sortDropdownOpen); setGroupDropdownOpen(false); }}
          >
            <span className="btn-icon">🔢</span>
            {t('folder.toolbar.sort_by') || '정렬'}
          </button>
          {sortDropdownOpen && (
            <div className="dropdown-menu">
              {sortOptions.map(opt => (
                <div
                  key={opt.key}
                  className={`dropdown-item ${sortKey === opt.key ? 'active' : ''}`}
                  onClick={() => { setSortKey(opt.key); setSortDropdownOpen(false); }}
                >
                  <span className="check-mark">{sortKey === opt.key ? '✓' : ''}</span>
                  {opt.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 뷰 모드 그룹 */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${viewMode === 'detail' ? 'active' : ''}`}
          onClick={() => setViewMode('detail')}
          title={t('folder.toolbar.view_detail') || '상세'}
        >
          <span className="btn-icon">📋</span>
        </button>
        <button
          className={`toolbar-btn ${viewMode === 'thumbnail' ? 'active' : ''}`}
          onClick={() => setViewMode('thumbnail')}
          title={t('folder.toolbar.view_thumbnail') || '썸네일'}
        >
          <span className="btn-icon">🖼️</span>
        </button>
        <button
          className={`toolbar-btn ${viewMode === 'tile' ? 'active' : ''}`}
          onClick={() => setViewMode('tile')}
          title={t('folder.toolbar.view_tile') || '타일'}
        >
          <span className="btn-icon">🔲</span>
        </button>
      </div>

      {/* 토글 그룹 */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${includeSubfolders ? 'active' : ''}`}
          onClick={() => setIncludeSubfolders(!includeSubfolders)}
          title={t('folder.toolbar.include_subfolders') || '하위 폴더 포함'}
        >
          <span className="btn-icon">📂</span>
        </button>
        <button
          className={`toolbar-btn ${enableDupCheck ? 'active' : ''}`}
          onClick={() => setEnableDupCheck(!enableDupCheck)}
          title={t('folder.toolbar.dup_check') || '중복 검사'}
        >
          <span className="btn-icon">🔍</span>
        </button>
      </div>

      {/* 새로고침 */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onRefresh}
          title={t('folder.toolbar.refresh') || '새로고침'}
        >
          <span className="btn-icon">🔄</span>
        </button>
      </div>
    </div>
  );
}

export { FolderToolbar };
