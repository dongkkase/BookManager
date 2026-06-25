import React from 'react';
import { FaIcon } from './FaIcon';
import { normalizeSettingsConfig, safeThreadLimit, uniquePaths } from '../settingsPolicy';
import {
  BOOK_METADATA_API_SOURCES,
  COMIC_METADATA_API_SOURCES,
  normalizeMetadataApiSourceForBookType,
} from '../metadataApiPolicy';
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
const FONT_SCALES = Array.from({ length: 16 }, (_, index) => 80 + index * 5);
const DEFAULT_API_KEYS = {
  aladin: '',
  vine: '',
  google: '',
  ai_trans_enabled: false,
  ai_provider: 'Gemini',
  ai_key: '',
  tag_rules: '',
};

function safeThreadMax() {
  return safeThreadLimit(navigator.hardwareConcurrency || 4);
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
    favorites: [],
    folder_favorites: [],
    pass_skip_meta: false,
    completion_sound: 'Default.wav',
    font_family: 'Default',
    font_scale: 100,
    last_meta_api: '리디북스',
    preferred_meta_api_comic: '리디북스',
    preferred_meta_api_book: '리디북스',
    metadata_search_min_width: 1050,
    metadata_search_min_height: 780,
    ...(config || {}),
    api_keys: {
      ...DEFAULT_API_KEYS,
      ...(config?.api_keys || {}),
    },
  }, navigator.hardwareConcurrency || 4);
}

function SettingsModal({ isOpen = true, onClose, config, onSave, t, showToast, initialTab = 'basic', onLanguagePreviewChange }) {
  const [localConfig, setLocalConfig] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState('basic');
  const [showSecrets, setShowSecrets] = React.useState({});
  const [maintenanceMessage, setMaintenanceMessage] = React.useState('');
  const [maintenanceBusy, setMaintenanceBusy] = React.useState('');
  const [selectedDupFolder, setSelectedDupFolder] = React.useState('');
  const [soundOptions, setSoundOptions] = React.useState(['Default.wav']);
  const [showApiManual, setShowApiManual] = React.useState(false);
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
    if (isOpen) {
      setLocalConfig(normalizeConfig(config));
      setActiveTab(initialTab);
    }
  }, [config, initialTab, isOpen]);

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

  const handleSelectViewer = async () => {
    const filePath = await window.electronAPI?.selectFile?.(label('viewer_lbl', '뷰어 프로그램'), []);
    if (filePath) handleChange('viewer_path', filePath);
  };

  const handleAddDupFolder = async () => {
    const folderPath = await window.electronAPI?.selectFolder?.(label('dlg_sel_dup_folder', '라이브러리 폴더 선택'));
    if (!folderPath) return;
    setLocalConfig(prev => {
      const folders = uniquePaths(prev.libraries || [], prev.dup_check_folders || [], [folderPath]);
      return { ...prev, libraries: folders, dup_check_folders: folders };
    });
  };

  const handleRemoveDupFolder = (folderPath) => {
    setLocalConfig(prev => ({
      ...prev,
      libraries: (prev.libraries || []).filter(folder => folder !== folderPath),
      dup_check_folders: (prev.dup_check_folders || []).filter(folder => folder !== folderPath),
    }));
    setSelectedDupFolder('');
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
                <select className="settings-select" value={localConfig.font_family || 'Default'} onChange={event => handleChange('font_family', event.target.value)}>
                  <option value="Default">Default</option>
                  <option value="Jua">Jua</option>
                  <option value="Noto Sans KR">Noto Sans KR</option>
                  <option value="Segoe UI">Segoe UI</option>
                  <option value="Arial">Arial</option>
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

              <div className="settings-row">
                <span className="settings-label">{label('viewer_lbl', '뷰어 프로그램:')}</span>
                <div className="settings-path-row">
                  <input className="settings-input" value={localConfig.viewer_path || ''} placeholder={label('viewer_placeholder', '뷰어 프로그램 경로를 선택하세요')} readOnly />
                  <button className="settings-action-btn" onClick={handleSelectViewer}>{label('btn_find', '찾기')}</button>
                </div>
              </div>
              </fieldset>
            </div>
          )}

          {activeTab === 'folder' && (
            <div className="settings-panel">
              <fieldset className="settings-fieldset">
              <legend>{t('grp_dup_folders_title')}</legend>
              <p className="settings-help">{t('dup_folder_desc')}</p>
              <div className="settings-list">
                {(localConfig.dup_check_folders || []).length === 0 ? (
                  <div className="settings-empty-list">{t('tf_empty_no_data')}</div>
                ) : localConfig.dup_check_folders.map(folder => (
                  <div
                    className={`settings-list-item ${selectedDupFolder === folder ? 'active' : ''}`}
                    key={folder}
                    onClick={() => setSelectedDupFolder(folder)}
                  >
                    <span title={folder}>{folder}</span>
                  </div>
                ))}
              </div>
              <div className="settings-list-actions">
                <button className="settings-action-btn" onClick={handleAddDupFolder}>{label('btn_add', '추가')}</button>
                <button className="settings-action-btn" onClick={() => handleRemoveDupFolder(selectedDupFolder)} disabled={!selectedDupFolder}>{label('btn_remove', '삭제')}</button>
              </div>
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
              <p className="settings-help">{label('preferred_search_api_desc', '선택한 값은 메타데이터 관리의 검색 API 드롭다운 기본값으로 사용됩니다.')}</p>
              </fieldset>

              <fieldset className="settings-fieldset">
              <legend>{t('ai_trans_group')}</legend>
              <label className="settings-check-row settings-inline-check-row">
                <input type="checkbox" checked={Boolean(localConfig.api_keys?.ai_trans_enabled)} onChange={event => handleApiChange('ai_trans_enabled', event.target.checked)} />
                <span><strong>{t('ai_trans_enable')}</strong></span>
              </label>
              <div className="settings-row">
                <span className="settings-label">{t('ai_provider')}</span>
                <select className="settings-select" value={localConfig.api_keys?.ai_provider || 'Gemini'} onChange={event => handleApiChange('ai_provider', event.target.value)} disabled={!localConfig.api_keys?.ai_trans_enabled}>
                  <option value="Gemini">Gemini</option>
                  <option value="OpenAI">OpenAI</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">{t('ai_api_key')}</span>
                {renderSecretInput(
                  'ai_key',
                  localConfig.api_keys?.ai_provider === 'OpenAI' ? 'OpenAI API Key (sk-...)' : 'Gemini API Key (AIza...)',
                  !localConfig.api_keys?.ai_trans_enabled,
                )}
              </div>
              <p className="settings-help">{t('ai_notice')}</p>
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
