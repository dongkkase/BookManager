import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CoverArtwork } from '../CoverArtwork';
import { FaIcon } from '../FaIcon';
import { dailyPassage, dashboardDate } from '../../dashboardActivityState';
import '../../styles/DashboardKeepsakes.css';

const EMPTY_CATALOG = { entries: [], errors: [] };

export function DashboardPassage({ catalog = EMPTY_CATALOG, onOpenFile, onNavigate, onRefresh, t }) {
    const [chosenId, setChosenId] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [copyState, setCopyState] = useState('');
    const [overflowing, setOverflowing] = useState(false);
    const passageRef = useRef(null);
    const entryIdRef = useRef(null);
    const day = dashboardDate();
    const daily = useMemo(() => dailyPassage(catalog.entries, day), [catalog.entries, day]);
    const entry = catalog.entries.find(item => item.id === chosenId) || daily;
    entryIdRef.current = entry?.id;
    useEffect(() => { setExpanded(false); setCopyState(''); }, [entry?.id]);
    useLayoutEffect(() => {
        const element = passageRef.current;
        if (!element || expanded) return undefined;
        const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [entry?.text, expanded]);
    const next = () => {
        const index = catalog.entries.findIndex(item => item.id === entry?.id);
        setChosenId(catalog.entries[(index + 1) % catalog.entries.length]?.id || null);
        setExpanded(false);
        setCopyState('');
    };
    const copy = async () => {
        const id = entry.id;
        try { await navigator.clipboard.writeText(entry.text); if (entryIdRef.current === id) setCopyState('copied'); }
        catch { if (entryIdRef.current === id) setCopyState('copy_failed'); }
    };
    return <section className="reading-dashboard-section dashboard-passage">
        <div className="reading-dashboard-section-heading"><div><h2>{t('dashboard.passages')}</h2><p>{t('dashboard.passages_hint')}</p></div>
            <button type="button" className="reading-dashboard-link" onClick={() => onNavigate?.('annotations')}>{t('dashboard.all_passages')}<FaIcon name="angleRight" /></button>
        </div>
        {catalog.errors.length > 0 && <div className="dashboard-inline-error" role="status">{t('dashboard.passage_failed')}<button type="button" className="reading-dashboard-link" onClick={onRefresh}>{t('dashboard.retry')}</button></div>}
        {entry ? <div className="dashboard-passage-card">
            <span className="dashboard-passage-bookmark" aria-hidden="true" />
            <div className="dashboard-passage-text">
                <span className="dashboard-quote-mark" aria-hidden="true">“</span>
                <blockquote ref={passageRef} className={expanded ? 'is-expanded' : ''}>{entry.text}</blockquote>
                {(expanded || overflowing) && <button type="button" className="reading-dashboard-link dashboard-passage-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'dashboard.collapse' : 'dashboard.expand')}</button>}
            </div>
            <div className="dashboard-passage-footer">
                <button type="button" className="dashboard-passage-book" onClick={() => onOpenFile?.(entry.file)} aria-label={`${t('dashboard.open_book')}: ${entry.title}`}>
                    <span className="reading-dashboard-cover"><CoverArtwork src={entry.file.cover} alt="" fallbackAlt="" /></span>
                    <span><strong>{entry.title}</strong><small>{entry.author}</small></span>
                    <FaIcon name="angleRight" />
                </button>
                <div className="dashboard-passage-actions">
                    <button type="button" className="reading-dashboard-link" onClick={copy}><FaIcon name={copyState === 'copied' ? 'check' : 'copy'} />{t(copyState === 'copied' ? 'dashboard.copied' : 'dashboard.copy')}</button>
                    <button type="button" className="reading-dashboard-link" disabled={catalog.entries.length < 2} onClick={next}><FaIcon name="shuffle" />{t('dashboard.next_passage')}</button>
                </div>
            </div>
            {copyState === 'copy_failed' && <p className="dashboard-passage-copy-error" role="status">{t('dashboard.copy_failed')}</p>}
        </div> : <div className="reading-dashboard-empty dashboard-keepsake-empty"><span className="dashboard-quote-mark" aria-hidden="true">“</span><strong>{t('dashboard.passage_empty')}</strong><span>{t('dashboard.passage_empty_hint')}</span></div>}
    </section>;
}

export function DashboardFinishedShelf({ activity, onOpenFile, t }) {
    const [page, setPage] = useState(0);
    const [columns, setColumns] = useState(3);
    const shelfRef = useRef(null);
    const { data, loading, error, refresh } = activity;
    const files = data?.completedFiles || [];
    const pageSize = Math.min(12, columns * 2);
    const maxPage = Math.max(0, Math.ceil(files.length / pageSize) - 1);
    const visiblePage = Math.min(page, maxPage);
    useLayoutEffect(() => {
        const element = shelfRef.current;
        if (!element) return undefined;
        const measure = () => {
            const template = window.getComputedStyle(element).gridTemplateColumns;
            if (!template || template === 'none') return;
            setColumns(template.trim().split(/\s+/).length);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [files.length]);
    useEffect(() => { setPage(value => Math.min(value, maxPage)); }, [maxPage]);
    return <section className="reading-dashboard-section dashboard-finished" aria-busy={loading}>
        <div className="reading-dashboard-section-heading"><div><h2>{t('dashboard.finished_shelf')}<span className="dashboard-shelf-count">{t('dashboard.book_count', [data?.completedCount || 0])}</span></h2><p>{t('dashboard.shelf_hint')}</p></div>
            {maxPage > 0 && <div className="dashboard-shelf-navigation"><button type="button" aria-label={t('dashboard.previous_books')} disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}><FaIcon name="angleLeft" /></button><button type="button" aria-label={t('dashboard.next_books')} disabled={visiblePage >= maxPage} onClick={() => setPage(visiblePage + 1)}><FaIcon name="angleRight" /></button></div>}
        </div>
        {error && !data ? <div className="reading-dashboard-empty" role="status"><span>{t('dashboard.shelf_failed')}</span><button type="button" className="reading-dashboard-link" onClick={refresh}>{t('dashboard.retry')}</button></div>
            : !data && loading ? <div className="reading-dashboard-empty" role="status">{t('dashboard.loading')}</div>
                : files.length ? <><div className="dashboard-finished-books" ref={shelfRef}>{files.slice(visiblePage * pageSize, visiblePage * pageSize + pageSize).map(file => <button type="button" className="dashboard-finished-book" key={file.full_path || file.path} onClick={() => onOpenFile?.(file)} title={file.title || file.name}>
                    <span className="dashboard-finished-cover">
                        <span className="reading-dashboard-cover"><CoverArtwork src={file.cover} alt="" fallbackAlt="" /></span>
                    </span>
                    <span className="dashboard-finished-book-copy"><strong className="reading-dashboard-book-title">{file.title || file.name}</strong></span>
                </button>)}</div><p className="dashboard-journal-muted">{t('dashboard.shelf_recent', [files.length])}</p></>
                    : <div className="reading-dashboard-empty dashboard-keepsake-empty"><FaIcon name="bookOpen" /><strong>{t('dashboard.shelf_empty')}</strong><span>{t('dashboard.shelf_empty_hint')}</span></div>}
    </section>;
}
