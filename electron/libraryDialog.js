const LABELS = Object.freeze({
    ko: ['스마트 갱신', '전체 재스캔', '취소'],
    en: ['Smart Update', 'Force Rescan', 'Cancel'],
    ja: ['スマート更新', '強制再スキャン', 'キャンセル'],
});

export function createLibrarySyncDialogOptions(options = {}) {
    const language = ['ko', 'en', 'ja'].includes(options.language) ? options.language : 'ko';
    return {
        type: 'question',
        title: String(options.title || ''),
        message: String(options.message || ''),
        buttons: LABELS[language],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
    };
}

export function resolveLibrarySyncChoice(response) {
    return ['smart', 'force', 'cancel'][response] || 'cancel';
}
