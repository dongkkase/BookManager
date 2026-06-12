import React, { useState, useEffect, useCallback } from 'react';
import { TabBar } from './components/TabBar';
import { SettingsModal } from './components/SettingsModal';
import { OrganizerTab } from './tabs/OrganizerTab';
import { RenamerTab } from './tabs/RenamerTab';
import { MetadataTab } from './tabs/MetadataTab';
import { FolderTab } from './tabs/FolderTab';
import { SharingTab } from './tabs/SharingTab';
import { useConfig } from './hooks/useConfig';
import { useI18n } from './hooks/useI18n';
import './styles/App.css';

const TABS = [
  { id: 'folder', label: '폴더' },
  { id: 'organizer', label: '압축 파일 구조 정리(평탄화)' },
  { id: 'renamer', label: '내부 파일명 변경' },
  { id: 'metadata', label: '메타데이터 관리' },
  { id: 'sharing', label: '공유 서버' },
  { id: 'releases', label: '업데이트 및 릴리즈 노트' },
];

function App() {
  const [activeTab, setActiveTab] = useState('folder');
  const [showSettings, setShowSettings] = useState(false);
  const { config, saveConfig: setConfig } = useConfig();
  const { t, language } = useI18n();

  useEffect(() => {
    // 앱 초기화
    const initApp = async () => {
      try {
        // 설정 로드
        const loadedConfig = await window.electronAPI.getConfig();
        if (loadedConfig) {
          setConfig(loadedConfig);
        }
      } catch (error) {
        console.error('앱 초기화 실패:', error);
      }
    };

    initApp();
  }, []);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
  }, []);

  const handleSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleSettingsClose = useCallback((updatedConfig) => {
    setShowSettings(false);
    if (updatedConfig) {
      setConfig(updatedConfig);
    }
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizer':
        return <OrganizerTab config={config} t={t} />;
      case 'renamer':
        return <RenamerTab config={config} t={t} />;
      case 'metadata':
        return <MetadataTab config={config} t={t} />;
      case 'folder':
        return <FolderTab config={config} t={t} />;
      case 'sharing':
        return <SharingTab config={config} t={t} />;
      case 'releases':
        return <div style={{ padding: '20px', color: '#fff' }}>업데이트 및 릴리즈 노트 탭 구현 필요</div>;
      default:
        return <FolderTab config={config} t={t} />;
    }
  };

  return (
    <div className={`app-container ${language}`}>
      <div className="app-title-bar">
        ComicZIP Optimizer v2.8.1
      </div>
      
      <div className="top-menu-bar">
        <div className="top-menu-left">
          <button className="top-btn">📁 폴더 추가</button>
          <button className="top-btn">📄 파일 추가</button>
          <button className="top-btn">➖ 선택 삭제</button>
          <button className="top-btn">🗑️ 전체 비우기</button>
          <button className="top-btn">☑️ 전체 선택/해제</button>
        </div>
        <div className="top-menu-right">
          <button className="top-btn">🐛 버그 신고 및 건의</button>
          <button className="top-btn top-btn-version">✅ v2.8.1 (최신 버전)</button>
          <button className="top-btn top-btn-settings" onClick={handleSettings}>⚙️ 환경 설정</button>
        </div>
      </div>
      
      <TabBar 
        tabs={TABS} 
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        t={t}
      />
      
      <div className="app-content">
        {renderTabContent()}
      </div>

      {showSettings && (
        <SettingsModal 
          config={config} 
          onClose={handleSettingsClose}
          t={t}
        />
      )}
    </div>
  );
}

export default App;
