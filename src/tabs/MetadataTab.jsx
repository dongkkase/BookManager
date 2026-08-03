import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { BookMetadataEditor } from '../components/metadata/BookMetadataEditor';
import { ComicMetadataEditor } from '../components/metadata/ComicMetadataEditor';
import { PdfMetadataEditor } from '../components/metadata/PdfMetadataEditor';
import { ResultLogDialog } from '../components/ResultLogDialog';
import { createToolbarState, emitToolbarState } from '../toolbarState';
import { emitStatusState } from '../statusState';
import {
    adjacentSelectionAfterRemoval,
    applyBatchMetadataFields,
    applyCombinedGenreTagsValue,
    applyInferredMetadataField,
    applySeriesAutoMetadata,
    clampMetadataNumber,
    cleanMetadataSummary,
    combinedGenreTagsValue,
    formatMetadataModifiedDate,
    inferMetadataFromArchiveName,
    isDecimalMetadataField,
    normalizeMetadataAutoNumber,
    normalizeMetadataDecimal,
    splitCombinedGenreTags,
} from '../metadataPolicy';
import { splitMetadataFileDisplayName } from '../metadataFilename';
import '../styles/MetadataTab.css';
import { DRAG_DROP_IMAGES, selectRandomResource } from '../resourcePolicy';
import { shouldPlayCompletionSound } from '../completionSoundPolicy';
import {
  hasPrimaryModifier as hasPlatformPrimaryModifier,
  primaryModifierLabel,
  isTextEntryTarget,
} from '../interactionPolicy';
import { partitionSkippedFiles } from '../notificationPolicy';
import {
  ALL_METADATA_API_SOURCES,
  apiSourceHasRequiredKey,
  metadataApiSourcesForBookType,
  metadataFromApiResult,
  preferredMetadataApiSource,
} from '../metadataApiPolicy';
import {
  BOOK_BASIC_FIELDS,
  BOOK_CREATOR_FIELDS,
  BOOK_META_FIELD_IDS,
  BOOK_META_FIELDS,
  BOOK_OTHER_FIELDS,
  BOOK_PUBLISHER_FIELDS,
  BOOK_SEARCHABLE_SELECT_FIELDS,
  BOOK_SECTION_TABS,
} from '../metadata/bookMetadataFields';
import {
  PDF_BASIC_FIELDS,
  PDF_DOCUMENT_FIELDS,
  PDF_META_FIELD_IDS,
  PDF_META_FIELDS,
  PDF_PUBLISHER_FIELDS,
  PDF_RIGHTS_FIELDS,
  PDF_SEARCHABLE_SELECT_FIELDS,
  PDF_SECTION_TABS,
} from '../metadata/pdfMetadataFields';
import {
  BASIC_FIELDS,
  CREATOR_FIELDS,
  META_FIELD_IDS,
  META_FIELDS,
  OTHER_FIELDS,
  PUBLISHER_FIELDS,
  SEARCHABLE_SELECT_FIELDS,
  SECTION_TABS,
} from '../metadata/comicMetadataFields';
import { resolveBookType } from '../metadata/metadataTypes';

const DEFAULT_GENRE_OPTIONS = [
  '액션', '모험', '코미디', '드라마', '판타지',
  'SF', '미스터리', '공포', '스릴러', '심리',
  '로맨스', '일상', '학원', '스포츠', '역사',
  '군사', '범죄', '추리', '초자연', '마법',
  '이세계', '포스트 아포칼립스', '사이버펑크', '메카', '무협',
  '사무라이', '닌자', '요리', '의료', '음악',
  '게임', '도박', '생존', '비극', '패러디',
];

const DEFAULT_TAG_OPTIONS = [
  '복수', '토너먼트', '퀘스트', '여행', '수사',
  '변치 작전', '생존', '시간 여행', '타임 루프', '평행세계',
  '환생', '회귀', '빙의', '안티히어로', '악역 주인공',
  '천재 주인공', '먼치킨', '약자 성장형', '선택받은 자', '스승',
  '라이벌', '팀워크', '의형제', '가족', '마법 체계',
  '길드', '던전', '아카데미', '왕국', '제국',
  '수련', '무림', '멸망 세계', '사이보그', '우주 여행',
  '우정', '배신', '삼각관계', '짝사랑',
];

const METADATA_COVER_CACHE_LIMIT = 50;

function isMetadataTextInput(target) {
  return isTextEntryTarget(target);
}

function shortcutCode(event) {
  if (/^Key[A-Z]$/.test(event.code || '')) return event.code;
  return `Key${String(event.key || '').toUpperCase()}`;
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

function hasPrimaryModifier(event) {
  return hasPlatformPrimaryModifier(event, isMacPlatform() ? 'MacIntel' : 'Win32');
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    const group = item.group || 'Files';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  return [...groups.entries()].map(([name, children]) => ({ name, children }));
}

function metadataTreeNodeKey(node) {
  if (!node) return '';
  return node.type === 'group' ? `group:${node.groupName}` : `file:${node.id}`;
}

function metadataTreeVisibleNodes(groupedItems, collapsedGroups) {
  return groupedItems.flatMap(group => {
    const groupNode = { type: 'group', groupName: group.name };
    if (collapsedGroups.has(group.name)) return [groupNode];
    return [
      groupNode,
      ...group.children.map(file => ({
        type: 'file',
        id: file.id,
        groupName: group.name,
      })),
    ];
  });
}

function isMetadataTreeTarget(target) {
  return Boolean(target?.closest?.('.meta-left-panel'));
}

function metadataModifiedDate(item) {
  const value = item?.metadata?.ComicZipModifiedDate
    || item?.metadata?.PdfMetadataDate
    || item?.metadata?.PdfModifyDate;
  return formatMetadataModifiedDate(value, 'No Data');
}

function uniqueSelectOptions(options = [], currentValue = '') {
  const values = new Set();
  for (const option of options) values.add(String(option ?? ''));
  values.add(String(currentValue ?? ''));
  return [...values];
}

function isSearchableSelectField(fieldId, bookType = 'comic') {
  if (bookType === 'pdf') return PDF_SEARCHABLE_SELECT_FIELDS.has(fieldId);
  if (bookType === 'book') return BOOK_SEARCHABLE_SELECT_FIELDS.has(fieldId);
  return SEARCHABLE_SELECT_FIELDS.has(fieldId);
}

function AutoHeightTextarea({ className = 'meta-input', value = '', onChange }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.max(80, node.scrollHeight)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={`${className} meta-auto-height-textarea`}
      value={value || ''}
      onChange={event => onChange(event.target.value)}
    />
  );
}

function splitTagValues(value = '') {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function joinTagValues(values = []) {
  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const tag = String(value || '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags.join(', ');
}

function pickMetadataFields(metadata = {}, fieldIds = [], extraFieldIds = []) {
  const allowed = new Set([...fieldIds, ...extraFieldIds]);
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => allowed.has(key)),
  );
}

function trimMetadataCoverCache(items = [], activeFilePath = '') {
  const withCovers = items.filter(item => item.coverDataUrl);
  if (withCovers.length <= METADATA_COVER_CACHE_LIMIT) return items;

  const keep = new Set(
    [...withCovers]
      .sort((left, right) => {
        if (left.filepath === activeFilePath) return -1;
        if (right.filepath === activeFilePath) return 1;
        return (right.coverLoadedAt || 0) - (left.coverLoadedAt || 0);
      })
      .slice(0, METADATA_COVER_CACHE_LIMIT)
      .map(item => item.filepath),
  );

  return items.map(item => {
    if (!item.coverDataUrl || keep.has(item.filepath)) return item;
    const { coverDataUrl, coverLoadedAt, epubCoverResolution, ...rest } = item;
    return rest;
  });
}

function fileNameFromPath(filePath = '') {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || String(filePath || '');
}

function apiResultCoverUrl(result = {}) {
  return result?.coverUrl
    || result?.CoverUrl
    || result?.coverCacheUrl
    || result?.coverDataUrl
    || result?.metadata?.coverUrl
    || result?.metadata?.CoverUrl
    || result?.metadata?.coverCacheUrl
    || result?.metadata?.coverDataUrl
    || '';
}

function ridiOriginalCoverUrl(result = {}, fallbackUrl = '') {
  const directId = String(result?.b_id || result?.id || result?.metadata?.b_id || result?.metadata?.id || '').match(/\d+/)?.[0];
  const linkId = String(result?.Web || result?.link || result?.metadata?.Web || result?.metadata?.link || '').match(/\/books\/(\d+)/)?.[1];
  const coverId = String(fallbackUrl || '').match(/\/cover\/(\d+)/)?.[1];
  const id = directId || linkId || coverId;
  return id ? `https://img.ridicdn.net/cover/${id}/xxlarge?dpi=xxhdpi#1` : '';
}

function apiResultCoverUrlForUse(result = {}, apiSource = '') {
  const coverUrl = apiResultCoverUrl(result);
  if (apiSource === '리디북스') return ridiOriginalCoverUrl(result, coverUrl) || coverUrl;
  return coverUrl;
}

function isEpubFilePath(filePath = '') {
  return /\.epub$/i.test(String(filePath || '').trim());
}

const LANGUAGE_LABELS = {
  ko: '한국어 (ko)',
  en: 'English (en)',
  ja: '日本語 (ja)',
  zh: '中文 (zh)',
  'zh-CN': '简体中文 (zh-CN)',
  'zh-TW': '繁體中文 (zh-TW)',
  fr: 'Français (fr)',
  de: 'Deutsch (de)',
  es: 'Español (es)',
};

function languageIsoFromConfig(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('ko')) return 'ko';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('zh-cn')) return 'zh-CN';
  if (normalized.startsWith('zh-tw')) return 'zh-TW';
  if (normalized.startsWith('zh')) return 'zh';
  return normalized || 'ko';
}

function similarity(a = '', b = '') {
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftSet = new Set(left.split(/\s+/).filter(Boolean));
  const rightSet = new Set(right.split(/\s+/).filter(Boolean));
  let hits = 0;
  for (const token of leftSet) if (rightSet.has(token)) hits += 1;
  return hits / Math.max(leftSet.size, rightSet.size, 1);
}

function MetadataTab({ config, t, showToast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bookmanager:tab-ready', { detail: { tabId: 'metadata' } }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const initialApiSource = preferredMetadataApiSource(config, 'comic');
  const dragDropImage = useMemo(() => selectRandomResource(DRAG_DROP_IMAGES), []);
  const [fileList, setFileList] = useState([]);
  const saveLockRef = useRef(false);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const treeContainerRef = useRef(null);
  const metadataTreeKeyboardActiveRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [apiSource, setApiSource] = useState(initialApiSource);
  const [applyEmpty, setApplyEmpty] = useState(false);
  const [activeSection, setActiveSection] = useState('basic');
  const [batchMetadataByFileId, setBatchMetadataByFileId] = useState({});
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [publisherOptions, setPublisherOptions] = useState([]);
  const [apiSearch, setApiSearch] = useState({ open: false, loading: false, results: [], error: '', actualQuery: '', page: 1, apiSource: initialApiSource, query: '', cached: false });
  const [taskPhase, setTaskPhase] = useState('idle');
  const primaryShortcut = primaryModifierLabel(isMacPlatform() ? 'MacIntel' : 'Win32');
  const formScrollRef = useRef(null);
  const sectionRefs = useRef({});
  const coverLoadRequestsRef = useRef(new Set());
  const [epubImagesByFilePath, setEpubImagesByFilePath] = useState({});
  const batchMetadata = useMemo(
    () => selectedFileId ? (batchMetadataByFileId[selectedFileId] || {}) : {},
    [batchMetadataByFileId, selectedFileId],
  );
  const setBatchMetadata = useCallback((updater) => {
    if (!selectedFileId) return;
    setBatchMetadataByFileId(prev => {
      const current = prev[selectedFileId] || {};
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [selectedFileId]: next || {} };
    });
  }, [selectedFileId]);
  const language = config?.language || config?.lang || 'ko';
  const defaultLanguageISO = useMemo(
    () => languageIsoFromConfig(config?.language || config?.lang || 'ko'),
    [config?.language, config?.lang],
  );
  const text = useCallback((key, fallback, values) => {
    const translated = t?.(key, values);
    return translated && translated !== key ? translated : fallback;
  }, [t]);
  const apiSourceLabel = useCallback((source) => {
    const entry = ALL_METADATA_API_SOURCES.find(item => item.value === source);
    return entry ? text(entry.labelKey, entry.value) : source;
  }, [text]);
  const localizedOptions = useCallback((key, fallback) => {
    const translated = t?.(key);
    return translated && typeof translated === 'object' && !Array.isArray(translated)
      ? Object.values(translated)
      : fallback;
  }, [t]);
  const genreOptions = useMemo(() => localizedOptions('meta_genres', DEFAULT_GENRE_OPTIONS), [localizedOptions]);
  const tagOptions = useMemo(() => localizedOptions('meta_tags', DEFAULT_TAG_OPTIONS), [localizedOptions]);
  const combinedTagOptions = useMemo(
    () => uniqueSelectOptions([...genreOptions, ...tagOptions], '').filter(Boolean),
    [genreOptions, tagOptions],
  );
  const seriesGroupOptions = useMemo(() => {
    const values = new Set(['']);
    for (const item of fileList) {
      const value = String(item.metadata?.SeriesGroup || '').trim();
      if (value) values.add(value);
    }
    const batchValue = String(batchMetadata.SeriesGroup || '').trim();
    if (batchValue) values.add(batchValue);
    return [...values];
  }, [batchMetadata.SeriesGroup, fileList]);
  const publisherSelectOptions = useMemo(() => {
    const values = new Set();
    for (const option of publisherOptions) {
      const value = String(option || '').trim();
      if (value) values.add(value);
    }
    for (const item of fileList) {
      const value = String(item.metadata?.Publisher || '').trim();
      if (value) values.add(value);
    }
    const batchValue = String(batchMetadata.Publisher || '').trim();
    if (batchValue) values.add(batchValue);
    return [...values];
  }, [batchMetadata.Publisher, fileList, publisherOptions]);
  const fieldLabel = useCallback(field => text(field.labelKey, field.label || field.id), [text]);
  const sectionLabel = useCallback(section => text(section.labelKey, section.id), [text]);
  const optionLabel = useCallback((field, option) => {
    if (!option) return '';
    if (field.id === 'LanguageISO') return LANGUAGE_LABELS[option] || option;
    const key = field.id === 'Format'
      ? 'meta_formats'
      : field.id === 'AgeRating'
        ? 'meta_age'
        : field.id === 'Manga'
          ? 'meta_manga'
          : field.id === 'BlackAndWhite' ? 'meta_yes_no' : '';
    if (!key) return option;
    const translated = t?.(key);
    return translated && typeof translated === 'object' ? translated[option] || option : option;
  }, [t]);
  const tagRules = useMemo(() => {
    const rules = {};
    for (const line of String(config?.api_keys?.tag_rules || '').split(/\r?\n/)) {
      if (!line.includes('->')) continue;
      const [sources, target] = line.split('->');
      const mapped = String(target || '').trim();
      for (const source of sources.split(',')) {
        const key = source.trim().toLowerCase();
        if (key) rules[key] = mapped;
      }
    }
    return rules;
  }, [config?.api_keys?.tag_rules]);

  useEffect(() => {
    const removeProgress = window.electronAPI?.onTaskProgress?.((data) => {
      if (data?.task?.startsWith('metadata:')) {
        setProgress(data.progress ?? 0);
        if (data.message) setStatusMessage(data.message);
      }
    });
    return () => {
      if (typeof removeProgress === 'function') removeProgress();
    };
  }, []);

  const activeItem = useMemo(
    () => fileList.find(item => item.id === selectedFileId) || null,
    [fileList, selectedFileId]
  );

  useEffect(() => {
    const filePath = activeItem?.filepath;
    if (!filePath || activeItem.coverDataUrl || coverLoadRequestsRef.current.has(filePath)) return undefined;
    const loadMetadataCover = window.electronAPI?.loadMetadataCover;
    if (!loadMetadataCover) return undefined;

    let cancelled = false;
    coverLoadRequestsRef.current.add(filePath);
    loadMetadataCover(filePath)
      .then(coverDataUrl => {
        if (cancelled || !coverDataUrl) return;
        const coverLoadedAt = Date.now();
        setFileList(prev => trimMetadataCoverCache(prev.map(item => (
          item.filepath === filePath ? { ...item, coverDataUrl, coverLoadedAt } : item
        )), filePath));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeItem?.coverDataUrl, activeItem?.filepath]);

  const groupedItems = useMemo(() => groupItems(fileList), [fileList]);
  const visibleTreeNodes = useMemo(
    () => metadataTreeVisibleNodes(groupedItems, collapsedGroups),
    [groupedItems, collapsedGroups],
  );
  const selectedTreeKey = useMemo(
    () => selectedGroup ? `group:${selectedGroup}` : selectedFileId ? `file:${selectedFileId}` : '',
    [selectedFileId, selectedGroup],
  );
  const checkedCount = useMemo(() => fileList.filter(item => item.checked !== false).length, [fileList]);
  const allItemsChecked = useMemo(
    () => fileList.length > 0 && fileList.every(item => item.checked !== false),
    [fileList],
  );
  const activeBookType = useMemo(() => resolveBookType(activeItem || {}), [activeItem]);
  const activeIsEpub = isEpubFilePath(activeItem?.filepath || activeItem?.path || activeItem?.name);
  const activeEpubImageState = activeItem?.filepath ? epubImagesByFilePath[activeItem.filepath] || {} : {};
  const activeEpubImages = activeEpubImageState.images || [];
  const isSameActiveBookType = (item) => Boolean(activeItem) && resolveBookType(item || {}) === activeBookType;
  const currentApiSources = useMemo(() => metadataApiSourcesForBookType(activeBookType), [activeBookType]);
  const currentMetadataConfig = useMemo(() => (
    activeBookType === 'pdf'
      ? {
        sectionTabs: PDF_SECTION_TABS,
        metaFields: PDF_META_FIELDS,
        metaFieldIds: PDF_META_FIELD_IDS,
        fields: {
          basic: PDF_BASIC_FIELDS,
          publisher: PDF_PUBLISHER_FIELDS,
          document: PDF_DOCUMENT_FIELDS,
          rights: PDF_RIGHTS_FIELDS,
        },
      }
      : activeBookType === 'book'
      ? {
        sectionTabs: BOOK_SECTION_TABS,
        metaFields: BOOK_META_FIELDS,
        metaFieldIds: BOOK_META_FIELD_IDS,
        fields: {
          basic: BOOK_BASIC_FIELDS,
          creators: BOOK_CREATOR_FIELDS,
          publisher: BOOK_PUBLISHER_FIELDS,
          other: BOOK_OTHER_FIELDS,
        },
      }
      : {
        sectionTabs: SECTION_TABS,
        metaFields: META_FIELDS,
        metaFieldIds: META_FIELD_IDS,
        fields: {
          basic: BASIC_FIELDS,
          creators: CREATOR_FIELDS,
          publisher: PUBLISHER_FIELDS,
          other: OTHER_FIELDS,
        },
      }
  ), [activeBookType]);
  const currentSectionTabs = currentMetadataConfig.sectionTabs;
  const currentMetaFields = currentMetadataConfig.metaFields;
  const currentMetaFieldIds = currentMetadataConfig.metaFieldIds;
  const currentMetadataExtraFieldIds = activeBookType === 'comic'
    ? ['ComicZipAddedDate', 'ComicZipModifiedDate']
    : [];
  const selectApiSource = useCallback((nextSource) => {
    if (!nextSource) return;
    setApiSource(nextSource);
  }, []);

  useEffect(() => {
    emitToolbarState(
      'metadata',
      createToolbarState(fileList, item => item.checked !== false),
    );
  }, [fileList]);
  useEffect(() => {
    emitStatusState('metadata', {
      message: statusMessage,
      progress,
      phase: taskPhase,
      canRun: false,
    });
  }, [progress, statusMessage, taskPhase]);

  useEffect(() => {
    if (activeItem) setSearchQuery(activeItem.metadata?.Series || activeItem.metadata?.Title || activeItem.name.replace(/\.[^.]+$/, ''));
  }, [activeItem]);

  useEffect(() => {
    const filePath = activeItem?.filepath;
    if (activeBookType !== 'book' || !activeIsEpub || !filePath) return undefined;
    if (activeEpubImageState.loaded || activeEpubImageState.loading) return undefined;
    const listMetadataEpubImages = window.electronAPI?.listMetadataEpubImages;
    if (typeof listMetadataEpubImages !== 'function') return undefined;

    let cancelled = false;
    setEpubImagesByFilePath(prev => ({
      ...prev,
      [filePath]: {
        ...(prev[filePath] || {}),
        loading: true,
        error: '',
      },
    }));
    listMetadataEpubImages(filePath)
      .then(result => {
        if (cancelled) return;
        setEpubImagesByFilePath(prev => ({
          ...prev,
          [filePath]: {
            loading: false,
            loaded: true,
            error: '',
            images: result?.images || [],
            coverEntryName: result?.coverEntryName || '',
          },
        }));
      })
      .catch(error => {
        if (cancelled) return;
        setEpubImagesByFilePath(prev => ({
          ...prev,
          [filePath]: {
            ...(prev[filePath] || {}),
            loading: false,
            loaded: true,
            error: error.message || text('meta_epub_images_failed', 'EPUB 이미지 목록을 불러오지 못했습니다.'),
            images: [],
            coverEntryName: '',
          },
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeBookType,
    activeIsEpub,
    activeEpubImageState.loaded,
    activeEpubImageState.loading,
    activeItem?.filepath,
    text,
  ]);

  useEffect(() => {
    if (!selectedTreeKey || !treeContainerRef.current) return;
    const selectedElement = Array.from(treeContainerRef.current.querySelectorAll('[data-meta-tree-key]'))
      .find(element => element.dataset.metaTreeKey === selectedTreeKey);
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [selectedTreeKey]);

  useEffect(() => {
    const nextSource = preferredMetadataApiSource(config, activeBookType);
    if (!nextSource) return;
    setApiSource(nextSource);
    setApiSearch(prev => prev.open ? prev : { ...prev, apiSource: nextSource });
  }, [
    activeBookType,
    config?.api_keys,
    config?.last_meta_api,
    config?.preferred_meta_api_book,
    config?.preferred_meta_api_comic,
    config?.preferred_meta_api_pdf,
  ]);

  const updateItem = (id, updater) => {
    setFileList(prev => prev.map(item => item.id === id ? updater(item) : item));
  };

  const updateActiveMetadata = (field, value) => {
    if (!activeItem) return;
    updateItem(activeItem.id, item => ({
      ...item,
      metadata: {
        ...(item.metadata || {}),
        [field]: value,
      },
    }));
  };

  const updateBatchMetadata = (field, value) => {
    setBatchMetadata(prev => ({ ...prev, [field]: value }));
  };

  const analyzePaths = useCallback(async (paths) => {
    const cleanPaths = [...new Set((paths || []).filter(Boolean))];
    if (cleanPaths.length === 0) return;

    setIsWorking(true);
    setTaskPhase('analyzing');
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('t3_msg_analyzing'));
    coverLoadRequestsRef.current.clear();

    try {
      const result = await window.electronAPI.analyzeMetadata(cleanPaths, {
        lang: config?.language || config?.lang || 'ko',
        languageISO: defaultLanguageISO,
        includeCovers: false,
      });
      setPublisherOptions(prev => uniqueSelectOptions([...(result.publisherOptions || []), ...prev], '').filter(Boolean));
      const items = (result.items || []).map(item => ({
        ...item,
        metadata: {
          ...(item.metadata || {}),
          LanguageISO: item.metadata?.LanguageISO || defaultLanguageISO,
        },
      }));
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, item]));
        for (const item of items) byPath.set(item.filepath, item);
        return [...byPath.values()];
      });
      if (items[0]) setSelectedFileId(items[0].id);
      if (items[0]) setSelectedGroup('');
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_unsupported_format')}: ${result.skippedFiles.join(', ')}`);
        const skipped = partitionSkippedFiles(result.skippedFiles);
        if (skipped.nested.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_nested_archive')}${skipped.nested.join('\n')}`,
            language: config?.language || config?.lang || 'ko',
          });
        }
        if (skipped.unsupported.length > 0) {
          await window.electronAPI?.showMessage?.({
            type: 'warning',
            title: t('dlg_warn'),
            message: `${t('msg_unsupported_format')}${skipped.unsupported.join('\n')}`,
            language: config?.language || config?.lang || 'ko',
          });
        }
      } else {
        setStatusMessage(t('msg_done'));
      }
    } catch (error) {
      showToast?.(`${t('msg_failed')}: ${error.message}`);
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
      setTaskPhase('idle');
    }
  }, [config?.language, config?.lang, defaultLanguageISO, t]);

  const handleSelectFiles = useCallback(async () => {
    const paths = await window.electronAPI.selectArchives(t('add_file'));
    await analyzePaths(paths);
  }, [analyzePaths, t]);

  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder(t('add_folder'));
    if (folderPath) await analyzePaths([folderPath]);
  }, [analyzePaths, t]);

  const handleClear = useCallback(() => {
    setFileList([]);
    setSelectedFileId(null);
    setSelectedGroup('');
    setCollapsedGroups(new Set());
    setBatchMetadataByFileId({});
    setEpubImagesByFilePath({});
    setPublisherOptions([]);
    setLastResult(null);
    coverLoadRequestsRef.current.clear();
    setStatusMessage(t('status_wait'));
    setProgress(0);
  }, [t]);

  useEffect(() => {
    const handleReset = event => {
      if (event.detail?.tabs?.includes('metadata') && !isWorking) handleClear();
    };
    window.addEventListener('bookmanager:reset-task-tabs', handleReset);
    return () => window.removeEventListener('bookmanager:reset-task-tabs', handleReset);
  }, [handleClear, isWorking]);

  const handleRemoveChecked = useCallback(() => {
    setFileList(prev => {
      const removedIds = prev.filter(item => item.checked !== false).map(item => item.id);
      const next = prev.filter(item => item.checked === false);
      setSelectedFileId(adjacentSelectionAfterRemoval(prev, removedIds, selectedFileId));
      setSelectedGroup('');
      setBatchMetadataByFileId(batchPrev => {
        const batchNext = { ...batchPrev };
        for (const id of removedIds) delete batchNext[id];
        return batchNext;
      });
      return next;
    });
  }, [selectedFileId]);

  const handleToggleAllChecked = useCallback(() => {
    setFileList(prev => {
      const allChecked = prev.length > 0 && prev.every(item => item.checked !== false);
      return prev.map(item => ({ ...item, checked: allChecked ? false : true }));
    });
  }, []);

  const toggleGroupCollapsed = useCallback((groupName) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }, []);

  const setGroupCollapsed = useCallback((groupName, collapsed) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (collapsed) next.add(groupName);
      else next.delete(groupName);
      return next;
    });
  }, []);

  const activateMetadataTreeKeyboard = useCallback(() => {
    metadataTreeKeyboardActiveRef.current = true;
  }, []);

  const deactivateMetadataTreeKeyboard = useCallback(() => {
    metadataTreeKeyboardActiveRef.current = false;
  }, []);

  const focusMetadataTree = useCallback(() => {
    activateMetadataTreeKeyboard();
    treeContainerRef.current?.focus({ preventScroll: true });
  }, [activateMetadataTreeKeyboard]);

  const handleGroupClick = useCallback((groupName) => {
    focusMetadataTree();
    setSelectedGroup(groupName);
    setSelectedFileId(null);
    toggleGroupCollapsed(groupName);
  }, [focusMetadataTree, toggleGroupCollapsed]);

  const selectTreeNode = useCallback((node) => {
    if (!node) return;
    if (node.type === 'group') {
      setSelectedGroup(node.groupName);
      setSelectedFileId(null);
      return;
    }
    setSelectedGroup('');
    setSelectedFileId(node.id);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'metadata', isWorking },
    }));
    return () => window.dispatchEvent(new CustomEvent('bookmanager:working-state', {
      detail: { tabId: 'metadata', isWorking: false },
    }));
  }, [isWorking]);

  const handleCopyField = (fieldId) => {
    const value = batchMetadata[fieldId];
    if (!activeItem) return;
    if (!applyEmpty && (value === undefined || value === null || String(value).trim() === '')) return;
    updateActiveMetadata(fieldId, value || '');
  };

  const handleApplyBatchToActive = () => {
    if (!activeItem) return;
    updateItem(activeItem.id, item => {
      const metadata = { ...(item.metadata || {}) };
      for (const field of currentMetaFields) {
        const value = batchMetadata[field.id];
        if (applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '')) {
          metadata[field.id] = value || '';
        }
      }
      return { ...item, metadata };
    });
    showToast?.({ key: 't3_msg_applied_series_tag' });
  };

  const getCommaValues = splitTagValues;

  const toggleCommaValue = (target, fieldId, option) => {
    const source = target === 'batch' ? batchMetadata : activeItem?.metadata;
    const values = new Set(getCommaValues(source?.[fieldId]));
    if (values.has(option)) values.delete(option);
    else values.add(option);
    const nextValue = joinTagValues([...values]);
    if (target === 'batch') updateBatchMetadata(fieldId, nextValue);
    else updateActiveMetadata(fieldId, nextValue);
  };

  const handleApplyBatchToSeries = () => {
    const hasBatchData = currentMetaFields.some(field => {
      const value = batchMetadata[field.id];
      return applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '');
    });
    if (!hasBatchData) {
      showToast?.(t('t3_msg_no_data_copy'));
      return;
    }
    setFileList(prev => prev.map(item => {
      if (!activeItem || item.group !== activeItem.group || !isSameActiveBookType(item)) return item;
      const copiedMetadata = applyBatchMetadataFields(item.metadata || {}, batchMetadata, currentMetaFieldIds, applyEmpty);
      const inferred = inferTitleParts(item);
      return { ...item, metadata: applySeriesAutoMetadata(copiedMetadata, inferred) };
    }));
    showToast?.({ key: 't3_msg_applied_series_all' });
  };

  const handleCopyMyToBatch = () => {
    if (!activeItem) return;
    setBatchMetadata(pickMetadataFields(
      activeItem.metadata || {},
      currentMetaFieldIds,
      currentMetadataExtraFieldIds,
    ));
  };

  const handleResetActive = async () => {
    if (!activeItem) return;
    const response = await window.electronAPI?.showMessage?.({
      type: 'question',
      title: t('dlg_warn'),
      message: text('t3_msg_reset_series_confirm', '이 시리즈 전체의 메타데이터를 원래 상태로 초기화하시겠습니까?'),
      buttons: 'yes-no',
      defaultChoice: 'no',
      language,
    });
    if (response !== 'yes') return;
    setFileList(prev => prev.map(item => item.group === activeItem.group
      && isSameActiveBookType(item)
      ? { ...item, metadata: { ...(item.originalMetadata || {}) } }
      : item));
    showToast?.({ key: 't3_msg_reset_series_done' });
  };

  const applyMetadataToBatch = (metadata = {}) => {
    const normalized = pickMetadataFields(
      normalizeMetadata(metadata),
      currentMetaFieldIds,
      currentMetadataExtraFieldIds,
    );
    setBatchMetadata(prev => ({ ...prev, ...normalized }));
  };

  const applyMetadataToSeries = (metadata = {}) => {
    if (!activeItem) return;
    const normalized = pickMetadataFields(
      normalizeMetadata(metadata),
      currentMetaFieldIds,
      currentMetadataExtraFieldIds,
    );
    setFileList(prev => prev.map(item => item.group === activeItem.group && isSameActiveBookType(item) ? {
      ...item,
      metadata: applySeriesAutoMetadata(
        { ...(item.metadata || {}), ...normalized },
        inferTitleParts(item),
      ),
    } : item));
  };

  const normalizeTagText = useCallback((value) => {
    if (!value || Object.keys(tagRules).length === 0) return value || '';
    const next = [];
    for (const part of String(value).split(',')) {
      const original = part.trim();
      if (!original) continue;
      const mapped = tagRules[original.toLowerCase()] ?? original;
      if (mapped && !next.includes(mapped)) next.push(mapped);
    }
    return next.join(', ');
  }, [tagRules]);

  const normalizeMetadata = useCallback((metadata = {}) => {
    const normalized = {
      ...metadata,
      Genre: normalizeTagText(metadata.Genre),
      Tags: normalizeTagText(metadata.Tags),
    };
    if (metadata.Summary !== undefined || metadata.summary !== undefined) {
      normalized.Summary = cleanMetadataSummary(metadata.Summary ?? metadata.summary ?? '');
    }
    return normalized;
  }, [normalizeTagText]);

  const fetchMetadataResults = useCallback(async ({ source = apiSource, query = searchQuery, page = 1 } = {}) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return;
    selectApiSource(source);
    if (!apiSourceHasRequiredKey(source, config?.api_keys || {})) {
      setApiSearch(prev => ({
        ...prev,
        open: true,
        loading: false,
        results: [],
        error: text('api_key_missing', '환경설정에서 API 키를 입력해주세요.'),
        actualQuery: cleanQuery,
        query: cleanQuery,
        page,
        apiSource: source,
        cached: false,
      }));
      return;
    }
    setApiSearch(prev => ({
      ...prev,
      open: true,
      loading: true,
      results: [],
      error: '',
      actualQuery: cleanQuery,
      query: cleanQuery,
      page,
      apiSource: source,
      cached: false,
    }));
    try {
      const result = await window.electronAPI.fetchMetadata({
        apiSource: source,
        query: cleanQuery,
        page,
        bookType: activeBookType,
        apiKeys: config?.api_keys || {},
      });
      if (result?.success === false) {
        setApiSearch(prev => ({
          ...prev,
          open: true,
          loading: false,
          results: [],
          error: result.error || text('meta_search_failed', '검색에 실패했습니다.'),
          actualQuery: result.actualQuery || cleanQuery,
          query: cleanQuery,
          page,
          apiSource: source,
          cached: false,
        }));
        return;
      }
      const comparisonQuery = result.actualQuery || cleanQuery;
      const sortedResults = [...(result.results || [])].sort((a, b) => (
        similarity(comparisonQuery, b.title || b.metadata?.Title) - similarity(comparisonQuery, a.title || a.metadata?.Title)
      ));
      setApiSearch(prev => ({
        ...prev,
        open: true,
        loading: false,
        results: sortedResults,
        error: '',
        actualQuery: result.actualQuery || cleanQuery,
        query: cleanQuery,
        page,
        apiSource: source,
        cached: Boolean(result.cached),
      }));
    } catch (error) {
      setApiSearch(prev => ({
        ...prev,
        open: true,
        loading: false,
        results: [],
        error: error.message,
        actualQuery: cleanQuery,
        query: cleanQuery,
        page,
        apiSource: source,
        cached: false,
      }));
    }
  }, [activeBookType, apiSource, config?.api_keys, searchQuery, selectApiSource, text]);

  const handleSearchApi = async (page = 1) => {
    const query = searchQuery.trim();
    if (!query) {
      setStatusMessage(text('t3_msg_search_keyword_required', '검색어를 입력해주세요.'));
      showToast?.({ key: 't3_msg_search_keyword_required' });
      return;
    }
    await fetchMetadataResults({ source: apiSource, query, page });
  };

  const handleSelectApiResult = (result) => {
    applyMetadataToBatch(metadataFromApiResult(result, {
      bookType: activeBookType,
      query: apiSearch.query || searchQuery,
    }));
    setApiSearch(prev => ({ ...prev, open: false }));
    setStatusMessage(text('t3_msg_loaded_search_result_batch', '검색 결과를 일괄 편집창에 불러왔습니다.'));
    showToast?.({ key: 't3_msg_applied_series_tag' });
  };

  const updateActiveEpubCoverChange = useCallback((coverChange, coverDataUrl = '') => {
    if (!activeItem || activeBookType !== 'book') return;
    const activeFilePath = activeItem.filepath || '';
    const coverLoadedAt = coverDataUrl ? Date.now() : undefined;
    setFileList(prev => trimMetadataCoverCache(prev.map(item => {
      if (item.id !== activeItem.id) return item;
      const next = { ...item };
      if (coverChange) next.epubCoverChange = coverChange;
      else delete next.epubCoverChange;
      if (coverDataUrl) {
        next.coverDataUrl = coverDataUrl;
        next.coverLoadedAt = coverLoadedAt;
        delete next.epubCoverResolution;
      } else {
        delete next.coverDataUrl;
        delete next.coverLoadedAt;
        delete next.epubCoverResolution;
      }
      return next;
    }), activeFilePath));
  }, [activeBookType, activeItem]);

  const handleSelectEpubCoverEntry = async (entryName) => {
    if (!activeItem || activeBookType !== 'book' || !activeIsEpub || !entryName) return;
    const loadMetadataEpubImage = window.electronAPI?.loadMetadataEpubImage;
    if (typeof loadMetadataEpubImage !== 'function') return;
    try {
      setStatusMessage(text('meta_epub_cover_loading', 'EPUB 표지를 불러오는 중...'));
      const coverDataUrl = await loadMetadataEpubImage(activeItem.filepath, entryName);
      if (!coverDataUrl) throw new Error(text('meta_epub_cover_empty', '선택한 이미지를 표지로 불러오지 못했습니다.'));
      const image = activeEpubImages.find(item => item.name === entryName);
      updateActiveEpubCoverChange({
        type: 'entry',
        entryName,
        label: image?.label || fileNameFromPath(entryName),
      }, coverDataUrl);
      setStatusMessage(text('meta_epub_cover_entry_done', 'EPUB 내부 이미지를 새 표지로 선택했습니다.'));
    } catch (error) {
      const message = error.message || text('meta_epub_cover_failed', 'EPUB 표지 변경 준비에 실패했습니다.');
      setStatusMessage(message);
      showToast?.(message);
    }
  };

  const handleSelectLocalEpubCover = async () => {
    if (!activeItem || activeBookType !== 'book' || !activeIsEpub) return;
    try {
      const filePath = await window.electronAPI?.selectFile?.(
        text('meta_epub_cover_select_file', '표지 이미지 선택'),
        [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
      );
      if (!filePath) return;
      const coverDataUrl = await window.electronAPI?.loadMetadataImageFile?.(filePath);
      if (!coverDataUrl) throw new Error(text('meta_epub_cover_file_empty', '선택한 이미지 파일을 표지로 사용할 수 없습니다.'));
      updateActiveEpubCoverChange({
        type: 'file',
        filePath,
        label: fileNameFromPath(filePath),
      }, coverDataUrl);
      setStatusMessage(text('meta_epub_cover_file_done', '로컬 이미지 파일을 새 표지로 선택했습니다.'));
    } catch (error) {
      const message = error.message || text('meta_epub_cover_failed', 'EPUB 표지 변경 준비에 실패했습니다.');
      setStatusMessage(message);
      showToast?.(message);
    }
  };

  const handleResetEpubCoverChange = () => {
    if (!activeItem || activeBookType !== 'book' || !activeIsEpub) return;
    const filePath = activeItem.filepath || '';
    if (filePath) coverLoadRequestsRef.current.delete(filePath);
    updateActiveEpubCoverChange(null, '');
    setStatusMessage(text('meta_epub_cover_reset_done', 'EPUB 표지 변경을 취소했습니다.'));
  };

  const handleUseApiCoverResult = async (result) => {
    if (!activeItem || activeBookType !== 'book' || !activeIsEpub) return;
    const coverUrl = apiResultCoverUrl(result);
    if (!coverUrl) {
      setStatusMessage(text('meta_epub_cover_api_empty', '선택한 검색 결과에 사용할 표지가 없습니다.'));
      return;
    }
    const originalUrl = apiResultCoverUrlForUse(result, apiSearch.apiSource);
    try {
      setStatusMessage(text('meta_epub_cover_api_loading', '검색 API 표지를 저장하는 중...'));
      const cached = await window.electronAPI?.cacheMetadataRemoteCover?.(originalUrl);
      if (!cached?.filePath) throw new Error(text('meta_epub_cover_api_failed', '검색 API 표지를 로컬 캐시에 저장하지 못했습니다.'));
      updateActiveEpubCoverChange({
        type: 'file',
        filePath: cached.filePath,
        label: result?.title || result?.metadata?.Title || fileNameFromPath(cached.filePath),
      }, cached.coverCacheUrl || coverUrl);
      setApiSearch(prev => ({ ...prev, open: false }));
      setStatusMessage(text('meta_epub_cover_api_done', '검색 API 표지를 새 EPUB 표지로 선택했습니다.'));
    } catch (error) {
      const message = error.message || text('meta_epub_cover_api_failed', '검색 API 표지를 로컬 캐시에 저장하지 못했습니다.');
      setStatusMessage(message);
      showToast?.(message);
    }
  };

  const filenameStem = (name = '') => String(name).replace(/\.[^.]+$/, '');

  const inferTitleParts = (item) => {
    const inferred = inferMetadataFromArchiveName(
      item.name || item.filepath || '',
      config?.language || config?.lang || 'ko',
    );
    return {
      ...inferred,
      PageCount: item.pageCount ? normalizeMetadataAutoNumber(item.pageCount) : '',
    };
  };

  const applyAutoFieldToSeries = (field) => {
    if (!activeItem) return;
    setFileList(prev => prev.map(item => {
      if (item.group !== activeItem.group || !isSameActiveBookType(item)) return item;
      const inferred = inferTitleParts(item);
      return {
        ...item,
        metadata: applyInferredMetadataField(item.metadata || {}, inferred, field),
      };
    }));
    const messageKey = {
      Title: 't3_msg_auto_title_done',
      Volume: 't3_msg_auto_vol_done',
      Number: 't3_msg_auto_chap_done',
      PageCount: 't3_msg_auto_pages_done',
    }[field];
    if (messageKey) showToast?.({ key: messageKey });
  };

  const handleAutoMatchSeries = async () => {
    if (!activeItem) return;
    const query = activeItem.metadata?.Series || activeItem.metadata?.Title || filenameStem(activeItem.name);
    setSearchQuery(query);
    setIsWorking(true);
    setStatusMessage(text('t3_msg_auto_matching', '시리즈 자동 매칭 중...'));
    try {
      const result = await window.electronAPI.fetchMetadata({
        apiSource,
        query,
        page: 1,
        bookType: activeBookType,
        apiKeys: config?.api_keys || {},
      });
      if (result?.success === false) {
        setStatusMessage(result.error || text('t3_msg_auto_match_failed', '자동 매칭에 실패했습니다.'));
        return;
      }
      const first = result.results?.[0];
      if (!first) {
        setStatusMessage(text('t3_msg_auto_match_empty', '자동 매칭 결과가 없습니다.'));
        showToast?.(t('t3_msg_no_search_result'));
        return;
      }
      const firstMetadata = metadataFromApiResult(first, { bookType: activeBookType, query });
      applyMetadataToSeries(firstMetadata);
      setBatchMetadata(pickMetadataFields(
        normalizeMetadata(firstMetadata),
        currentMetaFieldIds,
        currentMetadataExtraFieldIds,
      ));
      setStatusMessage(text('t3_msg_auto_match_applied', '시리즈 자동 매칭을 적용했습니다.'));
      showToast?.({ key: 't3_msg_auto_match_done' });
    } catch (error) {
      setStatusMessage(text('t3_msg_auto_match_failed_detail', '자동 매칭 실패: {msg}', { msg: error.message }));
    } finally {
      setIsWorking(false);
    }
  };

  const resolveRidiPublishDate = useCallback(async (result) => {
    const bookId = result?.id || result?.b_id;
    const existingPubDate = result?.metadata?.PubDate || result?.PubDate;
    const existingIsbn = result?.metadata?.ISBN || result?.ISBN || result?.isbn;
    if (!bookId || (existingPubDate && existingIsbn)) return;

    const detail = typeof window.electronAPI?.fetchRidiBookDetail === 'function'
      ? await window.electronAPI.fetchRidiBookDetail(bookId)
      : { PubDate: await window.electronAPI?.fetchRidiPublishDate?.(bookId) };
    const pubDate = detail?.PubDate || existingPubDate || '';
    const isbn = detail?.ISBN || existingIsbn || '';
    if (!pubDate && !isbn) {
      setApiSearch(prev => ({
        ...prev,
        results: prev.results.map(item => (
          (item.id || item.b_id) === bookId ? { ...item, ridiDetailResolved: true } : item
        )),
      }));
      return;
    }
    const [year = '', month = '', day = ''] = String(pubDate || '').split('-');
    setApiSearch(prev => ({
      ...prev,
      results: prev.results.map(item => (
        (item.id || item.b_id) === bookId
          ? {
              ...item,
              ridiDetailResolved: true,
              ISBN: isbn,
              isbn,
              PubDate: pubDate,
              Year: year,
              Month: month ? String(Number(month)) : '',
              Day: day ? String(Number(day)) : '',
              metadata: {
                ...(item.metadata || {}),
                ISBN: isbn,
                PubDate: pubDate,
                Year: year,
                Month: month ? String(Number(month)) : '',
                Day: day ? String(Number(day)) : '',
              },
            }
          : item
      )),
    }));
  }, []);

  const handleLoadLatest = () => {
    if (!activeItem) return;
    const groupItems = fileList.filter(item => item.group === activeItem.group && isSameActiveBookType(item));
    const latest = [...groupItems].sort((a, b) => {
      const av = Number(a.metadata?.Volume || 0);
      const bv = Number(b.metadata?.Volume || 0);
      return bv - av;
    }).find(item => item.id !== activeItem.id && item.metadata && Object.keys(item.metadata).length > 0);
    if (!latest) {
      setStatusMessage(text('t3_msg_load_latest_empty', '불러올 최신권 메타데이터가 없습니다.'));
      showToast?.({ key: 't3_msg_load_latest_empty' });
      return;
    }
    setBatchMetadata(pickMetadataFields(
      latest.metadata || {},
      currentMetaFieldIds,
      currentMetadataExtraFieldIds,
    ));
    setStatusMessage(text('t3_msg_load_latest_done', '최신권 메타데이터를 일괄 편집창에 불러왔습니다.'));
    showToast?.({ key: 't3_msg_load_latest_done' });
  };

  const sanitizeItemForSave = (item) => {
    const itemBookType = resolveBookType(item || {});
    const fieldIds = itemBookType === 'pdf'
      ? PDF_META_FIELD_IDS
      : itemBookType === 'book'
        ? BOOK_META_FIELD_IDS
        : META_FIELD_IDS;
    const extraFieldIds = itemBookType === 'comic' ? ['ComicZipAddedDate', 'ComicZipModifiedDate'] : [];
    const payload = {
      id: item.id,
      filepath: item.filepath || item.path || '',
      path: item.path || item.filepath || '',
      name: item.name || '',
      checked: item.checked !== false,
      bookType: itemBookType,
      pageCount: item.pageCount || '',
      metadata: pickMetadataFields(item.metadata || {}, fieldIds, extraFieldIds),
    };
    if (itemBookType === 'book' && item.epubCoverChange) {
      payload.epubCoverChange = item.epubCoverChange;
    }
    return payload;
  };

  const handleSave = async (all = false) => {
    if (saveLockRef.current) return;
    const targets = all
      ? fileList.filter(item => item.checked !== false)
      : activeItem ? [{ ...activeItem, checked: true }] : [];
    const saveTargets = targets.map(sanitizeItemForSave);
    if (saveTargets.length === 0) {
      setStatusMessage(t('msg_no_targets'));
      await window.electronAPI?.showMessage?.({
        type: 'warning',
        title: t('dlg_warn'),
        message: t('msg_no_targets'),
        language: config?.language || config?.lang || 'ko',
      });
      return;
    }

    saveLockRef.current = true;
    setIsWorking(true);
    setTaskPhase('executing');
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_processing_overlay'));
    window.dispatchEvent(new CustomEvent('bookmanager:reset-task-tabs', {
      detail: { tabs: ['organizer', 'renamer'] },
    }));

    try {
      const result = await window.electronAPI.saveMetadata(saveTargets, {
        lang: config?.language || config?.lang || 'ko',
      });
      setLastResult(result);
      if (result.cancelled) {
        setStatusMessage(t('msg_cancelled'));
        return;
      }
      const success = result.stats?.success?.length || 0;
      const errors = result.stats?.error?.length || 0;
      const skip = result.stats?.skip?.length || 0;
      const completed = success + skip + errors;
      if (success > 0) {
        window.dispatchEvent(new CustomEvent('bookmanager:metadata-saved', {
          detail: {
            paths: saveTargets.map(item => item.filepath || item.path).filter(Boolean),
          },
        }));
      }
      const message = all
        ? t('t3_msg_save_all_done', { success_count: success, fail_count: errors })
        : (errors ? `${t('msg_failed')}: ${result.stats.error.join(' / ')}` : t('t3_msg_save_single_done'));
      setStatusMessage(message);
      showToast?.(message);
      if (shouldPlayCompletionSound(config, completed, result.cancelled)) {
        window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav');
      }
    } catch (error) {
      await window.electronAPI?.showMessage?.({
        type: 'error',
        title: t('dlg_err'),
        message: `${t('msg_failed')}:\n${error.message}`,
        language: config?.language || config?.lang || 'ko',
      });
    } finally {
      saveLockRef.current = false;
      setProgress(0);
      setStatusMessage(t('status_wait'));
      setIsWorking(false);
      setTaskPhase('idle');
    }
  };

  const bumpField = (fieldId, delta, target = 'active') => {
    const source = target === 'batch' ? batchMetadata : activeItem?.metadata;
    const rawValue = source?.[fieldId];
    const dateDefaults = { Year: new Date().getFullYear(), Month: new Date().getMonth() + 1, Day: new Date().getDate() };
    const current = Number.parseInt(rawValue, 10);
    const base = Number.isFinite(current) ? current : (dateDefaults[fieldId] || 0);
    const next = clampMetadataNumber(fieldId, base + delta);
    if (target === 'batch') updateBatchMetadata(fieldId, String(next));
    else updateActiveMetadata(fieldId, String(next));
  };

  useEffect(() => {
    const handleDelete = async (event) => {
      if (event.key !== 'Delete' || apiSearch.open || isWorking || isMetadataTextInput(event.target)) return;
      if (!selectedFileId && !selectedGroup) return;
      event.preventDefault();
      if (selectedGroup) {
        const response = await window.electronAPI?.showMessage?.({
          type: 'question',
          title: t('dlg_warn'),
          message: t('t3_msg_delete_series_group'),
          buttons: 'yes-no',
          defaultChoice: 'no',
          language: config?.language || config?.lang || 'ko',
        });
        if (response !== 'yes') return;
      }
      setFileList(prev => {
        const removedIds = selectedGroup
          ? prev.filter(item => item.group === selectedGroup).map(item => item.id)
          : [selectedFileId];
        const nextId = adjacentSelectionAfterRemoval(prev, removedIds, selectedFileId);
        setSelectedFileId(nextId);
        setSelectedGroup('');
        return prev.filter(item => !removedIds.includes(item.id));
      });
    };
    window.addEventListener('keydown', handleDelete, true);
    return () => window.removeEventListener('keydown', handleDelete, true);
  }, [apiSearch.open, config?.lang, config?.language, isWorking, selectedFileId, selectedGroup, t]);

  useEffect(() => {
    const handleMetadataTreeKeyDown = (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const treeIsActive = isMetadataTreeTarget(event.target) || metadataTreeKeyboardActiveRef.current;
      if (
        apiSearch.open
        || event.defaultPrevented
        || event.repeat
        || isWorking
        || isMetadataTextInput(event.target)
        || !treeIsActive
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || event.shiftKey
      ) {
        return;
      }
      if (visibleTreeNodes.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const currentIndex = visibleTreeNodes.findIndex(node => metadataTreeNodeKey(node) === selectedTreeKey);
        const nextIndex = currentIndex === -1
          ? (event.key === 'ArrowUp' ? visibleTreeNodes.length - 1 : 0)
          : event.key === 'ArrowUp'
            ? Math.max(0, currentIndex - 1)
            : Math.min(visibleTreeNodes.length - 1, currentIndex + 1);
        selectTreeNode(visibleTreeNodes[nextIndex]);
        return;
      }

      const selectedNode = visibleTreeNodes.find(node => metadataTreeNodeKey(node) === selectedTreeKey);
      if (!selectedNode) return;

      if (event.key === 'ArrowLeft') {
        if (selectedNode.type === 'group') {
          setGroupCollapsed(selectedNode.groupName, true);
        } else {
          setSelectedGroup(selectedNode.groupName);
          setSelectedFileId(null);
          setGroupCollapsed(selectedNode.groupName, true);
        }
        return;
      }

      if (event.key === 'ArrowRight' && selectedNode.type === 'group') {
        setGroupCollapsed(selectedNode.groupName, false);
      }
    };

    window.addEventListener('keydown', handleMetadataTreeKeyDown, true);
    return () => window.removeEventListener('keydown', handleMetadataTreeKeyDown, true);
  }, [apiSearch.open, isWorking, selectTreeNode, selectedTreeKey, setGroupCollapsed, visibleTreeNodes]);

  useEffect(() => {
    const handleAppAction = (event) => {
      if (event.detail?.activeTab !== 'metadata') return;
      const action = event.detail?.action;
      if (isWorking) return;
      if (action === 'add-folder') handleSelectFolder();
      else if (action === 'add-file') handleSelectFiles();
      else if (action === 'drop-paths' || action === 'load-paths') analyzePaths(event.detail?.paths);
      else if (action === 'remove-selected') handleRemoveChecked();
      else if (action === 'clear-all') handleClear();
      else if (action === 'toggle-all') handleToggleAllChecked();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [analyzePaths, handleClear, handleRemoveChecked, handleSelectFiles, handleSelectFolder, handleToggleAllChecked, isWorking]);

  useEffect(() => {
    const handleShortcut = (event) => {
      if (apiSearch.open || event.defaultPrevented || event.repeat) return;
      const code = shortcutCode(event);
      const isSaveShortcut = hasPrimaryModifier(event) && !event.altKey;

      if (isSaveShortcut && code === 'KeyS') {
        event.preventDefault();
        event.stopPropagation();
        if (isWorking) return;
        if (event.shiftKey) {
          if (checkedCount > 0) handleSave(true);
        } else if (activeItem) {
          handleSave(false);
        }
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isMetadataTextInput(event.target) || isWorking) return;
      if (code === 'KeyS' && searchQuery.trim()) {
        event.preventDefault();
        event.stopPropagation();
        handleSearchApi(1);
      } else if (code === 'KeyD' && activeItem) {
        event.preventDefault();
        event.stopPropagation();
        handleLoadLatest();
      } else if (code === 'KeyX' && activeItem) {
        event.preventDefault();
        event.stopPropagation();
        handleApplyBatchToActive();
      } else if (code === 'KeyC' && activeItem) {
        event.preventDefault();
        event.stopPropagation();
        handleApplyBatchToSeries();
      }
    };

    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  }, [activeItem, apiSearch.open, apiSource, applyEmpty, batchMetadata, checkedCount, config?.api_keys, fileList, isWorking, searchQuery]);

  const renderFieldInput = (field, value, onChange, className = 'meta-input') => {
    if (field.type === 'textarea') {
      if (field.id === 'Summary') {
        return <AutoHeightTextarea className={className} value={value || ''} onChange={onChange} />;
      }
      return <textarea className={className} rows="3" value={value || ''} onChange={event => onChange(event.target.value)} />;
    }
    if (field.type === 'select') {
      if (isSearchableSelectField(field.id, activeBookType)) {
        const options = field.id === 'SeriesGroup'
          ? seriesGroupOptions
          : field.id === 'Publisher'
            ? publisherSelectOptions
            : field.options;
        return (
          <SearchableSelect
            className={className}
            value={value || ''}
            options={uniqueSelectOptions(options, value)}
            optionLabel={option => optionLabel(field, option)}
            allowCustom={field.id === 'SeriesGroup' || field.id === 'Publisher'}
            onChange={onChange}
          />
        );
      }
      const options = uniqueSelectOptions(field.options, value);
      return (
        <select className={className} value={value || ''} onChange={event => onChange(event.target.value)}>
          {options.map(option => <option key={option} value={option}>{optionLabel(field, option)}</option>)}
        </select>
      );
    }
    return (
      <input
        type="text"
        inputMode={field.type === 'decimal' ? 'decimal' : field.type === 'number' ? 'numeric' : undefined}
        className={className}
        value={value || ''}
        onChange={event => onChange(event.target.value)}
        onBlur={event => {
          const nextValue = event.target.value.trim();
          if (!nextValue) return;
          if (field.type === 'number') {
            onChange(clampMetadataNumber(field.id, nextValue));
          } else if (field.type === 'decimal' || isDecimalMetadataField(field.id)) {
            onChange(normalizeMetadataDecimal(nextValue));
          }
        }}
      />
    );
  };

  const renderFieldRows = (fields) => (
    fields.map((field) => (
      <div className={`meta-form-row ${field.type === 'textarea' ? 'tall' : ''}`} key={field.id}>
        <div className="meta-col-label">{fieldLabel(field)}</div>
        <div className="meta-col-my meta-field-with-stepper">
          {renderFieldInput(field, activeItem?.metadata?.[field.id] || '', value => updateActiveMetadata(field.id, value))}
          {field.type === 'number' && (
            <div className="meta-stepper">
              <button onClick={() => bumpField(field.id, -1)} disabled={!activeItem}>−</button>
              <button onClick={() => bumpField(field.id, 1)} disabled={!activeItem}>+</button>
            </div>
          )}
        </div>
        <div className="meta-col-btn">
          <button className="meta-copy-btn" onClick={() => handleCopyField(field.id)} disabled={!activeItem}><FaIcon name="angle-left" size={12} /></button>
        </div>
        <div className="meta-col-res meta-field-with-stepper">
          {renderFieldInput(field, batchMetadata[field.id] || '', value => updateBatchMetadata(field.id, value), 'meta-input res')}
          {field.type === 'number' && (
            <div className="meta-stepper">
              <button onClick={() => bumpField(field.id, -1, 'batch')}>−</button>
              <button onClick={() => bumpField(field.id, 1, 'batch')}>+</button>
            </div>
          )}
        </div>
      </div>
    ))
  );

  const renderDualTextarea = (fieldId, label, placeholder = text('enter_after_input', '입력 후 Enter...'), options = {}) => {
    const showLabel = options.showLabel !== false;
    return (
      <div className={`meta-tag-editor ${showLabel ? '' : 'no-label'}`.trim()}>
        {showLabel && <div className="meta-tag-label">{label}</div>}
        <div className="meta-tag-columns">
          <TagInput
            className="meta-input meta-tag-box"
            placeholder={placeholder}
            value={activeItem?.metadata?.[fieldId] || ''}
            onChange={value => updateActiveMetadata(fieldId, value)}
            disabled={!activeItem}
          />
          <button className="meta-copy-btn" onClick={() => handleCopyField(fieldId)} disabled={!activeItem}><FaIcon name="angle-left" size={12} /></button>
          <TagInput
            className="meta-input res meta-tag-box"
            placeholder={placeholder}
            value={batchMetadata[fieldId] || ''}
            onChange={value => updateBatchMetadata(fieldId, value)}
          />
        </div>
        <button
          className="meta-series-apply-btn"
          onClick={() => {
            if (!activeItem) return;
            const value = batchMetadata[fieldId] || activeItem.metadata?.[fieldId] || '';
            setFileList(prev => prev.map(item => item.group === activeItem.group && isSameActiveBookType(item) ? {
              ...item,
              metadata: { ...(item.metadata || {}), [fieldId]: value },
            } : item));
          }}
          disabled={!activeItem}
        >
          {t('t3_btn_apply_series_tag')}
        </button>
      </div>
    );
  };

  const updateActiveGenreTags = (value) => {
    if (!activeItem) return;
    updateItem(activeItem.id, item => ({
      ...item,
      metadata: applyCombinedGenreTagsValue(item.metadata || {}, value),
    }));
  };

  const updateBatchGenreTags = (value) => {
    setBatchMetadata(prev => applyCombinedGenreTagsValue(prev || {}, value));
  };

  const handleCopyGenreTags = () => {
    if (!activeItem) return;
    const value = combinedGenreTagsValue(batchMetadata);
    if (!applyEmpty && !value.trim()) return;
    updateActiveGenreTags(value);
  };

  const toggleCombinedTagValue = (option) => {
    const values = new Set(splitTagValues(combinedGenreTagsValue(activeItem?.metadata)));
    if (values.has(option)) values.delete(option);
    else values.add(option);
    updateActiveGenreTags(joinTagValues([...values]));
  };

  const renderCombinedChoiceGrid = (options) => {
    const activeValues = new Set(splitTagValues(combinedGenreTagsValue(activeItem?.metadata)));
    return (
      <div className="meta-choice-grid">
        {options.map(option => (
          <label key={option} className="meta-choice">
            <input
              type="checkbox"
              checked={activeValues.has(option)}
              onChange={() => toggleCombinedTagValue(option)}
              disabled={!activeItem}
            />
            {option}
          </label>
        ))}
      </div>
    );
  };

  const renderCombinedGenreTags = (label, options, placeholder = text('enter_after_input', '입력 후 Enter...')) => (
    <>
      <div className="meta-choice-row">
        <div className="meta-tag-label">{label}</div>
        {renderCombinedChoiceGrid(options)}
      </div>
      <div className="meta-tag-editor no-label">
        <div className="meta-tag-columns">
          <TagInput
            className="meta-input meta-tag-box"
            placeholder={placeholder}
            value={combinedGenreTagsValue(activeItem?.metadata)}
            onChange={updateActiveGenreTags}
            disabled={!activeItem}
          />
          <button className="meta-copy-btn" onClick={handleCopyGenreTags} disabled={!activeItem}><FaIcon name="angle-left" size={12} /></button>
          <TagInput
            className="meta-input res meta-tag-box"
            placeholder={placeholder}
            value={combinedGenreTagsValue(batchMetadata)}
            onChange={updateBatchGenreTags}
          />
        </div>
        <button
          className="meta-series-apply-btn"
          onClick={() => {
            if (!activeItem) return;
            const value = combinedGenreTagsValue(batchMetadata) || combinedGenreTagsValue(activeItem.metadata);
            const split = splitCombinedGenreTags(value);
            setFileList(prev => prev.map(item => item.group === activeItem.group && isSameActiveBookType(item) ? {
              ...item,
              metadata: { ...(item.metadata || {}), ...split },
            } : item));
          }}
          disabled={!activeItem}
        >
          {t('t3_btn_apply_series_tag')}
        </button>
      </div>
    </>
  );

  const renderChoiceGrid = (fieldId, options) => {
    const activeValues = new Set(getCommaValues(activeItem?.metadata?.[fieldId]));
    return (
      <div className="meta-choice-grid">
        {options.map(option => (
          <label key={option} className="meta-choice">
            <input
              type="checkbox"
              checked={activeValues.has(option)}
              onChange={() => toggleCommaValue('active', fieldId, option)}
              disabled={!activeItem}
            />
            {option}
          </label>
        ))}
      </div>
    );
  };

  const renderSeparatedTagField = (fieldId, label, options, placeholder = text('enter_after_input', '입력 후 Enter...')) => (
    <>
      <div className="meta-choice-row">
        <div className="meta-tag-label">{label}</div>
        {renderChoiceGrid(fieldId, options)}
      </div>
      {renderDualTextarea(fieldId, label, placeholder, { showLabel: false })}
    </>
  );

  const scrollToSection = (sectionId) => {
    setActiveSection(sectionId);
    const section = sectionRefs.current[sectionId];
    const scroller = formScrollRef.current;
    if (!section || !scroller) return;
    scroller.scrollTo({ top: section.offsetTop - 8, behavior: 'smooth' });
  };

  const syncActiveSection = () => {
    const scroller = formScrollRef.current;
    if (!scroller) return;
    let nextSection = currentSectionTabs[0].id;
    for (const section of currentSectionTabs) {
      const node = sectionRefs.current[section.id];
      if (node && node.offsetTop <= scroller.scrollTop + 90) nextSection = section.id;
    }
    setActiveSection(nextSection);
  };

  const renderAllSections = () => {
    const renderEpubCoverField = () => {
      if (activeBookType !== 'book' || !activeIsEpub || !activeItem) return null;
      const pendingCoverName = activeItem.epubCoverChange?.label
        || activeItem.epubCoverChange?.entryName
        || fileNameFromPath(activeItem.epubCoverChange?.filePath);
      const coverResolution = activeItem.coverDataUrl ? activeItem.epubCoverResolution : null;
      const handleCoverImageLoad = (event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) return;
        updateItem(activeItem.id, item => {
          if (
            item.epubCoverResolution?.width === naturalWidth
            && item.epubCoverResolution?.height === naturalHeight
          ) {
            return item;
          }
          return {
            ...item,
            epubCoverResolution: {
              width: naturalWidth,
              height: naturalHeight,
            },
          };
        });
      };
      return (
        <div className="meta-form-row meta-epub-cover-row">
          <div className="meta-col-label">{text('meta_epub_cover_label', '표지')}</div>
          <div className="meta-epub-cover-field">
            <div className="meta-epub-cover-thumb-box">
              {activeItem.coverDataUrl ? (
                <img src={activeItem.coverDataUrl} alt="" onLoad={handleCoverImageLoad} />
              ) : (
                <span>{t('no_image')}</span>
              )}
            </div>
            <div className="meta-epub-cover-tools">
              <select
                className="meta-epub-cover-select"
                value={activeItem.epubCoverChange?.type === 'entry' ? activeItem.epubCoverChange.entryName : ''}
                onChange={event => handleSelectEpubCoverEntry(event.target.value)}
                disabled={isWorking || activeEpubImageState.loading || activeEpubImages.length === 0}
              >
                <option value="">
                  {activeEpubImageState.loading
                    ? text('meta_epub_images_loading', 'EPUB 이미지 로드 중...')
                    : text('meta_epub_cover_select_internal', 'EPUB 내부 이미지 선택')}
                </option>
                {activeEpubImages.map(image => (
                  <option key={image.name} value={image.name}>
                    {image.isCover
                      ? `${image.label} (${text('meta_epub_current_cover', '현재 표지')})`
                      : image.label}
                  </option>
                ))}
              </select>
              <div className="meta-epub-cover-buttons">
                <button
                  type="button"
                  onClick={handleSelectLocalEpubCover}
                  disabled={isWorking}
                  title={text('meta_epub_cover_file', '로컬 이미지 선택')}
                >
                  <FaIcon name="fileCirclePlus" size={11} />
                  <span>{text('meta_epub_cover_file_short', '파일')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetEpubCoverChange}
                  disabled={isWorking || !activeItem.epubCoverChange}
                  title={text('meta_epub_cover_reset', '표지 변경 취소')}
                >
                  <FaIcon name="arrowRotateLeft" size={11} />
                  <span>{text('meta_epub_cover_reset_short', '원본')}</span>
                </button>
              </div>
              <div className={`meta-epub-cover-status ${activeEpubImageState.error ? 'error' : ''}`}>
                {activeEpubImageState.error
                  || (activeItem.epubCoverChange
                    ? `${text('meta_epub_cover_pending_prefix', '저장 시 표지 변경')}: ${pendingCoverName}`
                    : text('meta_epub_cover_original', '저장된 EPUB 표지를 사용합니다.'))}
              </div>
              <div className="meta-epub-cover-resolution">
                <span>{text('meta_epub_cover_resolution', '해상도')}</span>
                <strong>
                  {coverResolution?.width && coverResolution?.height
                    ? `${coverResolution.width} x ${coverResolution.height}`
                    : text('meta_epub_cover_resolution_unknown', '확인 중')}
                </strong>
              </div>
            </div>
          </div>
        </div>
      );
    };

    const editorProps = {
      fields: currentMetadataConfig.fields,
      combinedTagOptions,
      genreOptions,
      renderCombinedGenreTags,
      renderCoverField: renderEpubCoverField,
      renderChoiceGrid,
      renderDualTextarea,
      renderFieldRows,
      renderSeparatedTagField,
      sectionLabel,
      sectionRefs,
      sectionTabs: currentSectionTabs,
      tagOptions,
      t,
    };
    if (activeBookType === 'pdf') {
      return <PdfMetadataEditor key={`pdf-${activeItem?.id || 'none'}`} {...editorProps} />;
    }
    return activeBookType === 'book'
      ? <BookMetadataEditor key={`book-${activeItem?.id || 'none'}`} {...editorProps} />
      : <ComicMetadataEditor key={`comic-${activeItem?.id || 'none'}`} {...editorProps} />;
  };

  return (
    <div className="metadata-tab">
      {fileList.length === 0 ? (
        <div className="meta-empty-drop">
          <img src={dragDropImage} alt="" />
          <div>{t('drag_drop')}</div>
        </div>
      ) : (
      <>
      <aside className="meta-left-panel">
        <div className="meta-preview-title">{t('metadata.cover')}</div>
        <div className="meta-preview-img-box">
          {activeItem?.coverDataUrl ? (
            <img src={activeItem.coverDataUrl} alt="" className="meta-cover-image" />
          ) : (
            <span className="meta-no-image">{t('no_image')}</span>
          )}
        </div>

        <button
          type="button"
          className={`meta-tree-toggle-all ${allItemsChecked ? 'active' : ''}`}
          onClick={handleToggleAllChecked}
          disabled={fileList.length === 0 || isWorking}
          title={t('toggle_all')}
        >
          <span className="meta-tree-toggle-label">
            <FaIcon name={allItemsChecked ? 'checkSquare' : 'square'} size={12} />
            <span>{t('toggle_all')}</span>
          </span>
          <span className="meta-tree-toggle-count">{checkedCount}/{fileList.length}</span>
        </button>

        <div
          className="meta-tree-container"
          ref={treeContainerRef}
          tabIndex={0}
          onFocus={activateMetadataTreeKeyboard}
          onMouseDownCapture={activateMetadataTreeKeyboard}
        >
          <ul className="meta-tree">
              {groupedItems.map((dir) => {
                const collapsed = collapsedGroups.has(dir.name);
                return (
                <li
                  key={dir.name}
                  className={`meta-tree-dir ${selectedGroup === dir.name ? 'selected' : ''}`}
                  data-meta-tree-key={`group:${dir.name}`}
                >
                  <button
                    type="button"
                    className="meta-tree-dir-button"
                    title={dir.name}
                    onClick={() => handleGroupClick(dir.name)}
                  >
                    <span className="meta-tree-chevron">{collapsed ? '▸' : '▾'}</span>
                    <span className="meta-tree-icon"><FaIcon name={collapsed ? 'folder' : 'folder-open'} /></span>
                    <span>{dir.name}</span>
                  </button>
                  {!collapsed && <ul>
                    {dir.children.map((file) => {
                      const displayName = splitMetadataFileDisplayName(file.name);
                      return (
                        <li
                          key={file.id}
                          className={`meta-tree-file ${activeItem?.id === file.id ? 'selected' : ''}`}
                          data-meta-tree-key={`file:${file.id}`}
                          onClick={() => {
                            focusMetadataTree();
                            setSelectedGroup('');
                            setSelectedFileId(file.id);
                          }}
                          title={file.filepath}
                        >
                          <input
                            type="checkbox"
                            checked={file.checked !== false}
                            onChange={(event) => {
                              event.stopPropagation();
                              updateItem(file.id, item => ({ ...item, checked: !item.checked }));
                            }}
                          />
                          <span className="meta-tree-file-text">
                            <span className="meta-tree-file-name" title={file.name}>
                              <span className="meta-tree-file-name-head">{displayName.head}</span>
                              <span className="meta-tree-file-name-tail">&nbsp;{displayName.tail}</span>
                            </span>
                            <span className="meta-tree-file-date">
                              <FaIcon name="clock" size={10} />
                              <span>{metadataModifiedDate(file)}</span>
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>}
                </li>
              )})}
          </ul>
        </div>
      </aside>

      <main
        className="meta-right-panel"
        onFocusCapture={deactivateMetadataTreeKeyboard}
        onMouseDownCapture={deactivateMetadataTreeKeyboard}
      >
        <div className="meta-search-bar">
          <span className="meta-search-label">{t('t3_search_api')}</span>
          <select
            className="meta-api-select"
            value={apiSource}
            onChange={(event) => selectApiSource(event.target.value)}
          >
            {currentApiSources.map(source => <option key={source.value} value={source.value}>{apiSourceLabel(source.value)}</option>)}
          </select>
          <span className="meta-search-label">{t('t3_search_query')}</span>
          <input
            type="text"
            className="meta-search-input"
            placeholder={t('t3_search_ph')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="meta-search-btn" onClick={() => handleSearchApi(1)} disabled={isWorking || !searchQuery.trim()}><FaIcon name="search" /> {t('t3_btn_search')} (S)</button>
        </div>

        <div className="meta-tools-bar">
          <div className="meta-section-tabs">
            {currentSectionTabs.map(tab => (
              <button
                key={tab.id}
                className={activeSection === tab.id ? 'active' : ''}
                onClick={() => scrollToSection(tab.id)}
              >
                {sectionLabel(tab).split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}
              </button>
            ))}
          </div>
          <div className="meta-nav-center">
            <button
              className="meta-nav-btn"
              disabled={!activeItem || fileList.filter(item => item.group === activeItem.group).findIndex(item => item.id === activeItem.id) <= 0}
              onClick={() => {
                const siblings = fileList.filter(item => item.group === activeItem.group);
                const index = siblings.findIndex(item => item.id === activeItem.id);
                setSelectedFileId(siblings[index - 1]?.id || null);
              }}
            >
              <FaIcon name="chevronLeft" size={9} />
              <span>{t('t3_btn_prev')}</span>
            </button>
            <button
              className="meta-nav-btn"
              disabled={!activeItem || fileList.filter(item => item.group === activeItem.group).findIndex(item => item.id === activeItem.id) >= fileList.filter(item => item.group === activeItem.group).length - 1}
              onClick={() => {
                const siblings = fileList.filter(item => item.group === activeItem.group);
                const index = siblings.findIndex(item => item.id === activeItem.id);
                setSelectedFileId(siblings[index + 1]?.id || null);
              }}
            >
              <span>{t('t3_btn_next')}</span>
              <FaIcon name="chevronRight" size={9} />
            </button>
          </div>
          <div className="meta-top-actions">
            <div className="meta-top-action-buttons">
              <button className="meta-btn" onClick={handleResetActive} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="arrowRotateLeft" size={12} /></span>
                <span className="meta-tool-text">{t('t3_btn_reset_series').split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}</span>
              </button>
              <button className="meta-btn" title="D" onClick={handleLoadLatest} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="cloudArrowDown" size={12} /></span>
                <span className="meta-tool-text">{t('t3_btn_load_latest').split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)} (D)</span>
              </button>
              <button className="meta-btn" onClick={handleCopyMyToBatch} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="copy" size={12} /></span>
                <span className="meta-tool-text">{t('t3_btn_copy_orig').split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}</span>
              </button>
              <button className="meta-btn-primary" title="X" onClick={handleApplyBatchToActive} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="check" size={12} /></span>
                <span className="meta-tool-text">{t('t3_btn_apply_all').split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}</span>
              </button>
              <button className="meta-btn-primary" title="C" onClick={handleApplyBatchToSeries} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="layer-group" size={12} /></span>
                <span className="meta-tool-text">{t('t3_btn_apply_series').split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)} (C)</span>
              </button>
            </div>
            <label className="meta-checkbox-label">
              <input type="checkbox" checked={applyEmpty} onChange={(event) => setApplyEmpty(event.target.checked)} />
              {t('t3_apply_empty')}
            </label>
          </div>
        </div>

        <div className="meta-form-area">
          <div className="meta-form-scroll" ref={formScrollRef} onScroll={syncActiveSection}>
            {renderAllSections()}
          </div>
          {!activeItem && (
            <button
              type="button"
              className="meta-selection-overlay"
              onClick={() => window.electronAPI?.showMessage?.({
                type: 'info',
                title: t('msg_notice'),
                message: t('t3_msg_sel'),
                language: config?.language || config?.lang || 'ko',
              })}
            >
              {t('t3_msg_sel')}
            </button>
          )}
        </div>

        <div className="meta-bottom-bar">
          <div className="meta-bottom-left">
            <button className="meta-btn-magic" onClick={handleAutoMatchSeries} disabled={!activeItem || isWorking}><FaIcon name="wand" /> {t('t3_auto_match')}</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Title')} disabled={!activeItem}>{t('t3_auto_title')}</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Volume')} disabled={!activeItem}>{activeBookType === 'book' || activeBookType === 'pdf' ? text('t3_auto_series_number', '자동 시리즈번호 입력') : t('t3_auto_vol')}</button>
            {activeBookType === 'comic' && (
              <>
                <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Number')} disabled={!activeItem}>{t('t3_auto_chap')}</button>
                <button className="meta-btn" onClick={() => applyAutoFieldToSeries('PageCount')} disabled={!activeItem}>{t('t3_auto_pages')}</button>
              </>
            )}
          </div>
          <div className="meta-bottom-right">
            <button className="meta-btn-save" title={`${primaryShortcut}+S`} onClick={() => handleSave(false)} disabled={!activeItem || isWorking}><FaIcon name="floppy" /> {t('t3_save')} <span>({primaryShortcut}+S)</span></button>
            <button className="meta-btn-save" title={`${primaryShortcut}+Shift+S`} onClick={() => handleSave(true)} disabled={checkedCount === 0 || isWorking}><FaIcon name="floppy" /> {t('t3_save_all')} <span>({primaryShortcut}+Shift+S)</span></button>
          </div>
        </div>

      </main>
      {lastResult && (
        <ResultLogDialog
          result={lastResult}
          onClose={() => setLastResult(null)}
          t={t}
        />
      )}
      {apiSearch.open && (
        <MetadataSearchDialog
          state={apiSearch}
          apiSource={apiSource}
          apiSources={currentApiSources}
          bookType={activeBookType}
          t={t}
          onClose={() => setApiSearch(prev => ({ ...prev, open: false }))}
          onSelect={handleSelectApiResult}
          onUseCover={activeBookType === 'book' && activeIsEpub ? handleUseApiCoverResult : null}
          onSearch={fetchMetadataResults}
          onResolveRidiDate={resolveRidiPublishDate}
          minWidth={config?.metadata_search_min_width}
          minHeight={config?.metadata_search_min_height}
          sourceFilePath={activeItem?.filepath || ''}
          sourceCoverDataUrl={activeItem?.coverDataUrl || ''}
          showToast={showToast}
        />
      )}
      </>
      )}
    </div>
  );
}

function SearchableSelect({ className, value, options, optionLabel, allowCustom = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const currentValue = String(value ?? '');
  const normalizedOptions = useMemo(() => uniqueSelectOptions(options, currentValue), [currentValue, options]);
  const currentLabel = optionLabel(currentValue) || currentValue;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return normalizedOptions;
    return normalizedOptions.filter((option) => {
      const optionValue = String(option || '').toLowerCase();
      const label = String(optionLabel(option) || option || '').toLowerCase();
      return optionValue.includes(normalizedQuery) || label.includes(normalizedQuery);
    });
  }, [normalizedOptions, optionLabel, query]);

  useEffect(() => {
    if (!open) setQuery(currentLabel);
  }, [currentLabel, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, normalizedOptions.length]);

  const chooseOption = useCallback((option) => {
    const nextValue = String(option ?? '');
    onChange(nextValue);
    setQuery(optionLabel(nextValue) || nextValue);
    setOpen(false);
  }, [onChange, optionLabel]);

  const commitCustomValue = useCallback(() => {
    if (!allowCustom) {
      setQuery(currentLabel);
      setOpen(false);
      return;
    }
    onChange(query);
    setOpen(false);
  }, [allowCustom, currentLabel, onChange, query]);

  return (
    <div className={`meta-searchable-select ${open ? 'open' : ''}`}>
      <input
        type="text"
        className={className}
        value={open ? query : currentLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={(event) => {
          setQuery(currentLabel);
          setOpen(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setOpen(true);
          if (allowCustom) onChange(nextQuery);
        }}
        onBlur={commitCustomValue}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(index => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            if (open && filteredOptions[activeIndex] !== undefined) {
              event.preventDefault();
              chooseOption(filteredOptions[activeIndex]);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setQuery(currentLabel);
            setOpen(false);
          }
        }}
      />
      <span className="meta-searchable-arrow"><FaIcon name="angleDown" size={10} /></span>
      {open && (
        <div className="meta-searchable-options" role="listbox">
          {filteredOptions.length > 0 ? filteredOptions.map((option, index) => {
            const label = optionLabel(option) || option || '-';
            return (
              <button
                type="button"
                key={`${option}-${index}`}
                className={`meta-searchable-option ${index === activeIndex ? 'active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseOption(option);
                }}
                role="option"
                aria-selected={String(option ?? '') === currentValue}
              >
                {label}
              </button>
            );
          }) : (
            <div className="meta-searchable-empty">No Data</div>
          )}
        </div>
      )}
    </div>
  );
}

function TagInput({ className = '', value, placeholder = '', disabled = false, onChange }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');
  const tags = useMemo(() => splitTagValues(value), [value]);

  const updateTags = useCallback((nextTags) => {
    onChange(joinTagValues(nextTags));
  }, [onChange]);

  const commitDraft = useCallback(() => {
    const additions = splitTagValues(draft);
    if (additions.length === 0) return;
    updateTags([...tags, ...additions]);
    setDraft('');
  }, [draft, tags, updateTags]);

  const removeTag = useCallback((targetTag) => {
    updateTags(tags.filter(tag => tag !== targetTag));
  }, [tags, updateTags]);

  return (
    <div
      className={`meta-tag-input ${className} ${disabled ? 'disabled' : ''}`.trim()}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map(tag => (
        <span className="meta-tag-chip" key={tag}>
          <span className="meta-tag-chip-text">{tag}</span>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              removeTag(tag);
            }}
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={disabled}
        placeholder={tags.length === 0 ? placeholder : ''}
        onChange={event => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            event.preventDefault();
            removeTag(tags[tags.length - 1]);
          }
        }}
      />
    </div>
  );
}

function MetadataSearchDialog({
  state,
  apiSources,
  bookType = 'comic',
  onClose,
  onSelect,
  onUseCover,
  onSearch,
  onResolveRidiDate,
  minWidth = 1050,
  minHeight = 780,
  sourceFilePath = '',
  sourceCoverDataUrl = '',
  t,
  showToast,
}) {
  const dialogRef = useRef(null);
  const resultRefs = useRef([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dialogApi, setDialogApi] = useState(state.apiSource || apiSources[0]?.value || '');
  const [dialogQuery, setDialogQuery] = useState(state.query || state.actualQuery || '');
  const [translatedResult, setTranslatedResult] = useState(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheError, setCacheError] = useState('');
  const [aiTitleCandidates, setAiTitleCandidates] = useState([]);
  const [aiTitleLoading, setAiTitleLoading] = useState(false);
  const [aiTitleError, setAiTitleError] = useState('');
  const [aiTitleMenuOpen, setAiTitleMenuOpen] = useState(false);
  const [aiTitleActiveIndex, setAiTitleActiveIndex] = useState(0);
  const resolvingRidiDates = useRef(new Set());
  const rawSelected = state.results[selectedIndex];
  const selected = showTranslated && translatedResult ? translatedResult : rawSelected;
  const selectedCoverUrl = selected ? apiResultCoverUrl(selected) : '';

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.animate) return undefined;

    const animation = dialog.animate([
      {
        transform: 'translateY(28px) scale(0.94)',
        boxShadow: '0 8px 22px rgba(0, 0, 0, 0.35)',
      },
      {
        offset: 0.72,
        transform: 'translateY(-3px) scale(1.008)',
        boxShadow: '0 28px 76px rgba(0, 0, 0, 0.86)',
      },
      {
        transform: 'translateY(0) scale(1)',
        boxShadow: '0 24px 70px rgba(0, 0, 0, 0.82)',
      },
    ], {
      duration: 380,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    });

    return () => animation.cancel();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame?.(() => {
      dialogRef.current?.focus?.({ preventScroll: true });
    });
    return () => {
      if (frame) window.cancelAnimationFrame?.(frame);
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (aiTitleMenuOpen) {
        setAiTitleMenuOpen(false);
        return;
      }
      onClose();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [aiTitleMenuOpen, onClose]);

  useEffect(() => {
    setAiTitleCandidates([]);
    setAiTitleError('');
    setAiTitleMenuOpen(false);
    setAiTitleActiveIndex(0);
  }, [sourceFilePath]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [state.apiSource, state.page, state.query]);

  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, state.results.length - 1)));
  }, [state.results.length]);

  useEffect(() => {
    resultRefs.current[selectedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex, state.results]);

  useEffect(() => {
    setTranslatedResult(null);
    setShowTranslated(false);
    setTranslating(false);
    setTranslationError('');
  }, [rawSelected?.id, state.apiSource]);

  useEffect(() => {
    setDialogApi(state.apiSource || apiSources[0]?.value || '');
    setDialogQuery(state.query || state.actualQuery || '');
  }, [apiSources, state.actualQuery, state.apiSource, state.query]);

  useEffect(() => {
    const hasPubDate = selected?.PubDate || selected?.metadata?.PubDate;
    const hasIsbn = selected?.ISBN || selected?.isbn || selected?.metadata?.ISBN || selected?.metadata?.isbn;
    if (state.apiSource !== '리디북스' || !selected || selected.ridiDetailResolved || (hasPubDate && hasIsbn)) return;
    const bookId = selected.id || selected.b_id;
    if (!bookId || resolvingRidiDates.current.has(bookId)) return;
    resolvingRidiDates.current.add(bookId);
    Promise.resolve(onResolveRidiDate?.(selected)).finally(() => resolvingRidiDates.current.delete(bookId));
  }, [onResolveRidiDate, selected, state.apiSource]);

  const runSearch = (page = 1, query = dialogQuery) => {
    onSearch({ source: dialogApi, query, page });
  };

  const clearSearchCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheError('');
    try {
      const response = await window.electronAPI?.clearApiCache?.();
      if (response?.success === false) {
        throw new Error(response.error || text('meta_cache_clear_failed', '검색 캐시를 비우지 못했습니다.'));
      }
      showToast?.({ key: 'msg_cache_cleared' });
      if (dialogQuery.trim()) runSearch(1);
    } catch (error) {
      setCacheError(error.message || text('meta_cache_clear_failed', '검색 캐시를 비우지 못했습니다.'));
    } finally {
      setClearingCache(false);
    }
  };

  const toggleTranslation = async () => {
    if (!rawSelected || translating) return;
    if (showTranslated) {
      setShowTranslated(false);
      setTranslationError('');
      return;
    }
    if (translatedResult) {
      setShowTranslated(true);
      setTranslationError('');
      return;
    }
    setTranslating(true);
    setTranslationError('');
    try {
      if (typeof window.electronAPI?.translateMetadata !== 'function') {
        throw new Error(text('meta_translate_unavailable', '번역 기능을 불러오지 못했습니다. BookManager를 완전히 종료한 뒤 다시 실행해주세요.'));
      }
      const response = await window.electronAPI.translateMetadata(rawSelected);
      if (response === undefined || response === null) {
        throw new Error(text('meta_translate_no_response', '번역 IPC에서 응답이 없습니다. BookManager를 완전히 종료한 뒤 다시 실행해주세요.'));
      }
      if (!response?.success || !response.result) {
        throw new Error(response?.error || text('meta_translate_failed', '번역에 실패했습니다.'));
      }
      setTranslatedResult(response.result);
      setShowTranslated(true);
    } catch (error) {
      setTranslationError(error.message || text('meta_translate_failed', '번역에 실패했습니다.'));
    } finally {
      setTranslating(false);
    }
  };

  const text = (key, fallback, values) => {
    const translated = t?.(key, values);
    return translated && translated !== key ? translated : fallback;
  };

  const aiTitleKindLabel = (kind) => ({
    native: text('meta_ai_title_native', '원제'),
    english: text('meta_ai_title_english', '영문명'),
    korean: text('meta_ai_title_korean', '한글명'),
  })[kind] || kind;

  const selectAiTitleCandidate = (candidate) => {
    if (!candidate?.query) return;
    setDialogQuery(candidate.query);
    setAiTitleMenuOpen(false);
    setAiTitleError('');
    runSearch(1, candidate.query);
  };

  const identifyCoverTitles = async () => {
    if (aiTitleLoading) return;
    setAiTitleLoading(true);
    setAiTitleError('');
    setAiTitleMenuOpen(false);
    try {
      const identify = window.electronAPI?.identifyMetadataCoverTitles;
      if (typeof identify !== 'function') {
        throw new Error(text('meta_ai_title_unavailable', 'AI 원제 찾기 기능을 불러오지 못했습니다. BookManager를 완전히 종료한 뒤 다시 실행해주세요.'));
      }
      const response = await identify({
        filePath: sourceFilePath,
        coverDataUrl: sourceCoverDataUrl,
      });
      if (!response?.success) {
        throw new Error(response?.error || text('meta_ai_title_failed', '표지에서 제목을 찾지 못했습니다.'));
      }
      const candidates = Array.isArray(response.candidates)
        ? response.candidates.filter(candidate => candidate?.query)
        : [];
      if (candidates.length === 0) {
        throw new Error(text('meta_ai_title_empty', '선택할 수 있는 제목 후보가 없습니다.'));
      }
      setAiTitleCandidates(candidates);
      setAiTitleActiveIndex(0);
      setAiTitleMenuOpen(true);
    } catch (error) {
      setAiTitleCandidates([]);
      setAiTitleError(error.message || text('meta_ai_title_failed', '표지에서 제목을 찾지 못했습니다.'));
    } finally {
      setAiTitleLoading(false);
    }
  };

  const handleAiTitleInputKeyDown = (event) => {
    if (aiTitleMenuOpen && aiTitleCandidates.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setAiTitleActiveIndex(prev => (
          (prev + delta + aiTitleCandidates.length) % aiTitleCandidates.length
        ));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        selectAiTitleCandidate(aiTitleCandidates[aiTitleActiveIndex]);
        return;
      }
    }
    if (event.key === 'Enter') runSearch(1);
  };

  const metadataValue = (item, key, ...aliases) => {
    const candidates = [item?.[key], item?.metadata?.[key], ...aliases.map(alias => item?.[alias] ?? item?.metadata?.[alias])];
    return candidates.find(value => value !== undefined && value !== null && String(value).trim() !== '') || '';
  };

  const publicationDate = selected && (
    metadataValue(selected, 'PubDate')
    || [metadataValue(selected, 'Year'), metadataValue(selected, 'Month'), metadataValue(selected, 'Day')].filter(Boolean).join('-')
  );
  const selectedIsbn = selected ? metadataValue(selected, 'ISBN', 'isbn') : '';
  const selectedTags = selected
    ? String(metadataValue(selected, 'tags', 'Tags') || '')
        .split(/[,/|]/)
        .map(tag => tag.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const detailLabel = (icon, label) => (
    <>
      <FaIcon name={icon} className="meta-api-field-icon" size={11} />
      <span>{label}</span>
    </>
  );

  const renderValue = (value, className = '') => (
    <span
      className={`meta-api-value ${className}`.trim()}
      title={String(value || '-')}
    >
      {className.includes('meta-api-rating') && <FaIcon name="star" size={11} />}
      {value || '-'}
    </span>
  );

  const link = selected && metadataValue(selected, 'link', 'Web');
  const openLink = () => {
    if (window.getSelection?.()?.toString()) return;
    if (/^https?:\/\//i.test(String(link || ''))) window.electronAPI?.openExternal?.(link);
  };

  const dialogMinimumSize = {
    '--meta-search-min-width': `${Math.max(720, Number(minWidth) || 1050)}px`,
    '--meta-search-min-height': `${Math.max(560, Number(minHeight) || 780)}px`,
  };

  const moveSelectedResult = useCallback((delta) => {
    setSelectedIndex(prev => {
      const count = state.results.length;
      if (count === 0) return 0;
      const current = prev < 0 || prev >= count
        ? (delta > 0 ? -1 : count)
        : prev;
      return Math.max(0, Math.min(count - 1, current + delta));
    });
  }, [state.results.length]);

  const handleShortcut = useCallback((event) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const targetTag = String(event.target?.tagName || '').toUpperCase();
    const isDialogTextInput = isMetadataTextInput(event.target) && dialogRef.current?.contains?.(event.target);
    if (event.target?.dataset?.aiTitleInput === 'true') return;
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && targetTag !== 'SELECT') {
      if (state.loading || state.results.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      moveSelectedResult(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (isDialogTextInput) return;
    const code = shortcutCode(event);
    if (code === 'KeyS' && !state.loading && dialogQuery.trim()) {
      event.preventDefault();
      event.stopPropagation();
      runSearch(1);
    } else if (code === 'KeyX' && onUseCover && selected && selectedCoverUrl) {
      event.preventDefault();
      event.stopPropagation();
      onUseCover(selected);
    } else if (code === 'KeyC' && selected) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(selected);
    }
  }, [dialogApi, dialogQuery, moveSelectedResult, onSearch, onSelect, onUseCover, selected, selectedCoverUrl, state.loading, state.results.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  }, [handleShortcut]);

  return (
    <div
      className="meta-api-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="meta-api-dialog"
        role="dialog"
        aria-label={text('meta_search_title', '메타데이터 검색')}
        style={dialogMinimumSize}
        tabIndex={-1}
        onKeyDownCapture={handleShortcut}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="meta-api-dialog-header">
          <div className="meta-api-dialog-heading">
            <div className="meta-api-dialog-query">{state.actualQuery}</div>
          </div>
          <div className="meta-api-search-controls">
            <button
              type="button"
              className="meta-ai-title-btn"
              title={text('meta_ai_title_tip', '선택한 책의 표지를 AI로 분석해 원제·영문명·한글명을 찾습니다.')}
              onClick={identifyCoverTitles}
              disabled={state.loading || aiTitleLoading || !sourceFilePath}
            >
              <FaIcon name="wand" />
              {aiTitleLoading
                ? text('meta_ai_title_finding', '찾는 중...')
                : text('meta_ai_title_find', 'AI 원제 찾기')}
            </button>
            <select value={dialogApi} onChange={event => setDialogApi(event.target.value)}>
              {apiSources.map(source => <option key={source.value} value={source.value}>{text(source.labelKey, source.value)}</option>)}
            </select>
            <div
              className="meta-ai-title-combobox"
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setAiTitleMenuOpen(false);
              }}
            >
              <input
                className="meta-ai-title-input"
                data-ai-title-input="true"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={aiTitleMenuOpen}
                aria-controls="meta-ai-title-options"
                aria-activedescendant={aiTitleMenuOpen ? `meta-ai-title-option-${aiTitleActiveIndex}` : undefined}
                value={dialogQuery}
                onFocus={() => {
                  if (aiTitleCandidates.length > 0) setAiTitleMenuOpen(true);
                }}
                onChange={event => {
                  setDialogQuery(event.target.value);
                  setAiTitleMenuOpen(false);
                }}
                onKeyDown={handleAiTitleInputKeyDown}
              />
              {aiTitleMenuOpen && aiTitleCandidates.length > 0 && (
                <div
                  id="meta-ai-title-options"
                  className="meta-ai-title-options"
                  role="listbox"
                  aria-label={text('meta_ai_title_options', 'AI 제목 후보')}
                >
                  {aiTitleCandidates.map((candidate, index) => (
                    <button
                      key={`${candidate.kind}:${candidate.query}`}
                      id={`meta-ai-title-option-${index}`}
                      type="button"
                      className={`meta-ai-title-option ${index === aiTitleActiveIndex ? 'active' : ''}`}
                      role="option"
                      aria-selected={index === aiTitleActiveIndex}
                      onMouseDown={event => event.preventDefault()}
                      onMouseEnter={() => setAiTitleActiveIndex(index)}
                      onClick={() => selectAiTitleCandidate(candidate)}
                    >
                      <span>{aiTitleKindLabel(candidate.kind)}</span>
                      <strong>{candidate.title}</strong>
                      {candidate.author && <small>({candidate.author})</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => runSearch(1)} disabled={state.loading || !dialogQuery.trim()}><FaIcon name="search" /> {text('btn_search', '검색')} (S)</button>
            <button
              type="button"
              className="meta-api-cache-clear-btn"
              title={text('btn_clear_cache', '검색 캐시 비우기')}
              onClick={clearSearchCache}
              disabled={state.loading || clearingCache}
            >
              <FaIcon name="trash" size={11} />
              {clearingCache ? text('meta_cache_clearing', '삭제 중...') : text('btn_clear_cache', '캐시 비우기')}
            </button>
          </div>
        </div>
        {aiTitleError && <div className="meta-api-header-error">{aiTitleError}</div>}
        {cacheError && <div className="meta-api-header-error">{cacheError}</div>}
        <div className="meta-api-dialog-body">
          <div className="meta-api-results-panel">
          <div className="meta-api-results">
            {state.loading && <div className="meta-api-empty">{text('meta_search_loading', '검색 중...')}</div>}
            {state.error && <div className="meta-api-empty error">{state.error}</div>}
            {!state.loading && !state.error && state.results.length === 0 && <div className="meta-api-empty">{text('meta_search_empty', '검색 결과가 없습니다.')}</div>}
            {state.results.map((result, index) => (
              <button
                key={result.id || `${result.title}-${index}`}
                ref={node => {
                  resultRefs.current[index] = node;
                }}
                type="button"
                className={`meta-api-result ${selectedIndex === index ? 'active' : ''}`}
                aria-selected={selectedIndex === index}
                onClick={() => setSelectedIndex(index)}
              >
                <RemoteCoverImage src={result.coverCacheUrl || result.coverDataUrl || result.coverUrl} className="meta-api-thumb" fallbackClassName="meta-api-no-cover" />
                <span className="meta-api-result-content">
                  <strong>{result.title || '-'}</strong>
                  <span className="meta-api-result-summary">{result.summary || '-'}</span>
                  <span className="meta-api-result-meta">
                    <span>{result.author || '-'}</span>
                    <span>{result.publisher || '-'}</span>
                    <span className="meta-api-rating"><FaIcon name="star" size={11} />{result.rating || '-'}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="meta-api-page-controls">
            <button onClick={() => runSearch(Math.max(1, (state.page || 1) - 1))} disabled={state.loading || (state.page || 1) <= 1}><FaIcon name="chevronLeft" size={10} />{text('api_page_prev', '이전')}</button>
            <span className="meta-api-page-status">
              <strong>{text('api_page_info', `${state.page || 1} 페이지`, { page: state.page || 1 })}</strong>
              <small>{text('search_result_prefix', '검색 결과:')} {state.results.length}{text('search_result_suffix', '건')}</small>
            </span>
            <button onClick={() => runSearch((state.page || 1) + 1)} disabled={state.loading || state.results.length < 20}>{text('api_page_next', '다음')}<FaIcon name="chevronRight" size={10} /></button>
          </div>
          </div>
          <div className="meta-api-preview">
            {selected ? (
              <div className="meta-api-preview-surface">
                <RemoteCoverImage
                  src={selected.coverCacheUrl || selected.coverDataUrl || selected.coverUrl}
                  className="meta-api-preview-background"
                  fallbackClassName="meta-api-preview-background-fallback"
                />
                <div className="meta-api-preview-content">
                  <div className="meta-api-preview-title-row">
                    <h2>{selected.title}</h2>
                    <button
                      type="button"
                      className={`meta-api-translate-btn ${showTranslated ? 'original' : ''}`}
                      disabled={translating}
                      onClick={toggleTranslation}
                    >
                      <FaIcon name={showTranslated ? 'chevronLeft' : 'language'} size={12} />
                      {translating
                        ? text('btn_translating', '번역 중...')
                        : showTranslated
                          ? text('btn_original_web', '원문')
                          : text('btn_translate_web', '번역')}
                    </button>
                  </div>
                  {translationError && <div className="meta-api-translation-error">{translationError}</div>}
                  <div className="meta-api-preview-tags">
                    {selectedTags.map(tag => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="meta-api-preview-main">
                    <RemoteCoverImage src={selected.coverCacheUrl || selected.coverDataUrl || selected.coverUrl} className="meta-api-large-cover" fallbackClassName="meta-api-large-no-cover" size={48} />
                    <div className="meta-api-preview-card">
                      <dl>
                        <dt>{detailLabel('user', text('meta_writer', '작가'))}</dt><dd>{renderValue(metadataValue(selected, 'author', 'Writer'))}</dd>
                        <dt>{detailLabel('building', text('meta_publisher', '출판사'))}</dt><dd>{renderValue(metadataValue(selected, 'publisher', 'Publisher'))}</dd>
                        {(bookType === 'book' || selectedIsbn) && (
                          <>
                            <dt>{detailLabel('tag', text('t3_f_isbn', 'ISBN'))}</dt><dd>{renderValue(selectedIsbn)}</dd>
                          </>
                        )}
                        <dt>{detailLabel('tag', text('meta_genre', '장르'))}</dt><dd>{renderValue(metadataValue(selected, 'Genre'))}</dd>
                        <dt>{detailLabel('layers', text('meta_count', '전체권수'))}</dt><dd>{renderValue(metadataValue(selected, 'Count'))}</dd>
                        <dt>{detailLabel('star', text('meta_rating', '평점'))}</dt><dd>{renderValue(metadataValue(selected, 'rating', 'Rating', 'CommunityRating'), 'meta-api-rating')}</dd>
                        <dt>{detailLabel('child', text('meta_age_rating', '연령등급'))}</dt><dd>{renderValue(metadataValue(selected, 'AgeRating'))}</dd>
                        <dt>{detailLabel('calendar', text('meta_pub_date', '출간일'))}</dt><dd>{renderValue(publicationDate)}</dd>
                        <dt>{detailLabel('link', text('meta_link', '링크'))}</dt>
                        <dd>
                          {link ? (
                            <span
                              className="meta-api-link"
                              role="link"
                              tabIndex={0}
                              onClick={openLink}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openLink();
                                }
                              }}
                            >
                              {link}
                            </span>
                          ) : renderValue('-')}
                        </dd>
                      </dl>
                    </div>
                  </div>
                  <div className="meta-api-summary-card">
                    <h3>{text('meta_summary', '줄거리')}</h3>
                    {renderValue(metadataValue(selected, 'summary', 'Summary'), 'meta-api-long-value')}
                  </div>
                </div>
              </div>
            ) : (
              <div className="meta-api-empty">{text('meta_select_result', '결과를 선택하세요.')}</div>
            )}
          </div>
        </div>
        <div className="meta-api-dialog-footer">
          <div className="meta-api-cache-notice">{text('api_cache_notice', '빠른 표시를 위해 검색 결과는 7일간 캐싱됩니다.')}</div>
          <div className="meta-api-action-controls">
            <button onClick={onClose}><FaIcon name="xmark" size={11} />{text('btn_close', '닫기')}</button>
            {onUseCover && (
              <button
                className="cover"
                disabled={!selected || !selectedCoverUrl}
                onClick={() => selected && onUseCover(selected)}
              >
                <FaIcon name="cloudArrowDown" size={11} />
                {text('btn_use_cover', '표지 사용(X)')}
              </button>
            )}
            <button className="primary" title="C" disabled={!selected} onClick={() => selected && onSelect(selected)}><FaIcon name="check" size={11} />{text('btn_select', '선택')} (C)</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemoteCoverImage({ src, className, fallbackClassName, size = 18 }) {
  const [imageSrc, setImageSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setImageSrc('');
    const url = String(src || '').trim();
    if (!url) return () => { cancelled = true; };

    if (url.startsWith('data:') || url.startsWith('file:') || url.startsWith('bookmanager-thumbnail:')) {
      setImageSrc(url);
      return () => { cancelled = true; };
    }

    window.electronAPI?.fetchImageDataUrl?.(url)
      .then(dataUrl => {
        if (!cancelled && dataUrl) setImageSrc(dataUrl);
        else if (!cancelled) setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [src]);

  if (imageSrc && !failed) {
    return <img src={imageSrc} alt="" className={className} onError={() => setFailed(true)} />;
  }
  return <div className={fallbackClassName}><FaIcon name="bookOpen" size={size} /></div>;
}

export { MetadataTab };
export default MetadataTab;
