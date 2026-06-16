import React, { useState, useEffect } from 'react';
import '../styles/ReleaseTab.css';

/**
 * Release 탭 컴포넌트
 * 업데이트 및 릴리즈 노트
 */
function ReleaseTab({ config, t }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);

  // 더미 데이터 초기화
  useEffect(() => {
    // 실제 환경에서는 GitHub API 등에서 가져옴
    setTimeout(() => {
      setReleases([
        {
          id: 'v2.8.1',
          name: 'v2.8.1',
          date: '2024-06-07',
          body: '<h2>🚀 개선 및 버그 수정</h2>\n<ul>\n<li>공유 서버(OPDS, WebDAV) 기능 추가</li>\n<li>다국어(i18n) 설정 버그 수정</li>\n<li>내부 파일명 변경 UI 속도 개선</li>\n</ul>'
        },
        {
          id: 'v2.8.0',
          name: 'v2.8.0',
          date: '2024-06-01',
          body: '<h2>🎉 주요 업데이트</h2>\n<ul>\n<li>새로운 Electron + React UI 적용</li>\n<li>압축 파일 모듈 최적화</li>\n<li>테마 다크모드 개선</li>\n</ul>'
        }
      ]);
      setLoading(false);
    }, 500);
  }, []);

  return (
    <div className="release-tab">
      <div className="release-scroll-area">
        <div className="release-content-container">
          
          {loading ? (
            <div className="release-loading">릴리즈 노트를 불러오는 중...</div>
          ) : releases.length === 0 ? (
            <div className="release-error">릴리즈 노트를 불러오는데 실패했습니다.</div>
          ) : (
            releases.map(item => (
              <div key={item.id} className="release-card">
                <div className="release-card-title">
                  📦 {item.name} <span className="release-card-date">({item.date})</span>
                </div>
                <div 
                  className="release-card-body" 
                  dangerouslySetInnerHTML={{ __html: item.body }} 
                />
              </div>
            ))
          )}

        </div>
      </div>
    </div>
  );
}

export { ReleaseTab };
export default ReleaseTab;
