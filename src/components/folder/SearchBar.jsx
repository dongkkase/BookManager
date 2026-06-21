import React from 'react';

/**
 * 폴더 탭 검색 바 컴포넌트
 * 파일 검색 입력 필드 제공
 */
function SearchBar({ searchQuery = '', onSearchChange, t }) {
  const handleClear = () => {
    onSearchChange('');
  };

  return (
    <div className="folder-search-bar">
      <input
        type="text"
        className="folder-search-input"
        placeholder={t('folder.toolbar.search')}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {searchQuery && (
        <button
          className="toolbar-btn"
          onClick={handleClear}
          title={t('common.close')}
          style={{ padding: '4px 8px', fontSize: 'var(--font-md)' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export { SearchBar };
