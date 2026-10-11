const LABELS = Object.freeze({
    ko: { ok: '확인', yes: '예', no: '아니오', cancel: '취소', append: '기존 목록에 추가', replace: '기존 목록 전체 비우고 추가' },
    en: { ok: 'OK', yes: 'Yes', no: 'No', cancel: 'Cancel', append: 'Add to the existing list', replace: 'Clear the list and add files' },
    ja: { ok: '確認', yes: 'はい', no: 'いいえ', cancel: 'キャンセル', append: '既存の一覧に追加', replace: '既存の一覧を空にして追加' },
});

const MESSAGE_TYPES = new Set(['info', 'warning', 'error', 'question']);
const QUESTION_BUTTONS = new Set(['yes-no', 'yes-no-cancel', 'append-replace-cancel']);

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
    const responseKeys = buttonSet === 'append-replace-cancel'
        ? ['append', 'replace', 'cancel']
        : buttonSet === 'yes-no-cancel'
            ? ['yes', 'no', 'cancel']
            : ['yes', 'no'];
    const buttons = responseKeys.map(key => labels[key]);
    const requestedDefault = String(options.defaultChoice || responseKeys[0]);
    const defaultId = Math.max(0, responseKeys.indexOf(requestedDefault));
    const cancelId = responseKeys.length - 1;

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
    const responseKeys = options.buttons === 'append-replace-cancel'
        ? ['append', 'replace', 'cancel']
        : options.buttons === 'yes-no-cancel'
            ? ['yes', 'no', 'cancel']
            : ['yes', 'no'];
    return responseKeys[response] || responseKeys[responseKeys.length - 1];
}
