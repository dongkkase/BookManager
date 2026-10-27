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

export function dailyPassage(entries, day) {
    let chosen = null;
    let rank = Infinity;
    for (const entry of entries || []) {
        if (!entry?.text?.trim()) continue;
        const value = `${day}|${entry.id}`;
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
        const candidate = hash >>> 0;
        if (candidate < rank || candidate === rank && entry.id < chosen.id) {
            chosen = entry;
            rank = candidate;
        }
    }
    return chosen;
}
