import React, { useEffect, useState } from 'react';
import { convertImageWidth, imageWidthMaximum, imageWidthUnit } from '../../../../electron/epubEditor/imageSizing.js';
import { imageContainerWidth } from './imageNode';
import { editorText as l } from './labels';

export default function ImageWidthField({ value, editor, onChange, onValidityChange, autoFocus = false }) {
    const unit = imageWidthUnit(value);
    const maximum = imageWidthMaximum(unit);
    const [width, setWidth] = useState(String(value.width));
    const numeric = Number(width);
    const valid = width.trim() !== '' && Number.isFinite(numeric) && numeric >= 1 && numeric <= maximum;
    useEffect(() => {
        setWidth(previous => previous.trim() && Number(previous) === value.width ? previous : String(value.width));
        onValidityChange?.(true);
    }, [value.width, unit, onValidityChange]);
    const change = text => {
        setWidth(text);
        const number = Number(text);
        const valid = text.trim() !== '' && Number.isFinite(number) && number >= 1 && number <= maximum;
        onValidityChange?.(valid);
        if (valid) onChange({ width: number, widthUnit: unit });
    };
    return <div className="ee-field"><span>{l('imageDisplayWidth')}</span>
        <div className="ee-image-width-controls">
            <input type="range" aria-label={l('imageDisplayWidth')} min={1} max={maximum} step={1} value={valid ? numeric : value.width} onChange={event => change(event.target.value)} />
            <input autoFocus={autoFocus} type="number" aria-label={`${l('width')} (${unit})`} min={1} max={maximum} step="any" value={width} aria-invalid={!valid} onChange={event => change(event.target.value)} />
            <select aria-label={l('imageWidthUnit')} value={unit} onChange={event => {
                const patch = convertImageWidth(value, event.target.value, imageContainerWidth(editor));
                setWidth(String(patch.width));
                onValidityChange?.(true);
                onChange(patch);
            }}><option value="%">%</option><option value="px">px</option></select>
        </div>
        {!valid && <p role="status" className="ee-danger">{l(unit === 'px' ? 'IMAGE_PIXEL_WIDTH_INVALID' : 'IMAGE_WIDTH_INVALID')}</p>}
    </div>;
}
