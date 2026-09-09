import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaIcon } from './FaIcon';
import { formatReadiveBytes } from '../readiveTransferPolicy';
import '../styles/ReadiveTransfer.css';

export function useReadiveStatus() {
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
    }, []);
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

export function ReadiveConnectionPanel({ t, showToast, variant = 'default', attentionRequest = null, isActive = true }) {
    const sharing = variant === 'sharing';
    const { status, refresh, statusError, statusLoaded } = useReadiveStatus();
    const [address, setAddress] = useState('');
    const panelRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [revokeId, setRevokeId] = useState('');
    const [attentionVisible, setAttentionVisible] = useState(false);
    const consumedAttentionRef = useRef(null);
    const attentionCancelRef = useRef(null);
    const interfaces = status.interfaces || [];
    const selectedAddress = status.running ? status.address : address || interfaces[0]?.address || '';
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
        frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => {
                setAttentionVisible(true);
                panelRef.current?.scrollIntoView({
                    block: 'nearest',
                    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                });
                timer = window.setTimeout(() => setAttentionVisible(false), 3600);
            });
        });
        const cancel = () => {
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

    return (
        <section ref={panelRef} className={sharing ? `sharing-groupbox readive-sharing-panel${attentionVisible ? ' is-connection-attention' : ''}` : 'readive-panel'} aria-labelledby="readive-connection-title">
            <h2 id="readive-connection-title" className={sharing ? 'sharing-groupbox-title' : undefined}>{t('readive.title')}</h2>
            <div className={sharing ? 'sharing-groupbox-content' : undefined}>
                <p className={`readive-connection-description${sharing ? ' sharing-desc' : ''}`}>{t('readive.description')}</p>
                <div className="readive-connection-toolbar">
                    <button type="button" className={sharing ? `sharing-btn-toggle${status.running ? ' running' : ''}` : undefined} disabled={busy || !statusLoaded || (!status.running && !selectedAddress)} onClick={() => run(async () => {
                        if (status.running) {
                            await window.electronAPI.stopReadiveServer();
                        } else {
                            await window.electronAPI.startReadiveServer({ address: selectedAddress });
                        }
                    })}>
                        <FaIcon name={status.running ? 'stopCircle' : 'powerOff'} />
                        {t(busy ? 'tab_sharing_processing' : status.running ? 'readive.stop' : 'readive.start')}
                    </button>
                </div>
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
                        {statusLoaded && !statusError && !interfaces.length && !status.running && <p className="readive-error">{t('readive.no_interface')}</p>}
                        <details className="readive-network-settings">
                            <summary>{t('readive.network_settings')}</summary>
                            <div className="readive-network-content">
                                <div className="readive-row readive-interface-row">
                                    <label className={sharing ? 'sharing-label' : undefined} htmlFor="readive-interface">{t('readive.interface')}</label>
                                    <select id="readive-interface" className={sharing ? 'sharing-input-select' : undefined} value={selectedAddress} disabled={busy || status.running || !statusLoaded} onChange={event => setAddress(event.target.value)}>
                                        {!interfaces.length && <option value="">{t('readive.no_interface')}</option>}
                                        {interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}
                                    </select>
                                </div>
                                {status.running && !statusError && <p className={sharing ? 'sharing-desc' : undefined}>
                                    {t('readive.manual_instructions', { address: status.address, port: status.port })}
                                </p>}
                            </div>
                        </details>
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
