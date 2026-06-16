import React, { useState, useRef, useMemo, useCallback } from 'react';
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

function FolderTab({ config, t }) {
  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const { scanning, scanProgress, fileDataCache, statusMessage, scanFolder, getCachedFiles } = useFolderScan(t);

  // --- UI 토글 상태 ---
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  // --- 뷰 상태 ---
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'thumbnail' | 'tile'
  const [sortKey, setSortKey] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [groupKey, setGroupKey] = useState('none');
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [enableDupCheck, setEnableDupCheck] = useState(false);
  const [itemScale, setItemScale] = useState(50); // 항목 크기 슬라이더

  // --- 검색 상태 ---
  const [searchQuery, setSearchQuery] = useState('');

  // 파일 데이터 가져오기 (캐시에서)
  const getCurrentFileData = useCallback(() => {
    if (!selectedFolderPath) return [];
    return getCachedFiles(selectedFolderPath) || [];
  }, [getCachedFiles, selectedFolderPath]);

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
  const { selectedFiles, selectedFileData, selectFile, clearSelection } = useFileSelection(filteredFileData);

  // --- 사이드바 상태 ---
  const [libraries, setLibraries] = useState([]);
  const [favorites, setFavorites] = useState([]);

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
    await scanFolder(folderPath, { includeSubfolders, enableDupCheck });
  }, [includeSubfolders, enableDupCheck, scanFolder, clearSelection]);

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
    if (selectedFolderPath) scanFolder(selectedFolderPath, { includeSubfolders, enableDupCheck });
  }, [selectedFolderPath, scanFolder, includeSubfolders, enableDupCheck]);

  const handleFileSelect = useCallback((filesOrPath) => {
    if (Array.isArray(filesOrPath)) {
      if (filesOrPath.length > 0) selectFile(filesOrPath[0]);
      else clearSelection();
    } else {
      selectFile(filesOrPath);
    }
  }, [selectFile, clearSelection]);

  // View Stack
  const renderViewStack = () => {
    const props = {
      fileData: filteredFileData,
      selectedFiles,
      sortKey,
      sortOrder,
      groupKey,
      onSelect: handleFileSelect,
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} onSelect={handleFileSelect} t={t} sortKey={sortKey} groupKey={groupKey} />;
    }
  };

  return (
    <div className="folder-tab">
      <div className="folder-main-area">
        
        {/* Left Panel */}
        {isSidebarVisible && (
          <div className="folder-left-panel">
            <div className="left-toolbar">
              <div className="left-toolbar-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={includeSubfolders} onChange={e => setIncludeSubfolders(e.target.checked)} />
                  하위 폴더 포함
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={enableDupCheck} onChange={e => setEnableDupCheck(e.target.checked)} />
                  중복 검사
                </label>
              </div>
              <button className="full-btn" onClick={handleRefresh}>새로고침 (F5)</button>
            </div>
            
            <div className="sidebar-container">
              <FolderSidebar
                libraries={libraries}
                favorites={favorites}
                selectedFolderPath={selectedFolderPath}
                onSelectFolder={handleFolderChange}
                t={t}
              />
            </div>
            
            <div className="left-bottom-bar">
              <button 
                className="warning-btn" 
                onClick={checkMissingVolumes} 
                disabled={isCheckingMissing}
              >
                {isCheckingMissing ? '분석 중...' : (missingData.length > 0 ? `누락 권수 확인 🔴 ${missingData.length}` : '누락 권수 확인')}
              </button>
            </div>
          </div>
        )}

        {/* Right Panel */}
        <div className="folder-right-panel">
          <div className="right-toolbar">
            <div className="right-toolbar-left">
              <button 
                className={`toggle-btn ${isSidebarVisible ? 'active' : ''}`}
                style={{ backgroundColor: isSidebarVisible ? '#3498DB' : '#3a3a3a', color: 'white', border: '1px solid #555' }}
                onClick={() => setIsSidebarVisible(!isSidebarVisible)}
              >
                {isSidebarVisible ? '✓ 사이드바' : '사이드바'}
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
              />
            </div>
            
            <div className="right-toolbar-right">
              <input 
                type="text" 
                className="search-input" 
                placeholder="검색 (제목, 작가, 파일명 등)..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button className="refresh-btn" onClick={handleRefresh}>새로고침 (F5)</button>
            </div>
          </div>

          <div className="view-container" style={{ flex: 1, overflow: 'hidden' }}>
             {renderViewStack()}
          </div>
          
          {selectedFileData && (
            <div style={{ height: '250px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
              <DetailPanel selectedFile={selectedFileData} t={t} />
            </div>
          )}

          <div className="right-bottom-bar">
            <div className="status-info">
              선택: {selectedFiles.length > 0 ? selectedFiles[0] : '없음'} | 항목: {filteredFileData.length}개 | 총 용량: 0 B
            </div>
            <div className="view-controls">
              <button className={`view-icon-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>☰</button>
              <button className={`view-icon-btn ${viewMode === 'tile' ? 'active' : ''}`} onClick={() => setViewMode('tile')}>☷</button>
              <button className={`view-icon-btn ${viewMode === 'thumbnail' ? 'active' : ''}`} onClick={() => setViewMode('thumbnail')}>▦</button>
              <span className="scale-label">항목 크기:</span>
              <input type="range" className="scale-slider" min="10" max="100" value={itemScale} onChange={e => setItemScale(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
      
      {/* Global Bottom Status Bar */}
      <div className="global-status-bar">
        <span className="status-message">{statusMessage}</span>
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
    </div>
  );
}

export { FolderTab };
