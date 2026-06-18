import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { FolderSidebar } from '../components/folder/FolderSidebar';
import { FileTableView } from '../components/folder/FileTableView';
import { ThumbnailView } from '../components/folder/ThumbnailView';
import { TileView } from '../components/folder/TileView';
import { DetailPanel } from '../components/folder/DetailPanel';
import { FolderToolbar } from '../components/folder/FolderToolbar';
import { MissingVolumesDialog } from '../components/folder/MissingVolumesDialog';
import { extractCoreTitle, extractVolNumbers } from '../utils/folderUtils';
import { useFolderScan } from '../hooks/useFolderScan';
import { useFileSelection } from '../hooks/useFileSelection';
import '../styles/FolderTab.css';

function parentPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '';
}

function FolderTab({ config, saveConfig, t }) {
  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const { scanning, scanProgress, statusMessage, scanFolder, getCachedFiles } = useFolderScan(t);
  const mainAreaRef = useRef(null);
  const rightPanelRef = useRef(null);

  // --- UI 토글 상태 ---
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(292);
  const [detailPanelHeight, setDetailPanelHeight] = useState(318);

  // --- 뷰 상태 ---
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'thumbnail' | 'tile'
  const [sortKey, setSortKey] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [groupKey, setGroupKey] = useState('none');
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [enableDupCheck, setEnableDupCheck] = useState(false);
  const [itemScales, setItemScales] = useState({ table: 50, tile: 50, thumbnail: 50 });
  const [showLayoutDialog, setShowLayoutDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  // --- 검색 상태 ---
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  const scanOptions = useMemo(() => ({
    includeSubfolders,
    enableDupCheck,
    dupFolders: config?.dup_check_folders || [],
  }), [includeSubfolders, enableDupCheck, config?.dup_check_folders]);

  // 파일 데이터 가져오기 (캐시에서)
  const getCurrentFileData = useCallback(() => {
    if (!selectedFolderPath) return [];
    return getCachedFiles(selectedFolderPath, scanOptions) || [];
  }, [getCachedFiles, selectedFolderPath, scanOptions]);

  // 필터링된 파일 데이터
  const filteredFileData = useMemo(() => {
    const files = getCurrentFileData();
    if (!searchQuery.trim()) return files;
    const query = searchQuery.toLowerCase();
    return files.filter(file => {
      const name = (file.name || '').toLowerCase();
      const path = (file.path || '').toLowerCase();
      const series = (file.series || '').toLowerCase();
      const title = (file.title || '').toLowerCase();
      return name.includes(query) || path.includes(query) || series.includes(query) || title.includes(query);
    });
  }, [getCurrentFileData, searchQuery]);

  // --- 선택 상태 ---
  const {
    selectedFiles,
    selectedFileData,
    selectFile,
    toggleFile,
    rangeSelect,
    clearSelection,
    selectAll,
    deselectAll,
    invertSelection,
  } = useFileSelection(filteredFileData);
  const activeSelectedFile = selectedFileData();
  const itemScale = itemScales[viewMode] || 50;

  // --- 사이드바 상태 ---
  const libraries = useMemo(() => (
    [...new Set([...(config?.libraries || []), ...(config?.dup_check_folders || [])])]
  ), [config?.libraries, config?.dup_check_folders]);
  const favorites = config?.favorites || [];

  const addLibrary = useCallback(async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder('라이브러리 폴더 선택');
      if (folderPath && saveConfig && !libraries.includes(folderPath)) {
        const nextLibraries = [...libraries, folderPath];
        await saveConfig({
          libraries: nextLibraries,
          dup_check_folders: nextLibraries,
        });
      }
    } catch (e) {
      console.error(e);
    }
  }, [libraries, saveConfig]);

  const removeLibrary = useCallback(async (path) => {
    if (saveConfig) {
      const nextLibraries = libraries.filter(l => l !== path);
      await saveConfig({
        libraries: nextLibraries,
        dup_check_folders: nextLibraries,
      });
    }
  }, [libraries, saveConfig]);

  const addFavorite = useCallback(async (path) => {
    if (saveConfig && !favorites.includes(path)) {
      await saveConfig({ favorites: [...favorites, path] });
    }
  }, [favorites, saveConfig]);

  const removeFavorite = useCallback(async (path) => {
    if (saveConfig) {
      await saveConfig({ favorites: favorites.filter(f => f !== path) });
    }
  }, [favorites, saveConfig]);

  // --- 누락 권수 상태 ---
  const [missingData, setMissingData] = useState([]);
  const [showMissingDialog, setShowMissingDialog] = useState(false);
  const [isCheckingMissing, setIsCheckingMissing] = useState(false);

  // --- refs ---
  const fileTableRef = useRef(null);

  // 폴더 변경 핸들러
  const handleFolderChange = useCallback(async (folderPath) => {
    setSelectedFolderPath(folderPath);
    clearSelection();
    setSearchQuery('');
    await scanFolder(folderPath, scanOptions);
  }, [scanOptions, scanFolder, clearSelection]);

  // 누락 권수 확인
  const checkMissingVolumes = useCallback(async () => {
    setIsCheckingMissing(true);
    // 현재 표시되는 파일들 중 폴더가 아닌 파일만 대상으로 누락 권수 확인
    const seriesMap = {};
    
    // 비동기 작업인 척 하기 위해 setTimeout 사용 (대량 데이터일 수 있으므로)
    setTimeout(() => {
      filteredFileData.forEach(file => {
        if (file.is_folder) return;
        const seriesName = file.series || extractCoreTitle(file.name) || 'Unknown';
        if (!seriesMap[seriesName]) {
          seriesMap[seriesName] = [];
        }
        seriesMap[seriesName].push({
          name: file.name,
          folder_path: file.path || file.folder_path,
          series_name: seriesName
        });
      });

      const missing = [];
      for (const [sName, items] of Object.entries(seriesMap)) {
        const vols = new Set();
        let folderPath = '';
        items.forEach(item => {
          const vNums = extractVolNumbers(item.name, item.series_name);
          vNums.forEach(v => vols.add(v));
          if (!folderPath) folderPath = item.folder_path;
        });

        if (vols.size > 0) {
          const arr = Array.from(vols).sort((a, b) => a - b);
          const minV = arr[0];
          const maxV = arr[arr.length - 1];
          if (maxV - minV < 150) {
            const missingVols = [];
            for (let i = minV; i <= maxV; i++) {
              if (!vols.has(i)) missingVols.push(String(i));
            }
            if (missingVols.length > 0) {
              missing.push({
                series: sName,
                missing: missingVols,
                folder_path: folderPath
              });
            }
          }
        }
      }
      
      missing.sort((a, b) => a.series.localeCompare(b.series));
      setMissingData(missing);
      setIsCheckingMissing(false);
      setShowMissingDialog(true);
    }, 100);
  }, [filteredFileData]);

  const handleRefresh = useCallback(() => {
    if (selectedFolderPath) scanFolder(selectedFolderPath, { ...scanOptions, force: true });
  }, [selectedFolderPath, scanFolder, scanOptions]);

  const handleAddFolderFromToolbar = useCallback(async () => {
    const folderPath = await window.electronAPI?.selectFolder?.(t('add_folder'));
    if (folderPath) await handleFolderChange(folderPath);
  }, [handleFolderChange, t]);

  const handleAddFileFromToolbar = useCallback(async () => {
    const paths = await window.electronAPI?.selectFiles?.(t('add_file'), [
      { name: 'Archives', extensions: ['zip', 'cbz', 'cbr', '7z', 'rar'] },
    ]);
    const firstParent = parentPath(paths?.[0]);
    if (firstParent) await handleFolderChange(firstParent);
  }, [handleFolderChange, t]);

  const handleFileSelect = useCallback((filePath, event, index) => {
    if (Array.isArray(filePath)) {
      if (filePath.length > 0) selectFile(filePath[0]);
      else clearSelection();
      return;
    }
    if (!filePath) return;
    if (event?.shiftKey) {
      rangeSelect(filePath, null, index);
    } else if (event?.ctrlKey || event?.metaKey) {
      toggleFile(filePath, null, index);
    } else {
      selectFile(filePath, null, index);
    }
  }, [clearSelection, rangeSelect, selectFile, toggleFile]);

  const selectedFileObjects = useMemo(() => (
    selectedFiles.map(filePath => filteredFileData.find(file => file.path === filePath)).filter(Boolean)
  ), [filteredFileData, selectedFiles]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openSelectedInExplorer = useCallback(async () => {
    const target = activeSelectedFile?.full_path || activeSelectedFile?.path || selectedFolderPath;
    if (target) await window.electronAPI?.showInFolder?.(target);
  }, [activeSelectedFile, selectedFolderPath]);

  const openFolderPath = useCallback(async (folderPath) => {
    if (folderPath) await window.electronAPI?.openInExplorer?.(folderPath);
  }, []);

  const deleteSelectedFiles = useCallback(async () => {
    const targets = selectedFileObjects.map(file => file.full_path || file.path).filter(Boolean);
    if (targets.length === 0) return;
    if (!window.confirm(`${targets.length}개 항목을 휴지통으로 이동할까요?`)) return;
    await window.electronAPI?.deleteFiles?.(targets);
    clearSelection();
    handleRefresh();
  }, [clearSelection, handleRefresh, selectedFileObjects]);

  const showFileContextMenu = useCallback((event, file, index) => {
    event.preventDefault();
    if (file?.path && !selectedFiles.includes(file.path)) {
      selectFile(file.path, null, index);
    }
    setContextMenu({ type: 'file', x: event.clientX, y: event.clientY, file });
  }, [selectFile, selectedFiles]);

  const showFolderContextMenu = useCallback((event, folderPath) => {
    event.preventDefault();
    setContextMenu({ type: 'folder', x: event.clientX, y: event.clientY, folderPath });
  }, []);

  const handleContextAction = useCallback(async (action) => {
    const menu = contextMenu;
    closeContextMenu();
    if (!menu) return;

    if (action === 'open-folder') {
      handleFolderChange(menu.folderPath || selectedFolderPath);
    } else if (action === 'open-explorer') {
      await openFolderPath(menu.folderPath || selectedFolderPath);
    } else if (action === 'favorite-folder') {
      await addFavorite(menu.folderPath || selectedFolderPath);
    } else if (action === 'refresh-folder') {
      const folderPath = menu.folderPath || selectedFolderPath;
      if (folderPath) await scanFolder(folderPath, { ...scanOptions, force: true });
    } else if (action === 'show-file') {
      const target = menu.file?.full_path || menu.file?.path;
      if (target) await window.electronAPI?.showInFolder?.(target);
    } else if (action === 'delete-file') {
      await deleteSelectedFiles();
    }
  }, [addFavorite, closeContextMenu, contextMenu, deleteSelectedFiles, handleFolderChange, openFolderPath, scanFolder, scanOptions, selectedFolderPath]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) return;

      if (event.key === 'F5') {
        event.preventDefault();
        handleRefresh();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        invertSelection();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        clearSelection();
        closeContextMenu();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedFiles();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openSelectedInExplorer();
      } else if (event.key === '1') {
        setViewMode('table');
      } else if (event.key === '2') {
        setViewMode('tile');
      } else if (event.key === '3') {
        setViewMode('thumbnail');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', closeContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', closeContextMenu);
    };
  }, [clearSelection, closeContextMenu, deleteSelectedFiles, handleRefresh, invertSelection, openSelectedInExplorer, selectAll]);

  useEffect(() => {
    const handleAppAction = (event) => {
      const action = event.detail?.action;
      if (action === 'add-folder') handleAddFolderFromToolbar();
      else if (action === 'add-file') handleAddFileFromToolbar();
      else if (action === 'remove-selected') deleteSelectedFiles();
      else if (action === 'clear-all') clearSelection();
      else if (action === 'toggle-all') {
        if (selectedFiles.length >= filteredFileData.length && filteredFileData.length > 0) deselectAll();
        else selectAll();
      }
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [
    clearSelection,
    deleteSelectedFiles,
    deselectAll,
    filteredFileData.length,
    handleAddFileFromToolbar,
    handleAddFolderFromToolbar,
    selectAll,
    selectedFiles.length,
  ]);

  const startHorizontalResize = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const containerWidth = mainAreaRef.current?.clientWidth || 1200;

    const handleMove = (moveEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      const maxWidth = Math.max(240, containerWidth - 520);
      setLeftPanelWidth(Math.min(maxWidth, Math.max(220, nextWidth)));
    };

    const handleUp = () => {
      document.body.classList.remove('is-resizing-panel');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [leftPanelWidth]);

  const startVerticalResize = useCallback((event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = detailPanelHeight;
    const containerHeight = rightPanelRef.current?.clientHeight || 700;

    const handleMove = (moveEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      const maxHeight = Math.max(180, containerHeight - 150);
      setDetailPanelHeight(Math.min(maxHeight, Math.max(180, nextHeight)));
    };

    const handleUp = () => {
      document.body.classList.remove('is-resizing-panel');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    document.body.classList.add('is-resizing-panel');
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [detailPanelHeight]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  }, [sortKey]);

  // View Stack
  const renderViewStack = () => {
    const props = {
      fileData: filteredFileData,
      selectedFiles,
      sortKey,
      sortOrder,
      groupKey,
      onSelect: handleFileSelect,
      onContextMenu: showFileContextMenu,
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} onSelect={handleFileSelect} onContextMenu={showFileContextMenu} onSort={handleSort} t={t} sortKey={sortKey} sortOrder={sortOrder} groupKey={groupKey} scale={itemScale} />;
    }
  };

  return (
    <div className="folder-tab">
      <div className="folder-main-area" ref={mainAreaRef}>
        
        {/* Left Panel */}
        {isSidebarVisible && (
          <div className="folder-left-panel" style={{ flexBasis: `${leftPanelWidth}px`, width: `${leftPanelWidth}px` }}>
            <div className="left-toolbar">
              <div className="left-toolbar-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={includeSubfolders} onChange={e => setIncludeSubfolders(e.target.checked)} />
                  {t('folder.toolbar.include_subfolders')}
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={enableDupCheck} onChange={e => setEnableDupCheck(e.target.checked)} />
                  {t('folder.toolbar.dup_check')}
                </label>
              </div>
              <button className="full-btn" onClick={handleRefresh}>{t('folder.toolbar.refresh')}</button>
            </div>
            
            <div className="sidebar-container">
              <FolderSidebar
                libraries={libraries}
                favorites={favorites}
                selectedFolderPath={selectedFolderPath}
                onSelectFolder={handleFolderChange}
                onAddLibrary={addLibrary}
                onRemoveLibrary={removeLibrary}
                onAddFavorite={addFavorite}
                onRemoveFavorite={removeFavorite}
                onFolderContextMenu={showFolderContextMenu}
                t={t}
              />
            </div>
            
            <div className="left-bottom-bar">
              <button 
                className="warning-btn" 
                onClick={checkMissingVolumes} 
                disabled={isCheckingMissing}
              >
                {isCheckingMissing ? t('msg_analyzing') : (missingData.length > 0 ? `${t('tf_btn_check_missing')} 🔴 ${missingData.length}` : t('tf_btn_check_missing'))}
              </button>
            </div>
          </div>
        )}

        {isSidebarVisible && (
          <div
            className="folder-resizer folder-resizer-vertical"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startHorizontalResize}
          />
        )}

        {/* Right Panel */}
        <div className="folder-right-panel" ref={rightPanelRef}>
          <div className="right-toolbar">
            <div className="right-toolbar-left">
              <button 
                className={`toggle-btn ${isSidebarVisible ? 'active' : ''}`}
                onClick={() => setIsSidebarVisible(!isSidebarVisible)}
              >
                ✓ 사이드바
              </button>
              
              <FolderToolbar 
                t={t}
                viewMode={viewMode}
                setViewMode={setViewMode}
                sortKey={sortKey}
                setSortKey={setSortKey}
                groupKey={groupKey}
                setGroupKey={setGroupKey}
                includeSubfolders={includeSubfolders}
                setIncludeSubfolders={setIncludeSubfolders}
                enableDupCheck={enableDupCheck}
                setEnableDupCheck={setEnableDupCheck}
                onRefresh={handleRefresh}
                onLayoutClick={() => setShowLayoutDialog(true)}
              />
            </div>
            
            <div className="right-toolbar-right">
              <input 
                type="text" 
                className="search-input" 
                ref={searchInputRef}
                placeholder={t('folder.toolbar.search')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button className="refresh-btn" onClick={handleRefresh}>{t('folder.toolbar.refresh')}</button>
            </div>
          </div>

          <div className="view-container">
             {renderViewStack()}
          </div>
          
          {activeSelectedFile && (
            <>
              <div
                className="folder-resizer folder-resizer-horizontal"
                role="separator"
                aria-orientation="horizontal"
                onMouseDown={startVerticalResize}
              />
              <div className="detail-panel-wrap" style={{ flexBasis: `${detailPanelHeight}px`, height: `${detailPanelHeight}px` }}>
                <DetailPanel selectedFile={activeSelectedFile} t={t} />
              </div>
            </>
          )}

          <div className="right-bottom-bar">
            <div className="status-info">
              {formatStatus(t, selectedFiles, filteredFileData)}
            </div>
            <div className="view-controls">
              <button className={`view-icon-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>☰</button>
              <button className={`view-icon-btn ${viewMode === 'tile' ? 'active' : ''}`} onClick={() => setViewMode('tile')}>☷</button>
              <button className={`view-icon-btn ${viewMode === 'thumbnail' ? 'active' : ''}`} onClick={() => setViewMode('thumbnail')}>▦</button>
              <span className="scale-label">{t('folder_item_size')}</span>
              <input
                type="range"
                className="scale-slider"
                min="10"
                max="100"
                value={itemScale}
                onChange={e => setItemScales(prev => ({ ...prev, [viewMode]: Number(e.target.value) }))}
              />
            </div>
          </div>
        </div>
      </div>
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          {contextMenu.type === 'folder' ? (
            <>
              <button onClick={() => handleContextAction('open-folder')}>열기</button>
              <button onClick={() => handleContextAction('open-explorer')}>탐색기에서 열기</button>
              <button onClick={() => handleContextAction('favorite-folder')}>즐겨찾기에 추가</button>
              <button onClick={() => handleContextAction('refresh-folder')}>새로고침</button>
            </>
          ) : (
            <>
              <button onClick={() => handleContextAction('show-file')}>파일 위치 열기</button>
              <button onClick={() => handleContextAction('delete-file')}>선택 삭제</button>
            </>
          )}
        </ContextMenu>
      )}
      
      {/* Global Bottom Status Bar */}
      <div className="global-status-bar">
        <span className="status-message">{scanning ? `${statusMessage} (${scanProgress}%)` : statusMessage}</span>
      </div>
      {showMissingDialog && (
        <MissingVolumesDialog
          missingData={missingData}
          onClose={() => setShowMissingDialog(false)}
          onGoToFolder={(path) => {
            setShowMissingDialog(false);
            handleFolderChange(path);
          }}
          t={t}
        />
      )}
      {showLayoutDialog && (
        <LayoutEditDialog onClose={() => setShowLayoutDialog(false)} t={t} />
      )}
    </div>
  );
}

function ContextMenu({ x, y, children }) {
  return (
    <div className="folder-context-menu" style={{ left: x, top: y }} onClick={event => event.stopPropagation()}>
      {children}
    </div>
  );
}

function LayoutEditDialog({ onClose, t }) {
  const columns = [
    '커버', '파일명', '용량', '해상도', '수정일', '생성일', '파일경로', '확장자',
    '시리즈', '제목', '권', '화', '작가', '시리즈 그룹', '제작진', '출판사',
    '임프린트', '장르', '전체권수', '페이지수', '포맷',
  ];

  const checked = new Set(['커버', '파일명', '용량', '해상도', '수정일', '생성일', '시리즈', '제목', '권', '화', '작가', '시리즈 그룹', '제작진', '출판사']);

  return (
    <div className="folder-dialog-backdrop">
      <div className="layout-dialog">
        <div className="dialog-titlebar">
          <span>▣ {t('dlg_edit_lay_title')}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="layout-dialog-body">
          <div className="layout-dialog-label">{t('dlg_edit_lay_msg')}</div>
          <div className="layout-column-list">
            {columns.map(column => (
              <label key={column} className="layout-column-row">
                <input type="checkbox" defaultChecked={checked.has(column)} />
                <span>{column}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="layout-dialog-footer">
          <button onClick={onClose}>{t('btn_ok')}</button>
          <button onClick={onClose}>{t('btn_cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatStatus(t, selectedFiles, files) {
  const totalSize = formatBytes(files.reduce((sum, file) => sum + (Number(file.size) || 0), 0));
  const selected = selectedFiles.length > 0 ? selectedFiles[0] : t('menu_none');
  return t('folder_status_sel', [selected, files.length, totalSize]);
}

export { FolderTab };
