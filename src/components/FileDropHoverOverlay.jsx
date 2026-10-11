import React from 'react';
import { FaIcon } from './FaIcon';
import { REPLACE_DROP_RATIO } from '../dropPolicy';

export function FileDropHoverOverlay({ opensViewer, dropMode, t, imageDrop = false }) {
    if (imageDrop) {
        return (
            <div className="app-file-drop-hover" role="status" aria-live="polite">
                <div className="app-file-drop-hover-card">
                    <FaIcon name="image" size={32} />
                    <span>{t('cover_editor_image_drop_hint')}</span>
                </div>
            </div>
        );
    }
    if (!opensViewer) {
        return (
            <div className="app-file-drop-hover is-split" style={{ '--replace-drop-ratio': `${REPLACE_DROP_RATIO * 100}%` }}>
                {['replace', 'append'].map(mode => (
                    <div key={mode} className={`app-file-drop-zone is-${mode} ${dropMode === mode ? 'is-active' : ''}`}>
                        <div className="app-file-drop-hover-card">
                            <FaIcon name={mode === 'replace' ? 'folderMinus' : 'fileCirclePlus'} size={28} />
                            <span>{t(`drag_drop_${mode}`)}</span>
                        </div>
                    </div>
                ))}
                <span className="app-file-drop-announcement" role="status" aria-live="polite">{t(`drag_drop_${dropMode}`)}</span>
            </div>
        );
    }
    return (
        <div
            className={`app-file-drop-hover ${opensViewer ? 'is-viewer-open' : ''}`.trim()}
            role="status"
            aria-live="polite"
        >
            <div className="app-file-drop-hover-card">
                <FaIcon name={opensViewer ? 'bookOpen' : 'fileCirclePlus'} size={32} />
                <span>{t(opensViewer ? 'folder.drop.open_in_viewer' : 'drag_drop')}</span>
            </div>
        </div>
    );
}
