import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import '../styles/SharingTab.css';

const MIN_PORT = 1024;
const MAX_PORT = 65535;

function normalizePort(value, fallback) {
    const port = Number(value);
    if (!Number.isInteger(port)) return fallback;
    return Math.max(MIN_PORT, Math.min(MAX_PORT, port));
}

function formatToggleLabel(t, protocol, running) {
    const key = running ? 'tab_sharing_turn_off' : 'tab_sharing_turn_on';
    return t(key).replace('{protocol}', protocol);
}

function SharingTab({ config, saveConfig, t, showToast }) {
    const [opdsPort, setOpdsPort] = useState(config?.opds_port || 8080);
    const [opdsRunning, setOpdsRunning] = useState(false);
    const [webdavId, setWebdavId] = useState(config?.webdav_username || 'user');
    const [webdavPw, setWebdavPw] = useState(config?.webdav_password || '1234');
    const [webdavPwVisible, setWebdavPwVisible] = useState(false);
    const [webdavPort, setWebdavPort] = useState(config?.webdav_port || 8081);
    const [webdavRunning, setWebdavRunning] = useState(false);
    const [busyServer, setBusyServer] = useState(null);
    const [localIp, setLocalIp] = useState('127.0.0.1');
    const [logs, setLogs] = useState([
        { type: 'INFO', message: '서버 로그가 준비되었습니다.' },
    ]);
    const logConsoleRef = useRef(null);

    const appendLog = (type, message) => {
        setLogs(current => [
            ...current,
            {
                type: type === 'ERROR' ? 'ERROR' : 'INFO',
                message: String(message || ''),
            },
        ]);
    };

    useEffect(() => {
        setOpdsPort(config?.opds_port || 8080);
        setWebdavPort(config?.webdav_port || 8081);
        setWebdavId(config?.webdav_username || 'user');
        setWebdavPw(config?.webdav_password || '1234');
    }, [
        config?.opds_port,
        config?.webdav_password,
        config?.webdav_port,
        config?.webdav_username,
    ]);

    useEffect(() => {
        const consoleElement = logConsoleRef.current;
        if (consoleElement) consoleElement.scrollTop = consoleElement.scrollHeight;
    }, [logs]);

    useEffect(() => {
        let isMounted = true;

        const applyStatus = status => {
            if (!status || !isMounted) return;
            setLocalIp(status.localIp || '127.0.0.1');
            setOpdsRunning(Boolean(status.OPDS?.running));
            setWebdavRunning(Boolean(status.WebDAV?.running));
            if (status.OPDS?.port) setOpdsPort(status.OPDS.port);
            if (status.WebDAV?.port) setWebdavPort(status.WebDAV.port);
        };

        window.electronAPI?.getServerStatus?.()
            .then(applyStatus)
            .catch(error => appendLog('ERROR', `서버 상태 확인 실패: ${error.message}`));

        const cleanup = window.electronAPI?.onServerLog?.(data => {
            if (data?.status) applyStatus(data.status);
            if (data?.message) {
                const protocol = data.protocol ? `${data.protocol}: ` : '';
                appendLog(data.type, `${protocol}${data.message}`);
            }
        });

        return () => {
            isMounted = false;
            if (typeof cleanup === 'function') cleanup();
        };
    }, []);

    const savePort = async (key, value, fallback, setter) => {
        const nextPort = normalizePort(value, fallback);
        setter(nextPort);
        try {
            await saveConfig?.({ [key]: nextPort });
        } catch (error) {
            appendLog('ERROR', `설정 저장 실패: ${error.message}`);
        }
        return nextPort;
    };

    const saveCredential = async (key, value, fallback, setter) => {
        const nextValue = String(value).trim() || fallback;
        setter(nextValue);
        try {
            await saveConfig?.({ [key]: nextValue });
        } catch (error) {
            appendLog('ERROR', `설정 저장 실패: ${error.message}`);
        }
        return nextValue;
    };

    const handleCopyUrl = async url => {
        try {
            await navigator.clipboard.writeText(url);
            appendLog('INFO', `URL이 복사되었습니다: ${url}`);
            showToast?.('URL이 복사되었습니다.');
        } catch (error) {
            appendLog('ERROR', `URL 복사 실패: ${error.message}`);
        }
    };

    const handleToggleOpds = async () => {
        if (busyServer) return;
        setBusyServer('OPDS');
        try {
            if (opdsRunning) {
                await window.electronAPI.stopServer('OPDS');
                setOpdsRunning(false);
            } else {
                const port = await savePort('opds_port', opdsPort, 8080, setOpdsPort);
                const result = await window.electronAPI.startServer('OPDS', { port });
                setLocalIp(result.localIp || localIp);
                setOpdsRunning(Boolean(result.running));
            }
        } catch (error) {
            setOpdsRunning(false);
            appendLog('ERROR', `OPDS 서버 처리 실패: ${error.message}`);
        } finally {
            setBusyServer(null);
        }
    };

    const handleToggleWebdav = async () => {
        if (busyServer) return;
        setBusyServer('WebDAV');
        try {
            if (webdavRunning) {
                await window.electronAPI.stopServer('WebDAV');
                setWebdavRunning(false);
            } else {
                const port = await savePort('webdav_port', webdavPort, 8081, setWebdavPort);
                const username = await saveCredential('webdav_username', webdavId, 'user', setWebdavId);
                const password = await saveCredential('webdav_password', webdavPw, '1234', setWebdavPw);
                const result = await window.electronAPI.startServer('WebDAV', {
                    port,
                    username,
                    password,
                });
                setLocalIp(result.localIp || localIp);
                setWebdavRunning(Boolean(result.running));
            }
        } catch (error) {
            setWebdavRunning(false);
            appendLog('ERROR', `WebDAV 서버 처리 실패: ${error.message}`);
        } finally {
            setBusyServer(null);
        }
    };

    const opdsUrl = `http://${localIp}:${opdsPort}/opds`;
    const webdavUrl = `http://${localIp}:${webdavPort}/`;

    return (
        <div className="sharing-tab">
            <div className="sharing-left-panel">
                <div className="sharing-groupbox">
                    <div className="sharing-groupbox-title">{t('tab_sharing_opds_title')}</div>
                    <div className="sharing-groupbox-content">
                        <div className="sharing-row">
                            <label className="sharing-label" htmlFor="opds-port">{t('tab_sharing_port')}</label>
                            <input
                                id="opds-port"
                                type="number"
                                className="sharing-input-num"
                                min={MIN_PORT}
                                max={MAX_PORT}
                                value={opdsPort}
                                onChange={event => {
                                    setOpdsPort(event.target.value);
                                    const value = Number(event.target.value);
                                    if (value >= MIN_PORT && value <= MAX_PORT) {
                                        saveConfig?.({ opds_port: value }).catch(error => appendLog('ERROR', error.message));
                                    }
                                }}
                                onBlur={() => savePort('opds_port', opdsPort, 8080, setOpdsPort)}
                                disabled={opdsRunning || busyServer === 'OPDS'}
                            />
                            <button
                                className={`sharing-btn-toggle ${opdsRunning ? 'running' : ''}`}
                                onClick={handleToggleOpds}
                                disabled={Boolean(busyServer)}
                            >
                                <FaIcon name={opdsRunning ? 'stopCircle' : 'powerOff'} />
                                {busyServer === 'OPDS'
                                    ? '처리 중...'
                                    : formatToggleLabel(t, 'OPDS', opdsRunning)}
                            </button>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row url-row">
                            <input type="text" className="sharing-input-url" value={opdsUrl} readOnly />
                            <button className="sharing-btn-copy" onClick={() => handleCopyUrl(opdsUrl)}>
                                <FaIcon name="copy" /> {t('tab_sharing_copy')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sharing-groupbox mt-20">
                    <div className="sharing-groupbox-title">{t('tab_sharing_webdav_title')}</div>
                    <div className="sharing-groupbox-content">
                        <div className="sharing-desc">{t('tab_sharing_webdav_desc')}</div>

                        <div className="sharing-row">
                            <label className="sharing-label" htmlFor="webdav-id">{t('tab_sharing_webdav_id')}</label>
                            <input
                                id="webdav-id"
                                type="text"
                                className="sharing-input"
                                value={webdavId}
                                onChange={event => {
                                    setWebdavId(event.target.value);
                                    saveConfig?.({
                                        webdav_username: event.target.value.trim() || 'user',
                                    }).catch(error => appendLog('ERROR', error.message));
                                }}
                                onBlur={() => saveCredential('webdav_username', webdavId, 'user', setWebdavId)}
                                disabled={webdavRunning}
                            />
                            <label className="sharing-label ml-10" htmlFor="webdav-password">{t('tab_sharing_webdav_pw')}</label>
                            <div className="sharing-pw-wrapper">
                                <input
                                    id="webdav-password"
                                    type={webdavPwVisible ? 'text' : 'password'}
                                    className="sharing-input pw-input"
                                    value={webdavPw}
                                    onChange={event => {
                                        setWebdavPw(event.target.value);
                                        saveConfig?.({
                                            webdav_password: event.target.value.trim() || '1234',
                                        }).catch(error => appendLog('ERROR', error.message));
                                    }}
                                    onBlur={() => saveCredential('webdav_password', webdavPw, '1234', setWebdavPw)}
                                    disabled={webdavRunning}
                                />
                                <button
                                    type="button"
                                    className="sharing-btn-pw-eye"
                                    onClick={() => setWebdavPwVisible(current => !current)}
                                    disabled={webdavRunning}
                                    aria-label={webdavPwVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
                                >
                                    <FaIcon name={webdavPwVisible ? 'eye' : 'eyeSlash'} />
                                </button>
                            </div>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row">
                            <label className="sharing-label" htmlFor="webdav-port">{t('tab_sharing_port')}</label>
                            <input
                                id="webdav-port"
                                type="number"
                                className="sharing-input-num"
                                min={MIN_PORT}
                                max={MAX_PORT}
                                value={webdavPort}
                                onChange={event => {
                                    setWebdavPort(event.target.value);
                                    const value = Number(event.target.value);
                                    if (value >= MIN_PORT && value <= MAX_PORT) {
                                        saveConfig?.({ webdav_port: value }).catch(error => appendLog('ERROR', error.message));
                                    }
                                }}
                                onBlur={() => savePort('webdav_port', webdavPort, 8081, setWebdavPort)}
                                disabled={webdavRunning || busyServer === 'WebDAV'}
                            />
                            <button
                                className={`sharing-btn-toggle ${webdavRunning ? 'running' : ''}`}
                                onClick={handleToggleWebdav}
                                disabled={Boolean(busyServer)}
                            >
                                <FaIcon name={webdavRunning ? 'stopCircle' : 'powerOff'} />
                                {busyServer === 'WebDAV'
                                    ? '처리 중...'
                                    : formatToggleLabel(t, 'WebDAV', webdavRunning)}
                            </button>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row url-row">
                            <input type="text" className="sharing-input-url" value={webdavUrl} readOnly />
                            <button className="sharing-btn-copy" onClick={() => handleCopyUrl(webdavUrl)}>
                                <FaIcon name="copy" /> {t('tab_sharing_copy')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="sharing-right-panel">
                <div className="sharing-groupbox h-full">
                    <div className="sharing-groupbox-title">{t('tab_sharing_log_title')}</div>
                    <div className="sharing-groupbox-content h-full">
                        <div
                            ref={logConsoleRef}
                            className="sharing-log-console"
                            role="log"
                            aria-live="polite"
                        >
                            {logs.map((log, index) => (
                                <div
                                    key={`${index}-${log.message}`}
                                    className={log.type === 'ERROR' ? 'sharing-log-error' : ''}
                                >
                                    [{log.type}] {log.message}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { SharingTab };
export default SharingTab;
