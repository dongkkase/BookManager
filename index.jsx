import React, { useState } from 'react';
import './FolderTab.css';

/**
 * 폴더/탐색기 탭 메인 컴포넌트
 * 기존 PyQt6 tab_folder.py의 화면 구성 완벽 이식
 */
export default function FolderTab() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [showSubfolders, setShowSubfolders] = useState(false);
  const [dupCheck, setDupCheck] = useState(false);
  const [selectedItem, setSelectedItem] = useState(true); // 우측 하단 디테일 패널 표시용 상태
  const [viewMode, setViewMode] = useState('detail'); // detail, thumbnail, tile

  return (
    <div className="folder-tab-root">
      {/* 메인 스플리터 (좌측 사이드바 / 우측 패널) */}
      <div className="folder-main-splitter">
        
        {/* 좌측 패널 (탐색기) */}
        {sidebarVisible && (
          <div className="left-panel">
            <div className="panel-row">
              <button 
                className={`toggle-btn ${showSubfolders ? 'active' : ''}`}
                onClick={() => setShowSubfolders(!showSubfolders)}
              >
                {showSubfolders ? '☑ 하위 폴더 포함' : '☐ 하위 폴더 포함'}
              </button>
              <button 
                className={`toggle-btn ${dupCheck ? 'active' : ''}`}
                onClick={() => setDupCheck(!dupCheck)}
              >
                {dupCheck ? '중복 검사 ON' : '중복 검사 OFF'}
              </button>
            </div>
            <button className="toggle-btn w-full">트리 새로고침</button>

            {/* 라이브러리 목록 */}
            <div className="nav-header">
              <span>라이브러리</span>
              <button className="icon-btn"><i className="fas fa-cog"></i></button>
            </div>
            <ul className="nav-list">
              <li className="selected"><i className="fas fa-folder"></i> 메인 라이브러리</li>
            </ul>

            {/* 즐겨찾기 목록 */}
            <div className="nav-header">
              <span>즐겨찾기</span>
            </div>
            <ul className="nav-list" style={{ flex: 0.5 }}>
              {/* 즐겨찾기 아이템 */}
            </ul>

            {/* 폴더 (트리 뷰) */}
            <div className="nav-header">
              <span>폴더</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="icon-btn" title="바탕 화면"><i className="fas fa-desktop"></i></button>
                <button className="icon-btn" title="문서"><i className="fas fa-file-alt"></i></button>
                <button className="icon-btn" title="다운로드"><i className="fas fa-download"></i></button>
                <button className="icon-btn" title="홈"><i className="fas fa-home"></i></button>
              </div>
            </div>
            <div className="nav-list" style={{ flex: 2, padding: '10px' }}>
              {/* QTreeView 대체 영역 */}
              <div style={{ color: '#aaa', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                C:\ <br/> D:\
              </div>
            </div>

            <button className="toggle-btn w-full mt-auto">누락 권수 확인</button>
          </div>
        )}

        {/* 우측 패널 (위/아래 스플리터) */}
        <div className="folder-right-splitter">
          
          {/* 우측 상단 (리스트/테이블) */}
          <div className="right-top-panel">
            <div className="list-toolbar">
              <button 
                className={`toggle-btn ${sidebarVisible ? 'active' : ''}`} 
                style={{flex: 'none'}}
                onClick={() => setSidebarVisible(!sidebarVisible)}
              >
                사이드바 {sidebarVisible ? 'ON' : 'OFF'}
              </button>
              <button className="tool-btn">그룹화 <i className="fas fa-caret-down"></i></button>
              <button className="tool-btn">필터 <i className="fas fa-caret-down"></i></button>
              <button className="tool-btn">정렬 <i className="fas fa-caret-down"></i></button>
              <button className="tool-btn">레이아웃 <i className="fas fa-caret-down"></i></button>
              <button className="toggle-btn" style={{flex: 'none'}}>CSV 내보내기</button>
              
              <div style={{ flex: 1 }}></div>
              
              <input type="text" className="search-input" placeholder="검색어 입력..." />
              <button className="toggle-btn" style={{flex: 'none'}}>목록 새로고침</button>
            </div>

            <div className="view-stack">
              {/* QTableView 대체 영역 (디테일 뷰 모드) */}
              <div className="table-container" style={{ width: '100%', height: '100%', overflow: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', borderCollapse: 'collapse', color: 'white', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>커버</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>이름</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>크기</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>수정한 날짜</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>시리즈</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>만화 제목</th>
                      <th style={{ backgroundColor: '#2b2b2b', border: '1px solid #444', padding: '4px 8px', textAlign: 'left' }}>작가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 데이터가 없을 때의 표시 */}
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '60px 0', border: 'none' }}>
                        <i className="fas fa-folder-open" style={{ fontSize: '64px', color: '#aaaaaa', marginBottom: '15px', opacity: 0.55, display: 'block' }}></i>
                        <span style={{ color: '#aaaaaa', fontSize: '16px', fontWeight: 'bold' }}>선택된 폴더에 항목이 없습니다.</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 우측 하단 (상세 정보 패널 - PyQt DetailBackgroundWidget) */}
          {selectedItem && (
            <div className="right-bottom-panel detail-bg-widget">
              <div className="overlay-gradient"></div>
              <div className="detail-content">
                
                <div className="cover-col">
                  <div className="cover-image">커버 이미지 없음</div>
                </div>

                <div className="info-scroll">
                  <div className="info-series">선택된 시리즈명 / 그룹</div>
                  <div className="info-title">선택된 만화 제목 01권</div>
                  
                  <div className="tag-flow">
                    <span className="tag-badge">코믹스</span>
                    <span className="tag-badge">판타지</span>
                    <span className="tag-badge">액션</span>
                  </div>

                  <div className="glow-card">
                    {/* Meta Grid (Left) */}
                    <div style={{ flex: 5, padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                       {[
                         { icon: 'fa-user-edit', label: '작가/참여', val: '홍길동' },
                         { icon: 'fa-building', label: '출판사', val: '코믹출판' },
                         { icon: 'fa-file-alt', label: '페이지 수', val: '210' },
                         { icon: 'fa-layer-group', label: '총 권수', val: '12' },
                         { icon: 'fa-book-open', label: '포맷/망가', val: 'CBZ / Yes' },
                         { icon: 'fa-star', label: '평점', val: '4.5' },
                         { icon: 'fa-child', label: '연령 등급', val: '15+' },
                         { icon: 'fa-calendar-alt', label: '출판일', val: '2023-05-12' },
                       ].map((meta, idx) => (
                         <div key={idx} style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                           <i className={`fas ${meta.icon}`} style={{ width: '20px', color: '#fff' }}></i>
                           <span style={{ width: '90px', color: '#dadcde', fontWeight: 'bold' }}>{meta.label}</span>
                           <span style={{ color: '#bbbbbb' }}>
                             {meta.icon === 'fa-star' && <i className="fas fa-star" style={{ color: '#F5A623', marginRight: '4px'}}></i>}
                             {meta.val}
                           </span>
                         </div>
                       ))}
                    </div>
                    
                    {/* Vertical Line */}
                    <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.05)' }}></div>
                    
                    {/* Summary & Extra (Right) */}
                    <div style={{ flex: 6, padding: '20px' }}>
                      <div className="flex items-center gap-sm mb-2" style={{ color: '#E8A020', fontSize: '12px', fontWeight: 'bold' }}>
                        <i className="fas fa-play-circle"></i> 줄거리
                      </div>
                      <p style={{ color: '#ccc', fontSize: '12px', lineHeight: '1.6', marginBottom: '15px' }}>
                        주인공이 모험을 떠나는 흥미진진한 이야기입니다. 줄거리 텍스트가 여기에 표시됩니다.
                      </p>

                      <div className="flex-col" style={{ gap: '6px' }}>
                        <div className="flex items-center" style={{ fontSize: '12px' }}>
                          <i className="fas fa-map-marker-alt" style={{ width: '20px', color: '#fff' }}></i>
                          <span style={{ width: '90px', color: '#dadcde', fontWeight: 'bold' }}>아크/팀/장소</span>
                          <span style={{ color: '#ccc' }}>- / - / -</span>
                        </div>
                        <div className="flex items-center" style={{ fontSize: '12px' }}>
                          <i className="fas fa-user-friends" style={{ width: '20px', color: '#fff' }}></i>
                          <span style={{ width: '90px', color: '#dadcde', fontWeight: 'bold' }}>등장인물</span>
                          <span style={{ color: '#ccc' }}>-</span>
                        </div>
                        <div className="flex items-center" style={{ fontSize: '12px' }}>
                          <i className="fas fa-link" style={{ width: '20px', color: '#E8A020' }}></i>
                          <span style={{ width: '90px', color: '#E8A020', fontWeight: 'bold' }}>웹 링크</span>
                          <span style={{ color: '#3498DB' }}>-</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단 상태바 */}
      <div className="bottom-bar">
        <span>대기 중...</span>
        <div style={{ flex: 1 }}></div>
        <div className="flex gap-sm items-center">
          <button 
            className="icon-btn" 
            style={{ color: 'white', padding: '4px 8px', backgroundColor: viewMode === 'detail' ? '#3498DB' : 'transparent', border: viewMode === 'detail' ? '1px solid #2980B9' : 'none', borderRadius: '4px' }}
            onClick={() => setViewMode('detail')}
          ><i className="fas fa-bars"></i></button>
          <button 
            className="icon-btn" 
            style={{ color: 'white', padding: '4px 8px', backgroundColor: viewMode === 'thumbnail' ? '#3498DB' : 'transparent', border: viewMode === 'thumbnail' ? '1px solid #2980B9' : 'none', borderRadius: '4px' }}
            onClick={() => setViewMode('thumbnail')}
          ><i className="fas fa-th-large"></i></button>
          <button 
            className="icon-btn" 
            style={{ color: 'white', padding: '4px 8px', backgroundColor: viewMode === 'tile' ? '#3498DB' : 'transparent', border: viewMode === 'tile' ? '1px solid #2980B9' : 'none', borderRadius: '4px' }}
            onClick={() => setViewMode('tile')}
          ><i className="fas fa-list"></i></button>
          
          <span style={{ marginLeft: '15px', color: '#ccc' }}>항목 크기</span>
          <input type="range" min="80" max="300" defaultValue="120" style={{ width: '150px' }} />
        </div>
      </div>
    </div>
  );
}