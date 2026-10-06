import React, { useCallback, useEffect, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { resolveBookType } from '../../metadata/metadataTypes';
import { AudiobookDetailPanel } from './AudiobookDetailPanel';
import { BookDetailPanel } from './BookDetailPanel';
import { ComicDetailPanel } from './ComicDetailPanel';
import { PdfDetailPanel } from './PdfDetailPanel';
import { DetailCoverFrame, DetailFieldGroup, formatDate, useDetailContentHeight } from './detailPanelCommon';

const DirectoryDetailPanel = ({ selectedFile, onContentHeightChange, isActive = true, t }) => {
    const { contentRef, scrollRef } = useDetailContentHeight(selectedFile, onContentHeightChange);
    const [result, setResult] = useState(null);
    const [preview, setPreview] = useState(null);
    const [failedCover, setFailedCover] = useState('');
    const folderPath = selectedFile.full_path || selectedFile.path;
    const cover = selectedFile.cover || preview?.cover || '';
    const coverAvailable = Boolean(cover && cover !== failedCover);

    useEffect(() => {
        if (!isActive || !folderPath) return undefined;
        let disposed = false;
        const requestId = crypto.randomUUID();
        setResult(null);
        const timeout = window.setTimeout(async () => {
            try {
                const response = await window.electronAPI?.getFolderDetails?.(folderPath, requestId);
                if (!disposed && !response?.cancelled) setResult(response || { success: false });
            } catch {
                if (!disposed) setResult({ success: false });
            }
        }, 120);
        return () => {
            disposed = true;
            window.clearTimeout(timeout);
            window.electronAPI?.cancelFolderDetails?.(requestId)?.catch(() => {});
        };
    }, [folderPath, selectedFile.mtime, isActive]);

    useEffect(() => {
        if (!isActive || !folderPath || selectedFile.cover) return undefined;
        let disposed = false;
        const timeout = window.setTimeout(async () => {
            try {
                const response = await window.electronAPI?.getFilePreview?.(folderPath, { force: false });
                if (!disposed && response?.success) setPreview(response.file);
            } catch {
                // 표지를 읽지 못하면 폴더 아이콘을 유지한다.
            }
        }, 120);
        return () => {
            disposed = true;
            window.clearTimeout(timeout);
        };
    }, [folderPath, selectedFile.mtime, selectedFile.cover, isActive]);

    const details = result?.success ? result.details : null;
    const pendingValue = result ? '-' : t('folder.detail.loading');
    const count = value => Number(value || 0).toLocaleString();
    const pageCount = details
        ? details.unknownPageFileCount > 0
            ? t('folder.detail.partial_pages', [count(details.pageCount), count(details.unknownPageFileCount)])
            : count(details.pageCount)
        : pendingValue;
    const minutes = Math.ceil((details?.estimatedReadingSeconds || 0) / 60);
    const duration = minutes >= 60
        ? t('folder.detail.hours_minutes', [count(Math.floor(minutes / 60)), minutes % 60])
        : t('folder.detail.minutes', [minutes]);
    const readingTime = details
        ? details.unknownReadingTimeFileCount > 0
            ? t('folder.detail.partial_time', [duration, count(details.unknownReadingTimeFileCount)])
            : duration
        : pendingValue;
    const fields = [
        ['folder', t('org_folder_menu'), selectedFile.name],
        ['folderOpen', t('col_full_path'), selectedFile.full_path || selectedFile.path],
        ['file', t('folder.detail.file_count'), details ? count(details.fileCount) : pendingValue],
        ['folder', t('folder.detail.folder_count'), details ? count(details.folderCount) : pendingValue],
        ['fileLines', t('col_page_count'), pageCount],
        ['bookOpen', t('folder.detail.reading_time'), readingTime],
        ['calendar', t('col_ctime'), formatDate(selectedFile.created || selectedFile.ctime)],
        ['clock', t('col_mtime'), formatDate(selectedFile.modified || selectedFile.mtime)],
    ];

    return (
        <div className="folder-detail-panel directory-detail-panel">
            {coverAvailable && <div className="folder-detail-bg" style={{ backgroundImage: `url(${cover})` }} />}
            <div className="folder-detail-overlay" />
            <div className="folder-detail-scroll" ref={scrollRef}>
                <div className="folder-detail-content" ref={contentRef}>
                    <div className="detail-cover-section">
                        <DetailCoverFrame>
                            {coverAvailable ? (
                                <>
                                    <img src={cover} alt={selectedFile.name || ''} className="detail-cover-image" onError={() => setFailedCover(cover)} />
                                    <span className="folder-item-cover-badge"><FaIcon name="folder" size={18} title={t('folder_item_type')} /></span>
                                </>
                            ) : (
                                <div className="detail-cover-placeholder folder-item-artwork">
                                    <FaIcon name="folder" size={76} title={t('folder_item_type')} />
                                </div>
                            )}
                        </DetailCoverFrame>
                    </div>
                    <div className="detail-metadata-section">
                        <div className="detail-heading">
                            <div className="detail-series">{t('folder_item_type')}</div>
                            <div className="detail-title">{selectedFile.name || '-'}</div>
                        </div>
                        <DetailFieldGroup fields={fields} />
                        <p className="directory-detail-note">{t('folder.detail.scope')}</p>
                        <p className="directory-detail-note">{t('folder.detail.reading_basis', [details?.secondsPerPage || 20])}</p>
                        {details?.unknownPageFileCount > 0 && <p className="directory-detail-note">{t('folder.detail.missing_pages')}</p>}
                        {details?.unreadableFolderCount > 0 && <p className="directory-detail-note" role="status">{t('folder.detail.unreadable', [count(details.unreadableFolderCount)])}</p>}
                        {result?.success === false && <p className="directory-detail-note" role="status">{t('folder.detail.error')}</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailPanelContent = (props) => {
    const selectedFile = props.selectedFile || {};
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
};

const DetailPanelLayer = ({ id, outgoing, onExited, children }) => {
    useEffect(() => {
        if (!outgoing) return undefined;
        const timeout = window.setTimeout(() => onExited(id), 280);
        return () => window.clearTimeout(timeout);
    }, [id, onExited, outgoing]);

    return (
        <div
            className={`detail-panel-layer${outgoing ? ' is-outgoing' : ''}`}
            aria-hidden={outgoing ? true : undefined}
            inert={outgoing ? '' : undefined}
            onAnimationEnd={event => {
                if (outgoing && event.target === event.currentTarget && event.animationName === 'detail-panel-fade-out') {
                    onExited(id);
                }
            }}
        >
            {children}
        </div>
    );
};

const DetailPanel = React.memo((props) => {
    const selectedFile = props.selectedFile || null;
    const selectionKey = selectedFile
        ? `${selectedFile.isDirectory ? 'directory' : resolveBookType(selectedFile)}:${selectedFile.full_path || selectedFile.path || selectedFile.name}`
        : 'empty';
    const [panels, setPanels] = useState(() => [{ id: 0, selectionKey, selectedFile, onEditRating: props.onEditRating }]);
    const currentPanel = panels[0];

    if (currentPanel.selectionKey !== selectionKey) {
        setPanels([{ id: currentPanel.id + 1, selectionKey, selectedFile, onEditRating: props.onEditRating }, ...panels]);
    } else if (currentPanel.selectedFile !== selectedFile) {
        setPanels([{ ...currentPanel, selectedFile }, ...panels.slice(1)]);
    }

    const removePanel = useCallback(id => {
        setPanels(current => current.filter((panel, index) => index === 0 || panel.id !== id));
    }, []);

    return (
        <div className="detail-panel-transition">
            {panels.map((panel, index) => (
                <DetailPanelLayer key={panel.id} id={panel.id} outgoing={index > 0} onExited={removePanel}>
                    <DetailPanelContent
                        {...props}
                        selectedFile={panel.selectedFile}
                        isActive={index === 0}
                        onContentHeightChange={index === 0 ? props.onContentHeightChange : undefined}
                        onEditRating={index === 0 ? props.onEditRating : panel.onEditRating}
                    />
                </DetailPanelLayer>
            ))}
        </div>
    );
});

export { DetailPanel };
export default DetailPanel;
