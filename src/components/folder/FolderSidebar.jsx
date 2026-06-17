import React, { useState, useEffect } from 'react';

/**
 * 좌측 사이드바 컴포넌트
 * 라이브러리 목록, 즐겨찾기 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = [], favorites = ['temp', '책2', 'test'], selectedLibrary, onSelectLibrary, selectedFavorite, onSelectFavorite, selectedFolderPath, onSelectFolder }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [roots, setRoots] = useState([]);
  const [folderCache, setFolderCache] = useState({});

  useEffect(() => {
    const fetchRoots = async () => {
      try {
        if (window.electronAPI && window.electronAPI.getRoots) {
          const fetchedRoots = await window.electronAPI.getRoots();
          const rootNodes = fetchedRoots.map(r => ({ name: r, path: r, isFolder: true }));
          setRoots(rootNodes);
        }
      } catch (error) {
        console.error('Failed to fetch roots:', error);
      }
    };
    fetchRoots();
  }, []);

  const loadFolder = async (folderPath) => {
    if (folderCache[folderPath]) return; // 이미 로드됨
    try {
      if (window.electronAPI && window.electronAPI.readDir) {
        const items = await window.electronAPI.readDir(folderPath);
        const folders = items
          .filter(i => i.isDirectory)
          .map(i => {
            // 경로 결합 처리 (간단한 구현)
            const separator = folderPath.endsWith('/') || folderPath.endsWith('\\') ? '' : '/';
            return {
              name: i.name,
              path: folderPath + separator + i.name,
              isFolder: true
            };
          });
        setFolderCache(prev => ({ ...prev, [folderPath]: folders }));
      }
    } catch (error) {
      console.error('Failed to read dir:', error);
      setFolderCache(prev => ({ ...prev, [folderPath]: [] }));
    }
  };

  const toggleFolder = (path) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      loadFolder(path);
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
    const children = folderCache[node.path] || [];
    
    // 이 노드가 자식을 가질 가능성이 있는지 (일단 폴더면 있다고 가정, 로드 후 비어있으면 없는 것으로 표시)
    const hasChildren = folderCache[node.path] ? children.length > 0 : true;

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
            if (node.isFolder) toggleFolder(node.path);
          }}
        >
          <span style={{ width: '12px', display: 'inline-block', textAlign: 'center', marginRight: '4px', fontSize: '10px' }}>
            {node.isFolder ? (hasChildren ? (isExpanded ? '▼' : '▶') : ' ') : ' '}
          </span>
          <span style={{ marginRight: '4px' }}>{node.isFolder ? (isExpanded ? '📂' : '📁') : '📄'}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        </div>
        {node.isFolder && isExpanded && children.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {children.map(child => renderTreeNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

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
        {roots.map(node => renderTreeNode(node))}
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
export default FolderSidebar;
