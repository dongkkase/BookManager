import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { isFilePathDrag } from '../appShell';
import { FILE_TOOL_CATEGORIES, fileToolsByCategory, firstTextCleanerPath } from '../fileTools';
import '../styles/ToolsTab.css';

const TextCleanerTool = lazy(() => import('./TextCleanerTool'));
const EpubEditorTool = lazy(() => import('../features/fileTools/epubEditor/EpubEditorTool'));

function ToolItem({ tool, onOpenTab, onOpenTool, t }) {
    const isAvailable = tool.status === 'available';
    const statusKey = tool.status === 'next'
        ? 'tools.status.next'
        : isAvailable
            ? 'tools.status.available'
            : 'tools.status.planned';
    const className = [
        'file-tool-item',
        `is-${tool.status}`,
        isAvailable ? 'is-actionable' : '',
    ].filter(Boolean).join(' ');
    const content = (
        <>
            <span className={`file-tool-icon is-${tool.tone}`} aria-hidden="true">
                <FaIcon name={tool.icon} size={18} />
            </span>
            <span className="file-tool-name">{t(tool.labelKey)}</span>
            <span className={`file-tool-status is-${tool.status}`}>{t(statusKey)}</span>
        </>
    );

    if (isAvailable) {
        return (
            <button
                type="button"
                className={className}
                data-tool-id={tool.id}
                onClick={() => tool.target.type === 'tab'
                    ? onOpenTab(tool.target.tabId)
                    : onOpenTool(tool.target.toolId)}
            >
                {content}
                <FaIcon name="chevronRight" className="file-tool-arrow" size={11} />
            </button>
        );
    }

    return (
        <div
            className={className}
            data-tool-id={tool.id}
            aria-label={`${t(tool.labelKey)} · ${t(statusKey)}`}
        >
            {content}
        </div>
    );
}

export default function ToolsTab({ t, onOpenTab, showToast }) {
    const [activeToolId, setActiveToolId] = useState(null);
    const [openRequest, setOpenRequest] = useState(null);
    const beforeToolChange = useRef(null);
    const registerBeforeLeave = useCallback(handler => {
        beforeToolChange.current = handler;
        return () => { if (beforeToolChange.current === handler) beforeToolChange.current = null; };
    }, []);

    const openTextCleanerPath = useCallback(async filePath => {
        if (!filePath) return;
        if (beforeToolChange.current && !await beforeToolChange.current()) return;
        setActiveToolId('text-cleaner');
        setOpenRequest(current => ({ path: filePath, token: (current?.token || 0) + 1 }));
    }, []);

    const handleOpenTool = useCallback(toolId => {
        setOpenRequest(null);
        setActiveToolId(toolId);
    }, []);

    const handleBack = useCallback(() => {
        setOpenRequest(null);
        setActiveToolId(null);
    }, []);

    useEffect(() => {
        const handleAction = event => {
            const detail = event.detail;
            if (detail?.activeTab !== 'tools' || !['load-paths', 'drop-paths'].includes(detail.action)) return;
            if ((detail.toolId || activeToolId) !== 'text-cleaner') return;
            openTextCleanerPath(firstTextCleanerPath(detail.paths));
        };
        window.addEventListener('bookmanager:action', handleAction);
        window.dispatchEvent(new CustomEvent('bookmanager:tab-ready', { detail: { tabId: 'tools' } }));
        return () => window.removeEventListener('bookmanager:action', handleAction);
    }, [activeToolId, openTextCleanerPath]);

    const handleDragOver = useCallback(event => {
        if (!isFilePathDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'none';
    }, []);

    if (activeToolId === 'epub-editor') {
        return (
            <Suspense fallback={<div className="file-tools-loading">{t('tools.loading')}</div>}>
                <EpubEditorTool t={t} onBack={handleBack} showToast={showToast} registerBeforeLeave={registerBeforeLeave} />
            </Suspense>
        );
    }

    if (activeToolId === 'text-cleaner') {
        return (
            <FileToolDropArea t={t}>
                <Suspense fallback={<div className="file-tools-loading">{t('tools.loading')}</div>}>
                    <TextCleanerTool
                        t={t}
                        onBack={handleBack}
                        openRequest={openRequest}
                        showToast={showToast}
                    />
                </Suspense>
            </FileToolDropArea>
        );
    }

    return (
        <section
            className="file-tools-tab"
            aria-labelledby="file-tools-title"
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDrop={handleDragOver}
        >
            <div className="file-tools-scroll-area">
                <header className="file-tools-header">
                    <div>
                        <h1 id="file-tools-title">{t('tools.title')}</h1>
                        <p>{t('tools.description')}</p>
                    </div>
                    <div className="file-tools-legend" aria-label={t('tools.status_legend')}>
                        <span><i className="is-available" aria-hidden="true" />{t('tools.status.available')}</span>
                        <span><i className="is-next" aria-hidden="true" />{t('tools.status.next')}</span>
                        <span><i className="is-planned" aria-hidden="true" />{t('tools.status.planned')}</span>
                    </div>
                </header>

                <div className="file-tools-grid">
                    {FILE_TOOL_CATEGORIES.map(category => (
                        <section className="file-tools-category" key={category.id}>
                            <h2>{t(category.labelKey)}</h2>
                            <div className="file-tools-list">
                                {fileToolsByCategory(category.id).map(tool => (
                                    <ToolItem
                                        key={tool.id}
                                        tool={tool}
                                        onOpenTab={onOpenTab}
                                        onOpenTool={handleOpenTool}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </section>
    );
}

function FileToolDropArea({ t, children }) {
    const [dragHover, setDragHover] = useState(false);
    const dragDepthRef = useRef(0);
    const resetDragHover = useCallback(() => {
        dragDepthRef.current = 0;
        setDragHover(false);
    }, []);

    useEffect(() => {
        const events = ['dragend', 'drop', 'blur'];
        for (const event of events) window.addEventListener(event, resetDragHover);
        return () => {
            for (const event of events) window.removeEventListener(event, resetDragHover);
        };
    }, [resetDragHover]);

    return (
        <div
            className="file-tools-drop-area"
            onDragEnterCapture={event => {
                if (!isFilePathDrag(event.dataTransfer)) return;
                event.preventDefault();
                dragDepthRef.current += 1;
                setDragHover(true);
            }}
            onDragOverCapture={event => {
                if (!isFilePathDrag(event.dataTransfer)) return;
                event.preventDefault();
                dragDepthRef.current = Math.max(1, dragDepthRef.current);
                setDragHover(true);
            }}
            onDragLeaveCapture={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDragHover(false);
            }}
            onDropCapture={resetDragHover}
            onDragEndCapture={resetDragHover}
        >
            {children}
            {dragHover && (
                <div className="app-file-drop-hover" role="status" aria-live="polite">
                    <div className="app-file-drop-hover-card">
                        <FaIcon name="fileLines" size={32} />
                        <span>{t('tools.drop_text_file')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
