import React, { useState, useEffect } from 'react';
import '../styles/RenamerTab.css';

/**
 * Renamer 탭 컴포넌트
 * 내부 파일명 변경
 */
function RenamerTab({ config, t }) {
  const [fileList, setFileList] = useState([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState(null);
  
  // 상태 변수
  const [isAllChecked, setIsAllChecked] = useState(true);
  const [isCapAllChecked, setIsCapAllChecked] = useState(false);
  const [isExifAllChecked, setIsExifAllChecked] = useState(true);
  
  const [pattern, setPattern] = useState('001.jpg');
  const [customText, setCustomText] = useState('');
  const [keepName, setKeepName] = useState(false);
  const [startNum, setStartNum] = useState(0);

  // 더미 데이터
  useEffect(() => {
    setFileList([
      {
        id: '1',
        name: '어떤 마술의 금서목록 v01.zip',
        checked: true,
        capOpt: false,
        exifOpt: true,
        count: 154,
        sizeMb: 45.2,
        entries: [
          { id: '1-1', oldName: 'cover.jpg', newName: 'Page_000.jpg', sizeKb: 120.5 },
          { id: '1-2', oldName: '001.jpg', newName: 'Page_001.jpg', sizeKb: 85.2 },
          { id: '1-3', oldName: '002.jpg', newName: 'Page_002.jpg', sizeKb: 90.1 },
        ]
      },
      {
        id: '2',
        name: '원피스 100권.zip',
        checked: true,
        capOpt: false,
        exifOpt: true,
        count: 205,
        sizeMb: 60.8,
        entries: [
          { id: '2-1', oldName: 'OP_100_001.jpg', newName: '001.jpg', sizeKb: 150.0 },
          { id: '2-2', oldName: 'OP_100_002.jpg', newName: '002.jpg', sizeKb: 145.2 },
        ]
      }
    ]);
  }, []);

  const handleStartNumChange = (delta) => {
    setStartNum(prev => Math.max(0, prev + delta));
  };

  const activeArchive = fileList.find(f => f.id === selectedArchiveId);

  return (
    <div className="renamer-tab">
      <div className="renamer-left-panel">
        <div className="renamer-preview-title">{t('renamer.cover_preview') || '커버 미리보기'}</div>
        <div className="renamer-preview-img-box">
          <span className="renamer-no-image">이미지 없음</span>
        </div>
        
        <div className="renamer-divider"></div>
        
        <div className="renamer-preview-title">{t('renamer.inner_preview') || '내부 파일 미리보기'}</div>
        <div className="renamer-preview-img-box">
          <span className="renamer-no-image">이미지 없음</span>
        </div>
      </div>

      <div className="renamer-right-panel">
        <div className="renamer-options-bar">
          <button className={`renamer-btn-toggle ${isAllChecked ? 'active' : ''}`}>
            {isAllChecked ? '☑' : '☐'} 전체 선택
          </button>
          <button className={`renamer-btn-toggle ${isCapAllChecked ? 'active' : ''}`}>
            {isCapAllChecked ? '☑' : '☐'} 이미지 압축 일괄 (85%)
          </button>
          <button className={`renamer-btn-toggle ${isExifAllChecked ? 'active' : ''}`}>
            {isExifAllChecked ? '☑' : '☐'} EXIF 제거 일괄
          </button>

          <div className="renamer-spacer"></div>

          <label className="renamer-label">이름 패턴:</label>
          <select 
            className="renamer-select" 
            value={pattern} 
            onChange={(e) => setPattern(e.target.value)}
            disabled={keepName}
          >
            <option value="001.jpg">001.jpg</option>
            <option value="Page_001.jpg">Page_001.jpg</option>
            <option value="Title_001.jpg">Title_001.jpg</option>
            <option value="Title_Page_001.jpg">Title_Page_001.jpg</option>
            <option value="Custom">Custom</option>
          </select>

          <input 
            type="text" 
            className="renamer-input-custom" 
            placeholder="Custom" 
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={keepName || pattern !== 'Custom'}
          />

          <label className="renamer-checkbox-label">
            <input 
              type="checkbox" 
              checked={keepName} 
              onChange={(e) => setKeepName(e.target.checked)} 
            />
            내부 파일명 유지
          </label>

          <div className="renamer-spacer"></div>

          <label className="renamer-label">시작 번호:</label>
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(-1)} disabled={keepName}>-</button>
          <input 
            type="number" 
            className="renamer-input-num" 
            value={startNum} 
            onChange={(e) => setStartNum(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={keepName}
          />
          <button className="renamer-btn-icon" onClick={() => handleStartNumChange(1)} disabled={keepName}>+</button>
        </div>

        <div className="renamer-content-area">
          {fileList.length === 0 ? (
            <div className="renamer-empty-state">
              <img src="/draganddrop1.png" alt="Drag and Drop" className="renamer-empty-image" />
              <p className="renamer-empty-text">파일이나 폴더를 여기에 드래그 앤 드롭하세요</p>
            </div>
          ) : (
            <div className="renamer-split-view">
              {/* 상단: 압축 파일 리스트 */}
              <div className="renamer-table-wrapper top-table">
                <table className="renamer-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>파일명</th>
                      <th style={{ width: '10%' }}>항목수</th>
                      <th style={{ width: '15%' }}>용량</th>
                      <th style={{ width: '17%' }}>이미지 압축 일괄</th>
                      <th style={{ width: '18%' }}>EXIF 제거 일괄</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileList.map((file) => (
                      <tr 
                        key={file.id} 
                        className={selectedArchiveId === file.id ? 'selected' : ''}
                        onClick={() => setSelectedArchiveId(file.id)}
                      >
                        <td>
                          <input type="checkbox" checked={file.checked} readOnly />
                          <span style={{ marginLeft: '5px' }}>{file.name}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>{file.count}</td>
                        <td style={{ textAlign: 'right' }}>{file.sizeMb.toFixed(1)} MB</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={file.capOpt} readOnly />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={file.exifOpt} readOnly />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 하단: 내부 파일 리스트 */}
              <div className="renamer-table-wrapper bottom-table">
                <table className="renamer-table">
                  <thead>
                    <tr>
                      <th style={{ width: '35%' }}>기존 이름</th>
                      <th style={{ width: '35%' }}>변경될 이름</th>
                      <th style={{ width: '15%' }}>파일 크기</th>
                      <th style={{ width: '15%' }}>순서 변경</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeArchive ? activeArchive.entries.map((entry, index) => (
                      <tr key={entry.id}>
                        <td>{entry.oldName}</td>
                        <td>{entry.newName}</td>
                        <td style={{ textAlign: 'right' }}>{entry.sizeKb.toFixed(1)} KB</td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="renamer-order-btns">
                            <button disabled={index === 0}>⇈</button>
                            <button disabled={index === 0}>↑</button>
                            <button disabled={index === activeArchive.entries.length - 1}>↓</button>
                            <button disabled={index === activeArchive.entries.length - 1}>⇊</button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', color: '#888' }}>
                          압축 파일을 선택하면 내부 파일이 표시됩니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="renamer-bottom-info">
          총 {fileList.length}개의 압축 파일이 리스트에 있습니다.
        </div>
      </div>
    </div>
  );
}

export { RenamerTab };
export default RenamerTab;
