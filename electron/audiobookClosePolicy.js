const AUDIOBOOK_CLOSE_LABELS = Object.freeze({
    ko: Object.freeze({
        title: '오디오북',
        message: '미니플레이어로 전환 하시겠습니까?',
        transfer: '전환',
        close: '닫기',
        cancel: '취소',
    }),
    en: Object.freeze({
        title: 'Audiobook',
        message: 'Would you like to switch to the mini player?',
        transfer: 'Switch',
        close: 'Close',
        cancel: 'Cancel',
    }),
    ja: Object.freeze({
        title: 'オーディオブック',
        message: 'ミニプレーヤーに切り替えますか？',
        transfer: '切り替え',
        close: '閉じる',
        cancel: 'キャンセル',
    }),
});

export const AUDIOBOOK_CLOSE_ACTION = Object.freeze({
    TRANSFER: 'transfer',
    CLOSE: 'close',
    CANCEL: 'cancel',
});

function normalizeLanguage(language = '') {
    const normalized = String(language || '').trim().toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(AUDIOBOOK_CLOSE_LABELS, normalized)
        ? normalized
        : 'ko';
}

export function createAudiobookCloseDialogOptions(language = 'ko') {
    const labels = AUDIOBOOK_CLOSE_LABELS[normalizeLanguage(language)];
    return {
        type: 'question',
        title: labels.title,
        message: labels.message,
        buttons: [labels.transfer, labels.close, labels.cancel],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
    };
}

export function resolveAudiobookCloseAction(response) {
    if (Number(response) === 0) return AUDIOBOOK_CLOSE_ACTION.TRANSFER;
    if (Number(response) === 1) return AUDIOBOOK_CLOSE_ACTION.CLOSE;
    return AUDIOBOOK_CLOSE_ACTION.CANCEL;
}
