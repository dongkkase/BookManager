import React, { useLayoutEffect, useRef, useState } from 'react';
import { FaIcon } from '../../../components/FaIcon';
import { applyEpubOriginalTheme } from '../../../epubOriginalDocument';
import { editorText as l } from './labels';
import { MAX_PREVIEW_DIMENSION, MIN_PREVIEW_DIMENSION, PREVIEW_DEVICES, PREVIEW_ZOOM_PRESETS, normalizePreviewDimension, previewFitScale } from './previewViewport';

function DimensionInput({ value, label, onChange }) {
    const [draft, setDraft] = useState(String(value));
    useLayoutEffect(() => { setDraft(String(value)); }, [value]);
    const commit = () => {
        const next = normalizePreviewDimension(draft, value);
        setDraft(String(next));
        if (next !== value) onChange(next);
    };
    return <input type="number" inputMode="numeric" min={MIN_PREVIEW_DIMENSION} max={MAX_PREVIEW_DIMENSION} step="1" aria-label={label} title={`${label} · ${MIN_PREVIEW_DIMENSION}–${MAX_PREVIEW_DIMENSION} px`} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(String(value)); }
    }} />;
}

export function PreviewDeviceToolbar({ viewport, onViewportChange, zoom, scale, onZoomChange, theme, onThemeChange }) {
    const changeDimension = (axis, value) => onViewportChange({ ...viewport, id: 'responsive', [axis]: value });
    return <div className="ee-preview-device-toolbar" role="group" aria-label={l('previewScreen')}>
        <label className="ee-preview-device"><span>{l('previewScreen')}</span><select aria-label={l('previewDevice')} value={viewport.id} onChange={event => {
            const device = PREVIEW_DEVICES.find(item => item.id === event.target.value);
            onViewportChange(device ? { id: device.id, width: device.width, height: device.height } : { ...viewport, id: 'responsive' });
        }}><option value="responsive">{l('previewResponsive')}</option>{PREVIEW_DEVICES.map(device => <option key={device.id} value={device.id}>{l(device.label)} · {device.id === viewport.id ? viewport.width : device.width} × {device.id === viewport.id ? viewport.height : device.height}</option>)}</select></label>
        <div className="ee-preview-dimensions" role="group" aria-label={l('previewDimensions')}>
            <DimensionInput value={viewport.width} label={l('previewWidth')} onChange={value => changeDimension('width', value)} />
            <span aria-hidden="true">×</span>
            <DimensionInput value={viewport.height} label={l('previewHeight')} onChange={value => changeDimension('height', value)} />
            <span>px</span>
        </div>
        <button type="button" className="ee-icon-button" aria-label={l('previewRotate')} title={l('previewRotate')} onClick={() => onViewportChange({ ...viewport, width: viewport.height, height: viewport.width })}><FaIcon name="rotateRight" /></button>
        <select className="ee-preview-scale" aria-label={l('previewScale')} title={l('previewScaleHint')} value={zoom} onChange={event => onZoomChange(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
            <option value="fit">{l('previewFit')}{zoom === 'fit' && ` · ${Math.round(scale * 100)}%`}</option>
            {[...new Set([...PREVIEW_ZOOM_PRESETS, ...(typeof zoom === 'number' ? [zoom] : [])])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}%</option>)}
        </select>
        <div className="ee-preview-theme" role="group" aria-label={l('previewTheme')} title={l('previewThemeHint')}>
            {['light', 'dark'].map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => onThemeChange(value)}><span className={`ee-preview-theme-swatch is-${value}`} aria-hidden="true" />{l(value === 'dark' ? 'previewDark' : 'previewLight')}</button>)}
        </div>
    </div>;
}

export default function PreviewViewport({ viewport, zoom, onScaleChange, theme = 'light', children }) {
    const canvas = useRef(null);
    const [available, setAvailable] = useState({ width: 0, height: 0 });
    const applyTheme = frame => {
        const doc = frame?.contentDocument;
        if (!doc?.body) return;
        applyEpubOriginalTheme(doc, theme === 'dark' ? { bg: '#202124', fg: '#e8eaed' } : null);
        doc.documentElement.style.colorScheme = theme;
    };
    useLayoutEffect(() => { applyTheme(canvas.current?.querySelector('iframe')); }, [theme]);
    useLayoutEffect(() => {
        const element = canvas.current;
        const measure = () => {
            const style = getComputedStyle(element);
            const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            setAvailable(previous => previous.width === width && previous.height === height ? previous : { width, height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const scale = zoom === 'fit' ? previewFitScale(viewport, available) : zoom / 100;
    useLayoutEffect(() => { onScaleChange(scale); }, [scale, onScaleChange]);
    return <div className={`ee-preview is-${theme}`} onLoadCapture={event => { if (event.target.tagName === 'IFRAME') applyTheme(event.target); }}>
        <div className="ee-preview-canvas" ref={canvas}>
            <div className="ee-preview-screen" style={{ width: viewport.width * scale, height: viewport.height * scale }}>
                <div className="ee-preview-frame" style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}>{children}</div>
            </div>
        </div>
        <p className="ee-preview-caption"><span>{viewport.width} × {viewport.height} px · {Math.round(scale * 100)}%</span><span>{l('readingHint')}</span></p>
    </div>;
}
