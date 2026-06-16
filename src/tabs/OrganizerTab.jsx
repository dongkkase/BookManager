import React, { useState, useEffect } from 'react';
import '../styles/OrganizerTab.css';

/**
 * Organizer 탭 컴포넌트
 * 압축 파일 구조 정리 (평탄화)
 */
function OrganizerTab({ config, t }) {
  const [fileList, setFileList] = useState([]);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [isAllExpanded, setIsAllExpanded] = useState(true);

  // 더미 데이터 (UI 확인용)
  useEffect(() => {
    setFileList([
      {
        id: '1',
        title: '어떤 마술의 금서목록',
        originalName: '[에피] 어떤 마술의 금서목록',
        checked: true,
        outPath: '/Users/dummy/Downloads/어떤 마술의 금서목록',
        sizeMb: 125.4,
        volumes: [
          { id: '1-1', title: '어떤 마술의 금서목록 v01', originalName: 'vol.1.zip', type: 'archive' },
          { id: '1-2', title: '어떤 마술의 금서목록 v02', originalName: 'vol.2.zip', type: 'archive' },
        ]
      },
      {
        id: '2',
        title: '원피스',
        originalName: 'One Piece',
        checked: true,
        outPath: '/Users/dummy/Downloads/원피스',
        sizeMb: 50.2,
        volumes: [
          { id: '2-1', title: '원피스 v100', originalName: 'OP_100.zip', type: 'archive' },
        ]
      }
    ]);
    setExpandedItems(new Set(['1', '2']));
  }, []);

  const handleToggleExpandAll = () => {
    if (isAllExpanded) {
      setExpandedItems(new Set());
    } else {
      setExpandedItems(new Set(fileList.map(f => f.id)));
    }
    setIsAllExpanded(!isAllExpanded);
  };

  const handleToggleExpand = (id) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const handleCheck = (id) => {
    setFileList(prev => prev.map(f => f.id === id ? { ...f, checked: !f.checked } : f));
  };

  return (
    <div className="organizer-tab">
      <div className="org-local-toolbar">
        <button className="org-btn" onClick={handleToggleExpandAll}>
          ↕ {t('organizer.expand_all') || '전체 펼치기 / 접기'}
        </button>
        <button className="org-btn">{t('organizer.batch_default') || '일괄: 기본경로'}</button>
        <button className="org-btn">{t('organizer.batch_title') || '일괄: 책제목경로'}</button>
      </div>

      <div className="org-content-area">
        {fileList.length === 0 ? (
          <div className="org-empty-state">
            <img src="/draganddrop1.png" alt="Drag and Drop" className="org-empty-image" />
            <p className="org-empty-text">{t('organizer.drag_drop') || '파일이나 폴더를 여기에 드래그 앤 드롭하세요'}</p>
          </div>
        ) : (
          <div className="org-tree-container">
            <div className="org-tree-header">
              <div className="org-col-name">{t('organizer.col_name') || '파일명'}</div>
              <div className="org-col-path">{t('organizer.col_path') || '결과 경로'}</div>
              <div className="org-col-count">{t('organizer.col_count') || '항목수'}</div>
              <div className="org-col-size">{t('organizer.col_size') || '용량'}</div>
            </div>
            
            <div className="org-tree-body">
              {fileList.map((file) => (
                <div key={file.id} className="org-tree-item-group">
                  <div className="org-tree-row org-root-row">
                    <div className="org-col-name" onClick={() => handleToggleExpand(file.id)}>
                      <span className="org-expand-icon">
                        {expandedItems.has(file.id) ? '▼' : '▶'}
                      </span>
                      <input 
                        type="checkbox" 
                        checked={file.checked} 
                        onChange={() => handleCheck(file.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="org-icon">📦</span>
                      <span className="org-title">{file.title}</span>
                      <span className="org-original-name"> ({file.originalName})</span>
                    </div>
                    <div className="org-col-path org-path-widget">
                      <input type="text" className="org-path-input" value={file.outPath} readOnly />
                      <button className="org-path-btn">기본값</button>
                      <button className="org-path-btn">책제목</button>
                      <button className="org-path-btn">일괄: 권</button>
                      <button className="org-path-btn">일괄: 화</button>
                    </div>
                    <div className="org-col-count">{file.volumes.length} Items</div>
                    <div className="org-col-size">{file.sizeMb.toFixed(1)} MB</div>
                  </div>
                  
                  {expandedItems.has(file.id) && file.volumes.map((vol) => (
                    <div key={vol.id} className="org-tree-row org-child-row">
                      <div className="org-col-full">
                        <span className="org-indent">↳</span>
                        <span className="org-icon">{vol.type === 'archive' ? '📦' : '📁'}</span>
                        <span className="org-title">{vol.title}.zip</span>
                        <span className="org-original-name"> ({vol.originalName})</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="org-bottom-info">
        {t('organizer.total_files')?.replace('{count}', fileList.length) || `총 ${fileList.length}개의 파일이 리스트에 있습니다.`}
      </div>
    </div>
  );
}

export { OrganizerTab };
export default OrganizerTab;
