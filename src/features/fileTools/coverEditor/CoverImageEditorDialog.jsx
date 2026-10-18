import React from 'react';
import ImageEditorDialog from '../epubEditor/ImageEditorDialog';
import '../epubEditor/epubEditor.css';

function coverImageBlob(dataUrl) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
    if (!match) throw Object.assign(new Error(), { code: 'IMAGE_EDIT_RENDER' });
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: match[1] });
}

export default function CoverImageEditorDialog({ image, onApply, onClose, t, formatError }) {
    return <div className="epub-editor-tool cover-editor-image-edit-host"
        onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
        onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none'; }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
        <ImageEditorDialog src={image.dataUrl} loadSource={async () => coverImageBlob(image.dataUrl)}
            onApply={onApply} onClose={onClose} applyHint={t('cover_editor_edit_hint')} formatError={formatError}
            outputFormat="auto" maxOutputBytes={16 * 1024 * 1024} limitsHint={t('cover_editor_edit_limits')} />
    </div>;
}
