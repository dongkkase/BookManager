import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ToolbarSelect } from './ToolbarDropdown';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { HIGHLIGHT_COLORS } from '../../highlightColors.js';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
    filterAnnotations,
    groupAnnotationsByBook,
    groupAnnotationsByMonth,
    summarizeAnnotations,
} from '../../annotationCatalog';
import '../../styles/AnnotationsBrowser.css';

const LABELS = {
    ko: {
        title: '주석',
        marks: '개의 주석', books: '권의 도서', newest: '최신순', oldest: '오래된순', sort: '주석 정렬',
        reset: '필터 초기화', all: '전체', unknownDate: '날짜 정보 없음', page: '페이지', open: '도서 열기',
        overview: '주석 통계', library: '등록된 라이브러리 전체', months: '최근 12개월', colors: '색상', shelf: '주석을 남긴 도서',
        yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍', purple: '보라', underline: '밑줄', strikethrough: '취소선',
        orange: '주황', red: '빨강', olive: '올리브', cyan: '청록', gray: '회색',
        empty: '기억하고 싶은 문장을 모아보세요', emptyHint: '텍스트·EPUB 뷰어에서 문장을 선택하고 하이라이트·밑줄·취소선을 남기면 이곳에 표시됩니다.',
        noResults: '조건에 맞는 주석이 없습니다', noResultsHint: '상단 검색어나 색상·도서 필터를 바꿔보세요.',
        unavailable: '일부 도서의 주석을 읽지 못했습니다. 저장된 주석은 변경하지 않았습니다.',
        retry: '다시 읽기', more: '주석 더 보기', moreBooks: '도서 더 보기', shown: '전체', noCover: '표지 없음',
        summaryTitle: '통계 및 필터', highlight: '하이라이트', filteredBook: '도서 필터', filteredColor: '색상 필터',
        grouping: '주석 묶기', byDate: '날짜별', byBook: '도서별', compact: '간결하게 보기', styles: '표시 방식', viewOptions: '주석 보기 설정',
        copy: '문장 복사', copiedAction: '복사됨', copyFailed: '복사하지 못했습니다. 문장을 선택해 복사해 주세요.',
        delete: '주석 삭제', deleteFailed: '주석을 삭제하지 못했습니다. 다시 시도해 주세요.',
        expand: '문장 펼치기', collapse: '문장 접기',
        shelfSearch: '주석 도서 검색', noBooks: '검색한 도서가 없습니다.', filteredMonth: '기간 필터',
    },
    en: {
        title: 'Annotations',
        marks: ' annotations', books: ' books', newest: 'Newest first', oldest: 'Oldest first', sort: 'Sort annotations',
        reset: 'Reset filters', all: 'All', unknownDate: 'Date unavailable', page: 'Page', open: 'Open book',
        overview: 'Annotation overview', library: 'All registered libraries', months: 'Last 12 months', colors: 'Colour', shelf: 'Books with annotations',
        yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', purple: 'Purple', underline: 'Underline', strikethrough: 'Strikethrough',
        orange: 'Orange', red: 'Red', olive: 'Olive', cyan: 'Cyan', gray: 'Gray',
        empty: 'Keep the passages that stay with you', emptyHint: 'Select text in the text or EPUB reader and add a highlight, underline, or strikethrough to see it here.',
        noResults: 'No matching annotations', noResultsHint: 'Change your search, colour, or book filter.',
        unavailable: 'Annotations for some books could not be read. Your saved annotations have not been changed.',
        retry: 'Reload', more: 'Show more annotations', moreBooks: 'Show more books', shown: 'of', noCover: 'No cover',
        summaryTitle: 'Overview and filters', highlight: 'Highlight', filteredBook: 'Book filter', filteredColor: 'Colour filter',
        grouping: 'Group annotations', byDate: 'By date', byBook: 'By book', compact: 'Compact view', styles: 'Style', viewOptions: 'Annotation view options',
        copy: 'Copy passage', copiedAction: 'Copied', copyFailed: 'Could not copy. Select the passage to copy it manually.',
        delete: 'Delete annotation', deleteFailed: 'Could not delete the annotation. Please try again.',
        expand: 'Expand passage', collapse: 'Collapse passage',
        shelfSearch: 'Search annotated books', noBooks: 'No matching books.', filteredMonth: 'Month filter',
    },
    ja: {
        title: '注釈',
        marks: '件の注釈', books: '冊の本', newest: '新しい順', oldest: '古い順', sort: '注釈の並び順',
        reset: 'フィルターをリセット', all: 'すべて', unknownDate: '日付情報なし', page: 'ページ', open: '本を開く',
        overview: '注釈の統計', library: '登録されたライブラリ全体', months: '過去12か月', colors: '色', shelf: '注釈のある本',
        yellow: '黄', green: '緑', blue: '青', pink: 'ピンク', purple: '紫', underline: '下線', strikethrough: '取り消し線',
        orange: 'オレンジ', red: '赤', olive: 'オリーブ', cyan: 'シアン', gray: 'グレー',
        empty: '心に残る文章を集めましょう', emptyHint: 'テキスト・EPUBビューアで文章を選択し、ハイライト・下線・取り消し線を付けると、ここに表示されます。',
        noResults: '条件に一致する注釈はありません', noResultsHint: '上部の検索語や色・本のフィルターを変更してください。',
        unavailable: '一部の本の注釈を読み込めませんでした。保存された注釈は変更していません。',
        retry: '再読み込み', more: '注釈をさらに表示', moreBooks: '本をさらに表示', shown: '全', noCover: '表紙なし',
        summaryTitle: '統計とフィルター', highlight: 'ハイライト', filteredBook: '本のフィルター', filteredColor: '色のフィルター',
        grouping: '注釈のグループ化', byDate: '日付別', byBook: '本別', compact: 'コンパクト表示', styles: '表示形式', viewOptions: '注釈の表示設定',
        copy: '文章をコピー', copiedAction: 'コピー済み', copyFailed: 'コピーできませんでした。文章を選択してコピーしてください。',
        delete: '注釈を削除', deleteFailed: '注釈を削除できませんでした。もう一度お試しください。',
        expand: '文章を展開', collapse: '文章を折りたたむ',
        shelfSearch: '注釈のある本を検索', noBooks: '一致する本はありません。', filteredMonth: '月のフィルター',
    },
};

const EMPTY_CATALOG = { entries: [], errors: [] };
const PAGE_SIZE = 100;
const ANNOTATION_COLOR_VARIABLES = Object.fromEntries(HIGHLIGHT_COLORS.map(color => [`--annotation-${color.id}`, color.hex]));

function annotationDayKey(timestamp) {
    return timestamp === null ? null : new Date(timestamp).toDateString();
}

function AnnotationEntry({ entry, compact, showBook, showDate, labels, locale, dayFormatter, onOpenFile, onCopy, onDelete, copied, hasHover, reducedMotion }) {
    const date = entry.timestamp === null ? null : new Date(entry.timestamp);
    const dateLabel = showDate ? date?.toLocaleString(locale) : undefined;
    const quoteRef = useRef(null);
    const [expanded, setExpanded] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const showActions = !hasHover || hovered || focused;
    useEffect(() => {
        if (!compact || expanded) return undefined;
        const quote = quoteRef.current;
        const measure = () => setTruncated(quote.scrollHeight > quote.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(quote);
        return () => observer.disconnect();
    }, [compact, expanded, entry.text]);
    useEffect(() => { if (!compact) setExpanded(false); }, [compact]);
    return <article
        className={`annotation-entry is-${entry.color}${showBook ? '' : ' is-book-group'}${expanded ? ' is-expanded' : ''}`}
        onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
        {!showDate ? <div className="annotation-date is-repeated" aria-hidden="true" /> : date ? <time className="annotation-date" dateTime={date.toISOString()} title={dateLabel} aria-label={dateLabel}>
            <span className="annotation-date-day">{dayFormatter.format(date)}</span>
            <span className="annotation-date-year">{date.getFullYear()}</span>
        </time> : <div className="annotation-date is-unknown">{labels.unknownDate}</div>}
        <motion.div className="annotation-card" initial={false} animate={{ backgroundColor: hovered || focused ? 'var(--panel-bg-2)' : 'var(--panel-bg)' }} transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}>
            <div className="annotation-entry-header">
                {showBook && <div className="annotation-book-heading">
                    <button type="button" className="annotation-book-link" onClick={() => onOpenFile?.(entry.file)} title={`${labels.open}: ${entry.title}`} disabled={!onOpenFile}>
                        <CoverImage file={entry.file} src={entry.file.cover} className="annotation-mini-cover" alt="" t={() => labels.noCover} showLoadingIndicator={false} />
                        <span><strong>{entry.title}</strong>{entry.author && <small>{entry.author}</small>}</span>
                    </button>
                </div>}
                <motion.div className="annotation-entry-actions" initial={false} animate={{ opacity: showActions ? 1 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }} style={{ pointerEvents: showActions ? 'auto' : 'none' }}>
                    <button type="button" className={`annotation-copy${copied ? ' is-copied' : ''}`} onClick={() => onCopy(entry)} data-tooltip={copied ? labels.copiedAction : labels.copy} aria-label={copied ? labels.copiedAction : labels.copy}>
                        <FaIcon name={copied ? 'check' : 'copy'} size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className="annotation-open" onClick={() => onOpenFile?.(entry.file)} data-tooltip={labels.open} aria-label={labels.open} disabled={!onOpenFile}>
                        <FaIcon name="bookOpen" size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className="annotation-delete" onClick={() => onDelete?.(entry)} data-tooltip={labels.delete} aria-label={labels.delete} disabled={!onDelete}>
                        <FaIcon name="trash" size={13} aria-hidden="true" />
                    </button>
                </motion.div>
                <span className="annotation-action-status" aria-live="polite">{copied ? labels.copiedAction : ''}</span>
            </div>
            <blockquote ref={quoteRef}>{entry.text}</blockquote>
            {compact && (truncated || expanded) && <button type="button" className="annotation-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
                {expanded ? labels.collapse : labels.expand}
            </button>}
            <div className="annotation-card-footer">
                <div className="annotation-entry-meta">
                    <span><i className={`annotation-color is-${entry.color}`} aria-hidden="true">{entry.color === 'strikethrough' && <FaIcon name="strikethrough" size={11} />}</i>{labels[entry.color]}</span>
                    {entry.pageIndex !== null && <span className="annotation-page">{labels.page} {(entry.pageIndex + 1).toLocaleString(locale)}</span>}
                </div>
            </div>
        </motion.div>
    </article>;
}

export default function AnnotationsBrowser({ catalog = EMPTY_CATALOG, onRefresh, onDelete, query = '', language = 'ko', onOpenFile, toolbarTarget }) {
    const labels = LABELS[language] || LABELS.ko;
    const locale = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'ko-KR';
    const scrollRef = useRef(null);
    const feedRef = useRef(null);
    const sentinelRef = useRef(null);
    const copyRequestRef = useRef(0);
    const reducedMotion = useReducedMotion();
    const [hasHover, setHasHover] = useState(() => window.matchMedia('(hover: hover)').matches);
    const [color, setColor] = useState('');
    const [bookPath, setBookPath] = useState('');
    const [sort, setSort] = useState('newest');
    const [groupBy, setGroupBy] = useState('date');
    const [style, setStyle] = useState('');
    const [monthKey, setMonthKey] = useState('');
    const [compact, setCompact] = useState(false);
    const [bookQuery, setBookQuery] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [bookLimit, setBookLimit] = useState(8);
    const summary = useMemo(() => summarizeAnnotations(catalog.entries), [catalog.entries]);
    const filtered = useMemo(() => filterAnnotations(catalog.entries, { query, color, bookPath, style, month: monthKey, sort }), [catalog.entries, query, color, bookPath, style, monthKey, sort]);
    const groups = useMemo(() => groupBy === 'book' ? groupAnnotationsByBook(filtered, locale) : groupAnnotationsByMonth(filtered), [filtered, groupBy, locale]);
    const visibleGroups = useMemo(() => {
        let remaining = limit;
        const visible = [];
        for (const group of groups) {
            if (remaining <= 0) break;
            visible.push({ ...group, total: group.entries.length, entries: group.entries.slice(0, remaining) });
            remaining -= group.entries.length;
        }
        return visible;
    }, [groups, limit]);
    const shelfBooks = useMemo(() => {
        const words = bookQuery.normalize('NFKC').toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
        return summary.books.filter(book => {
            const content = `${book.title} ${book.author}`.normalize('NFKC').toLocaleLowerCase(locale);
            return words.every(word => content.includes(word));
        });
    }, [summary.books, bookQuery, locale]);
    const selectedBook = summary.books.find(book => book.path === bookPath);
    const monthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }), [locale]);
    const shortMonthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { year: '2-digit', month: 'short' }), [locale]);
    const dayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }), [locale]);
    const maxMonth = Math.max(1, ...summary.months.map(month => month.count));
    const selectedMonth = summary.months.find(month => month.key === monthKey);
    const number = value => value.toLocaleString(locale);
    const coverLabel = () => labels.noCover;
    useEffect(() => {
        const media = window.matchMedia('(hover: hover)');
        const updateHover = () => setHasHover(media.matches);
        updateHover();
        media.addEventListener('change', updateHover);
        return () => media.removeEventListener('change', updateHover);
    }, []);
    useEffect(() => {
        setLimit(PAGE_SIZE);
        scrollRef.current?.scrollTo({ top: 0 });
        feedRef.current?.scrollTo({ top: 0 });
    }, [query, color, bookPath, style, monthKey, sort, groupBy]);
    useEffect(() => { setBookLimit(8); }, [bookQuery]);
    useEffect(() => {
        if (limit >= filtered.length || !sentinelRef.current) return undefined;
        const layout = scrollRef.current;
        const feed = feedRef.current;
        let observer;
        let root;
        let queued = false;
        const loadMore = () => {
            if (queued) return;
            queued = true;
            setLimit(value => Math.min(value + PAGE_SIZE, filtered.length));
        };
        const observe = () => {
            const nextRoot = getComputedStyle(feed).overflowY === 'auto' ? feed : layout;
            if (root === nextRoot) return;
            root = nextRoot;
            observer?.disconnect();
            observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) loadMore();
            }, { root, rootMargin: '0px 0px 240px 0px' });
            observer.observe(sentinelRef.current);
        };
        observe();
        const resize = new ResizeObserver(observe);
        resize.observe(layout);
        return () => { observer?.disconnect(); resize.disconnect(); };
    }, [filtered, limit]);
    useEffect(() => {
        if (!feedback) return undefined;
        const timeout = setTimeout(() => setFeedback(null), 4000);
        return () => clearTimeout(timeout);
    }, [feedback]);
    useEffect(() => {
        if (bookPath && !summary.books.some(book => book.path === bookPath)) setBookPath('');
        if (color && !summary.colors.some(item => item.color === color)) setColor('');
    }, [bookPath, color, summary]);
    const reset = () => { setColor(''); setBookPath(''); setStyle(''); setMonthKey(''); setSort('newest'); };
    const hasFilter = Boolean(color || bookPath || style || monthKey || sort !== 'newest');
    const copyEntry = async entry => {
        const request = ++copyRequestRef.current;
        try {
            await navigator.clipboard.writeText(entry.text);
            if (request === copyRequestRef.current) setFeedback({ copiedId: entry.id });
        } catch {
            if (request === copyRequestRef.current) setFeedback({ message: labels.copyFailed, error: true });
        }
    };
    const deleteEntry = async entry => {
        try {
            await onDelete(entry);
        } catch {
            setFeedback({ message: labels.deleteFailed, error: true });
        }
    };
    return <section className={`annotations-browser${compact ? ' is-compact' : ''}`} style={ANNOTATION_COLOR_VARIABLES} aria-label={labels.title}>
        {toolbarTarget && createPortal(<div className="folder-toolbar annotations-toolbar-controls" role="group" aria-label={labels.viewOptions}>
            {hasFilter && <button type="button" className="toolbar-btn annotations-reset" onClick={reset}>{labels.reset}</button>}
            <ToolbarSelect className="annotations-group-select" label={labels.grouping} value={groupBy} onChange={setGroupBy} options={[
                { value: 'date', label: labels.byDate },
                { value: 'book', label: labels.byBook },
            ]} />
            <ToolbarSelect label={labels.sort} value={sort} onChange={setSort} options={[
                { value: 'newest', label: labels.newest },
                { value: 'oldest', label: labels.oldest },
            ]} />
            <button type="button" className={`toolbar-btn folder-checkable-btn annotations-density${compact ? ' checked' : ''}`} aria-label={labels.compact} aria-pressed={compact} onClick={() => setCompact(value => !value)}>{labels.compact}</button>
        </div>, toolbarTarget)}
        {catalog.errors.length > 0 && <div className="annotations-warning" role="status">
            <span>{labels.unavailable}</span>
            <button type="button" onClick={onRefresh}>{labels.retry}</button>
        </div>}
        <div className="annotations-layout" ref={scrollRef}>
            <main className="annotations-feed">
                {(color || selectedBook || style || selectedMonth) && <div className="annotations-active-filters">
                    {color && <button type="button" onClick={() => setColor('')} aria-label={`${labels.filteredColor}: ${labels[color]} · ${labels.reset}`}>
                        <i className={`annotation-color is-${color}`} aria-hidden="true" />{labels[color]}<FaIcon name="xmark" size={10} aria-hidden="true" />
                    </button>}
                    {selectedBook && <button type="button" onClick={() => setBookPath('')} aria-label={`${labels.filteredBook}: ${selectedBook.title} · ${labels.reset}`}>
                        <span>{selectedBook.title}</span><FaIcon name="xmark" size={10} aria-hidden="true" />
                    </button>}
                    {style && <button type="button" onClick={() => setStyle('')} aria-label={`${labels.styles}: ${labels[style]} · ${labels.reset}`}>
                        {labels[style]}<FaIcon name="xmark" size={10} />
                    </button>}
                    {selectedMonth && <button type="button" onClick={() => setMonthKey('')} aria-label={`${labels.filteredMonth}: ${monthFormatter.format(selectedMonth.timestamp)} · ${labels.reset}`}>
                        {monthFormatter.format(selectedMonth.timestamp)}<FaIcon name="xmark" size={10} aria-hidden="true" />
                    </button>}
                </div>}
                {feedback?.error && <div className="annotations-feedback is-error" role="status">{feedback.message}</div>}
                <div className="annotations-feed-scroll" ref={feedRef}>
                    {filtered.length === 0 ? <div className="annotations-empty">
                        <h3>{catalog.entries.length ? labels.noResults : labels.empty}</h3>
                        <p>{catalog.entries.length ? labels.noResultsHint : labels.emptyHint}</p>
                        {hasFilter && <button type="button" onClick={reset}>{labels.reset}</button>}
                    </div> : <div className="annotations-months">
                        {visibleGroups.map(group => <section className={`annotations-month${groupBy === 'book' ? ' is-book-group' : ''}`} key={group.key} aria-label={groupBy === 'book' ? group.title : group.key === 'unknown' ? labels.unknownDate : monthFormatter.format(group.timestamp)}>
                            <h3>
                                {groupBy === 'book' ? <button type="button" className="annotation-book-link" onClick={() => onOpenFile?.(group.file)} title={`${labels.open}: ${group.title}`} disabled={!onOpenFile}>
                                    <CoverImage file={group.file} src={group.file.cover} className="annotation-mini-cover" alt="" t={coverLabel} showLoadingIndicator={false} />
                                    <span><strong>{group.title}</strong>{group.author && <small>{group.author}</small>}</span>
                                </button> : <span>{group.key === 'unknown' ? labels.unknownDate : monthFormatter.format(group.timestamp)}</span>}
                                <i aria-hidden="true" /><small>{number(group.total)}</small>
                            </h3>
                            {group.entries.map((entry, index) => <AnnotationEntry key={entry.id} entry={entry} compact={compact} showBook={groupBy !== 'book'} showDate={index === 0 || annotationDayKey(entry.timestamp) !== annotationDayKey(group.entries[index - 1].timestamp)} labels={labels} locale={locale} dayFormatter={dayFormatter} onOpenFile={onOpenFile} onCopy={copyEntry} onDelete={onDelete ? deleteEntry : undefined} copied={feedback?.copiedId === entry.id} hasHover={hasHover} reducedMotion={reducedMotion} />)}
                        </section>)}
                        <div className="annotations-pagination" ref={sentinelRef} aria-live="polite">
                            <span>{number(Math.min(limit, filtered.length))} / {number(filtered.length)}</span>
                        </div>
                    </div>}
                </div>
            </main>
            <aside className="annotations-summary" aria-label={labels.overview}>
                <h2 className="annotations-summary-heading">{labels.summaryTitle}</h2>
                <div className="annotations-summary-content">
                    <section className="annotations-summary-total">
                        <span>{labels.library}</span>
                        <div><strong>{number(summary.total)}</strong><span>{labels.marks.trim()}</span><i /><strong>{number(summary.bookCount)}</strong><span>{labels.books.trim()}</span></div>
                    </section>
                    <section className="annotations-summary-section">
                        <h3>{labels.months}</h3>
                        <div className="annotations-chart" role="group" aria-label={labels.filteredMonth}>
                            {summary.months.map(month => <button type="button" className={`annotations-chart-column${monthKey === month.key ? ' is-active' : ''}`} key={month.key} title={`${monthFormatter.format(month.timestamp)} · ${number(month.count)}${labels.marks}`} aria-label={`${monthFormatter.format(month.timestamp)} · ${number(month.count)}${labels.marks}`} aria-pressed={monthKey === month.key} disabled={!month.count} onClick={() => setMonthKey(current => current === month.key ? '' : month.key)}>
                                <span style={{ height: month.count ? `${Math.max(5, month.count / maxMonth * 100)}%` : '2px' }} className={month.count ? 'has-marks' : ''} />
                            </button>)}
                        </div>
                        <div className="annotations-chart-labels"><span>{shortMonthFormatter.format(summary.months[0].timestamp)}</span><span>{shortMonthFormatter.format(summary.months[11].timestamp)}</span></div>
                    </section>
                    <section className="annotations-summary-section">
                        <h3>{labels.colors}</h3>
                        <div className="annotations-color-filters">
                            <button type="button" className={!color ? 'is-active' : ''} aria-pressed={!color} onClick={() => setColor('')}>{labels.all}<small>{number(summary.total)}</small></button>
                            {summary.colors.map(item => <button type="button" key={item.color} className={color === item.color ? 'is-active' : ''} aria-pressed={color === item.color} onClick={() => setColor(current => current === item.color ? '' : item.color)}>
                                <i className={`annotation-color is-${item.color}`} aria-hidden="true">{item.color === 'strikethrough' && <FaIcon name="strikethrough" size={11} />}</i>{labels[item.color]}<small>{number(item.count)}</small>
                            </button>)}
                        </div>
                    </section>
                    <section className="annotations-summary-section">
                        <h3>{labels.styles}</h3>
                        <div className="annotations-style-filters">
                            <button type="button" className={!style ? 'is-active' : ''} aria-pressed={!style} onClick={() => setStyle('')}>{labels.all}<small>{number(summary.total)}</small></button>
                            {summary.styles.filter(item => item.count > 0).map(item => <button type="button" key={item.style} className={style === item.style ? 'is-active' : ''} aria-pressed={style === item.style} onClick={() => setStyle(current => current === item.style ? '' : item.style)}>{labels[item.style]}<small>{number(item.count)}</small></button>)}
                        </div>
                    </section>
                    <section className="annotations-summary-section annotations-shelf">
                        <h3>{labels.shelf}<span>{number(summary.bookCount)}</span></h3>
                        <label className="annotations-shelf-search"><FaIcon name="search" size={11} /><input type="search" value={bookQuery} onChange={event => setBookQuery(event.target.value)} placeholder={labels.shelfSearch} aria-label={labels.shelfSearch} /></label>
                        {bookPath && <button type="button" className="annotations-shelf-all" onClick={() => setBookPath('')}>{labels.all}<FaIcon name="xmark" size={10} aria-hidden="true" /></button>}
                        <div className="annotations-shelf-books">
                            {shelfBooks.slice(0, bookLimit).map(book => <button type="button" className={`annotations-shelf-book${bookPath === book.path ? ' is-active' : ''}`} key={book.path} aria-pressed={bookPath === book.path} onClick={() => setBookPath(current => current === book.path ? '' : book.path)} title={book.title}>
                                <CoverImage file={book.file} src={book.file.cover} className="annotation-mini-cover" alt="" t={coverLabel} showLoadingIndicator={false} />
                                <span><strong>{book.title}</strong><small>{book.author}</small></span><b>{number(book.count)}</b>
                            </button>)}
                            {!shelfBooks.length && <p className="annotations-shelf-empty">{labels.noBooks}</p>}
                        </div>
                        {shelfBooks.length > bookLimit && <button type="button" className="annotations-more-books" onClick={() => setBookLimit(value => value + 20)}>{labels.moreBooks}</button>}
                    </section>
                </div>
            </aside>
        </div>
    </section>;
}
