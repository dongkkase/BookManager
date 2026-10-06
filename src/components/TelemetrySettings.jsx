import React from 'react';

const LABELS = {
    ko: {
        title: '오류 보고 및 사용 통계',
        errorReports: '오류 보고 보내기',
        errorReportsHelp: '문제 해결을 위해 오류 유형과 코드 위치를 보냅니다.',
        usageStats: '기능 사용 빈도 보내기',
        usageStatsHelp: '앱의 사용성 개선을 위해 메뉴와 기능의 사용 빈도수를 보냅니다.',
        privacy: '앱 버전·운영체제·기능 식별자가 포함될 수 있습니다. 책 제목·본문·파일 경로·검색어는 보내지 않습니다.',
        optional: '두 항목은 기본으로 켜져 있습니다. 원하지 않으면 체크를 해제하고 저장하세요. 언제든지 변경할 수 있습니다.',
        unavailable: '현재 연결되어 있지 않아 전송되지 않습니다.',
    },
    en: {
        title: 'Error reports and usage statistics',
        errorReports: 'Send error reports',
        errorReportsHelp: 'Send error types and code locations to help resolve problems.',
        usageStats: 'Send feature usage counts',
        usageStatsHelp: 'Send menu and feature usage counts to help improve the app’s usability.',
        privacy: 'Reports may include the app version, operating system and feature identifiers. Book titles, contents, file paths and search terms are not sent.',
        optional: 'Both options are enabled by default. Uncheck either option and save to turn it off. You can change these settings at any time.',
        unavailable: 'Currently unavailable. No data is sent.',
    },
    ja: {
        title: 'エラー報告と利用統計',
        errorReports: 'エラー報告を送信',
        errorReportsHelp: '問題解決のため、エラーの種類とコードの位置を送信します。',
        usageStats: '機能の利用頻度を送信',
        usageStatsHelp: 'アプリの使いやすさを改善するため、メニューや機能の利用頻度を送信します。',
        privacy: 'アプリのバージョン・OS・機能識別子が含まれる場合があります。本のタイトル・本文・ファイルパス・検索語は送信しません。',
        optional: 'どちらも初期設定では有効です。希望しない場合はチェックを外して保存してください。いつでも変更できます。',
        unavailable: '現在接続されていないため、送信されません。',
    },
};

export function TelemetrySettings({ config, onChange }) {
    const [status, setStatus] = React.useState(null);
    const labels = LABELS[config.language || config.lang] || LABELS.ko;

    React.useEffect(() => {
        if (!window.electronAPI?.getTelemetryStatus) return undefined;
        let cancelled = false;
        window.electronAPI.getTelemetryStatus()
            .then(result => {
                if (!cancelled) setStatus(result);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <fieldset className="settings-fieldset">
            <legend>{labels.title}</legend>
            <p className="settings-help">{labels.privacy}</p>
            <label className="settings-check-row">
                <input
                    type="checkbox"
                    checked={config.telemetry_error_reports === true}
                    onChange={event => onChange('telemetry_error_reports', event.target.checked)}
                />
                <span>
                    <strong>{labels.errorReports}</strong>
                    <small>{labels.errorReportsHelp}</small>
                    {status?.errorReportingConfigured === false && <small>{labels.unavailable}</small>}
                </span>
            </label>
            <label className="settings-check-row">
                <input
                    type="checkbox"
                    checked={config.telemetry_usage_stats === true}
                    onChange={event => onChange('telemetry_usage_stats', event.target.checked)}
                />
                <span>
                    <strong>{labels.usageStats}</strong>
                    <small>{labels.usageStatsHelp}</small>
                    {status?.usageAnalyticsConfigured === false && <small>{labels.unavailable}</small>}
                </span>
            </label>
            <p className="settings-help">{labels.optional}</p>
        </fieldset>
    );
}
