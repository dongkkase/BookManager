import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  FolderOpen, Search, ChevronDown, ChevronRight,
  RotateCcw, Bold, Trash2, Copy, FileArchive, AlertTriangle,
  Eye, Hash, HardDrive, CheckSquare, Square
} from 'lucide-react';
import type { FileMetadata } from '../../../../shared/types';
import { useLibraryStore } from '../../stores';

// ============================================
// Types
// ============================================

interface SeriesGroup {
  series: string;
  path: string;
  files: FileMetadata[];
  totalSize: number;
  expanded: boolean;
  checked: boolean;
  outputPath: string;
  cleanTitle: string;
}

interface DragState {
  isDragging: boolean;
  overIndex: number | null;
}

// ============================================
// Utility Functions
// ============================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function groupBySeries(files: FileMetadata[]): SeriesGroup[] {
  const groups: Record<string, SeriesGroup> = {};
  
  for (const file of files) {
    const series = file.series || '제목없음';
    if (!groups[series]) {
      groups[series] = {
        series,
        path: file.path || '',
        files: [],
        totalSize: 0,
        expanded: true,
        checked: true,
        outputPath: file.path || '',
        cleanTitle: series,
      };
    }
    groups[series].files.push(file);
    groups[series].totalSize += file.size || 0;
  }
  
  return Object.values(groups);
}

// ============================================
// Sub-Components
// ============================================

function SeriesRow({
  group,
  index,
  onToggleExpand,
  onEditPath,
  onContextMenu,
}: {
  group: SeriesGroup;
  index: number;
  onToggleExpand: (index: number) => void;
  onEditPath: (index: number, path: string) => void;
  onContextMenu: (e: React.MouseEvent, group: SeriesGroup) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [pathValue, setPathValue] = useState(group.outputPath);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync pathValue when group.outputPath changes
  if (pathValue !== group.outputPath && !editing) {
    setPathValue(group.outputPath);
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handlePathBlur = useCallback((): void => {
    setEditing(false);
    onEditPath(index, pathValue);
  }, [index, pathValue, onEditPath]);

  const handlePathKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handlePathBlur();
    } else if (e.key === 'Escape') {
      setPathValue(group.outputPath);
      setEditing(false);
    }
  }, [handlePathBlur, group.outputPath]);

  return (
    <>
      {/* Parent row (Series) */}
      <div
        className="series-parent-row group"
        onContextMenu={(e) => onContextMenu(e, group)}
      >
        <div className="series-name-cell">
          <button
            className="expand-btn"
            onClick={() => onToggleExpand(index)}
          >
            {group.expanded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="series-name">{group.series}</span>
        </div>
        <div className="series-path-cell">
          {editing ? (
            <input
              ref={inputRef}
              className="path-input"
              value={pathValue}
              onChange={(e) => setPathValue(e.target.value)}
              onBlur={handlePathBlur}
              onKeyDown={handlePathKeyDown}
            />
          ) : (
            <span
              className="path-text"
              onDoubleClick={() => setEditing(true)}
            >
              {group.outputPath || group.path}
            </span>
          )}
        </div>
        <div className="series-count-cell">
          <Hash size={12} className="inline mr-1" />
          {group.files.length}
        </div>
        <div className="series-size-cell">
          <HardDrive size={12} className="inline mr-1" />
          {formatFileSize(group.totalSize)}
        </div>
      </div>

      {/* Child rows (Files) */}
      {group.expanded && group.files.map((file, fileIdx) => (
        <div
          key={file.path || fileIdx}
          className="series-child-row"
        >
          <div className="child-name-cell">
            <span className="child-indent" />
            <FileArchive size={14} className="inline mr-1 text-[var(--text-muted)]" />
            <span className="child-name">{file.title || file.path?.split('/').pop() || file.path?.split('\\').pop() || 'Unknown'}</span>
            {file.isSpinoff && (
              <span className="spinoff-badge" title="스피노프">
                <AlertTriangle size={10} />
              </span>
            )}
          </div>
          <div className="child-path-cell">
            <span className="child-path">{file.path}</span>
          </div>
          <div className="child-count-cell">-</div>
          <div className="child-size-cell">
            {formatFileSize(file.size || 0)}
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="empty-state">
      <FolderOpen size={64} className="text-[var(--text-muted)] opacity-50 mb-4" />
      <p className="text-[var(--text-muted)] font-semibold text-lg">
        파일을 드래그 & 드롭하거나 폴더를 선택하세요
      </p>
      <p className="text-[var(--text-muted)] text-sm mt-1">
        ComicZIP (.cbz), .zip 파일을 지원합니다
      </p>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function OrganizerTab(): React.JSX.Element {
  const files = useLibraryStore((s) => s.files);
  const setFiles = useLibraryStore((s) => s.setFiles);
  const setCurrentFolder = useLibraryStore((s) => s.setCurrentFolder);
  const filters = useLibraryStore((s) => s.filters);
  const setFilters = useLibraryStore((s) => s.setFilters);

  const [allExpanded, setAllExpanded] = useState(true);
  const [allChecked, setAllChecked] = useState(true);
  const [dragState, setDragState] = useState<DragState>({ isDragging: false, overIndex: null });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; group: SeriesGroup } | null>(null);

  const fileArray = Object.values(files);

  // Group files by series when files change (useMemo to avoid useEffect setState)
  const [seriesGroups, setSeriesGroups] = useState<SeriesGroup[]>([]);

  useEffect(() => {
    if (fileArray.length > 0) {
      setSeriesGroups(groupBySeries(fileArray));
    } else {
      setSeriesGroups([]);
    }
  }, [files]);

  // Handle drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ isDragging: true, overIndex: null });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ isDragging: false, overIndex: null });
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ isDragging: false, overIndex: null });

    // @ts-ignore - Electron File has path property
    const droppedPaths = Array.from(e.dataTransfer.files).map((f: File) => (f as File & { path: string }).path).filter(Boolean);
    if (droppedPaths.length > 0) {
      // Load file info for dropped files
      const newFiles: Record<string, FileMetadata> = {};
      for (const path of droppedPaths) {
        const info = await window.api.getFileInfo(path);
        if (info) {
          newFiles[path] = info;
        }
      }
      if (Object.keys(newFiles).length > 0) {
        setFiles(newFiles);
        setCurrentFolder(droppedPaths[0]);
      }
    }
  }, [setFiles, setCurrentFolder]);

  // Folder selection
  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.api.openDirectory({
      title: '만화 파일이 있는 폴더를 선택하세요',
    });
    if (folderPath) {
      setCurrentFolder(folderPath);
      const allFiles = await window.api.getAllFilesInPath(folderPath, true);
      if (allFiles && Object.keys(allFiles).length > 0) {
        setFiles(allFiles);
      }
    }
  }, [setFiles, setCurrentFolder]);

  // Toggle all expand
  const handleToggleAllExpand = useCallback(() => {
    setAllExpanded(prev => {
      const newState = !prev;
      setSeriesGroups(groups =>
        groups.map(g => ({ ...g, expanded: newState }))
      );
      return newState;
    });
  }, []);

  // Toggle all check
  const handleToggleAllCheck = useCallback(() => {
    setAllChecked(prev => {
      const newState = !prev;
      setSeriesGroups(groups =>
        groups.map(g => ({ ...g, checked: newState }))
      );
      return newState;
    });
  }, []);

  // Batch set default path
  const handleBatchDefault = useCallback(() => {
    setSeriesGroups(groups =>
      groups.map(g => ({
        ...g,
        outputPath: g.path,
      }))
    );
  }, []);

  // Batch set title
  const handleBatchTitle = useCallback(() => {
    setSeriesGroups(groups =>
      groups.map(g => ({
        ...g,
        cleanTitle: g.series,
        outputPath: g.path,
      }))
    );
  }, []);

  // Toggle single group expand
  const handleToggleExpand = useCallback((index: number) => {
    setSeriesGroups(prev =>
      prev.map((g, i) => i === index ? { ...g, expanded: !g.expanded } : g)
    );
  }, []);

  // Toggle single group check
  const handleToggleCheck = useCallback((index: number) => {
    setSeriesGroups(prev =>
      prev.map((g, i) => i === index ? { ...g, checked: !g.checked } : g)
    );
  }, []);

  // Edit output path
  const handleEditPath = useCallback((index: number, path: string) => {
    setSeriesGroups(prev =>
      prev.map((g, i) => i === index ? { ...g, outputPath: path } : g)
    );
  }, []);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, group: SeriesGroup) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, group });
  }, []);

  useEffect(() => {
    const handleClick = useCallback((): void => setContextMenu(null), []);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Clear all
  const handleClear = useCallback(() => {
    setFiles({});
    setCurrentFolder('');
    setSeriesGroups([]);
  }, [setFiles, setCurrentFolder]);

  // Apply filters
  const displayGroups = seriesGroups.filter(group => {
    const query = filters.searchQuery.toLowerCase();
    if (query) {
      const matchesSeries = group.series.toLowerCase().includes(query);
      const matchesFile = group.files.some(f =>
        (f.title || '').toLowerCase().includes(query) ||
        (f.path || '').toLowerCase().includes(query)
      );
      if (!matchesSeries && !matchesFile) return false;
    }
    return true;
  });

  return (
    <div
      className="organizer-tab h-full flex flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Control Bar */}
      <div className="organizer-controls">
        <div className="control-left">
          <button
            className="ctrl-btn"
            onClick={handleToggleAllExpand}
            title="전체 펼치기 / 접기"
          >
            {allExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="ctrl-btn-text">전체 {allExpanded ? '접기' : '펼치기'}</span>
          </button>
          <button
            className="ctrl-btn"
            onClick={handleToggleAllCheck}
            title="전체 선택 / 선택 해제"
          >
            {allChecked ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
          <button
            className="ctrl-btn"
            onClick={handleBatchDefault}
            title="기본 경로 설정"
          >
            <RotateCcw size={16} />
            <span className="ctrl-btn-text">기본값</span>
          </button>
          <button
            className="ctrl-btn"
            onClick={handleBatchTitle}
            title="제목 일괄 설정"
          >
            <Bold size={16} />
            <span className="ctrl-btn-text">제목 설정</span>
          </button>
          <button
            className="ctrl-btn danger"
            onClick={handleClear}
            title="전체 삭제"
          >
            <Trash2 size={16} />
            <span className="ctrl-btn-text">삭제</span>
          </button>
        </div>

        <div className="control-right">
          <div className="search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="검색..."
              value={filters.searchQuery}
              onChange={(e) => setFilters({ searchQuery: e.target.value })}
              className="search-input"
            />
          </div>
          <button
            className="ctrl-btn primary"
            onClick={handleSelectFolder}
          >
            <FolderOpen size={16} />
            <span className="ctrl-btn-text">폴더 선택</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="organizer-content flex-1 overflow-hidden">
        {seriesGroups.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Tree Header */}
            <div className="tree-header">
              <div className="header-name">파일명</div>
              <div className="header-path">경로</div>
              <div className="header-count">항목수</div>
              <div className="header-size">용량</div>
            </div>

            {/* Tree Body */}
            <div className="tree-body overflow-auto">
              {displayGroups.map((group, index) => (
                <SeriesRow
                  key={group.series + group.path}
                  group={group}
                  index={index}
                  onToggleExpand={handleToggleExpand}
                  onToggleCheck={handleToggleCheck}
                  onEditPath={handleEditPath}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="organizer-footer">
        <span className="info-label">
          총 {seriesGroups.length}개 시리즈, {fileArray.length}개 파일
        </span>
        {dragState.isDragging && (
          <span className="drag-indicator">
            파일을 여기에 드롭하세요
          </span>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-item"
            onClick={() => {
              handleToggleExpand(
                seriesGroups.findIndex(g => g.series === contextMenu.group.series)
              );
              setContextMenu(null);
            }}
          >
            {contextMenu.group.expanded ? '접기' : '펼치기'}
          </button>
          <button
            className="context-item"
            onClick={() => {
              handleToggleCheck(
                seriesGroups.findIndex(g => g.series === contextMenu.group.series)
              );
              setContextMenu(null);
            }}
          >
            {contextMenu.group.checked ? '선택 해제' : '선택'}
          </button>
          <button
            className="context-item"
            onClick={async () => {
              const folderPath = await window.api.openDirectory({
                title: '출력 폴더 선택',
              });
              if (folderPath) {
                handleEditPath(
                  seriesGroups.findIndex(g => g.series === contextMenu.group.series),
                  folderPath
                );
              }
              setContextMenu(null);
            }}
          >
            출력 폴더 변경
          </button>
          <button
            className="context-item"
            onClick={() => {
              handleEditPath(
                seriesGroups.findIndex(g => g.series === contextMenu.group.series),
                contextMenu.group.path
              );
              setContextMenu(null);
            }}
          >
            기본 경로로 복원
          </button>
          <div className="context-divider" />
          <button
            className="context-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.group.series);
              setContextMenu(null);
            }}
          >
            <Copy size={14} className="inline mr-2" />
            시리즈명 복사
          </button>
          <button
            className="context-item"
            onClick={async () => {
              if (contextMenu.group.path) {
                await window.api.openPath(contextMenu.group.path);
              }
              setContextMenu(null);
            }}
          >
            <Eye size={14} className="inline mr-2" />
            폴더 열기
          </button>
        </div>
      )}
    </div>
  );
}
