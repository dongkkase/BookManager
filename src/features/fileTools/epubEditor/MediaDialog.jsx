import React, { useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { parseMediaUrl } from '../../../../electron/epubEditor/authoring';

export default function MediaDialog({ editor, onClose }) {
    const editing = editor.isActive('media');
    const [url, setUrl] = useState(editing ? editor.getAttributes('media').url : '');
    const [title, setTitle] = useState(editing ? editor.getAttributes('media').title : '');
    const media = parseMediaUrl(url);
    const apply = event => {
        event.preventDefault();
        if (!media) return;
        const attrs = { url: media.url, title: title.trim() };
        const chain = editor.chain().focus();
        if (editing ? chain.updateAttributes('media', attrs).run() : chain.insertContent({ type: 'media', attrs }).run()) onClose();
    };
    return <EditorDialog title={l(editing ? 'editMedia' : 'media')} onClose={onClose} onSubmit={apply} footer={<>
        <button type="submit" className="ee-button ee-primary" disabled={!media}>{l(editing ? 'apply' : 'insert')}</button>
    </>}>
        <p className="ee-muted">{l('mediaHint')}</p>
        <label className="ee-field"><span>{l('mediaUrl')}</span><input type="url" value={url} maxLength={2048} placeholder="https://www.youtube.com/watch?v=…" aria-invalid={!!url && !media} onChange={event => setUrl(event.target.value)} /></label>
        {url && !media && <p className="ee-text-error" role="status">{l('invalidMedia')}</p>}
        <label className="ee-field"><span>{l('mediaTitle')}</span><input value={title} maxLength={2000} placeholder={media?.provider || l('media')} onChange={event => setTitle(event.target.value)} /></label>
        {media && <div className="ee-media-summary"><strong>{media.provider}</strong><span>{media.url}</span></div>}
        <p className="ee-muted">{l('mediaExportHint')}</p>
    </EditorDialog>;
}
