import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';
import { canEnqueueReadiveTransfer, formatReadiveBytes, selectReadiveEntries, summarizeReadiveEntries } from '../readiveTransferPolicy';
import { createReadiveDestinationBrowser } from '../readiveDestinationPolicy';
import { ReadiveConnectionPanel, ReadiveJobs, useReadiveStatus } from './ReadiveConnectionPanel';
import '../styles/ReadiveTransfer.css';

export function ReadiveTransferDialog({ paths, t, showToast, onClose }) {
    const { status, refresh, statusError } = useReadiveStatus();
    const [snapshot, setSnapshot] = useState(null);
    const [scanning, setScanning] = useState(true);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState('');
    const [excludedIds, setExcludedIds] = useState([]);
    const [deviceId, setDeviceId] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [largeConfirmed, setLargeConfirmed] = useState(false);
    const [jobId, setJobId] = useState('');
    const [showConnection, setShowConnection] = useState(false);
    const [scanVersion, setScanVersion] = useState(0);
    const scanningRef = useRef(false);
    const dialogRef = useModalAccessibility(true, () => { if (!busyRef.current) onClose(); });
    const selected = useMemo(() => selectReadiveEntries(snapshot?.entries, excludedIds), [snapshot, excludedIds]);
    const includedIds = useMemo(() => new Set(selected.map(entry => entry.id)), [selected]);
    const summary = useMemo(() => summarizeReadiveEntries(selected), [selected]);
    const device = status.devices?.find(item => item.id === deviceId);
    const destinationScope = useRef(null);
    destinationScope.current = { deviceId: device?.id, running: status.running && !statusError };
    const destinationBrowser = useMemo(() => createReadiveDestinationBrowser({
        requestPage: options => window.electronAPI.requestReadiveDestinationPage(options),
        isDeviceActive: id => destinationScope.current?.running && destinationScope.current.deviceId === id,
    }), []);
    const [destinationState, setDestinationState] = useState(destinationBrowser.getSnapshot);
    const destination = destinationState.selection;
    const destinationDisabled = busy || Boolean(jobId) || destinationState.loading;
    const canEnqueue = canEnqueueReadiveTransfer({ snapshot, summary, deviceId: device?.id, destination, running: status.running && !statusError, busy: busy || scanning || Boolean(jobId) || destinationState.loading, confirmed, largeConfirmed });

    useEffect(() => {
        const unsubscribe = destinationBrowser.subscribe(setDestinationState);
        return () => { unsubscribe(); destinationBrowser.setDevice('', false); };
    }, [destinationBrowser]);
    useEffect(() => {
        destinationBrowser.setDevice(device?.id ?? '', status.running && !statusError);
        setConfirmed(false);
        setLargeConfirmed(false);
    }, [destinationBrowser, device?.id, status.running, statusError]);
    const changeDestination = action => {
        setConfirmed(false);
        setLargeConfirmed(false);
        action();
    };

    useEffect(() => {
        let active = true;
        scanningRef.current = true;
        setScanning(true);
        setSnapshot(null);
        setError('');
        setConfirmed(false);
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
        setConfirmed(false);
        setLargeConfirmed(false);
    };

    const start = async () => {
        if (busyRef.current || !canEnqueue) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            const { collectionId, name, revision } = destination;
            const result = await window.electronAPI.enqueueReadiveTransfer({ snapshotId: snapshot.id, deviceId, excludedIds, confirmed, largeConfirmed, destination: { collectionId, name, revision } });
            setJobId(result.id || result.job?.id);
            await refresh();
        } catch {
            setError(t('readive.enqueue_failed'));
            setConfirmed(false);
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
            <section ref={dialogRef} className="readive-dialog" role="dialog" aria-modal="true" aria-labelledby="readive-transfer-title" tabIndex={-1}>
                <div className="readive-dialog-header">
                    <h2 id="readive-transfer-title">{t('readive.send')}</h2>
                    <button type="button" disabled={busy} onClick={onClose}>{t('btn_close')}</button>
                </div>
                <div className="readive-dialog-body">
                    <p>{t('readive.preview_description')}</p>
                    <details>
                        <summary>{t('readive.roots', { count: paths.length })}</summary>
                        <ul>{paths.map(path => <li className="readive-path" key={path}>{path}</li>)}</ul>
                    </details>
                    <div className="readive-row">
                        <label htmlFor="readive-device">{t('readive.device')}</label>
                        <select id="readive-device" value={deviceId} disabled={busy || Boolean(jobId)} onChange={event => {
                            setDeviceId(event.target.value);
                            setConfirmed(false);
                            setLargeConfirmed(false);
                        }}>
                            <option value="">{t('readive.choose_device')}</option>
                            {status.devices?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setShowConnection(current => !current)}>{t('readive.connection_settings')}</button>
                    </div>
                    {!status.running && <p role="status">{t('readive.server_required')}</p>}
                    {showConnection && <ReadiveConnectionPanel t={t} showToast={showToast} />}
                    <section className="readive-destination" aria-labelledby="readive-destination-title">
                        <h3 id="readive-destination-title">{t('readive.destination')}</h3>
                        <p>{t('readive.destination_description')}</p>
                        {!device && <p>{t('readive.choose_device')}</p>}
                        {device && <>
                            <div className="readive-row">
                                <button type="button" disabled={destinationDisabled || destinationState.trail.length < 2} onClick={() => changeDestination(() => destinationBrowser.back())}>{t('readive.destination_parent')}</button>
                                <button type="button" disabled={destinationDisabled || !status.running} onClick={() => changeDestination(() => destinationBrowser.refresh())}>{t('readive.destination_refresh')}</button>
                                <span className="readive-path">{destinationState.trail.map(entry => entry.name).join(' / ') || device.name}</span>
                            </div>
                            {destinationState.loading && <p role="status">{t('readive.destination_loading')}</p>}
                            {destinationState.error && <p role="alert" className="readive-error">{t('readive.destination_failed')}</p>}
                            {destinationState.page && <div className="readive-destination-entries" role="group" aria-label={t('readive.destination')}>
                                {!destinationState.page.entries.length && <p>{t('readive.destination_empty')}</p>}
                                {destinationState.page.entries.map(entry => entry.kind === 'directory'
                                    ? <button type="button" className="readive-destination-entry" key={entry.id} disabled={destinationDisabled || destinationState.error} onClick={() => changeDestination(() => destinationBrowser.open(entry.id))}>
                                        <span className="readive-path">{entry.name}/</span><span>{t('readive.folder')}</span>
                                    </button>
                                    : <div className="readive-destination-entry readive-destination-file" key={entry.id}>
                                        <span className="readive-path">{entry.name}</span><span>{entry.size === null ? t('readive.files') : formatReadiveBytes(entry.size)}</span>
                                    </div>)}
                            </div>}
                            <div className="readive-row">
                                {destinationState.page?.nextCursor && <button type="button" disabled={destinationDisabled || destinationState.error} onClick={() => changeDestination(() => destinationBrowser.more())}>{t('readive.destination_more')}</button>}
                                <button type="button" disabled={destinationDisabled || !destinationState.page || destinationState.error || !status.running} onClick={() => changeDestination(() => destinationBrowser.choose())}>{t('readive.destination_choose')}</button>
                            </div>
                        </>}
                        <p role="status" className={destination ? '' : 'readive-warning'}>{destination ? t('readive.destination_selected', { path: destination.name }) : t('readive.destination_required')}</p>
                    </section>
                    {scanning && <p role="status">{t('readive.scanning')}</p>}
                    {snapshot && <>
                        <dl className="readive-summary" aria-live="polite">
                            <div><dt>{t('readive.files')}</dt><dd>{summary.files}</dd></div>
                            <div><dt>{t('readive.folders')}</dt><dd>{summary.folders}</dd></div>
                            <div><dt>{t('readive.total_bytes')}</dt><dd>{formatReadiveBytes(summary.bytes)}</dd></div>
                            <div><dt>{t('readive.assets')}</dt><dd>{formatReadiveBytes(summary.metadataBytes + summary.coverBytes)}</dd></div>
                        </dl>
                        <p>{t('readive.space_check')}</p>
                        {Boolean(snapshot.summary?.skipped) && <p role="status">{t('readive.skipped', { count: snapshot.summary.skipped })}</p>}
                        {Boolean(snapshot.warnings?.length) && <p className="readive-warning">{t('readive.scan_warnings')}</p>}
                        {(snapshot.blocked || summary.blocked) && <p className="readive-error" role="alert">{t('readive.hard_limit')}</p>}
                        <div className="readive-entry-heading">
                            <h3>{t('readive.review_files')}</h3>
                            <button type="button" disabled={busy || Boolean(jobId)} onClick={() => {
                                setExcludedIds(snapshot.entries.map(entry => entry.id));
                                setConfirmed(false);
                                setLargeConfirmed(false);
                            }}>{t('readive.exclude_all')}</button>
                            <button type="button" disabled={busy || Boolean(jobId)} onClick={() => {
                                setExcludedIds([]);
                                setConfirmed(false);
                                setLargeConfirmed(false);
                            }}>{t('readive.restore_selection')}</button>
                        </div>
                        <div className="readive-entries" role="group" aria-label={t('readive.review_files')}>
                            {snapshot.entries.map(entry => {
                                const parentExcluded = Boolean(entry.parentId && !includedIds.has(entry.parentId));
                                const skipped = entry.unsupported || Boolean(entry.skippedReason);
                                return <label key={entry.id} className={`readive-entry${skipped ? ' readive-entry-skipped' : ''}`}>
                                    <input type="checkbox" checked={includedIds.has(entry.id)} disabled={busy || Boolean(jobId) || skipped || parentExcluded} onChange={() => changeSelection(entry.id)} />
                                    <span className="readive-path">{entry.relativePath || entry.name}{entry.kind === 'directory' ? '/' : ''}</span>
                                    <span>{skipped ? t('readive.entry_skipped') : entry.kind === 'directory' ? t('readive.folder') : formatReadiveBytes(entry.size + (entry.metadataBytes || 0) + (entry.coverBytes || 0))}</span>
                                </label>;
                            })}
                        </div>
                        {!jobId && <>
                            <label className="readive-confirm"><input type="checkbox" checked={confirmed} disabled={busy || snapshot.blocked || summary.blocked} onChange={event => setConfirmed(event.target.checked)} />{t('readive.confirm')}</label>
                            {summary.large && <label className="readive-confirm readive-warning"><input type="checkbox" checked={largeConfirmed} disabled={busy || snapshot.blocked || summary.blocked} onChange={event => setLargeConfirmed(event.target.checked)} />{t('readive.confirm_large')}</label>}
                        </>}
                    </>}
                    {jobId && <>
                        <p role="status">{t('readive.queued')}</p>
                        <ReadiveJobs jobs={status.jobs?.filter(job => job.id === jobId)} devices={status.devices} t={t} busy={busy} onCancel={cancel} />
                    </>}
                    {(error || statusError) && <p className="readive-error" role="alert">{error || t('readive.status_failed')}</p>}
                </div>
                <div className="readive-dialog-footer">
                    {!jobId && <button type="button" disabled={busy || scanning} onClick={() => setScanVersion(value => value + 1)}>{t('readive.rescan')}</button>}
                    {!jobId && <button type="button" className="readive-primary" disabled={!canEnqueue} onClick={start}>{t('readive.start_transfer')}</button>}
                    <button type="button" disabled={busy} onClick={onClose}>{t('btn_close')}</button>
                </div>
            </section>
        </div>
    );
}
