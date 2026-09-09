import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { canEnqueueReadiveTransfer, formatReadiveBytes, selectReadiveEntries, summarizeReadiveEntries } from '../readiveTransferPolicy';
import { createReadiveDestinationBrowser } from '../readiveDestinationPolicy';
import { ReadiveJobs, useReadiveStatus } from './ReadiveConnectionPanel';
import { FaIcon } from './FaIcon';
import '../styles/ReadiveTransfer.css';

const LAST_DEVICE_STORAGE_KEY = 'bookmanager.readive.lastDeviceId';

export function ReadiveTransferDialog({ paths, t, onClose, onOpenSharing }) {
    const { status, refresh, statusError, statusLoaded } = useReadiveStatus();
    const [snapshot, setSnapshot] = useState(null);
    const [scanning, setScanning] = useState(true);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [excludedIds, setExcludedIds] = useState([]);
    const [deviceId, setDeviceId] = useState(() => {
        try {
            return window.localStorage.getItem(LAST_DEVICE_STORAGE_KEY) || '';
        } catch {
            return '';
        }
    });
    const [largeConfirmed, setLargeConfirmed] = useState(false);
    const [jobId, setJobId] = useState('');
    const [scanVersion, setScanVersion] = useState(0);
    const scanningRef = useRef(false);
    const dialogRef = useModalAccessibility(true, () => { if (!busyRef.current) onClose(); });
    const selected = useMemo(() => selectReadiveEntries(snapshot?.entries, excludedIds), [snapshot, excludedIds]);
    const includedIds = useMemo(() => new Set(selected.map(entry => entry.id)), [selected]);
    const summary = useMemo(() => summarizeReadiveEntries(selected), [selected]);
    const device = statusLoaded && !statusError ? status.devices?.find(item => item.id === deviceId) : undefined;
    const destinationScope = useRef(null);
    destinationScope.current = { deviceId: device?.id, running: status.running && !statusError };
    const destinationBrowser = useMemo(() => createReadiveDestinationBrowser({
        requestPage: options => window.electronAPI.requestReadiveDestinationPage(options),
        isDeviceActive: id => destinationScope.current?.running && destinationScope.current.deviceId === id,
    }), []);
    const [destinationState, setDestinationState] = useState(destinationBrowser.getSnapshot);
    const destination = destinationState.selection;
    const destinationDisabled = busy || Boolean(jobId) || destinationState.loading;
    const canEnqueue = canEnqueueReadiveTransfer({ snapshot, summary, deviceId: device?.id, destination, running: status.running && !statusError, busy: busy || scanning || Boolean(jobId) || destinationState.loading, largeConfirmed });
    const needsConnection = statusLoaded && (!status.running || !status.devices?.length);
    const activeStep = !device || !status.running || statusError ? 0 : !destination ? 1 : 2;
    const job = status.jobs?.find(item => item.id === jobId);
    const jobTerminal = ['completed', 'cancelled', 'failed'].includes(job?.status);
    const jobTitle = job?.status === 'completed' ? 'transfer_completed'
        : job?.status === 'cancelled' ? 'transfer_cancelled'
            : job?.status === 'failed' ? 'transfer_failed'
                : ['receiving', 'accepted'].includes(job?.status) ? 'transfer_running' : 'transfer_requested';
    const nextHint = scanning ? 'scanning' : statusError ? 'status_failed'
        : !status.running ? 'setup_in_sharing' : !device ? 'choose_device'
            : destinationState.loading ? 'destination_loading' : !destination ? 'destination_required'
                : !snapshot ? 'scan_failed' : snapshot.blocked || summary.blocked ? 'hard_limit'
                    : !summary.files ? 'empty_selection'
                        : summary.large && !largeConfirmed ? 'confirm_large' : 'ready_hint';

    useEffect(() => {
        if (!statusLoaded || statusError || jobId || device) return;
        setDeviceId(status.devices?.length === 1 ? status.devices[0].id : '');
    }, [device, status.devices, statusLoaded, statusError, jobId]);

    useEffect(() => {
        if (!device?.id || !statusLoaded || statusError) return;
        try {
            window.localStorage.setItem(LAST_DEVICE_STORAGE_KEY, device.id);
        } catch {}
    }, [device?.id, statusLoaded, statusError]);

    useEffect(() => {
        if (needsConnection && !statusError && !jobId && !busy) onOpenSharing();
    }, [needsConnection, statusError, jobId, busy, onOpenSharing]);

    useEffect(() => {
        if (jobId) dialogRef.current?.focus();
    }, [jobId, dialogRef]);

    useEffect(() => {
        const unsubscribe = destinationBrowser.subscribe(setDestinationState);
        return () => { unsubscribe(); destinationBrowser.setDevice('', false); };
    }, [destinationBrowser]);
    useEffect(() => {
        destinationBrowser.setDevice(device?.id ?? '', status.running && !statusError);
        setLargeConfirmed(false);
    }, [destinationBrowser, device?.id, status.running, statusError]);
    const changeDestination = action => {
        setLargeConfirmed(false);
        action();
    };

    useEffect(() => {
        let active = true;
        scanningRef.current = true;
        setScanning(true);
        setSnapshot(null);
        setError('');
        setLargeConfirmed(false);
        setExcludedIds([]);
        window.electronAPI.scanReadiveTransfer({ paths }).then(result => {
            if (active) setSnapshot(result);
        }).catch(() => {
            if (active) setError(t('readive.scan_failed'));
        }).finally(() => {
            scanningRef.current = false;
            if (active) setScanning(false);
        });
        return () => {
            active = false;
            if (scanningRef.current) window.electronAPI.cancelReadiveTransfer({ scan: true }).catch(() => {});
        };
    }, [paths, scanVersion]);

    const changeSelection = id => {
        setExcludedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
        setLargeConfirmed(false);
    };

    const start = async () => {
        if (busyRef.current || !canEnqueue) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            const { collectionId, name, revision } = destination;
            const result = await window.electronAPI.enqueueReadiveTransfer({ snapshotId: snapshot.id, deviceId, excludedIds, confirmed: true, largeConfirmed, destination: { collectionId, name, revision } });
            setJobId(result.id || result.job?.id);
            await refresh().catch(() => {});
        } catch {
            setError(t('readive.enqueue_failed'));
            setLargeConfirmed(false);
            destinationBrowser.refresh();
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const cancel = async id => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            await window.electronAPI.cancelReadiveTransfer({ jobId: id });
            await refresh();
        } catch {
            setError(t('readive.action_failed'));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    return (
        <div className="readive-overlay" onMouseDown={event => event.stopPropagation()}>
            <section ref={dialogRef} className="readive-dialog" role="dialog" aria-modal="true" aria-labelledby="readive-transfer-title" aria-describedby="readive-transfer-description" tabIndex={-1}>
                <div className="readive-dialog-header">
                    <h2 id="readive-transfer-title"><FaIcon name="towerBroadcast" />{t('readive.send')}</h2>
                    <button type="button" className="readive-icon-button" aria-label={t('btn_close')} title={t('btn_close')} disabled={busy} onClick={onClose}><FaIcon name="xmark" /></button>
                </div>
                <div className="readive-dialog-body">
                    <p id="readive-transfer-description" className="readive-muted">{t(jobId ? jobTerminal ? 'readive.transfer_done_hint' : 'readive.transfer_background' : 'readive.preview_description')}</p>
                    {!jobId && <>
                        <ol className="readive-steps" aria-label={t('readive.transfer_steps')}>
                            {['step_device', 'step_destination', 'step_review'].map((key, index) => (
                                <li key={key} className={index === activeStep ? 'is-current' : index < activeStep ? 'is-complete' : ''} aria-current={index === activeStep ? 'step' : undefined}>
                                    <span className="readive-step-number">{index < activeStep ? <FaIcon name="check" size={11} /> : index + 1}</span>
                                    {t(`readive.${key}`)}
                                </li>
                            ))}
                        </ol>
                        <section className="readive-device-section" aria-labelledby="readive-device-title">
                            <div className="readive-section-heading">
                                <h3 id="readive-device-title">{t('readive.device')}</h3>
                                <span className={`readive-status-badge${status.running && !statusError ? ' is-running' : ''}`}>{t(!statusLoaded ? 'readive.connection_loading' : statusError ? 'readive.connection_unavailable' : status.running ? 'readive.connection_ready' : 'readive.connection_off')}</span>
                            </div>
                            <div className="readive-row readive-device-picker">
                                <select id="readive-device" aria-labelledby="readive-device-title" value={device?.id || ''} disabled={busy || !statusLoaded || statusError || !status.devices?.length} onChange={event => {
                                    setDeviceId(event.target.value);
                                    setLargeConfirmed(false);
                                }}>
                                    <option value="">{t(statusLoaded && !status.devices?.length ? 'readive.no_devices' : 'readive.choose_device')}</option>
                                    {status.devices?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                            </div>
                            <p className="readive-muted readive-device-hint">{t('readive.device_hint')}</p>
                        </section>
                        <div className="readive-transfer-layout">
                            <section className="readive-destination" aria-labelledby="readive-destination-title">
                                <div className="readive-section-heading">
                                    <h3 id="readive-destination-title"><FaIcon name="folderOpen" />{t('readive.destination')}</h3>
                                </div>
                                {!device || !status.running || statusError ? <div className="readive-empty-state">
                                    <FaIcon name="folderOpen" size={26} />
                                    <p>{t('readive.destination_waiting')}</p>
                                    <p>{t('readive.open_app_hint')}</p>
                                </div> : <>
                                    <div className="readive-destination-toolbar">
                                        <button type="button" className="readive-icon-button" title={t('readive.destination_parent')} aria-label={t('readive.destination_parent')} disabled={destinationDisabled || destinationState.trail.length < 2} onClick={() => changeDestination(() => destinationBrowser.back())}><FaIcon name="angleUp" /></button>
                                        <span className="readive-path">{destinationState.trail.map(entry => entry.name).join(' / ') || device.name}</span>
                                        <button type="button" className="readive-icon-button" title={t('readive.destination_refresh')} aria-label={t('readive.destination_refresh')} disabled={destinationDisabled || !status.running} onClick={() => changeDestination(() => destinationBrowser.refresh())}><FaIcon name="rotateRight" /></button>
                                    </div>
                                    {destinationState.loading && <p className="readive-inline-notice" role="status"><FaIcon name="spinner" className="readive-spinner" />{t('readive.destination_loading')}</p>}
                                    {destinationState.error && <p role="alert" className="readive-error">{t('readive.destination_failed')}</p>}
                                    {destinationState.page && <div className="readive-destination-entries" role="group" aria-label={t('readive.destination')}>
                                        {!destinationState.page.entries.length && <p className="readive-muted">{t('readive.destination_empty')}</p>}
                                        {destinationState.page.entries.map(entry => entry.kind === 'directory'
                                            ? <button type="button" className="readive-destination-entry" key={entry.id} disabled={destinationDisabled || destinationState.error} onClick={() => changeDestination(() => destinationBrowser.open(entry.id))}>
                                                <FaIcon name="folder" /><span className="readive-path">{entry.name}</span><FaIcon name="angleRight" />
                                            </button>
                                            : <div className="readive-destination-entry readive-destination-file" key={entry.id}>
                                                <FaIcon name="file" /><span className="readive-path">{entry.name}</span><span>{entry.size === null ? t('readive.files') : formatReadiveBytes(entry.size)}</span>
                                            </div>)}
                                    </div>}
                                    {destinationState.page?.nextCursor && <button type="button" className="readive-text-button" disabled={destinationDisabled || destinationState.error} onClick={() => changeDestination(() => destinationBrowser.more())}>{t('readive.destination_more')}</button>}
                                </>}
                            </section>
                            <section className="readive-review" aria-labelledby="readive-review-title">
                                <div className="readive-section-heading">
                                    <h3 id="readive-review-title"><FaIcon name="file" />{t('readive.step_review')}</h3>
                                    <button type="button" className="readive-text-button" disabled={busy || scanning} onClick={() => setScanVersion(value => value + 1)}>{t('readive.rescan')}</button>
                                </div>
                                {scanning && <p className="readive-inline-notice" role="status"><FaIcon name="spinner" className="readive-spinner" />{t('readive.scanning')}</p>}
                                {snapshot && <>
                                    <dl className="readive-summary" aria-live="polite">
                                        <div><dt>{t('readive.files')}</dt><dd>{summary.files}</dd></div>
                                        <div><dt>{t('readive.folders')}</dt><dd>{summary.folders}</dd></div>
                                        <div><dt>{t('readive.total_bytes')}</dt><dd>{formatReadiveBytes(summary.bytes)}</dd></div>
                                    </dl>
                                    {summary.metadataBytes + summary.coverBytes > 0 && <p className="readive-muted">{t('readive.included_assets', { size: formatReadiveBytes(summary.metadataBytes + summary.coverBytes) })}</p>}
                                    <details className="readive-file-details">
                                        <summary tabIndex={0}>{t('readive.review_details')}</summary>
                                        <p className="readive-muted">{t('readive.review_hint')}</p>
                                        <div className="readive-entry-heading">
                                            <button type="button" disabled={busy} onClick={() => {
                                                setExcludedIds([]);
                                                setLargeConfirmed(false);
                                            }}>{t('readive.restore_selection')}</button>
                                            <button type="button" disabled={busy} onClick={() => {
                                                setExcludedIds(snapshot.entries.map(entry => entry.id));
                                                setLargeConfirmed(false);
                                            }}>{t('readive.exclude_all')}</button>
                                        </div>
                                        <div className="readive-entries" role="group" aria-label={t('readive.review_files')}>
                                            {snapshot.entries.map(entry => {
                                                const parentExcluded = Boolean(entry.parentId && !includedIds.has(entry.parentId));
                                                const skipped = entry.unsupported || Boolean(entry.skippedReason);
                                                return <label key={entry.id} className={`readive-entry${skipped ? ' readive-entry-skipped' : ''}`}>
                                                    <input type="checkbox" checked={includedIds.has(entry.id)} disabled={busy || skipped || parentExcluded} onChange={() => changeSelection(entry.id)} />
                                                    <span className="readive-path">{entry.relativePath || entry.name}{entry.kind === 'directory' ? '/' : ''}</span>
                                                    <span>{skipped ? t('readive.entry_skipped') : entry.kind === 'directory' ? t('readive.folder') : formatReadiveBytes(entry.size + (entry.metadataBytes || 0) + (entry.coverBytes || 0))}</span>
                                                </label>;
                                            })}
                                        </div>
                                    </details>
                                    <details className="readive-source-details">
                                        <summary tabIndex={0}>{t('readive.roots', { count: paths.length })}</summary>
                                        <ul>{paths.map(path => <li className="readive-path" key={path}>{path}</li>)}</ul>
                                    </details>
                                    {Boolean(snapshot.summary?.skipped) && <p className="readive-warning" role="status">{t('readive.skipped', { count: snapshot.summary.skipped })}</p>}
                                    {Boolean(snapshot.warnings?.length) && <p className="readive-warning">{t('readive.scan_warnings')}</p>}
                                    {(snapshot.blocked || summary.blocked) && <p className="readive-error" role="alert">{t('readive.hard_limit')}</p>}
                                    {!summary.files && !snapshot.blocked && <p className="readive-warning" role="status">{t('readive.empty_selection')}</p>}
                                </>}
                            </section>
                        </div>
                        {snapshot && <div className="readive-confirmation">
                            {destination && <p className="readive-confirm-destination readive-path">{device?.name} · {t('readive.destination_selected', { path: destination.name })}</p>}
                            {summary.large && <label className="readive-confirm readive-warning"><input type="checkbox" checked={largeConfirmed} disabled={busy || snapshot.blocked || summary.blocked} onChange={event => setLargeConfirmed(event.target.checked)} />{t('readive.confirm_large')}</label>}
                            <p className="readive-muted">{t('readive.originals_kept')} {t('readive.space_check')}</p>
                        </div>}
                    </>}
                    {jobId && <div className={`readive-transfer-result${job?.status === 'failed' ? ' is-failed' : ''}`}>
                        <div className="readive-result-heading" role="status">
                            <span className="readive-result-icon"><FaIcon name={job?.status === 'completed' ? 'circleCheck' : jobTerminal ? 'info' : 'towerBroadcast'} size={28} /></span>
                            <h3>{t(`readive.${jobTitle}`)}</h3>
                            {(!job || job.status === 'queued') && <p className="readive-muted">{t('readive.queued')}</p>}
                        </div>
                        <div className="readive-result-destination readive-path"><FaIcon name="folderOpen" />{device?.name}{destination && ` · ${destination.name}`}</div>
                        <ReadiveJobs jobs={status.jobs?.filter(item => item.id === jobId)} devices={status.devices} t={t} busy={busy} onCancel={cancel} />
                    </div>}
                    {(error || statusError) && <p className="readive-error readive-inline-notice" role="alert">{error || t('readive.status_failed')}</p>}
                </div>
                <div className="readive-dialog-footer">
                    {!jobId && <p className="readive-footer-hint" role="status">{t(`readive.${nextHint}`)}</p>}
                    <div className="readive-footer-actions">
                        <button type="button" disabled={busy} onClick={onClose}>{t('btn_close')}</button>
                        {!jobId && <button type="button" className="readive-primary" disabled={!canEnqueue} onClick={start}><FaIcon name={busy ? 'spinner' : 'towerBroadcast'} className={busy ? 'readive-spinner' : undefined} />{t(busy ? 'readive.preparing' : 'readive.start_transfer')}</button>}
                    </div>
                </div>
            </section>
        </div>
    );
}
