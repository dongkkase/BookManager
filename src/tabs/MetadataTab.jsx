import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    const group = item.group || 'Files';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  return [...groups.entries()].map(([name, children]) => ({ name, children }));
}

function MetadataTab({ config, t }) {
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
  };

  const handleCopyMyToBatch = () => {
    if (!activeItem) return;
    setBatchMetadata({ ...(activeItem.metadata || {}) });
  };

  const handleResetActive = () => {
    if (!activeItem) return;
    updateItem(activeItem.id, item => ({ ...item, metadata: { ...(item.originalMetadata || {}) } }));
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
      setStatusMessage(all ? t('msg_job_done', [success, 0, errors]) : (errors ? `${t('msg_failed')}: ${result.stats.error.join(' / ')}` : t('t3_msg_save_single_done')));
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

  const renderActiveSection = () => {
    if (activeSection === 'basic') {
      return (
        <div className="meta-section-stack">
          <div className="meta-section-box">
            <div className="meta-section-title">기본 정보</div>
            {renderFieldRows(BASIC_FIELDS)}
          </div>
        </div>
      );
    }
    if (activeSection === 'creators') {
      return (
        <div className="meta-section-stack">
          <div className="meta-section-box">
            <div className="meta-section-title">작가 및 제작진</div>
            {renderFieldRows(CREATOR_FIELDS)}
          </div>
        </div>
      );
    }
    if (activeSection === 'publisher') {
      return (
        <div className="meta-section-stack">
          <div className="meta-section-box">
            <div className="meta-section-title">출판 정보</div>
            {renderFieldRows(PUBLISHER_FIELDS)}
          </div>
        </div>
      );
    }
    if (activeSection === 'tags') {
      return (
        <div className="meta-section-stack">
          <div className="meta-section-box">
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
          </div>
        </div>
      );
    }
    return (
      <div className="meta-section-stack">
        <div className="meta-section-box">
          <div className="meta-section-title">기타 정보</div>
          {renderFieldRows(OTHER_FIELDS)}
        </div>
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
          <button className="meta-search-btn" disabled title="API 검색은 다음 단계에서 연결됩니다."><FaIcon name="search" /> 검색 (S)</button>
        </div>

        <div className="meta-tools-bar">
          <div className="meta-section-tabs">
            {SECTION_TABS.map(tab => (
              <button
                key={tab.id}
                className={activeSection === tab.id ? 'active' : ''}
                onClick={() => setActiveSection(tab.id)}
              >
                {tab.label.split('\n').map((part, index) => <React.Fragment key={part}>{index > 0 && <br />}{part}</React.Fragment>)}
              </button>
            ))}
          </div>
          <div className="meta-nav-center">
            <button className="meta-nav-btn" disabled={selectedIndex <= 0} onClick={() => setSelectedFileId(fileList[selectedIndex - 1]?.id)}>◀ 이전 권</button>
            <button className="meta-nav-btn" disabled={selectedIndex < 0 || selectedIndex >= fileList.length - 1} onClick={() => setSelectedFileId(fileList[selectedIndex + 1]?.id)}>다음 권 ▶</button>
          </div>
          <div className="meta-spacer" />
          <div className="meta-top-actions">
            <button className="meta-btn" onClick={handleResetActive} disabled={!activeItem}>↻ 시리즈<br />리셋</button>
            <button className="meta-btn" disabled>☁ 최신권 정보<br />불러오기 (D)</button>
            <button className="meta-btn" onClick={handleCopyMyToBatch} disabled={!activeItem}>⧉ 편집창에<br />원본 복사</button>
            <button className="meta-btn-primary" onClick={handleApplyBatchToActive} disabled={!activeItem}>✓ 현재 책에<br />편집 적용</button>
            <button className="meta-btn-primary" onClick={handleApplyBatchToSeries} disabled={!activeItem}>▰ 시리즈 전체에<br />일괄 적용 (C)</button>
            <label className="meta-checkbox-label">
              <input type="checkbox" checked={applyEmpty} onChange={(event) => setApplyEmpty(event.target.checked)} />
              빈 값도 덮어쓰기
            </label>
          </div>
        </div>

        <div className="meta-form-area">
          <div className="meta-form-scroll">
            {renderActiveSection()}
          </div>
        </div>

        <div className="meta-bottom-bar">
          <div className="meta-bottom-left">
            <button className="meta-btn-magic" disabled><FaIcon name="wand" /> 시리즈 자동 매칭</button>
            <button className="meta-btn" disabled>자동 제목 입력</button>
            <button className="meta-btn" disabled>자동 권수 입력</button>
            <button className="meta-btn" disabled>자동 화 입력</button>
            <button className="meta-btn" disabled>자동 페이지 수 입력</button>
          </div>
          <div className="meta-bottom-right">
            <button className="meta-btn-save" onClick={() => handleSave(false)} disabled={!activeItem || isWorking}><FaIcon name="floppy" /> 저장</button>
            <button className="meta-btn-save" onClick={() => handleSave(true)} disabled={checkedCount === 0 || isWorking}><FaIcon name="floppy" /> 모두 저장</button>
          </div>
        </div>

        <div className="meta-status-row">
          <span>{statusMessage}</span>
          {lastResult?.stats?.error?.length ? <span className="meta-error-text">{lastResult.stats.error.join(' / ')}</span> : null}
          <progress value={progress} max="100" />
        </div>
      </main>
      </>
      )}
    </div>
  );
}

export { MetadataTab };
export default MetadataTab;
