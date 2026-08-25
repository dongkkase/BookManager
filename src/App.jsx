import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabBar } from './components/TabBar';
import { SettingsModal } from './components/SettingsModal';
import { AppLockOverlay } from './components/AppLockOverlay';
import { AudiobookMiniPlayer } from './components/AudiobookMiniPlayer';
import { FaIcon } from './components/FaIcon';
import { Toast } from './components/Toast';
import { useConfig } from './hooks/useConfig';
import { useI18n } from './hooks/useI18n';
import { useLockScanQueue } from './hooks/useLockScanQueue';
import { translateKnownText } from './utils/i18n';
import {
  DISCORD_URL,
  READIVE_URL,
  ISSUE_URL,
  MANUAL_URL,
  RELEASES_URL,
  TABS,
  canAcceptGlobalDrop,
  formatAppTitle,
  isFileToolbarEnabled,
  normalizeDroppedPaths,
  resolveTabId,
} from './appShell';
import readiveAppleIcon from '../docs/icon_apple.svg';
import readiveGooglePlayIcon from '../docs/icon_googleplay.svg';
import {
  createToastDescriptor,
  shouldShowToast,
  toastIdentity,
} from './toastPolicy';
import {
  isLibraryIndexingPhase,
  resolveEffectiveWorkingTab,
  shouldCollectLibraryScanSlideItem,
  shouldUseLibraryScanSlide,
} from './appLockState';
import { resolveUpdateInfo, shouldOpenUpdatePage } from './updatePolicy';
import { classifyDroppedEntries, resolveMetadataDropPaths } from './dropPolicy';
import { settingsEffects } from './settingsPolicy';
import { fontVarsForConfig } from './fontPolicy';
import { installBundledFontFaces } from './bundledFonts';
import {
  initialAudioMiniPlayerState,
  reduceAudioMiniPlayerState,
} from './audioMiniPlayerState';
import './styles/App.css';

function lazyTab(loader, exportName) {
  return React.memo(React.lazy(() => loader().then(module => ({
    default: exportName ? module[exportName] : module.default,
  }))));
}

const MemoFolderTab = lazyTab(() => import('./tabs/FolderTab'), 'FolderTab');
const MemoOrganizerTab = lazyTab(() => import('./tabs/OrganizerTab'));
const MemoRenamerTab = lazyTab(() => import('./tabs/RenamerTab'));
const MemoMetadataTab = lazyTab(() => import('./tabs/MetadataTab'));
const MemoSharingTab = lazyTab(() => import('./tabs/SharingTab'));
const MemoReleaseTab = lazyTab(() => import('./tabs/ReleaseTab'));

function TabLoading({ t }) {
  return <div className="app-tab-loading">{t('msg_loading_list')}</div>;
}

function isSameStatusState(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of keys) {
    if (left?.[key] !== right?.[key]) return false;
  }
  return true;
}

function App() {
  const [activeTab, setActiveTab] = useState('folder');
  const [loadedTabs, setLoadedTabs] = useState(() => new Set(['folder']));
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('basic');
  const [toast, setToast] = useState(null);
  const [appVersion, setAppVersion] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [workingTab, setWorkingTab] = useState(null);
  const [toolbarStates, setToolbarStates] = useState({});
  const [statusStates, setStatusStates] = useState({});
  const [serverStatus, setServerStatus] = useState(null);
  const [audioMiniPlayerState, setAudioMiniPlayerState] = useState(null);
  const [updateInfo, setUpdateInfo] = useState({
    available: false,
    latestVersion: '',
    url: '',
    assets: [],
  });
  const { config, saveConfig: setConfig } = useConfig();
  const { t, language, changeLanguage } = useI18n(config);

  useEffect(() => {
    const listBundledFonts = window.electronAPI?.listBundledFonts;
    if (!listBundledFonts) return undefined;
    let cancelled = false;
    listBundledFonts()
      .then(fonts => {
        if (!cancelled && Array.isArray(fonts)) installBundledFontFaces(fonts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const didRestoreTab = useRef(false);
  const lastToast = useRef(null);
  const lastTabSaveTimer = useRef(null);
  const readyTabsRef = useRef(new Set());
  const pendingTabActionsRef = useRef(new Map());
  const effectiveWorkingTab = useMemo(
    () => resolveEffectiveWorkingTab(workingTab, statusStates, activeTab),
    [activeTab, statusStates, workingTab],
  );
  const isAppLocked = Boolean(effectiveWorkingTab);
  const isWorking = effectiveWorkingTab === activeTab;
  const effectiveWorkingStatus = effectiveWorkingTab ? statusStates[effectiveWorkingTab] : null;
  const isLibraryScanSlideActive = shouldUseLibraryScanSlide(effectiveWorkingTab, effectiveWorkingStatus || {});
  const {
    activateLockScanQueue,
    lockThumbnailIndex,
    lockThumbnails,
    pushLockScanItem,
  } = useLockScanQueue({
    isAppLocked,
    isLibraryScanSlideActive,
  });

  useEffect(() => {
    window.electronAPI?.setRuntimeState?.({
      isWorking: isAppLocked,
      language,
      activeTab,
    });
  }, [activeTab, isAppLocked, language]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAudioMiniPlayerState && !api?.onAudioMiniPlayerState) return undefined;

    let active = true;
    let initialStateResolved = !api?.getAudioMiniPlayerState;
    let queuedEvents = [];
    const handleMiniPlayerState = event => {
      if (!active) return;
      if (!initialStateResolved) queuedEvents.push(event);
      setAudioMiniPlayerState(current => reduceAudioMiniPlayerState(current, event));
    };
    const removeMiniPlayerListener = api.onAudioMiniPlayerState?.(handleMiniPlayerState);

    if (api.getAudioMiniPlayerState) {
      Promise.resolve()
        .then(() => api.getAudioMiniPlayerState())
        .then(snapshot => {
          if (!active) return;
          const initialState = initialAudioMiniPlayerState(snapshot);
          const pendingEvents = queuedEvents;
          queuedEvents = [];
          initialStateResolved = true;
          setAudioMiniPlayerState(
            pendingEvents.reduce(reduceAudioMiniPlayerState, initialState),
          );
        })
        .catch(() => {
          initialStateResolved = true;
          queuedEvents = [];
        });
    }

    return () => {
      active = false;
      queuedEvents = [];
      if (typeof removeMiniPlayerListener === 'function') removeMiniPlayerListener();
    };
  }, []);

  const handleAudioMiniPlayerControl = useCallback(command => (
    window.electronAPI?.controlAudioMiniPlayer?.(command)
  ), []);

  useEffect(() => {
    if (!config || didRestoreTab.current) return;
    setActiveTab(resolveTabId(config.last_tab_id, config.last_tab_index));
    didRestoreTab.current = true;
  }, [config]);

  useEffect(() => {
    setLoadedTabs(current => {
      if (current.has(activeTab)) return current;
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const dispatchTabAction = useCallback((tabId, detail) => {
    if (!tabId || !detail) return;
    if (readyTabsRef.current.has(tabId)) {
      window.dispatchEvent(new CustomEvent('bookmanager:action', { detail }));
      return;
    }

    const pending = pendingTabActionsRef.current.get(tabId) || [];
    pending.push(detail);
    pendingTabActionsRef.current.set(tabId, pending);
    setLoadedTabs(current => {
      if (current.has(tabId)) return current;
      const next = new Set(current);
      next.add(tabId);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleTabReady = event => {
      const tabId = event.detail?.tabId;
      if (!tabId) return;
      readyTabsRef.current.add(tabId);
      const pending = pendingTabActionsRef.current.get(tabId) || [];
      pendingTabActionsRef.current.delete(tabId);
      for (const detail of pending) {
        window.dispatchEvent(new CustomEvent('bookmanager:action', { detail }));
      }
    };
    window.addEventListener('bookmanager:tab-ready', handleTabReady);
    return () => window.removeEventListener('bookmanager:tab-ready', handleTabReady);
  }, []);

  useEffect(() => () => {
    if (lastTabSaveTimer.current) window.clearTimeout(lastTabSaveTimer.current);
  }, []);

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
      setStatusStates(current => (
        isSameStatusState(current[tabId], state)
          ? current
          : { ...current, [tabId]: state }
      ));
      if (shouldUseLibraryScanSlide(tabId, state)) {
        activateLockScanQueue();
      }
      if (shouldCollectLibraryScanSlideItem(tabId, state)) {
        pushLockScanItem({
          path: state.currentItem || '',
          name: state.currentItemName || state.currentItem || '',
        });
      }
    };
    window.addEventListener('bookmanager:status-state', handleStatusState);
    return () => window.removeEventListener('bookmanager:status-state', handleStatusState);
  }, [activateLockScanQueue, pushLockScanItem]);

  useEffect(() => {
    const handleThumbnailReady = (event) => {
      const thumbnail = event.detail || {};
      pushLockScanItem({
        src: thumbnail.src || '',
        name: thumbnail.name || thumbnail.path || '',
        path: thumbnail.path || '',
      });
    };
    window.addEventListener('bookmanager:folder-thumbnail-ready', handleThumbnailReady);
    const removeFolderFileReady = window.electronAPI?.onFolderFileReady?.(data => {
      const file = data?.file || {};
      pushLockScanItem({
        src: file.cover || '',
        name: file.name || file.filename || file.path || '',
        path: file.path || '',
      });
    });
    return () => {
      window.removeEventListener('bookmanager:folder-thumbnail-ready', handleThumbnailReady);
      if (typeof removeFolderFileReady === 'function') removeFolderFileReady();
    };
  }, [pushLockScanItem]);

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

  const scheduleLastTabSave = useCallback((tabId, tabIndex, errorLabel) => {
    if (lastTabSaveTimer.current) window.clearTimeout(lastTabSaveTimer.current);
    lastTabSaveTimer.current = window.setTimeout(() => {
      lastTabSaveTimer.current = null;
      setConfig({ last_tab_id: tabId, last_tab_index: tabIndex }).catch(error => {
        console.error(`${errorLabel} 실패:`, error);
      });
    }, 250);
  }, [setConfig]);

  const handleTabChange = useCallback((tabId) => {
    const tabIndex = TABS.findIndex(tab => tab.id === tabId);
    if (tabIndex < 0) return;
    setActiveTab(tabId);
    scheduleLastTabSave(tabId, tabIndex, '마지막 탭 저장');
  }, [scheduleLastTabSave]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bookmanager:active-tab-changed', {
      detail: { activeTab },
    }));
  }, [activeTab]);

  useEffect(() => {
    const handleNavigate = (event) => {
      const tabId = event.detail?.tabId;
      const paths = normalizeDroppedPaths(event.detail?.paths);
      const tabIndex = TABS.findIndex(tab => tab.id === tabId);
      if (tabIndex < 0 || isAppLocked) return;
      setActiveTab(tabId);
      scheduleLastTabSave(tabId, tabIndex, '자동 전달 탭 저장');
      if (paths.length > 0) {
        dispatchTabAction(tabId, { action: 'load-paths', activeTab: tabId, paths });
      }
    };
    window.addEventListener('bookmanager:navigate', handleNavigate);
    return () => window.removeEventListener('bookmanager:navigate', handleNavigate);
  }, [dispatchTabAction, isAppLocked, scheduleLastTabSave]);

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
    dispatchTabAction(activeTab, { action, activeTab });
  }, [activeTab, dispatchTabAction]);

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
    event.dataTransfer.dropEffect = canAcceptGlobalDrop(activeTab, isAppLocked) ? 'copy' : 'none';
  }, [activeTab, isAppLocked]);

  const handleGlobalDrop = useCallback(async (event) => {
    event.preventDefault();
    if (!canAcceptGlobalDrop(activeTab, isAppLocked)) return;
    const paths = normalizeDroppedPaths(
      Array.from(event.dataTransfer.files || []).map(file => file.path),
    );
    if (paths.length === 0) return;
    const entries = await Promise.all(paths.map(async droppedPath => ({
      path: droppedPath,
      ...(await window.electronAPI?.stat?.(droppedPath)),
    })));
    const classified = classifyDroppedEntries(entries, {
      includeDocuments: activeTab === 'folder' || activeTab === 'metadata',
    });
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
    dispatchTabAction(activeTab, { action: 'drop-paths', activeTab, paths: acceptedPaths });
  }, [activeTab, dispatchTabAction, isAppLocked, language, showToast, t]);

  const handleSettingsClose = useCallback(async (updatedConfig) => {
    setShowSettings(false);
    if (!updatedConfig) {
      const savedLang = config?.language || config?.lang || 'ko';
      await changeLanguage(savedLang);
      return;
    }
    if (updatedConfig) {
      const requestedLang = updatedConfig.language || updatedConfig.lang;
      if (requestedLang) await changeLanguage(requestedLang);
      const savedConfig = await setConfig(updatedConfig);
      const effects = settingsEffects(config || {}, savedConfig || updatedConfig);
      const nextLang = savedConfig?.language || savedConfig?.lang || requestedLang;
      if (nextLang) await changeLanguage(nextLang);
      if (effects.resetTaskTabs) {
        window.dispatchEvent(new CustomEvent('bookmanager:reset-task-tabs', {
          detail: { tabs: ['organizer', 'renamer', 'metadata'] },
        }));
        showToast({ key: 'msg_settings_changed_clear' });
      }
      if (effects.librariesChanged) {
        setActiveTab('folder');
        await setConfig({ last_tab_id: 'folder', last_tab_index: 0 });
        const folders = savedConfig?.dup_check_folders || updatedConfig.dup_check_folders || [];
        if (folders.length > 0) {
          window.electronAPI?.updateFolderIndex?.(folders, {
            priorityFolder: savedConfig?.last_selected_library || updatedConfig.last_selected_library,
            optimizeMetadata: true,
            forceMetadata: false,
            mode: 'smart',
            language: nextLang,
          }).catch(error => {
            console.error('라이브러리 인덱스 갱신 실패:', error);
          });
        }
      }
      if (effects.restartRecommended) {
        const response = await window.electronAPI?.showMessage?.({
          type: 'question',
          title: t('msg_restart_title'),
          message: t('msg_restart_desc'),
          buttons: 'yes-no',
          defaultChoice: 'no',
          language: nextLang,
        });
        if (response === 'yes') await window.electronAPI?.relaunchApp?.();
      }
    }
  }, [changeLanguage, config, setConfig, showToast, t]);

  const handleSettingsLanguagePreview = useCallback((nextLanguage) => {
    changeLanguage(nextLanguage).catch(error => {
      console.error('언어 미리보기 적용 실패:', error);
    });
  }, [changeLanguage]);

  const translatedTabs = TABS.map(tab => ({
    ...tab,
    label: t(tab.labelKey),
  }));
  const appStyle = useMemo(() => fontVarsForConfig(config || {}), [config?.font_family, config?.font_scale]);
  const fileToolbarEnabled = isFileToolbarEnabled(activeTab, isAppLocked);
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
  const lockStatus = effectiveWorkingTab
    ? statusStates[effectiveWorkingTab] || activeStatus
    : activeStatus;
  const lockStatusMessage = translateKnownText(lockStatus.message, language);
  const lockMessage = lockStatusMessage || t('msg_processing_overlay') || t('status_wait');
  const lockCurrentItem = lockStatus.currentItem || '';
  const lockCurrentItemName = lockStatus.currentItemName || lockCurrentItem;
  const lockAriaLabel = [lockMessage, lockCurrentItem].filter(Boolean).join(' ');
  const useLibraryScanSlide = shouldUseLibraryScanSlide(effectiveWorkingTab, lockStatus);
  const lockIsLibraryIndexing = useLibraryScanSlide && isLibraryIndexingPhase(lockStatus);
  const lockThumbnailItems = lockThumbnails.length > 0 && !lockIsLibraryIndexing
    ? (useLibraryScanSlide
      ? lockThumbnails.slice(-5)
      : [...lockThumbnails.slice(lockThumbnailIndex), ...lockThumbnails.slice(0, lockThumbnailIndex)]
        .slice(0, Math.min(8, lockThumbnails.length)))
    : [];
  const runningServers = ['OPDS', 'Web', 'WebDAV'].filter(type => serverStatus?.[type]?.running);
  const serverTooltip = runningServers
    .map(type => `${type}: ${serverStatus?.[type]?.url || ''}`)
    .join('\n');
  const showRunButton = activeTab === 'organizer'
    || activeTab === 'renamer'
    || (activeTab === 'folder' && ['executing', 'cancelling'].includes(activeStatus.phase));
  const isExecuting = activeStatus.phase === 'executing';
  const isCancelling = activeStatus.phase === 'cancelling';
  const showProgress = lockStatus.phase !== 'idle';
  const handleVersionClick = useCallback(async () => {
    if (updateInfo.available) {
      const response = await window.electronAPI?.showMessage?.({
        type: 'question',
        title: t('msg_update_prompt_title'),
        message: t('msg_update_install_prompt', [updateInfo.latestVersion]),
        buttons: 'yes-no',
        defaultChoice: 'no',
        language,
      });
      if (!shouldOpenUpdatePage(response)) return;

      setIsUpdating(true);
      try {
        const result = await window.electronAPI?.installUpdate?.({
          latestVersion: updateInfo.latestVersion,
          assets: updateInfo.assets || [],
        });
        if (!result?.success) {
          const errorKeyByCode = {
            NOT_PACKAGED: 'msg_update_not_packaged',
            UNSUPPORTED_PLATFORM: 'msg_update_unsupported',
            ASSET_NOT_FOUND: 'msg_update_asset_missing',
            DOWNLOAD_URL_BLOCKED: 'msg_update_asset_missing',
            TARGET_NOT_FOUND: 'msg_update_target_missing',
            TARGET_NOT_WRITABLE: 'msg_update_target_not_writable',
            EXTRACTED_APP_NOT_FOUND: 'msg_update_extract_missing',
          };
          const errorKey = errorKeyByCode[result?.code];
          const message = errorKey
            ? t(errorKey)
            : t('msg_update_failed', [result?.message || result?.code || 'Unknown error']);
          await window.electronAPI?.showMessage?.({
            type: 'error',
            title: t('msg_update_prompt_title'),
            message,
            language,
          });
        }
      } catch (error) {
        await window.electronAPI?.showMessage?.({
          type: 'error',
          title: t('msg_update_prompt_title'),
          message: t('msg_update_failed', [error.message || String(error)]),
          language,
        });
      } finally {
        setIsUpdating(false);
      }
      return;
    }

    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('msg_update_prompt_title'),
      message: t('msg_update_prompt'),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language,
    });
    if (!shouldOpenUpdatePage(response)) return;
    window.electronAPI?.openExternal?.(
      updateInfo.available && updateInfo.url ? updateInfo.url : RELEASES_URL,
    );
  }, [language, t, updateInfo]);

  return (
    <div
      className={`app-container ${language}`}
      style={appStyle}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      <div className="top-menu-bar">
        <div className="top-menu-left">
          <button className="top-btn" disabled={!fileToolbarEnabled} onClick={() => dispatchAppAction('add-folder')}><FaIcon name="folder-plus" />{t('add_folder')}</button>
          <button className="top-btn" disabled={!fileToolbarEnabled} onClick={() => dispatchAppAction('add-file')}><FaIcon name="file-circle-plus" />{t('add_file')}</button>
          <button className="top-btn top-btn-danger" disabled={!fileToolbarEnabled || activeToolbarState.checkedCount === 0} onClick={() => dispatchAppAction('remove-selected')}><FaIcon name="minusCircle" />{t('remove_sel')}</button>
          <button className="top-btn top-btn-danger" disabled={!fileToolbarEnabled || !activeToolbarState.hasItems} onClick={() => dispatchAppAction('clear-all')}><FaIcon name="folderMinus" />{t('clear_all')}</button>
          <button className="top-btn" disabled={!fileToolbarEnabled || !activeToolbarState.hasItems} onClick={() => dispatchAppAction('toggle-all')}><FaIcon name={activeToolbarState.allChecked ? 'checkSquare' : 'square'} />{t('toggle_all')}</button>
        </div>
        <div className="top-menu-right">
          <button
            className={`top-btn top-btn-version ${updateInfo.available ? 'update-available' : ''}`}
            disabled={isAppLocked || isUpdating}
            onClick={handleVersionClick}
          >
            <FaIcon name={updateInfo.available ? 'gift' : 'circleCheck'} />
            {isUpdating
              ? t('msg_update_downloading')
              : updateInfo.available
              ? t('msg_update_available', [appVersion || '-', updateInfo.latestVersion])
              : t('msg_latest_version', [appVersion || '-'])}
          </button>
          <button
            className="top-btn top-btn-icon"
            title="Discord"
            aria-label="Discord"
            onClick={() => window.electronAPI?.openExternal?.(DISCORD_URL)}
          >
            <FaIcon name="discord" />
          </button>
          <button className="top-btn" onClick={() => window.electronAPI?.openExternal?.(ISSUE_URL)}><FaIcon name="bug" />{t('btn_issue')}</button>
          <button className="top-btn" onClick={() => window.electronAPI?.openExternal?.(MANUAL_URL)}><FaIcon name="bookOpen" />{t('btn_manual')}</button>
          <button
            className="top-btn top-btn-icon top-btn-settings"
            title={t('settings_btn')}
            aria-label={t('settings_btn')}
            disabled={isAppLocked}
            onClick={handleSettings}
          >
            <FaIcon name="gear" />
          </button>
        </div>
      </div>
      
      <div className="tab-bar-row">
        <TabBar
          tabs={translatedTabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          disabled={isAppLocked}
          t={t}
        />
        <button
          className="top-btn top-btn-store top-bar-store-action"
          title="Readive"
          aria-label="Readive"
          onClick={() => window.electronAPI?.openExternal?.(READIVE_URL)}
        >
          <span className="top-store-icons" aria-hidden="true">
            <img className="top-store-icon" src={readiveAppleIcon} alt="" />
            <img className="top-store-icon" src={readiveGooglePlayIcon} alt="" />
          </span>
          Readive
        </button>
      </div>
      
      <div className="app-content">
        <div className={`app-tab-panel ${activeTab === 'folder' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'folder'}>
          {loadedTabs.has('folder') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoFolderTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
            </React.Suspense>
          )}
        </div>
        <div className={`app-tab-panel ${activeTab === 'organizer' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'organizer'}>
          {loadedTabs.has('organizer') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoOrganizerTab config={config} t={t} showToast={showToast} />
            </React.Suspense>
          )}
        </div>
        <div className={`app-tab-panel ${activeTab === 'renamer' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'renamer'}>
          {loadedTabs.has('renamer') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoRenamerTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
            </React.Suspense>
          )}
        </div>
        <div className={`app-tab-panel ${activeTab === 'metadata' && isWorking ? 'is-working' : ''}`} hidden={activeTab !== 'metadata'}>
          {loadedTabs.has('metadata') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoMetadataTab config={config} t={t} showToast={showToast} />
            </React.Suspense>
          )}
        </div>
        <div className="app-tab-panel" hidden={activeTab !== 'sharing'}>
          {loadedTabs.has('sharing') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoSharingTab config={config} saveConfig={setConfig} t={t} showToast={showToast} />
            </React.Suspense>
          )}
        </div>
        <div className="app-tab-panel" hidden={activeTab !== 'releases'}>
          {loadedTabs.has('releases') && (
            <React.Suspense fallback={<TabLoading t={t} />}>
              <MemoReleaseTab config={config} t={t} />
            </React.Suspense>
          )}
        </div>
        <AppLockOverlay
          isAppLocked={isAppLocked}
          useLibraryScanSlide={useLibraryScanSlide}
          lockIsLibraryIndexing={lockIsLibraryIndexing}
          lockThumbnailItems={lockThumbnailItems}
          lockAriaLabel={lockAriaLabel}
          lockCurrentItem={lockCurrentItem}
          lockCurrentItemName={lockCurrentItemName}
          lockMessage={lockMessage}
        />
      </div>

      <div className="app-bottom-bar">
        <div className="app-status-area">
          {runningServers.length > 0 && (
            <span className="app-server-status" title={serverTooltip}>
              <FaIcon name="towerBroadcast" size={14} />
            </span>
          )}
          <span className="app-status-message">{lockStatusMessage || t('status_wait')}</span>
          {showProgress && (
            <div className="app-progress">
              <div className="app-progress-fill" style={{ width: `${lockStatus.progress}%` }} />
            </div>
          )}
        </div>
        {showRunButton && (
          <button
            className={`app-run-button ${isExecuting || isCancelling ? 'cancel' : ''}`}
            disabled={isCancelling || (!isExecuting && (isAppLocked || !activeStatus.canRun))}
            onClick={() => dispatchAppAction(isExecuting ? 'cancel-current' : 'run-current')}
          >
            <FaIcon name={isExecuting || isCancelling ? 'stopCircle' : 'rocket'} size={16} />
            {isCancelling ? t('cancel_wait') : isExecuting ? t('cancel_btn') : t('run_btn')}
          </button>
        )}
        {audioMiniPlayerState && (
          <AudiobookMiniPlayer
            state={audioMiniPlayerState}
            language={language}
            onControl={handleAudioMiniPlayerControl}
          />
        )}
      </div>

      {showSettings && (
        <SettingsModal 
          config={config} 
          initialTab={settingsInitialTab}
          onClose={handleSettingsClose}
          onPersistViewerPaths={setConfig}
          onLanguagePreviewChange={handleSettingsLanguagePreview}
          t={t}
          showToast={showToast}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} t={t} />
    </div>
  );
}

export default App;
