import React, { useState, useEffect } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/ReleaseTab.css';

/**
 * Release 탭 컴포넌트
 * 업데이트 및 릴리즈 노트
 */
function ReleaseTab({ config, t }) {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadReleases = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await window.electronAPI?.getReleases?.();
        if (!isMounted) return;
        if (Array.isArray(result)) {
          setReleases(result);
        } else {
          setError(result?.error || '');
          setReleases(result?.releases || []);
        }
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message);
        setReleases([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadReleases();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="release-tab">
      <div className="release-scroll-area">
        <div className="release-content-container">
          
          {loading ? (
            <div className="release-loading">릴리즈 노트를 불러오는 중...</div>
          ) : releases.length === 0 ? (
            <div className="release-error">릴리즈 노트를 불러오는데 실패했습니다.{error ? ` (${error})` : ''}</div>
          ) : (
            <>
              {error && <div className="release-error compact">릴리즈 정보를 온라인에서 가져오지 못했습니다. {error}</div>}
              {releases.map(item => (
              <div key={item.id || item.tag || item.name} className="release-card">
                <div className="release-card-title">
                  <FaIcon name="archive" /> {item.name} <span className="release-card-date">({item.date})</span>
                </div>
                <div 
                  className="release-card-body" 
                  dangerouslySetInnerHTML={{ __html: item.body }} 
                />
                {item.url && (
                  <a className="release-card-link" href={item.url} target="_blank" rel="noreferrer">GitHub에서 보기</a>
                )}
              </div>
              ))}
            </>
          )}

        </div>
      </div>
    </div>
  );
}

export { ReleaseTab };
export default ReleaseTab;
