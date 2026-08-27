import React from 'react';
import { FaIcon } from './FaIcon';
import {
  libraryPathKey,
  normalizeLibraryEntries,
  normalizeSettingsConfig,
  safeThreadLimit,
  syncLibraryConfig,
} from '../settingsPolicy';
import {
  BOOK_METADATA_API_SOURCES,
  COMIC_METADATA_API_SOURCES,
  PDF_METADATA_API_SOURCES,
  normalizeMetadataApiSourceForBookType,
} from '../metadataApiPolicy';
import {
  bundledFontOptionsFromFaces,
  installBundledFontFaces,
} from '../bundledFonts';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

const LANGUAGE_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

const FORMAT_KEYS = ['none', 'zip', 'cbz', 'cbr', '7z'];
const RENAMER_ARCHIVE_COMPRESSION_OPTIONS = [
  { value: 'auto', labelKey: 'renamer_archive_compression_auto', fallback: '자동 (추천)' },
  { value: 'fast', labelKey: 'renamer_archive_compression_fast', fallback: '빠름' },
  { value: 'maximum', labelKey: 'renamer_archive_compression_maximum', fallback: '최대 압축' },
];
const VIEWER_PROGRAM_TYPES = [
  { key: 'comic', labelKey: 'viewer_type_comic', fallback: '코믹:', descriptionKey: 'viewer_type_comic_extensions', descriptionFallback: '연결 파일: ZIP, CBZ, CBR, RAR, 7Z, CB7' },
  { key: 'epub', labelKey: 'viewer_type_epub', fallback: 'EPUB:' },
  { key: 'pdf', labelKey: 'viewer_type_pdf', fallback: 'PDF:' },
  { key: 'text', labelKey: 'viewer_type_text', fallback: 'TXT:' },
];
const FILE_ASSOCIATION_GROUPS = [
    { key: 'comic', labelKey: 'file_association_group_comic', fallback: '코믹' },
    { key: 'document', labelKey: 'file_association_group_document', fallback: '문서' },
    { key: 'text', labelKey: 'file_association_group_text', fallback: '텍스트' },
    { key: 'audio', labelKey: 'file_association_group_audio', fallback: '오디오' },
];

function selectedFileAssociationExtensions(status = {}) {
    const associations = Array.isArray(status?.associations) ? status.associations : [];
    const useRegisteredCandidate = status?.platform === 'win32';
    return associations
        .filter(association => (
            useRegisteredCandidate ? association.isRegistered : association.isDefault
        ))
        .map(association => association.extension);
}
const FONT_SCALES = Array.from({ length: 16 }, (_, index) => 80 + index * 5);
const FALLBACK_SYSTEM_FONT_OPTIONS = [
  'Malgun Gothic',
  'Segoe UI',
  'Yu Gothic UI',
  'Arial',
  'Calibri',
  'Tahoma',
  'Verdana',
  'Consolas',
];
const DEFAULT_API_KEYS = {
  aladin: '',
  vine: '',
  google: '',
  ai_provider: 'Gemini',
  ai_key: '',
  tts_openai_key: '',
  tts_google_key: '',
  tag_rules: '',
};

function safeThreadMax() {
  return safeThreadLimit(navigator.hardwareConcurrency || 4);
}

function uniqueSystemFonts(fonts = [], currentFont = '', bundledOptions = []) {
  const bundled = new Set(bundledOptions.map(option => String(option.value || '').toLocaleLowerCase()));
  const seen = new Set();
  const result = [];
  for (const font of [...fonts, currentFont]) {
    const value = String(font || '').trim();
    if (!value || bundled.has(value.toLocaleLowerCase())) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function libraryFallbackName(folderPath = '') {
  const parts = String(folderPath || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || folderPath;
}

function supertonicInstallPercent(progress = {}) {
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  if (progress.phase === 'complete') return 100;
  if (progress.phase === 'verify-files') return Math.min(99, 80 + Math.round(percent * 0.19));
  if (progress.phase === 'extract') return 80;
  if (progress.phase === 'verify-archive') return 76;
  return Math.round(percent * 0.75);
}

function normalizeConfig(config) {
  return normalizeSettingsConfig({
    target_format: 'none',
    backup_on: false,
    flatten_folders: false,
    webp_conversion: false,
    img_quality: 100,
    jpg_quality: 85,
    renamer_archive_compression: 'auto',
    max_threads: Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) * 0.5)),
    play_sound: true,
    viewer_path: '',
    viewer_paths: {
      comic: '',
      epub: '',
      pdf: '',
      text: '',
    },
    favorites: [],
    folder_favorites: [],
    pass_skip_meta: false,
    completion_sound: 'Default.wav',
    font_family: 'Noto Sans KR',
    font_scale: 100,
    last_meta_api: '리디북스',
    preferred_meta_api_comic: '리디북스',
    preferred_meta_api_book: '리디북스',
    preferred_meta_api_pdf: '리디북스',
    metadata_search_min_width: 1050,
    metadata_search_min_height: 780,
    ...(config || {}),
    api_keys: {
      ...DEFAULT_API_KEYS,
      ...(config?.api_keys || {}),
    },
  }, navigator.hardwareConcurrency || 4);
}

function SettingsModal({ isOpen = true, onClose, config, onSave, onPersistViewerPaths, t, showToast, initialTab = 'basic', navigationRequest = 0, onLanguagePreviewChange }) {
  const [localConfig, setLocalConfig] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState('basic');
  const [showSecrets, setShowSecrets] = React.useState({});
  const [maintenanceMessage, setMaintenanceMessage] = React.useState('');
  const [maintenanceBusy, setMaintenanceBusy] = React.useState('');
  const [supertonicStatus, setSupertonicStatus] = React.useState({ installed: false, modelDir: '', archiveSize: 0 });
  const [supertonicProgress, setSupertonicProgress] = React.useState(null);
  const [selectedDupFolder, setSelectedDupFolder] = React.useState('');
  const [soundOptions, setSoundOptions] = React.useState(['Default.wav']);
  const [bundledFontFaces, setBundledFontFaces] = React.useState([]);
  const [systemFontOptions, setSystemFontOptions] = React.useState(FALLBACK_SYSTEM_FONT_OPTIONS);
  const [showApiManual, setShowApiManual] = React.useState(false);
  const [fileAssociationStatus, setFileAssociationStatus] = React.useState(null);
  const [selectedFileAssociations, setSelectedFileAssociations] = React.useState([]);
  const [fileAssociationLoading, setFileAssociationLoading] = React.useState(false);
  const [fileAssociationBusy, setFileAssociationBusy] = React.useState('');
  const [fileAssociationFeedback, setFileAssociationFeedback] = React.useState(null);
  const settingsOpenInitializedRef = React.useRef(false);
  const threadMax = React.useMemo(() => safeThreadMax(), []);
  const handleCancel = React.useCallback(() => {
    setLocalConfig(normalizeConfig(config));
    onClose?.();
  }, [config, onClose]);
  const dialogRef = useModalAccessibility(isOpen, () => {
    if (showApiManual) setShowApiManual(false);
    else handleCancel();
  });

  React.useEffect(() => {
    if (!isOpen) {
      settingsOpenInitializedRef.current = false;
      return;
    }
    if (settingsOpenInitializedRef.current) return;
    settingsOpenInitializedRef.current = true;
    setLocalConfig(normalizeConfig(config));
  }, [config, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
  }, [initialTab, isOpen, navigationRequest]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    window.electronAPI?.listSounds?.()
      .then(files => {
        if (!cancelled && Array.isArray(files) && files.length > 0) setSoundOptions(files);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setSupertonicProgress(null);
    window.electronAPI?.getSupertonicModelStatus?.()
      .then(status => {
        if (!cancelled && status) setSupertonicStatus(status);
      })
      .catch(() => {});
    const removeProgressListener = window.electronAPI?.onSupertonicModelProgress?.(progress => {
      if (!cancelled) setSupertonicProgress(progress);
    });
    const removeStatusListener = window.electronAPI?.onSupertonicModelStatus?.(status => {
      if (!cancelled && status) setSupertonicStatus(status);
    });
    return () => {
      cancelled = true;
      removeProgressListener?.();
      removeStatusListener?.();
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const listBundledFonts = window.electronAPI?.listBundledFonts;
    if (!listBundledFonts) return undefined;
    let cancelled = false;
    listBundledFonts()
      .then(fonts => {
        if (cancelled || !Array.isArray(fonts)) return;
        setBundledFontFaces(fonts);
        installBundledFontFaces(fonts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const listSystemFonts = window.electronAPI?.listSystemFonts;
    if (!listSystemFonts) return undefined;
    let cancelled = false;
    listSystemFonts()
      .then(fonts => {
        if (!cancelled && Array.isArray(fonts) && fonts.length > 0) {
          setSystemFontOptions(uniqueSystemFonts(fonts));
        }
      })
      .catch(() => {
        if (!cancelled) setSystemFontOptions(uniqueSystemFonts(FALLBACK_SYSTEM_FONT_OPTIONS));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

    React.useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;
        const getFileAssociationStatus = window.electronAPI?.getFileAssociationStatus;
        setFileAssociationLoading(true);
        setFileAssociationBusy('');
        setFileAssociationFeedback(null);

        if (!getFileAssociationStatus) {
            setFileAssociationStatus({
                platform: 'unknown',
                supported: false,
                directApply: false,
                associations: [],
            });
            setSelectedFileAssociations([]);
            setFileAssociationLoading(false);
            return undefined;
        }

        Promise.resolve(getFileAssociationStatus())
            .then(status => {
                if (cancelled) return;
                const associations = Array.isArray(status?.associations)
                    ? status.associations.filter(association => association?.extension)
                    : [];
                const normalizedStatus = {
                    platform: status?.platform || 'unknown',
                    supported: Boolean(status?.supported),
                    directApply: Boolean(status?.directApply),
                    reason: status?.reason || '',
                    associations,
                };
                setFileAssociationStatus(normalizedStatus);
                setSelectedFileAssociations(selectedFileAssociationExtensions(normalizedStatus));
            })
            .catch(error => {
                if (cancelled) return;
                setFileAssociationStatus({
                    platform: 'unknown',
                    supported: false,
                    directApply: false,
                    associations: [],
                });
                setSelectedFileAssociations([]);
                setFileAssociationFeedback({
                    type: 'error',
                    key: 'file_association_status_failed',
                    fallback: '파일 연결 상태를 확인하지 못했습니다: {msg}',
                    detail: error?.message || String(error),
                });
            })
            .finally(() => {
                if (!cancelled) setFileAssociationLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

  if (!isOpen || !localConfig) return null;

  const label = (key, fallback) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  };

  const apiSourceLabel = (source) => label(source.labelKey, source.value);
  const formatLabels = Array.isArray(t('format_opts')) ? t('format_opts') : ['변경 안 함', 'ZIP', 'CBZ', 'CBR', '7z'];
  const preferredComicApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_comic || localConfig.last_meta_api,
    'comic',
    localConfig.api_keys || {},
  );
  const preferredBookApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_book || localConfig.last_meta_api,
    'book',
    localConfig.api_keys || {},
  );
  const preferredPdfApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_pdf || localConfig.last_meta_api,
    'pdf',
    localConfig.api_keys || {},
  );
  const bundledFontOptions = bundledFontOptionsFromFaces(bundledFontFaces);
  const systemFontsForSelect = uniqueSystemFonts(systemFontOptions, localConfig.font_family, bundledFontOptions);
  const aiProvider = localConfig.api_keys?.ai_provider === 'OpenAI' ? 'OpenAI' : 'Gemini';
  const aiKeyField = aiProvider === 'OpenAI' ? 'ai_openai_key' : 'ai_gemini_key';
    const availableFileAssociations = fileAssociationStatus?.associations || [];
    const fileAssociationControlsDisabled = Boolean(
        fileAssociationLoading
        || fileAssociationBusy
        || !fileAssociationStatus?.supported,
    );
    const fileAssociationFeedbackText = fileAssociationFeedback
        ? label(fileAssociationFeedback.key, fileAssociationFeedback.fallback)
            .replace('{msg}', fileAssociationFeedback.detail || '')
        : '';

  const handleChange = (key, value) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleApiChange = (key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      api_keys: {
        ...(prev.api_keys || {}),
        [key]: value,
      },
    }));
  };

  const handleLanguageChange = (value) => {
    setLocalConfig(prev => ({ ...prev, lang: value, language: value }));
    onLanguagePreviewChange?.(value);
  };

  const handleSave = () => {
    const nextConfig = normalizeSettingsConfig(localConfig, navigator.hardwareConcurrency || 4);
    onSave?.(nextConfig);
    onClose?.(nextConfig);
  };

  const updateViewerPath = (viewerType, filePath) => {
    if (!viewerType) return;
    setLocalConfig(prev => ({
      ...prev,
      viewer_paths: {
        ...(prev.viewer_paths || {}),
        [viewerType]: filePath || '',
      },
    }));
  };

  const handleSelectViewer = async (viewerType) => {
    const option = VIEWER_PROGRAM_TYPES.find(item => item.key === viewerType);
    if (!option) return;
    const title = option
      ? `${label('viewer_lbl', '뷰어 프로그램')} ${label(option.labelKey, option.fallback)}`
      : label('viewer_lbl', '뷰어 프로그램');
    const filePath = await window.electronAPI?.selectFile?.(title, []);
    if (filePath) updateViewerPath(viewerType, filePath);
  };

  const handleClearViewer = (viewerType) => {
    updateViewerPath(viewerType, '');
  };

    const toggleFileAssociation = (extension, checked) => {
        setSelectedFileAssociations(current => {
            if (checked) return current.includes(extension) ? current : [...current, extension];
            return current.filter(value => value !== extension);
        });
        setFileAssociationFeedback(null);
    };

    const handleSelectAllFileAssociations = () => {
        const associations = fileAssociationStatus?.associations || [];
        setSelectedFileAssociations(associations.map(association => association.extension));
        setFileAssociationFeedback(null);
    };

    const handleClearFileAssociationSelection = () => {
        setSelectedFileAssociations([]);
        setFileAssociationFeedback(null);
    };

    const handleApplyFileAssociations = async () => {
        if (selectedFileAssociations.length === 0) {
            setFileAssociationFeedback({
                type: 'error',
                key: 'file_association_select_required',
                fallback: '연결할 확장자를 하나 이상 선택하세요.',
            });
            return;
        }

        const applyFileAssociations = window.electronAPI?.applyFileAssociations;
        if (!applyFileAssociations || !fileAssociationStatus?.supported) {
            setFileAssociationFeedback({
                type: 'error',
                key: 'file_association_unsupported',
                fallback: '이 운영체제 또는 현재 실행 환경에서는 파일 연결을 지원하지 않습니다.',
            });
            return;
        }

        setFileAssociationBusy('apply');
        setFileAssociationFeedback(null);
        try {
            const viewerPaths = Object.fromEntries(
                VIEWER_PROGRAM_TYPES.map(({ key }) => [
                    key,
                    String(localConfig?.viewer_paths?.[key] || '').trim(),
                ]),
            );
            if (typeof onPersistViewerPaths === 'function') {
                await onPersistViewerPaths({ viewer_paths: viewerPaths });
            } else if (window.electronAPI?.saveConfig) {
                await window.electronAPI.saveConfig({ viewer_paths: viewerPaths });
            }

            const result = await applyFileAssociations(selectedFileAssociations);
            if (result?.success === false) {
                throw new Error(result.error || result.message || result.reason || 'Unknown error');
            }

            let nextStatus = fileAssociationStatus;
            if (window.electronAPI?.getFileAssociationStatus) {
                try {
                    const refreshedStatus = await window.electronAPI.getFileAssociationStatus();
                    nextStatus = {
                        platform: refreshedStatus?.platform || fileAssociationStatus.platform,
                        supported: Boolean(refreshedStatus?.supported),
                        directApply: Boolean(refreshedStatus?.directApply),
                        reason: refreshedStatus?.reason || '',
                        associations: Array.isArray(refreshedStatus?.associations)
                            ? refreshedStatus.associations.filter(association => association?.extension)
                            : fileAssociationStatus.associations,
                    };
                    setFileAssociationStatus(nextStatus);
                    setSelectedFileAssociations(selectedFileAssociationExtensions(nextStatus));
                } catch {
                    // 적용 성공 여부와 상태 새로고침 실패를 분리합니다.
                }
            }

            const requiresSystemConfirmation = Boolean(
                result?.requiresSystemConfirmation
                || result?.requiresUserConfirmation
                || (nextStatus.platform === 'win32' && !nextStatus.directApply),
            );
            if (requiresSystemConfirmation && window.electronAPI?.openFileAssociationSettings) {
                setFileAssociationBusy('settings');
                try {
                    const settingsResult = await window.electronAPI.openFileAssociationSettings();
                    if (settingsResult?.success === false) {
                        throw new Error(
                            settingsResult.error
                            || settingsResult.message
                            || settingsResult.reason
                            || 'Unknown error',
                        );
                    }
                } catch (error) {
                    setFileAssociationFeedback({
                        type: 'error',
                        key: 'file_association_settings_failed',
                        fallback: '운영체제 설정을 열지 못했습니다: {msg}',
                        detail: error?.message || String(error),
                    });
                    return;
                }
            }
            setFileAssociationFeedback({
                type: requiresSystemConfirmation ? 'notice' : 'success',
                key: requiresSystemConfirmation
                    ? 'file_association_windows_confirmation'
                    : 'file_association_apply_success',
                fallback: requiresSystemConfirmation
                    ? 'Windows 시스템 설정에서 BookManager를 기본 앱으로 한 번 더 선택해야 합니다.'
                    : '선택한 확장자의 파일 연결을 적용했습니다.',
            });
        } catch (error) {
            setFileAssociationFeedback({
                type: 'error',
                key: 'file_association_apply_failed',
                fallback: '파일 연결을 적용하지 못했습니다: {msg}',
                detail: error?.message || String(error),
            });
        } finally {
            setFileAssociationBusy('');
        }
    };

    const handleRefreshFileAssociationStatus = async () => {
        const getFileAssociationStatus = window.electronAPI?.getFileAssociationStatus;
        if (!getFileAssociationStatus || !fileAssociationStatus?.supported) return;
        setFileAssociationBusy('refresh');
        setFileAssociationFeedback(null);
        try {
            const status = await getFileAssociationStatus();
            const associations = Array.isArray(status?.associations)
                ? status.associations.filter(association => association?.extension)
                : [];
            const normalizedStatus = {
                platform: status?.platform || fileAssociationStatus.platform,
                supported: Boolean(status?.supported),
                directApply: Boolean(status?.directApply),
                reason: status?.reason || '',
                associations,
            };
            setFileAssociationStatus(normalizedStatus);
            setSelectedFileAssociations(selectedFileAssociationExtensions(normalizedStatus));
            setFileAssociationFeedback({
                type: 'success',
                key: 'file_association_refresh_success',
                fallback: '현재 파일 연결 상태를 새로고침했습니다.',
            });
        } catch (error) {
            setFileAssociationFeedback({
                type: 'error',
                key: 'file_association_status_failed',
                fallback: '파일 연결 상태를 확인하지 못했습니다: {msg}',
                detail: error?.message || String(error),
            });
        } finally {
            setFileAssociationBusy('');
        }
    };

    const handleOpenFileAssociationSettings = async () => {
        const openFileAssociationSettings = window.electronAPI?.openFileAssociationSettings;
        if (!openFileAssociationSettings) return;
        setFileAssociationBusy('settings');
        setFileAssociationFeedback(null);
        try {
            const result = await openFileAssociationSettings();
            if (result?.success === false) {
                throw new Error(result.error || result.message || result.reason || 'Unknown error');
            }
            setFileAssociationFeedback({
                type: 'notice',
                key: 'file_association_settings_opened',
                fallback: '운영체제의 기본 앱 설정 화면을 열었습니다.',
            });
        } catch (error) {
            setFileAssociationFeedback({
                type: 'error',
                key: 'file_association_settings_failed',
                fallback: '운영체제 설정을 열지 못했습니다: {msg}',
                detail: error?.message || String(error),
            });
        } finally {
            setFileAssociationBusy('');
        }
    };

  const libraryEntries = normalizeLibraryEntries(localConfig);
  const selectedLibraryEntry = libraryEntries.find(entry => entry.path === selectedDupFolder) || null;

  const updateLibraryEntries = (updater) => {
    setLocalConfig(prev => {
      const entries = normalizeLibraryEntries(prev);
      const nextEntries = typeof updater === 'function' ? updater(entries) : updater;
      return syncLibraryConfig(prev, nextEntries);
    });
  };

  const handleAddDupFolder = async () => {
    const folderPath = await window.electronAPI?.selectFolder?.(label('dlg_sel_dup_folder', '라이브러리 폴더 선택'));
    if (!folderPath) return;
    updateLibraryEntries(entries => {
      if (entries.some(entry => libraryPathKey(entry.path) === libraryPathKey(folderPath))) return entries;
      return [...entries, { path: folderPath, alias: '', group: '' }];
    });
    setSelectedDupFolder(folderPath);
  };

  const handleRemoveDupFolder = (folderPath) => {
    if (!folderPath) return;
    updateLibraryEntries(entries => entries.filter(entry => entry.path !== folderPath));
    setSelectedDupFolder(current => current === folderPath ? '' : current);
  };

  const handleMoveLibrary = (folderPath, direction) => {
    updateLibraryEntries(entries => {
      const index = entries.findIndex(entry => entry.path === folderPath);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= entries.length) return entries;
      const nextEntries = [...entries];
      [nextEntries[index], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[index]];
      return nextEntries;
    });
  };

  const handleLibraryEntryChange = (folderPath, key, value) => {
    updateLibraryEntries(entries => entries.map(entry => (
      entry.path === folderPath
        ? { ...entry, [key]: value }
        : entry
    )));
  };

  const handleClearDupCache = async () => {
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: label('dlg_warn', '경고'),
      message: label('folder_clear_cache_confirm', '저장된 모든 중복 매칭 결과 캐시를 삭제하시겠습니까?'),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: localConfig.language || localConfig.lang || 'ko',
    });
    if (response !== 'yes') return;
    setMaintenanceBusy('dup-cache');
    setMaintenanceMessage('');
    try {
      const result = await window.electronAPI?.clearDupCache?.();
      const message = `${label('folder_clear_cache_done', '중복 매칭 캐시가 초기화되었습니다.')} (${result?.changes || 0})`;
      setMaintenanceMessage(message);
      showToast?.({
        key: 'folder_clear_cache_done',
        suffix: ` (${result?.changes || 0})`,
      });
    } catch (error) {
      setMaintenanceMessage(label('folder_clear_cache_failed', '중복 캐시 초기화 실패: {msg}').replace('{msg}', error.message));
    } finally {
      setMaintenanceBusy('');
    }
  };

  const handleUpdateIndex = async () => {
    setMaintenanceBusy('index');
    setMaintenanceMessage('');
    try {
      const result = await window.electronAPI?.updateFolderIndex?.(localConfig.dup_check_folders || [], {
        priorityFolder: localConfig.last_selected_library,
        language: localConfig.language || localConfig.lang || 'ko',
      });
      const message = `${label('setting_update_index_msg', '대상 폴더의 변경사항을 확인하고 인덱스를 최신 상태로 갱신했습니다.')} (${result?.total || 0})`;
      setMaintenanceMessage(message);
      showToast?.({
        key: 'setting_update_index_msg',
        suffix: ` (${result?.total || 0})`,
      });
    } catch (error) {
      setMaintenanceMessage(label('setting_update_index_failed', '인덱스 갱신 실패: {msg}').replace('{msg}', error.message));
    } finally {
      setMaintenanceBusy('');
    }
  };

  const handleClearApiCache = async () => {
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: label('btn_clear_cache', '검색 캐시 비우기'),
      message: label('meta_cache_clear_confirm', '검색 결과와 표지 이미지 캐시를 모두 삭제하시겠습니까?'),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: localConfig.language || localConfig.lang || 'ko',
    });
    if (response !== 'yes') return;
    setMaintenanceBusy('api-cache');
    setMaintenanceMessage('');
    try {
      await window.electronAPI?.clearApiCache?.();
      const message = label('msg_cache_cleared', '검색 캐시 및 표지 이미지가 모두 초기화되었습니다.');
      setMaintenanceMessage(message);
      showToast?.({ key: 'msg_cache_cleared' });
    } catch (error) {
      setMaintenanceMessage(label('meta_cache_clear_failed_detail', 'API 캐시 초기화 실패: {msg}').replace('{msg}', error.message));
    } finally {
      setMaintenanceBusy('');
    }
  };

  const handleInstallSupertonic = async () => {
    const archiveSizeMb = Math.round((supertonicStatus.archiveSize || 371138757) / (1024 * 1024));
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: label('tts_supertonic_group', 'Supertonic 3 (로컬)'),
      message: label(
        'tts_supertonic_confirm',
        'Supertonic 3 모델 약 {size}MB를 다운로드할까요? 모델은 Supertonic OpenRAIL-M 라이선스로 제공됩니다.',
      ).replace('{size}', archiveSizeMb),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language: localConfig.language || localConfig.lang || 'ko',
    });
    if (response !== 'yes') return;

    setMaintenanceBusy('supertonic-model');
    setMaintenanceMessage('');
    setSupertonicProgress({ phase: 'download', percent: 0 });
    try {
      const result = await window.electronAPI?.installSupertonicModel?.();
      if (!result?.success) throw new Error(result?.error || 'Supertonic model installation failed.');
      setSupertonicStatus(result);
      setSupertonicProgress({ phase: 'complete', percent: 100 });
      const message = label('tts_supertonic_complete', 'Supertonic 3 모델 설치가 완료되었습니다.');
      setMaintenanceMessage(message);
      showToast?.({ key: 'tts_supertonic_complete' });
    } catch (error) {
      setMaintenanceMessage(
        label('tts_supertonic_failed', 'Supertonic 3 모델 설치 실패: {msg}').replace('{msg}', error.message),
      );
    } finally {
      setMaintenanceBusy('');
    }
  };

  const renderSecretInput = (key, placeholder, disabled = false) => (
    <div className="settings-secret-row">
      <input
        className="settings-input"
        type={showSecrets[key] ? 'text' : 'password'}
        placeholder={placeholder}
        value={localConfig.api_keys?.[key] || ''}
        onChange={event => handleApiChange(key, event.target.value)}
        disabled={disabled}
      />
      <button
        className={`settings-icon-btn ${showSecrets[key] ? 'active' : ''}`}
        type="button"
        onClick={() => setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))}
        disabled={disabled}
        aria-label={showSecrets[key] ? label('secret_hide', '비밀번호 숨기기') : label('secret_show', '비밀번호 보기')}
      >
        <FaIcon name={showSecrets[key] ? 'eyeSlash' : 'eye'} />
      </button>
    </div>
  );

  const renderCheck = (key, text, help) => (
    <label className="settings-check-row">
      <input type="checkbox" checked={Boolean(localConfig[key])} onChange={event => handleChange(key, event.target.checked)} />
      <span>
        <strong>{text}</strong>
        {help && <small>{help}</small>}
      </span>
    </label>
  );

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div
        ref={dialogRef}
        className="modal-content settings-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <span id="settings-modal-title" className="modal-title">{t('settings_title')}</span>
          <button className="modal-close" aria-label={t('btn_close')} onClick={handleCancel}>×</button>
        </div>

        <div className="settings-tabs">
          <button className={activeTab === 'basic' ? 'active' : ''} onClick={() => setActiveTab('basic')}>{label('tab_basic', '기본 설정')}</button>
          <button className={activeTab === 'folder' ? 'active' : ''} onClick={() => setActiveTab('folder')}>{label('tab_folder_settings', '폴더 탭 설정')}</button>
          <button className={activeTab === 'api' ? 'active' : ''} onClick={() => setActiveTab('api')}>{label('tab_api', 'API 검색 설정')}</button>
          <button className={activeTab === 'ttsApi' ? 'active' : ''} onClick={() => setActiveTab('ttsApi')}>{label('tab_tts_api_key', 'TTS 설정')}</button>
        </div>

        <div className="modal-body settings-modal-body">
          {activeTab === 'basic' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset settings-basic-fieldset">
              <div className="settings-row">
                <span className="settings-label">{t('lang_lbl')}</span>
                <select className="settings-select" value={localConfig.language || localConfig.lang || 'ko'} onChange={event => handleLanguageChange(event.target.value)}>
                  {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>

              <div className="settings-row">
                <span className="settings-label">{t('sound_lbl')}</span>
                <div className="settings-inline-control">
                  <select
                    className="settings-select"
                    value={localConfig.completion_sound || 'Default.wav'}
                    onChange={event => {
                      handleChange('completion_sound', event.target.value);
                      window.electronAPI?.playSound?.(event.target.value);
                    }}
                  >
                    {soundOptions.map(file => <option key={file} value={file}>{file.replace(/\.(mp3|wav)$/i, '')}</option>)}
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <span className="settings-label">{t('font_family_lbl')}</span>
                <select className="settings-select" value={localConfig.font_family || 'Noto Sans KR'} onChange={event => handleChange('font_family', event.target.value)}>
                  <optgroup label={label('font_group_bundled', '프로그램 포함 폰트')}>
                    {bundledFontOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label={label('font_group_system', '시스템 폰트')}>
                    {systemFontsForSelect.map(font => <option key={font} value={font}>{font}</option>)}
                  </optgroup>
                </select>
              </div>

              <div className="settings-row">
                <span className="settings-label">{t('font_size_lbl')}</span>
                <select className="settings-select" value={localConfig.font_scale || 100} onChange={event => handleChange('font_scale', Number(event.target.value))}>
                  {FONT_SCALES.map(value => <option key={value} value={value}>{value}%</option>)}
                </select>
              </div>

              <div className="settings-row">
                <span className="settings-label">{t('format_lbl')}</span>
                <select className="settings-select" value={localConfig.target_format || 'none'} onChange={event => handleChange('target_format', event.target.value)}>
                  {FORMAT_KEYS.map((key, index) => <option key={key} value={key}>{formatLabels[index] || key.toUpperCase()}</option>)}
                </select>
              </div>

              <div className="settings-row">
                <span className="settings-label">{t('max_threads')}</span>
                <div className="settings-slider-control">
                  <input
                    type="range"
                    min="1"
                    max={threadMax}
                    value={Math.min(threadMax, Number(localConfig.max_threads) || 1)}
                    onChange={event => handleChange('max_threads', Number(event.target.value))}
                  />
                  <span>{Math.min(threadMax, Number(localConfig.max_threads) || 1)} Cores</span>
                </div>
              </div>
              <p className="settings-help">{t('threads_desc')}</p>

              <div className="settings-separator" />

              {renderCheck('play_sound', t('play_sound'))}
              {renderCheck('backup_on', t('backup'))}
              {renderCheck('flatten_folders', t('flatten'), t('flatten_desc'))}
              {renderCheck('pass_skip_meta', t('opt_pass_skip_meta'), t('opt_pass_skip_meta_tip'))}

              <div className="settings-row">
                <span className="settings-label">{t('common_quality')}</span>
                <div className="settings-slider-control">
                  <input type="range" min="1" max="100" value={localConfig.img_quality || 100} onChange={event => handleChange('img_quality', Number(event.target.value))} />
                  <span>{localConfig.img_quality || 100}%{Number(localConfig.img_quality) === 100 ? ` (${label('quality_lossless', '무손실')})` : ''}</span>
                </div>
              </div>
              <p className="settings-help">{t('tt_img_quality_desc')}</p>

              <div className="settings-row">
                <span className="settings-label">{label('renamer_archive_compression_lbl', '재압축 강도 :')}</span>
                <select
                  className="settings-select"
                  value={localConfig.renamer_archive_compression || 'auto'}
                  onChange={event => handleChange('renamer_archive_compression', event.target.value)}
                >
                  {RENAMER_ARCHIVE_COMPRESSION_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {label(option.labelKey, option.fallback)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="settings-help">{label('renamer_archive_compression_desc', '내부 파일명 변경에서 다시 압축할 때만 적용됩니다. 빠름은 속도 우선, 최대 압축은 용량 우선입니다.')}</p>

              {renderCheck('webp_conversion', t('webp'), label('webp_desc', '모든 이미지를 고효율 WebP 포맷으로 변환하여 압축자 호환성을 보장합니다.'))}

              <div className="settings-separator" />

              {VIEWER_PROGRAM_TYPES.map(option => (
                <div className="settings-row" key={option.key}>
                  <span className="settings-label settings-viewer-label">
                    <span>{label(option.labelKey, option.fallback)}</span>
                    {option.descriptionKey ? (
                      <small>{label(option.descriptionKey, option.descriptionFallback)}</small>
                    ) : null}
                  </span>
                  <div className="settings-path-row">
                    <input
                      className="settings-input"
                      value={localConfig.viewer_paths?.[option.key] || ''}
                      placeholder={label('viewer_placeholder', '뷰어 프로그램 경로를 선택하세요')}
                      readOnly
                    />
                    <button className="settings-action-btn" onClick={() => handleSelectViewer(option.key)}>{label('btn_find', '찾기')}</button>
                    <button
                      className="settings-action-btn"
                      onClick={() => handleClearViewer(option.key)}
                      disabled={!localConfig.viewer_paths?.[option.key]}
                    >
                      {label('btn_remove', '삭제')}
                    </button>
                  </div>
                </div>
              ))}
              </fieldset>

                <fieldset className="settings-fieldset settings-file-association-fieldset">
                    <legend>{label('file_association_title', '파일 연결')}</legend>
                    <p className="settings-help">
                        {label(
                            'file_association_desc',
                            'BookManager를 통해 열 확장자를 체크한 뒤 적용하세요. 상태 배지는 현재 기본 앱 연결을 표시합니다.',
                        )}
                    </p>
                    <p className="settings-help">
                        {label(
                            'file_association_behavior_notice',
                            '체크는 BookManager로 연결할 대상을 선택합니다. 적용 시 위 뷰어 경로도 함께 저장됩니다. 기존 기본 앱을 다른 앱으로 바꾸려면 운영체제 설정을 사용하세요.',
                        )}
                    </p>

                    {fileAssociationLoading ? (
                        <p className="settings-file-association-message" role="status">
                            {label('file_association_loading', '파일 연결 상태를 확인하는 중...')}
                        </p>
                    ) : null}

                    {!fileAssociationLoading && !fileAssociationStatus?.supported ? (
                        <p className="settings-file-association-message is-notice" role="status">
                            {fileAssociationStatus?.reason === 'macos-12-required'
                                ? label(
                                    'file_association_macos_12_required',
                                    '파일 연결 설정은 macOS 12 이상에서 사용할 수 있습니다.',
                                )
                                : label(
                                    'file_association_unsupported',
                                    '이 운영체제 또는 현재 실행 환경에서는 파일 연결을 지원하지 않습니다.',
                                )}
                        </p>
                    ) : null}

                    {availableFileAssociations.length > 0 ? (
                        <div className="settings-file-association-groups">
                            {FILE_ASSOCIATION_GROUPS.map(group => {
                                const groupAssociations = availableFileAssociations.filter(
                                    association => association.group === group.key,
                                );
                                if (groupAssociations.length === 0) return null;
                                return (
                                    <section className="settings-file-association-group" key={group.key}>
                                        <h4>{label(group.labelKey, group.fallback)}</h4>
                                        <div className="settings-file-association-options">
                                            {groupAssociations.map(association => {
                                                const extension = association.extension;
                                                const extensionLabel = String(extension).replace(/^\./, '').toUpperCase();
                                                const statusType = association.isDefault
                                                    ? 'default'
                                                    : association.handlerName ? 'other' : 'none';
                                                const statusLabel = statusType === 'default'
                                                    ? label('file_association_status_bookmanager', 'BookManager')
                                                    : statusType === 'other'
                                                        ? label('file_association_status_other', '다른 앱')
                                                        : label('file_association_status_none', '연결 없음');
                                                return (
                                                    <label className="settings-file-association-option" key={extension}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedFileAssociations.includes(extension)}
                                                            onChange={event => toggleFileAssociation(extension, event.target.checked)}
                                                            disabled={fileAssociationControlsDisabled}
                                                            aria-label={`${extensionLabel} ${label('file_association_checkbox_aria', '연결 대상 선택')}`}
                                                        />
                                                        <strong>{extensionLabel}</strong>
                                                        <span
                                                            className={`settings-file-association-badge is-${statusType}`}
                                                            title={statusType === 'other' ? association.handlerName : statusLabel}
                                                        >
                                                            {statusLabel}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    ) : null}

                    <div className="settings-file-association-actions">
                        <button
                            type="button"
                            className="settings-action-btn"
                            onClick={handleRefreshFileAssociationStatus}
                            disabled={fileAssociationControlsDisabled || availableFileAssociations.length === 0}
                        >
                            {fileAssociationBusy === 'refresh'
                                ? label('file_association_refreshing', '새로고침 중...')
                                : label('file_association_refresh', '상태 새로고침')}
                        </button>
                        <button
                            type="button"
                            className="settings-action-btn"
                            onClick={handleSelectAllFileAssociations}
                            disabled={fileAssociationControlsDisabled || availableFileAssociations.length === 0}
                        >
                            {label('file_association_select_all', '전체 선택')}
                        </button>
                        <button
                            type="button"
                            className="settings-action-btn"
                            onClick={handleClearFileAssociationSelection}
                            disabled={fileAssociationControlsDisabled || selectedFileAssociations.length === 0}
                        >
                            {label('file_association_clear_all', '전체 해제')}
                        </button>
                        <button
                            type="button"
                            className="settings-action-btn settings-blue-btn"
                            onClick={handleApplyFileAssociations}
                            disabled={fileAssociationControlsDisabled || selectedFileAssociations.length === 0}
                        >
                            {fileAssociationBusy === 'apply'
                                ? label('file_association_applying', '연결 중...')
                                : label('file_association_apply', 'BookManager로 연결')}
                        </button>
                    </div>

                    {fileAssociationStatus?.supported
                        && fileAssociationStatus.platform === 'win32'
                        && !fileAssociationStatus.directApply ? (
                            <div className="settings-file-association-system-note">
                                <p>
                                    {label(
                                        'file_association_windows_confirmation',
                                        'Windows 시스템 설정에서 BookManager를 기본 앱으로 한 번 더 선택해야 합니다.',
                                    )}
                                </p>
                                <button
                                    type="button"
                                    className="settings-action-btn"
                                    onClick={handleOpenFileAssociationSettings}
                                    disabled={Boolean(fileAssociationBusy) || !window.electronAPI?.openFileAssociationSettings}
                                >
                                    {fileAssociationBusy === 'settings'
                                        ? label('file_association_opening_settings', '설정 여는 중...')
                                        : label('file_association_open_settings', 'Windows 기본 앱 설정 열기')}
                                </button>
                            </div>
                        ) : null}

                    {fileAssociationFeedback ? (
                        <p
                            className={`settings-file-association-message is-${fileAssociationFeedback.type}`}
                            role={fileAssociationFeedback.type === 'error' ? 'alert' : 'status'}
                        >
                            {fileAssociationFeedbackText}
                        </p>
                    ) : null}
                </fieldset>
            </div>
          )}

          {activeTab === 'folder' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset settings-library-fieldset">
              <legend>{t('grp_dup_folders_title')}</legend>
              <p className="settings-help">{t('dup_folder_desc')}</p>
              <div className="settings-library-toolbar">
                <button className="settings-action-btn settings-blue-btn" onClick={handleAddDupFolder}>
                  <FaIcon name="folderPlus" />{label('btn_add', '추가')}
                </button>
              </div>
              <div className="settings-list settings-library-list">
                {libraryEntries.length === 0 ? (
                  <div className="settings-empty-list">{t('tf_empty_no_data')}</div>
                ) : libraryEntries.map((entry, index) => (
                  <div
                    className={`settings-list-item settings-library-list-item ${selectedDupFolder === entry.path ? 'active' : ''}`}
                    key={entry.path}
                    onClick={() => setSelectedDupFolder(entry.path)}
                  >
                    <div className="settings-library-list-main">
                      <div className="settings-library-list-head">
                        <span className="settings-library-list-title" title={entry.path}>
                          {entry.alias || libraryFallbackName(entry.path)}
                        </span>
                        {entry.group ? (
                          <span className="settings-library-list-group" title={entry.group}>{entry.group}</span>
                        ) : null}
                      </div>
                      <span className="settings-library-list-path" title={entry.path}>{entry.path}</span>
                    </div>
                    <div className="settings-library-row-actions">
                      <button
                        type="button"
                        aria-label={label('settings_library_move_up', '위로 이동')}
                        title={label('settings_library_move_up', '위로 이동')}
                        disabled={index === 0}
                        onClick={event => {
                          event.stopPropagation();
                          handleMoveLibrary(entry.path, -1);
                        }}
                      >
                        <FaIcon name="angleUp" size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={label('settings_library_move_down', '아래로 이동')}
                        title={label('settings_library_move_down', '아래로 이동')}
                        disabled={index === libraryEntries.length - 1}
                        onClick={event => {
                          event.stopPropagation();
                          handleMoveLibrary(entry.path, 1);
                        }}
                      >
                        <FaIcon name="angleDown" size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={label('settings_library_edit', '수정')}
                        title={label('settings_library_edit', '수정')}
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedDupFolder(entry.path);
                        }}
                      >
                        <FaIcon name="edit" size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label={label('btn_remove', '삭제')}
                        title={label('btn_remove', '삭제')}
                        onClick={event => {
                          event.stopPropagation();
                          handleRemoveDupFolder(entry.path);
                        }}
                      >
                        <FaIcon name="trash" size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {selectedLibraryEntry && (
                <div className="settings-library-editor">
                  <div className="settings-library-editor-fields">
                    <label>
                      <span>{label('settings_library_alias', '별칭')}</span>
                      <input
                        className="settings-input"
                        value={selectedLibraryEntry.alias}
                        placeholder={label('settings_library_alias_ph', '공유 서버에 표시할 이름')}
                        onChange={event => handleLibraryEntryChange(selectedLibraryEntry.path, 'alias', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>{label('settings_library_group', '그룹')}</span>
                      <input
                        className="settings-input"
                        value={selectedLibraryEntry.group}
                        placeholder={label('settings_library_group_ph', '예: NAS, 로컬, 작업용')}
                        onChange={event => handleLibraryEntryChange(selectedLibraryEntry.path, 'group', event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="settings-library-editor-path" title={selectedLibraryEntry.path}>
                    <span>{label('settings_library_path', '경로')}</span>
                    <strong>{selectedLibraryEntry.path}</strong>
                  </div>
                </div>
              )}
              </fieldset>
              <fieldset className="settings-fieldset">
              <legend>{label('settings_maintenance_title', '인덱스 및 캐시 관리')}</legend>
              <div className="settings-maintenance-actions">
                <span>{label('setting_update_index_msg', '등록된 대상 폴더의 변경사항을 확인하여 인덱스를 최신화합니다.')}</span>
                <button className="settings-action-btn" onClick={handleUpdateIndex} disabled={Boolean(maintenanceBusy)}>
                  {maintenanceBusy === 'index' ? label('setting_update_index_busy', '갱신 중...') : label('setting_update_index', '인덱스 색인 갱신')}
                </button>
              </div>
              <div className="settings-maintenance-actions">
                <span>{label('folder_clear_cache_desc', '저장된 중복 파일 매칭 결과 캐시를 초기화합니다.')}</span>
                <button className="settings-action-btn settings-danger-btn" onClick={handleClearDupCache} disabled={Boolean(maintenanceBusy)}>
                  <FaIcon name="trash" />{label('folder_clear_cache', '중복 매칭 캐시 초기화')}
                </button>
              </div>
              </fieldset>
            </div>
          )}

          {activeTab === 'api' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset">
              <legend>{label('preferred_search_api_group', '자주 사용하는 검색 API')}</legend>
              <div className="settings-row">
                <span className="settings-label">{label('preferred_search_api_comic', '만화책')}</span>
                <select
                  className="settings-select"
                  value={preferredComicApi}
                  onChange={event => handleChange('preferred_meta_api_comic', event.target.value)}
                >
                  {COMIC_METADATA_API_SOURCES.map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">{label('preferred_search_api_book', '전자책')}</span>
                <select
                  className="settings-select"
                  value={preferredBookApi}
                  onChange={event => handleChange('preferred_meta_api_book', event.target.value)}
                >
                  {BOOK_METADATA_API_SOURCES.map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">{label('preferred_search_api_pdf', 'PDF')}</span>
                <select
                  className="settings-select"
                  value={preferredPdfApi}
                  onChange={event => handleChange('preferred_meta_api_pdf', event.target.value)}
                >
                  {PDF_METADATA_API_SOURCES.map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <p className="settings-help">{label('preferred_search_api_desc', '선택한 값은 메타데이터 관리의 검색 API 드롭다운 기본값으로 사용됩니다.')}</p>
              </fieldset>

              <fieldset className="settings-fieldset">
              <legend>{t('ai_cover_search_group')}</legend>
              <div className="settings-row">
                <span className="settings-label">{t('ai_provider')}</span>
                <select className="settings-select" value={aiProvider} onChange={event => handleApiChange('ai_provider', event.target.value)}>
                  <option value="Gemini">Gemini</option>
                  <option value="OpenAI">OpenAI</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('ai_api_key')}</span>
                {renderSecretInput(
                  aiKeyField,
                  aiProvider === 'OpenAI' ? 'OpenAI API Key (sk-...)' : 'Gemini API Key (AIza...)'
                )}
              </div>
              <p className="settings-help">{t('ai_cover_search_notice')}</p>
              </fieldset>

              <div className="settings-api-manual-row">
                <button className="settings-action-btn settings-blue-btn" onClick={() => setShowApiManual(true)}><FaIcon name="bookOpen" />{label('btn_api_manual', 'API 발급 매뉴얼')}</button>
              </div>

              <div className="settings-row">
                <span className="settings-label">Aladin TTBKey</span>
                {renderSecretInput('aladin', 'Aladin TTBKey')}
              </div>
              <div className="settings-row">
                <span className="settings-label">Google Books API</span>
                {renderSecretInput('google', 'Google Books API Key')}
              </div>
              <div className="settings-row">
                <span className="settings-label">Comic Vine API</span>
                {renderSecretInput('vine', 'Comic Vine API Key')}
              </div>

              <fieldset className="settings-fieldset settings-tag-fieldset">
              <legend>{t('tag_rules_group')}</legend>
              <p className="settings-help">{t('tag_rules_desc')}</p>
              <textarea
                className="settings-textarea"
                value={localConfig.api_keys?.tag_rules || ''}
                placeholder={label('tag_rules_placeholder', 'Shounen, 소년만화 -> 소년\nAction -> 액션')}
                onChange={event => handleApiChange('tag_rules', event.target.value)}
              />
              <div className="settings-maintenance-actions">
                <button className="settings-action-btn settings-danger-btn" onClick={handleClearApiCache} disabled={Boolean(maintenanceBusy)}>
                  <FaIcon name="trash" />
                  {maintenanceBusy === 'api-cache' ? label('cache_clearing', '초기화 중...') : label('btn_clear_cache', '검색 캐시 비우기')}
                </button>
              </div>
              </fieldset>
            </div>
          )}

          {activeTab === 'ttsApi' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset">
              <legend>{label('tts_supertonic_group', 'Supertonic 3 (로컬)')}</legend>
              <p className="settings-help">{label('tts_supertonic_desc', '인터넷 전송 없이 기기에서 음성을 생성합니다. 최초 사용 전 모델 설치가 필요합니다.')}</p>
              <div className="settings-maintenance-actions">
                {!supertonicStatus.installed && (
                  <button className="settings-action-btn settings-blue-btn" onClick={handleInstallSupertonic} disabled={Boolean(maintenanceBusy)}>
                    {maintenanceBusy === 'supertonic-model'
                      ? `${label('tts_supertonic_installing', '설치 중...')} ${supertonicInstallPercent(supertonicProgress)}%`
                      : label('tts_supertonic_download', '모델 다운로드 및 설치')}
                  </button>
                )}
                <span>
                  {supertonicStatus.installed
                    ? label('tts_supertonic_installed', '설치됨')
                    : label('tts_supertonic_not_installed', '설치되지 않음')}
                </span>
              </div>
              {supertonicStatus.installed && supertonicStatus.modelDir && (
                <p className="settings-help">{supertonicStatus.modelDir}</p>
              )}
              <p className="settings-help">{label('tts_supertonic_license', '모델: Supertonic OpenRAIL-M · 추론 코드: MIT')}</p>
              </fieldset>
              <fieldset className="settings-fieldset">
              <legend>{label('tts_api_group', 'TTS API')}</legend>
              <div className="settings-row">
                <span className="settings-label">{label('tts_openai_api_key', 'OpenAI TTS API Key')}</span>
                {renderSecretInput('tts_openai_key', 'OpenAI API Key (sk-...)')}
              </div>
              <div className="settings-row">
                <span className="settings-label">{label('tts_google_api_key', 'Google TTS 인증 정보')}</span>
                {renderSecretInput('tts_google_key', 'Google service account JSON or JSON file path')}
              </div>
              <p className="settings-help">{label('tts_google_credential_notice', 'Google Cloud TTS는 API key가 아니라 서비스 계정 JSON 또는 JSON 파일 경로가 필요합니다.')}</p>
              <p className="settings-help">{label('tts_api_notice', 'TTS에서만 사용하는 인증 정보입니다. AI 표지 제목 검색 API Key와 별도로 저장됩니다.')}</p>
              </fieldset>
            </div>
          )}
        </div>

        {maintenanceMessage && (
          <div className="settings-maintenance-message">{maintenanceMessage}</div>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>{t('btn_cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave}>{t('btn_save')}</button>
        </div>
        {showApiManual && (
          <div className="settings-manual-backdrop" onClick={() => setShowApiManual(false)}>
            <div className="settings-manual-dialog" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
              <h3>{label('api_manual_title', 'API 발급 매뉴얼')}</h3>
              <button onClick={() => window.electronAPI?.openExternal?.('https://blog.aladin.co.kr/openapi')}>Aladin OpenAPI</button>
              <button onClick={() => window.electronAPI?.openExternal?.('https://comicvine.gamespot.com/api/')}>Comic Vine API</button>
              <button onClick={() => window.electronAPI?.openExternal?.('https://console.cloud.google.com/')}>Google Cloud Console</button>
              <button className="settings-manual-close" onClick={() => setShowApiManual(false)}>{label('btn_close', '닫기')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { SettingsModal };
export default SettingsModal;
