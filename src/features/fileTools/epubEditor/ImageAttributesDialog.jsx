import React, { useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import EditorDialog from './EditorDialog';
import ImageWidthField from './ImageWidthField';
import { editorText as l } from './labels';

export default function ImageAttributesDialog({ editor, mode, onClose }) {
    const target = useRef(editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'image'
        ? { position: editor.state.selection.from, id: editor.state.selection.node.attrs.id, assetId: editor.state.selection.node.attrs.assetId }
        : null);
    const initial = editor.getAttributes('image');
    const [alt, setAlt] = useState(initial.alt || '');
    const [decorative, setDecorative] = useState(!!initial.decorative);
    const [size, setSize] = useState({ width: initial.width || 100, widthUnit: initial.widthUnit || '%' });
    const [validWidth, setValidWidth] = useState(true);
    const [error, setError] = useState(null);
    const apply = () => {
        if (mode === 'size' && !validWidth) return;
        const current = target.current;
        if (!current || editor.isDestroyed) { setError('IMAGE_SELECTION_REQUIRED'); return; }
        const node = editor.state.doc.nodeAt(current.position);
        if (node?.type.name !== 'image' || (current.id ? node.attrs.id !== current.id : node.attrs.assetId !== current.assetId)) { setError('IMAGE_SELECTION_REQUIRED'); return; }
        const patch = mode === 'alt' ? { alt, decorative } : size;
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
            <ImageWidthField value={size} editor={editor} onChange={setSize} onValidityChange={setValidWidth} autoFocus />
            <p className="ee-muted">{l('imageDisplaySizeHint')}</p>
        </>}
        {error && <p role="alert" className="ee-danger">{l(error)}</p>}
    </EditorDialog>;
}
