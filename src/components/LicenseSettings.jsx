import React from 'react';
import appLicense from '../../LICENSE?raw';
import thirdPartyNotices from '../../THIRD_PARTY_NOTICES.md?raw';

const licenseName = appLicense.split(/\r?\n/, 1)[0];
const copyrightNotice = appLicense.split(/\r?\n/).find(line => line.startsWith('Copyright'));
const notices = thirdPartyNotices.split(/^## /m).slice(1).map(section => {
    const newline = section.indexOf('\n');
    return {
        title: section.slice(0, newline).trim(),
        text: section.slice(newline + 1).trim(),
    };
});

export function LicenseSettings({ t }) {
    return (
        <div className="settings-panel settings-license-panel">
            <fieldset className="settings-fieldset">
                <legend>BookManager</legend>
                <div className="settings-license-heading">
                    <span className="settings-license-badge">{licenseName}</span>
                    <span className="settings-license-copyright">{copyrightNotice}</span>
                </div>
                <p className="settings-help">{t('settings.licenses.app_description')}</p>
                <details className="settings-license-notice">
                    <summary tabIndex={0}>{t('settings.licenses.original')}</summary>
                    <pre className="settings-license-text" lang="en">{appLicense.trim()}</pre>
                </details>
            </fieldset>
            <fieldset className="settings-fieldset">
                <legend>{t('settings.licenses.third_party')}</legend>
                <p className="settings-help">{t('settings.licenses.third_party_description')}</p>
                <div className="settings-license-notices">
                    {notices.map(notice => (
                        <details key={notice.title} className="settings-license-notice">
                            <summary tabIndex={0}>{notice.title}</summary>
                            <pre className="settings-license-text" lang="en">{notice.text}</pre>
                        </details>
                    ))}
                </div>
            </fieldset>
        </div>
    );
}
