import React, { useState, useEffect } from 'react';
import '../styles/SharingTab.css';

/**
 * Sharing 탭 컴포넌트
 * OPDS 및 WebDAV 공유 서버 관리
 */
function SharingTab({ config, t }) {
  const [opdsPort, setOpdsPort] = useState(8080);
  const [opdsRunning, setOpdsRunning] = useState(false);
  
  const [webdavId, setWebdavId] = useState('user');
  const [webdavPw, setWebdavPw] = useState('1234');
  const [webdavPwVisible, setWebdavPwVisible] = useState(false);
  const [webdavPort, setWebdavPort] = useState(8081);
  const [webdavRunning, setWebdavRunning] = useState(false);
  
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [logs, setLogs] = useState(['[INFO] 서버 로그가 준비되었습니다.']);

  // 더미 데이터 초기화
  useEffect(() => {
    // 실제 환경에서는 네트워크 인터페이스를 통해 IP를 가져옴
    setLocalIp('192.168.1.100');
  }, []);

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url)
      .then(() => alert('URL이 복사되었습니다.'))
      .catch(err => console.error('복사 실패:', err));
  };

  const handleToggleOpds = () => {
    if (!opdsRunning) {
      setLogs(prev => [...prev, `[INFO] OPDS 서버가 포트 ${opdsPort}에서 시작되었습니다.`]);
    } else {
      setLogs(prev => [...prev, '[INFO] OPDS 서버가 성공적으로 중지되었습니다.']);
    }
    setOpdsRunning(!opdsRunning);
  };

  const handleToggleWebdav = () => {
    if (!webdavRunning) {
      setLogs(prev => [...prev, `[INFO] WebDAV 서버가 포트 ${webdavPort}에서 시작되었습니다.`]);
    } else {
      setLogs(prev => [...prev, '[INFO] WebDAV 서버가 성공적으로 중지되었습니다.']);
    }
    setWebdavRunning(!webdavRunning);
  };

  const opdsUrl = `http://${localIp}:${opdsPort}/opds`;
  const webdavUrl = `http://${localIp}:${webdavPort}/`;

  return (
    <div className="sharing-tab">
      <div className="sharing-left-panel">
        
        {/* OPDS 그룹 */}
        <div className="sharing-groupbox">
          <div className="sharing-groupbox-title">OPDS 공유 서버 (Panels 지원)</div>
          <div className="sharing-groupbox-content">
            <div className="sharing-row">
              <span className="sharing-label">포트:</span>
              <input 
                type="number" 
                className="sharing-input-num" 
                value={opdsPort} 
                onChange={(e) => setOpdsPort(e.target.value)}
                disabled={opdsRunning}
              />
              <div className="sharing-spacer"></div>
              <button 
                className={`sharing-btn-toggle ${opdsRunning ? 'running' : ''}`}
                onClick={handleToggleOpds}
              >
                {opdsRunning ? '■ OPDS 서버 끄기' : '⏻ OPDS 서버 켜기'}
              </button>
            </div>
            
            <div className="sharing-row url-row">
              <input type="text" className="sharing-input-url" value={opdsUrl} readOnly />
              <button className="sharing-btn-copy" onClick={() => handleCopyUrl(opdsUrl)}>📋 URL 복사</button>
            </div>
          </div>
        </div>

        {/* WebDAV 그룹 */}
        <div className="sharing-groupbox mt-20">
          <div className="sharing-groupbox-title">WebDAV 공유 서버 (ComicGlass 지원)</div>
          <div className="sharing-groupbox-content">
            <div className="sharing-desc">※ 앱에서 접속 시 사용할 계정을 설정하세요.</div>
            
            <div className="sharing-row">
              <span className="sharing-label">아이디:</span>
              <input 
                type="text" 
                className="sharing-input" 
                value={webdavId} 
                onChange={(e) => setWebdavId(e.target.value)}
                disabled={webdavRunning}
              />
              <span className="sharing-label ml-10">비밀번호:</span>
              <div className="sharing-pw-wrapper">
                <input 
                  type={webdavPwVisible ? 'text' : 'password'} 
                  className="sharing-input pw-input" 
                  value={webdavPw} 
                  onChange={(e) => setWebdavPw(e.target.value)}
                  disabled={webdavRunning}
                />
                <button 
                  className="sharing-btn-pw-eye"
                  onClick={() => setWebdavPwVisible(!webdavPwVisible)}
                  disabled={webdavRunning}
                >
                  {webdavPwVisible ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="sharing-row">
              <span className="sharing-label">포트:</span>
              <input 
                type="number" 
                className="sharing-input-num" 
                value={webdavPort} 
                onChange={(e) => setWebdavPort(e.target.value)}
                disabled={webdavRunning}
              />
              <div className="sharing-spacer"></div>
              <button 
                className={`sharing-btn-toggle ${webdavRunning ? 'running' : ''}`}
                onClick={handleToggleWebdav}
              >
                {webdavRunning ? '■ WebDAV 서버 끄기' : '⏻ WebDAV 서버 켜기'}
              </button>
            </div>

            <div className="sharing-row url-row">
              <input type="text" className="sharing-input-url" value={webdavUrl} readOnly />
              <button className="sharing-btn-copy" onClick={() => handleCopyUrl(webdavUrl)}>📋 URL 복사</button>
            </div>
          </div>
        </div>

      </div>

      {/* 로그 콘솔 */}
      <div className="sharing-right-panel">
        <div className="sharing-groupbox h-full">
          <div className="sharing-groupbox-title">서버 상태 로그</div>
          <div className="sharing-groupbox-content h-full">
            <textarea 
              className="sharing-log-console" 
              readOnly 
              value={logs.join('\n')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export { SharingTab };
export default SharingTab;
