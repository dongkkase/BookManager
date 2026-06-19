import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabBar } from './components/TabBar';
import { SettingsModal } from './components/SettingsModal';
import { OrganizerTab } from './tabs/OrganizerTab';
import { RenamerTab } from './tabs/RenamerTab';
import { MetadataTab } from './tabs/MetadataTab';
import { FolderTab } from './tabs/FolderTab';
import { SharingTab } from './tabs/SharingTab';
import { ReleaseTab } from './tabs/ReleaseTab';
import { FaIcon } from './components/FaIcon';
import { Toast } from './components/Toast';
import { useConfig } from './hooks/useConfig';
import { useI18n } from './hooks/useI18n';
import {
  ISSUE_URL,
  RELEASES_URL,
  TABS,
  canAcceptGlobalDrop,
  formatAppTitle,
  isFileToolbarEnabled,
  normalizeDroppedPaths,
  resolveTabId,
} from './appShell';
import {
  createToastDescriptor,
  shouldShowToast,
  toastIdentity,
} from './toastPolicy';
import { resolveUpdateInfo } from './updatePolicy';
import { classifyDroppedEntries, resolveMetadataDropPaths } from './dropPolicy';
import './styles/App.css';

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
  const [settingsInitialTab, setSettingsInitialTab] = useState('basic');
  const [toast, setToast] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [workingTab, setWorkingTab] = useState(null);
  const [toolbarStates, setToolbarStates] = useState({});
  const [statusStates, setStatusStates] = useState({});
  const [serverStatus, setServerStatus] = useState(null);
  const [updateInfo, setUpdateInfo] = useState({
    available: false,
    latestVersion: '',
    url: '',
  });
  const { config, saveConfig: setConfig } = useConfig();
  const { t, language, changeLanguage } = useI18n();
  const didRestoreTab = useRef(false);
  const lastToast = useRef(null);
  const isWorking = workingTab === activeTab;

  useEffect(() => {
    window.electronAPI?.setRuntimeState?.({
      isWorking: Boolean(workingTab),
      language,
      activeTab,
    });
  }, [activeTab, language, workingTab]);

  useEffect(() => {
    if (!config || didRestoreTab.current) return;
    setActiveTab(resolveTabId(config.last_tab_index));
    didRestoreTab.current = true;
  }, [config]);

  useEffect(() => {
    let isMounted = true;
    window.electronAPI?.getAppVersion?.()
      .then(version => {
        if (isMounted) setAppVersion(String(version || ''));
      })
      .catch(error => {
        console.error('앱 버전 로드 실패:', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleStatusState = (event) => {
      const { tabId, ...state } = event.detail || {};
      if (!tabId) return;
      setStatusStates(current => ({ ...current, [tabId]: state }));
    };
    window.addEventListener('bookmanager:status-state', handleStatusState);
    return () => window.removeEventListener('bookmanager:status-state', handleStatusState);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const applyServerStatus = status => {
      if (isMounted && status) setServerStatus(status);
    };
    window.electronAPI?.getServerStatus?.().then(applyServerStatus).catch(() => {});
    const cleanup = window.electronAPI?.onServerLog?.(data => {
      if (data?.status) applyServerStatus(data.status);
    });
    return () => {
      isMounted = false;
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  useEffect(() => {
    if (!appVersion) return undefined;
    let isMounted = true;
    window.electronAPI?.getReleases?.()
      .then(result => {
        if (isMounted) setUpdateInfo(resolveUpdateInfo(appVersion, result));
      })
      .catch(error => {
        console.error('업데이트 확인 실패:', error);
      });
    return () => {
      isMounted = false;
    };
  }, [appVersion]);

  useEffect(() => {
    const handleToolbarState = (event) => {
      const { tabId, ...state } = event.detail || {};
      if (!tabId) return;
      setToolbarStates(current => ({ ...current, [tabId]: state }));
    };
    window.addEventListener('bookmanager:toolbar-state', handleToolbarState);
    return () => window.removeEventListener('bookmanager:toolbar-state', handleToolbarState);
  }, []);

  const appTitle = formatAppTitle(appVersion);
  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

  const handleTabChange = useCallback((tabId) => {
    const tabIndex = TABS.findIndex(tab => tab.id === tabId);
    if (tabIndex < 0) return;
    setActiveTab(tabId);
    setConfig({ last_tab_index: tabIndex }).catch(error => {
      console.error('마지막 탭 저장 실패:', error);
    });
  }, [setConfig]);

  useEffect(() => {
    const handleNavigate = (event) => {
      const tabId = event.detail?.tabId;
      const paths = normalizeDroppedPaths(event.detail?.paths);
      const tabIndex = TABS.findIndex(tab => tab.id === tabId);
      if (tabIndex < 0 || isWorking) return;
      setActiveTab(tabId);
      setConfig({ last_tab_index: tabIndex }).catch(error => {
        console.error('자동 전달 탭 저장 실패:', error);
      });
      if (paths.length > 0) {
        window.dispatchEvent(new CustomEvent('bookmanager:action', {
          detail: { action: 'load-paths', activeTab: tabId, paths },
        }));
      }
    };
    window.addEventListener('bookmanager:navigate', handleNavigate);
    return () => window.removeEventListener('bookmanager:navigate', handleNavigate);
  }, [isWorking, setConfig]);

  const handleSettings = useCallback(() => {
    setSettingsInitialTab('basic');
    setShowSettings(true);
  }, []);

  useEffect(() => {
    const handleOpenSettings = event => {
      setSettingsInitialTab(event.detail?.tab || 'basic');
      setShowSettings(true);
    };
    window.addEventListener('bookmanager:open-settings', handleOpenSettings);
    return () => window.removeEventListener('bookmanager:open-settings', handleOpenSettings);
  }, []);

  const showToast = useCallback((input, duration = 2500) => {
    if (!input) return;
    const descriptor = createToastDescriptor(input, duration);
    const identity = toastIdentity(descriptor);
    const shownAt = Date.now();
    if (!shouldShowToast(lastToast.current, identity, shownAt)) return;
    lastToast.current = { identity, shownAt };
    setToast({
      ...descriptor,
      id: `${Date.now()}-${Math.random()}`,
    });
  }, []);

  const dispatchAppAction = useCallback((action) => {
    window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { action, activeTab } }));
  }, [activeTab]);

  useEffect(() => {
    const handleWorkingState = (event) => {
      const tabId = event.detail?.tabId;
      const nextWorking = Boolean(event.detail?.isWorking);
      setWorkingTab(current => nextWorking ? tabId : current === tabId ? null : current);
    };
    window.addEventListener('bookmanager:working-state', handleWorkingState);
    return () => window.removeEventListener('bookmanager:working-state', handleWorkingState);
  }, []);

  const handleGlobalDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = canAcceptGlobalDrop(activeTab, isWorking) ? 'copy' : 'none';
  }, [activeTab, isWorking]);

  const handleGlobalDrop = useCallback(async (event) => {
    event.preventDefault();
    if (!canAcceptGlobalDrop(activeTab, isWorking)) return;
    const paths = normalizeDroppedPaths(
      Array.from(event.dataTransfer.files || []).map(file => file.path),
    );
    if (paths.length === 0) return;
    const entries = await Promise.all(paths.map(async droppedPath => ({
      path: droppedPath,
      ...(await window.electronAPI?.stat?.(droppedPath)),
    })));
    const classified = classifyDroppedEntries(entries);
    if (classified.unsupported.length > 0) {
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: `${t('msg_unsupported_format')}${classified.unsupported.join('\n')}`,
        language,
      });
    }
    let acceptedPaths = [...classified.files, ...classified.folders];
    if (activeTab === 'metadata' && classified.files.length > 0) {
      const choice = await window.electronAPI?.chooseMetadataDrop?.({
        title: t('msg_drop_folders_title'),
        message: t('msg_drop_folders_desc'),
        language,
      });
      acceptedPaths = resolveMetadataDropPaths(classified, choice);
    }
    if (acceptedPaths.length === 0) return;
    window.dispatchEvent(new CustomEvent('bookmanager:action', {
      detail: { action: 'drop-paths', activeTab, paths: acceptedPaths },
    }));
  }, [activeTab, isWorking, language, showToast, t]);

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
  const fileToolbarEnabled = isFileToolbarEnabled(activeTab, isWorking);
  const activeToolbarState = toolbarStates[activeTab] || {
    totalCount: 0,
    checkedCount: 0,
    hasItems: false,
    allChecked: true,
  };
  const activeStatus = statusStates[activeTab] || {
    message: t('status_wait'),
    progress: 0,
    phase: 'idle',
    canRun: false,
  };
  const runningServers = ['OPDS', 'WebDAV'].filter(type => serverStatus?.[type]?.running);
  const serverTooltip = runningServers
    .map(type => `${type}: ${serverStatus?.[type]?.url || ''}`)
    .join('\n');
  const showRunButton = activeTab === 'organizer' || activeTab === 'renamer';
  const isExecuting = activeStatus.phase === 'executing';
  const isCancelling = activeStatus.phase === 'cancelling';
  const showProgress = activeStatus.phase !== 'idle';
  const handleVersionClick = useCallback(() => {
    window.electronAPI?.openExternal?.(
      updateInfo.available && updateInfo.url ? updateInfo.url : RELEASES_URL,
    );
  }, [updateInfo]);

  return (
    <div
      className={`app-container ${language}`}
      style={appStyle}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      <div className="app-title-bar">
        {appTitle}
      </div>
      
      <div className="top-menu-bar">
        <div className="top-menu-left">
          <button className="top-btn" disabled={!fileToolbarEnabled} onClick={() => dispatchAppAction('add-folder')}><FaIcon name="folderOpen" />{t('add_folder')}</button>
          <button className="top-btn" disabled={!fileToolbarEnabled} onClick={() => dispatchAppAction('add-file')}><FaIcon name="fileSignature" />{t('add_file')}</button>
          <button className="top-btn top-btn-danger" disabled={!fileToolbarEnabled || activeToolbarState.checkedCount === 0} onClick={() => dispatchAppAction('remove-selected')}><FaIcon name="minusCircle" />{t('remove_sel')}</button>
          <button className="top-btn top-btn-danger" disabled={!fileToolbarEnabled || !activeToolbarState.hasItems} onClick={() => dispatchAppAction('clear-all')}><FaIcon name="folderMinus" />{t('clear_all')}</button>
          <button className="top-btn" disabled={!fileToolbarEnabled || !activeToolbarState.hasItems} onClick={() => dispatchAppAction('toggle-all')}><FaIcon name={activeToolbarState.allChecked ? 'checkSquare' : 'square'} />{t('toggle_all')}</button>
        </div>
        <div className="top-menu-right">
          <button className="top-btn" onClick={() => window.electronAPI?.openExternal?.(ISSUE_URL)}><FaIcon name="bug" />{t('btn_issue')}</button>
          <button
            className={`top-btn top-btn-version ${updateInfo.available ? 'update-available' : ''}`}
            disabled={isWorking}
            onClick={handleVersionClick}
          >
            <FaIcon name={updateInfo.available ? 'gift' : 'circleCheck'} />
            {updateInfo.available
              ? t('msg_update_available', [appVersion || '-', updateInfo.latestVersion])
              : t('msg_latest_version', [appVersion || '-'])}
          </button>
          <button className="top-btn top-btn-settings" disabled={isWorking} onClick={handleSettings}><FaIcon name="gear" />{t('settings_btn')}</button>
        </div>
      </div>
      
      <TabBar 
        tabs={translatedTabs}
        activeTab={activeTab} 
        onTabChange={handleTabChange} 
        disabled={isWorking}
        t={t}
      />
      
      <div className="app-content">
        <div className={`app-tab-panel ${activeTab === 'folder' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'folder'}>
          <FolderTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
        </div>
        <div className={`app-tab-panel ${activeTab === 'organizer' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'organizer'}>
          <OrganizerTab config={config} t={t} showToast={showToast} />
          {activeTab === 'organizer' && isWorking && <div className="app-working-overlay"><span className="app-working-spinner" /><span>{activeStatus.message}</span></div>}
        </div>
        <div className={`app-tab-panel ${activeTab === 'renamer' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'renamer'}>
          <RenamerTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
          {activeTab === 'renamer' && isWorking && <div className="app-working-overlay"><span className="app-working-spinner" /><span>{activeStatus.message}</span></div>}
        </div>
        <div className={`app-tab-panel ${activeTab === 'metadata' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'metadata'}>
          <MetadataTab config={config} t={t} showToast={showToast} />
          {activeTab === 'metadata' && isWorking && <div className="app-working-overlay"><span className="app-working-spinner" /><span>{activeStatus.message}</span></div>}
        </div>
        <div className="app-tab-panel" hidden={activeTab !== 'sharing'}>
          <SharingTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
        </div>
        <div className="app-tab-panel" hidden={activeTab !== 'releases'}>
          <ReleaseTab config={config} t={t} />
        </div>
      </div>

      <div className="app-bottom-bar">
        <div className="app-status-area">
          {runningServers.length > 0 && (
            <span className="app-server-status" title={serverTooltip}>
              <FaIcon name="towerBroadcast" size={14} />
            </span>
          )}
          <span className="app-status-message">{activeStatus.message || t('status_wait')}</span>
          {showProgress && (
            <div className="app-progress">
              <div className="app-progress-fill" style={{ width: `${activeStatus.progress}%` }} />
            </div>
          )}
        </div>
        {showRunButton && (
          <button
            className={`app-run-button ${isExecuting || isCancelling ? 'cancel' : ''}`}
            disabled={isCancelling || (!isExecuting && (isWorking || !activeStatus.canRun))}
            onClick={() => dispatchAppAction(isExecuting ? 'cancel-current' : 'run-current')}
          >
            <FaIcon name={isExecuting || isCancelling ? 'stopCircle' : 'rocket'} size={16} />
            {isCancelling ? t('cancel_wait') : isExecuting ? t('cancel_btn') : t('run_btn')}
          </button>
        )}
      </div>

      {showSettings && (
        <SettingsModal 
          config={config} 
          initialTab={settingsInitialTab}
          onClose={handleSettingsClose}
          t={t}
          showToast={showToast}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} t={t} />
    </div>
  );
}

export default App;
