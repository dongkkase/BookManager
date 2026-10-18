import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FaIcon from '../FaIcon';
import { buildFolderTreeRows, getFolderTreeWindow } from '../../folderTreeRows';

const EMPTY_ROOTS = [];
const EMPTY_ENTRIES = {};
const EMPTY_EXPANDED = new Set();
const VIRTUAL_THRESHOLD = 200;

function findScrollContainer(list) {
    for (let element = list; element; element = element.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(element).overflowY)) return element;
    }
    return list;
}

function viewportOffset(list, container) {
    const padding = parseFloat(getComputedStyle(list).paddingTop) || 0;
    if (list === container) return container.scrollTop - padding;
    return container.getBoundingClientRect().top + container.clientTop
        - list.getBoundingClientRect().top - list.clientTop - padding;
}

function TreeGuides({ row }) {
    return (
        <span className="folder-tree-guides" aria-hidden="true">
            {Array.from({ length: row.level - 1 }, (_, index) => {
                const branch = index === row.level - 2;
                const className = branch
                    ? `folder-tree-guide is-branch${row.hasNextSibling ? '' : ' is-last'}`
                    : `folder-tree-guide${row.ancestorContinues[index] ? ' is-continuation' : ''}`;
                return <span key={index} className={className} />;
            })}
        </span>
    );
}

function FolderTreeComponent({
    roots = EMPTY_ROOTS,
    entries = EMPTY_ENTRIES,
    expandedPaths = EMPTY_EXPANDED,
    selectedPath,
    onToggle,
    onRetry,
    onSelect,
    onContextMenu,
    t,
}) {
    const rows = useMemo(() => buildFolderTreeRows(roots, entries, expandedPaths), [roots, entries, expandedPaths]);
    const nodeRows = useMemo(() => rows.filter(row => row.kind === 'node'), [rows]);
    const rowIndices = useMemo(() => new Map(rows.flatMap((row, index) => row.kind === 'node' ? [[row.key, index]] : [])), [rows]);
    const nodeIndices = useMemo(() => new Map(nodeRows.map((row, index) => [row.key, index])), [nodeRows]);
    const selectedKey = useMemo(() => nodeRows.find(row => row.path === selectedPath)?.key, [nodeRows, selectedPath]);
    const listRef = useRef(null);
    const probeRef = useRef(null);
    const containerRef = useRef(null);
    const rowElements = useRef(new Map());
    const pendingFocus = useRef(null);
    const localSelection = useRef(null);
    const lastSelection = useRef({ path: null, visible: false });
    const previousViewport = useRef({ scrollTop: 0, height: 280, rowHeight: 28 });
    const [focusedKey, setFocusedKey] = useState(selectedKey || null);
    const [viewport, setViewport] = useState({ scrollTop: 0, height: 280, rowHeight: 28 });
    const activeKey = nodeIndices.has(focusedKey) ? focusedKey : selectedKey || nodeRows[0]?.key;
    const virtual = rows.length >= VIRTUAL_THRESHOLD;
    const window = virtual
        ? getFolderTreeWindow(rows.length, viewport.scrollTop, viewport.height, viewport.rowHeight)
        : { start: 0, end: rows.length, beforeHeight: 0, afterHeight: 0 };
    const visibleRows = rows.slice(window.start, window.end);
    const activeIndex = rowIndices.get(activeKey);
    const viewportStart = Math.max(window.start, Math.floor(viewport.scrollTop / viewport.rowHeight));
    const viewportEnd = Math.min(window.end, Math.ceil((viewport.scrollTop + viewport.height) / viewport.rowHeight));
    const tabStopKey = activeIndex >= viewportStart && activeIndex < viewportEnd
        ? activeKey : rows.slice(viewportStart, window.end).find(row => row.kind === 'node')?.key || visibleRows.find(row => row.kind === 'node')?.key;

    const measureViewport = useCallback(() => {
        const list = listRef.current;
        const container = containerRef.current;
        if (!list || !container) return;
        const measuredHeight = probeRef.current?.getBoundingClientRect().height;
        const next = {
            scrollTop: Math.max(0, viewportOffset(list, container)),
            height: container.clientHeight || 280,
            rowHeight: measuredHeight > 0 ? measuredHeight : 28,
        };
        setViewport(previous => previous.scrollTop === next.scrollTop && previous.height === next.height && previous.rowHeight === next.rowHeight ? previous : next);
    }, []);

    useLayoutEffect(() => {
        const list = listRef.current;
        const container = findScrollContainer(list);
        containerRef.current = container;
        let frame = null;
        const scheduleMeasure = () => {
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                measureViewport();
            });
        };
        const observer = new ResizeObserver(scheduleMeasure);
        observer.observe(container);
        if (container !== list) observer.observe(list);
        observer.observe(probeRef.current);
        container.addEventListener('scroll', scheduleMeasure, { passive: true });
        measureViewport();
        return () => {
            observer.disconnect();
            container.removeEventListener('scroll', scheduleMeasure);
            if (frame !== null) cancelAnimationFrame(frame);
            containerRef.current = null;
        };
    }, [measureViewport]);

    const scrollToRow = useCallback(index => {
        const list = listRef.current;
        const container = containerRef.current;
        if (!list || !container || index == null) return;
        const offset = viewportOffset(list, container);
        const height = probeRef.current?.getBoundingClientRect().height || 28;
        const top = index * height;
        const bottom = top + height;
        let delta = 0;
        if (top < offset) delta = top - offset;
        else if (bottom > offset + container.clientHeight) delta = bottom - offset - container.clientHeight;
        if (delta) container.scrollTo({ top: container.scrollTop + delta, behavior: 'instant' });
        measureViewport();
    }, [measureViewport]);

    useLayoutEffect(() => {
        const previous = previousViewport.current;
        previousViewport.current = viewport;
        const oldHeight = previous.rowHeight;
        const list = listRef.current;
        const container = containerRef.current;
        if (oldHeight === viewport.rowHeight || !list || !container) return;
        const anchor = previous.scrollTop / oldHeight * viewport.rowHeight;
        container.scrollTo({ top: container.scrollTop + anchor - viewportOffset(list, container), behavior: 'instant' });
        const selectedIndex = rows.findIndex((row, index) => row.kind === 'node' && row.path === selectedPath
            && index * oldHeight < previous.scrollTop + previous.height && (index + 1) * oldHeight > previous.scrollTop);
        if (selectedIndex >= 0) scrollToRow(selectedIndex);
        else measureViewport();
    }, [viewport.rowHeight, viewport.scrollTop, viewport.height, rows, selectedPath, scrollToRow, measureViewport]);

    useLayoutEffect(() => {
        const visible = rowIndices.has(selectedKey);
        const previous = lastSelection.current;
        if (visible && (previous.path !== selectedPath || !previous.visible)) {
            const measuredHeight = probeRef.current?.getBoundingClientRect().height || 28;
            if (!containerRef.current?.clientHeight || (virtual && viewport.rowHeight !== measuredHeight)) return;
            const local = localSelection.current;
            const key = local?.path === selectedPath && rowIndices.has(local.key) ? local.key : selectedKey;
            scrollToRow(rowIndices.get(key));
        }
        localSelection.current = null;
        lastSelection.current = { path: selectedPath, visible };
    }, [selectedPath, selectedKey, rowIndices, scrollToRow, virtual, viewport.height, viewport.rowHeight]);

    useLayoutEffect(() => {
        measureViewport();
    }, [rows.length, measureViewport]);

    const focusRow = useCallback(key => {
        if (!rowIndices.has(key)) return;
        pendingFocus.current = key;
        setFocusedKey(key);
        scrollToRow(rowIndices.get(key));
        const element = rowElements.current.get(key);
        if (element) {
            element.focus({ preventScroll: true });
            pendingFocus.current = null;
        }
    }, [rowIndices, scrollToRow]);

    useLayoutEffect(() => {
        const key = pendingFocus.current;
        if (!key) return;
        const element = rowElements.current.get(key);
        if (element) {
            element.focus({ preventScroll: true });
            pendingFocus.current = null;
        } else if (!rowIndices.has(key)) pendingFocus.current = null;
        else scrollToRow(rowIndices.get(key));
    });

    const selectRow = row => {
        localSelection.current = { path: row.path, key: row.key };
        onSelect?.(row.path);
    };

    const handleKeyDown = (event, row) => {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const index = nodeIndices.get(row.key);
        let destination;
        switch (event.key) {
            case 'ArrowUp':
                destination = nodeRows[Math.max(0, index - 1)]?.key;
                break;
            case 'ArrowDown':
                destination = nodeRows[Math.min(nodeRows.length - 1, index + 1)]?.key;
                break;
            case 'Home':
                destination = nodeRows[0]?.key;
                break;
            case 'End':
                destination = nodeRows[nodeRows.length - 1]?.key;
                break;
            case 'ArrowRight':
                if (row.canExpand && !row.expanded) onToggle?.(row.path);
                else if (row.expanded && nodeRows[index + 1]?.parentKey === row.key) destination = nodeRows[index + 1].key;
                break;
            case 'ArrowLeft':
                if (row.expanded) onToggle?.(row.path);
                else destination = row.parentKey;
                break;
            case 'Enter':
            case ' ':
                selectRow(row);
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (destination) focusRow(destination);
    };

    const spacer = (key, height) => height > 0 ? (
        <li key={key} className="folder-tree-spacer" role="presentation" aria-hidden="true" style={{ height, minHeight: 0, padding: 0, border: 0 }} />
    ) : null;

    return (
        <ul
            ref={listRef}
            className="nav-list folder-tree-list"
            role="tree"
            aria-label={t('folder.sidebar.folders')}
            onKeyDown={event => {
                if (event.key === 'Delete' || event.key === 'Backspace' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) {
                    event.preventDefault();
                    event.stopPropagation();
                } else if (event.target.closest('button') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
                    event.stopPropagation();
                }
            }}
        >
            <li
                ref={probeRef}
                className="folder-tree-row-height-probe"
                role="presentation"
                aria-hidden="true"
                style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: 1, height: 'var(--folder-tree-row-height, 28px)', minHeight: 0, margin: 0, padding: 0, border: 0, boxSizing: 'border-box' }}
            />
            {spacer('before', window.beforeHeight)}
            {visibleRows.map(row => {
                const style = { '--folder-tree-depth': row.level - 1, height: viewport.rowHeight };
                if (row.kind !== 'node') {
                    return (
                        <li key={row.key} className={`folder-tree-status is-${row.kind}`} role="presentation" style={style}>
                            <TreeGuides row={row} />
                            <span className="folder-tree-status-label" role="status">
                                {row.kind === 'loading' && <FaIcon name="spinner" className="folder-tree-loading-icon" size={12} />}
                                {t(`folder.tree.${row.kind}`)}
                            </span>
                            {row.kind === 'error' && (
                                <button type="button" className="folder-tree-retry" onClick={event => { event.stopPropagation(); onRetry?.(row.parentPath); }}>
                                    {t('folder.tree.retry')}
                                </button>
                            )}
                        </li>
                    );
                }
                const selected = row.path === selectedPath;
                return (
                    <li
                        key={row.key}
                        ref={element => { if (element) rowElements.current.set(row.key, element); else rowElements.current.delete(row.key); }}
                        className={`folder-tree-row${selected ? ' selected' : ''}`}
                        role="treeitem"
                        aria-level={row.level}
                        aria-posinset={row.posInSet}
                        aria-setsize={row.setSize}
                        aria-expanded={row.canExpand || row.expanded ? row.expanded : undefined}
                        aria-selected={selected}
                        data-folder-sidebar-path={row.path}
                        data-folder-tree-key={row.key}
                        tabIndex={row.key === tabStopKey ? 0 : -1}
                        title={row.node.name === row.path ? row.path : `${row.node.name}\n${row.path}`}
                        style={style}
                        onFocus={event => { if (event.target === event.currentTarget) setFocusedKey(row.key); }}
                        onKeyDown={event => handleKeyDown(event, row)}
                        onClick={() => { focusRow(row.key); selectRow(row); }}
                        onDoubleClick={() => { if (row.canExpand || row.expanded) onToggle?.(row.path); }}
                        onContextMenu={event => onContextMenu?.(event, row.node, row.siblingPaths)}
                    >
                        <TreeGuides row={row} />
                        {row.canExpand || row.expanded ? (
                            <button
                                type="button"
                                className="folder-tree-expander"
                                tabIndex={-1}
                                aria-label={t(row.expanded ? 'folder.tree.collapse' : 'folder.tree.expand')}
                                onClick={event => { event.stopPropagation(); focusRow(row.key); onToggle?.(row.path); }}
                                onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
                            >
                                <FaIcon name={row.expanded ? 'angleDown' : 'chevronRight'} size={12} />
                            </button>
                        ) : <span className="folder-tree-expander is-placeholder" aria-hidden="true" />}
                        <span className="folder-tree-icon">
                            <FaIcon name={row.node.isFolder === false ? 'file' : row.expanded ? 'folderOpen' : 'folder'} size={12} />
                        </span>
                        <span className="folder-tree-name">{row.node.name}</span>
                    </li>
                );
            })}
            {spacer('after', window.afterHeight)}
        </ul>
    );
}

export const FolderTree = memo(FolderTreeComponent);
export default FolderTree;
