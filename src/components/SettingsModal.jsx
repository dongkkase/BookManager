import React from 'react';
import { AUDIBLE_REGIONS, ITUNES_COUNTRIES, KOBO_COUNTRIES, KOBO_LANGUAGES, isMetadataApiSourceEnabled } from '../../electron/metadataProviderSettings.js';
import { FaIcon } from './FaIcon';
import {
  libraryPathKey,
  normalizeLibraryEntries,
  normalizeSettingsConfig,
    mergeSettingsDraft,
  safeThreadLimit,
    settingsConfigsEqual,
  syncLibraryConfig,
} from '../settingsPolicy';
import {
    ALL_METADATA_API_SOURCES,
    apiSourceHasRequiredKey,
    metadataSearchSourcesForBookType,
    requiredApiKeyForSource,
  normalizeMetadataApiSourceForBookType,
} from '../metadataApiPolicy';
import {
  bundledFontOptionsFromFaces,
  installBundledFontFaces,
} from '../bundledFonts';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { TelemetrySettings } from './TelemetrySettings';
import { LicenseSettings } from './LicenseSettings';
import { fontVarsForConfig } from '../fontPolicy';
import { SettingsLibraryPreview } from './SettingsLibraryPreview';
import { SettingsLibraryList } from './SettingsLibraryList';
import { SettingsDataFolder } from './SettingsDataFolder';

const LANGUAGE_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

const SETTINGS_TABS = [
    { id: 'basic', key: 'general', icon: 'sliders' },
    { id: 'processing', key: 'processing', icon: 'archive' },
    { id: 'folder', key: 'folder', icon: 'folderOpen' },
    { id: 'viewer', key: 'viewer', icon: 'bookOpen' },
    { id: 'api', key: 'api', icon: 'search' },
    { id: 'ttsApi', key: 'tts', icon: 'headphones', fallbackKey: 'tab_tts_api_key' },
    { id: 'privacy', key: 'privacy', icon: 'user' },
    { id: 'licenses', key: 'licenses', icon: 'fileLines' },
];

const API_SETTINGS_SECTIONS = [
    { id: 'preferred', labelKey: 'preferred_search_api_group' },
    { id: 'providers', labelKey: 'settings.api.search_settings' },
    { id: 'ai', labelKey: 'ai_cover_search_group' },
    { id: 'tags', labelKey: 'tag_rules_group' },
    { id: 'cache', labelKey: 'settings.api.search_cache' },
];

const AUDIOBOOK_METADATA_PROVIDERS = new Set(['Audible', 'AudNexus', 'Libro.fm']);
const METADATA_PROVIDER_GROUPS = [
    {
        id: 'books',
        labelKey: 'metadata_provider_group_books',
        sources: ALL_METADATA_API_SOURCES.filter(source => !AUDIOBOOK_METADATA_PROVIDERS.has(source.value)),
    },
    {
        id: 'audiobooks',
        labelKey: 'metadata_provider_group_audiobooks',
        sources: ALL_METADATA_API_SOURCES.filter(source => AUDIOBOOK_METADATA_PROVIDERS.has(source.value)),
    },
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
const METADATA_PROVIDER_GUIDES = [
    { name: 'Hardcover', key: 'hardcover', url: 'https://hardcover.app/account/api' },
    { name: 'Goodreads', key: 'goodreads', url: 'https://www.goodreads.com/' },
    { name: 'Open Library', key: 'openlibrary', url: 'https://openlibrary.org/dev/docs/api/search' },
    { name: 'iTunes', key: 'itunes', url: 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html' },
    { name: 'Kobo', key: 'kobo', url: 'https://www.kobo.com/' },
    { name: 'LubimyCzytac', key: 'lubimyczytac', url: 'https://lubimyczytac.pl/' },
    { name: 'RanobeDB', key: 'ranobedb', url: 'https://ranobedb.org/' },
    { name: 'Audible', key: 'audible', url: 'https://www.audible.com/' },
    { name: 'AudNexus', key: 'audnexus', url: 'https://audnex.us/' },
    { name: 'Libro.fm', key: 'librofm', url: 'https://libro.fm/' },
];

const METADATA_PROVIDER_KEY_LABELS = {
    yes24: 'YES24 API Key',
    aladin: 'Aladin TTBKey',
    google: 'Google Books API Key',
    vine: 'Comic Vine API Key',
    hardcover: 'Hardcover API Token',
};

const DEFAULT_API_KEYS = {
    yes24: '',
  aladin: '',
  vine: '',
  google: '',
    hardcover: '',
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
    const reducedMotion = useReducedMotion();
  const [localConfig, setLocalConfig] = React.useState(null);
    const [appliedConfig, setAppliedConfig] = React.useState(null);
    const [isApplying, setIsApplying] = React.useState(false);
    const applyingRef = React.useRef(false);
    const fileAssociationApplyingRef = React.useRef(false);
    const draftLanguageRef = React.useRef('');
  const [activeTab, setActiveTab] = React.useState('basic');
    const [activeApiSection, setActiveApiSection] = React.useState('preferred');
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
    const settingsBodyRef = React.useRef(null);
    const libraryEditorRef = React.useRef(null);
    const lastLibraryEntryRef = React.useRef(null);
    const [libraryEditorMounted, setLibraryEditorMounted] = React.useState(false);
    const [libraryEditorExpanded, setLibraryEditorExpanded] = React.useState(false);
    const libraryEntries = React.useMemo(() => normalizeLibraryEntries(localConfig), [localConfig]);
    const selectedLibraryEntry = libraryEntries.find(entry => entry.path === selectedDupFolder) || null;
    const libraryEditorOpen = isOpen && activeTab === 'folder' && Boolean(selectedLibraryEntry);
    const displayedLibraryEntry = libraryEditorOpen
        ? selectedLibraryEntry
        : libraryEditorMounted ? lastLibraryEntryRef.current : null;
    const [compactNavigation, setCompactNavigation] = React.useState(false);
  const settingsOpenInitializedRef = React.useRef(false);
  const threadMax = React.useMemo(() => safeThreadMax(), []);
    const hasChanges = React.useMemo(() => Boolean(
        localConfig && appliedConfig
        && !settingsConfigsEqual(localConfig, appliedConfig, navigator.hardwareConcurrency || 4)
    ), [localConfig, appliedConfig]);
  const handleCancel = React.useCallback(() => {
    if (applyingRef.current) return;
    setLocalConfig(appliedConfig);
    onClose?.();
  }, [appliedConfig, onClose]);
  const dialogRef = useModalAccessibility(isOpen, () => {
    if (showApiManual) setShowApiManual(false);
    else if (activeTab === 'folder' && selectedDupFolder) {
        setSelectedDupFolder('');
        settingsBodyRef.current?.focus({ preventScroll: true });
    }
    else handleCancel();
  });

    const manualDialogRef = useModalAccessibility(isOpen && showApiManual, () => setShowApiManual(false));

  React.useEffect(() => {
    if (!isOpen) {
      settingsOpenInitializedRef.current = false;
      return;
    }
    if (settingsOpenInitializedRef.current) return;
    settingsOpenInitializedRef.current = true;
    const initialConfig = normalizeConfig(config);
    draftLanguageRef.current = initialConfig.language;
    setLocalConfig(initialConfig);
    setAppliedConfig(initialConfig);
  }, [config, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setActiveApiSection('preferred');
    setSelectedDupFolder('');
  }, [initialTab, isOpen, navigationRequest]);

    React.useLayoutEffect(() => {
        if (libraryEditorOpen) lastLibraryEntryRef.current = selectedLibraryEntry;
    }, [libraryEditorOpen, selectedLibraryEntry]);

    React.useLayoutEffect(() => {
        let prepareFrame;
        let enterFrame;
        if (!isOpen) {
            setLibraryEditorMounted(false);
            setLibraryEditorExpanded(false);
            lastLibraryEntryRef.current = null;
            return;
        }
        if (reducedMotion) {
            setLibraryEditorMounted(libraryEditorOpen);
            setLibraryEditorExpanded(libraryEditorOpen);
            return;
        }
        if (libraryEditorOpen) {
            setLibraryEditorMounted(true);
            // Paint the closed position before starting the slide transition.
            prepareFrame = window.requestAnimationFrame(() => {
                enterFrame = window.requestAnimationFrame(() => setLibraryEditorExpanded(true));
            });
        } else {
            setLibraryEditorExpanded(false);
        }
        return () => {
            window.cancelAnimationFrame(prepareFrame);
            window.cancelAnimationFrame(enterFrame);
        };
    }, [isOpen, libraryEditorOpen, reducedMotion]);

    React.useEffect(() => {
        if (!libraryEditorMounted || libraryEditorExpanded || libraryEditorOpen) return undefined;
        const timeout = window.setTimeout(() => setLibraryEditorMounted(false), 260);
        return () => window.clearTimeout(timeout);
    }, [libraryEditorMounted, libraryEditorExpanded, libraryEditorOpen]);

    React.useLayoutEffect(() => {
        const editor = libraryEditorRef.current;
        const body = settingsBodyRef.current;
        if (!isOpen || !displayedLibraryEntry || !editor || !body) return;
        const updateEditorSpace = () => {
            body.style.setProperty('--settings-library-editor-space', `${editor.offsetHeight + 32}px`);
        };
        updateEditorSpace();
        const observer = new ResizeObserver(updateEditorSpace);
        observer.observe(editor);
        return () => {
            observer.disconnect();
            body.style.removeProperty('--settings-library-editor-space');
        };
    }, [isOpen, Boolean(displayedLibraryEntry)]);

    React.useLayoutEffect(() => {
        if (libraryEditorOpen && libraryEditorExpanded) libraryEditorRef.current?.querySelector('input')?.focus({ preventScroll: true });
    }, [libraryEditorOpen, libraryEditorExpanded, selectedDupFolder]);

    React.useEffect(() => {
        const media = window.matchMedia('(max-width: 760px)');
        const updateNavigation = () => setCompactNavigation(media.matches);
        updateNavigation();
        media.addEventListener('change', updateNavigation);
        return () => media.removeEventListener('change', updateNavigation);
    }, []);

    React.useEffect(() => {
        if (!isOpen) return;
        settingsBodyRef.current?.scrollTo({ top: 0 });
        dialogRef.current?.querySelector('[role="tab"][aria-selected="true"]')
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (activeTab === 'api') {
            dialogRef.current?.querySelector('.settings-api-submenu [aria-current="page"]')
                ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }, [activeTab, activeApiSection, compactNavigation, isOpen]);

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

    const selectedTab = SETTINGS_TABS.find(tab => tab.id === activeTab) || SETTINGS_TABS[0];
    const selectedApiSection = API_SETTINGS_SECTIONS.find(section => section.id === activeApiSection) || API_SETTINGS_SECTIONS[0];
    const tabTitle = tab => label(`settings.${tab.key}.title`, t(tab.fallbackKey || 'tab_basic'));
    const selectTab = id => {
        setSelectedDupFolder('');
        setActiveTab(id);
        if (id === 'api') {
            setActiveApiSection('preferred');
            settingsBodyRef.current?.scrollTo({ top: 0 });
        }
    };
    const handleTabKeyDown = event => {
        const currentIndex = SETTINGS_TABS.findIndex(tab => tab.id === activeTab);
        let nextIndex;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = SETTINGS_TABS.length - 1;
        else return;
        event.preventDefault();
        const nextTab = SETTINGS_TABS[nextIndex];
        selectTab(nextTab.id);
        dialogRef.current?.querySelector(`#settings-tab-${nextTab.id}`)?.focus();
    };
    const handleApiSectionKeyDown = event => {
        const currentIndex = API_SETTINGS_SECTIONS.findIndex(section => section.id === activeApiSection);
        let nextIndex;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % API_SETTINGS_SECTIONS.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + API_SETTINGS_SECTIONS.length) % API_SETTINGS_SECTIONS.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = API_SETTINGS_SECTIONS.length - 1;
        else return;
        event.preventDefault();
        event.stopPropagation();
        const nextSection = API_SETTINGS_SECTIONS[nextIndex];
        setActiveApiSection(nextSection.id);
        dialogRef.current?.querySelector(`#settings-api-section-${nextSection.id}`)?.focus();
    };
    const renderApiSubmenu = () => (
        <nav className="settings-api-submenu" aria-label={tabTitle(SETTINGS_TABS.find(tab => tab.id === 'api'))}>
            {API_SETTINGS_SECTIONS.map(section => (
                <button key={section.id} id={`settings-api-section-${section.id}`} type="button"
                    aria-current={activeApiSection === section.id ? 'page' : undefined}
                    aria-controls="settings-api-content"
                    tabIndex={activeApiSection === section.id ? 0 : -1}
                    className={activeApiSection === section.id ? 'active' : ''}
                    onClick={() => setActiveApiSection(section.id)} onKeyDown={handleApiSectionKeyDown}>
                    {t(section.labelKey)}
                </button>
            ))}
        </nav>
    );

  const apiSourceLabel = (source) => label(source.labelKey, source.value);
  const formatLabels = Array.isArray(t('format_opts')) ? t('format_opts') : ['변경 안 함', 'ZIP', 'CBZ', 'CBR', '7z'];
  const preferredComicApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_comic || localConfig.last_meta_api,
    'comic',
    localConfig.api_keys || {},
    localConfig.metadata_api_enabled,
  );
  const preferredBookApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_book || localConfig.last_meta_api,
    'book',
    localConfig.api_keys || {},
    localConfig.metadata_api_enabled,
  );
  const preferredPdfApi = normalizeMetadataApiSourceForBookType(
    localConfig.preferred_meta_api_pdf || localConfig.last_meta_api,
    'pdf',
    localConfig.api_keys || {},
    localConfig.metadata_api_enabled,
  );
    const preferredAudioApi = normalizeMetadataApiSourceForBookType(
        localConfig.preferred_meta_api_audio || localConfig.preferred_meta_api_book || localConfig.last_meta_api,
        'audio',
        localConfig.api_keys || {},
        localConfig.metadata_api_enabled,
    );
    const providerSettings = localConfig.metadata_providers;
    const regionNames = new Intl.DisplayNames([localConfig.lang || 'ko'], { type: 'region' });
    const languageNames = new Intl.DisplayNames([localConfig.lang || 'ko'], { type: 'language' });
    const countryLabel = country => regionNames.of(country.toUpperCase() === 'UK' ? 'GB' : country.toUpperCase());
    const itunesCountries = [...new Set([...ITUNES_COUNTRIES, providerSettings.itunes_country])];
  const bundledFontOptions = bundledFontOptionsFromFaces(bundledFontFaces);
  const systemFontsForSelect = uniqueSystemFonts(systemFontOptions, localConfig.font_family, bundledFontOptions);
  const aiProvider = localConfig.api_keys?.ai_provider === 'OpenAI' ? 'OpenAI' : 'Gemini';
  const aiKeyField = aiProvider === 'OpenAI' ? 'ai_openai_key' : 'ai_gemini_key';
    const availableFileAssociations = fileAssociationStatus?.associations || [];
    const fileAssociationControlsDisabled = Boolean(
        fileAssociationLoading
        || fileAssociationBusy
        || isApplying
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

    const handleProviderChange = (key, value) => {
        setLocalConfig(prev => ({
            ...prev,
            metadata_providers: { ...prev.metadata_providers, [key]: value },
        }));
    };

    const handleProviderEnabledChange = (source, enabled) => {
        setLocalConfig(prev => ({
            ...prev,
            metadata_api_enabled: { ...prev.metadata_api_enabled, [source]: enabled },
        }));
    };

  const handleLanguageChange = (value) => {
    draftLanguageRef.current = value;
    setLocalConfig(prev => ({ ...prev, lang: value, language: value }));
    onLanguagePreviewChange?.(value);
  };

    const handleApply = async () => {
        if (!hasChanges || applyingRef.current || fileAssociationApplyingRef.current) return;
        applyingRef.current = true;
        setIsApplying(true);
        const submittedConfig = localConfig;
        const coreCount = navigator.hardwareConcurrency || 4;
        const nextConfig = normalizeSettingsConfig(submittedConfig, coreCount);
        try {
            const result = await onSave(nextConfig);
            const savedConfig = normalizeConfig(result && typeof result === 'object' ? result : nextConfig);
            if (draftLanguageRef.current === submittedConfig.language) {
                draftLanguageRef.current = savedConfig.language;
            }
            setAppliedConfig(savedConfig);
            setLocalConfig(current => mergeSettingsDraft(savedConfig, submittedConfig, current, coreCount));
        } catch (error) {
            if (!error?.settingsSaveNotified) {
                showToast?.(label('config_save_failed', '설정 저장 실패: {msg}')
                    .replace('{msg}', error?.message || String(error)), 6000);
            }
        } finally {
            applyingRef.current = false;
            setIsApplying(false);
            onLanguagePreviewChange?.(draftLanguageRef.current);
        }
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
        if (applyingRef.current || fileAssociationApplyingRef.current) return;
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

        fileAssociationApplyingRef.current = true;
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
            if (typeof onPersistViewerPaths === 'function' || window.electronAPI?.saveConfig) {
                setAppliedConfig(previous => normalizeConfig({ ...previous, viewer_paths: viewerPaths }));
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
            fileAssociationApplyingRef.current = false;
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
        mode: 'smart',
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

  const renderSecretInput = (key, placeholder, disabled = false, inlineLabel = '') => (
    <div className={`settings-secret-row${inlineLabel ? ' settings-provider-secret settings-control-field' : ''}`}>
        {inlineLabel && <label htmlFor={`settings-secret-${key}`}>{inlineLabel}</label>}
      <input
        id={`settings-secret-${key}`}
        className="settings-input"
        aria-label={inlineLabel ? METADATA_PROVIDER_KEY_LABELS[key] : undefined}
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
        aria-controls={`settings-secret-${key}`}
        aria-pressed={Boolean(showSecrets[key])}
        aria-label={showSecrets[key] ? label('secret_hide', '비밀번호 숨기기') : label('secret_show', '비밀번호 보기')}
      >
        <FaIcon name={showSecrets[key] ? 'eyeSlash' : 'eye'} />
      </button>
    </div>
  );

    const renderProviderSettings = source => {
        return <>
            {source.value === '알라딘' && (
                    <p className="settings-help settings-aladin-api-notice">
                        {label('aladin_openapi_shutdown_notice', '알라딘 OpenAPI 서비스 종료 예정 26년 10월 30일')}{' '}
                        <a
                            className="settings-help-link"
                            href="https://blog.aladin.co.kr/openapi/group/18264538"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={event => {
                                if (window.electronAPI?.openExternal) {
                                    event.preventDefault();
                                    window.electronAPI.openExternal(event.currentTarget.href);
                                }
                            }}
                        >
                            [{label('aladin_openapi_shutdown_details', '자세히보기')}]
                        </a>
                    </p>
            )}
            {source.value === 'Hardcover' && (
                <p className="settings-help">{t('metadata_provider_guide_hardcover')}{' '}
                    <a className="settings-help-link" href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer"
                        onClick={event => {
                            if (window.electronAPI?.openExternal) {
                                event.preventDefault();
                                window.electronAPI.openExternal(event.currentTarget.href);
                            }
                        }}>{t('metadata_provider_get_token')}</a>
                </p>
            )}
            {source.value === 'iTunes' && <>
                    <div className="settings-row settings-control-field">
                        <label className="settings-label" htmlFor="settings-itunes-country">{t('metadata_provider_itunes_country')}</label>
                        <select id="settings-itunes-country" className="settings-select" value={providerSettings.itunes_country}
                            onChange={event => handleProviderChange('itunes_country', event.target.value)}>
                            {itunesCountries.map(country => <option key={country} value={country}>{countryLabel(country)}</option>)}
                        </select>
                    </div>
                    <div className="settings-row settings-control-field">
                        <label className="settings-label" htmlFor="settings-itunes-cover">{t('metadata_provider_itunes_cover')}</label>
                        <select id="settings-itunes-cover" className="settings-select" value={providerSettings.itunes_cover_resolution}
                            onChange={event => handleProviderChange('itunes_cover_resolution', event.target.value)}>
                            <option value="high">{t('metadata_provider_cover_high')}</option>
                            <option value="standard">{t('metadata_provider_cover_standard')}</option>
                        </select>
                    </div>

            </>}
            {source.value === 'Kobo' && <>
                    <div className="settings-row settings-control-field">
                        <label className="settings-label" htmlFor="settings-kobo-country">{t('metadata_provider_kobo_country')}</label>
                        <select id="settings-kobo-country" className="settings-select" value={providerSettings.kobo_country}
                            onChange={event => handleProviderChange('kobo_country', event.target.value)}>
                            {KOBO_COUNTRIES.map(country => <option key={country} value={country}>{countryLabel(country)}</option>)}
                        </select>
                    </div>
                    <div className="settings-row settings-control-field">
                        <label className="settings-label" htmlFor="settings-kobo-language">{t('metadata_provider_kobo_language')}</label>
                        <select id="settings-kobo-language" className="settings-select" value={providerSettings.kobo_language}
                            onChange={event => handleProviderChange('kobo_language', event.target.value)}>
                            {KOBO_LANGUAGES.map(language => <option key={language} value={language}>
                                {language === 'all' ? t('metadata_provider_all_languages') : languageNames.of(language)}
                            </option>)}
                        </select>
                    </div>

            </>}
            {source.value === 'Audible' && <>
                    <div className="settings-row settings-control-field">
                        <label className="settings-label" htmlFor="settings-audible-region">{t('metadata_provider_audible_region')}</label>
                        <select id="settings-audible-region" className="settings-select" value={providerSettings.audible_region}
                            onChange={event => handleProviderChange('audible_region', event.target.value)}>
                            {AUDIBLE_REGIONS.map(country => <option key={country} value={country}>{countryLabel(country)}</option>)}
                        </select>
                    </div>

            </>}
        </>;
    };

    const renderSwitch = (key, text, help) => (
        <label className="settings-check-row settings-switch-row" htmlFor={`settings-${key}`}>
            <button
                id={`settings-${key}`}
                type="button"
                role="switch"
                className="settings-provider-switch"
                aria-label={text}
                aria-describedby={help ? `settings-help-${key}` : undefined}
                aria-checked={Boolean(localConfig[key])}
                onClick={() => handleChange(key, !localConfig[key])}
            >
                <span aria-hidden="true" />
            </button>
            <span>
                <strong>{text}</strong>
                {help && <small id={`settings-help-${key}`}>{help}</small>}
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
        onClickCapture={event => {
            const selectingLibrary = event.target.closest('.settings-library-list-item, .settings-library-preview-item')
                && !event.target.closest('.settings-library-drag-handle, .settings-library-remove');
            if (selectingLibrary) return;
            if (selectedDupFolder && !libraryEditorRef.current?.contains(event.target)) {
                setSelectedDupFolder('');
            }
        }}
      >
        <div className="modal-header" inert={showApiManual ? '' : undefined}>
            <div className="settings-header-copy">
                <span id="settings-modal-title" className="modal-title">{t('settings_title')}</span>
                <p className="settings-subtitle">{t('settings.subtitle')}</p>
            </div>
            <button className="modal-close" aria-label={t('btn_close')} onClick={handleCancel} disabled={isApplying}>×</button>
        </div>

        <div className="settings-workspace" inert={showApiManual ? '' : undefined}>
            <aside id="settings-sidebar" className="settings-sidebar">
                <div className="settings-tabs" role="tablist" aria-label={t('settings.navigation')} aria-orientation={compactNavigation ? 'horizontal' : 'vertical'}>
                    {SETTINGS_TABS.map(tab => (
                        <React.Fragment key={tab.id}>
                        <button
                            id={`settings-tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls="settings-panel"
                            aria-expanded={tab.id === 'api' ? activeTab === 'api' : undefined}
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            className={activeTab === tab.id ? 'active' : ''}
                            onClick={() => selectTab(tab.id)}
                            onKeyDown={handleTabKeyDown}
                        >
                            <FaIcon name={tab.icon} className="settings-nav-icon" />
                            <span className="settings-nav-copy">
                                <strong>{tabTitle(tab)}</strong>
                                <small>{t(`settings.${tab.key}.summary`)}</small>
                            </span>
                            {tab.id === 'api' && <FaIcon name={activeTab === 'api' ? 'angleDown' : 'angleRight'} className="settings-nav-chevron" />}
                        </button>
                        {tab.id === 'api' && activeTab === 'api' && !compactNavigation && renderApiSubmenu()}
                        </React.Fragment>
                    ))}
                </div>
                {activeTab === 'api' && compactNavigation && renderApiSubmenu()}
            </aside>
            <div className="settings-content">
            <div
                ref={settingsBodyRef}
                className={`modal-body settings-modal-body${displayedLibraryEntry ? ' has-library-editor' : ''}`}
                role="tabpanel"
                id="settings-panel"
                aria-labelledby={`settings-tab-${activeTab}`}
                tabIndex={0}
            >
                <div className="settings-page-header">
                    <h2>{activeTab === 'api' ? t(selectedApiSection.labelKey) : tabTitle(selectedTab)}</h2>
                    {activeTab !== 'api' && <p>{t(`settings.${selectedTab.key}.description`)}</p>}
                </div>
                {activeTab === 'basic' && (
                    <div className="settings-panel">
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.appearance')}</legend>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-language">{t('lang_lbl')}</label>
                                <select id="settings-language" className="settings-select" value={localConfig.language || localConfig.lang || 'ko'} onChange={event => handleLanguageChange(event.target.value)}>
                                    {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </div>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-font">{t('font_family_lbl')}</label>
                                <select id="settings-font" className="settings-select" value={localConfig.font_family || 'Noto Sans KR'} onChange={event => handleChange('font_family', event.target.value)}>
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

                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-font-scale">{t('font_size_lbl')}</label>
                                <select id="settings-font-scale" className="settings-select" value={localConfig.font_scale || 100} onChange={event => handleChange('font_scale', Number(event.target.value))}>
                                    {FONT_SCALES.map(value => <option key={value} value={value}>{value}%</option>)}
                                </select>
                            </div>
                            <div className="settings-font-preview">
                                <span style={fontVarsForConfig(localConfig)}>{t('settings.font_preview')}</span>
                                <small>{t('settings.font_preview_hint')}</small>
                            </div>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-motion-preference">{t('settings.motion.label')}</label>
                                <select id="settings-motion-preference" className="settings-select" value={localConfig.motion_preference} onChange={event => handleChange('motion_preference', event.target.value)}>
                                    {['system', 'full', 'reduced'].map(value => <option key={value} value={value}>{t(`settings.motion.${value}`)}</option>)}
                                </select>
                            </div>
                        </fieldset>
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.notifications')}</legend>
                            <label className="settings-check-row settings-switch-row" htmlFor="settings-play-sound">
                                <button
                                    id="settings-play-sound"
                                    type="button"
                                    role="switch"
                                    className="settings-provider-switch"
                                    aria-label={t('play_sound')}
                                    aria-checked={Boolean(localConfig.play_sound)}
                                    onClick={() => handleChange('play_sound', !localConfig.play_sound)}
                                >
                                    <span aria-hidden="true" />
                                </button>
                                <span><strong>{t('play_sound')}</strong></span>
                            </label>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-sound">{t('sound_lbl')}</label>
                                <div className="settings-inline-control">
                                    <select id="settings-sound"
                                        className="settings-select"
                                        disabled={!localConfig.play_sound}
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
                        </fieldset>
                        <SettingsDataFolder t={t} />
                    </div>
                )}

                {activeTab === 'processing' && (
                    <div className="settings-panel">
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.output')}</legend>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-target-format">{t('format_lbl')}</label>
                                <select id="settings-target-format" className="settings-select" value={localConfig.target_format || 'none'} onChange={event => handleChange('target_format', event.target.value)}>
                                    {FORMAT_KEYS.map((key, index) => <option key={key} value={key}>{formatLabels[index] || key.toUpperCase()}</option>)}
                                </select>
                            </div>
                            {renderSwitch('backup_on', t('backup'))}
                            {renderSwitch('flatten_folders', t('flatten'), t('flatten_desc'))}
                            {renderSwitch('pass_skip_meta', t('opt_pass_skip_meta'), t('opt_pass_skip_meta_tip'))}
                        </fieldset>
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.images')}</legend>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-img-quality">{t('common_quality')}</label>
                                <div className="settings-slider-control">
                                    <input id="settings-img-quality" aria-describedby="settings-quality-help" type="range" min="1" max="100" value={localConfig.img_quality || 100} onChange={event => handleChange('img_quality', Number(event.target.value))} />
                                    <output htmlFor="settings-img-quality">{localConfig.img_quality || 100}%{Number(localConfig.img_quality) === 100 ? ` (${label('quality_lossless', '무손실')})` : ''}</output>
                                </div>
                            </div>
                            <p className="settings-help" id="settings-quality-help">{t('tt_img_quality_desc')}</p>

                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-renamer-compression">{label('renamer_archive_compression_lbl', '재압축 강도 :')}</label>
                                <select id="settings-renamer-compression"
                                    aria-describedby="settings-compression-help"
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
                            <p className="settings-help" id="settings-compression-help">{label('renamer_archive_compression_desc', '내부 파일명 변경에서 다시 압축할 때만 적용됩니다. 빠름은 속도 우선, 최대 압축은 용량 우선입니다.')}</p>

                            {renderSwitch('webp_conversion', t('webp'), label('webp_desc', '모든 이미지를 고효율 WebP 포맷으로 변환하여 압축자 호환성을 보장합니다.'))}
                        </fieldset>
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.performance')}</legend>
                            <div className="settings-row settings-control-field">
                                <label className="settings-label" htmlFor="settings-max-threads">{t('max_threads')}</label>
                                <div className="settings-slider-control">
                                    <input id="settings-max-threads"
                                        aria-describedby="settings-threads-help"
                                        type="range"
                                        min="1"
                                        max={threadMax}
                                        value={Math.min(threadMax, Number(localConfig.max_threads) || 1)}
                                        onChange={event => handleChange('max_threads', Number(event.target.value))}
                                    />
                                    <output htmlFor="settings-max-threads">{t('settings.cores').replace('{count}', Math.min(threadMax, Number(localConfig.max_threads) || 1))}</output>
                                </div>
                            </div>
                            <p className="settings-notice" id="settings-threads-help">
                                <FaIcon name="info" />
                                <span>{t('settings.threads_description').replace('{count}', threadMax)}</span>
                            </p>
                            {renderSwitch('hardware_acceleration', t('hardware_acceleration'), t('hardware_acceleration_desc'))}
                        </fieldset>
                    </div>
                )}

                {activeTab === 'viewer' && (
                    <div className="settings-panel">
                        <fieldset className="settings-fieldset">
                            <legend>{t('settings.sections.viewers')}</legend>
                            <p className="settings-help">{t('settings.viewer_hint')}</p>
                            {VIEWER_PROGRAM_TYPES.map(option => (
                                <div className="settings-viewer-field" key={option.key}>
                                    <div className="settings-row settings-control-field">
                                        <label className="settings-label" htmlFor={`settings-viewer-${option.key}`}>{label(option.labelKey, option.fallback)}</label>
                                        <div className="settings-path-row">
                                            <input
                                                id={`settings-viewer-${option.key}`}
                                                aria-describedby={option.descriptionKey ? `settings-viewer-${option.key}-help` : undefined}
                                                className="settings-input"
                                                title={localConfig.viewer_paths?.[option.key] || ''}
                                                value={localConfig.viewer_paths?.[option.key] || ''}
                                                placeholder={label('viewer_placeholder', '뷰어 프로그램 경로를 선택하세요')}
                                                readOnly
                                            />
                                            <button className="settings-action-btn" aria-label={`${label(option.labelKey, option.fallback)} ${label('btn_find', '찾기')}`} onClick={() => handleSelectViewer(option.key)}>{label('btn_find', '찾기')}</button>
                                            <button
                                                className="settings-action-btn"
                                                aria-label={`${label(option.labelKey, option.fallback)} ${label('btn_remove', '삭제')}`}
                                                onClick={() => handleClearViewer(option.key)}
                                                disabled={!localConfig.viewer_paths?.[option.key]}
                                            >
                                                {label('btn_remove', '삭제')}
                                            </button>
                                        </div>
                                    </div>
                                    {option.descriptionKey && <p className="settings-help" id={`settings-viewer-${option.key}-help`}>
                                        {label(option.descriptionKey, option.descriptionFallback)}
                                    </p>}
                                </div>
                            ))}
                        </fieldset>
                        <fieldset className="settings-fieldset settings-file-association-fieldset">
                            <legend>{label('file_association_title', '파일 연결')}</legend>
                            <p className="settings-notice">
                                <FaIcon name="info" />
                                <span>{t('settings.immediate_note')}</span>
                            </p>
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
                <div className="settings-library-layout">
                    <div className="settings-library-workspace">
                        <div className="settings-library-editing">
                            <div className="settings-library-toolbar">
                                <h3>{t('settings.library_preview.registered')}</h3>
                                <button className="settings-action-btn settings-blue-btn" onClick={handleAddDupFolder}>
                                    <FaIcon name="folderPlus" />{label('btn_add', '추가')}
                                </button>
                            </div>
                            <SettingsLibraryList
                                entries={libraryEntries}
                                selectedPath={selectedDupFolder}
                                onSelect={setSelectedDupFolder}
                                onRemove={handleRemoveDupFolder}
                                onChange={updateLibraryEntries}
                                t={t}
                            />
                        </div>
                        <SettingsLibraryPreview
                            entries={libraryEntries}
                            selectedPath={selectedDupFolder}
                            onSelect={setSelectedDupFolder}
                            config={localConfig}
                            t={t}
                        />
                    </div>
                </div>
              </fieldset>
              <fieldset className="settings-fieldset">
              <legend>{label('settings_maintenance_title', '인덱스 및 캐시 관리')}</legend>
                    <p className="settings-notice">
                        <FaIcon name="info" />
                        <span>{t('settings.immediate_note')}</span>
                    </p>
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
            <div className="settings-panel" id="settings-api-content" role="region" aria-labelledby={`settings-api-section-${activeApiSection}`}>
              {activeApiSection === 'preferred' && (
              <fieldset className="settings-fieldset">
              <legend>{label('preferred_search_api_group', '자주 사용하는 검색 API')}</legend>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-preferred-comic">{label('preferred_search_api_comic', '만화책')}</label>
                <select id="settings-preferred-comic"
                  className="settings-select"
                  value={preferredComicApi}
                  onChange={event => handleChange('preferred_meta_api_comic', event.target.value)}
                >
                  {metadataSearchSourcesForBookType('comic', localConfig.metadata_api_enabled).map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-preferred-book">{label('preferred_search_api_book', '전자책')}</label>
                <select id="settings-preferred-book"
                  className="settings-select"
                  value={preferredBookApi}
                  onChange={event => handleChange('preferred_meta_api_book', event.target.value)}
                >
                  {metadataSearchSourcesForBookType('book', localConfig.metadata_api_enabled).map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-preferred-pdf">{label('preferred_search_api_pdf', 'PDF')}</label>
                <select id="settings-preferred-pdf"
                  className="settings-select"
                  value={preferredPdfApi}
                  onChange={event => handleChange('preferred_meta_api_pdf', event.target.value)}
                >
                  {metadataSearchSourcesForBookType('pdf', localConfig.metadata_api_enabled).map(source => (
                    <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                  ))}
                </select>
              </div>
                <div className="settings-row settings-control-field">
                    <label className="settings-label" htmlFor="settings-preferred-audio">{t('preferred_search_api_audio')}</label>
                    <select id="settings-preferred-audio" className="settings-select" value={preferredAudioApi}
                        onChange={event => handleChange('preferred_meta_api_audio', event.target.value)}>
                        {metadataSearchSourcesForBookType('audio', localConfig.metadata_api_enabled).map(source => (
                            <option key={source.value} value={source.value}>{apiSourceLabel(source)}</option>
                        ))}
                    </select>
                </div>
              <p className="settings-help">{label('preferred_search_api_desc', '선택한 값은 메타데이터 관리의 검색 API 드롭다운 기본값으로 사용됩니다.')}</p>
              </fieldset>
              )}

              {activeApiSection === 'providers' && <>
                <div className="settings-provider-toolbar settings-api-manual-row">
                    <p className="settings-help">{t('metadata_provider_enabled_help')}</p>
                    <button type="button" className="settings-action-btn settings-blue-btn" onClick={() => setShowApiManual(true)}>
                        <FaIcon name="bookOpen" />{label('btn_api_manual', '검색 소스 설정 안내')}
                    </button>
                </div>
                {METADATA_PROVIDER_GROUPS.map(group => (
                    <section key={group.id} className="settings-provider-group" aria-labelledby={`settings-provider-group-${group.id}`}>
                        <h3 id={`settings-provider-group-${group.id}`} className="settings-provider-group-title">{t(group.labelKey)}</h3>
                        <div className="settings-provider-list">
                            {group.sources.map(source => {
                                const enabled = isMetadataApiSourceEnabled(source.value, localConfig.metadata_api_enabled);
                                const key = requiredApiKeyForSource(source.value);
                                const ready = apiSourceHasRequiredKey(source.value, localConfig.api_keys);
                                const hasSettings = ['알라딘', 'Hardcover', 'iTunes', 'Kobo', 'Audible'].includes(source.value);
                                const descriptionKey = source.labelKey.replace('api_source_', 'metadata_provider_description_');
                                const descriptionId = `settings-${descriptionKey}`;
                                return (
                                    <article key={source.value} className={`settings-provider-card${enabled ? '' : ' is-disabled'}`} data-provider={source.value}>
                                        <div className={`settings-provider-header${key ? ' has-key' : ''}`}>
                                            <div className="settings-provider-copy">
                                                <h4>{apiSourceLabel(source)}</h4>
                                                {enabled && !ready && <span className="settings-provider-status is-setup_required">{t('metadata_provider_setup_required')}</span>}
                                            </div>
                                            {key && renderSecretInput(key, key === 'yes24' ? 'yk_live_...' : '', false,
                                                key === 'aladin' ? 'TTBKey' : key === 'hardcover' ? 'API Token' : 'API Key')}
                                            <button type="button" role="switch" className="settings-provider-switch"
                                                aria-label={apiSourceLabel(source)} aria-checked={enabled} aria-describedby={descriptionId}
                                                onClick={() => handleProviderEnabledChange(source.value, !enabled)}>
                                                <span aria-hidden="true" />
                                            </button>
                                        </div>
                                        <p id={descriptionId} className="settings-provider-description">{t(descriptionKey)}</p>
                                        {hasSettings && (
                                            <div className="settings-provider-fields">{renderProviderSettings(source)}</div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                ))}
                <p className="settings-help">{t('metadata_provider_region_help')}</p>
                <p className="settings-help">{t('metadata_provider_unofficial_help')}</p>
              </>}

              {activeApiSection === 'ai' && (
              <fieldset className="settings-fieldset">
              <legend>{t('ai_cover_search_group')}</legend>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-ai-provider">{t('ai_provider')}</label>
                <select id="settings-ai-provider" className="settings-select" value={aiProvider} onChange={event => handleApiChange('ai_provider', event.target.value)}>
                  <option value="Gemini">Gemini</option>
                  <option value="OpenAI">OpenAI</option>
                </select>
              </div>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor={`settings-secret-${aiKeyField}`}>{t('ai_api_key')}</label>
                {renderSecretInput(
                  aiKeyField,
                  aiProvider === 'OpenAI' ? 'OpenAI API Key (sk-...)' : 'Gemini API Key (AIza...)'
                )}
              </div>
              <p className="settings-help">{t('ai_cover_search_notice')}</p>
              </fieldset>
              )}

              {activeApiSection === 'tags' && (
              <fieldset className="settings-fieldset settings-tag-fieldset">
              <legend>{t('tag_rules_group')}</legend>
              <p className="settings-help" id="settings-tag-rules-help">{t('tag_rules_desc')}</p>
              <textarea
                aria-label={t('tag_rules_group')}
                aria-describedby="settings-tag-rules-help"
                className="settings-textarea"
                value={localConfig.api_keys?.tag_rules || ''}
                placeholder={label('tag_rules_placeholder', 'Shounen, 소년만화 -> 소년\nAction -> 액션')}
                onChange={event => handleApiChange('tag_rules', event.target.value)}
              />
              </fieldset>
              )}
              {activeApiSection === 'cache' && (
              <fieldset className="settings-fieldset">
              <legend>{t('settings.sections.search_cache')}</legend>
              <p className="settings-notice">
                  <FaIcon name="info" />
                  <span>{t('settings.immediate_note')}</span>
              </p>
              <div className="settings-maintenance-actions">
                <button className="settings-action-btn settings-danger-btn" onClick={handleClearApiCache} disabled={Boolean(maintenanceBusy)}>
                  <FaIcon name="trash" />
                  {maintenanceBusy === 'api-cache' ? label('cache_clearing', '초기화 중...') : label('btn_clear_cache', '검색 캐시 비우기')}
                </button>
              </div>
              </fieldset>
              )}
            </div>
          )}

          {activeTab === 'ttsApi' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset">
              <legend>{label('tts_supertonic_group', 'Supertonic 3 (로컬)')}</legend>
                    {!supertonicStatus.installed && (
                        <p className="settings-notice">
                            <FaIcon name="info" />
                            <span>{t('settings.tts.install_note')}</span>
                        </p>
                    )}
              <p className="settings-help">{label('tts_supertonic_desc', '낭독할 텍스트를 외부로 보내지 않고 기기에서 음성을 생성합니다. 최초 모델 설치에는 인터넷 연결이 필요합니다.')}</p>
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
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-secret-tts_openai_key">{label('tts_openai_api_key', 'OpenAI TTS API Key')}</label>
                {renderSecretInput('tts_openai_key', 'OpenAI API Key (sk-...)')}
              </div>
              <div className="settings-row settings-control-field">
                <label className="settings-label" htmlFor="settings-secret-tts_google_key">{label('tts_google_api_key', 'Google TTS 인증 정보')}</label>
                {renderSecretInput('tts_google_key', 'Google service account JSON or JSON file path')}
              </div>
              <p className="settings-help">{label('tts_google_credential_notice', 'BookManager의 Google TTS를 사용하려면 서비스 계정 JSON 내용 또는 해당 파일 경로를 입력하세요.')}</p>
              <p className="settings-help">{label('tts_api_notice', '음성 읽기에 사용하는 인증 정보이며, AI 표지 제목 검색과는 별도 항목으로 저장됩니다.')}</p>
              </fieldset>
            </div>
          )}
                {activeTab === 'privacy' && (
                    <div className="settings-panel">
                        <TelemetrySettings config={localConfig} onChange={handleChange} />
                    </div>
                )}
                {activeTab === 'licenses' && <LicenseSettings t={t} />}
            </div>
                {displayedLibraryEntry && (
                    <div
                        ref={libraryEditorRef}
                        className={`settings-library-editor${libraryEditorExpanded ? ' is-open' : ''}`}
                        role="group"
                        aria-label={label('settings_library_edit', '수정')}
                        aria-hidden={!libraryEditorOpen}
                        inert={libraryEditorOpen ? undefined : ''}
                        onTransitionEnd={event => {
                            if (event.target === event.currentTarget && event.propertyName === 'transform' && !libraryEditorOpen) {
                                setLibraryEditorMounted(false);
                            }
                        }}
                    >
                        <div className="settings-library-editor-heading">
                            <div className="settings-library-editor-path" title={displayedLibraryEntry.path}>
                                <span>{label('settings_library_path', '경로')}</span>
                                <strong>{displayedLibraryEntry.path}</strong>
                            </div>
                            <button type="button" className="settings-library-editor-close" aria-label={t('btn_close')} title={t('btn_close')}
                                onClick={() => {
                                    setSelectedDupFolder('');
                                    settingsBodyRef.current?.focus({ preventScroll: true });
                                }}>
                                <FaIcon name="xmark" />
                            </button>
                        </div>
                        <div className="settings-library-editor-fields">
                            <label className="settings-control-field">
                                <span className="settings-field-label">{label('settings_library_alias', '별칭')}</span>
                                <input
                                    id="settings-library-alias"
                                    className="settings-input"
                                    value={displayedLibraryEntry.alias}
                                    placeholder={label('settings_library_alias_ph', '라이브러리에 표시할 이름')}
                                    onChange={event => handleLibraryEntryChange(displayedLibraryEntry.path, 'alias', event.target.value)}
                                />
                            </label>
                            <label className="settings-control-field">
                                <span className="settings-field-label">{label('settings_library_group', '그룹')}</span>
                                <input
                                    id="settings-library-group"
                                    className="settings-input"
                                    value={displayedLibraryEntry.group}
                                    placeholder={label('settings_library_group_ph', '예: NAS, 로컬, 작업용')}
                                    onChange={event => handleLibraryEntryChange(displayedLibraryEntry.path, 'group', event.target.value)}
                                />
                            </label>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {maintenanceMessage && (
          <div className="settings-maintenance-message" role="status">{maintenanceMessage}</div>
        )}

        <div className="modal-footer settings-footer" inert={showApiManual ? '' : undefined}>
            <p className="settings-save-note">{t('settings.save_note')}</p>
            <div className="settings-footer-actions">
                <button className="btn btn-secondary" onClick={handleCancel} disabled={isApplying}>{t('btn_cancel')}</button>
                <button className="btn btn-primary" onClick={handleApply} disabled={!hasChanges || isApplying || Boolean(fileAssociationBusy)} aria-busy={isApplying}>{t('settings.apply')}</button>
            </div>
        </div>
        {showApiManual && (
          <div className="settings-manual-backdrop" onClick={() => setShowApiManual(false)}>
            <div ref={manualDialogRef} className="settings-manual-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-manual-title" tabIndex={-1} onClick={event => event.stopPropagation()}>
              <h3 id="settings-manual-title">{label('api_manual_title', 'API 발급 매뉴얼')}</h3>
                <button onClick={() => window.electronAPI?.openExternal?.('https://developers.yes24.com/docs/apikey')}>YES24 OpenAPI</button>
              <button onClick={() => window.electronAPI?.openExternal?.('https://blog.aladin.co.kr/openapi')}>Aladin OpenAPI</button>
              <button onClick={() => window.electronAPI?.openExternal?.('https://comicvine.gamespot.com/api/')}>Comic Vine API</button>
              <button onClick={() => window.electronAPI?.openExternal?.('https://console.cloud.google.com/')}>Google Cloud Console</button>
                {METADATA_PROVIDER_GUIDES.map(provider => (
                    <section key={provider.key} className="settings-provider-guide">
                        <h4>{provider.name}</h4>
                        <p className="settings-help">{t(`metadata_provider_guide_${provider.key}`)}</p>
                        <button type="button" onClick={() => window.electronAPI?.openExternal?.(provider.url)}>
                            {provider.name} · {t('metadata_provider_open_guide')}
                        </button>
                    </section>
                ))}
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
