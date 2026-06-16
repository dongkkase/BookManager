import React, { useState, useEffect } from 'react';
import '../styles/MetadataTab.css';

/**
 * Metadata 탭 컴포넌트
 * 메타데이터(ComicInfo.xml) 관리 및 API 연동
 */
function MetadataTab({ config, t }) {
  const [fileList, setFileList] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  
  // 상태 변수
  const [searchQuery, setSearchQuery] = useState('');
  const [apiSource, setApiSource] = useState('AniList');
  const [applyEmpty, setApplyEmpty] = useState(false);

  // 더미 데이터
  useEffect(() => {
    setFileList([
      {
        id: 'dir_1',
        type: 'directory',
        name: '어떤 마술의 금서목록',
        children: [
          { id: '1-1', type: 'file', name: '어떤 마술의 금서목록 v01.zip' },
          { id: '1-2', type: 'file', name: '어떤 마술의 금서목록 v02.zip' }
        ]
      },
      {
        id: 'dir_2',
        type: 'directory',
        name: '원피스 100권',
        children: [
          { id: '2-1', type: 'file', name: '원피스 100권.zip' }
        ]
      }
    ]);
  }, []);

  const metaFields = [
    { id: 'Series', label: '시리즈', type: 'text' },
    { id: 'SeriesGroup', label: '시리즈 그룹', type: 'text' },
    { id: 'Title', label: '제목', type: 'text' },
    { id: 'Volume', label: '권 (Volume)', type: 'text' },
    { id: 'Number', label: '화 (Chapter)', type: 'text' },
    { id: 'Summary', label: '줄거리', type: 'textarea' },
    { id: 'Writer', label: '글 작가', type: 'text' },
    { id: 'Penciller', label: '그림 작가', type: 'text' },
    { id: 'Publisher', label: '출판사', type: 'text' },
    { id: 'Genre', label: '장르', type: 'text' },
    { id: 'Tags', label: '태그', type: 'text' },
    { id: 'Year', label: '출판 년도', type: 'text' },
    { id: 'Month', label: '월', type: 'text' },
    { id: 'Day', label: '일', type: 'text' },
    { id: 'LanguageISO', label: '언어 (ISO)', type: 'text' },
    { id: 'Manga', label: '읽기 방향', type: 'select', options: ['YesAndRightToLeft', 'Yes', 'No', 'RightToLeft'] },
    { id: 'Format', label: '포맷', type: 'select', options: ['Manga', 'Comic', 'Webtoon'] },
    { id: 'AgeRating', label: '연령 등급', type: 'select', options: ['Everyone', 'Teen', 'Mature', 'Adult'] },
    { id: 'Web', label: '웹 링크', type: 'text' },
    { id: 'Characters', label: '등장인물', type: 'text' },
    { id: 'Locations', label: '장소', type: 'text' },
    { id: 'Teams', label: '소속 팀', type: 'text' },
    { id: 'Notes', label: '메모', type: 'text' }
  ];

  return (
    <div className="metadata-tab">
      <div className="meta-left-panel">
        <div className="meta-preview-title">{t('metadata.cover') || '표지 미리보기'}</div>
        <div className="meta-preview-img-box">
          <span className="meta-no-image">이미지 없음</span>
        </div>
        
        <div className="meta-tree-container">
          <ul className="meta-tree">
            {fileList.map((dir) => (
              <li key={dir.id} className="meta-tree-dir">
                <span className="meta-tree-icon">📂</span> {dir.name}
                <ul>
                  {dir.children.map((file) => (
                    <li 
                      key={file.id} 
                      className={`meta-tree-file ${selectedFileId === file.id ? 'selected' : ''}`}
                      onClick={() => setSelectedFileId(file.id)}
                    >
                      <span className="meta-tree-icon">📦</span> {file.name}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="meta-right-panel">
        {!selectedFileId && (
          <div className="meta-overlay">
            <span>왼쪽 리스트에서 작업할 책을 선택해주세요.</span>
          </div>
        )}

        <div className="meta-search-bar">
          <select 
            className="meta-api-select" 
            value={apiSource} 
            onChange={(e) => setApiSource(e.target.value)}
          >
            <option value="AniList">AniList (Manga)</option>
            <option value="MangaUpdates">MangaUpdates</option>
            <option value="Comicvine">Comicvine</option>
            <option value="Aladin">알라딘 (Aladin)</option>
            <option value="NaverBook">네이버 책</option>
            <option value="Ridi">리디북스</option>
          </select>
          <input 
            type="text" 
            className="meta-search-input" 
            placeholder="제목을 입력하세요..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="meta-search-btn">🔍</button>
        </div>

        <div className="meta-nav-bar">
          <button className="meta-nav-btn" disabled>◀ 이전 권</button>
          <button className="meta-nav-btn" disabled>다음 권 ▶</button>
          <div className="meta-spacer"></div>
          <label className="meta-checkbox-label">
            <input 
              type="checkbox" 
              checked={applyEmpty} 
              onChange={(e) => setApplyEmpty(e.target.checked)} 
            />
            빈 값도 덮어쓰기
          </label>
        </div>

        <div className="meta-form-area">
          <div className="meta-form-header">
            <div className="meta-col-label">필드</div>
            <div className="meta-col-my">내 데이터</div>
            <div className="meta-col-btn"></div>
            <div className="meta-col-res">일괄 편집창 (API 결과)</div>
          </div>
          
          <div className="meta-form-scroll">
            {metaFields.map((field) => (
              <div className="meta-form-row" key={field.id}>
                <div className="meta-col-label">{field.label}</div>
                <div className="meta-col-my">
                  {field.type === 'textarea' ? (
                    <textarea className="meta-input" rows="3" />
                  ) : field.type === 'select' ? (
                    <select className="meta-input">
                      <option value=""></option>
                      {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input type="text" className="meta-input" />
                  )}
                </div>
                <div className="meta-col-btn">
                  <button className="meta-copy-btn">◀</button>
                </div>
                <div className="meta-col-res">
                  {field.type === 'textarea' ? (
                    <textarea className="meta-input res" rows="3" />
                  ) : field.type === 'select' ? (
                    <select className="meta-input res">
                      <option value=""></option>
                      {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input type="text" className="meta-input res" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="meta-bottom-bar">
          <div className="meta-bottom-left">
            <button className="meta-btn">↺ 리셋</button>
            <button className="meta-btn">☁ 최신권 메타 불러오기</button>
          </div>
          <div className="meta-bottom-right">
            <button className="meta-btn-action">▶▶ 일괄 편집창으로 복사</button>
            <button className="meta-btn-action">❌ 일괄 편집창 비우기</button>
            <button className="meta-btn-primary">✓ 모두 반영</button>
            <button className="meta-btn-primary">📚 시리즈 전체 반영</button>
            <button className="meta-btn-magic">✨ 자동 생성</button>
            <button className="meta-btn-save">💾 저장</button>
            <button className="meta-btn-save">💾 모두 저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { MetadataTab };
export default MetadataTab;
