import React from 'react';
import { resolveBookType } from '../../metadata/metadataTypes';
import { AudiobookDetailPanel } from './AudiobookDetailPanel';
import { BookDetailPanel } from './BookDetailPanel';
import { ComicDetailPanel } from './ComicDetailPanel';
import { PdfDetailPanel } from './PdfDetailPanel';

const DetailPanel = React.memo((props) => {
    const selectedFile = props.selectedFile || null;
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
