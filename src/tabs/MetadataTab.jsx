import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/MetadataTab.css';
import dragDropImage from '../images/draganddrop1.png';

const ARCHIVE_FILTERS = [
  { name: 'Archives', extensions: ['zip', 'cbz', 'cbr', '7z', 'rar'] },
];

const API_SOURCES = ['리디북스', '알라딘', 'Google Books', 'Anilist', 'Vine'];

const SECTION_TABS = [
  { id: 'basic', label: '기본\n정보' },
  { id: 'creators', label: '작가 및\n제작진' },
  { id: 'publisher', label: '출판\n정보' },
  { id: 'tags', label: '장르/태그/\n등장인물' },
  { id: 'other', label: '기타\n정보' },
];

const BASIC_FIELDS = [
  { id: 'Title', label: '제목', type: 'text' },
  { id: 'Series', label: '시리즈', type: 'text' },
  { id: 'SeriesGroup', label: '시리즈 그룹\n(세계관 묶기 등)', type: 'select', options: [''] },
  { id: 'Count', label: '전체권수', type: 'number' },
  { id: 'Volume', label: '권 (Volume)', type: 'text' },
  { id: 'Number', label: '화 (Chapter)', type: 'text' },
  { id: 'PageCount', label: '페이지수', type: 'number' },
  { id: 'Summary', label: '줄거리', type: 'textarea' },
];

const CREATOR_FIELDS = [
  { id: 'Writer', label: '글 작가', type: 'text' },
  { id: 'Penciller', label: '그림 작가', type: 'text' },
  { id: 'Inker', label: '잉크 작업', type: 'text' },
  { id: 'Colorist', label: '채색 작가', type: 'text' },
  { id: 'Letterer', label: '글자 작업', type: 'text' },
  { id: 'CoverArtist', label: '표지 작가', type: 'text' },
  { id: 'Editor', label: '편집자', type: 'text' },
];

const PUBLISHER_FIELDS = [
  { id: 'Publisher', label: '출판사', type: 'text' },
  { id: 'Imprint', label: '출판 레이블', type: 'text' },
  { id: 'Web', label: '웹사이트', type: 'textarea' },
  { id: 'Format', label: '포맷', type: 'select', options: ['', 'Manga', 'Comic', 'Webtoon'] },
  { id: 'Year', label: '년', type: 'number' },
  { id: 'Month', label: '월', type: 'number' },
  { id: 'Day', label: '일', type: 'number' },
];

const OTHER_FIELDS = [
  { id: 'AgeRating', label: '연령 등급', type: 'select', options: ['', 'Everyone', 'Teen', 'Mature', 'Adult'] },
  { id: 'CommunityRating', label: '커뮤니티 평점', type: 'text' },
  { id: 'LanguageISO', label: '언어 코드 (ISO)', type: 'text' },
  { id: 'Manga', label: '읽기 방향', type: 'select', options: ['', 'YesAndRightToLeft', 'Yes', 'No', 'RightToLeft'] },
  { id: 'Notes', label: '메모', type: 'textarea' },
];

const META_FIELDS = [
  ...BASIC_FIELDS,
  ...CREATOR_FIELDS,
  ...PUBLISHER_FIELDS,
  { id: 'Genre', label: '장르', type: 'text' },
  { id: 'Tags', label: '태그', type: 'text' },
  { id: 'Characters', label: '등장인물', type: 'text' },
  { id: 'Locations', label: '장소', type: 'text' },
  { id: 'Teams', label: '소속 팀', type: 'text' },
  ...OTHER_FIELDS,
];

const GENRE_OPTIONS = [
  '액션', '모험', '코미디', '드라마', '판타지',
  'SF', '미스터리', '공포', '스릴러', '심리',
  '로맨스', '일상', '학원', '스포츠', '역사',
  '군사', '범죄', '추리', '초자연', '마법',
  '이세계', '포스트 아포칼립스', '사이버펑크', '메카', '무협',
  '사무라이', '닌자', '요리', '의료', '음악',
  '게임', '도박', '생존', '비극', '패러디',
];

const TAG_OPTIONS = [
  '복수', '토너먼트', '퀘스트', '여행', '수사',
  '변치 작전', '생존', '시간 여행', '타임 루프', '평행세계',
  '환생', '회귀', '빙의', '안티히어로', '악역 주인공',
  '천재 주인공', '먼치킨', '약자 성장형', '선택받은 자', '스승',
  '라이벌', '팀워크', '의형제', '가족', '마법 체계',
  '길드', '던전', '아카데미', '왕국', '제국',
  '수련', '무림', '멸망 세계', '사이보그', '우주 여행',
  '우정', '배신', '삼각관계', '짝사랑',
];

function isMetadataTextInput(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function shortcutCode(event) {
  if (/^Key[A-Z]$/.test(event.code || '')) return event.code;
  return `Key${String(event.key || '').toUpperCase()}`;
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

function hasPrimaryModifier(event) {
  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
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
  const [fileList, setFileList] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [apiSource, setApiSource] = useState(config?.last_meta_api || '리디북스');
  const [applyEmpty, setApplyEmpty] = useState(false);
  const [activeSection, setActiveSection] = useState('basic');
  const [batchMetadata, setBatchMetadata] = useState({});
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(t('status_wait'));
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [apiSearch, setApiSearch] = useState({ open: false, loading: false, results: [], error: '', actualQuery: '', page: 1, apiSource: config?.last_meta_api || '리디북스', query: '', cached: false });
  const primaryShortcut = isMacPlatform() ? 'Cmd' : 'Ctrl';
  const formScrollRef = useRef(null);
  const sectionRefs = useRef({});
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
    () => fileList.find(item => item.id === selectedFileId) || fileList[0] || null,
    [fileList, selectedFileId]
  );
  const groupedItems = useMemo(() => groupItems(fileList), [fileList]);
  const selectedIndex = activeItem ? fileList.findIndex(item => item.id === activeItem.id) : -1;
  const checkedCount = useMemo(() => fileList.filter(item => item.checked !== false).length, [fileList]);

  useEffect(() => {
    if (activeItem && selectedFileId !== activeItem.id) setSelectedFileId(activeItem.id);
    if (activeItem) setSearchQuery(activeItem.metadata?.Series || activeItem.metadata?.Title || activeItem.name.replace(/\.[^.]+$/, ''));
  }, [activeItem, selectedFileId]);

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
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('t3_msg_analyzing'));

    try {
      const result = await window.electronAPI.analyzeMetadata(cleanPaths, {
        lang: config?.language || config?.lang || 'ko',
      });
      const items = result.items || [];
      setFileList(prev => {
        const byPath = new Map(prev.map(item => [item.filepath, item]));
        for (const item of items) byPath.set(item.filepath, item);
        return [...byPath.values()];
      });
      if (items[0]) setSelectedFileId(items[0].id);
      if (result.skippedFiles?.length) {
        setStatusMessage(`${t('msg_unsupported_format')}: ${result.skippedFiles.join(', ')}`);
      } else {
        setStatusMessage(t('msg_done'));
      }
    } catch (error) {
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  }, [config?.language, config?.lang, t]);

  const handleSelectFiles = useCallback(async () => {
    const paths = await window.electronAPI.selectFiles(t('add_file'), ARCHIVE_FILTERS);
    await analyzePaths(paths);
  }, [analyzePaths, t]);

  const handleSelectFolder = useCallback(async () => {
    const folderPath = await window.electronAPI.selectFolder(t('add_folder'));
    if (folderPath) await analyzePaths([folderPath]);
  }, [analyzePaths, t]);

  const handleDrop = useCallback(async (event) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files || [])
      .map(file => file.path)
      .filter(Boolean);
    await analyzePaths(paths);
  }, [analyzePaths]);

  const handleClear = useCallback(() => {
    setFileList([]);
    setSelectedFileId(null);
    setBatchMetadata({});
    setLastResult(null);
    setStatusMessage(t('status_wait'));
    setProgress(0);
  }, [t]);

  const handleRemoveChecked = useCallback(() => {
    setFileList(prev => {
      const next = prev.filter(item => item.checked === false);
      if (!next.some(item => item.id === selectedFileId)) {
        setSelectedFileId(next[0]?.id || null);
      }
      return next;
    });
  }, [selectedFileId]);

  const handleToggleAllChecked = useCallback(() => {
    setFileList(prev => {
      const allChecked = prev.length > 0 && prev.every(item => item.checked !== false);
      return prev.map(item => ({ ...item, checked: allChecked ? false : true }));
    });
  }, []);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
  }, []);

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
      for (const field of META_FIELDS) {
        const value = batchMetadata[field.id];
        if (applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '')) {
          metadata[field.id] = value || '';
        }
      }
      return { ...item, metadata };
    });
    showToast?.(t('t3_msg_applied_series_tag'));
  };

  const getCommaValues = (value) => String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  const toggleCommaValue = (target, fieldId, option) => {
    const source = target === 'batch' ? batchMetadata : activeItem?.metadata;
    const values = new Set(getCommaValues(source?.[fieldId]));
    if (values.has(option)) values.delete(option);
    else values.add(option);
    const nextValue = [...values].join(', ');
    if (target === 'batch') updateBatchMetadata(fieldId, nextValue);
    else updateActiveMetadata(fieldId, nextValue);
  };

  const handleApplyBatchToSeries = () => {
    const hasBatchData = META_FIELDS.some(field => {
      const value = batchMetadata[field.id];
      return applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '');
    });
    if (!hasBatchData) {
      showToast?.(t('t3_msg_no_data_copy'));
      return;
    }
    setFileList(prev => prev.map(item => {
      if (!activeItem || item.group !== activeItem.group) return item;
      const metadata = { ...(item.metadata || {}) };
      for (const field of META_FIELDS) {
        const value = batchMetadata[field.id];
        if (applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '')) {
          metadata[field.id] = value || '';
        }
      }
      return { ...item, metadata };
    }));
    showToast?.(t('t3_msg_applied_series_all'));
  };

  const handleCopyMyToBatch = () => {
    if (!activeItem) return;
    setBatchMetadata({ ...(activeItem.metadata || {}) });
  };

  const handleResetActive = () => {
    if (!activeItem) return;
    updateItem(activeItem.id, item => ({ ...item, metadata: { ...(item.originalMetadata || {}) } }));
    showToast?.((config?.language || config?.lang) === 'ko' ? '시리즈 데이터가 초기화되었습니다.' : 'Series reset complete.');
  };

  const applyMetadataToBatch = (metadata = {}) => {
    setBatchMetadata(prev => ({ ...prev, ...normalizeMetadata(metadata) }));
  };

  const applyMetadataToSeries = (metadata = {}) => {
    if (!activeItem) return;
    const normalized = normalizeMetadata(metadata);
    setFileList(prev => prev.map(item => item.group === activeItem.group ? {
      ...item,
      metadata: { ...(item.metadata || {}), ...normalized },
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

  const normalizeMetadata = useCallback((metadata = {}) => ({
    ...metadata,
    Genre: normalizeTagText(metadata.Genre),
    Tags: normalizeTagText(metadata.Tags),
  }), [normalizeTagText]);

  const fetchMetadataResults = useCallback(async ({ source = apiSource, query = searchQuery, page = 1 } = {}) => {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return;
    const keyMap = { '알라딘': 'aladin', 'Google Books': 'google', Vine: 'vine' };
    const requiredKey = keyMap[source];
    if (requiredKey && !String(config?.api_keys?.[requiredKey] || '').trim()) {
      setApiSearch(prev => ({
        ...prev,
        open: true,
        loading: false,
        results: [],
        error: '환경설정에서 API 키를 입력해주세요.',
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
        apiKeys: config?.api_keys || {},
      });
      if (result?.success === false) {
        setApiSearch(prev => ({
          ...prev,
          open: true,
          loading: false,
          results: [],
          error: result.error || '검색에 실패했습니다.',
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
  }, [apiSource, config?.api_keys, searchQuery]);

  const handleSearchApi = async (page = 1) => {
    const query = searchQuery.trim();
    if (!query) {
      setStatusMessage('검색어를 입력하세요.');
      showToast?.((config?.language || config?.lang) === 'ko' ? '검색어를 입력해주세요.' : 'Please enter a search keyword.');
      return;
    }
    await fetchMetadataResults({ source: apiSource, query, page });
  };

  const handleSelectApiResult = (result) => {
    applyMetadataToBatch(result.metadata || {});
    setApiSearch(prev => ({ ...prev, open: false }));
    setStatusMessage('검색 결과를 일괄 편집창에 불러왔습니다.');
    showToast?.(t('t3_msg_applied_series_tag'));
  };

  const filenameStem = (name = '') => String(name).replace(/\.[^.]+$/, '');

  const inferTitleParts = (item) => {
    const stem = filenameStem(item.name || item.filepath || '');
    const volumeMatch = stem.match(/(?:^|[\s_-])(?:v|vol\.?|volume)?\s*(\d+(?:\.\d+)?)\s*권?/i);
    const chapterMatch = stem.match(/(?:^|[\s_-])(?:ch\.?|chapter|화)\s*(\d+(?:\.\d+)?)/i);
    const series = stem
      .replace(/\s*(?:v|vol\.?|volume)?\s*\d+(?:\.\d+)?\s*권?/i, '')
      .replace(/\s*(?:ch\.?|chapter|화)\s*\d+(?:\.\d+)?/i, '')
      .trim() || stem;
    return {
      Title: stem,
      Series: series,
      Volume: volumeMatch?.[1] || '',
      Number: chapterMatch?.[1] || '',
      PageCount: item.pageCount ? String(item.pageCount) : '',
    };
  };

  const applyAutoFieldToSeries = (field) => {
    if (!activeItem) return;
    setFileList(prev => prev.map(item => {
      if (item.group !== activeItem.group) return item;
      const inferred = inferTitleParts(item);
      return {
        ...item,
        metadata: {
          ...(item.metadata || {}),
          [field]: inferred[field] || item.metadata?.[field] || '',
        },
      };
    }));
    const messageKey = {
      Title: 't3_msg_auto_title_done',
      Volume: 't3_msg_auto_vol_done',
      Number: 't3_msg_auto_chap_done',
      PageCount: 't3_msg_auto_pages_done',
    }[field];
    if (messageKey) showToast?.(t(messageKey));
  };

  const handleAutoMatchSeries = async () => {
    if (!activeItem) return;
    const query = activeItem.metadata?.Series || activeItem.metadata?.Title || filenameStem(activeItem.name);
    setSearchQuery(query);
    setIsWorking(true);
    setStatusMessage('시리즈 자동 매칭 중...');
    try {
      const result = await window.electronAPI.fetchMetadata({
        apiSource,
        query,
        page: 1,
        apiKeys: config?.api_keys || {},
      });
      if (result?.success === false) {
        setStatusMessage(result.error || '자동 매칭에 실패했습니다.');
        return;
      }
      const first = result.results?.[0];
      if (!first) {
        setStatusMessage('자동 매칭 결과가 없습니다.');
        showToast?.(t('t3_msg_no_search_result'));
        return;
      }
      applyMetadataToSeries(first.metadata || {});
      setBatchMetadata(first.metadata || {});
      setStatusMessage('시리즈 자동 매칭을 적용했습니다.');
      showToast?.(t('t3_msg_auto_match_done'));
    } catch (error) {
      setStatusMessage(`자동 매칭 실패: ${error.message}`);
    } finally {
      setIsWorking(false);
    }
  };

  const resolveRidiPublishDate = useCallback(async (result) => {
    const bookId = result?.id || result?.b_id;
    if (!bookId || result?.metadata?.PubDate || result?.PubDate) return;
    const pubDate = await window.electronAPI?.fetchRidiPublishDate?.(bookId);
    if (!pubDate) return;
    const [year = '', month = '', day = ''] = String(pubDate).split('-');
    setApiSearch(prev => ({
      ...prev,
      results: prev.results.map(item => (
        (item.id || item.b_id) === bookId
          ? {
              ...item,
              PubDate: pubDate,
              Year: year,
              Month: month ? String(Number(month)) : '',
              Day: day ? String(Number(day)) : '',
              metadata: {
                ...(item.metadata || {}),
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
    const groupItems = fileList.filter(item => item.group === activeItem.group);
    const latest = [...groupItems].sort((a, b) => {
      const av = Number(a.metadata?.Volume || 0);
      const bv = Number(b.metadata?.Volume || 0);
      return bv - av;
    }).find(item => item.id !== activeItem.id && item.metadata && Object.keys(item.metadata).length > 0);
    if (!latest) {
      setStatusMessage('불러올 최신권 메타데이터가 없습니다.');
      showToast?.('불러올 최신권 메타데이터가 없습니다.');
      return;
    }
    setBatchMetadata({ ...(latest.metadata || {}) });
    setStatusMessage('최신권 메타데이터를 일괄 편집창에 불러왔습니다.');
    showToast?.('최신권 메타데이터를 일괄 편집창에 불러왔습니다.');
  };

  const handleSave = async (all = false) => {
    const targets = all ? fileList : activeItem ? [activeItem] : [];
    if (targets.length === 0) {
      setStatusMessage(t('msg_no_targets'));
      return;
    }

    setIsWorking(true);
    setProgress(0);
    setLastResult(null);
    setStatusMessage(t('msg_processing_overlay'));

    try {
      const result = await window.electronAPI.saveMetadata(targets, {
        lang: config?.language || config?.lang || 'ko',
      });
      setLastResult(result);
      const success = result.stats?.success?.length || 0;
      const errors = result.stats?.error?.length || 0;
      const message = all
        ? t('t3_msg_save_all_done', { success_count: success, fail_count: errors })
        : (errors ? `${t('msg_failed')}: ${result.stats.error.join(' / ')}` : t('t3_msg_save_single_done'));
      setStatusMessage(message);
      showToast?.(message);
      if (success > 0 && config?.play_sound !== false) {
        window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav');
      }
    } catch (error) {
      setStatusMessage(`${t('msg_failed')}: ${error.message}`);
    } finally {
      setProgress(100);
      setIsWorking(false);
    }
  };

  const bumpField = (fieldId, delta, target = 'active') => {
    const source = target === 'batch' ? batchMetadata : activeItem?.metadata;
    const current = Number.parseInt(source?.[fieldId] || '0', 10) || 0;
    const next = Math.max(0, current + delta);
    if (target === 'batch') updateBatchMetadata(fieldId, String(next));
    else updateActiveMetadata(fieldId, String(next));
  };

  useEffect(() => {
    const handleAppAction = (event) => {
      const action = event.detail?.action;
      if (isWorking) return;
      if (action === 'add-folder') handleSelectFolder();
      else if (action === 'add-file') handleSelectFiles();
      else if (action === 'remove-selected') handleRemoveChecked();
      else if (action === 'clear-all') handleClear();
      else if (action === 'toggle-all') handleToggleAllChecked();
    };

    window.addEventListener('bookmanager:action', handleAppAction);
    return () => window.removeEventListener('bookmanager:action', handleAppAction);
  }, [handleClear, handleRemoveChecked, handleSelectFiles, handleSelectFolder, handleToggleAllChecked, isWorking]);

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
      return <textarea className={className} rows="3" value={value || ''} onChange={event => onChange(event.target.value)} />;
    }
    if (field.type === 'select') {
      return (
        <select className={className} value={value || ''} onChange={event => onChange(event.target.value)}>
          {field.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    return <input type="text" className={className} value={value || ''} onChange={event => onChange(event.target.value)} />;
  };

  const renderFieldRows = (fields) => (
    fields.map((field) => (
      <div className={`meta-form-row ${field.type === 'textarea' ? 'tall' : ''}`} key={field.id}>
        <div className="meta-col-label">{field.label}</div>
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
          <button className="meta-copy-btn" onClick={() => handleCopyField(field.id)} disabled={!activeItem}>‹</button>
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

  const renderDualTextarea = (fieldId, label, placeholder = '입력 후 Enter...') => (
    <div className="meta-tag-editor">
      <div className="meta-tag-label">{label}</div>
      <div className="meta-tag-columns">
        <textarea
          className="meta-input meta-tag-box"
          placeholder={placeholder}
          value={activeItem?.metadata?.[fieldId] || ''}
          onChange={event => updateActiveMetadata(fieldId, event.target.value)}
        />
        <button className="meta-copy-btn" onClick={() => handleCopyField(fieldId)} disabled={!activeItem}>‹</button>
        <textarea
          className="meta-input res meta-tag-box"
          value={batchMetadata[fieldId] || ''}
          onChange={event => updateBatchMetadata(fieldId, event.target.value)}
        />
      </div>
      <button
        className="meta-series-apply-btn"
        onClick={() => {
          if (!activeItem) return;
          const value = batchMetadata[fieldId] || activeItem.metadata?.[fieldId] || '';
          setFileList(prev => prev.map(item => item.group === activeItem.group ? {
            ...item,
            metadata: { ...(item.metadata || {}), [fieldId]: value },
          } : item));
        }}
        disabled={!activeItem}
      >
        시리즈 전체 일괄 덮어쓰기
      </button>
    </div>
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

  const scrollToSection = (sectionId) => {
    setActiveSection(sectionId);
    const section = sectionRefs.current[sectionId];
    const scroller = formScrollRef.current;
    if (!section || !scroller) return;
    scroller.scrollTo({ top: section.offsetTop - 8, behavior: 'smooth' });
  };

  const renderAllSections = () => {
    const setRef = id => node => {
      if (node) sectionRefs.current[id] = node;
    };
    return (
      <div className="meta-section-stack">
        <section className="meta-section-box" ref={setRef('basic')}>
          <div className="meta-section-title">기본 정보</div>
          <div className="meta-column-heads"><span /> <b>원본</b><span /> <b>일괄 편집</b></div>
          {renderFieldRows(BASIC_FIELDS)}
        </section>

        <section className="meta-section-box" ref={setRef('creators')}>
          <div className="meta-section-title">작가 및 제작진</div>
          {renderFieldRows(CREATOR_FIELDS)}
        </section>

        <section className="meta-section-box" ref={setRef('publisher')}>
          <div className="meta-section-title">출판 정보</div>
          {renderFieldRows(PUBLISHER_FIELDS)}
        </section>

        <section className="meta-section-box" ref={setRef('tags')}>
          <div className="meta-section-title">장르/태그/등장인물</div>
          <div className="meta-choice-row">
            <div className="meta-tag-label">장르</div>
            {renderChoiceGrid('Genre', GENRE_OPTIONS)}
          </div>
          {renderDualTextarea('Genre', '장르')}
          <div className="meta-choice-row">
            <div className="meta-tag-label">태그</div>
            {renderChoiceGrid('Tags', TAG_OPTIONS)}
          </div>
          {renderDualTextarea('Tags', '태그')}
          {renderDualTextarea('Characters', '등장인물')}
          {renderDualTextarea('Locations', '장소')}
          {renderDualTextarea('Teams', '소속 팀')}
        </section>

        <section className="meta-section-box" ref={setRef('other')}>
          <div className="meta-section-title">기타 정보</div>
          {renderFieldRows(OTHER_FIELDS)}
        </section>
      </div>
    );
  };

  return (
    <div className="metadata-tab" onDrop={handleDrop} onDragOver={handleDragOver}>
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

        <div className="meta-tree-container">
          <ul className="meta-tree">
              {groupedItems.map((dir) => (
                <li key={dir.name} className="meta-tree-dir">
                  <span className="meta-tree-icon"><FaIcon name="folder" /></span> {dir.name}
                  <ul>
                    {dir.children.map((file) => (
                      <li
                        key={file.id}
                        className={`meta-tree-file ${activeItem?.id === file.id ? 'selected' : ''}`}
                        onClick={() => setSelectedFileId(file.id)}
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
                        <span className="meta-tree-icon"><FaIcon name="archive" /></span>
                        {file.hasComicInfo ? '✓ ' : ''}
                        {file.name}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </div>
      </aside>

      <main className="meta-right-panel">
        <div className="meta-search-bar">
          <span className="meta-search-label">검색 API :</span>
          <select className="meta-api-select" value={apiSource} onChange={(event) => setApiSource(event.target.value)}>
            {API_SOURCES.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
          <span className="meta-search-label">검색어 :</span>
          <input
            type="text"
            className="meta-search-input"
            placeholder={t('meta_search_title')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="meta-search-btn" onClick={() => handleSearchApi(1)} disabled={isWorking || !searchQuery.trim()}><FaIcon name="search" /> 검색 (S)</button>
        </div>

        <div className="meta-tools-bar">
          <div className="meta-section-tabs">
            {SECTION_TABS.map(tab => (
              <button
                key={tab.id}
                className={activeSection === tab.id ? 'active' : ''}
                onClick={() => scrollToSection(tab.id)}
              >
                {tab.label.split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}
              </button>
            ))}
          </div>
          <div className="meta-nav-center">
            <button className="meta-nav-btn" disabled={selectedIndex <= 0} onClick={() => setSelectedFileId(fileList[selectedIndex - 1]?.id)}>
              <FaIcon name="chevronLeft" size={9} />
              <span>이전 권</span>
            </button>
            <button className="meta-nav-btn" disabled={selectedIndex < 0 || selectedIndex >= fileList.length - 1} onClick={() => setSelectedFileId(fileList[selectedIndex + 1]?.id)}>
              <span>다음 권</span>
              <FaIcon name="chevronRight" size={9} />
            </button>
          </div>
          <div className="meta-top-actions">
            <div className="meta-top-action-buttons">
              <button className="meta-btn" onClick={handleResetActive} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="arrowRotateLeft" size={12} /></span>
                <span className="meta-tool-text">시리즈<br />리셋</span>
              </button>
              <button className="meta-btn" title="D" onClick={handleLoadLatest} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="cloudArrowDown" size={12} /></span>
                <span className="meta-tool-text">최신권 정보<br />불러오기 (D)</span>
              </button>
              <button className="meta-btn" onClick={handleCopyMyToBatch} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="copy" size={12} /></span>
                <span className="meta-tool-text">편집창에<br />원본 복사</span>
              </button>
              <button className="meta-btn-primary" onClick={handleApplyBatchToActive} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="check" size={12} /></span>
                <span className="meta-tool-text">현재 책에<br />편집 적용</span>
              </button>
              <button className="meta-btn-primary" title="C" onClick={handleApplyBatchToSeries} disabled={!activeItem}>
                <span className="meta-tool-icon"><FaIcon name="layer-group" size={12} /></span>
                <span className="meta-tool-text">시리즈 전체에<br />일괄 적용 (C)</span>
              </button>
            </div>
            <label className="meta-checkbox-label">
              <input type="checkbox" checked={applyEmpty} onChange={(event) => setApplyEmpty(event.target.checked)} />
              빈 값도 덮어쓰기
            </label>
          </div>
        </div>

        <div className="meta-form-area">
          <div className="meta-form-scroll" ref={formScrollRef}>
            {renderAllSections()}
          </div>
        </div>

        <div className="meta-bottom-bar">
          <div className="meta-bottom-left">
            <button className="meta-btn-magic" onClick={handleAutoMatchSeries} disabled={!activeItem || isWorking}><FaIcon name="wand" /> 시리즈 자동 매칭</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Title')} disabled={!activeItem}>자동 제목 입력</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Volume')} disabled={!activeItem}>자동 권수 입력</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('Number')} disabled={!activeItem}>자동 화 입력</button>
            <button className="meta-btn" onClick={() => applyAutoFieldToSeries('PageCount')} disabled={!activeItem}>자동 페이지 수 입력</button>
          </div>
          <div className="meta-bottom-right">
            <button className="meta-btn-save" title={`${primaryShortcut}+S`} onClick={() => handleSave(false)} disabled={!activeItem || isWorking}><FaIcon name="floppy" /> 저장</button>
            <button className="meta-btn-save" title={`${primaryShortcut}+Shift+S`} onClick={() => handleSave(true)} disabled={checkedCount === 0 || isWorking}><FaIcon name="floppy" /> 모두 저장</button>
          </div>
        </div>

        <div className="meta-status-row">
          <span>{statusMessage}</span>
          {lastResult?.stats?.error?.length ? <span className="meta-error-text">{lastResult.stats.error.join(' / ')}</span> : null}
          <progress value={progress} max="100" />
        </div>
      </main>
      {apiSearch.open && (
        <MetadataSearchDialog
          state={apiSearch}
          apiSource={apiSource}
          apiSources={API_SOURCES}
          t={t}
          onClose={() => setApiSearch(prev => ({ ...prev, open: false }))}
          onSelect={handleSelectApiResult}
          onSearch={fetchMetadataResults}
          onResolveRidiDate={resolveRidiPublishDate}
          targetLang={config?.language || config?.lang || 'ko'}
          minWidth={config?.metadata_search_min_width}
          minHeight={config?.metadata_search_min_height}
          showToast={showToast}
        />
      )}
      </>
      )}
    </div>
  );
}

function MetadataSearchDialog({
  state,
  apiSources,
  onClose,
  onSelect,
  onSearch,
  onResolveRidiDate,
  targetLang = 'ko',
  minWidth = 1050,
  minHeight = 780,
  t,
  showToast,
}) {
  const dialogRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dialogApi, setDialogApi] = useState(state.apiSource || apiSources[0]);
  const [dialogQuery, setDialogQuery] = useState(state.query || state.actualQuery || '');
  const [translatedResult, setTranslatedResult] = useState(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheError, setCacheError] = useState('');
  const resolvingRidiDates = useRef(new Set());
  const rawSelected = state.results[selectedIndex];
  const selected = showTranslated && translatedResult ? translatedResult : rawSelected;

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
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [state.apiSource, state.page, state.query]);

  useEffect(() => {
    setTranslatedResult(null);
    setShowTranslated(false);
    setTranslating(false);
    setTranslationError('');
  }, [rawSelected?.id, state.apiSource]);

  useEffect(() => {
    setDialogApi(state.apiSource || apiSources[0]);
    setDialogQuery(state.query || state.actualQuery || '');
  }, [apiSources, state.actualQuery, state.apiSource, state.query]);

  useEffect(() => {
    if (state.apiSource !== '리디북스' || !selected || selected.PubDate || selected.metadata?.PubDate) return;
    const bookId = selected.id || selected.b_id;
    if (!bookId || resolvingRidiDates.current.has(bookId)) return;
    resolvingRidiDates.current.add(bookId);
    Promise.resolve(onResolveRidiDate?.(selected)).finally(() => resolvingRidiDates.current.delete(bookId));
  }, [onResolveRidiDate, selected, state.apiSource]);

  const runSearch = (page = 1) => {
    onSearch({ source: dialogApi, query: dialogQuery, page });
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
      showToast?.(text('msg_cache_cleared', '검색 캐시 및 표지 이미지가 모두 초기화되었습니다.'));
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
        throw new Error('번역 기능을 불러오지 못했습니다. BookManager를 완전히 종료한 뒤 다시 실행해주세요.');
      }
      const response = await window.electronAPI.translateMetadata(rawSelected, targetLang);
      if (response === undefined || response === null) {
        throw new Error('번역 IPC에서 응답이 없습니다. BookManager를 완전히 종료한 뒤 다시 실행해주세요.');
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

  const metadataValue = (item, key, ...aliases) => {
    const candidates = [item?.[key], item?.metadata?.[key], ...aliases.map(alias => item?.[alias] ?? item?.metadata?.[alias])];
    return candidates.find(value => value !== undefined && value !== null && String(value).trim() !== '') || '';
  };

  const publicationDate = selected && (
    metadataValue(selected, 'PubDate')
    || [metadataValue(selected, 'Year'), metadataValue(selected, 'Month'), metadataValue(selected, 'Day')].filter(Boolean).join('-')
  );
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

  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isMetadataTextInput(event.target)) return;
      const code = shortcutCode(event);
      if (code === 'KeyS' && !state.loading && dialogQuery.trim()) {
        event.preventDefault();
        event.stopPropagation();
        runSearch(1);
      } else if (code === 'KeyC' && selected) {
        event.preventDefault();
        event.stopPropagation();
        onSelect(selected);
      }
    };

    window.addEventListener('keydown', handleShortcut, true);
    return () => window.removeEventListener('keydown', handleShortcut, true);
  }, [dialogApi, dialogQuery, onSearch, onSelect, selected, state.loading]);

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
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="meta-api-dialog-header">
          <div className="meta-api-dialog-heading">
            <div className="meta-api-dialog-query">{state.actualQuery}</div>
          </div>
          <div className="meta-api-search-controls">
            <select value={dialogApi} onChange={event => setDialogApi(event.target.value)}>
              {apiSources.map(source => <option key={source} value={source}>{source}</option>)}
            </select>
            <input
              value={dialogQuery}
              onChange={event => setDialogQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') runSearch(1);
              }}
            />
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
                className={`meta-api-result ${selectedIndex === index ? 'active' : ''}`}
                onClick={() => setSelectedIndex(index)}
              >
                <RemoteCoverImage src={result.coverDataUrl || result.coverUrl} className="meta-api-thumb" fallbackClassName="meta-api-no-cover" />
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
                  src={selected.coverDataUrl || selected.coverUrl}
                  className="meta-api-preview-background"
                  fallbackClassName="meta-api-preview-background-fallback"
                />
                <div className="meta-api-preview-content">
                  <div className="meta-api-preview-title-row">
                    <h2>{selected.title}</h2>
                    {(state.apiSource === 'Anilist' || state.apiSource === 'Vine') && (
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
                    )}
                  </div>
                  {translationError && <div className="meta-api-translation-error">{translationError}</div>}
                  <div className="meta-api-preview-tags">
                    {selectedTags.map(tag => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="meta-api-preview-main">
                    <RemoteCoverImage src={selected.coverDataUrl || selected.coverUrl} className="meta-api-large-cover" fallbackClassName="meta-api-large-no-cover" size={48} />
                    <div className="meta-api-preview-card">
                      <dl>
                        <dt>{detailLabel('user', text('meta_writer', '작가'))}</dt><dd>{renderValue(metadataValue(selected, 'author', 'Writer'))}</dd>
                        <dt>{detailLabel('building', text('meta_publisher', '출판사'))}</dt><dd>{renderValue(metadataValue(selected, 'publisher', 'Publisher'))}</dd>
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

    if (url.startsWith('data:') || url.startsWith('file:')) {
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
