import React from 'react';

/**
 * 설정 모달 컴포넌트
 * 기존 PyQt6 설정 다이얼로그와 동일한 구조
 */
function SettingsModal({ isOpen, onClose, config, onSave, t }) {
  const [localConfig, setLocalConfig] = React.useState(null);

  React.useEffect(() => {
    if (config && isOpen) {
      setLocalConfig({ ...config });
    }
  }, [config, isOpen]);

  if (!isOpen || !localConfig) return null;

  const handleChange = (key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = () => {
    onSave(localConfig);
    onClose();
  };

  const handleCancel = () => {
    setLocalConfig({ ...config });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('settings.title') || '설정'}</span>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <div className="modal-body">
          {/* 일반 설정 */}
          <div className="settings-section">
            <div className="settings-section-title">
              {t('settings.general') || '일반'}
            </div>
            
            <div className="settings-row">
              <span className="settings-label">
                {t('settings.language') || '언어'}
              </span>
              <div className="settings-control">
                <select
                  className="settings-select"
                  value={localConfig.language || 'ko'}
                  onChange={e => handleChange('language', e.target.value)}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.threads') || '스레드 수'}
              </span>
              <div className="settings-control">
                <input
                  type="number"
                  className="settings-input"
                  min="1"
                  max="64"
                  value={localConfig.thread_count || 4}
                  onChange={e => handleChange('thread_count', parseInt(e.target.value) || 4)}
                />
              </div>
            </div>
          </div>

          {/* 처리 설정 */}
          <div className="settings-section">
            <div className="settings-section-title">
              {t('settings.processing') || '처리'}
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.quality') || '화질'}
              </span>
              <div className="settings-control">
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={localConfig.quality || 80}
                  onChange={e => handleChange('quality', parseInt(e.target.value))}
                />
                <span>{localConfig.quality || 80}</span>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.output_format') || '출력 형식'}
              </span>
              <div className="settings-control">
                <select
                  className="settings-select"
                  value={localConfig.output_format || 'zip'}
                  onChange={e => handleChange('output_format', e.target.value)}
                >
                  <option value="zip">ZIP</option>
                  <option value="cbz">CBZ</option>
                  <option value="cbz_deflate">CBZ (Deflate)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 서버 설정 */}
          <div className="settings-section">
            <div className="settings-section-title">
              {t('settings.server') || '서버'}
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.port') || '포트'}
              </span>
              <div className="settings-control">
                <input
                  type="number"
                  className="settings-input"
                  min="1"
                  max="65535"
                  value={localConfig.server_port || 8080}
                  onChange={e => handleChange('server_port', parseInt(e.target.value) || 8080)}
                />
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.auto_start_server') || '자동 서버 시작'}
              </span>
              <div className="settings-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={localConfig.auto_start_server || false}
                    onChange={e => handleChange('auto_start_server', e.target.checked)}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* 사운드 설정 */}
          <div className="settings-section">
            <div className="settings-section-title">
              {t('settings.sound') || '사운드'}
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.enable_sound') || '사운드 활성화'}
              </span>
              <div className="settings-control">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={localConfig.enable_sound || true}
                    onChange={e => handleChange('enable_sound', e.target.checked)}
                  />
                </label>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">
                {t('settings.sound_file') || '완료 사운드'}
              </span>
              <div className="settings-control">
                <select
                  className="settings-select"
                  value={localConfig.sound_file || 'Default.wav'}
                  onChange={e => handleChange('sound_file', e.target.value)}
                >
                  <option value="Default.wav">Default</option>
                  <option value="complete.wav">Complete</option>
                  <option value="Twinkle Sparkle.mp3">Twinkle Sparkle</option>
                  <option value="MadeInAbyss.mp3">MadeInAbyss</option>
                  <option value="Legend of Zelda - Rupee.mp3">Rupee</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            {t('common.save') || '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { SettingsModal };
export default SettingsModal;
