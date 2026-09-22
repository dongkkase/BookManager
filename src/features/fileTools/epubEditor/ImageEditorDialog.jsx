import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { imageEditText as t } from './imageEditingLabels';
import { createImageEditRenderer, createImageEditSettings, clampImageRect, fitImageCrop, transformImageEditSettings, getTransformedImageDimensions, IMAGE_EDIT_LIMITS, IMAGE_FILTER_PRESETS, IMAGE_BORDER_PRESETS, IMAGE_CROP_PRESETS } from './imageEditing';
import './imageEditing.css';

function NumberInput({ label, value, min = 1, max = 8192, step = 1, onChange }) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => { setDraft(String(value)); }, [value]);
    const commit = () => {
        const number = Number(draft);
        const next = draft.trim() && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : value;
        setDraft(String(next));
        onChange(next);
    };
    return <label className="ee-field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); }
    }} /></label>;
}

function Slider({ label, value, min = -100, max = 100, onChange }) {
    return <label className="ee-image-edit-slider"><span>{label}<output>{value}</output></span><input type="range" aria-label={label} min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

const fullRect = { x: 0, y: 0, width: 1, height: 1 };
const rectStyle = rect => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

export default function ImageEditorDialog({ src, loadSource, onApply, onClose }) {
    const renderer = useRef(null);
    const drag = useRef(null);
    const picture = useRef(null);
    const stage = useRef(null);
    const previewUrls = useRef(new Set());
    const sequence = useRef(0);
    const [source, setSource] = useState(null);
    const [settings, setSettings] = useState(null);
    const [preview, setPreview] = useState(null);
    const [tab, setTab] = useState('crop');
    const [ratioId, setRatioId] = useState('free');
    const [lockRatio, setLockRatio] = useState(true);
    const [effectTab, setEffectTab] = useState('filters');
    const [mask, setMask] = useState({ mode: 'mosaic', shape: 'rectangle', strength: 50 });
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [rendering, setRendering] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [saveError, setSaveError] = useState(null);
    const [available, setAvailable] = useState({ width: 600, height: 450 });
    useLayoutEffect(() => {
        // Keep the displayed image alive until React commits its decoded replacement.
        for (const url of previewUrls.current) {
            if (url === preview?.url) continue;
            URL.revokeObjectURL(url);
            previewUrls.current.delete(url);
        }
    }, [preview]);
    useLayoutEffect(() => {
        if (!stage.current) return;
        const measure = () => setAvailable({ width: Math.max(1, stage.current.clientWidth - 32), height: Math.max(1, stage.current.clientHeight - 32) });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(stage.current);
        return () => observer.disconnect();
    }, [source]);
    useEffect(() => {
        let disposed = false;
        (async () => {
            try {
                const instance = await createImageEditRenderer(await loadSource());
                if (disposed) { instance.destroy(); return; }
                renderer.current = instance;
                setSource({ width: instance.width, height: instance.height });
                setSettings(createImageEditSettings(instance.width, instance.height));
            } catch (failure) { if (!disposed) setError(l(failure.code || 'IMAGE_EDIT_RENDER')); }
        })();
        return () => {
            disposed = true;
            sequence.current += 1;
            renderer.current?.destroy();
            for (const url of previewUrls.current) URL.revokeObjectURL(url);
            previewUrls.current.clear();
        };
    }, [src]);
    useEffect(() => {
        if (!settings || !renderer.current) return;
        const current = ++sequence.current;
        const timeout = setTimeout(async () => {
            setRendering(true);
            try {
                const result = await renderer.current.render(tab === 'masks' ? { ...settings, border: { ...settings.border, preset: 'none' } } : settings, { maxDimension: 1000, cropPreview: tab === 'crop' });
                if (current !== sequence.current) return;
                const url = URL.createObjectURL(result.blob);
                try {
                    const prepared = new Image();
                    prepared.src = url;
                    await prepared.decode();
                } catch {
                    URL.revokeObjectURL(url);
                    throw Object.assign(new Error(), { code: 'IMAGE_EDIT_RENDER' });
                }
                if (current !== sequence.current) { URL.revokeObjectURL(url); return; }
                previewUrls.current.add(url);
                setPreview({ ...result, url });
                setError(null);
            } catch (failure) { if (current === sequence.current) setError(l(failure.code || 'IMAGE_EDIT_RENDER')); }
            finally { if (current === sequence.current) setRendering(false); }
        }, 100);
        return () => { clearTimeout(timeout); sequence.current += 1; };
    }, [settings, tab]);
    const change = patch => setSettings(current => ({ ...current, ...patch }));
    const transformed = source && settings ? getTransformedImageDimensions(source.width, source.height, settings.rotation) : null;
    const ratio = ratioId === 'original' ? transformed.width / transformed.height : IMAGE_CROP_PRESETS.find(item => item.id === ratioId)?.ratio || null;
    const setCrop = rect => {
        const crop = clampImageRect(rect);
        setSettings(current => ({ ...current, crop, width: Math.max(1, Math.round(current.width * crop.width / current.crop.width)), height: Math.max(1, Math.round(current.height * crop.height / current.crop.height)) }));
    };
    const chooseRatio = id => {
        setRatioId(id);
        const nextRatio = id === 'original' ? transformed.width / transformed.height : IMAGE_CROP_PRESETS.find(item => item.id === id)?.ratio;
        if (nextRatio) setCrop(fitImageCrop(settings.crop, nextRatio, transformed.width, transformed.height));
    };
    const resize = (axis, value) => {
        const next = Math.round(value);
        const other = axis === 'width' ? 'height' : 'width';
        const linked = Math.round(settings[other] * next / settings[axis]);
        if (lockRatio && linked > 8192) return;
        change({ [axis]: next, ...(lockRatio ? { [other]: Math.max(1, linked) } : {}) });
    };
    const changeMask = patch => {
        setMask(current => ({ ...current, ...patch }));
        if (selectedRegion) change({ regions: settings.regions.map(region => region.id === selectedRegion ? { ...region, ...patch, ...(patch.shape === 'ellipse' ? fitImageCrop(region, 1, settings.width / settings.crop.width, settings.height / settings.crop.height) : {}) } : region) });
    };
    const selectRegion = region => { setSelectedRegion(region.id); setMask({ mode: region.mode, shape: region.shape, strength: region.strength }); };
    const removeRegion = id => { change({ regions: settings.regions.filter(region => region.id !== id) }); if (selectedRegion === id) setSelectedRegion(null); };
    const regionInCrop = (region, crop) => clampImageRect({ x: (region.x - crop.x) / crop.width, y: (region.y - crop.y) / crop.height, width: region.width / crop.width, height: region.height / crop.height });
    const selectedMask = settings?.regions.find(region => region.id === selectedRegion);
    const selectedMaskRect = selectedMask ? regionInCrop(selectedMask, settings.crop) : null;
    const changeRegionDimension = (axis, value) => {
        if (!selectedMaskRect || value === Math.round(selectedMaskRect[axis] * 1000) / 10) return;
        setSettings(current => ({ ...current, regions: current.regions.map(region => {
            if (region.id !== selectedRegion) return region;
            let rect = { ...regionInCrop(region, current.crop), [axis]: value / 100 };
            if (region.shape === 'ellipse') {
                if (axis === 'height') rect.width = rect.height * current.height / current.width;
                else rect.height = rect.width * current.width / current.height;
                const scale = Math.min(1, 1 / rect.width, 1 / rect.height);
                rect.width *= scale;
                rect.height *= scale;
            }
            rect = clampImageRect(rect);
            return { ...region, x: current.crop.x + rect.x * current.crop.width, y: current.crop.y + rect.y * current.crop.height, width: rect.width * current.crop.width, height: rect.height * current.crop.height };
        }) }));
    };
    const point = event => {
        const bounds = picture.current.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    };
    const imagePoint = value => tab === 'crop' ? value : { x: settings.crop.x + value.x * settings.crop.width, y: settings.crop.y + value.y * settings.crop.height };
    const startDrag = event => {
        if (saving || showOriginal || !['crop', 'masks'].includes(tab) || event.button !== 0 || event.target.closest('button')) return;
        event.preventDefault();
        const start = imagePoint(point(event));
        const region = settings.regions.find(item => item.id === event.target.closest('[data-region]')?.dataset.region);
        if (tab === 'masks' && !region && settings.regions.length >= IMAGE_EDIT_LIMITS.maxRegions) { setError(t('regionLimit')); return; }
        if (region) selectRegion(region);
        const selected = tab === 'crop' ? settings.crop : region;
        const corner = event.target.dataset.corner;
        const move = !corner && (tab === 'crop' ? event.target.closest('[data-crop]') && (settings.crop.width < .999 || settings.crop.height < .999) : region);
        const id = tab === 'masks' ? region?.id || `region_${crypto.randomUUID()}` : null;
        if (tab === 'masks' && !region) setSelectedRegion(id);
        drag.current = { start, selected, corner, move, id, settings };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = event => {
        const active = drag.current;
        if (!active) return;
        const end = imagePoint(point(event));
        let rect;
        if (active.move) rect = { ...active.selected, x: Math.max(0, Math.min(1 - active.selected.width, active.selected.x + end.x - active.start.x)), y: Math.max(0, Math.min(1 - active.selected.height, active.selected.y + end.y - active.start.y)) };
        else {
            const anchor = active.corner ? { x: active.selected.x + (active.corner.includes('w') ? active.selected.width : 0), y: active.selected.y + (active.corner.includes('n') ? active.selected.height : 0) } : active.start;
            rect = { x: Math.min(anchor.x, end.x), y: Math.min(anchor.y, end.y), width: Math.max(.002, Math.abs(end.x - anchor.x)), height: Math.max(.002, Math.abs(end.y - anchor.y)) };
            const constrained = tab === 'crop' ? ratio : mask.shape === 'ellipse' ? 1 : null;
            if (constrained) rect = fitImageCrop(rect, constrained, tab === 'crop' ? transformed.width : settings.width / settings.crop.width, tab === 'crop' ? transformed.height : settings.height / settings.crop.height);
        }
        rect = clampImageRect(rect);
        if (tab === 'crop') {
            const base = active.settings;
            setSettings({ ...base, crop: rect, width: Math.max(1, Math.round(base.width * rect.width / base.crop.width)), height: Math.max(1, Math.round(base.height * rect.height / base.crop.height)) });
        } else {
            const region = { ...(active.selected || mask), ...rect, id: active.id };
            setSettings({ ...active.settings, regions: [...active.settings.regions.filter(item => item.id !== active.id), region] });
        }
    };
    const endDrag = () => { drag.current = null; };
    const cancelDrag = () => { if (drag.current) setSettings(drag.current.settings); drag.current = null; };
    const addRegion = () => {
        if (settings.regions.length >= IMAGE_EDIT_LIMITS.maxRegions) { setError(t('regionLimit')); return; }
        let rect = { x: settings.crop.x + settings.crop.width * .25, y: settings.crop.y + settings.crop.height * .25, width: settings.crop.width * .5, height: settings.crop.height * .5 };
        if (mask.shape === 'ellipse') rect = fitImageCrop(rect, 1, settings.width / settings.crop.width, settings.height / settings.crop.height);
        const region = { ...mask, ...rect, id: `region_${crypto.randomUUID()}` };
        change({ regions: [...settings.regions, region] });
        selectRegion(region);
    };
    const save = async () => {
        if (saving || !settings) return;
        setSaving(true);
        setSaveError(null);
        try {
            const result = await renderer.current.render(settings);
            if (result.blob.size > 20 * 1024 * 1024) throw Object.assign(new Error(), { code: 'ASSET_TOO_LARGE' });
            await onApply(result.blob);
            onClose();
        } catch (failure) { setSaveError(l(failure.code || 'IMAGE_EDIT_RENDER')); setSaving(false); }
    };
    const reset = () => { setSettings(createImageEditSettings(source.width, source.height)); setRatioId('free'); setSelectedRegion(null); setShowOriginal(false); };
    const corners = <>{['nw', 'ne', 'sw', 'se'].map(corner => <span key={corner} data-corner={corner} className={`ee-image-edit-handle is-${corner}`} />)}</>;
    const imageSize = showOriginal ? source : preview;
    const scale = imageSize ? Math.min(1, available.width / imageSize.width, available.height / imageSize.height) : 1;
    const oversized = settings && (settings.width > 8192 || settings.height > 8192 || settings.width * settings.height > 32 * 1024 * 1024);
    const status = saveError || error || (oversized ? l('IMAGE_DIMENSIONS_EXCEEDED') : rendering ? t('rendering') : '');
    return <EditorDialog title={l('imageEdit')} className="ee-image-edit-dialog" onClose={() => { if (!saving) onClose(); }} onKeyDown={event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); } }} footer={<div className="ee-image-edit-footer"><p className="ee-muted">{t('keepOriginal')}</p><button type="button" className="ee-button" disabled={!settings || saving} onClick={reset}>{t('resetAll')}</button><button type="button" className="ee-button" disabled={saving} onClick={onClose}>{l('cancel')}</button><button type="button" className="ee-button ee-primary" disabled={!preview || saving || oversized} onClick={save}>{l(saving ? 'working' : 'apply')}</button></div>}>
        {!settings ? <p role="status">{error || t('loading')}</p> : <>
            <div className="ee-image-edit-tabs" role="tablist" aria-label={l('imageEdit')}>{['resize', 'crop', 'effects', 'masks', 'border'].map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} disabled={saving} onClick={() => { setTab(value); setShowOriginal(false); }}>{t(value)}</button>)}</div>
            <div className="ee-image-edit-layout" aria-busy={saving}>
                <fieldset className="ee-image-edit-options" disabled={saving}>
                    {tab === 'resize' && <><h3>{t('resize')}</h3><p className="ee-muted">{t('originalDimensions')} · {source.width} × {source.height} px</p><NumberInput label={t('width')} value={settings.width} onChange={value => resize('width', value)} /><NumberInput label={t('height')} value={settings.height} onChange={value => resize('height', value)} /><label className="ee-check"><input type="checkbox" checked={lockRatio} onChange={event => setLockRatio(event.target.checked)} />{t('lockRatio')}</label><p className="ee-muted">{t('limits')}</p></>}
                    {tab === 'crop' && <><h3>{t('crop')}</h3><div className="ee-image-crop-presets">{IMAGE_CROP_PRESETS.map(preset => <button type="button" key={preset.id} className="ee-button" aria-pressed={ratioId === preset.id} onClick={() => chooseRatio(preset.id)}>{['original', 'free'].includes(preset.id) ? t(preset.id) : preset.label}</button>)}</div><div className="ee-image-edit-transforms">{['rotate', 'flipX', 'flipY'].map(operation => <button type="button" className="ee-button" key={operation} onClick={() => { setSettings(transformImageEditSettings(settings, operation)); if (operation === 'rotate') setRatioId('free'); }}>{t(operation)}</button>)}</div><p className="ee-muted">{t('cropHint')}</p><div className="ee-image-crop-numbers">{['x', 'y', 'width', 'height'].map(axis => <NumberInput key={axis} label={t({ x: 'cropX', y: 'cropY', width: 'cropWidth', height: 'cropHeight' }[axis])} value={Math.round(settings.crop[axis] * 1000) / 10} min={['x', 'y'].includes(axis) ? 0 : .1} max={100} step={.1} onChange={value => { setRatioId('free'); setCrop({ ...settings.crop, [axis]: value / 100 }); }} />)}</div><button type="button" className="ee-button" onClick={() => { setRatioId('free'); setCrop(fullRect); }}>{t('reset')}</button></>}
                    {tab === 'effects' && <><div className="ee-image-edit-switch" role="group" aria-label={t('effects')}>{['filters', 'adjustments'].map(value => <button type="button" key={value} className="ee-button" aria-pressed={effectTab === value} onClick={() => setEffectTab(value)}>{t(value)}</button>)}</div>{effectTab === 'filters' ? <div className="ee-image-filter-grid">{IMAGE_FILTER_PRESETS.map(filter => <button type="button" key={filter.id} aria-pressed={settings.filter === filter.id} onClick={() => change({ filter: filter.id })}><img src={src} alt="" style={{ filter: filter.cssFilter }} draggable={false} /><span>{t(filter.id)}</span></button>)}</div> : <>{['brightness', 'contrast', 'saturation', 'temperature', 'vignette'].map(key => <Slider key={key} label={t(key)} value={settings[key]} min={key === 'vignette' ? 0 : -100} onChange={value => change({ [key]: value })} />)}<button type="button" className="ee-button" onClick={() => change({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0 })}>{t('reset')}</button></>}</>}
                    {tab === 'masks' && <><div className="ee-image-edit-switch" role="group" aria-label={t('masks')}>{['mosaic', 'blur'].map(mode => <button type="button" className="ee-button" key={mode} aria-pressed={mask.mode === mode} onClick={() => changeMask({ mode })}>{t(mode)}</button>)}</div><div className="ee-image-edit-switch" role="group" aria-label={t('region')}>{['ellipse', 'rectangle'].map(shape => <button type="button" className="ee-button" key={shape} aria-pressed={mask.shape === shape} onClick={() => changeMask({ shape })}>{t(shape)}</button>)}</div><Slider label={t('strength')} value={mask.strength} min={1} onChange={strength => changeMask({ strength })} /><p className="ee-muted">{t('maskHint')}</p><button type="button" className="ee-button" onClick={addRegion}>{t('addRegion')}</button><div className="ee-image-region-list">{settings.regions.map((region, index) => <button type="button" className="ee-button" key={region.id} aria-pressed={region.id === selectedRegion} onClick={() => selectRegion(region)}>{t('region')} {index + 1} · {t(region.mode)} · {region.strength}</button>)}</div><div className="ee-image-crop-numbers">{selectedMaskRect && ['x', 'y', 'width', 'height'].map(axis => <NumberInput key={axis} label={t({ x: 'regionX', y: 'regionY', width: 'regionWidth', height: 'regionHeight' }[axis])} value={Math.round(selectedMaskRect[axis] * 1000) / 10} min={['x', 'y'].includes(axis) ? 0 : .1} max={100} step={.1} onChange={value => changeRegionDimension(axis, value)} />)}</div><button type="button" className="ee-button" disabled={!selectedRegion} onClick={() => removeRegion(selectedRegion)}>{t('deleteRegion')}</button><button type="button" className="ee-button" disabled={!settings.regions.length} onClick={() => { change({ regions: [] }); setSelectedRegion(null); }}>{t('clearRegions')}</button></>}
                    {tab === 'border' && <><h3>{t('border')}</h3><div className="ee-image-border-presets">{IMAGE_BORDER_PRESETS.map(border => <button type="button" key={border.id} aria-pressed={settings.border.preset === border.id} onClick={() => change({ border: { ...settings.border, preset: border.id } })}><span className={`ee-image-border-sample is-${border.id}`}><img src={src} alt="" draggable={false} /></span><span>{t(border.id)}</span></button>)}</div><Slider label={t('thickness')} min={1} max={100} value={settings.border.width} onChange={width => change({ border: { ...settings.border, width } })} /><label className="ee-field"><span>{t('color')}</span><input type="color" value={settings.border.color} onChange={event => change({ border: { ...settings.border, color: event.target.value } })} /></label><Slider label={t('radius')} min={0} max={100} value={settings.border.radius} onChange={radius => change({ border: { ...settings.border, radius } })} /></>}
                </fieldset>
                <div className="ee-image-edit-main">
                    <div className="ee-image-edit-preview-controls"><button type="button" className="ee-button" aria-pressed={showOriginal} disabled={saving} onClick={() => setShowOriginal(!showOriginal)}>{t('source')}</button><span>{t('outputDimensions')} · {settings.width} × {settings.height} px</span></div>
                    <div className="ee-image-edit-stage" ref={stage}><div className={`ee-image-edit-picture is-${tab}`} ref={picture} style={imageSize ? { width: imageSize.width * scale, height: imageSize.height * scale } : undefined} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={endDrag}>
                        {(showOriginal || preview) && <img src={showOriginal ? src : preview.url} alt={t('preview')} draggable={false} />}
                        {!showOriginal && preview && tab === 'crop' && <div data-crop="true" className="ee-image-crop-selection" style={rectStyle(settings.crop)}>{corners}<span className="ee-image-crop-thirds" /></div>}
                        {!showOriginal && preview && tab === 'masks' && settings.regions.map(region => {
                            const displayed = { x: (region.x - settings.crop.x) / settings.crop.width, y: (region.y - settings.crop.y) / settings.crop.height, width: region.width / settings.crop.width, height: region.height / settings.crop.height };
                            return <div key={region.id} data-region={region.id} className={`ee-image-mask-selection is-${region.shape}${selectedRegion === region.id ? ' is-selected' : ''}`} style={rectStyle(displayed)}>{selectedRegion === region.id && corners}<button type="button" aria-label={t('deleteRegion')} onClick={() => removeRegion(region.id)}>×</button></div>;
                        })}
                    </div></div>
                    {/* Keep the same font metrics and wrapping when the rendering message is hidden. */}
                    <div className="ee-image-edit-status" role="status"><span style={{ visibility: status ? 'visible' : 'hidden' }} aria-hidden={!status}>{status || t('rendering')}</span></div>
                </div>
            </div>
        </>}
    </EditorDialog>;
}
