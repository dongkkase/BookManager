import React, { useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';

export default function ImageAttributesDialog({ editor, mode, onClose }) {
    const target = useRef(editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'image'
        ? { position: editor.state.selection.from, id: editor.state.selection.node.attrs.id, assetId: editor.state.selection.node.attrs.assetId }
        : null);
    const initial = editor.getAttributes('image');
    const [alt, setAlt] = useState(initial.alt || '');
    const [decorative, setDecorative] = useState(!!initial.decorative);
    const [width, setWidth] = useState(String(initial.width || 100));
    const [error, setError] = useState(null);
    const numericWidth = Number(width);
    const validWidth = width.trim() !== '' && Number.isFinite(numericWidth) && numericWidth >= 10 && numericWidth <= 100;
    const apply = () => {
        if (mode === 'size' && !validWidth) { setError('IMAGE_WIDTH_INVALID'); return; }
        const current = target.current;
        if (!current || editor.isDestroyed) { setError('IMAGE_SELECTION_REQUIRED'); return; }
        const node = editor.state.doc.nodeAt(current.position);
        if (node?.type.name !== 'image' || (current.id ? node.attrs.id !== current.id : node.attrs.assetId !== current.assetId)) { setError('IMAGE_SELECTION_REQUIRED'); return; }
        const patch = mode === 'alt' ? { alt, decorative } : { width: Math.round(numericWidth) };
        const tr = closeHistory(editor.state.tr).setNodeMarkup(current.position, undefined, { ...node.attrs, ...patch });
        tr.setSelection(NodeSelection.create(tr.doc, current.position));
        editor.view.dispatch(tr);
        onClose();
    };
    return <EditorDialog title={l(mode === 'alt' ? 'imageAlt' : 'imageSize')} className="ee-image-attributes-dialog" onClose={onClose} onSubmit={event => { event.preventDefault(); apply(); }} footer={<>
        <button type="button" className="ee-button" onClick={onClose}>{l('cancel')}</button>
        <button type="submit" className="ee-button ee-primary" disabled={mode === 'size' && !validWidth}>{l('apply')}</button>
    </>}>
        {mode === 'alt' ? <>
            <label className="ee-field"><span>{l('alt')}</span><textarea autoFocus rows={4} maxLength={2000} disabled={decorative} value={alt} onChange={event => setAlt(event.target.value)} /></label>
            <label className="ee-check"><input type="checkbox" checked={decorative} onChange={event => setDecorative(event.target.checked)} />{l('decorative')}</label>
        </> : <>
            <label className="ee-field"><span>{l('imageDisplayWidth')}</span><div className="ee-image-width-controls">
                <input type="range" aria-label={l('imageDisplayWidth')} min={10} max={100} step={1} value={validWidth ? numericWidth : 100} onChange={event => { setWidth(event.target.value); setError(null); }} />
                <input autoFocus type="number" aria-label={`${l('width')} (%)`} min={10} max={100} step={1} value={width} aria-invalid={!validWidth} onChange={event => { setWidth(event.target.value); setError(null); }} /><span>%</span>
            </div></label>
            <p className="ee-muted">{l('imageDisplaySizeHint')}</p>
            {!validWidth && <p role="status" className="ee-danger">{l('IMAGE_WIDTH_INVALID')}</p>}
        </>}
        {error && <p role="alert" className="ee-danger">{l(error)}</p>}
    </EditorDialog>;
}
