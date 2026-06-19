import React from 'react';

export function MissingVolumesDialog({ missingData = [], onClose, onGoToFolder, t }) {
  if (!missingData || missingData.length === 0) return null;

  return (
    <div className="folder-dialog-backdrop">
      <div className="missing-dialog">
        <div className="dialog-titlebar">
          <span>▣ {t?.('tf_dlg_missing_title') || '누락 권수 확인'}</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="missing-dialog-desc">
          {t?.('tf_dlg_missing_desc') || '다음 시리즈들에 누락된 권/화가 발견되었습니다:'}
        </div>

        <div className="missing-list">
          {missingData.map(item => {
            let missingStr = item.missing.join(', ');
            if (item.missing.length > 8) {
              missingStr = item.missing.slice(0, 8).join(', ')
                + (t?.('msg_missing_total', [item.missing.length]) || ` ... (${item.missing.length})`);
            }

            return (
              <div key={`${item.series}-${item.folder_path}`} className="missing-row">
                <div className="missing-series" title={item.series}>
                  {item.series}
                </div>
                <div className="missing-values">
                  {t?.('msg_missing_prefix', [missingStr]) || missingStr}
                </div>
                <button onClick={() => onGoToFolder(item.folder_path)}>
                  {t?.('tf_btn_move') || '이동'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
