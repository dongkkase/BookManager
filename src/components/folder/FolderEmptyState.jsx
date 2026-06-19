import React from 'react';
import noDataImage from '../../images/nodata2.png';

function FolderEmptyState({ t }) {
    return (
        <div className="empty-folder-page">
            <img className="folder-empty-image" src={noDataImage} alt="" />
            <div className="empty-message">{t('folder.message.noFiles')}</div>
        </div>
    );
}

export { FolderEmptyState };
export default FolderEmptyState;
