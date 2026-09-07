import React from 'react';
import noDataImage from '../../images/folder-empty-bookshelf.png';
import { SmoothCoverImage } from '../SmoothCoverImage';

function FolderEmptyState({ t }) {
    return (
        <div className="empty-folder-page">
            <SmoothCoverImage className="folder-empty-image" src={noDataImage} alt="" />
            <div className="empty-message">{t('folder.message.noFiles')}</div>
        </div>
    );
}

export { FolderEmptyState };
export default FolderEmptyState;
