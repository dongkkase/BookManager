import React, { useState } from 'react';

/**
 * 공유 서버 탭 컴포넌트
 * 기존 PyQt6 TabSharing의 React 버전
 * HTTP/WebDAV 서버 시작/정지, LAN 공유 등을 담당
 */
function SharingTab({ config, t }) {
  const [httpServerRunning, setHttpServerRunning] = useState(false);
  const [webdavServerRunning, setWebdavServerRunning] = useState(false);
  const [httpPort, setHttpPort] = useState(config?.httpPort || 8080);
  const [webdavPort, setWebdavPort] = useState(config?.webdavPort || 8081);

  const toggleHttpServer = async () => {
    try {
      if (httpServerRunning) {
        await window.electronAPI.stopServer('http');
        setHttpServerRunning(false);
      } else {
        await window.electronAPI.startServer('http', httpPort);
        setHttpServerRunning(true);
      }
    } catch (error) {
      console.error('HTTP 서버 토글 실패:', error);
    }
  };

  const toggleWebdavServer = async () => {
    try {
      if (webdavServerRunning) {
        await window.electronAPI.stopServer('webdav');
        setWebdavServerRunning(false);
      } else {
        await window.electronAPI.startServer('webdav', webdavPort);
        setWebdavServerRunning(true);
      }
    } catch (error) {
      console.error('WebDAV 서버 토글 실패:', error);
    }
  };

  return (
    <div className="tab-content sharing-tab">
      <div className="tab-header">
        <h2>{t('sharing.title') || '공유 서버'}</h2>
      </div>

      <div className="sharing-content">
        {/* HTTP 서버 섹션 */}
        <div className="server-section">
          <h3>{t('sharing.httpServer') || 'HTTP 서버'}</h3>
          <div className="server-controls">
            <div className="port-input">
              <label>{t('sharing.port') || '포트'}</label>
              <input
                type="number"
                value={httpPort}
                onChange={e => setHttpPort(Number(e.target.value))}
                disabled={httpServerRunning}
                min={1}
                max={65535}
              />
            </div>
            <button
              className={httpServerRunning ? 'btn-danger' : 'btn-primary'}
              onClick={toggleHttpServer}
            >
              {httpServerRunning
                ? t('sharing.stop') || '정지'
                : t('sharing.start') || '시작'}
            </button>
          </div>
          {httpServerRunning && (
            <div className="server-url">
              <span>{t('sharing.accessUrl') || '접속 URL:'}</span>
              <a href={`http://localhost:${httpPort}`} target="_blank" rel="noopener noreferrer">
                http://localhost:{httpPort}
              </a>
            </div>
          )}
        </div>

        {/* WebDAV 서버 섹션 */}
        <div className="server-section">
          <h3>{t('sharing.webdavServer') || 'WebDAV 서버'}</h3>
          <div className="server-controls">
            <div className="port-input">
              <label>{t('sharing.port') || '포트'}</label>
              <input
                type="number"
                value={webdavPort}
                onChange={e => setWebdavPort(Number(e.target.value))}
                disabled={webdavServerRunning}
                min={1}
                max={65535}
              />
            </div>
            <button
              className={webdavServerRunning ? 'btn-danger' : 'btn-primary'}
              onClick={toggleWebdavServer}
            >
              {webdavServerRunning
                ? t('sharing.stop') || '정지'
                : t('sharing.start') || '시작'}
            </button>
          </div>
          {webdavServerRunning && (
            <div className="server-url">
              <span>{t('sharing.accessUrl') || '접속 URL:'}</span>
              <a href={`http://localhost:${webdavPort}`} target="_blank" rel="noopener noreferrer">
                http://localhost:{webdavPort}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { SharingTab };
