import React, { useState, useEffect } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/SharingTab.css';

/**
 * Sharing 탭 컴포넌트
 * OPDS 및 WebDAV 공유 서버 관리
 */
function SharingTab({ config, saveConfig, t }) {
  const [opdsPort, setOpdsPort] = useState(config?.opds_port || 8080);
  const [opdsRunning, setOpdsRunning] = useState(false);
  
  const [webdavId, setWebdavId] = useState(config?.webdav_username || 'user');
  const [webdavPw, setWebdavPw] = useState(config?.webdav_password || '1234');
  const [webdavPwVisible, setWebdavPwVisible] = useState(false);
  const [webdavPort, setWebdavPort] = useState(config?.webdav_port || 8081);
  const [webdavRunning, setWebdavRunning] = useState(false);
  const [busyServer, setBusyServer] = useState(null);
  
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [logs, setLogs] = useState(['[INFO] 서버 로그가 준비되었습니다.']);

  useEffect(() => {
    setOpdsPort(config?.opds_port || 8080);
    setWebdavPort(config?.webdav_port || 8081);
    setWebdavId(config?.webdav_username || 'user');
    setWebdavPw(config?.webdav_password || '1234');
  }, [config]);

  useEffect(() => {
    let isMounted = true;

    const applyStatus = (status) => {
      if (!status || !isMounted) return;
      setLocalIp(status.localIp || '127.0.0.1');
      setOpdsRunning(Boolean(status.OPDS?.running));
      setWebdavRunning(Boolean(status.WebDAV?.running));
      if (status.OPDS?.port) setOpdsPort(status.OPDS.port);
      if (status.WebDAV?.port) setWebdavPort(status.WebDAV.port);
    };

    window.electronAPI?.getServerStatus?.()
      .then(applyStatus)
      .catch(error => {
        setLogs(prev => [...prev, `[ERROR] 서버 상태 확인 실패: ${error.message}`]);
      });

    const cleanup = window.electronAPI?.onServerLog?.((data) => {
      if (data?.status) applyStatus(data.status);
      if (data?.message) {
        setLogs(prev => [...prev, `[${data.type || 'SERVER'}] ${data.message}`]);
      }
    });

    return () => {
      isMounted = false;
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url)
      .then(() => setLogs(prev => [...prev, `[INFO] URL이 복사되었습니다: ${url}`]))
      .catch(err => setLogs(prev => [...prev, `[ERROR] URL 복사 실패: ${err.message}`]));
  };

  const handleToggleOpds = async () => {
    setBusyServer('OPDS');
    try {
      if (!opdsRunning) {
        const nextPort = Number(opdsPort) || 8080;
        await saveConfig?.({ opds_port: nextPort });
        const result = await window.electronAPI.startServer('OPDS', { port: nextPort });
        setLocalIp(result.localIp || localIp);
        setOpdsRunning(Boolean(result.running));
        setLogs(prev => [...prev, `[OPDS] ${result.url || `포트 ${opdsPort}`} 서버를 시작했습니다.`]);
      } else {
        await window.electronAPI.stopServer('OPDS');
        setOpdsRunning(false);
        setLogs(prev => [...prev, '[OPDS] 서버가 성공적으로 중지되었습니다.']);
      }
    } catch (error) {
      setLogs(prev => [...prev, `[ERROR] OPDS 서버 처리 실패: ${error.message}`]);
    } finally {
      setBusyServer(null);
    }
  };

  const handleToggleWebdav = async () => {
    setBusyServer('WebDAV');
    try {
      if (!webdavRunning) {
        const nextPort = Number(webdavPort) || 8081;
        await saveConfig?.({
          webdav_port: nextPort,
          webdav_username: webdavId,
          webdav_password: webdavPw,
        });
        const result = await window.electronAPI.startServer('WebDAV', {
          port: nextPort,
          username: webdavId,
          password: webdavPw,
        });
        setLocalIp(result.localIp || localIp);
        setWebdavRunning(Boolean(result.running));
        setLogs(prev => [...prev, `[WebDAV] ${result.url || `포트 ${webdavPort}`} 서버를 시작했습니다.`]);
      } else {
        await window.electronAPI.stopServer('WebDAV');
        setWebdavRunning(false);
        setLogs(prev => [...prev, '[WebDAV] 서버가 성공적으로 중지되었습니다.']);
      }
    } catch (error) {
      setLogs(prev => [...prev, `[ERROR] WebDAV 서버 처리 실패: ${error.message}`]);
    } finally {
      setBusyServer(null);
    }
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
                disabled={busyServer === 'OPDS'}
              >
                <FaIcon name={opdsRunning ? 'minusCircle' : 'circleCheck'} />
                {busyServer === 'OPDS' ? '처리 중...' : opdsRunning ? 'OPDS 서버 끄기' : 'OPDS 서버 켜기'}
              </button>
            </div>
            
            <div className="sharing-row url-row">
              <input type="text" className="sharing-input-url" value={opdsUrl} readOnly />
              <button className="sharing-btn-copy" onClick={() => handleCopyUrl(opdsUrl)}><FaIcon name="fileLines" /> URL 복사</button>
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
                  <FaIcon name="eye" title={webdavPwVisible ? '비밀번호 숨기기' : '비밀번호 보기'} />
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
                disabled={busyServer === 'WebDAV'}
              >
                <FaIcon name={webdavRunning ? 'minusCircle' : 'circleCheck'} />
                {busyServer === 'WebDAV' ? '처리 중...' : webdavRunning ? 'WebDAV 서버 끄기' : 'WebDAV 서버 켜기'}
              </button>
            </div>

            <div className="sharing-row url-row">
              <input type="text" className="sharing-input-url" value={webdavUrl} readOnly />
              <button className="sharing-btn-copy" onClick={() => handleCopyUrl(webdavUrl)}><FaIcon name="fileLines" /> URL 복사</button>
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
