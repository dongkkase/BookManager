import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaIcon } from './FaIcon';
import { formatReadiveBytes } from '../readiveTransferPolicy';
import { isMotionReduced, subscribeMotionPreference } from '../motionPolicy';
import '../styles/ReadiveTransfer.css';

export function useReadiveStatus(isActive = true) {
    const [status, setStatus] = useState({ running: false, devices: [], jobs: [], interfaces: [] });
    const [error, setError] = useState(false);
    const [statusLoaded, setStatusLoaded] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const result = await window.electronAPI?.getReadiveStatus?.();
            if (!result) throw new Error('readive-unavailable');
            setStatus(result);
            setError(false);
            return result;
        } catch (error) {
            setError(true);
            throw error;
        } finally {
            setStatusLoaded(true);
        }
    }, []);
    useEffect(() => {
        if (!isActive) {
            setStatusLoaded(false);
            return;
        }
        let active = true;
        let timer;
        const poll = async () => {
            try {
                const result = await window.electronAPI?.getReadiveStatus?.();
                if (active) {
                    if (!result) throw new Error('readive-unavailable');
                    setStatus(result);
                    setError(false);
                }
            } catch {
                if (active) setError(true);
            } finally {
                if (active) {
                    setStatusLoaded(true);
                    timer = window.setTimeout(poll, 2000);
                }
            }
        };
        poll();
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [isActive]);
    return { status, refresh, statusError: error, statusLoaded };
}

export function ReadiveJobs({ jobs = [], devices = [], t, onCancel, busy = false }) {
    if (!jobs.length) return null;
    return (
        <div className="readive-jobs">
            <h3>{t('readive.jobs')}</h3>
            {jobs.map(job => {
                const total = job.summary?.files || 0;
                const received = job.receivedEntryIds?.length || 0;
                const terminal = ['completed', 'cancelled', 'failed'].includes(job.status);
                return (
                    <div className="readive-job" key={job.id}>
                        <div>
                            <strong>{devices.find(device => device.id === job.deviceId)?.name || t('readive.device')}</strong>
                            <span> · {t(job.status === 'failed' ? 'readive.job_failed' : `readive.status_${job.status}`)}</span>
                            {job.origin === 'mobile-browse' && <div>{t('readive.mobile_requested')}</div>}
                            <div>{t('readive.progress', { received, total })} · {formatReadiveBytes(job.summary?.bytes)}</div>
                            {Boolean(job.failedEntryIds?.length) && <div role="alert">{t('readive.failed_count', { count: job.failedEntryIds.length })}</div>}
                        </div>
                        {!terminal && <button type="button" disabled={busy} onClick={() => onCancel(job.id)}>{t('btn_cancel')}</button>}
                        <progress value={received} max={Math.max(1, total)} aria-label={t('readive.progress', { received, total })} />
                    </div>
                );
            })}
        </div>
    );
}

export function ReadiveConnectionPanel({ t, config, saveConfig, variant = 'default', attentionRequest = null, isActive = true }) {
    const sharing = variant === 'sharing';
    const { status, refresh, statusError, statusLoaded } = useReadiveStatus(isActive);
    const [address, setAddress] = useState(null);
    const [port, setPort] = useState(null);
    const panelRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [revokeId, setRevokeId] = useState('');
    const [attentionVisible, setAttentionVisible] = useState(false);
    const consumedAttentionRef = useRef(null);
    const attentionCancelRef = useRef(null);
    const interfaces = status.interfaces || [];
    const selectedAddress = status.running ? status.address : address ?? (config?.readive_address || interfaces[0]?.address || '');
    const selectedPort = status.running ? status.port : port ?? config?.readive_port ?? 19421;
    const availableAddress = interfaces.some(item => item.address === selectedAddress);
    const portNumber = Number(selectedPort);
    const validPort = /^\d+$/.test(selectedPort) && portNumber >= 1024 && portNumber <= 65535;
    const fieldsDisabled = busy || status.running || !statusLoaded || statusError;
    const pairing = status.running && !statusError ? status.pairing : null;

    const stopAttention = useCallback(() => {
        attentionCancelRef.current?.();
        attentionCancelRef.current = null;
        setAttentionVisible(false);
    }, []);

    useEffect(() => {
        stopAttention();
        if (!sharing || !isActive || !attentionRequest || !statusLoaded || statusError) return;
        if (consumedAttentionRef.current === attentionRequest) return;
        consumedAttentionRef.current = attentionRequest;
        if (status.running || busy) return;

        let frame;
        let timer;
        let attentionShown = false;
        const unsubscribeMotion = subscribeMotionPreference(() => {
            if (attentionShown && isMotionReduced()) {
                panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            }
        });
        frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => {
                attentionShown = true;
                setAttentionVisible(true);
                panelRef.current?.scrollIntoView({
                    block: 'nearest',
                    behavior: isMotionReduced() ? 'instant' : 'smooth',
                });
                timer = window.setTimeout(() => {
                    attentionShown = false;
                    setAttentionVisible(false);
                }, 3600);
            });
        });
        const cancel = () => {
            unsubscribeMotion();
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
        attentionCancelRef.current = cancel;
        return () => {
            cancel();
            if (attentionCancelRef.current === cancel) attentionCancelRef.current = null;
        };
    }, [attentionRequest, sharing, isActive, statusLoaded, statusError, status.running, busy, stopAttention]);

    const run = async operation => {
        if (busyRef.current) return;
        stopAttention();
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            await operation();
        } catch {
            setError(t('readive.action_failed'));
        } finally {
            try {
                await refresh();
            } catch {
                setError(t('readive.action_failed'));
            }
            busyRef.current = false;
            setBusy(false);
        }
    };

    const toggleConnection = async () => {
        if (status.running) {
            await window.electronAPI.stopReadiveServer();
            return;
        }
        await window.electronAPI.startReadiveServer({ address: selectedAddress, port: portNumber });
        if (config?.readive_address === selectedAddress && config?.readive_port === portNumber) return;
        try {
            await saveConfig?.({ readive_address: selectedAddress, readive_port: portNumber });
        } catch (error) {
            setError(t('config_save_failed', { msg: error.message }));
        }
    };

    return (
        <section ref={panelRef} className={sharing ? `sharing-groupbox readive-sharing-panel${attentionVisible ? ' is-connection-attention' : ''}` : 'readive-panel'} aria-labelledby="readive-connection-title">
            <h2 id="readive-connection-title" className={sharing ? 'sharing-groupbox-title' : undefined}>{t('readive.title')}</h2>
            <div className={sharing ? 'sharing-groupbox-content' : undefined}>
                <p className={`readive-connection-description${sharing ? ' sharing-desc' : ''}`}>{t('readive.description')}</p>
                <p className={sharing ? 'sharing-desc' : undefined}>{t('reading_lists.shared_hint')}</p>
                <div className="readive-connection-toolbar">
                    <label className="readive-network-field" htmlFor="readive-interface">
                        {t('readive.interface')}
                        <select id="readive-interface" value={availableAddress ? selectedAddress : ''} disabled={fieldsDisabled || !interfaces.length} onChange={event => setAddress(event.target.value)}>
                            <option value="">{t(interfaces.length ? 'readive.manual_address' : 'readive.no_interface')}</option>
                            {interfaces.map(item => (
                                <option key={item.address} value={item.address}>
                                    {item.name}{item.kind === 'tailscale' && !/tailscale/i.test(item.name) ? ' (Tailscale)' : ''} · {item.address}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="readive-network-field" htmlFor="readive-ip">
                        IP
                        <input id="readive-ip" type="text" spellCheck={false} value={selectedAddress} disabled={fieldsDisabled} onChange={event => setAddress(event.target.value.trim())} />
                    </label>
                    <label className="readive-network-field" htmlFor="readive-port">
                        {t('tab_sharing_port')}
                        <input id="readive-port" type="number" min={1024} max={65535} value={selectedPort} disabled={fieldsDisabled} onChange={event => setPort(event.target.value)} />
                    </label>
                    <button
                        type="button"
                        className={sharing ? `sharing-btn-toggle${status.running ? ' running' : ''}` : undefined}
                        disabled={busy || !statusLoaded || (!status.running && (statusError || !availableAddress || !validPort))}
                        onClick={() => run(toggleConnection)}
                    >
                        <FaIcon name={status.running ? 'stopCircle' : 'powerOff'} />
                        {t(busy ? 'tab_sharing_processing' : status.running ? 'readive.stop' : 'readive.start')}
                    </button>
                </div>
                {statusLoaded && !statusError && !status.running && !availableAddress && (
                    <p className="readive-error">{t(interfaces.length ? 'readive.invalid_address' : 'readive.no_interface')}</p>
                )}
                {!status.running && !validPort && <p className="readive-error">{t('sharing_invalid_port')}</p>}
                <div className="readive-connection-layout">
                    <div className="readive-connection-details">
                        <div className="readive-pairing">
                            <div className={`readive-pairing-content${!pairing ? ' readive-pairing-empty' : ''}`}>
                                <h3 className="readive-pairing-title">{t('readive.pair_title')}</h3>
                                <p className={sharing ? 'sharing-desc' : undefined}>{t(status.running ? 'readive.pair_instructions' : 'readive.pair_enable_hint')}</p>
                                <p className={sharing ? 'sharing-desc' : undefined}>{t('readive.pair_once')}</p>
                            </div>
                            {pairing?.qrDataUrl && (
                                <div className="readive-qr-card">
                                    <img className="readive-pairing-qr" src={pairing.qrDataUrl} alt={t('readive.qr_alt')} />
                                </div>
                            )}
                        </div>
                        {status.running && !statusError && <details className="readive-network-settings">
                            <summary>{t('readive.network_settings')}</summary>
                            <div className="readive-network-content">
                                <p className={sharing ? 'sharing-desc' : undefined}>
                                    {t('readive.manual_instructions', { address: status.address, port: status.port })}
                                </p>
                            </div>
                        </details>}
                    </div>
                    <div className="readive-devices">
                        <h3 className={sharing ? 'sharing-label' : undefined}>{t('readive.devices')}</h3>
                        {!status.devices?.length && <p className={sharing ? 'sharing-desc' : undefined}>{t('readive.no_devices')}</p>}
                        {status.devices?.map(device => (
                            <div className="readive-device" key={device.id}>
                                <span className="readive-device-name"><FaIcon name="link" />{device.name}</span>
                                {revokeId === device.id ? <>
                                    <span className="readive-device-confirm">{t('readive.revoke_confirm')}</span>
                                    <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} disabled={busy} onClick={() => run(async () => {
                                        await window.electronAPI.revokeReadiveDevice({ deviceId: device.id });
                                        setRevokeId('');
                                    })}>{t('readive.revoke')}</button>
                                    <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} onClick={() => setRevokeId('')}>{t('btn_cancel')}</button>
                                </> : <button type="button" className={`readive-device-unlink${sharing ? ' sharing-btn-copy' : ''}`} title={t('readive.unlink')} aria-label={`${device.name} ${t('readive.unlink')}`} disabled={busy} onClick={() => setRevokeId(device.id)}><FaIcon name="unlink" /></button>}
                            </div>
                        ))}
                    </div>
                </div>
                {(error || statusError) && <p className="readive-error" role="alert">{error || t('readive.status_failed')}</p>}
            </div>
        </section>
    );
}
