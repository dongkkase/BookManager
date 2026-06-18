import React, { useState, useEffect, useMemo } from 'react';
import { FaIcon } from '../FaIcon';

/**
 * 좌측 사이드바 컴포넌트
 * 라이브러리 목록, 즐겨찾기 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = [], favorites = [], selectedLibrary, onSelectLibrary, selectedFavorite, onSelectFavorite, selectedFolderPath, onSelectFolder, onAddLibrary, onRemoveLibrary, onAddFavorite, onRemoveFavorite, onFolderContextMenu }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [roots, setRoots] = useState([]);
  const [folderCache, setFolderCache] = useState({});
  const [specialPaths, setSpecialPaths] = useState({});

  const treeRoots = useMemo(() => {
    const libraryNodes = (libraries || []).map(lib => ({
      name: lib.split(/[\\/]/).pop() || lib,
      path: lib,
      isFolder: true,
      isLibraryRoot: true,
    }));
    const libraryPathSet = new Set(libraryNodes.map(node => node.path));
    const systemRoots = roots.filter(root => !libraryPathSet.has(root.path));
    return [...libraryNodes, ...systemRoots];
  }, [libraries, roots]);

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

  useEffect(() => {
    window.electronAPI?.getSpecialPaths?.()
      .then(paths => setSpecialPaths(paths || {}))
      .catch(error => console.error('Failed to fetch special paths:', error));
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
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>{t('folder.sidebar.libraries') || '라이브러리'}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button title={t('folder.sidebar.add_library') || '라이브러리 추가'} onClick={onAddLibrary} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>➕</button>
        </div>
      </div>
      <ul className="nav-list">
        {libraries.length > 0 ? libraries.map((lib, idx) => (
          <li
            key={idx}
            className={selectedLibrary === idx || selectedFolderPath === lib ? 'selected' : ''}
            onClick={() => {
              if (onSelectLibrary) onSelectLibrary(idx);
              if (onSelectFolder) onSelectFolder(lib);
            }}
            onContextMenu={(event) => onFolderContextMenu?.(event, lib)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={lib}>{lib.split(/[\\/]/).pop() || lib}</span>
            <span
              onClick={(e) => { e.stopPropagation(); onRemoveLibrary && onRemoveLibrary(lib); }}
              style={{ cursor: 'pointer', color: '#ff6b6b' }}
              title={t('folder.sidebar.remove_library') || '제거'}
            >
              ✖
            </span>
          </li>
        )) : (
          <li style={{ color: '#888', fontStyle: 'italic', padding: '4px 8px' }}>
            라이브러리가 없습니다
          </li>
        )}
      </ul>
    </div>
  );

  // 즐겨찾기 목록
  const renderFavoritesList = () => (
    <div className="sidebar-section" style={{ marginTop: '10px' }}>
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>{t('folder.sidebar.favorites') || '즐겨찾기'}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            title={t('folder.sidebar.add_favorite') || '현재 폴더 즐겨찾기에 추가'}
            onClick={() => selectedFolderPath && onAddFavorite && onAddFavorite(selectedFolderPath)}
            style={{ backgroundColor: 'transparent', color: selectedFolderPath ? 'gold' : 'gray', border: 'none', cursor: selectedFolderPath ? 'pointer' : 'default' }}
            disabled={!selectedFolderPath}
          >
            ⭐
          </button>
        </div>
      </div>
      <ul className="nav-list">
        {favorites.map((fav, idx) => (
          <li
            key={idx}
            className={selectedFavorite === idx || selectedFolderPath === fav ? 'selected' : ''}
            onClick={() => {
              if (onSelectFavorite) onSelectFavorite(idx);
              if (onSelectFolder) onSelectFolder(fav);
            }}
            onContextMenu={(event) => onFolderContextMenu?.(event, fav)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fav}>{fav.split(/[\\/]/).pop() || fav}</span>
            <span
              onClick={(e) => { e.stopPropagation(); onRemoveFavorite && onRemoveFavorite(fav); }}
              style={{ cursor: 'pointer', color: '#ff6b6b' }}
              title={t('folder.sidebar.remove_favorite') || '제거'}
            >
              ✖
            </span>
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
          onContextMenu={(event) => onFolderContextMenu?.(event, node.path)}
        >
          <span style={{ width: '12px', display: 'inline-block', textAlign: 'center', marginRight: '4px', fontSize: '10px' }}>
            {node.isFolder ? (hasChildren ? (isExpanded ? '▼' : '▶') : ' ') : ' '}
          </span>
          <span style={{ marginRight: '4px', display: 'inline-flex', color: node.isFolder ? '#f0b536' : '#b8c7d4' }}>
            <FaIcon name={node.isFolder ? 'folder' : 'file'} size={12} />
          </span>
          <span style={{ minWidth: 0, whiteSpace: 'nowrap' }}>{node.name}</span>
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
          <button title="바탕화면" onClick={() => specialPaths.desktop && onSelectFolder?.(specialPaths.desktop)} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><FaIcon name="desktop" size={12} /></button>
          <button title="문서" onClick={() => specialPaths.documents && onSelectFolder?.(specialPaths.documents)} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><FaIcon name="fileLines" size={12} /></button>
          <button title="다운로드" onClick={() => specialPaths.downloads && onSelectFolder?.(specialPaths.downloads)} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><FaIcon name="download" size={12} /></button>
          <button title="홈" onClick={() => specialPaths.home && onSelectFolder?.(specialPaths.home)} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><FaIcon name="house" size={12} /></button>
        </div>
      </div>
      <ul className="nav-list folder-tree-list" style={{ flex: 1 }}>
        {treeRoots.map(node => renderTreeNode(node))}
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
