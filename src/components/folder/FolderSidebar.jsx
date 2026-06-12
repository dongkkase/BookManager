import React, { useState } from 'react';

/**
 * 좌측 사이드바 컴포넌트
 * 라이브러리 목록, 즐겨찾기 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = [], favorites = ['temp', '책2', 'test'], selectedLibrary, onSelectLibrary, selectedFavorite, onSelectFavorite, selectedFolderPath, onSelectFolder }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());

  const toggleFolder = (path) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setExpandedFolders(next);
  };

  // 라이브러리 목록
  const renderLibraryList = () => (
    <div className="sidebar-section">
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>라이브러리</span>
        <button style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>⚙</button>
      </div>
      <ul className="nav-list">
        {libraries.length > 0 ? libraries.map((lib, idx) => (
          <li
            key={idx}
            className={selectedLibrary === idx ? 'selected' : ''}
            onClick={() => onSelectLibrary(idx)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>{lib.name || lib.path || `Library ${idx + 1}`}</span>
            <span>⋮</span>
          </li>
        )) : (
          <li className="selected" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>_만화</span>
            <span style={{ color: '#E67E22' }}>⚙ ⋮</span>
          </li>
        )}
      </ul>
    </div>
  );

  // 즐겨찾기 목록
  const renderFavoritesList = () => (
    <div className="sidebar-section" style={{ marginTop: '10px' }}>
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>즐겨찾기</span>
      </div>
      <ul className="nav-list">
        {favorites.map((fav, idx) => (
          <li
            key={idx}
            className={selectedFavorite === idx ? 'selected' : ''}
            onClick={() => onSelectFavorite(idx)}
          >
            {fav.name || fav || `Favorite ${idx + 1}`}
          </li>
        ))}
        {favorites.length === 0 && (
          <li style={{ color: '#888', fontStyle: 'italic', padding: '4px 8px' }}>
            즐겨찾기가 없습니다
          </li>
        )}
      </ul>
    </div>
  );

  // 폴더 트리 뷰 (재귀 렌더링)
  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = selectedFolderPath === node.path;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <li key={node.path} className="tree-node">
        <div
          className={isActive ? 'selected' : ''}
          style={{ 
            paddingLeft: `${8 + depth * 12}px`, 
            paddingTop: '4px', 
            paddingBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            color: '#d1d5db',
            fontSize: '12px'
          }}
          onClick={() => {
            onSelectFolder && onSelectFolder(node.path);
            if (hasChildren) toggleFolder(node.path);
          }}
        >
          <span style={{ width: '12px', display: 'inline-block', textAlign: 'center', marginRight: '4px', fontSize: '10px' }}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
          </span>
          <span style={{ marginRight: '4px' }}>{node.isFolder ? '📁' : '📄'}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        </div>
        {hasChildren && isExpanded && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  // 폴더 트리 구조 (데모 데이터)
  const treeData = [
    {
      name: 'Game (G:)',
      path: 'G:',
      isFolder: true,
      children: [
        { name: 'Ani', path: 'G:/Ani', isFolder: true, children: [] },
        { name: 'backup', path: 'G:/backup', isFolder: true, children: [] },
        { name: 'bak', path: 'G:/bak', isFolder: true, children: [] },
        { name: 'EpicGames', path: 'G:/EpicGames', isFolder: true, children: [] },
        {
          name: 'Mirror',
          path: 'G:/Mirror',
          isFolder: true,
          children: [
            {
              name: 'Book',
              path: 'G:/Mirror/Book',
              isFolder: true,
              children: [
                {
                  name: '_만화',
                  path: 'G:/Mirror/Book/_만화',
                  isFolder: true,
                  children: [
                    { name: '(만화) 어서 와, 아빠', path: 'G:/Mirror/Book/_만화/어서와 아빠', isFolder: true, children: [] }
                  ]
                }
              ]
            }
          ]
        }
      ],
    },
  ];

  const renderFolderTree = () => (
    <div className="sidebar-section" style={{ marginTop: '10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>폴더</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>🖥</button>
          <button style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>📥</button>
          <button style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>📤</button>
          <button style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>🏠</button>
        </div>
      </div>
      <ul className="nav-list" style={{ flex: 1, overflowY: 'auto' }}>
        {treeData.map(node => renderTreeNode(node))}
      </ul>
    </div>
  );

  return (
    <div className="folder-sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '4px' }}>
      {renderLibraryList()}
      {renderFavoritesList()}
      {renderFolderTree()}
    </div>
  );
}

export { FolderSidebar };
