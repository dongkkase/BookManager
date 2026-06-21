import React from 'react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

export function MissingVolumesDialog({ missingData = [], onClose, onGoToFolder, t }) {
  const dialogRef = useModalAccessibility(Boolean(missingData?.length), onClose);
  if (!missingData || missingData.length === 0) return null;

  return (
    <div className="folder-dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="missing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-volumes-title"
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="dialog-titlebar">
          <span id="missing-volumes-title">▣ {t?.('tf_dlg_missing_title')}</span>
          <button aria-label={t?.('btn_close')} onClick={onClose}>×</button>
        </div>
        <div className="missing-dialog-desc">
          {t?.('tf_dlg_missing_desc')}
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
                  {t?.('tf_btn_move')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
