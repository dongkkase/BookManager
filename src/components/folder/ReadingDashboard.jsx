import React, { useMemo, useRef, useState } from 'react';
import { CoverArtwork } from '../CoverArtwork';
import { FaIcon } from '../FaIcon';
import { RecommendationShuffleOverlay } from './RecommendationShuffleOverlay';
import { RecommendationPreferences } from './RecommendationPreferences';
import { DashboardReadingInsights } from './DashboardReadingInsights';
import { DashboardFinishedShelf, DashboardPassage } from './DashboardReadingShelves';
import { DashboardLibraryOnboarding } from './DashboardLibraryOnboarding';
import { useDailyRecommendation } from '../../hooks/useDailyRecommendation';
import { useDashboardActivity } from '../../hooks/useDashboardActivity';
import { dashboardMonth } from '../../dashboardActivityState';
import { dashboardAddedTimestamp, dashboardFilePath, selectDashboardRecent, summarizeDashboardCatalog } from '../../readingDashboardState';
import { viewerReadingProgressParts } from '../../viewerStatusState';
import '../../styles/ReadingDashboard.css';

function bookTitle(file) {
    return file.title || file.name || dashboardFilePath(file).split(/[\\/]/).pop();
}

function bookAuthor(file) {
    const value = file.writer || file.author || file.creators || '';
    return Array.isArray(value) ? value.join(', ') : String(value);
}

function BookCover({ file }) {
    return <span className="reading-dashboard-cover" aria-hidden="true">
        <CoverArtwork src={file.cover} alt="" fallbackAlt="" isDirectory={false} />
    </span>;
}

function ContinueBook({ file, onOpenFile, t }) {
    const status = file.viewerStatus || {};
    const progress = viewerReadingProgressParts(status);
    const positionText = status.isAudio || status.pageCount > 0 || status.pageIndex > 0 ? progress.pageText : '';
    const percent = Number.isFinite(Number(status.percent)) ? Math.max(0, Math.min(100, Number(status.percent))) : 0;
    return <button type="button" className="reading-dashboard-continue-book" onClick={() => onOpenFile?.(file)}>
        <BookCover file={file} />
        <span className="reading-dashboard-book-copy">
            <span className="reading-dashboard-book-format">{String(file.ext || '').replace(/^\./, '').toUpperCase()}</span>
            <strong className="reading-dashboard-book-title" title={bookTitle(file)}>{bookTitle(file)}</strong>
            {bookAuthor(file) && <span className="reading-dashboard-book-author" title={bookAuthor(file)}>{bookAuthor(file)}</span>}
            <span className="reading-dashboard-reading-state">
                {t(status.isCompleted ? 'reading_lists.status_completed' : status.hasReadingProgress ? 'reading_lists.status_reading' : 'reading_lists.dashboard_open_book')}
                {progress.percentText && <span>{progress.percentText}</span>}
            </span>
            {status.hasReadingProgress && <span className="reading-dashboard-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
            {positionText && <span className="reading-dashboard-page-position">{positionText}</span>}
        </span>
        <span className="reading-dashboard-book-open" aria-hidden="true"><FaIcon name="angleRight" /></span>
    </button>;
}

function DailyRecommendation({ recommendation, files, libraries, onOpenFile, t }) {
    const { file, loading, error, refresh } = recommendation;
    const [shuffleOpen, setShuffleOpen] = useState(false);
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const preferencesButtonRef = useRef(null);
    const shuffleButtonRef = useRef(null);
    const recommendationCoverRef = useRef(null);
    const lastShuffleOriginRef = useRef(null);
    const canOpen = Boolean(file) && !loading && !error;
    const description = [file, file?.metadata, file?.full_meta].flatMap(source => (
        ['description', 'summary', 'Summary', 'Description'].map(key => source?.[key])
    )).find(value => typeof value === 'string' && value.trim())?.trim() || '';
    const openBook = () => onOpenFile?.(file);
    return <><section className="reading-dashboard-recommendation" aria-busy={loading}
        aria-label={t('reading_lists.dashboard_recommendation')} data-file-path={canOpen ? dashboardFilePath(file) : undefined}>
        <div className="reading-dashboard-recommendation-copy">
            <div className="reading-dashboard-recommendation-heading"><span className="reading-dashboard-recommendation-label">{t('reading_lists.dashboard_recommendation')}</span>
                <button type="button" ref={preferencesButtonRef} className="reading-dashboard-preferences-button" disabled={shuffleOpen || recommendation.newRecommendationLoading}
                    onClick={() => setPreferencesOpen(true)}><FaIcon name="sliders" size={11} />{t('recommendation_preferences.title')}</button>
            </div>
            {canOpen ? <>
                <strong className="reading-dashboard-book-title" title={bookTitle(file)}>{bookTitle(file)}</strong>
                <span className="reading-dashboard-book-author" title={bookAuthor(file)}>{bookAuthor(file) || String(file.ext || '').replace(/^\./, '').toUpperCase()}</span>
                {description ? <p className="reading-dashboard-recommendation-description">{description}</p>
                    : <p className="reading-dashboard-recommendation-hint">{t('reading_lists.dashboard_recommendation_hint')}</p>}
                <div className="reading-dashboard-recommendation-actions">
                    <button type="button" className="reading-dashboard-recommendation-read" onClick={openBook}
                        aria-label={`${t('reading_lists.dashboard_read')}: ${bookTitle(file)}`}>
                        <FaIcon name="bookOpen" size={12} />{t('reading_lists.dashboard_read')}<FaIcon name="angleRight" size={11} />
                    </button>
                    <button type="button" ref={shuffleButtonRef} className="reading-dashboard-recommendation-shuffle" onClick={() => setShuffleOpen(true)}
                        disabled={shuffleOpen || recommendation.newRecommendationLoading}>
                        <FaIcon name="shuffle" size={12} />{t('reading_lists.dashboard_new_recommendation')}
                    </button>
                </div>
            </> : <>
                <span className="reading-dashboard-recommendation-message" role={loading ? 'status' : error ? 'alert' : undefined}>
                    {t(loading ? 'reading_lists.dashboard_recommendation_loading' : error ? 'reading_lists.dashboard_recommendation_failed' : 'reading_lists.dashboard_recommendation_empty')}
                </span>
                {error && !loading && <button type="button" className="reading-dashboard-link" onClick={refresh}>{t('reading_lists.dashboard_retry')}</button>}
            </>}
        </div>
        {canOpen ? <button type="button" ref={recommendationCoverRef} className="reading-dashboard-recommendation-cover" onClick={openBook}
            aria-label={`${t('reading_lists.dashboard_open_book')}: ${bookTitle(file)}`}><BookCover file={file} /></button>
            : <span className="reading-dashboard-recommendation-placeholder" aria-hidden="true"><FaIcon name="bookOpen" size={38} /></span>}
    </section>
        {preferencesOpen && <RecommendationPreferences preferences={recommendation.preferences} options={recommendation.preferenceOptions} libraries={libraries} currentFile={file}
            onApply={next => { recommendation.updatePreferences(next); setPreferencesOpen(false); }} onClose={() => setPreferencesOpen(false)} returnFocusElement={preferencesButtonRef.current} t={t} />}
        {shuffleOpen && <RecommendationShuffleOverlay files={files} currentFile={file} t={t}
            returnFocusElement={shuffleButtonRef.current} destinationRef={recommendationCoverRef} lastOriginRef={lastShuffleOriginRef}
            prepare={recommendation.prepareNewRecommendation} commit={recommendation.commitNewRecommendation}
            cancel={recommendation.cancelNewRecommendation} onClose={() => setShuffleOpen(false)} />}
    </>;
}

export function ReadingDashboard({
    t, language = 'ko', files = [], recentFiles = [], libraries = [], collections = [], wishlistCount = 0, recentAddedCount = 0,
    recentLoading = false, recentError = '',
    annotationCatalog, onRefreshAnnotations,
    onOpenFile, onNavigate, onOpenLibrarySettings, onRefreshRecent,
}) {
    const catalog = useMemo(() => summarizeDashboardCatalog(files, 4), [files]);
    const continueBooks = useMemo(() => selectDashboardRecent(recentFiles), [recentFiles]);
    const recommendation = useDailyRecommendation(files);
    const [month, setMonth] = useState(() => dashboardMonth());
    const activity = useDashboardActivity(month, JSON.stringify(libraries.map(library => library.path || library)));
    const locale = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'ko-KR';
    const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
    const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }), [locale]);
    const countText = value => numberFormat.format(Math.max(0, Number(value) || 0));
    const navigate = kind => () => onNavigate?.(kind);
    const summaries = [
        { key: 'books', icon: 'book', label: t('reading_lists.dashboard_books'), value: catalog.bookCount },
        { key: 'recent-added', icon: 'clock', label: t('reading_lists.recent_added'), value: recentAddedCount, action: navigate('recent-added') },
        { key: 'collections', icon: 'layers', label: t('reading_lists.collections'), value: collections.length, action: navigate('collections') },
        { key: 'wishlist', icon: 'bookmark', label: t('reading_lists.wishlist'), value: wishlistCount, action: navigate('wishlist') },
    ];
    return <div className={`reading-dashboard${libraries.length === 0 ? ' is-setup' : ''}`}>
        <div className="reading-dashboard-inner">
            <header className="reading-dashboard-header">
                <div className="reading-dashboard-heading">
                    <span className="reading-dashboard-heading-mark" aria-hidden="true"><FaIcon name="bookOpen" size={23} /></span>
                    <div><h1>{t('reading_lists.dashboard')}</h1>
                        <p>{t(libraries.length ? 'reading_lists.dashboard_description' : 'reading_lists.dashboard_setup_description')}</p></div>
                </div>
            </header>

            {libraries.length === 0 ? <DashboardLibraryOnboarding t={t} onOpenLibrarySettings={onOpenLibrarySettings} /> : <>
            <div className="reading-dashboard-summary" aria-label={t('reading_lists.dashboard_overview')}>
                <DailyRecommendation recommendation={recommendation} files={files} libraries={libraries} onOpenFile={onOpenFile} t={t} />
                <div className="reading-dashboard-stats">{summaries.map(item => {
                    const Element = item.action ? 'button' : 'div';
                    return <Element key={item.key} className="reading-dashboard-stat" data-stat={item.key} {...(item.action ? { type: 'button', onClick: item.action } : {})}>
                        <span className="reading-dashboard-stat-top"><span className="reading-dashboard-stat-icon"><FaIcon name={item.icon} /></span><span>{item.label}</span></span>
                        <strong>{countText(item.value)}</strong>
                        {item.action && <FaIcon className="reading-dashboard-stat-arrow" name="angleRight" size={11} />}
                    </Element>;
                })}</div>
            </div>

            {catalog.bookCount === 0 && <section className="reading-dashboard-welcome">
                <span className="reading-dashboard-welcome-icon"><FaIcon name="bookOpen" size={23} /></span>
                <div><h2>{t('reading_lists.dashboard_empty_title')}</h2><p>{t('reading_lists.dashboard_empty_library')}</p></div>
                <button type="button" className="reading-dashboard-settings" onClick={onOpenLibrarySettings}>
                    {t('reading_lists.dashboard_library_settings')}<FaIcon name="angleRight" />
                </button>
            </section>}

            <div className="reading-dashboard-main">
                <div className="reading-dashboard-reading-row">
                    <section className="reading-dashboard-section reading-dashboard-continue-section">
                        <div className="reading-dashboard-section-heading">
                            <div><h2>{t('reading_lists.dashboard_continue')}</h2><p>{t('reading_lists.dashboard_continue_hint')}</p></div>
                            <button type="button" className="reading-dashboard-link" onClick={navigate('recent-reading')}>{t('reading_lists.dashboard_view_all')}<FaIcon name="angleRight" /></button>
                        </div>
                        {recentError ? <div className="reading-dashboard-empty" role="alert">
                            <FaIcon name="info" size={20} /><span>{t('reading_lists.dashboard_recent_failed')}</span>
                            <button type="button" className="reading-dashboard-link" onClick={onRefreshRecent} disabled={recentLoading}>{t('reading_lists.dashboard_retry')}</button>
                        </div> : recentLoading && continueBooks.length === 0 ? <div className="reading-dashboard-empty" role="status"><FaIcon name="clock" size={20} /><span>{t('folder.recent.loading')}</span></div>
                            : continueBooks.length > 0 ? <div className="reading-dashboard-continue" aria-busy={recentLoading}>{continueBooks.map(file => <ContinueBook key={dashboardFilePath(file)} file={file} onOpenFile={onOpenFile} t={t} />)}</div>
                                : <div className="reading-dashboard-empty"><FaIcon name="bookOpen" size={22} /><strong>{t('reading_lists.dashboard_recent_empty')}</strong><span>{t('reading_lists.dashboard_recent_empty_hint')}</span></div>}
                    </section>
                    <DashboardPassage catalog={annotationCatalog} onOpenFile={onOpenFile} onNavigate={onNavigate} onRefresh={onRefreshAnnotations} t={t} />
                </div>

                <div className={`reading-dashboard-library-row${catalog.latest.length ? '' : ' is-empty'}`}>
                    <DashboardFinishedShelf activity={activity} onOpenFile={onOpenFile} t={t} />
                    {catalog.latest.length > 0 && <section className="reading-dashboard-section reading-dashboard-latest-section">
                        <div className="reading-dashboard-section-heading">
                            <div><h2>{t('reading_lists.dashboard_latest')}</h2><p>{t('reading_lists.dashboard_latest_hint')}</p></div>
                            <button type="button" className="reading-dashboard-link" onClick={navigate('recent-added')}>{t('reading_lists.recent_added')}<FaIcon name="angleRight" /></button>
                        </div>
                        <div className="reading-dashboard-latest">
                            {catalog.latest.map(file => <button type="button" className="reading-dashboard-latest-book" key={dashboardFilePath(file)} onClick={() => onOpenFile?.(file)}>
                                <BookCover file={file} />
                                <span className="reading-dashboard-latest-copy">
                                    <span className="reading-dashboard-book-format">{String(file.ext || '').replace(/^\./, '').toUpperCase()}</span>
                                    <strong className="reading-dashboard-book-title" title={bookTitle(file)}>{bookTitle(file)}</strong>
                                    {bookAuthor(file) && <span className="reading-dashboard-book-author" title={bookAuthor(file)}>{bookAuthor(file)}</span>}
                                    <span className="reading-dashboard-book-date">{dashboardAddedTimestamp(file) ? dateFormat.format(dashboardAddedTimestamp(file)) : t('reading_lists.dashboard_date_unknown')}</span>
                                </span>
                                <span className="reading-dashboard-book-open" aria-hidden="true"><FaIcon name="angleRight" /></span>
                            </button>)}
                        </div>
                    </section>}
                </div>

                <DashboardReadingInsights activity={activity} month={month} onMonthChange={setMonth} files={files} language={language} t={t} onOpenFile={onOpenFile} />
            </div>
            <div className="reading-dashboard-library-note"><FaIcon name="folderOpen" /><p>{t('reading_lists.dashboard_scope_hint')}</p></div>
            </>}
        </div>
    </div>;
}
