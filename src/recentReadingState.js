function validTimestamp(value) {
    const timestamp = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export function recentReadingTimeText(value, t, now = Date.now(), language = 'ko') {
    const timestamp = validTimestamp(value);
    if (!timestamp) return '';
    const elapsedSeconds = Math.max(0, Math.floor((Number(now) - timestamp) / 1000));
    if (elapsedSeconds < 60) return t('folder.recent.just_now');
    if (elapsedSeconds < 3600) return t('folder.recent.minutes_ago', [Math.floor(elapsedSeconds / 60)]);
    if (elapsedSeconds < 86400) return t('folder.recent.hours_ago', [Math.floor(elapsedSeconds / 3600)]);
    if (elapsedSeconds < 604800) return t('folder.recent.days_ago', [Math.floor(elapsedSeconds / 86400)]);
    return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(timestamp);
}
