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
  { id: 'organizer', label: 'organizer' },
  { id: 'renamer', label: 'renamer' },
  { id: 'metadata', label: 'metadata' },
  { id: 'folder', label: 'folder' },
  { id: 'sharing', label: 'sharing' },
];

function App() {
  const [activeTab, setActiveTab] = useState('organizer');
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useConfig();
  const { t, lang } = useI18n();

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
      window.electronAPI.saveConfig(updatedConfig);
    }
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizer':
        return <OrganizerTab config={config} />;
      case 'renamer':
        return <RenamerTab config={config} />;
      case 'metadata':
        return <MetadataTab config={config} />;
      case 'folder':
        return <FolderTab config={config} />;
      case 'sharing':
        return <SharingTab config={config} />;
      default:
        return <OrganizerTab config={config} />;
    }
  };

  return (
    <div className={`app ${lang}`}>
      <div className="app-header">
        <div className="app-title">BookManager</div>
        <div className="app-actions">
          <button className="settings-btn" onClick={handleSettings}>
            ⚙️ 설정
          </button>
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
