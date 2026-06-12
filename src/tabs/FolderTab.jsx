import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { FolderSidebar } from '../components/folder/FolderSidebar';
import { FileTableView } from '../components/folder/FileTableView';
import { ThumbnailView } from '../components/folder/ThumbnailView';
import { TileView } from '../components/folder/TileView';
import { DetailPanel } from '../components/folder/DetailPanel';
import '../styles/FolderTab.css';

function FolderTab({ config, t }) {
  // --- 폴더 상태 ---
  const [selectedFolderPath, setSelectedFolderPath] = useState('');
  const [fileDataCache, setFileDataCache] = useState({});
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('대기 중...');

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

  // --- 선택 상태 ---
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedFileData, setSelectedFileData] = useState(null);

  // --- 사이드바 상태 ---
  const [libraries, setLibraries] = useState([]);
  const [favorites, setFavorites] = useState([]);

  // --- refs ---
  const fileTableRef = useRef(null);

  // 파일 데이터 가져오기 (캐시에서)
  const getCurrentFileData = useCallback(() => {
    if (!selectedFolderPath) return [];
    return fileDataCache[selectedFolderPath] || [];
  }, [fileDataCache, selectedFolderPath]);

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

  // 폴더 변경 핸들러
  const handleFolderChange = useCallback(async (folderPath) => {
    setSelectedFolderPath(folderPath);
    setSelectedFiles([]);
    setSelectedFileData(null);
    setSearchQuery('');
    await scanFolder(folderPath);
  }, []);

  // 폴더 스캔
  const scanFolder = useCallback(async (folderPath) => {
    setScanning(true);
    setScanProgress(0);
    setStatusMessage(t('folder.status.scanning') || '폴더 스캔 중...');
    try {
      const files = await window.electronAPI?.scanFolder(folderPath, includeSubfolders) || [];
      setFileDataCache(prev => ({
        ...prev,
        [folderPath]: files,
      }));
      setScanProgress(100);
      setStatusMessage(`${files.length}개 항목 확인`);
    } catch (error) {
      console.error('폴더 스캔 실패:', error);
      setStatusMessage('스캔 중 오류 발생');
    } finally {
      setScanning(false);
    }
  }, [includeSubfolders, t]);

  const handleRefresh = useCallback(() => {
    if (selectedFolderPath) scanFolder(selectedFolderPath);
  }, [selectedFolderPath, scanFolder]);

  const handleFileSelect = useCallback((files, fileData) => {
    setSelectedFiles(files);
    if (fileData && files.length > 0) {
      setSelectedFileData(fileData);
    } else {
      setSelectedFileData(null);
    }
  }, []);

  // --- IPC ---
  useEffect(() => {
    const handleScanProgress = (event, progress) => {
      setScanProgress(progress);
      setStatusMessage(`스캔 진행률: ${Math.round(progress)}%`);
    };
    const handleScanComplete = (event, files) => {
      setFileDataCache(prev => ({ ...prev, [selectedFolderPath]: files || [] }));
      setScanProgress(100);
      setScanning(false);
      setStatusMessage(`${files?.length || 0}개 파일 발견`);
    };
    window.electronIPC?.on('scan-progress', handleScanProgress);
    window.electronIPC?.on('scan-complete', handleScanComplete);
    return () => {
      window.electronIPC?.removeListener('scan-progress', handleScanProgress);
      window.electronIPC?.removeListener('scan-complete', handleScanComplete);
    };
  }, [selectedFolderPath]);

  // View Stack
  const renderViewStack = () => {
    const props = {
      fileData: filteredFileData,
      selectedFiles,
      sortKey,
      sortOrder,
      groupKey,
      onFileSelect: handleFileSelect,
      t,
    };
    switch (viewMode) {
      case 'thumbnail': return <ThumbnailView {...props} scale={itemScale} />;
      case 'tile': return <TileView {...props} scale={itemScale} />;
      case 'table':
      default: return <FileTableView ref={fileTableRef} files={filteredFileData} selectedFiles={selectedFiles} onSelect={(path) => handleFileSelect([path])} t={t} />;
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
              <button className="warning-btn">누락 권수 확인 ⚠️ 70</button>
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
              
              <div className="custom-dropdown">그룹화 ▼</div>
              <div className="custom-dropdown">필터 ▼</div>
              <div className="custom-dropdown">정렬 ▼</div>
              <div className="custom-dropdown">레이아웃 관리 ▼</div>
              
              <button className="csv-btn">CSV 내보내기</button>
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

          <div className="view-container">
             {renderViewStack()}
          </div>

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
    </div>
  );
}

export { FolderTab };
