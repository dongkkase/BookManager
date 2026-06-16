import React from 'react';

export function MissingVolumesDialog({ missingData = [], onClose, onGoToFolder, t }) {
  if (!missingData || missingData.length === 0) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 1000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" style={{ backgroundColor: '#2b2b2b', color: 'white', padding: '20px', borderRadius: '8px', width: '550px', maxHeight: '450px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginTop: 0 }}>{t?.('tf_dlg_missing_title') || '누락 권수 확인'}</h2>
        <p style={{ color: '#ccc' }}>{t?.('tf_dlg_missing_desc') || '시리즈 중 빠진 권수를 분석한 결과입니다.'}</p>
        
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#1e1e1e', padding: '10px', borderRadius: '4px' }}>
          {missingData.map((item, idx) => {
            let missingStr = item.missing.join(', ');
            if (item.missing.length > 8) {
               missingStr = item.missing.slice(0, 8).join(', ') + ` ... (총 ${item.missing.length}권 누락)`;
            }

            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', padding: '8px 5px', borderBottom: '1px solid #333' }}>
                <div style={{ color: '#E8A020', fontWeight: 'bold', width: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.series}>
                  {item.series}
                </div>
                <div style={{ flex: 1, color: '#E74C3C', marginLeft: '10px' }}>
                  {`빠진 권수: ${missingStr}`}
                </div>
                <button 
                  onClick={() => onGoToFolder(item.folder_path)}
                  style={{ backgroundColor: '#3498DB', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', marginLeft: '10px' }}
                >
                  {t?.('tf_btn_move') || '이동'}
                </button>
              </div>
            );
          })}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px' }}>
          <button 
            onClick={onClose}
            style={{ backgroundColor: '#555', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 16px', cursor: 'pointer' }}
          >
            {t?.('btn_close') || '닫기'}
          </button>
        </div>
      </div>
    </div>
  );
}
