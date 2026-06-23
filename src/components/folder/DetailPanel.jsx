import React from 'react';
import { resolveBookType } from '../../metadata/metadataTypes';
import { BookDetailPanel } from './BookDetailPanel';
import { ComicDetailPanel } from './ComicDetailPanel';

const DetailPanel = (props) => {
    const selectedFile = props.selectedFile || null;
    if (resolveBookType(selectedFile) === 'book') {
        return <BookDetailPanel {...props} />;
    }
    return <ComicDetailPanel {...props} />;
};

export { DetailPanel };
export default DetailPanel;
