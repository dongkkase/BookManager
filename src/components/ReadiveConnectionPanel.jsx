import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaIcon } from './FaIcon';
import { formatReadiveBytes } from '../readiveTransferPolicy';
import { copyReadivePairing, getReadivePairingText, readivePairingDeviceRevision } from '../readivePairingClipboard';
import '../styles/ReadiveTransfer.css';

export function useReadiveStatus() {
    const [status, setStatus] = useState({ running: false, devices: [], jobs: [], interfaces: [] });
    const [error, setError] = useState(false);
    const refresh = useCallback(async () => {
        const result = await window.electronAPI?.getReadiveStatus?.();
        if (!result) throw new Error('readive-unavailable');
        setStatus(result);
        setError(false);
        return result;
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
                if (active) timer = window.setTimeout(poll, 2000);
            }
        };
        poll();
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, []);
    return { status, refresh, statusError: error };
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
                            <span> · {t(`readive.status_${job.status}`)}</span>
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

export function ReadiveConnectionPanel({ t, showToast, variant = 'default' }) {
    const sharing = variant === 'sharing';
    const { status, refresh, statusError } = useReadiveStatus();
    const [address, setAddress] = useState('');
    const [pairing, setPairing] = useState(null);
    const panelRef = useRef(null);
    const currentPairingRef = useRef(null);
    const currentStatusRef = useRef(null);
    const [now, setNow] = useState(Date.now);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [revokeId, setRevokeId] = useState('');
    const interfaces = status.interfaces || [];
    const selectedAddress = status.running ? status.address : address || interfaces[0]?.address || '';
    const expiresAt = Date.parse(pairing?.expiresAt);
    const remainingSeconds = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
    const expired = pairing && remainingSeconds === 0;
    const deviceRevision = readivePairingDeviceRevision(status.devices);
    const pairingText = getReadivePairingText(pairing, { running: status.running, statusError, now, deviceRevision });
    currentPairingRef.current = pairing;
    currentStatusRef.current = { status, statusError };

    useEffect(() => {
        if (!status.running || statusError || (pairing?.deviceRevision !== undefined && pairing.deviceRevision !== deviceRevision)) setPairing(null);
    }, [status.running, statusError, pairing?.deviceRevision, deviceRevision]);

    useEffect(() => {
        if (expired) setPairing(current => current ? { expiresAt: current.expiresAt } : null);
    }, [pairing?.expiresAt, expired, status.running, statusError, deviceRevision]);

    useEffect(() => {
        if (!pairing || expired) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [pairing?.expiresAt, expired]);

    const createPairing = async () => {
        const revision = readivePairingDeviceRevision(currentStatusRef.current.status.devices);
        setPairing(null);
        const result = await window.electronAPI.createReadivePairing({});
        const currentStatus = await refresh();
        if (!currentStatus.running || revision !== readivePairingDeviceRevision(currentStatus.devices)) return;
        setNow(Date.now());
        setPairing({ ...result, deviceRevision: revision });
    };

    const copyPairing = async () => {
        let currentStatus;
        try {
            currentStatus = await refresh();
        } catch (error) {
            currentPairingRef.current = null;
            setPairing(null);
            throw error;
        }
        if (!panelRef.current?.getClientRects().length) return;
        currentStatusRef.current = { status: currentStatus, statusError: false };
        const result = await copyReadivePairing({
            getText: () => {
                const current = currentStatusRef.current;
                return getReadivePairingText(currentPairingRef.current, {
                    running: current.status.running,
                    statusError: current.statusError,
                    deviceRevision: readivePairingDeviceRevision(current.status.devices),
                });
            },
            writeText: text => navigator.clipboard.writeText(text),
        });
        if (result !== 'unavailable' && panelRef.current?.getClientRects().length) {
            showToast?.({ key: result === 'copied' ? 'readive.copied' : 'readive.copy_failed' });
        }
    };

    const run = async operation => {
        if (busyRef.current) return;
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
        <section ref={panelRef} className={sharing ? 'sharing-groupbox readive-sharing-panel' : 'readive-panel'} aria-labelledby="readive-connection-title">
            <h2 id="readive-connection-title" className={sharing ? 'sharing-groupbox-title' : undefined}>{t('readive.title')}</h2>
            <div className={sharing ? 'sharing-groupbox-content' : undefined}>
                <p className={sharing ? 'sharing-desc' : undefined}>{t('readive.description')}</p>
                <div className="readive-connection-layout">
                    <div className="readive-connection-details">
                        <div className="readive-row readive-interface-row">
                            <label className={sharing ? 'sharing-label' : undefined} htmlFor="readive-interface">{t('readive.interface')}</label>
                            <select id="readive-interface" className={sharing ? 'sharing-input-select' : undefined} value={selectedAddress} disabled={busy || status.running} onChange={event => setAddress(event.target.value)}>
                                {!interfaces.length && <option value="">{t('readive.no_interface')}</option>}
                                {interfaces.map(item => <option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}
                            </select>
                            <button type="button" className={sharing ? `sharing-btn-toggle${status.running ? ' running' : ''}` : undefined} disabled={busy || (!status.running && !selectedAddress)} onClick={() => run(async () => {
                                if (status.running) {
                                    await window.electronAPI.stopReadiveServer();
                                    setPairing(null);
                                } else {
                                    await window.electronAPI.startReadiveServer({ address: selectedAddress });
                                    await createPairing();
                                }
                            })}>
                                {sharing && <FaIcon name={status.running ? 'stopCircle' : 'powerOff'} />}
                                {t(sharing && busy ? 'tab_sharing_processing' : status.running ? 'readive.stop' : 'readive.start')}
                            </button>
                        </div>
                        {status.running && (
                            <>
                                {pairing && (
                                    <div className="readive-pairing">
                                        {pairingText && pairing.qrDataUrl && (
                                            <div className="readive-qr-card">
                                                <img className="readive-pairing-qr" src={pairing.qrDataUrl} alt={t('readive.qr_alt')} />
                                            </div>
                                        )}
                                        <p className={sharing ? 'sharing-desc' : undefined}>{t(expired ? 'readive.pair_expired' : 'readive.pair_instructions')}</p>
                                    </div>
                                )}
                                <div className="readive-pairing-actions">
                                    <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} disabled={busy} onClick={() => run(createPairing)}>{t('readive.pair')}</button>
                                    {pairing && !expired && <p className={sharing ? 'sharing-desc' : undefined}>
                                        {t('readive.expires', { time: new Date(pairing.expiresAt).toLocaleTimeString() })}
                                        <br />
                                        {t('readive.remaining', { minutes: Math.floor(remainingSeconds / 60), seconds: String(remainingSeconds % 60).padStart(2, '0') })}
                                    </p>}
                                </div>
                                {pairingText && <div className="readive-pairing-copy">
                                    <div className="readive-pairing-actions">
                                        <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} disabled={busy} onClick={() => run(copyPairing)}>{t('readive.copy')}</button>
                                        <p className={sharing ? 'sharing-desc' : undefined}>{t('readive.manual_instructions')}</p>
                                    </div>
                                </div>}
                            </>
                        )}
                    </div>
                    <div className="readive-devices">
                        <h3 className={sharing ? 'sharing-label' : undefined}>{t('readive.devices')}</h3>
                        {!status.devices?.length && <p className={sharing ? 'sharing-desc' : undefined}>{t('readive.no_devices')}</p>}
                        {status.devices?.map(device => (
                            <div className="readive-device" key={device.id}>
                                <span>{device.name}</span>
                                {revokeId === device.id ? <>
                                    <span>{t('readive.revoke_confirm')}</span>
                                    <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} disabled={busy} onClick={() => run(async () => {
                                        await window.electronAPI.revokeReadiveDevice({ deviceId: device.id });
                                        setRevokeId('');
                                    })}>{t('readive.revoke')}</button>
                                    <button type="button" className={sharing ? 'sharing-btn-copy' : undefined} onClick={() => setRevokeId('')}>{t('btn_cancel')}</button>
                                </> : <button type="button" className={sharing ? 'sharing-btn-copy readive-device-unlink' : undefined} title={t('readive.unlink')} aria-label={`${device.name} ${t('readive.unlink')}`} disabled={busy} onClick={() => setRevokeId(device.id)}><FaIcon name="unlink" /></button>}
                            </div>
                        ))}
                    </div>
                </div>
                {(error || statusError) && <p className="readive-error" role="alert">{error || t('readive.status_failed')}</p>}
            </div>
        </section>
    );
}
