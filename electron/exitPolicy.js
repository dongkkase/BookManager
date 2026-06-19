const EXIT_LABELS = Object.freeze({
    ko: {
        title: '종료 확인',
        message: '현재 작업이 진행 중입니다. 정말로 프로그램을 종료하시겠습니까?\n(진행 중인 작업은 강제 중단되며 파일이 손상될 수 있습니다.)',
        yes: '예',
        no: '아니오',
    },
    en: {
        title: 'Confirm Exit',
        message: 'A task is currently running. Are you sure you want to exit?\n(The running task will be forcibly stopped and data may be corrupted.)',
        yes: 'Yes',
        no: 'No',
    },
    ja: {
        title: '終了確認',
        message: '現在作業が進行中です。本当にプログラムを終了しますか？\n(進行中の作業は強制中断され、ファイルが破損する可能性があります。)',
        yes: 'はい',
        no: 'いいえ',
    },
});

export function normalizeRuntimeState(state = {}) {
    const language = ['ko', 'en', 'ja'].includes(state.language) ? state.language : 'ko';
    return {
        isWorking: Boolean(state.isWorking),
        language,
        activeTab: String(state.activeTab || 'folder'),
    };
}

export function createExitDialogOptions(language = 'ko') {
    const labels = EXIT_LABELS[language] || EXIT_LABELS.ko;
    return {
        type: 'question',
        title: labels.title,
        message: labels.message,
        buttons: [labels.yes, labels.no],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    };
}
