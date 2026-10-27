import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { dashboardDate, dashboardMonth, dashboardMonthDays, readingDurationLabel, shiftDashboardMonth } from '../../dashboardActivityState';
import { readingStatePathKey } from '../../folderReadingStates';
import '../../styles/DashboardReadingInsights.css';
import '../../styles/DashboardJournal.css';

function GoalProgress({ value, target, label, kind, t }) {
    if (!target) return null;
    const percent = Math.min(100, Math.max(0, value / target * 100));
    return <div className={`dashboard-goal-progress dashboard-goal-${kind}`}>
        <div className="dashboard-goal-ring" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)} style={{ '--goal-progress': `${percent}%` }}>
            <span aria-hidden="true">{Math.floor(percent)}<small>%</small></span>
        </div>
        <div className="dashboard-goal-caption">
            <span>{t(kind === 'books' ? 'dashboard.completed' : 'dashboard.time')}</span>
            <strong>{label}</strong>
            {percent >= 100 && <span className="dashboard-goal-reached"><FaIcon name="check" />{t('dashboard.goal_reached')}</span>}
        </div>
    </div>;
}

function MonthlyGoal({ goal = {}, totals = {}, saveGoal, month, t }) {
    const [editing, setEditing] = useState(false);
    const [books, setBooks] = useState('0');
    const [hours, setHours] = useState('0');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const mountedRef = useRef(true);
    const buttonRef = useRef(null);
    const inputRef = useRef(null);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
    const edit = () => {
        setBooks(String(goal.books || 0));
        setHours(String((goal.minutes || 0) / 60));
        setError(false);
        setEditing(true);
    };
    const finish = () => { setEditing(false); queueMicrotask(() => buttonRef.current?.focus()); };
    const submit = async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(false);
        try {
            await saveGoal({ books: Number(books), minutes: Math.round(Number(hours) * 60) });
            if (mountedRef.current) finish();
        } catch {
            if (mountedRef.current) setError(true);
        } finally {
            if (mountedRef.current) setSaving(false);
        }
    };
    return <div className="dashboard-monthly-goal" data-month={month}>
        <div className="dashboard-panel-heading"><h3>{t('dashboard.goal')}</h3>
            {!editing && <button type="button" className="reading-dashboard-link" ref={buttonRef} onClick={edit}>{t('dashboard.edit_goal')}</button>}
        </div>
        {editing ? <form className="dashboard-goal-form" onSubmit={submit}>
            <div className="dashboard-goal-inputs">
                <label>{t('dashboard.goal_books')}<input ref={inputRef} aria-label={t('dashboard.goal_books')} type="number" min="0" max="1000" step="1" required value={books} onChange={event => setBooks(event.target.value)} disabled={saving} /></label>
                <label>{t('dashboard.goal_hours')}<input aria-label={t('dashboard.goal_hours')} type="number" min="0" max="744" step="any" required value={hours} onChange={event => setHours(event.target.value)} disabled={saving} /></label>
            </div>
            <p>{t('dashboard.goal_optional')}</p>
            {error && <p role="alert">{t('dashboard.goal_failed')}</p>}
            <div className="dashboard-inline-actions"><button type="button" className="reading-dashboard-link" disabled={saving} onClick={finish}>{t('dashboard.cancel')}</button>
                <button type="submit" className="reading-dashboard-settings" disabled={saving}>{t(saving ? 'dashboard.saving' : 'dashboard.save')}</button></div>
        </form> : <>
            {!goal.books && !goal.minutes && <p className="dashboard-journal-muted">{t('dashboard.goal_hint')}</p>}
            <div className="dashboard-goal-overview">
                <GoalProgress value={totals.completedBooks || 0} target={goal.books} label={t('dashboard.goal_book_progress', [totals.completedBooks || 0, goal.books])} kind="books" t={t} />
                <GoalProgress value={(totals.seconds || 0) / 60} target={goal.minutes} label={t('dashboard.goal_time_progress', [readingDurationLabel(totals.seconds, t), readingDurationLabel((goal.minutes || 0) * 60, t)])} kind="time" t={t} />
            </div>
        </>}
    </div>;
}

export function DashboardReadingInsights({ activity, month, onMonthChange, files, language, t, onOpenFile }) {
    const locale = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'ko-KR';
    const today = dashboardDate();
    const currentMonth = dashboardMonth();
    const [selected, setSelected] = useState(today);
    const selectedDate = selected.startsWith(month) ? selected : month === currentMonth ? today : `${month}-01`;
    const { data, loading, error, refresh, saveGoal } = activity;
    const totals = data?.totals || {};
    const dayMap = useMemo(() => new Map((data?.days || []).map(day => [day.date, day])), [data]);
    const fileMap = useMemo(() => new Map(files.map(file => [readingStatePathKey(file.full_path || file.path, navigator.platform), file])), [files]);
    const { dates, offset } = useMemo(() => dashboardMonthDays(month), [month]);
    const [year, monthIndex] = month.split('-').map(Number);
    const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(year, monthIndex - 1, 1, 12));
    const dayFormatter = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' });
    const selectedLabel = dayFormatter.format(new Date(`${selectedDate}T12:00:00`));
    const selectedDay = dayMap.get(selectedDate);
    const hasSyncedActivity = Boolean(selectedDay?.hasSyncedActivity || selectedDay?.syncedSeconds || selectedDay?.syncedBookCount);
    const peakTime = Math.max(0, ...[...dayMap.values()].map(day => day.seconds || 0));
    const maxTime = Math.max(60, peakTime);
    const trackingDate = data?.trackingStartedAt && Number.isFinite(Date.parse(data.trackingStartedAt))
        ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(data.trackingStartedAt)) : '';
    const lastSyncedAt = data?.sync?.lastSyncedAt && Number.isFinite(Date.parse(data.sync.lastSyncedAt))
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.sync.lastSyncedAt)) : '';
    const dayLabel = date => t('dashboard.day_label', [dayFormatter.format(new Date(`${date}T12:00:00`)), readingDurationLabel(dayMap.get(date)?.seconds || 0, t), dayMap.get(date)?.completedCount || 0]);
    return <section className="reading-dashboard-section dashboard-journal" aria-busy={loading}>
        <div className="reading-dashboard-section-heading">
            <div><h2>{t('dashboard.journal')}</h2><p>{t('dashboard.journal_hint')}</p></div>
            <div className="dashboard-month-navigation">
                <div className="dashboard-month-switcher">
                    <button type="button" aria-label={t('dashboard.previous_month')} disabled={month <= '2000-01'} onClick={() => onMonthChange(shiftDashboardMonth(month, -1))}><FaIcon name="angleLeft" /></button>
                    <strong aria-live="polite">{monthLabel}</strong>
                    <button type="button" aria-label={t('dashboard.next_month')} disabled={month >= currentMonth} onClick={() => onMonthChange(shiftDashboardMonth(month, 1))}><FaIcon name="angleRight" /></button>
                </div>
                <button type="button" className="reading-dashboard-link" disabled={month === currentMonth} onClick={() => { onMonthChange(currentMonth); setSelected(today); }}>{t('dashboard.this_month')}</button>
            </div>
        </div>
        {error && <div className="dashboard-inline-error" role="alert"><span>{t('dashboard.failed')}</span><button type="button" className="reading-dashboard-link" onClick={refresh}>{t('dashboard.retry')}</button></div>}
        {!data ? !error && <div className="reading-dashboard-empty" role="status">{t('dashboard.loading')}</div> : <>
            <div className="dashboard-journal-grid">
                <div className="dashboard-calendar-panel">
                    <div className="dashboard-calendar-heading">
                        <h3><FaIcon name="calendar" />{t('dashboard.calendar')}</h3>
                        <span className="dashboard-calendar-summary">{t('dashboard.days')} <strong>{t('dashboard.day_count', [totals.readingDays || 0])}</strong></span>
                    </div>
                    <div className="dashboard-calendar-weekdays" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <span key={index}>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 0, 4 + index))}</span>)}</div>
                    <div className="dashboard-calendar-days" role="group" aria-label={t('dashboard.calendar')}>
                        {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
                        {dates.map(date => {
                            const day = dayMap.get(date);
                            const seconds = day?.seconds || 0;
                            const level = seconds >= 3600 ? 4 : seconds >= 1800 ? 3 : seconds >= 900 ? 2 : seconds > 0 || day?.hasActivity ? 1 : 0;
                            return <button key={date} type="button" data-date={date} data-level={level} aria-label={dayLabel(date)} title={dayLabel(date)}
                                aria-pressed={selectedDate === date} aria-current={date === today ? 'date' : undefined} disabled={date > today} onClick={() => setSelected(date)}>
                                <span className="dashboard-calendar-number">{Number(date.slice(-2))}</span>{day?.completedCount > 0 && <i aria-hidden="true" />}
                            </button>;
                        })}
                    </div>
                    <div className="dashboard-day-detail" aria-live="polite">
                        <div className="dashboard-panel-heading"><strong>{selectedLabel}</strong><span>{readingDurationLabel(selectedDay?.seconds, t)}</span></div>
                        {hasSyncedActivity && <p className="dashboard-journal-muted dashboard-synced-activity">{t('dashboard.synced_day', [readingDurationLabel(selectedDay.syncedSeconds, t), selectedDay.syncedBookCount || 0])}</p>}
                        {!selectedDay?.books?.length ? !hasSyncedActivity && <p className="dashboard-journal-muted">{t('dashboard.no_day')}</p> : <ul aria-label={t('dashboard.daily_books')}>{selectedDay.books.map(book => {
                            const file = fileMap.get(readingStatePathKey(book.path, navigator.platform));
                            return <li key={book.path}><button type="button" disabled={!file} onClick={() => onOpenFile?.(file)}><span>{file?.title || file?.name || t('dashboard.book_unavailable')}</span></button>
                                <span>{book.completed && <FaIcon name="check" />}{readingDurationLabel(book.seconds, t)}</span></li>;
                        })}</ul>}
                        {selectedDay?.bookCount > selectedDay?.books?.length && <p className="dashboard-journal-muted">{t('dashboard.more_books', [selectedDay.bookCount - selectedDay.books.length])}</p>}
                    </div>
                </div>
                <div className="dashboard-time-panel">
                    <div className="dashboard-time-total"><span><FaIcon name="clock" />{t('dashboard.time')}</span><strong>{readingDurationLabel(totals.seconds, t)}</strong></div>
                    <div className="dashboard-time-chart" role="img" aria-label={`${t('dashboard.daily_time')}: ${readingDurationLabel(totals.seconds, t)}`}>
                        <div className="dashboard-chart-caption" aria-hidden="true"><span>{t('dashboard.daily_time')}</span><span>{readingDurationLabel(peakTime, t)}</span></div>
                        <div className="dashboard-time-bars" style={{ '--day-count': dates.length }}>{dates.map(date => <span key={date} title={dayLabel(date)} aria-hidden="true" data-selected={date === selectedDate ? 'true' : undefined}><i style={{ height: `${Math.max(dayMap.get(date)?.seconds ? 3 : 0, (dayMap.get(date)?.seconds || 0) / maxTime * 100)}%` }} /></span>)}</div>
                        <div className="dashboard-time-axis" aria-hidden="true"><span>1</span><span>{Math.ceil(dates.length / 2)}</span><span>{dates.length}</span></div>
                    </div>
                    <div className="dashboard-time-summary"><div><span>{t('dashboard.days')}</span><strong>{t('dashboard.day_count', [totals.readingDays || 0])}</strong></div><div><span>{t('dashboard.completed')}</span><strong>{t('dashboard.book_count', [totals.completedBooks || 0])}</strong></div><div><span>{t('dashboard.average')}</span><strong>{readingDurationLabel(totals.readingDays ? totals.seconds / totals.readingDays : 0, t)}</strong></div></div>
                    <MonthlyGoal key={month} month={month} goal={data.goal} totals={totals} saveGoal={saveGoal} t={t} />
                </div>
            </div>
            <details className="dashboard-tracking-details">
                <summary><FaIcon name="info" />{t('dashboard.tracking_details')}</summary>
                <p className="dashboard-tracking-note">{trackingDate && <span>{t('dashboard.tracking', [trackingDate])}</span>}<span>{t('dashboard.tracking_hint')}</span>
                    <span>{t('dashboard.sync_hint')}</span>{lastSyncedAt && <span>{t('dashboard.last_synced', [lastSyncedAt])}</span>}</p>
            </details>
        </>}
    </section>;
}
