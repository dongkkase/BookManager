import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FaIcon } from '../FaIcon';
import {
  ancestorPathsBetween,
  chooseTreeRoot,
  joinTreePath,
} from '../../folderTreeState';

/**
 * 좌측 사이드바 컴포넌트
 * 라이브러리 목록, 즐겨찾기 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = [], favorites = [], selectedLibrary, onSelectLibrary, selectedFavorite, onSelectFavorite, selectedFolderPath, onSelectFolder, onSelectLibraryFolder, onAddLibrary, onRemoveLibrary, onAddFavorite, onRemoveFavorite, onFolderContextMenu, onLibraryContextMenu, onOpenLibrarySettings, refreshToken = 0 }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [roots, setRoots] = useState([]);
  const [folderCache, setFolderCache] = useState({});
  const [specialPaths, setSpecialPaths] = useState({});
  const [selectedSource, setSelectedSource] = useState('');
  const treeListRef = useRef(null);
  const selectedNodeRef = useRef(null);

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
  }, [refreshToken]);

  useEffect(() => {
    window.electronAPI?.getSpecialPaths?.()
      .then(paths => setSpecialPaths(paths || {}))
      .catch(error => console.error('Failed to fetch special paths:', error));
  }, [refreshToken]);

  useEffect(() => {
    setFolderCache({});
  }, [refreshToken]);

  const loadFolder = async (folderPath, force = false) => {
    if (!force && folderCache[folderPath]) return folderCache[folderPath];
    try {
      if (window.electronAPI && window.electronAPI.readDir) {
        const items = await window.electronAPI.readDir(folderPath);
        const folders = items
          .filter(i => i.isDirectory)
          .map(i => ({
              name: i.name,
              path: joinTreePath(folderPath, i.name),
              isFolder: true
          }));
        setFolderCache(prev => ({ ...prev, [folderPath]: folders }));
        return folders;
      }
    } catch (error) {
      console.error('Failed to read dir:', error);
      setFolderCache(prev => ({ ...prev, [folderPath]: [] }));
    }
    return [];
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

  useEffect(() => {
    if (!selectedFolderPath || treeRoots.length === 0) return;
    let cancelled = false;

    const revealSelectedPath = async () => {
      const root = chooseTreeRoot(treeRoots, selectedFolderPath);
      if (!root) return;
      const ancestors = ancestorPathsBetween(root.path, selectedFolderPath);
      for (const ancestor of ancestors.slice(0, -1)) {
        if (cancelled) return;
        setExpandedFolders(current => new Set(current).add(ancestor));
        await loadFolder(ancestor);
      }
      window.requestAnimationFrame(() => {
        selectedNodeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    };

    revealSelectedPath();
    return () => {
      cancelled = true;
    };
  }, [selectedFolderPath, treeRoots]);

  // 라이브러리 목록
  const renderLibraryList = () => (
    <div className="sidebar-section">
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>{t('folder.sidebar.libraries') || '라이브러리'}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button title={t('tab_folder_settings')} onClick={onOpenLibrarySettings} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}><FaIcon name="gear" size={12} /></button>
          <button title={t('folder.sidebar.add_library') || '라이브러리 추가'} onClick={onAddLibrary} style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}>➕</button>
        </div>
      </div>
      <ul className="nav-list">
        {libraries.length > 0 ? libraries.map((lib, idx) => (
          <li
            key={idx}
            className={selectedSource === 'library' && (selectedLibrary === idx || selectedFolderPath === lib) ? 'selected' : ''}
            onClick={() => {
              setSelectedSource('library');
              if (onSelectLibrary) onSelectLibrary(idx);
              if (onSelectLibraryFolder) onSelectLibraryFolder(lib);
              else if (onSelectFolder) onSelectFolder(lib);
            }}
            onContextMenu={(event) => onLibraryContextMenu?.(event, lib)}
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
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>{t('folder.sidebar.favorites') || '즐겨찾기'}</span>
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
        {favorites.map((favorite, idx) => {
          const fav = typeof favorite === 'string' ? { name: favorite.split(/[\\/]/).pop() || favorite, path: favorite } : favorite;
          return (
          <li
            key={fav.path || idx}
            className={selectedSource === 'favorite' && (selectedFavorite === idx || selectedFolderPath === fav.path) ? 'selected' : ''}
            onClick={() => {
              setSelectedSource('favorite');
              if (onSelectFavorite) onSelectFavorite(idx);
              if (onSelectFolder) onSelectFolder(fav.path);
            }}
            onContextMenu={(event) => onFolderContextMenu?.(event, fav.path)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fav.path}>{fav.name}</span>
            <span
              onClick={(e) => { e.stopPropagation(); onRemoveFavorite && onRemoveFavorite(fav.path); }}
              style={{ cursor: 'pointer', color: '#ff6b6b' }}
              title={t('folder.sidebar.remove_favorite') || '제거'}
            >
              ✖
            </span>
          </li>
          );
        })}
        {favorites.length === 0 && (
          <li style={{ color: '#888', fontStyle: 'italic', padding: '4px 8px' }}>
            즐겨찾기가 없습니다
          </li>
        )}
      </ul>
    </div>
  );

  // 폴더 트리 뷰 (재귀 렌더링)
  const renderTreeNode = (node, depth = 0, siblings = []) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = selectedFolderPath === node.path;
    const children = folderCache[node.path] || [];
    
    // 이 노드가 자식을 가질 가능성이 있는지 (일단 폴더면 있다고 가정, 로드 후 비어있으면 없는 것으로 표시)
    const hasChildren = folderCache[node.path] ? children.length > 0 : true;

    return (
      <li key={node.path} className="tree-node">
        <div
          ref={isActive ? selectedNodeRef : null}
          className={isActive ? 'selected' : ''}
          style={{ 
            paddingLeft: `${8 + depth * 15}px`,
            paddingTop: '4px', 
            paddingBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            color: '#d1d5db',
            fontSize: 'var(--font-sm)'
          }}
          onClick={() => {
            setSelectedSource('tree');
            onSelectFolder && onSelectFolder(node.path);
            if (node.isFolder) toggleFolder(node.path);
          }}
          onContextMenu={(event) => onFolderContextMenu?.(event, node.path, siblings.map(item => item.path))}
        >
          <span style={{ width: 'var(--font-sm)', display: 'inline-block', textAlign: 'center', marginRight: '4px', fontSize: 'var(--font-2xs)' }}>
            {node.isFolder ? (hasChildren ? (isExpanded ? '▼' : '▶') : ' ') : ' '}
          </span>
          <span style={{ marginRight: '4px', display: 'inline-flex', color: node.isFolder ? '#f0b536' : '#b8c7d4' }}>
            <FaIcon name={node.isFolder ? 'folder' : 'file'} size={12} />
          </span>
          <span style={{ minWidth: 0, whiteSpace: 'nowrap' }}>{node.name}</span>
        </div>
        {node.isFolder && isExpanded && children.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {children.map(child => renderTreeNode(child, depth + 1, children))}
          </ul>
        )}
      </li>
    );
  };

  const renderFolderTree = () => (
    <div className="sidebar-section" style={{ marginTop: '10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>폴더</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            ['desktop', 'folder_desktop', 'desktop'],
            ['documents', 'folder_docs', 'fileLines'],
            ['downloads', 'folder_downloads', 'download'],
            ['home', 'folder_home', 'house'],
          ].map(([pathKey, labelKey, icon]) => (
            <button
              key={pathKey}
              title={String(t(labelKey)).replace(/^⭐\s*/, '')}
              onClick={async () => {
                const targetPath = specialPaths[pathKey];
                if (!targetPath) return;
                const moved = await onSelectFolder?.(targetPath);
                if (moved !== false) setSelectedSource('quick');
              }}
              style={{ backgroundColor: 'transparent', color: 'white', border: 'none', cursor: 'pointer' }}
            >
              <FaIcon name={icon} size={12} />
            </button>
          ))}
        </div>
      </div>
      <ul ref={treeListRef} className="nav-list folder-tree-list" style={{ flex: 1 }}>
        {treeRoots.map(node => renderTreeNode(node, 0, treeRoots))}
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
