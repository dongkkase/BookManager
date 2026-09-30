import React, { useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { DIVIDER_STYLES, dividerCss } from '../../../../electron/epubEditor/dividers.js';
import { applyDivider } from './dividers';
import './dividers.css';

export default function DividerDialog({ editor, onClose }) {
    const editing = editor.isActive('horizontalRule');
    const [selected, setSelected] = useState(editor.getAttributes('horizontalRule').dividerStyle || 'solid');
    const apply = event => {
        event.preventDefault();
        if (applyDivider(editor, selected)) { onClose(); editor.commands.focus(); }
    };
    return <EditorDialog title={l(editing ? 'editDivider' : 'horizontalRule')} className="ee-divider-dialog" onClose={onClose} onSubmit={apply} footer={<div className="ee-divider-actions">
        <button type="button" className="ee-button" onClick={onClose}>{l('cancel')}</button>
        <button type="submit" className="ee-button ee-primary">{l(editing ? 'apply' : 'insert')}</button>
    </div>}>
        <style>{dividerCss('.ee-divider-preview ')}</style>
        <p className="ee-muted">{l(editing ? 'dividerEditHint' : 'dividerHint')}</p>
        <div className="ee-divider-grid" role="group" aria-label={l('dividerDesign')}>
            {Object.entries(DIVIDER_STYLES).map(([key, preset]) => <button key={key} type="button" className={`ee-divider-card${selected === key ? ' is-selected' : ''}`} aria-pressed={selected === key} onClick={() => setSelected(key)} autoFocus={selected === key}>
                <span className="ee-divider-preview" aria-hidden="true"><span className={`bm-divider bm-divider-${key}`}>{preset.symbol}</span></span>
                <span className="ee-divider-name">{l(preset.label)}</span>
            </button>)}
        </div>
    </EditorDialog>;
}
