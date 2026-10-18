import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import MenuSurface from '../MenuSurface';
import {
  ancestorPathsBetween,
  chooseTreeRoot,
  isSameOrDescendantPath,
  joinTreePath,
} from '../../folderTreeState';
import {
    libraryScanStatusText,
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
import { buildLibraryItems, groupLibraryItems } from '../../libraryPresentation.js';
import { createFolderTreeLoader } from '../../folderTreeLoader.js';
import FolderTree from './FolderTree.jsx';

const EMPTY_ITEMS = [];

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'bookmanager.folderSidebar.collapsedSections';
const LIBRARY_VISIBLE_COUNT_STORAGE_KEY = 'bookmanager.folderSidebar.libraryVisibleCount';
const LIBRARY_VISIBLE_COUNTS = [5, 8, 12, 20, 0];
const LIBRARY_DISPLAY_FIELDS_STORAGE_KEY = 'bookmanager.folderSidebar.libraryDisplayFields';
const LIBRARY_DISPLAY_FIELDS = [
    ['folders', 'folder_library_show_folders'],
    ['files', 'folder_library_show_files'],
    ['updatedAt', 'folder_library_show_updated'],
];

function readStoredLibraryVisibleCount() {
    try {
        const count = Number(window.localStorage.getItem(LIBRARY_VISIBLE_COUNT_STORAGE_KEY) ?? 5);
        return LIBRARY_VISIBLE_COUNTS.includes(count) ? count : 5;
    } catch {
        return 5;
    }
}

function readStoredLibraryDisplayFields() {
    let stored;
    try {
        stored = JSON.parse(window.localStorage.getItem(LIBRARY_DISPLAY_FIELDS_STORAGE_KEY));
    } catch {
        stored = null;
    }
    return Object.fromEntries(LIBRARY_DISPLAY_FIELDS.map(([key]) => [key, stored?.[key] !== false]));
}

function LibraryDisplayOptions({ value, onChange, fields, onToggleField, t }) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const closeMenu = useCallback(() => {
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
    }, []);

    useLayoutEffect(() => {
        if (!open || !menuRef.current || !buttonRef.current) return;
        const anchor = buttonRef.current.getBoundingClientRect();
        const menu = menuRef.current.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8));
        const top = anchor.bottom + menu.height + 4 <= window.innerHeight - 8
            ? anchor.bottom + 4 : Math.max(8, anchor.top - menu.height - 4);
        setPosition({ left, top });
    }, [open]);

    useLayoutEffect(() => {
        if (open && position) menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]')?.focus({ preventScroll: true });
    }, [open, position]);

    useEffect(() => {
        if (!open) return;
        const onOutsidePointer = event => {
            if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
        };
        const onViewportChange = event => {
            if (!menuRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
        };
        document.addEventListener('pointerdown', onOutsidePointer);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        document.addEventListener('scroll', onViewportChange, true);
        return () => {
            document.removeEventListener('pointerdown', onOutsidePointer);
            document.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', onViewportChange);
            document.removeEventListener('scroll', onViewportChange, true);
        };
    }, [open, closeMenu]);

    return <>
        <button
            ref={buttonRef}
            type="button"
            className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn library-display-options-button"
            aria-label={t('folder_library_display_options')}
            data-tooltip={t('folder_library_display_options')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
                setPosition(null);
                setOpen(current => !current);
            }}
        >
            <FaIcon name="ellipsisVertical" size={12} />
        </button>
        {typeof document !== 'undefined' && createPortal(
            <MenuSurface
                open={open}
                origin="top right"
                ref={menuRef}
                className="folder-context-menu library-display-options-menu"
                role="menu"
                aria-label={t('folder_library_display_options')}
                style={position || { left: 0, top: 0, visibility: 'hidden' }}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Tab') {
                        setOpen(false);
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const options = Array.from(event.currentTarget.querySelectorAll('button'));
                        const current = options.indexOf(document.activeElement);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                            : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                        options[next]?.focus();
                    }
                }}
            >
                {open && <>
                {LIBRARY_VISIBLE_COUNTS.map(count => (
                    <button
                        key={count}
                        type="button"
                        role="menuitemradio"
                        aria-checked={value === count}
                        onClick={() => {
                            onChange(count);
                            closeMenu();
                        }}
                    >
                        <span className="folder-context-menu-icon">{value === count && <FaIcon name="check" size={12} />}</span>
                        <span>{t(count === 0 ? 'folder_library_show_all' : 'folder_library_show_items', [count])}</span>
                    </button>
                ))}
                <div className="folder-context-menu-separator" role="separator" />
                {LIBRARY_DISPLAY_FIELDS.map(([key, labelKey]) => (
                    <button
                        key={key}
                        type="button"
                        role="menuitemcheckbox"
                        className="library-display-field-option"
                        aria-checked={fields[key]}
                        onClick={() => onToggleField(key)}
                    >
                        <span>{t(labelKey)}</span>
                        <span className="library-display-field-switch" aria-hidden="true" />
                    </button>
                ))}
                </>}
            </MenuSurface>,
            document.body,
        )}
    </>;
}

function readStoredSidebarCollapseState() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 좌측 사이드바 컴포넌트
 * 읽기 목록, 라이브러리 목록, 폴더 트리 뷰를 포함
 */
function FolderSidebar({ t, libraries = EMPTY_ITEMS, libraryEntries = EMPTY_ITEMS, favorites = EMPTY_ITEMS, selectedLibrary, onSelectLibrary, selectedFolderPath, onSelectFolder, onSelectLibraryFolder, onFolderContextMenu, onLibraryContextMenu, onOpenLibrarySettings, onSyncLibrary, recentReadingSelected = false, recentReadingCount = 0, onSelectRecentReading, readingListSelected = '', recentAddedCount = 0, recentUpdatedCount = 0, wishlistCount = 0, collectionCount = 0, onSelectReadingList, missingCount = 0, onCheckMissingVolumes, isCheckingMissing = false, missingCheckDisabled = false, libraryScanStateMap = {}, refreshToken = 0, onRefresh, refreshing = false, refreshDisabled = false }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [collapsedSections, setCollapsedSections] = useState(readStoredSidebarCollapseState);
    const [libraryVisibleCount, setLibraryVisibleCount] = useState(readStoredLibraryVisibleCount);
    const [libraryDisplayFields, setLibraryDisplayFields] = useState(readStoredLibraryDisplayFields);
    const [libraryListHeight, setLibraryListHeight] = useState(null);
    const libraryListRef = useRef(null);
  const [roots, setRoots] = useState([]);
    const [folderEntries, setFolderEntries] = useState({});
  const [specialPaths, setSpecialPaths] = useState({});
  const [selectedSource, setSelectedSource] = useState('');
  const [optimisticSelectedPath, setOptimisticSelectedPath] = useState('');
  const sidebarRef = useRef(null);
    const folderLoaderRef = useRef(null);
    const folderReaderRef = useRef(null);
  const pendingNavigationRef = useRef(null);

  const tooltipText = value => String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trimStart();
    const libraryRootPathsKey = JSON.stringify([...new Set(libraries)].sort());
    const libraryRootPaths = useMemo(() => JSON.parse(libraryRootPathsKey), [libraryRootPathsKey]);
    const libraryItems = useMemo(() => buildLibraryItems(libraries, libraryEntries), [libraries, libraryEntries]);
    const groupedLibraryItems = useMemo(() => groupLibraryItems(libraryItems), [libraryItems]);
    const libraryFolderCounts = useMemo(() => Object.fromEntries(libraryItems.map(item => [
        normalizeLibraryKey(item.path), folderEntries[item.path]?.children.length || 0,
    ])), [libraryItems, folderEntries]);
    useEffect(() => {
        try {
            window.localStorage.setItem(LIBRARY_VISIBLE_COUNT_STORAGE_KEY, String(libraryVisibleCount));
        } catch {
            // Keep the current choice when local storage is unavailable.
        }
    }, [libraryVisibleCount]);
    useEffect(() => {
        try {
            window.localStorage.setItem(LIBRARY_DISPLAY_FIELDS_STORAGE_KEY, JSON.stringify(libraryDisplayFields));
        } catch {
            // Keep the current choice when local storage is unavailable.
        }
    }, [libraryDisplayFields]);
    useLayoutEffect(() => {
        const list = libraryListRef.current;
        if (!list) return;
        const measure = () => {
            const rows = list.querySelectorAll('.library-list-item');
            const count = libraryVisibleCount || rows.length;
            const lastVisible = rows[Math.min(count, rows.length) - 1] || list.lastElementChild;
            if (!lastVisible) return;
            const bottomPadding = parseFloat(window.getComputedStyle(list).paddingBottom) || 0;
            const height = Math.ceil(lastVisible.getBoundingClientRect().bottom - list.getBoundingClientRect().top
                + list.scrollTop + bottomPadding);
            setLibraryListHeight(current => current === height ? current : height);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        Array.from(list.children).forEach(child => observer.observe(child));
        return () => observer.disconnect();
    }, [libraryVisibleCount, groupedLibraryItems, collapsedSections.libraries]);
  const isSectionCollapsed = useCallback(sectionKey => Boolean(collapsedSections[sectionKey]), [collapsedSections]);
  const toggleSidebarSection = useCallback(sectionKey => {
    setCollapsedSections(current => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  }, []);
  const sectionToggleLabel = useCallback((sectionLabel, collapsed) => (
    t(collapsed ? 'folder.sidebar.expand_section' : 'folder.sidebar.collapse_section', [sectionLabel])
  ), [t]);
  const renderSectionToggle = useCallback((sectionKey, sectionLabel) => {
    const collapsed = isSectionCollapsed(sectionKey);
    const label = sectionToggleLabel(sectionLabel, collapsed);
    return (
      <button
        type="button"
        className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn sidebar-section-toggle-btn"
        aria-label={label}
        aria-expanded={!collapsed}
        data-tooltip={label}
        onClick={() => toggleSidebarSection(sectionKey)}
      >
        <FaIcon name={collapsed ? 'chevronRight' : 'angleDown'} size={10} />
      </button>
    );
  }, [isSectionCollapsed, sectionToggleLabel, toggleSidebarSection]);
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
    const libraryNodes = libraryItems.map(item => ({
      name: item.name,
      path: item.path,
      isFolder: true,
      isLibraryRoot: true,
    }));
    const libraryPathSet = new Set(libraryNodes.map(node => node.path));
    const systemRoots = roots.filter(root => !libraryPathSet.has(root.path));
    return [...libraryNodes, ...systemRoots];
  }, [libraryItems, roots]);

  const findContainingLibraryRoot = useCallback(folderPath => (
    libraryRootPaths
      .filter(lib => isSameOrDescendantPath(folderPath, lib))
      .sort((left, right) => String(right).length - String(left).length)[0] || ''
  ), [libraryRootPaths]);

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

    const readFolderChildren = useCallback(async folderPath => {
        const indexedFolders = await readIndexedLibraryFolderChildren(folderPath);
        return indexedFolders || await readLiveFolderChildren(folderPath);
    }, [readIndexedLibraryFolderChildren, readLiveFolderChildren]);
    folderReaderRef.current = readFolderChildren;

    useEffect(() => {
        const loader = createFolderTreeLoader({
            readChildren: folderPath => folderReaderRef.current(folderPath),
            onChange: (folderPath, entry) => setFolderEntries(current => ({ ...current, [folderPath]: entry })),
        });
        folderLoaderRef.current = loader;
        return () => {
            loader.dispose();
            if (folderLoaderRef.current === loader) folderLoaderRef.current = null;
        };
    }, []);

    const loadFolder = useCallback(folderPath => (
        folderLoaderRef.current?.load(folderPath, { priority: true }) || Promise.resolve([])
    ), []);

    useEffect(() => {
        folderLoaderRef.current?.reset();
        setFolderEntries({});
        libraryRootPaths.forEach(path => folderLoaderRef.current?.load(path));
    }, [refreshToken, readFolderChildren, libraryRootPaths]);

    useEffect(() => {
        const visited = new Set();
        const loadExpanded = nodes => {
            for (const node of nodes) {
                if (visited.has(node.path)) continue;
                visited.add(node.path);
                if (!expandedFolders.has(node.path)) continue;
                const entry = folderLoaderRef.current?.get(node.path);
                if (!entry) loadFolder(node.path);
                if (entry?.status === 'ready') loadExpanded(entry.children);
            }
        };
        loadExpanded(treeRoots);
    }, [expandedFolders, treeRoots, folderEntries, loadFolder]);

  useEffect(() => {
    setOptimisticSelectedPath('');
  }, [selectedFolderPath]);

  useEffect(() => () => {
    pendingNavigationRef.current?.();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSections));
    } catch {
      // Ignore storage failures; the sidebar can still operate with in-memory state.
    }
  }, [collapsedSections]);

  useEffect(() => {
    let cancelled = false;
    const fetchRoots = async () => {
      try {
        if (window.electronAPI && window.electronAPI.getRoots) {
          const fetchedRoots = await window.electronAPI.getRoots();
          const rootNodes = fetchedRoots.map(r => ({ name: r, path: r, isFolder: true }));
          if (!cancelled) setRoots(rootNodes);
        }
      } catch (error) {
        console.error('Failed to fetch roots:', error);
      }
    };
    fetchRoots();
    return () => { cancelled = true; };
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getSpecialPaths?.()
      .then(paths => { if (!cancelled) setSpecialPaths(paths || {}); })
      .catch(error => console.error('Failed to fetch special paths:', error));
    return () => { cancelled = true; };
  }, [refreshToken]);

  const toggleFolder = useCallback((path) => {
    setExpandedFolders(current => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    if (!expandedFolders.has(path)) loadFolder(path);
  }, [expandedFolders, loadFolder]);

  useEffect(() => {
    if (!selectedFolderPath || treeRoots.length === 0) return;
    let cancelled = false;

    const revealSelectedPath = async () => {
      const root = chooseTreeRoot(treeRoots, selectedFolderPath);
      if (!root) return;
      const ancestors = ancestorPathsBetween(root.path, selectedFolderPath);
        setExpandedFolders(current => {
            const next = new Set(current);
            ancestors.slice(0, -1).forEach(path => next.add(path));
            return next.size === current.size ? current : next;
        });
      for (const ancestor of ancestors.slice(0, -1)) {
        if (cancelled) return;
        await loadFolder(ancestor);
      }
    };

    revealSelectedPath();
    return () => {
      cancelled = true;
    };
  }, [loadFolder, selectedFolderPath, treeRoots, refreshToken, readFolderChildren]);

  // 라이브러리 목록
  const renderLibraryList = () => {
    const sectionLabel = t('folder.sidebar.libraries');
    const collapsed = isSectionCollapsed('libraries');
    const showStatus = libraryDisplayFields.folders || libraryDisplayFields.files || libraryDisplayFields.updatedAt;
    return (
      <div className={`sidebar-section sidebar-section-library ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="nav-header">
          <span className="nav-header-title">{sectionLabel}</span>
          <div className="folder-sidebar-header-actions">
            {renderSectionToggle('libraries', sectionLabel)}
            <button
              type="button"
              className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"
                aria-label={t('folder_library_manage')}
                data-tooltip={t('folder_library_manage')}
              onClick={onOpenLibrarySettings}
            >
              <FaIcon name="plus" size={12} />
            </button>
            <LibraryDisplayOptions
                value={libraryVisibleCount}
                onChange={setLibraryVisibleCount}
                fields={libraryDisplayFields}
                onToggleField={key => setLibraryDisplayFields(current => ({ ...current, [key]: !current[key] }))}
                t={t}
            />
          </div>
        </div>
        {!collapsed && (
          <ul ref={libraryListRef} className="nav-list" style={{ height: libraryListHeight === null ? undefined : `${libraryListHeight}px` }}>
            {libraryItems.length > 0 ? groupedLibraryItems.map(group => (
              <React.Fragment key={group.key || '__ungrouped'}>
                {group.label ? (
                  <li className="library-group-header" aria-hidden="true">{group.label}</li>
                ) : null}
                {group.items.map(item => {
                  const lib = item.path;
                  const idx = item.index;
                  const libraryKey = normalizeLibraryKey(lib);
                  const scanState = libraryScanStateMap[libraryKey];
                    const status = libraryStatusClass(scanState);
                  const libraryMetaText = libraryStatusText(t, scanState, {
                    folderCount: libraryFolderCounts[libraryKey] || 0,
                  });
                  const isSyncing = isLibraryScanning(scanState);
                  const showSyncButton = shouldShowLibrarySyncButton(scanState);
                  const selectedPath = optimisticSelectedPath || selectedFolderPath;
                  const isGroupedLibrary = Boolean(group.label);
                  return (
                    <li
                      key={lib}
                      data-folder-sidebar-path={lib}
                      className={`library-list-item ${isGroupedLibrary ? 'is-grouped' : ''} ${selectedSource === 'library' && (selectedLibrary === idx || selectedPath === lib) ? 'selected' : ''}`}
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
                        <span className="library-list-name" title={item.name}>{item.name}</span>
                        {showStatus && <span className={`library-scan-status ${status}`} title={libraryMetaText}>
                            {libraryDisplayFields.folders && <span className="library-scan-count">
                                <FaIcon name="folder" size={10} title={t('folder.detail.folder_count')} />
                                <span>{libraryFolderCounts[libraryKey] || 0}</span>
                            </span>}
                            {libraryDisplayFields.files && <span className="library-scan-count">
                                <FaIcon name="file" size={10} title={t('folder.detail.file_count')} />
                                <span>{scanState?.indexedCount || scanState?.fileCount || 0}</span>
                            </span>}
                            {libraryDisplayFields.updatedAt && <span className="library-scan-time">{libraryScanStatusText(t, scanState)}</span>}
                        </span>}
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
                          aria-label={t('folder.sidebar.more_actions')}
                          data-tooltip={t('folder.sidebar.more_actions')}
                        >
                          <FaIcon name="ellipsisVertical" size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </React.Fragment>
            )) : (
              <li className="sidebar-empty-list">
                {t('folder.sidebar.empty_libraries')}
              </li>
            )}
          </ul>
        )}
      </div>
    );
  };

  const renderReadingList = () => {
    const sectionLabel = t('folder.sidebar.reading');
    const collapsed = isSectionCollapsed('reading');
    return (
      <div className={`sidebar-section sidebar-section-reading ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="nav-header">
          <span className="nav-header-title">{sectionLabel}</span>
          <div className="folder-sidebar-header-actions">
            {renderSectionToggle('reading', sectionLabel)}
          </div>
        </div>
        {!collapsed && (
          <ul className="nav-list">
            <li className={`recent-reading-list-item ${readingListSelected === 'favorites' ? 'selected' : ''}`}>
                <button
                    type="button"
                    className="reading-list-nav-button"
                    onClick={event => {
                        applySidebarSelection(event);
                        setSelectedSource('favorites');
                        setOptimisticSelectedPath('');
                        onSelectReadingList?.('favorites');
                    }}
                    aria-current={readingListSelected === 'favorites' ? 'page' : undefined}
                >
                    <span className="recent-reading-list-main">
                        <FaIcon name="star" size={12} />
                        <span>{t('folder.sidebar.favorites')}</span>
                    </span>
                    <span className="recent-reading-count" aria-label={t('reading_lists.count', [favorites.length])}>
                        {favorites.length}
                    </span>
                </button>
            </li>
                <li className={`recent-reading-list-item ${readingListSelected === 'collections' || readingListSelected === 'collection' ? 'selected' : ''}`}>
                    <button
                        type="button"
                        className="reading-list-nav-button"
                        onClick={event => {
                            applySidebarSelection(event);
                            setSelectedSource('collections');
                            setOptimisticSelectedPath('');
                            onSelectReadingList?.('collections');
                        }}
                        aria-current={readingListSelected === 'collections' || readingListSelected === 'collection' ? 'page' : undefined}
                    >
                        <span className="recent-reading-list-main">
                            <FaIcon name="layers" size={12} />
                            <span>{t('reading_lists.collections')}</span>
                        </span>
                        <span className="recent-reading-count" aria-label={t('reading_lists.count', [collectionCount])}>
                            {collectionCount}
                        </span>
                    </button>
                </li>
            <li
              className={`recent-reading-list-item ${recentReadingSelected ? 'selected' : ''}`}
              onClick={(event) => {
                applySidebarSelection(event);
                setSelectedSource('recent-reading');
                setOptimisticSelectedPath('');
                onSelectRecentReading?.();
              }}
            >
              <span className="recent-reading-list-main">
                <FaIcon name="clock" size={12} />
                <span>{t('folder.sidebar.recent_reading')}</span>
              </span>
                <span className="recent-reading-count" aria-label={t('folder.recent.count', [recentReadingCount])}>
                    {recentReadingCount}
                </span>
            </li>
                {[
                    ['recent-added', 'calendar', recentAddedCount],
                    ['recent-updated', 'rotateRight', recentUpdatedCount],
                    ['wishlist', 'bookmark', wishlistCount],
                ].map(([kind, icon, count]) => (
                    <li key={kind} className={`recent-reading-list-item ${readingListSelected === kind ? 'selected' : ''}`}>
                        <button type="button" className="reading-list-nav-button" onClick={event => {
                            applySidebarSelection(event);
                            setSelectedSource(kind);
                            setOptimisticSelectedPath('');
                            onSelectReadingList?.(kind);
                        }} aria-current={readingListSelected === kind ? 'page' : undefined}>
                            <span className="recent-reading-list-main"><FaIcon name={icon} size={12} /><span>{t(`reading_lists.${kind.replaceAll('-', '_')}`)}</span></span>
                            <span className="recent-reading-count" aria-label={t('reading_lists.count', [count])}>{count}</span>
                        </button>
                    </li>
                ))}
                <li className="recent-reading-list-item">
                    <button
                        type="button"
                        className="reading-list-nav-button"
                        onClick={onCheckMissingVolumes}
                        disabled={isCheckingMissing || missingCheckDisabled}
                        aria-busy={isCheckingMissing}
                    >
                        <span className="recent-reading-list-main">
                            <FaIcon name="search" size={12} />
                            <span>{isCheckingMissing ? t('msg_analyzing') : t('tf_btn_check_missing')}</span>
                        </span>
                        {!isCheckingMissing && missingCount > 0 && (
                            <span className="recent-reading-count missing-count-indicator">
                                <FaIcon name="circle" size={7} />
                                <span>{missingCount}</span>
                            </span>
                        )}
                    </button>
                </li>
          </ul>
        )}
      </div>
    );
  };

    const selectTreeFolder = useCallback(folderPath => {
        setSelectedSource('tree');
        setOptimisticSelectedPath(folderPath);
        scheduleSidebarNavigation(() => onSelectFolder?.(folderPath, { source: 'tree' }));
    }, [onSelectFolder, scheduleSidebarNavigation]);

    const openTreeContextMenu = useCallback((event, node, siblingPaths) => {
        if (node.isLibraryRoot) {
            onLibraryContextMenu?.(event, node.path);
            return;
        }
        onFolderContextMenu?.(event, node.path, siblingPaths);
    }, [onLibraryContextMenu, onFolderContextMenu]);

  const renderFolderTree = () => (
    <div className="sidebar-section sidebar-section-folders">
      <div className="nav-header">
        <span className="nav-header-title">{t('folder.sidebar.folders')}</span>
        <div className="folder-sidebar-header-actions">
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
            <button
                type="button"
                className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn folder-sidebar-refresh-btn"
                aria-label={t('folder.sidebar.refresh')}
                data-tooltip={t('folder.sidebar.refresh')}
                aria-busy={refreshing}
                disabled={refreshing || refreshDisabled}
                onClick={onRefresh}
            >
                <FaIcon name="rotateRight" className={refreshing ? 'folder-sidebar-refresh-icon is-spinning' : 'folder-sidebar-refresh-icon'} size={12} />
            </button>
        </div>
      </div>
        <FolderTree
            roots={treeRoots}
            entries={folderEntries}
            expandedPaths={expandedFolders}
            selectedPath={!recentReadingSelected && !readingListSelected ? optimisticSelectedPath || selectedFolderPath : ''}
            onToggle={toggleFolder}
            onSelect={selectTreeFolder}
            onContextMenu={openTreeContextMenu}
            onRetry={loadFolder}
            t={t}
        />
    </div>
  );

  return (
    <div ref={sidebarRef} className="folder-sidebar">
      {renderReadingList()}
      {renderLibraryList()}
      {renderFolderTree()}
    </div>
  );
}

export { FolderSidebar };
export default FolderSidebar;
