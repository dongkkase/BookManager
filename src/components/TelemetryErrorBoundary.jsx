import React from 'react';
import { getCurrentLanguage } from '../utils/i18n.js';
import { reportTelemetryError } from '../telemetry.js';

const ERROR_MESSAGES = {
    ko: '화면을 표시하지 못했습니다. 앱을 다시 열어 주세요.',
    en: 'Could not display this screen. Please reopen the app.',
    ja: '画面を表示できませんでした。アプリを開き直してください。',
};

export class TelemetryErrorBoundary extends React.Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        reportTelemetryError(error, this.props.source || 'renderer-react');
    }

    render() {
        if (this.state.failed) {
            return <div className="app-error" role="alert">{ERROR_MESSAGES[getCurrentLanguage()] || ERROR_MESSAGES.ko}</div>;
        }
        return this.props.children;
    }
}
