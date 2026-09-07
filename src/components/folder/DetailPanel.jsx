import React from 'react';
import { FaIcon } from '../FaIcon';
import { resolveBookType } from '../../metadata/metadataTypes';
import { AudiobookDetailPanel } from './AudiobookDetailPanel';
import { BookDetailPanel } from './BookDetailPanel';
import { ComicDetailPanel } from './ComicDetailPanel';
import { PdfDetailPanel } from './PdfDetailPanel';
import { DetailFieldGroup, formatDate, useDetailContentHeight } from './detailPanelCommon';

const DirectoryDetailPanel = ({ selectedFile, onContentHeightChange, t }) => {
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);
    const fields = [
        ['folder', t('org_folder_menu'), selectedFile.name],
        ['folderOpen', t('col_full_path'), selectedFile.full_path || selectedFile.path],
        ['calendar', t('col_ctime'), formatDate(selectedFile.created || selectedFile.ctime)],
        ['clock', t('col_mtime'), formatDate(selectedFile.modified || selectedFile.mtime)],
    ];

    return (
        <div className="folder-detail-panel directory-detail-panel">
            <div className="folder-detail-scroll" ref={scrollRef}>
                <div className="folder-detail-content" ref={contentRef}>
                    <div className="directory-detail-icon folder-item-artwork">
                        <FaIcon name="folder" size={76} title={t('folder_item_type')} />
                    </div>
                    <div className="detail-metadata-section">
                        <div className="detail-heading">
                            <div className="detail-series">{t('folder_item_type')}</div>
                            <div className="detail-title">{selectedFile.name || '-'}</div>
                        </div>
                        <DetailFieldGroup fields={fields} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailPanel = React.memo((props) => {
    const selectedFile = props.selectedFile || null;
    if (selectedFile?.isDirectory) {
        return <DirectoryDetailPanel {...props} />;
    }
    if (resolveBookType(selectedFile) === 'pdf') {
        return <PdfDetailPanel {...props} />;
    }
    if (resolveBookType(selectedFile) === 'book') {
        return <BookDetailPanel {...props} />;
    }
    if (resolveBookType(selectedFile) === 'audio') {
        return <AudiobookDetailPanel {...props} />;
    }
    return <ComicDetailPanel {...props} />;
});

export { DetailPanel };
export default DetailPanel;
