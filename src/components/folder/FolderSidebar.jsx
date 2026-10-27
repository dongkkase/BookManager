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
const READING_DISPLAY_FIELDS_STORAGE_KEY = 'bookmanager.folderSidebar.readingDisplayFields';
const READING_ORDER_STORAGE_KEY = 'bookmanager.folderSidebar.readingOrder';
const READING_DISPLAY_FIELDS = [
    ['favorites', 'folder.sidebar.favorites'],
    ['collections', 'reading_lists.collections'],
    ['recent-reading', 'folder.sidebar.recent_reading'],
    ['recent-added', 'reading_lists.recent_added'],
    ['recent-updated', 'reading_lists.recent_updated'],
    ['wishlist', 'reading_lists.wishlist'],
    ['authors', 'reading_lists.authors'],
    ['annotations', 'reading_lists.annotations'],
    ['missing-volumes', 'tf_btn_check_missing'],
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

function readStoredReadingDisplayFields() {
    let stored;
    try {
        stored = JSON.parse(window.localStorage.getItem(READING_DISPLAY_FIELDS_STORAGE_KEY));
    } catch {
        stored = null;
    }
    return Object.fromEntries(READING_DISPLAY_FIELDS.map(([key]) => [key, stored?.[key] !== false]));
}

function readStoredReadingOrder() {
    const defaults = READING_DISPLAY_FIELDS.map(([key]) => key);
    try {
        const stored = JSON.parse(window.localStorage.getItem(READING_ORDER_STORAGE_KEY));
        return [...new Set([...(Array.isArray(stored) ? stored.filter(key => defaults.includes(key)) : []), ...defaults])];
    } catch {
        return defaults;
    }
}

function SidebarDisplayOptions({ value, onChange, fields, onToggleField, onMoveField, t, fieldOptions = LIBRARY_DISPLAY_FIELDS, showCountOptions = true, labelKey = 'folder_library_display_options', classPrefix = 'library' }) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const [draggedKey, setDraggedKey] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const draggedKeyRef = useRef(null);
    const reorderFocusRef = useRef(null);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const clearDrag = useCallback(() => {
        draggedKeyRef.current = null;
        setDraggedKey(null);
        setDropTarget(null);
    }, []);
    const closeMenu = useCallback(() => {
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        if (!open) clearDrag();
    }, [open, clearDrag]);

    useLayoutEffect(() => {
        if (!reorderFocusRef.current) return;
        const row = Array.from(menuRef.current?.querySelectorAll('[data-reading-key]') || [])
            .find(element => element.dataset.readingKey === reorderFocusRef.current);
        row?.querySelector('.reading-display-reorder-handle')?.focus();
        reorderFocusRef.current = null;
    }, [fieldOptions]);

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
        if (open && position) {
            const firstOption = menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]')
                || menuRef.current?.querySelector('[role="menuitemcheckbox"]');
            firstOption?.focus({ preventScroll: true });
        }
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
            className={`folder-sidebar-icon-btn folder-sidebar-tooltip-btn ${classPrefix}-display-options-button`}
            aria-label={t(labelKey)}
            data-tooltip={t(labelKey)}
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
                className={`folder-context-menu ${classPrefix}-display-options-menu`}
                role="menu"
                aria-label={t(labelKey)}
                style={position || { left: 0, top: 0, visibility: 'hidden' }}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Tab') {
                        setOpen(false);
                    } else if (onMoveField && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                        event.preventDefault();
                        const row = document.activeElement?.closest('.reading-display-field-row');
                        row?.querySelector(event.key === 'ArrowLeft' ? '.reading-display-reorder-handle' : '.library-display-field-option')?.focus();
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const options = Array.from(event.currentTarget.querySelectorAll(onMoveField ? '[role="menuitemcheckbox"]' : 'button'));
                        const current = options.indexOf(document.activeElement);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                            : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                        options[next]?.focus();
                    }
                }}
            >
                {open && <>
                {onMoveField && <div className="reading-display-order-hint" role="presentation">{t('reading_lists.reorder_hint')}</div>}
                {showCountOptions && LIBRARY_VISIBLE_COUNTS.map(count => (
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
                {showCountOptions && <div className="folder-context-menu-separator" role="separator" />}
                {fieldOptions.map(([key, fieldLabelKey], index) => {
                    const toggle = <button
                        key={key}
                        type="button"
                        role="menuitemcheckbox"
                        className="library-display-field-option"
                        aria-checked={fields[key]}
                        onClick={() => onToggleField(key)}
                    >
                        <span>{t(fieldLabelKey)}</span>
                        <span className="library-display-field-switch" aria-hidden="true" />
                    </button>;
                    if (!onMoveField) return toggle;
                    return <div
                        key={key}
                        role="presentation"
                        className="reading-display-field-row"
                        data-reading-key={key}
                        data-dragging={draggedKey === key || undefined}
                        data-drop-position={dropTarget?.key === key ? dropTarget.position : undefined}
                        onDragOver={event => {
                            if (!draggedKeyRef.current) return;
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = 'move';
                            if (draggedKeyRef.current === key) {
                                setDropTarget(null);
                                return;
                            }
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                            setDropTarget(current => current?.key === key && current.position === position ? current : { key, position });
                        }}
                        onDragLeave={event => {
                            if (!event.currentTarget.contains(event.relatedTarget)) {
                                setDropTarget(current => current?.key === key ? null : current);
                            }
                        }}
                        onDrop={event => {
                            const source = draggedKeyRef.current;
                            if (!source) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const bounds = event.currentTarget.getBoundingClientRect();
                            if (source !== key) {
                                reorderFocusRef.current = source;
                                onMoveField(source, key, event.clientY >= bounds.top + bounds.height / 2);
                            }
                            clearDrag();
                        }}
                    >
                        <button
                            type="button"
                            role="menuitem"
                            className="reading-display-reorder-handle"
                            draggable
                            aria-label={t('reading_lists.reorder_item', [t(fieldLabelKey), index + 1, fieldOptions.length])}
                            title={t('reading_lists.reorder_keyboard_hint')}
                            aria-keyshortcuts="ArrowUp ArrowDown"
                            onDragStart={event => {
                                event.stopPropagation();
                                draggedKeyRef.current = key;
                                setDraggedKey(key);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('application/x-bookmanager-reading-menu', key);
                                event.dataTransfer.setDragImage(event.currentTarget.parentElement, 16, 16);
                            }}
                            onDragEnd={clearDrag}
                            onKeyDown={event => {
                                if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const next = index + (event.key === 'ArrowUp' ? -1 : 1);
                                if (next < 0 || next >= fieldOptions.length) return;
                                reorderFocusRef.current = key;
                                onMoveField(key, fieldOptions[next][0], next > index);
                            }}
                        >
                            <FaIcon name="gripVertical" size={12} />
                        </button>
                        {toggle}
                    </div>;
                })}
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
function FolderSidebar({ t, libraries = EMPTY_ITEMS, libraryEntries = EMPTY_ITEMS, favorites = EMPTY_ITEMS, selectedLibrary, onSelectLibrary, selectedFolderPath, onSelectFolder, onSelectLibraryFolder, onFolderContextMenu, onLibraryContextMenu, onOpenLibrarySettings, onSyncLibrary, recentReadingSelected = false, recentReadingCount = 0, onSelectRecentReading, readingListSelected = '', recentAddedCount = 0, recentUpdatedCount = 0, wishlistCount = 0, collectionCount = 0, authorCount = 0, annotationCount = 0, onSelectReadingList, missingCount = 0, onCheckMissingVolumes, isCheckingMissing = false, missingCheckDisabled = false, libraryScanStateMap = {}, refreshToken = 0, onRefresh, refreshing = false, refreshDisabled = false }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [collapsedSections, setCollapsedSections] = useState(readStoredSidebarCollapseState);
    const [libraryVisibleCount, setLibraryVisibleCount] = useState(readStoredLibraryVisibleCount);
    const [libraryDisplayFields, setLibraryDisplayFields] = useState(readStoredLibraryDisplayFields);
    const [readingDisplayFields, setReadingDisplayFields] = useState(readStoredReadingDisplayFields);
    const [readingOrder, setReadingOrder] = useState(readStoredReadingOrder);
    const readingFieldOptions = useMemo(() => readingOrder.map(key => READING_DISPLAY_FIELDS.find(field => field[0] === key)), [readingOrder]);
    const moveReadingField = useCallback((key, targetKey, after) => {
        setReadingOrder(current => {
            if (key === targetKey || !current.includes(key) || !current.includes(targetKey)) return current;
            const next = current.filter(item => item !== key);
            next.splice(next.indexOf(targetKey) + (after ? 1 : 0), 0, key);
            return next.every((item, index) => item === current[index]) ? current : next;
        });
    }, []);
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
    useEffect(() => {
        try {
            window.localStorage.setItem(READING_DISPLAY_FIELDS_STORAGE_KEY, JSON.stringify(readingDisplayFields));
        } catch {
            // Keep the current choice when local storage is unavailable.
        }
    }, [readingDisplayFields]);
    useEffect(() => {
        try {
            window.localStorage.setItem(READING_ORDER_STORAGE_KEY, JSON.stringify(readingOrder));
        } catch {
            // Keep the current order when local storage is unavailable.
        }
    }, [readingOrder]);
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
                <span className="nav-header-title">{sectionLabel}</span>
                <span className="sidebar-section-toggle-indicator" aria-hidden="true">
                    <FaIcon name="chevronRight" className="sidebar-section-toggle-icon" size={10} />
                </span>
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
            {renderSectionToggle('libraries', sectionLabel)}
          <div className="folder-sidebar-header-actions">
            <button
              type="button"
              className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"
                aria-label={t('folder_library_manage')}
                data-tooltip={t('folder_library_manage')}
              onClick={onOpenLibrarySettings}
            >
              <FaIcon name="plus" size={12} />
            </button>
            <SidebarDisplayOptions
                value={libraryVisibleCount}
                onChange={setLibraryVisibleCount}
                fields={libraryDisplayFields}
                onToggleField={key => setLibraryDisplayFields(current => ({ ...current, [key]: !current[key] }))}
                t={t}
            />
          </div>
        </div>
        <div className="sidebar-section-content" aria-hidden={collapsed} inert={collapsed ? '' : undefined}>
            <div className="sidebar-section-content-inner">
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
            </div>
        </div>
      </div>
    );
  };

  const renderReadingList = () => {
    const sectionLabel = t('folder.sidebar.reading');
    const collapsed = isSectionCollapsed('reading');
    return (
      <div className={`sidebar-section sidebar-section-reading ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="nav-header">
            {renderSectionToggle('reading', sectionLabel)}
            <div className="folder-sidebar-header-actions">
                <SidebarDisplayOptions
                    fields={readingDisplayFields}
                    onToggleField={key => setReadingDisplayFields(current => ({ ...current, [key]: !current[key] }))}
                    fieldOptions={readingFieldOptions}
                    onMoveField={moveReadingField}
                    showCountOptions={false}
                    labelKey="reading_lists.display_options"
                    classPrefix="reading"
                    t={t}
                />
            </div>
        </div>
        <ul className="nav-list reading-dashboard-list">
            <li className={`recent-reading-list-item ${readingListSelected === 'dashboard' ? 'selected' : ''}`}>
                <button
                    type="button"
                    className="reading-list-nav-button"
                    onClick={event => {
                        applySidebarSelection(event);
                        setSelectedSource('dashboard');
                        setOptimisticSelectedPath('');
                        onSelectReadingList?.('dashboard');
                    }}
                    aria-current={readingListSelected === 'dashboard' ? 'page' : undefined}
                >
                    <span className="recent-reading-list-main">
                        <FaIcon name="house" size={12} />
                        <span>{t('reading_lists.dashboard')}</span>
                    </span>
                </button>
            </li>
        </ul>
        <div className="sidebar-section-content" aria-hidden={collapsed} inert={collapsed ? '' : undefined}>
            <div className="sidebar-section-content-inner">
          <ul className="nav-list">
                {readingFieldOptions.filter(([kind]) => readingDisplayFields[kind]).map(([kind, labelKey]) => {
                    if (kind === 'missing-volumes') return <li key={kind} className="recent-reading-list-item">
                        <button
                            type="button"
                            className="reading-list-nav-button"
                            onClick={onCheckMissingVolumes}
                            disabled={isCheckingMissing || missingCheckDisabled}
                            aria-busy={isCheckingMissing}
                        >
                            <span className="recent-reading-list-main">
                                <FaIcon name="search" size={12} />
                                <span>{isCheckingMissing ? t('msg_analyzing') : t(labelKey)}</span>
                            </span>
                            {!isCheckingMissing && missingCount > 0 && (
                                <span className="recent-reading-count missing-count-indicator">
                                    <FaIcon name="circle" size={7} />
                                    <span>{missingCount}</span>
                                </span>
                            )}
                        </button>
                    </li>;
                    const [icon, count] = {
                        favorites: ['star', favorites.length],
                        collections: ['layers', collectionCount],
                        'recent-reading': ['clock', recentReadingCount],
                        'recent-added': ['calendar', recentAddedCount],
                        'recent-updated': ['rotateRight', recentUpdatedCount],
                        wishlist: ['bookmark', wishlistCount],
                        authors: ['users', authorCount],
                        annotations: ['pen', annotationCount],
                    }[kind];
                    const selected = kind === 'recent-reading' ? recentReadingSelected
                        : readingListSelected === kind || (kind === 'collections' && readingListSelected === 'collection');
                    return <li key={kind} className={`recent-reading-list-item ${selected ? 'selected' : ''}`}>
                        <button
                            type="button"
                            className="reading-list-nav-button"
                            onClick={event => {
                                applySidebarSelection(event);
                                setSelectedSource(kind);
                                setOptimisticSelectedPath('');
                                if (kind === 'recent-reading') onSelectRecentReading?.();
                                else onSelectReadingList?.(kind);
                            }}
                            aria-current={selected ? 'page' : undefined}
                        >
                            <span className="recent-reading-list-main">
                                <FaIcon name={icon} size={12} />
                                <span>{t(labelKey)}</span>
                            </span>
                            <span className="recent-reading-count" aria-label={t(kind === 'recent-reading' ? 'folder.recent.count' : 'reading_lists.count', [count])}>
                                {count}
                            </span>
                        </button>
                    </li>;
                })}
          </ul>
            </div>
        </div>
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
