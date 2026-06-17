import React, { useState, useEffect, useCallback } from 'react';
import { TabBar } from './components/TabBar';
import { SettingsModal } from './components/SettingsModal';
import { OrganizerTab } from './tabs/OrganizerTab';
import { RenamerTab } from './tabs/RenamerTab';
import { MetadataTab } from './tabs/MetadataTab';
import { FolderTab } from './tabs/FolderTab';
import { SharingTab } from './tabs/SharingTab';
import { ReleaseTab } from './tabs/ReleaseTab';
import { FaIcon } from './components/FaIcon';
import { useConfig } from './hooks/useConfig';
import { useI18n } from './hooks/useI18n';
import './styles/App.css';

const TABS = [
  { id: 'folder', labelKey: 'tab_folders' },
  { id: 'organizer', labelKey: 'tab1' },
  { id: 'renamer', labelKey: 'tab2' },
  { id: 'metadata', labelKey: 'tab3' },
  { id: 'sharing', labelKey: 'tab_sharing' },
  { id: 'releases', labelKey: 'tab_releases' },
];

function App() {
  const [activeTab, setActiveTab] = useState('folder');
  const [showSettings, setShowSettings] = useState(false);
  const { config, saveConfig: setConfig } = useConfig();
  const { t, language, changeLanguage } = useI18n();

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

  const handleSettingsClose = useCallback(async (updatedConfig) => {
    setShowSettings(false);
    if (updatedConfig) {
      const savedConfig = await setConfig(updatedConfig);
      const nextLang = savedConfig?.language || savedConfig?.lang || updatedConfig.language || updatedConfig.lang;
      if (nextLang) await changeLanguage(nextLang);
    }
  }, [setConfig, changeLanguage]);

  const translatedTabs = TABS.map(tab => ({
    ...tab,
    label: t(tab.labelKey),
  }));

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizer':
        return <OrganizerTab config={config} t={t} />;
      case 'renamer':
        return <RenamerTab config={config} t={t} />;
      case 'metadata':
        return <MetadataTab config={config} t={t} />;
      case 'folder':
        return <FolderTab config={config} saveConfig={setConfig} t={t} />;
      case 'sharing':
        return <SharingTab config={config} t={t} />;
      case 'releases':
        return <ReleaseTab config={config} t={t} />;
      default:
        return <FolderTab config={config} saveConfig={setConfig} t={t} />;
    }
  };

  return (
    <div className={`app-container ${language}`}>
      <div className="app-title-bar">
        {t('title')}
      </div>
      
      <div className="top-menu-bar">
        <div className="top-menu-left">
          <button className="top-btn"><FaIcon name="folder" />{t('add_folder')}</button>
          <button className="top-btn"><FaIcon name="file" />{t('add_file')}</button>
          <button className="top-btn"><FaIcon name="minusCircle" />{t('remove_sel')}</button>
          <button className="top-btn"><FaIcon name="trash" />{t('clear_all')}</button>
          <button className="top-btn"><FaIcon name="checkSquare" />{t('toggle_all')}</button>
        </div>
        <div className="top-menu-right">
          <button className="top-btn"><FaIcon name="bug" />{t('btn_issue')}</button>
          <button className="top-btn top-btn-version"><FaIcon name="circleCheck" />{t('msg_latest_version', ['2.8.1'])}</button>
          <button className="top-btn top-btn-settings" onClick={handleSettings}><FaIcon name="gear" />{t('settings_btn')}</button>
        </div>
      </div>
      
      <TabBar 
        tabs={translatedTabs}
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
