import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../../../components/FaIcon';
import { FileDropHoverOverlay } from '../../../components/FileDropHoverOverlay';
import { ResultLogDialog } from '../../../components/ResultLogDialog';
import { droppedPathsFromDataTransfer, isFilePathDrag, normalizeDroppedPaths } from '../../../appShell';
import { createToolbarState, emitToolbarState } from '../../../toolbarState';
import { emitStatusState } from '../../../statusState';
import { resolveFileDropMode } from '../../../dropPolicy';
import { shouldPlayCompletionSound } from '../../../completionSoundPolicy';
import { collectCoverEditorFolderPaths } from '../coverEditor/coverEditorFolderPaths';
import { normalizeSettings, resourceSettings, resourceRemovalSelected, estimateOptimization } from '../../../../electron/epubOptimizer/model.js';
import { optimizerText, optimizerError } from './labels';
import { checkedEstimate, copyGeneralSettings, createFile, createResultLog, fileName, filterResources, formatBytes, isCancelled, isEpub, presetSettings, resourcePageSize, resourceProcessing, sortResources } from './state';
import dragDropImage from '../../../images/draganddrop.png';
import '../../../styles/RenamerTab.css';
import '../../../styles/CoverEditorDialog.css';
import './epubOptimizer.css';

const newOperationId = () => `epub-optimizer-${crypto.randomUUID()}`;
const resourceKindKey = { image: 'imageResources', font: 'fontResources', text: 'textResources', audio: 'audioResources', other: 'otherResources' };
const removalOptions = [
    { kind: 'font', setting: 'removeUnusedFonts' },
    { kind: 'image', setting: 'removeUnusedImages' },
    { kind: 'audio', setting: 'removeUnusedAudio' },
];

function NumberSetting({ value, onChange, label, min, max, allowZero = false, disabled = false, describedBy }) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    return <input className="renamer-input-num" type="number" value={draft} min={allowZero ? 0 : min} max={max} step="1" disabled={disabled}
        aria-label={label} aria-describedby={describedBy} title={label} onChange={event => {
            const next = event.target.value;
            setDraft(next);
            const number = Number(next);
            if (next !== '' && Number.isInteger(number) && ((allowZero && number === 0) || (number >= min && number <= max))) onChange(number);
        }} onBlur={() => setDraft(String(value))} />;
}

function ResourcePanel({ file, text, disabled, updateResource, resetResources, enableManual }) {
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [order, setOrder] = useState('size');
    const [page, setPage] = useState(0);
    const tableRef = useRef(null);
    const resourceId = useId();
    const resources = useMemo(() => sortResources(filterResources(file.analysis.resources || [], filter, query, file.settings, file.analysis), order),
        [file.analysis, file.settings, filter, query, order]);
    const pageCount = Math.max(1, Math.ceil(resources.length / resourcePageSize));
    const currentPage = Math.min(page, pageCount - 1);
    const manual = file.settings.mode === 'manual';
    const filtered = filter !== 'all' || Boolean(query);
    const planKeys = { remove: 'removalPlanned', image: 'imagePlanned', font: 'fontPlanned', recompress: 'recompressPlanned', keep: 'contentsPreserved', structure: 'structurePlanned' };
    useEffect(() => { if (tableRef.current) tableRef.current.scrollTop = 0; }, [filter, query, order, currentPage]);
    return <section className="epub-optimizer-panel epub-optimizer-resources" aria-label={text('resources')}>
        <div className="epub-optimizer-resource-toolbar">
            <div className="epub-optimizer-resource-heading"><h3>{text('resources')}</h3>
                <span className="epub-optimizer-resource-count" role="status">{text('resourceShowing', { shown: resources.length, total: file.analysis.resources.length })}</span>
            </div>
            {manual ? <button type="button" className="epub-optimizer-action" title={text('resetResourcesHint')} onClick={resetResources}
                disabled={disabled || !Object.keys(file.settings.resources || {}).length}>{text('resourceReset')}</button>
                : <button type="button" className="epub-optimizer-action" onClick={enableManual} disabled={disabled}>{text('manual')}</button>}
        </div>
        <div className="epub-optimizer-resource-filters">
            <select className="renamer-select" value={filter} aria-label={text('resourceFilter')} onChange={event => { setFilter(event.target.value); setPage(0); }} disabled={disabled}>
                <option value="all">{text('allResources')}</option>
                <option value="convert">{text('convertingResources')}</option>
                <option value="remove">{text('removingResources')}</option>
                <option value="unused">{text('unusedResources')}</option>
                {Object.entries(resourceKindKey).map(([kind, key]) => <option key={kind} value={kind}>{text(key)}</option>)}
            </select>
            <select className="renamer-select" value={order} aria-label={text('resourceSort')} onChange={event => { setOrder(event.target.value); setPage(0); }} disabled={disabled}>
                <option value="size">{text('sortSize')}</option>
                <option value="name">{text('sortName')}</option>
                <option value="archive">{text('sortArchive')}</option>
            </select>
            <input className="renamer-input-custom" type="search" value={query} placeholder={text('resourceSearch')} aria-label={text('resourceSearch')}
                onChange={event => { setQuery(event.target.value); setPage(0); }} disabled={disabled} />
            {filtered && <button type="button" className="epub-optimizer-action" onClick={() => { setFilter('all'); setQuery(''); setPage(0); }} disabled={disabled}>{text('resetResourceFilters')}</button>}
        </div>
        <p className="cover-editor-note">{text(manual ? 'manualResourcesHint' : 'automaticResourcesHint')}</p>
        <div ref={tableRef} className="renamer-table-wrapper epub-optimizer-resource-table" tabIndex={0} aria-label={text('resources')}>
            <table className="renamer-table">
                <caption className="epub-optimizer-sr-only">{text('resourceSizeHint')}</caption>
                <thead><tr>
                    <th scope="col" className="epub-optimizer-resource-name">{text('resourceName')}</th>
                    <th scope="col" className="epub-optimizer-resource-size" title={text('resourceStoredSizeHint')}>{text('resourceStoredSize')}</th>
                    <th scope="col" className="epub-optimizer-resource-size" title={text('resourceUnpackedSizeHint')}>{text('resourceUnpackedSize')}</th>
                    <th scope="col" className="epub-optimizer-resource-options">{text(manual ? 'manual' : 'resourceColumnPlan')}</th>
                </tr></thead>
                <tbody>{resources.slice(currentPage * resourcePageSize, (currentPage + 1) * resourcePageSize).map(resource => {
                    const options = resourceSettings(resource, file.settings, file.analysis);
                    const removing = resourceRemovalSelected(resource, file.settings);
                    const removable = resource.canRemove === true && !resource.isCover && !resource.encrypted;
                    const categoryEnabled = resource.kind === 'image' ? file.settings.images : resource.kind === 'font' ? file.settings.fonts : false;
                    const coverExcluded = resource.isCover && file.settings.excludeCover;
                    const transformableKind = resource.kind === 'image' || resource.kind === 'font';
                    const reason = resource.encrypted ? text('protectedEncryptedHint') : resource.reason ? text(resource.reason) || text('conversionUnavailable')
                        : transformableKind && !resource.canOptimize ? text('conversionUnavailable')
                        : coverExcluded ? text('excludedCoverHint')
                        : transformableKind && !categoryEnabled ? text(resource.kind === 'image' ? 'imageDisabledReason' : 'fontDisabledReason')
                        : manual && file.settings.resources?.[resource.name]?.enabled === false ? text('resourceExcludedHint') : '';
                    const processing = resourceProcessing(resource, file.settings, file.analysis);
                    const usageHint = resource.isCover ? 'protectedCoverHint' : resource.encrypted ? 'protectedEncryptedHint'
                        : resource.name.startsWith('META-INF/') || resource.name === 'mimetype' ? 'protectedStructureHint'
                        : resource.usage === 'protected' ? 'protectedKindHint' : resource.usage === 'referenced' ? 'referencedHint'
                        : resource.usage === 'unused' ? 'unusedHint' : 'unknownUsageHint';
                    const conversionLabel = text(resource.kind === 'image' ? 'imageConversion' : 'fontConversion');
                    const metadata = [text(resourceKindKey[resource.kind] || 'otherResources'),
                        resource.width && resource.height ? `${resource.width} × ${resource.height} px` : '',
                        resource.isCover ? text('cover') : ''].filter(Boolean).join(' · ');
                    const showImageInputs = manual && !removing && resource.kind === 'image' && resource.canOptimize;
                    return <tr key={resource.name} data-resource={resource.name} className={removing ? 'epub-optimizer-removing' : undefined}>
                        <td><div className="epub-optimizer-resource-label">
                            <div><strong title={resource.name}>{fileName(resource.name) || resource.name}</strong>
                                <small className="epub-optimizer-resource-metadata">
                                    <span className="epub-optimizer-resource-details" title={metadata}>{metadata}</span>
                                    <span className="epub-optimizer-resource-usage" title={text(usageHint)}>{text(`usage_${resource.usage || 'unknown'}`)}</span>
                                </small>
                            </div>
                        </div></td>
                        <td className="epub-optimizer-resource-bytes">{formatBytes(resource.compressedSize)}</td>
                        <td className="epub-optimizer-resource-bytes">{formatBytes(resource.originalSize)}</td>
                        <td><div className="epub-optimizer-resource-actions">
                            <div className="epub-optimizer-resource-primary">
                                {(!manual || (processing !== 'image' && processing !== 'font')) && <span className={`epub-optimizer-resource-plan is-${processing}`}
                                    title={processing === 'structure' ? text('structureHint') : text(planKeys[processing])}>{text(planKeys[processing])}</span>}
                                {manual && transformableKind && <label className="renamer-checkbox-label epub-optimizer-convert-resource" title={reason || text('resourceConversionHint')}>
                                    <input type="checkbox" checked={options.enabled} aria-label={text('resourceConversionLabel', { name: resource.name, kind: conversionLabel })}
                                        disabled={disabled || !resource.canOptimize || !categoryEnabled || coverExcluded || removing}
                                        onChange={event => updateResource(resource.name, { enabled: event.target.checked })} />{conversionLabel}
                                </label>}
                                {manual && removable && <label className="renamer-checkbox-label epub-optimizer-remove-resource">
                                    <input type="checkbox" checked={removing} aria-label={text('removeResource', { name: resource.name })} disabled={disabled}
                                        onChange={event => updateResource(resource.name, { remove: event.target.checked })} />{text('removeUnusedResource')}
                                </label>}
                                {manual && file.settings.resources?.[resource.name] && <button type="button" className="epub-optimizer-action epub-optimizer-resource-reset" title={text('inheritHint')} aria-label={`${resource.name} · ${text('inherit')}`}
                                    onClick={() => updateResource(resource.name, null)} disabled={disabled}><span aria-hidden="true">↺</span></button>}
                            </div>
                            {showImageInputs && <div className="epub-optimizer-resource-inputs">
                                {resource.mediaType === 'image/jpeg' && <label>{text('jpegQuality')}
                                    <NumberSetting value={options.quality} min={40} max={100} label={`${resource.name} · ${text('jpegQuality')}`}
                                        onChange={quality => updateResource(resource.name, { quality })} disabled={disabled || !options.enabled} />
                                </label>}
                                <label>{text('maxDimension')}
                                    <NumberSetting value={options.maxDimension} min={256} max={8192} allowZero label={`${resource.name} · ${text('maxDimension')}`}
                                        describedBy={`${resourceId}-dimension-hint`} onChange={maxDimension => updateResource(resource.name, { maxDimension })} disabled={disabled || !options.enabled} />
                                    <span>{text('pixels')}</span>
                                </label>
                            </div>}
                            {!removing && reason && <small className={showImageInputs ? 'epub-optimizer-sr-only' : 'epub-optimizer-resource-reason'} title={reason}>{reason}</small>}
                        </div></td>
                    </tr>;
                })}</tbody>
            </table>
            {!resources.length && <p className="cover-editor-note epub-optimizer-no-resources" role="status">{text('resourceNoResults')}</p>}
        </div>
        <p className="cover-editor-note epub-optimizer-processing-note">{text('resourceProcessingHint')}</p>
        {manual && <p id={`${resourceId}-dimension-hint`} className="cover-editor-note">{text('dimensionHint')}</p>}
        <div className="epub-optimizer-pagination">
            <span className="epub-optimizer-resource-range">{resources.length ? text('resourceRange', { start: currentPage * resourcePageSize + 1, end: Math.min((currentPage + 1) * resourcePageSize, resources.length), total: resources.length }) : text('resourceCount', { count: 0 })}</span>
            {pageCount > 1 && <>
                <span>{text('resourcePage', { page: currentPage + 1, pages: pageCount })}</span>
                <button type="button" className="epub-optimizer-action" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{text('previous')}</button>
                <button type="button" className="epub-optimizer-action" disabled={disabled || currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>{text('next')}</button>
            </>}
        </div>
    </section>;
}

function SelectedWorkspace({ file, text, disabled, updateSettings, updateResource, copySettings, checkedCount, inspectAgain }) {
    const modeId = useId();
    const estimate = useMemo(() => file.analysis ? estimateOptimization(file.analysis, file.settings) : null, [file.analysis, file.settings]);
    if (file.error) return <section className="cover-editor-sources epub-optimizer-inspection-error" aria-label={text('currentFile')}>
        <h3>{file.name}</h3><p role="alert">{file.error}</p>
        <button type="button" className="epub-optimizer-action" onClick={inspectAgain} disabled={disabled}>{text('recheck')}</button>
    </section>;
    if (!file.analysis) return null;
    const manual = file.settings.mode === 'manual';
    const groups = Object.entries(resourceKindKey).map(([kind, key]) => ({ kind, label: text(key),
        size: file.analysis.resources.filter(resource => resource.kind === kind).reduce((sum, resource) => sum + resource.compressedSize, 0),
    })).filter(group => group.size > 0);
    return <section className="epub-optimizer-work-area" aria-label={text('currentFile')}>
        <div className="epub-optimizer-panel epub-optimizer-summary">
            <div className="epub-optimizer-work-heading">
                <div><h3 title={file.path}>{file.name}</h3><span>EPUB {file.analysis.version}</span></div>
                <button type="button" className="epub-optimizer-action" disabled={disabled} onClick={inspectAgain}>{text('recheck')}</button>
                <button type="button" className="epub-optimizer-action" disabled={disabled || !checkedCount} title={text('copyHint')} onClick={copySettings}>{text('copySettings')}</button>
            </div>
            <div className="epub-optimizer-estimates" aria-live="polite" aria-atomic="true">
                <div><span>{text('originalSize')}</span><strong>{formatBytes(estimate.originalSize)}</strong></div>
                <div><span>{text('estimatedSize')}</span><strong>{formatBytes(estimate.estimatedSize)}</strong></div>
                <div className="epub-optimizer-saving"><span>{text('estimatedSaving')}</span><strong>{formatBytes(estimate.savedBytes)}</strong>
                    <small>{text('estimateRange', { min: formatBytes(estimate.minSavedBytes), max: formatBytes(estimate.maxSavedBytes) })}</small></div>
            </div>
            <div className="epub-optimizer-composition" aria-label={text('originalSize')}>
                <div className="epub-optimizer-composition-bar" aria-hidden="true">{groups.map(group => <span key={group.kind} className={`is-${group.kind}`}
                    style={{ flexGrow: group.size }} title={`${group.label} ${formatBytes(group.size)}`} />)}</div>
                <div className="epub-optimizer-composition-legend">{groups.map(group => <span key={group.kind}><i className={`is-${group.kind}`} />{group.label} {formatBytes(group.size)}</span>)}</div>
            </div>
            <p className="cover-editor-note epub-optimizer-estimate-note">{text('estimateHint')}</p>
            {file.analysis.fixedLayout && <p className="epub-optimizer-notice">{text('fixedLayout')}</p>}
            {file.analysis.warnings?.length > 0 && <details className="epub-optimizer-warnings"><summary>{text('warnings')} ({file.analysis.warnings.length})</summary>
                <ul>{file.analysis.warnings.map((warning, index) => <li key={index}>{typeof warning === 'string' ? text(warning) || text('unavailable') : text(warning.code) || warning.message || text('unavailable')}</li>)}</ul>
                {file.analysis.missingResources?.length > 0 && <div className="epub-optimizer-missing-resources">
                    <strong>{text('missingResources', { count: file.analysis.missingResources.length })}</strong>
                    <pre>{file.analysis.missingResources.map(resource => resource.name).join('\n')}</pre>
                </div>}
            </details>}
        </div>
        <div className="epub-optimizer-settings-layout">
            <div className="epub-optimizer-panel epub-optimizer-general-settings">
                <fieldset className="renamer-options-bar epub-optimizer-mode-settings" disabled={disabled}>
                    <legend className="epub-optimizer-sr-only">{text('optimizationMode')}</legend>
                    <span className="renamer-label" aria-hidden="true">{text('optimizationMode')}</span>
                    <div className="cover-editor-modes">
                        <label><input type="radio" name={modeId} value="auto" checked={!manual} aria-describedby={`${modeId}-hint`}
                            onChange={() => updateSettings({ mode: 'auto' })} />{text('automatic')}</label>
                        <label><input type="radio" name={modeId} value="manual" checked={manual} aria-describedby={`${modeId}-hint`}
                            onChange={() => updateSettings({ mode: 'manual' })} />{text('manual')}</label>
                    </div>
                    <p id={`${modeId}-hint`} className="cover-editor-note">{text(manual ? 'manualHint' : 'automaticHint')}</p>
                </fieldset>
                <div className="epub-optimizer-presets" role="group" aria-label={text('presets')}>
                    <span className="renamer-label">{text('presets')}</span>
                    {['balanced', 'compact', 'lossless'].map(preset => <button type="button" className="epub-optimizer-action" key={preset} disabled={disabled}
                        title={text(`${preset}Hint`)}
                        onClick={() => updateSettings({ ...presetSettings(preset), mode: file.settings.mode })}>{text(preset)}</button>)}
                    <small>{text('presetHint')}</small>
                </div>
                <fieldset className="epub-optimizer-options" disabled={disabled}>
                    <legend className="epub-optimizer-sr-only">{text('automatic')}</legend>
                    <div className="epub-optimizer-option epub-optimizer-image-option">
                        <label className="renamer-checkbox-label"><input type="checkbox" checked={file.settings.images} aria-label={text('images')}
                            onChange={event => updateSettings({ images: event.target.checked })} />{text('images')}</label>
                        <p className="cover-editor-note">{text(file.settings.images ? 'imageHint' : 'imagesOffHint')}</p>
                        <fieldset className="epub-optimizer-image-controls" disabled={!file.settings.images}>
                            <legend className="epub-optimizer-sr-only">{text('images')}</legend>
                            <label>{text('jpegQuality')}<input type="range" min="40" max="100" step="1" value={file.settings.jpegQuality} disabled={!file.settings.images}
                                aria-describedby={`${modeId}-quality-hint`}
                                onChange={event => updateSettings({ jpegQuality: Number(event.target.value) })} /><output>{file.settings.jpegQuality}</output></label>
                            <p id={`${modeId}-quality-hint`} className="cover-editor-note">{text('qualityHint')}</p>
                            <label>{text('maxDimension')}<span className="epub-optimizer-dimension-input">
                                <NumberSetting value={!manual && file.analysis.fixedLayout ? 0 : file.settings.maxDimension} min={256} max={8192} allowZero label={text('maxDimension')}
                                    describedBy={`${modeId}-dimension-hint`} disabled={!file.settings.images || (!manual && file.analysis.fixedLayout)} onChange={maxDimension => updateSettings({ maxDimension })} />
                                <span>{text('pixels')}</span>
                            </span></label>
                            <p id={`${modeId}-dimension-hint`} className="cover-editor-note">{text(!manual && file.analysis.fixedLayout ? 'FIXED_LAYOUT' : 'dimensionHint')}</p>
                            <label className="renamer-checkbox-label"><input type="checkbox" checked={file.settings.excludeCover} disabled={!file.settings.images}
                                title={text('excludeCoverHint')} onChange={event => updateSettings({ excludeCover: event.target.checked })} />{text('excludeCover')}</label>
                        </fieldset>
                    </div>
                    <div className="epub-optimizer-option epub-optimizer-font-option">
                        <label className="renamer-checkbox-label"><input type="checkbox" checked={file.settings.fonts} aria-label={text('fonts')}
                            onChange={event => updateSettings({ fonts: event.target.checked })} />{text('fonts')}</label>
                        <p className="cover-editor-note">{text(file.settings.fonts ? 'fontHint' : 'fontOffHint')}</p>
                    </div>
                    <div className="epub-optimizer-option epub-optimizer-zip-option">
                        <label className="renamer-checkbox-label"><input type="checkbox" checked={file.settings.recompress} aria-label={text('recompress')}
                            onChange={event => updateSettings({ recompress: event.target.checked })} />{text('recompress')}</label>
                        <p className="cover-editor-note">{text(file.settings.recompress ? 'zipHint' : 'zipOffHint')}</p>
                    </div>
                    <div className="epub-optimizer-removal-options" role="group" aria-label={text('removeUnused')}>
                        <div className="epub-optimizer-removal-categories">{removalOptions.map(({ kind, setting }) => {
                            const candidates = file.analysis.resources.filter(resource => resource.kind === kind && resource.canRemove === true && !resource.isCover && !resource.encrypted);
                            const size = candidates.reduce((sum, resource) => sum + (Number(resource.compressedSize) || 0), 0);
                            const selected = candidates.filter(resource => resourceRemovalSelected(resource, file.settings));
                            const selectedSize = selected.reduce((sum, resource) => sum + (Number(resource.compressedSize) || 0), 0);
                            return <div key={kind} className="epub-optimizer-option" data-kind={kind}>
                                <label className="renamer-checkbox-label"><input type="checkbox" checked={file.settings[setting]}
                                    disabled={!candidates.length} aria-label={text(setting)} onChange={event => updateSettings({ [setting]: event.target.checked })} />{text(setting)}</label>
                                <div className="epub-optimizer-removal-summary">
                                    <p className="cover-editor-note">{candidates.length ? text('removalCandidates', { count: candidates.length, size: formatBytes(size) }) : text('noRemovalCandidates')}</p>
                                    {candidates.length > 0 && <p className={`cover-editor-note epub-optimizer-removal-plan${selected.length ? ' has-selection' : ''}`}>{text('removalPlannedSummary', { count: selected.length, size: formatBytes(selectedSize) })}</p>}
                                </div>
                            </div>;
                        })}</div>
                        <p className="cover-editor-note">{text('removeUnusedHint')}</p>
                        {manual && <p className="cover-editor-note">{text('manualRemovalHint')}</p>}
                    </div>
                </fieldset>
            </div>
            <ResourcePanel key={file.path} file={file} text={text} disabled={disabled} updateResource={updateResource} resetResources={() => updateSettings({ resources: {} })}
                enableManual={() => updateSettings({ mode: 'manual' })} />
        </div>
    </section>;
}

export default function EpubOptimizerTool({ config, t, showToast, onBack, openRequest, registerBeforeLeave }) {
    const language = config?.language || config?.lang;
    const text = useCallback((key, values) => optimizerText(key, values, language), [language]);
    const errorText = useCallback(value => optimizerError(value, language), [language]);
    const titleId = useId();
    const [files, setFiles] = useState([]);
    const [selectedPath, setSelectedPath] = useState('');
    const [backup, setBackup] = useState(true);
    const [task, setTask] = useState(null);
    const [resultLog, setResultLog] = useState(null);
    const [resultOpen, setResultOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [dropMode, setDropMode] = useState('append');
    const filesRef = useRef([]);
    const taskRef = useRef(null);
    const resultOpenRef = useRef(false);
    const mountedRef = useRef(true);
    const cancelRef = useRef(false);
    const activeOperationRef = useRef('');
    const lastOpenRequestRef = useRef(null);
    const pendingRequestsRef = useRef([]);
    const tableRef = useRef(null);
    const rowsRef = useRef(new Map());
    const busy = Boolean(task);
    const locked = busy || resultOpen;
    const selectedFile = files.find(file => file.path === selectedPath) || files[0];
    const estimates = useMemo(() => new Map(files.map(file => [file.path, file.analysis ? estimateOptimization(file.analysis, file.settings) : null])), [files]);
    const totalEstimate = useMemo(() => checkedEstimate(files), [files]);
    const checkedCount = files.filter(file => file.checked).length;
    const allChecked = files.length > 0 && checkedCount === files.length;

    const commitFiles = useCallback(update => {
        if (!mountedRef.current) return;
        const next = typeof update === 'function' ? update(filesRef.current) : update;
        filesRef.current = next;
        setFiles(next);
    }, []);

    const updateTask = useCallback(value => {
        taskRef.current = value;
        if (mountedRef.current) setTask(value);
    }, []);

    const showResults = useCallback(open => {
        resultOpenRef.current = open;
        setResultOpen(open);
    }, []);

    const requestCancel = useCallback(() => {
        if (taskRef.current?.kind !== 'executing' || cancelRef.current) return;
        cancelRef.current = true;
        updateTask({ ...taskRef.current, cancelling: true });
        if (activeOperationRef.current) void window.electronAPI.epubOptimizer({ action: 'cancel', operationId: activeOperationRef.current }).catch(() => {});
    }, [updateTask]);

    useEffect(() => {
        mountedRef.current = true;
        const beforeUnload = event => {
            if (!taskRef.current) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => {
            mountedRef.current = false;
            cancelRef.current = true;
            if (activeOperationRef.current) void window.electronAPI.epubOptimizer({ action: 'cancel', operationId: activeOperationRef.current }).catch(() => {});
            window.removeEventListener('beforeunload', beforeUnload);
            emitToolbarState('tools', { ...createToolbarState(), fileActionsEnabled: false });
            emitStatusState('tools', {});
        };
    }, []);

    useEffect(() => registerBeforeLeave?.(() => !taskRef.current && !resultOpenRef.current), [registerBeforeLeave]);

    useEffect(() => {
        emitToolbarState('tools', { ...createToolbarState(files), fileActionsEnabled: true, fileActionsBusy: locked });
    }, [files, locked]);

    useEffect(() => {
        if (!task) {
            emitStatusState('tools', {});
            return;
        }
        const executing = task.kind === 'executing';
        emitStatusState('tools', {
            phase: task.cancelling ? 'cancelling' : executing ? 'executing' : 'analyzing',
            message: text(task.cancelling ? 'cancelling' : executing ? 'executing' : task.total ? 'inspecting' : 'collecting', { completed: task.completed || 0, total: task.total || 0 }),
            progress: task.total ? ((task.completed || 0) + (task.itemProgress || 0)) / task.total * 100 : 0,
            currentItem: task.currentItem || task.filePath || '',
            currentItemName: task.filePath ? fileName(task.filePath) : '',
            canCancel: executing,
        });
    }, [task, text]);

    useEffect(() => window.electronAPI?.onEpubOptimizerProgress?.(progress => {
        if (!mountedRef.current || !taskRef.current || progress.operationId !== activeOperationRef.current) return;
        updateTask({ ...taskRef.current, currentItem: progress.currentItem,
            itemProgress: Math.max(taskRef.current.itemProgress || 0, Number.isFinite(progress.percent) ? Math.max(0, Math.min(1, progress.percent / 100))
                : progress.total ? Math.max(0, Math.min(1, progress.completed / progress.total)) : 0) });
    }), [updateTask]);

    const runAddition = useCallback(async (providePaths, mode = 'append', recheck = false) => {
        if (taskRef.current || resultOpenRef.current) return;
        updateTask({ kind: 'adding', completed: 0, total: 0 });
        setDragging(false);
        try {
            const inputs = normalizeDroppedPaths(await providePaths() || []);
            if (!mountedRef.current || !inputs.length) return;
            const paths = [];
            let skipped = 0;
            for (const path of inputs) {
                const stat = await window.electronAPI.stat(path);
                if (!mountedRef.current) return;
                if (stat?.isDirectory) {
                    const collected = await collectCoverEditorFolderPaths(path, directory => window.electronAPI.readDir(directory), () => !mountedRef.current);
                    paths.push(...collected.filter(isEpub));
                } else if (stat?.isFile && isEpub(path)) paths.push(path);
                else skipped += 1;
            }
            if (!mountedRef.current) return;
            if (skipped) showToast?.(text('unsupported', { count: skipped }));
            const supported = normalizeDroppedPaths(paths);
            if (!supported.length) {
                if (!skipped) showToast?.(text('noEpub'));
                return;
            }
            const previous = new Map(filesRef.current.map(file => [file.path, file]));
            const combined = normalizeDroppedPaths([...(mode === 'replace' ? [] : filesRef.current.map(file => file.path)), ...supported]);
            const inspectPaths = supported.filter(path => recheck || !previous.get(path)?.analysis);
            commitFiles(combined.map(path => {
                const file = previous.get(path) || createFile(path);
                return inspectPaths.includes(path) ? { ...file, analysis: null, error: null, outcome: null, settingsChanged: false } : file;
            }));
            setSelectedPath(current => combined.includes(current) ? current : combined[0] || '');
            for (let index = 0; index < inspectPaths.length; index += 1) {
                if (!mountedRef.current) return;
                const filePath = inspectPaths[index];
                const operationId = newOperationId();
                activeOperationRef.current = operationId;
                updateTask({ kind: 'adding', completed: index, total: inspectPaths.length, filePath });
                let inspection;
                try {
                    inspection = await window.electronAPI.epubOptimizer({ action: 'inspect', filePath, operationId });
                } catch (error) {
                    inspection = { error: error.message };
                }
                if (!mountedRef.current) return;
                commitFiles(current => current.map(file => file.path === filePath ? {
                    ...file, analysis: inspection?.error || !inspection?.resources ? null : inspection,
                    error: inspection?.error || !inspection?.resources ? errorText(inspection) : null,
                } : file));
            }
        } catch (error) {
            if (mountedRef.current) showToast?.(errorText(error));
        } finally {
            activeOperationRef.current = '';
            updateTask(null);
        }
    }, [commitFiles, errorText, showToast, text, updateTask]);

    useEffect(() => {
        if (openRequest && openRequest !== lastOpenRequestRef.current) {
            lastOpenRequestRef.current = openRequest;
            pendingRequestsRef.current.push(openRequest);
        }
        if (taskRef.current || resultOpenRef.current || !pendingRequestsRef.current.length) return;
        const request = pendingRequestsRef.current.shift();
        void runAddition(async () => request.paths || [], request.mode);
    }, [openRequest, task, resultOpen, runAddition]);

    const addFiles = useCallback(() => runAddition(() => window.electronAPI.selectFiles(text('addFiles'), [{ name: 'EPUB', extensions: ['epub'] }])), [runAddition, text]);
    const addFolder = useCallback(() => runAddition(async () => {
        const path = await window.electronAPI.selectFolder(t('add_folder'));
        return path ? [path] : [];
    }), [runAddition, t]);

    const changeList = useCallback(update => {
        if (!taskRef.current && !resultOpenRef.current) commitFiles(update);
    }, [commitFiles]);
    const toggleAll = useCallback(() => changeList(current => {
        const checked = !current.every(file => file.checked);
        return current.map(file => ({ ...file, checked }));
    }), [changeList]);

    useEffect(() => {
        const handleAction = event => {
            if (event.detail?.activeTab !== 'tools') return;
            switch (event.detail.action) {
                case 'add-folder': void addFolder(); break;
                case 'add-file': void addFiles(); break;
                case 'remove-selected': changeList(current => current.filter(file => !file.checked)); break;
                case 'clear-all': changeList([]); break;
                case 'toggle-all': toggleAll(); break;
                case 'cancel-current': requestCancel(); break;
                default: break;
            }
        };
        window.addEventListener('bookmanager:action', handleAction);
        return () => window.removeEventListener('bookmanager:action', handleAction);
    }, [addFiles, addFolder, changeList, toggleAll, requestCancel]);

    const updateSettings = updates => {
        if (!selectedFile || taskRef.current || resultOpenRef.current) return;
        commitFiles(current => current.map(file => file.path === selectedFile.path ? { ...file,
            settings: normalizeSettings({ ...file.settings, ...updates }), settingsChanged: Boolean(file.outcome),
        } : file));
    };
    const updateResource = (name, updates) => {
        const resources = { ...selectedFile.settings.resources };
        if (updates === null) delete resources[name];
        else Object.defineProperty(resources, name, { value: { ...resources[name], ...updates }, enumerable: true, configurable: true });
        updateSettings({ resources });
    };

    const execute = async () => {
        if (taskRef.current || resultOpenRef.current) return;
        const checked = filesRef.current.filter(file => file.checked);
        if (!checked.some(file => file.analysis && !file.error)) return;
        cancelRef.current = false;
        updateTask({ kind: 'executing', completed: 0, total: checked.length });
        setDragging(false);
        const outcomes = new Map();
        const inspections = new Map();
        try {
            for (let index = 0; index < checked.length; index += 1) {
                const file = checked[index];
                if (!mountedRef.current || cancelRef.current) {
                    outcomes.set(file.path, { cancelled: true });
                    continue;
                }
                if (file.error || !file.analysis) {
                    outcomes.set(file.path, { error: file.error || text('pending') });
                    continue;
                }
                const operationId = newOperationId();
                activeOperationRef.current = operationId;
                updateTask({ kind: 'executing', completed: index, total: checked.length, filePath: file.path });
                let outcome;
                try {
                    outcome = await window.electronAPI.epubOptimizer({ action: 'optimize', filePath: file.path,
                        settings: file.settings, overwrite: true, backup, expectedFingerprint: file.analysis.fingerprint, operationId });
                } catch (error) {
                    outcome = { error: error.message };
                }
                outcomes.set(file.path, outcome || { error: text('error') });
                if (outcome?.status === 'saved') {
                    const inspectionId = newOperationId();
                    activeOperationRef.current = inspectionId;
                    let inspection;
                    try {
                        inspection = await window.electronAPI.epubOptimizer({ action: 'inspect', filePath: file.path, operationId: inspectionId });
                    } catch (error) {
                        inspection = { error: error.message };
                    }
                    const valid = inspection?.resources && !inspection.error;
                    inspections.set(file.path, { analysis: valid ? inspection : null, error: valid ? null : text('savedRecheckFailed') });
                }
                activeOperationRef.current = '';
                if (isCancelled(outcome)) cancelRef.current = true;
            }
            if (!mountedRef.current) return;
            commitFiles(current => current.map(file => outcomes.has(file.path) ? { ...file, ...inspections.get(file.path), outcome: outcomes.get(file.path), settingsChanged: false } : file));
            const log = createResultLog(checked, outcomes, text, errorText);
            setResultLog(log);
            showResults(true);
            if (log.outputFiles.length) window.dispatchEvent(new CustomEvent('bookmanager:metadata-saved', { detail: { paths: log.outputFiles } }));
            if (shouldPlayCompletionSound(config || {}, log.stats.success.length, log.cancelled)) {
                void Promise.resolve().then(() => window.electronAPI?.playSound?.(config?.completion_sound || 'Default.wav')).catch(() => {});
            }
        } finally {
            activeOperationRef.current = '';
            updateTask(null);
        }
    };

    const dragOver = event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const blocked = taskRef.current || resultOpenRef.current;
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        setDropMode(resolveFileDropMode(event.clientY, event.currentTarget.getBoundingClientRect()));
        setDragging(!blocked);
    };
    const drop = event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        const paths = droppedPathsFromDataTransfer(event.dataTransfer);
        const mode = resolveFileDropMode(event.clientY, event.currentTarget.getBoundingClientRect());
        void runAddition(async () => paths, mode);
    };

    const handleTableKey = event => {
        if (locked || event.target.closest('input, button, select, textarea') || !files.length) return;
        const index = Math.max(0, files.findIndex(file => file.path === selectedFile?.path));
        let next;
        if (event.key === 'ArrowDown') next = Math.min(files.length - 1, index + 1);
        if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = files.length - 1;
        if (next !== undefined) {
            event.preventDefault();
            setSelectedPath(files[next].path);
            rowsRef.current.get(files[next].path)?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === ' ') {
            event.preventDefault();
            changeList(current => current.map(file => file.path === selectedFile.path ? { ...file, checked: !file.checked } : file));
        }
    };

    return <section className="cover-editor-tool-container epub-optimizer-container" onDragEnter={dragOver} onDragOver={dragOver} onDrop={drop}
        onDragEnd={() => setDragging(false)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}>
        <div className="cover-editor-tool">
            <section className="cover-editor-dialog cover-editor-embedded epub-optimizer-tool" role="region" aria-labelledby={titleId}
                aria-busy={busy} aria-hidden={busy || resultOpen ? 'true' : undefined} inert={busy || resultOpen ? '' : undefined}>
                <header className="cover-editor-header"><div className="cover-editor-tool-heading">
                    <button type="button" className="cover-editor-tool-back" disabled={locked} onClick={() => { if (!taskRef.current && !resultOpenRef.current) onBack?.(); }}>
                        <FaIcon name="angleLeft" aria-hidden="true" />{t('tools.back')}
                    </button><h2 id={titleId}>{text('title')}</h2>
                </div></header>
                <div className="cover-editor-body epub-optimizer-body">
                    {!files.length ? <div className="renamer-empty-state epub-optimizer-empty">
                        <img src={dragDropImage} alt="" className="renamer-empty-image" />
                        <p className="renamer-empty-text">{t('drag_drop')}</p>
                    </div> : <section className="cover-editor-tool-files epub-optimizer-files" aria-label={text('files')}>
                        <div className="cover-editor-options-toolbar">
                            <button type="button" className={`renamer-btn-toggle cover-editor-toggle-all${allChecked ? ' active' : ''}`}
                                aria-pressed={allChecked} disabled={locked || !files.length} onClick={toggleAll}><FaIcon name="checkSquare" aria-hidden="true" />{t('toggle_all')}</button>
                            <label className={`renamer-btn-toggle cover-editor-option-toggle epub-optimizer-backup${backup ? ' active' : ''}`} title={text('backupHint')}>
                                <input type="checkbox" checked={backup} disabled={locked} onChange={event => setBackup(event.target.checked)} />
                                <FaIcon name="checkSquare" aria-hidden="true" />{text('backup')}
                            </label>
                        </div>
                        <div ref={tableRef} className="renamer-table-wrapper cover-editor-file-table" tabIndex={0} aria-label={text('files')} onKeyDown={handleTableKey}>
                            <table className="renamer-table"><thead><tr>
                                <th scope="col">{t('col_name')}</th><th scope="col" style={{ width: '14%' }}>{text('originalSize')}</th>
                                <th scope="col" style={{ width: '15%' }}>{text('estimatedSize')}</th><th scope="col" style={{ width: '15%' }}>{text('estimatedSaving')}</th>
                                <th scope="col" style={{ width: '15%' }}>{t('tf_col_status')}</th><th scope="col" style={{ width: 50 }}>{t('cover_editor_tool_remove')}</th>
                            </tr></thead><tbody>{files.map(file => {
                                const estimate = estimates.get(file.path);
                                const status = file.error ? 'failed' : file.settingsChanged ? 'changedSettings' : isCancelled(file.outcome) ? 'cancelled'
                                    : file.outcome?.error ? 'failed' : file.outcome?.status || (file.analysis ? 'ready' : 'pending');
                                return <tr key={file.path} className={selectedFile?.path === file.path ? 'selected' : ''} aria-selected={selectedFile?.path === file.path}
                                    ref={node => { if (node) rowsRef.current.set(file.path, node); else rowsRef.current.delete(file.path); }}
                                    onClick={event => {
                                        if (locked || event.target.closest('input, button, select, textarea')) return;
                                        setSelectedPath(file.path);
                                        tableRef.current?.focus({ preventScroll: true });
                                    }}>
                                    <td><div className="renamer-file-cell"><input type="checkbox" checked={file.checked} disabled={locked} aria-label={file.name}
                                        onChange={() => changeList(current => current.map(entry => entry.path === file.path ? { ...entry, checked: !entry.checked } : entry))} />
                                        <span className="renamer-file-name" title={file.path}>{file.name}</span></div></td>
                                    <td className="renamer-cell-center">{estimate ? formatBytes(estimate.originalSize) : '—'}</td>
                                    <td className="renamer-cell-center">{estimate ? formatBytes(estimate.estimatedSize) : '—'}</td>
                                    <td className="renamer-cell-center">{estimate ? formatBytes(estimate.savedBytes) : '—'}</td>
                                    <td className="renamer-cell-center" title={file.error || (file.outcome?.error ? errorText(file.outcome) : file.outcome?.outputPath) || text(status)}>{text(status)}</td>
                                    <td className="renamer-cell-center"><button type="button" className="renamer-archive-delete-btn" disabled={locked}
                                        aria-label={t('cover_editor_tool_remove_file', [file.name])} title={t('cover_editor_tool_remove_hint')}
                                        onClick={() => changeList(current => current.filter(entry => entry.path !== file.path))}><FaIcon name="trash" size={11} aria-hidden="true" /></button></td>
                                </tr>;
                            })}</tbody></table>
                        </div>
                        <div className="renamer-table-count">{text('count', { total: files.length, checked: checkedCount })}</div>
                    </section>}
                    {selectedFile && <SelectedWorkspace file={selectedFile} text={text} disabled={locked} updateSettings={updateSettings} updateResource={updateResource}
                        checkedCount={checkedCount} inspectAgain={() => runAddition(async () => [selectedFile.path], 'append', true)}
                        copySettings={() => { changeList(current => copyGeneralSettings(current, selectedFile.path)); showToast?.(text('settingsCopied')); }} />}
                </div>
                {files.length > 0 && <footer className="cover-editor-footer">
                    <div className="cover-editor-footer-status epub-optimizer-footer-status">
                        {totalEstimate.count > 0 ? <span aria-live="polite">{text('checkedEstimate', { count: totalEstimate.count })}: <strong>{formatBytes(totalEstimate.originalSize)} → {formatBytes(totalEstimate.estimatedSize)}</strong>
                            <span>({text('estimatedSaving')} {formatBytes(totalEstimate.savedBytes)})</span></span> : <span>{text('noChecked')}</span>}
                        <small>{text(backup ? 'savedBackupHint' : 'savedHint')}</small>
                    </div>
                    {resultLog && <button type="button" className="cover-editor-result-link" disabled={locked} onClick={() => showResults(true)}>{text('results')}</button>}
                    <button type="button" className="cover-editor-save" disabled={locked || !totalEstimate.count} onClick={execute}>{text('execute')}{totalEstimate.count > 0 ? ` (${totalEstimate.count})` : ''}</button>
                </footer>}
            </section>
            {resultOpen && resultLog && <div className="cover-editor-result-modal" onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
                <ResultLogDialog result={resultLog} t={t} onClose={() => showResults(false)} />
            </div>}
        </div>
        {dragging && <FileDropHoverOverlay dropMode={dropMode} t={t} />}
    </section>;
}
