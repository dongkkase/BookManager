import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

function fontFamilyForConfig(fontFamily = 'Default') {
  if (!fontFamily || fontFamily === 'Default') {
    return "'Jua', Arial, 'Noto Sans KR', 'Malgun Gothic', 'Segoe UI Emoji', sans-serif";
  }
  return `'${String(fontFamily).replace(/'/g, "\\'")}', 'Segoe UI Emoji', sans-serif`;
}

function fontVarsForConfig(config = {}) {
  const scale = Math.max(0.8, Math.min(1.55, Number(config?.font_scale || 100) / 100));
  const size = value => `${Math.max(8, Math.round(value * scale))}px`;
  return {
    '--font-primary': fontFamilyForConfig(config?.font_family),
    '--font-scale': String(scale),
    '--font-xs': size(11),
    '--font-sm': size(12),
    '--font-base': size(13),
    '--font-md': size(14),
    '--font-lg': size(16),
    '--font-xl': size(18),
    '--font-2xl': size(20),
  };
}

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

  const dispatchAppAction = useCallback((action) => {
    window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { action, activeTab } }));
  }, [activeTab]);

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
  const appStyle = useMemo(() => fontVarsForConfig(config || {}), [config?.font_family, config?.font_scale]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'organizer':
        return <OrganizerTab config={config} t={t} />;
      case 'renamer':
        return <RenamerTab config={config} saveConfig={setConfig} t={t} />;
      case 'metadata':
        return <MetadataTab config={config} t={t} />;
      case 'folder':
        return <FolderTab config={config} saveConfig={setConfig} t={t} />;
      case 'sharing':
        return <SharingTab config={config} saveConfig={setConfig} t={t} />;
      case 'releases':
        return <ReleaseTab config={config} t={t} />;
      default:
        return <FolderTab config={config} saveConfig={setConfig} t={t} />;
    }
  };

  return (
    <div className={`app-container ${language}`} style={appStyle}>
      <div className="app-title-bar">
        {t('title')}
      </div>
      
      <div className="top-menu-bar">
        <div className="top-menu-left">
          <button className="top-btn" onClick={() => dispatchAppAction('add-folder')}><FaIcon name="folder" />{t('add_folder')}</button>
          <button className="top-btn" onClick={() => dispatchAppAction('add-file')}><FaIcon name="file" />{t('add_file')}</button>
          <button className="top-btn" onClick={() => dispatchAppAction('remove-selected')}><FaIcon name="minusCircle" />{t('remove_sel')}</button>
          <button className="top-btn" onClick={() => dispatchAppAction('clear-all')}><FaIcon name="trash" />{t('clear_all')}</button>
          <button className="top-btn" onClick={() => dispatchAppAction('toggle-all')}><FaIcon name="checkSquare" />{t('toggle_all')}</button>
        </div>
        <div className="top-menu-right">
          <button className="top-btn" onClick={() => window.electronAPI?.openExternal?.('https://github.com/dongkkase/ComicZIP_Optimizer/issues')}><FaIcon name="bug" />{t('btn_issue')}</button>
          <button className="top-btn top-btn-version" onClick={() => setActiveTab('releases')}><FaIcon name="circleCheck" />{t('msg_latest_version', ['2.8.1'])}</button>
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
