const LABELS = Object.freeze({
    ko: { ok: '확인', yes: '예', no: '아니오', cancel: '취소' },
    en: { ok: 'OK', yes: 'Yes', no: 'No', cancel: 'Cancel' },
    ja: { ok: '確認', yes: 'はい', no: 'いいえ', cancel: 'キャンセル' },
});

const MESSAGE_TYPES = new Set(['info', 'warning', 'error', 'question']);
const QUESTION_BUTTONS = new Set(['yes-no', 'yes-no-cancel']);

function normalizeLanguage(language) {
    return ['ko', 'en', 'ja'].includes(language) ? language : 'ko';
}

export function createMessageDialogOptions(options = {}) {
    const language = normalizeLanguage(options.language);
    const labels = LABELS[language];
    const type = MESSAGE_TYPES.has(options.type) ? options.type : 'info';
    const title = String(options.title || '');
    const message = String(options.message || '');

    if (type !== 'question') {
        return {
            type,
            title,
            message,
            buttons: [labels.ok],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        };
    }

    const buttonSet = QUESTION_BUTTONS.has(options.buttons) ? options.buttons : 'yes-no';
    const buttons = buttonSet === 'yes-no-cancel'
        ? [labels.yes, labels.no, labels.cancel]
        : [labels.yes, labels.no];
    const responseKeys = buttonSet === 'yes-no-cancel'
        ? ['yes', 'no', 'cancel']
        : ['yes', 'no'];
    const requestedDefault = String(options.defaultChoice || 'yes');
    const defaultId = Math.max(0, responseKeys.indexOf(requestedDefault));
    const cancelId = buttonSet === 'yes-no-cancel' ? 2 : 1;

    return {
        type,
        title,
        message,
        buttons,
        defaultId,
        cancelId,
        noLink: true,
    };
}

export function resolveMessageDialogResponse(options = {}, response = 0) {
    if (options.type !== 'question') return 'ok';
    const responseKeys = options.buttons === 'yes-no-cancel'
        ? ['yes', 'no', 'cancel']
        : ['yes', 'no'];
    return responseKeys[response] || responseKeys[responseKeys.length - 1];
}
