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

function formatAddressLabel(item) {
    const name = item?.name && item.name !== item.address ? `${item.name} - ` : '';
    return `${name}${item?.address || ''}`;
}

function SharingTab({ config, saveConfig, t, showToast }) {
    const text = (key, fallback, values) => {
        const translated = t?.(key, values);
        return translated && translated !== key ? translated : fallback;
    };
    const [opdsPort, setOpdsPort] = useState(config?.opds_port || 8080);
    const [opdsRunning, setOpdsRunning] = useState(false);
    const [webPort, setWebPort] = useState(config?.web_port || 8082);
    const [webRunning, setWebRunning] = useState(false);
    const [webdavId, setWebdavId] = useState(config?.webdav_username || 'user');
    const [webdavPw, setWebdavPw] = useState(config?.webdav_password || '1234');
    const [webdavPwVisible, setWebdavPwVisible] = useState(false);
    const [webdavPort, setWebdavPort] = useState(config?.webdav_port || 8081);
    const [webdavRunning, setWebdavRunning] = useState(false);
    const [httpsEnabled, setHttpsEnabled] = useState(Boolean(config?.sharing_https_enabled));
    const [busyServers, setBusyServers] = useState({});
    const [localIp, setLocalIp] = useState('127.0.0.1');
    const [serverAddress, setServerAddress] = useState(config?.sharing_server_address || '');
    const [serverAddresses, setServerAddresses] = useState([]);
    const [logs, setLogs] = useState([
        { type: 'INFO', message: text('tab_sharing_log_ready', '서버 로그가 준비되었습니다.') },
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
    const isServerBusy = type => Boolean(busyServers[type]);
    const setServerBusy = (type, busy) => {
        setBusyServers(current => {
            const next = { ...current };
            if (busy) {
                next[type] = true;
            } else {
                delete next[type];
            }
            return next;
        });
    };

    useEffect(() => {
        setOpdsPort(config?.opds_port || 8080);
        setWebPort(config?.web_port || 8082);
        setWebdavPort(config?.webdav_port || 8081);
        setWebdavId(config?.webdav_username || 'user');
        setWebdavPw(config?.webdav_password || '1234');
        setHttpsEnabled(Boolean(config?.sharing_https_enabled));
        setServerAddress(config?.sharing_server_address || '');
    }, [
        config?.opds_port,
        config?.sharing_https_enabled,
        config?.sharing_server_address,
        config?.web_port,
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
            setServerAddress(status.localIp || '127.0.0.1');
            if (Array.isArray(status.addresses)) setServerAddresses(status.addresses);
            setOpdsRunning(Boolean(status.OPDS?.running));
            setWebRunning(Boolean(status.Web?.running));
            setWebdavRunning(Boolean(status.WebDAV?.running));
            if (status.OPDS?.running) setHttpsEnabled(Boolean(status.OPDS.secure));
            if (status.Web?.running) setHttpsEnabled(Boolean(status.Web.secure));
            if (status.WebDAV?.running) setHttpsEnabled(Boolean(status.WebDAV.secure));
            if (status.OPDS?.port) setOpdsPort(status.OPDS.port);
            if (status.Web?.port) setWebPort(status.Web.port);
            if (status.WebDAV?.port) setWebdavPort(status.WebDAV.port);
        };

        window.electronAPI?.getServerAddresses?.()
            .then(addresses => {
                if (isMounted && Array.isArray(addresses)) setServerAddresses(addresses);
            })
            .catch(error => appendLog('ERROR', text('tab_sharing_address_failed', '서버 주소 확인 실패: {msg}', { msg: error.message })));

        window.electronAPI?.getServerStatus?.()
            .then(applyStatus)
            .catch(error => appendLog('ERROR', text('tab_sharing_status_failed', '서버 상태 확인 실패: {msg}', { msg: error.message })));

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

    const handleServerAddressChange = async event => {
        const address = event.target.value;
        setServerAddress(address);
        setLocalIp(address);
        try {
            const result = await window.electronAPI?.setServerAddress?.(address);
            const nextAddress = result?.address || address;
            setServerAddress(nextAddress);
            setLocalIp(nextAddress);
            if (Array.isArray(result?.status?.addresses)) setServerAddresses(result.status.addresses);
            await saveConfig?.({ sharing_server_address: nextAddress });
        } catch (error) {
            appendLog('ERROR', text('config_save_failed', '설정 저장 실패: {msg}', { msg: error.message }));
        }
    };

    const savePort = async (key, value, fallback, setter) => {
        const nextPort = normalizePort(value, fallback);
        setter(nextPort);
        try {
            await saveConfig?.({ [key]: nextPort });
        } catch (error) {
            appendLog('ERROR', text('config_save_failed', '설정 저장 실패: {msg}', { msg: error.message }));
        }
        return nextPort;
    };

    const saveCredential = async (key, value, fallback, setter) => {
        const nextValue = String(value).trim() || fallback;
        setter(nextValue);
        try {
            await saveConfig?.({ [key]: nextValue });
        } catch (error) {
            appendLog('ERROR', text('config_save_failed', '설정 저장 실패: {msg}', { msg: error.message }));
        }
        return nextValue;
    };

    const handleHttpsChange = async event => {
        const enabled = Boolean(event.target.checked);
        setHttpsEnabled(enabled);
        try {
            await saveConfig?.({ sharing_https_enabled: enabled });
        } catch (error) {
            setHttpsEnabled(current => !current);
            appendLog('ERROR', text('config_save_failed', '설정 저장 실패: {msg}', { msg: error.message }));
        }
    };

    const handleCopyUrl = async url => {
        try {
            await navigator.clipboard.writeText(url);
            appendLog('INFO', text('tab_sharing_url_copied_detail', 'URL이 복사되었습니다: {url}', { url }));
            showToast?.({ key: 'tab_sharing_url_copied' });
        } catch (error) {
            appendLog('ERROR', text('tab_sharing_url_copy_failed', 'URL 복사 실패: {msg}', { msg: error.message }));
        }
    };

    const handleToggleOpds = async () => {
        if (isServerBusy('OPDS')) return;
        setServerBusy('OPDS', true);
        try {
            if (opdsRunning) {
                await window.electronAPI.stopServer('OPDS');
                setOpdsRunning(false);
            } else {
                const port = await savePort('opds_port', opdsPort, 8080, setOpdsPort);
                const result = await window.electronAPI.startServer('OPDS', {
                    port,
                    https: httpsEnabled,
                    address: serverAddress || localIp,
                });
                setLocalIp(result.localIp || localIp);
                setServerAddress(result.localIp || serverAddress || localIp);
                setOpdsRunning(Boolean(result.running));
            }
        } catch (error) {
            setOpdsRunning(false);
            appendLog('ERROR', text('tab_sharing_opds_action_failed', 'OPDS 서버 처리 실패: {msg}', { msg: error.message }));
        } finally {
            setServerBusy('OPDS', false);
        }
    };

    const handleToggleWeb = async () => {
        if (isServerBusy('Web')) return;
        setServerBusy('Web', true);
        try {
            if (webRunning) {
                await window.electronAPI.stopServer('Web');
                setWebRunning(false);
            } else {
                const port = await savePort('web_port', webPort, 8082, setWebPort);
                const result = await window.electronAPI.startServer('Web', {
                    port,
                    https: httpsEnabled,
                    address: serverAddress || localIp,
                });
                setLocalIp(result.localIp || localIp);
                setServerAddress(result.localIp || serverAddress || localIp);
                setWebRunning(Boolean(result.running));
            }
        } catch (error) {
            setWebRunning(false);
            appendLog('ERROR', text('tab_sharing_web_action_failed', 'Web 서버 처리 실패: {msg}', { msg: error.message }));
        } finally {
            setServerBusy('Web', false);
        }
    };

    const handleToggleWebdav = async () => {
        if (isServerBusy('WebDAV')) return;
        setServerBusy('WebDAV', true);
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
                    https: httpsEnabled,
                    address: serverAddress || localIp,
                });
                setLocalIp(result.localIp || localIp);
                setServerAddress(result.localIp || serverAddress || localIp);
                setWebdavRunning(Boolean(result.running));
            }
        } catch (error) {
            setWebdavRunning(false);
            appendLog('ERROR', text('tab_sharing_webdav_action_failed', 'WebDAV 서버 처리 실패: {msg}', { msg: error.message }));
        } finally {
            setServerBusy('WebDAV', false);
        }
    };

    const anyServerRunning = opdsRunning || webRunning || webdavRunning;
    const urlScheme = httpsEnabled ? 'https' : 'http';
    const displayIp = serverAddress || localIp;
    const opdsUrl = `${urlScheme}://${displayIp}:${opdsPort}/opds`;
    const webUrl = `${urlScheme}://${displayIp}:${webPort}/`;
    const webdavUrl = `${urlScheme}://${displayIp}:${webdavPort}/`;
    const addressOptions = serverAddresses.some(item => item.address === displayIp)
        ? serverAddresses
        : [{ address: displayIp, name: displayIp }, ...serverAddresses];

    return (
        <div className="sharing-tab">
            <div className="sharing-left-panel">
                <div className="sharing-groupbox">
                    <div className="sharing-groupbox-title">{t('tab_sharing_security_title')}</div>
                    <div className="sharing-groupbox-content">
                        <label className="sharing-option-row" htmlFor="sharing-https-enabled">
                            <input
                                id="sharing-https-enabled"
                                type="checkbox"
                                checked={httpsEnabled}
                                onChange={handleHttpsChange}
                                disabled={anyServerRunning}
                            />
                            <span>{t('tab_sharing_https_enabled')}</span>
                        </label>
                        <div className="sharing-desc">{t('tab_sharing_https_desc')}</div>
                        <div className="sharing-row">
                            <label className="sharing-label" htmlFor="sharing-server-address">
                                {text('tab_sharing_server_address', '서버 주소')}
                            </label>
                            <select
                                id="sharing-server-address"
                                className="sharing-input-select"
                                value={displayIp}
                                onChange={handleServerAddressChange}
                            >
                                {addressOptions.map(item => (
                                    <option key={item.address} value={item.address}>
                                        {formatAddressLabel(item)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="sharing-groupbox mt-20">
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
                                disabled={opdsRunning || isServerBusy('OPDS')}
                            />
                            <button
                                type="button"
                                className={`sharing-btn-toggle ${opdsRunning ? 'running' : ''}`}
                                onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleToggleOpds();
                                }}
                                disabled={isServerBusy('OPDS')}
                            >
                                <FaIcon name={opdsRunning ? 'stopCircle' : 'powerOff'} />
                                {isServerBusy('OPDS')
                                    ? t('tab_sharing_processing')
                                    : formatToggleLabel(t, 'OPDS', opdsRunning)}
                            </button>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row url-row">
                            <input type="text" className="sharing-input-url" value={opdsUrl} readOnly />
                            <button type="button" className="sharing-btn-copy" onClick={() => handleCopyUrl(opdsUrl)}>
                                <FaIcon name="copy" /> {t('tab_sharing_copy')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sharing-groupbox mt-20">
                    <div className="sharing-groupbox-title">{t('tab_sharing_web_title')}</div>
                    <div className="sharing-groupbox-content">
                        <div className="sharing-desc">{t('tab_sharing_web_desc')}</div>

                        <div className="sharing-row">
                            <label className="sharing-label" htmlFor="web-port">{t('tab_sharing_port')}</label>
                            <input
                                id="web-port"
                                type="number"
                                className="sharing-input-num"
                                min={MIN_PORT}
                                max={MAX_PORT}
                                value={webPort}
                                onChange={event => {
                                    setWebPort(event.target.value);
                                    const value = Number(event.target.value);
                                    if (value >= MIN_PORT && value <= MAX_PORT) {
                                        saveConfig?.({ web_port: value }).catch(error => appendLog('ERROR', error.message));
                                    }
                                }}
                                onBlur={() => savePort('web_port', webPort, 8082, setWebPort)}
                                disabled={webRunning || isServerBusy('Web')}
                            />
                            <button
                                type="button"
                                className={`sharing-btn-toggle ${webRunning ? 'running' : ''}`}
                                onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleToggleWeb();
                                }}
                                disabled={isServerBusy('Web')}
                            >
                                <FaIcon name={webRunning ? 'stopCircle' : 'powerOff'} />
                                {isServerBusy('Web')
                                    ? t('tab_sharing_processing')
                                    : formatToggleLabel(t, 'Web', webRunning)}
                            </button>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row url-row">
                            <input type="text" className="sharing-input-url" value={webUrl} readOnly />
                            <button type="button" className="sharing-btn-copy" onClick={() => handleCopyUrl(webUrl)}>
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
                                    aria-label={webdavPwVisible ? t('secret_hide') : t('secret_show')}
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
                                disabled={webdavRunning || isServerBusy('WebDAV')}
                            />
                            <button
                                type="button"
                                className={`sharing-btn-toggle ${webdavRunning ? 'running' : ''}`}
                                onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleToggleWebdav();
                                }}
                                disabled={isServerBusy('WebDAV')}
                            >
                                <FaIcon name={webdavRunning ? 'stopCircle' : 'powerOff'} />
                                {isServerBusy('WebDAV')
                                    ? t('tab_sharing_processing')
                                    : formatToggleLabel(t, 'WebDAV', webdavRunning)}
                            </button>
                            <div className="sharing-spacer" />
                        </div>

                        <div className="sharing-row url-row">
                            <input type="text" className="sharing-input-url" value={webdavUrl} readOnly />
                            <button type="button" className="sharing-btn-copy" onClick={() => handleCopyUrl(webdavUrl)}>
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
