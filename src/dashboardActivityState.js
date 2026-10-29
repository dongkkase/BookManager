export function dashboardMonth(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function dashboardDate(date = new Date()) {
    return `${dashboardMonth(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftDashboardMonth(month, offset) {
    const [year, index] = month.split('-').map(Number);
    return dashboardMonth(new Date(year, index - 1 + offset, 1, 12));
}

export function dashboardMonthDays(month) {
    const [year, index] = month.split('-').map(Number);
    const first = new Date(year, index - 1, 1, 12);
    const count = new Date(year, index, 0, 12).getDate();
    return {
        offset: first.getDay(),
        dates: Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`),
    };
}

export function readingDurationLabel(seconds, t) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value > 0 && value < 60) return t('dashboard.under_minute');
    const minutes = Math.floor(value / 60);
    return minutes >= 60 ? t('dashboard.hours_minutes', [Math.floor(minutes / 60), minutes % 60])
        : t('dashboard.minutes', [minutes]);
}

export function randomPassage(entries, random = Math.random) {
    const candidates = (entries || []).filter(entry => typeof entry?.text === 'string' && entry.text.trim());
    return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
}
