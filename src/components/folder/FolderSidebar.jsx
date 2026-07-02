import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FaIcon } from '../FaIcon';
import {
  ancestorPathsBetween,
  chooseTreeRoot,
  isSameOrDescendantPath,
  joinTreePath,
} from '../../folderTreeState';
import {
  isLibraryScanning,
  libraryStatusClass,
  libraryStatusText,
  normalizeLibraryKey,
  shouldShowLibrarySyncButton,
} from '../../folderLibraryStatus';
import {
  applyImmediateSingleSelection,
  scheduleAfterNextPaint,
} from '../../selectionVisualFeedback';

/**
 * 좌측 사이드바 컴포넌트
 * 라이브러리 목록, 즐겨찾기 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = [], favorites = [], selectedLibrary, onSelectLibrary, selectedFavorite, onSelectFavorite, selectedFolderPath, onSelectFolder, onSelectLibraryFolder, onAddLibrary, onAddFavorite, onFolderContextMenu, onLibraryContextMenu, onOpenLibrarySettings, onSyncLibrary, libraryScanStateMap = {}, refreshToken = 0 }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [roots, setRoots] = useState([]);
  const [folderCache, setFolderCache] = useState({});
  const [libraryFolderCounts, setLibraryFolderCounts] = useState({});
  const [specialPaths, setSpecialPaths] = useState({});
  const [selectedSource, setSelectedSource] = useState('');
  const [optimisticSelectedPath, setOptimisticSelectedPath] = useState('');
  const sidebarRef = useRef(null);
  const treeListRef = useRef(null);
  const selectedNodeRef = useRef(null);
  const folderCacheRef = useRef({});
  const folderLoadPromisesRef = useRef(new Map());
  const pendingNavigationRef = useRef(null);

  const focusSelectedNode = (block = 'nearest', behavior = 'auto') => {
    const node = selectedNodeRef.current;
    if (!node) return;
    node.focus?.({ preventScroll: true });
    node.scrollIntoView?.({ block, inline: 'nearest', behavior });
  };

  const tooltipText = value => String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trimStart();
  const applySidebarSelection = useCallback(event => {
    applyImmediateSingleSelection(
      sidebarRef.current,
      event.currentTarget,
      '[data-folder-sidebar-path]',
    );
  }, []);
  const scheduleSidebarNavigation = useCallback(callback => {
    pendingNavigationRef.current?.();
    pendingNavigationRef.current = scheduleAfterNextPaint(() => {
      pendingNavigationRef.current = null;
      callback?.();
    });
  }, []);

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

  const findContainingLibraryRoot = useCallback(folderPath => (
    (libraries || [])
      .filter(lib => isSameOrDescendantPath(folderPath, lib))
      .sort((left, right) => String(right).length - String(left).length)[0] || ''
  ), [libraries]);

  const readLiveFolderChildren = useCallback(async folderPath => {
    if (!window.electronAPI?.readDir) return [];
    const items = await window.electronAPI.readDir(folderPath);
    return (Array.isArray(items) ? items : [])
      .filter(i => i.isDirectory)
      .map(i => ({
        name: i.name,
        path: joinTreePath(folderPath, i.name),
        isFolder: true,
      }));
  }, []);

  const readIndexedLibraryFolderChildren = useCallback(async folderPath => {
    const libraryRoot = findContainingLibraryRoot(folderPath);
    if (!libraryRoot || !window.electronAPI?.getLibraryFolderChildren) return null;
    const result = await window.electronAPI.getLibraryFolderChildren(libraryRoot, folderPath);
    if (!result?.indexed) return null;
    return (Array.isArray(result.children) ? result.children : []).map(child => ({
      name: child.name,
      path: child.path,
      isFolder: true,
      isIndexedLibraryFolder: true,
      childFolderCount: Number(child.childFolderCount) || 0,
      directFileCount: Number(child.directFileCount) || 0,
      recursiveFileCount: Number(child.recursiveFileCount) || 0,
    }));
  }, [findContainingLibraryRoot]);

  useEffect(() => {
    setOptimisticSelectedPath('');
  }, [selectedFolderPath]);

  useEffect(() => () => {
    pendingNavigationRef.current?.();
  }, []);

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
    folderLoadPromisesRef.current.clear();
    setFolderCache({});
  }, [refreshToken]);

  useEffect(() => {
    folderCacheRef.current = folderCache;
  }, [folderCache]);

  useEffect(() => {
    let cancelled = false;
    const loadLibraryFolderCounts = async () => {
      const counts = {};
      await Promise.all((libraries || []).map(async lib => {
        const key = normalizeLibraryKey(lib);
        counts[key] = 0;
        try {
          const indexedChildren = await readIndexedLibraryFolderChildren(lib);
          if (indexedChildren) {
            counts[key] = indexedChildren.length;
            return;
          }
          const liveChildren = await readLiveFolderChildren(lib);
          counts[key] = liveChildren.length;
        } catch (error) {
          console.error('Failed to count library folders:', error);
        }
      }));
      if (!cancelled) setLibraryFolderCounts(counts);
    };
    loadLibraryFolderCounts();
    return () => {
      cancelled = true;
    };
  }, [libraries, readIndexedLibraryFolderChildren, readLiveFolderChildren, refreshToken]);

  const loadFolder = useCallback(async (folderPath, force = false) => {
    if (!force && folderCacheRef.current[folderPath]) return folderCacheRef.current[folderPath];
    if (!force && folderLoadPromisesRef.current.has(folderPath)) {
      return folderLoadPromisesRef.current.get(folderPath);
    }
    const promise = (async () => {
      try {
        const indexedFolders = await readIndexedLibraryFolderChildren(folderPath);
        const folders = indexedFolders || await readLiveFolderChildren(folderPath);
        setFolderCache(prev => ({ ...prev, [folderPath]: folders }));
        return folders;
      } catch (error) {
        console.error('Failed to read dir:', error);
        setFolderCache(prev => ({ ...prev, [folderPath]: [] }));
      }
      return [];
    })().finally(() => {
      folderLoadPromisesRef.current.delete(folderPath);
    });
    folderLoadPromisesRef.current.set(folderPath, promise);
    return promise;
  }, [readIndexedLibraryFolderChildren, readLiveFolderChildren]);

  const toggleFolder = useCallback((path) => {
    setExpandedFolders(current => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        loadFolder(path);
      }
      return next;
    });
  }, [loadFolder]);

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
        window.requestAnimationFrame(() => focusSelectedNode('center'));
      });
    };

    revealSelectedPath();
    return () => {
      cancelled = true;
    };
  }, [loadFolder, selectedFolderPath, treeRoots]);

  useEffect(() => {
    if (!selectedFolderPath) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => focusSelectedNode('nearest'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFolderPath, expandedFolders]);

  // 라이브러리 목록
  const renderLibraryList = () => (
    <div className="sidebar-section">
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>{t('folder.sidebar.libraries')}</span>
        <div className="folder-sidebar-header-actions">
          <button
            type="button"
            className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"
            title={t('tab_folder_settings')}
            aria-label={t('tab_folder_settings')}
            data-tooltip={t('tab_folder_settings')}
            onClick={onOpenLibrarySettings}
          >
            <FaIcon name="gear" size={12} />
          </button>
          <button
            type="button"
            className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"
            title={t('folder.sidebar.add_library')}
            aria-label={t('folder.sidebar.add_library')}
            data-tooltip={t('folder.sidebar.add_library')}
            onClick={onAddLibrary}
          >
            <FaIcon name="plus" size={12} />
          </button>
        </div>
      </div>
      <ul className="nav-list">
        {libraries.length > 0 ? libraries.map((lib, idx) => {
          const libraryKey = normalizeLibraryKey(lib);
          const scanState = libraryScanStateMap[libraryKey];
          const libraryMetaText = libraryStatusText(t, scanState, {
            folderCount: libraryFolderCounts[libraryKey] || 0,
          });
          const isSyncing = isLibraryScanning(scanState);
          const showSyncButton = shouldShowLibrarySyncButton(scanState);
          const selectedPath = optimisticSelectedPath || selectedFolderPath;
          return (
          <li
            key={idx}
            data-folder-sidebar-path={lib}
            className={`library-list-item ${selectedSource === 'library' && (selectedLibrary === idx || selectedPath === lib) ? 'selected' : ''}`}
            onClick={(event) => {
              applySidebarSelection(event);
              setSelectedSource('library');
              setOptimisticSelectedPath(lib);
              if (onSelectLibrary) onSelectLibrary(idx);
              scheduleSidebarNavigation(() => {
                if (onSelectLibraryFolder) onSelectLibraryFolder(lib);
                else if (onSelectFolder) onSelectFolder(lib);
              });
            }}
            onContextMenu={(event) => onLibraryContextMenu?.(event, lib)}
          >
            <div className="library-list-main" title={`${lib}\n${libraryMetaText}`}>
              <span className="library-list-name">{lib.split(/[\\/]/).pop() || lib}</span>
              <span className={`library-scan-status ${libraryStatusClass(scanState)}`}>
                {libraryMetaText}
              </span>
            </div>
            <div className="library-list-actions">
              {showSyncButton && (
                <button
                  type="button"
                  className="library-sync-btn"
                  disabled={isSyncing}
                  title={t('folder_library_manual_scan')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSyncLibrary?.(lib, false);
                  }}
                >
                  <FaIcon name="arrowRotateLeft" size={11} />
                </button>
              )}
              <button
                type="button"
                className="library-menu-btn folder-sidebar-tooltip-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onLibraryContextMenu?.(event, lib);
                }}
                title={t('folder.sidebar.more_actions')}
                aria-label={t('folder.sidebar.more_actions')}
                data-tooltip={t('folder.sidebar.more_actions')}
              >
                <FaIcon name="ellipsisVertical" size={12} />
              </button>
            </div>
          </li>
          );
        }) : (
          <li style={{ color: '#888', fontStyle: 'italic', padding: '4px 8px' }}>
            {t('folder.sidebar.empty_libraries')}
          </li>
        )}
      </ul>
    </div>
  );

  // 즐겨찾기 목록
  const renderFavoritesList = () => (
    <div className="sidebar-section" style={{ marginTop: '10px' }}>
      <div className="nav-header">
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>{t('folder.sidebar.favorites')}</span>
        <div className="folder-sidebar-header-actions">
          <button
            type="button"
            className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn favorite-add-btn"
            title={t('folder.sidebar.add_favorite')}
            aria-label={t('folder.sidebar.add_favorite')}
            data-tooltip={t('folder.sidebar.add_favorite')}
            onClick={() => selectedFolderPath && onAddFavorite && onAddFavorite(selectedFolderPath)}
            disabled={!selectedFolderPath}
          >
            <FaIcon name="star" size={12} />
          </button>
        </div>
      </div>
      <ul className="nav-list">
        {favorites.map((favorite, idx) => {
          const fav = typeof favorite === 'string' ? { name: favorite.split(/[\\/]/).pop() || favorite, path: favorite } : favorite;
          return (
          <li
            key={fav.path || idx}
            data-folder-sidebar-path={fav.path}
            className={selectedSource === 'favorite' && (selectedFavorite === idx || (optimisticSelectedPath || selectedFolderPath) === fav.path) ? 'selected' : ''}
            onClick={(event) => {
              applySidebarSelection(event);
              setSelectedSource('favorite');
              setOptimisticSelectedPath(fav.path);
              if (onSelectFavorite) onSelectFavorite(idx);
              scheduleSidebarNavigation(() => onSelectFolder?.(fav.path));
            }}
            onContextMenu={(event) => onFolderContextMenu?.(event, fav.path)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={fav.path}>{fav.name}</span>
            <button
              type="button"
              className="favorite-menu-btn folder-sidebar-tooltip-btn"
              onClick={(event) => {
                event.stopPropagation();
                onFolderContextMenu?.(event, fav.path);
              }}
              title={t('folder.sidebar.more_actions')}
              aria-label={t('folder.sidebar.more_actions')}
              data-tooltip={t('folder.sidebar.more_actions')}
            >
              <FaIcon name="ellipsisVertical" size={12} />
            </button>
          </li>
          );
        })}
        {favorites.length === 0 && (
          <li style={{ color: '#888', fontStyle: 'italic', padding: '4px 8px' }}>
            {t('folder.sidebar.empty_favorites')}
          </li>
        )}
      </ul>
    </div>
  );

  // 폴더 트리 뷰 (재귀 렌더링)
  const renderTreeNode = (node, depth = 0, siblings = []) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = (optimisticSelectedPath || selectedFolderPath) === node.path;
    const children = folderCache[node.path] || [];
    
    // 이 노드가 자식을 가질 가능성이 있는지 (일단 폴더면 있다고 가정, 로드 후 비어있으면 없는 것으로 표시)
    const hasChildren = folderCache[node.path]
      ? children.length > 0
      : node.childFolderCount !== undefined ? node.childFolderCount > 0 : true;

    return (
      <li key={node.path} className="tree-node">
        <div
          ref={isActive ? selectedNodeRef : null}
          data-folder-sidebar-path={node.path}
          tabIndex={isActive ? -1 : undefined}
          className={isActive ? 'selected' : ''}
          style={{ 
            '--folder-tree-indent': `${7 + depth * 10}px`,
            paddingTop: '4px', 
            paddingBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            color: '#d1d5db',
            fontSize: 'var(--font-sm)'
          }}
          onClick={(event) => {
            applySidebarSelection(event);
            setSelectedSource('tree');
            setOptimisticSelectedPath(node.path);
            scheduleSidebarNavigation(() => {
              onSelectFolder?.(node.path, { source: 'tree' });
            });
          }}
          onDoubleClick={() => {
            if (node.isFolder) toggleFolder(node.path);
          }}
          onContextMenu={(event) => {
            if (node.isLibraryRoot) {
              onLibraryContextMenu?.(event, node.path);
              return;
            }
            onFolderContextMenu?.(event, node.path, siblings.map(item => item.path));
          }}
        >
          <span
            className="folder-tree-expander"
            style={{ visibility: node.isFolder && hasChildren ? 'visible' : 'hidden' }}
            role="button"
            aria-label={isExpanded ? '접기' : '펼치기'}
            onClick={(event) => {
              event.stopPropagation();
              if (node.isFolder) toggleFolder(node.path);
            }}
          >
            <FaIcon name={isExpanded ? 'angleDown' : 'chevronRight'} size={10} />
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
        <span style={{ color: 'white', fontWeight: 'bold', fontSize: 'var(--font-base)' }}>{t('folder.sidebar.folders')}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            ['desktop', 'folder_desktop', 'desktop'],
            ['documents', 'folder_docs', 'fileLines'],
            ['downloads', 'folder_downloads', 'download'],
            ['home', 'folder_home', 'house'],
          ].map(([pathKey, labelKey, icon]) => {
            const label = tooltipText(t(labelKey));
            return (
              <button
                key={pathKey}
                type="button"
                className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"
                title={label}
                aria-label={label}
                data-tooltip={label}
                onClick={async () => {
                  const targetPath = specialPaths[pathKey];
                  if (!targetPath) return;
                  setOptimisticSelectedPath(targetPath);
                  scheduleSidebarNavigation(async () => {
                    const moved = await onSelectFolder?.(targetPath);
                    if (moved !== false) setSelectedSource('quick');
                  });
                }}
              >
                <FaIcon name={icon} size={12} />
              </button>
            );
          })}
        </div>
      </div>
      <ul ref={treeListRef} className="nav-list folder-tree-list" style={{ flex: 1 }}>
        {treeRoots.map(node => renderTreeNode(node, 0, treeRoots))}
      </ul>
    </div>
  );

  return (
    <div ref={sidebarRef} className="folder-sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '4px' }}>
      {renderLibraryList()}
      {renderFavoritesList()}
      {renderFolderTree()}
    </div>
  );
}

export { FolderSidebar };
export default FolderSidebar;
