import React, { useEffect, useId, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { getCurrentLanguage, translate } from '../../utils/i18n';
import '../../styles/viewerScrollControls.css';

function scrollText(key, fallback, values) {
    const fullKey = `viewer.scroll.${key}`;
    const translated = translate(fullKey, getCurrentLanguage(), values);
    return translated && translated !== fullKey ? translated : fallback;
}

const WHEEL_OPTIONS = [
    ['system', 'wheel_system', '시스템 설정 사용'],
    ['slow', 'wheel_slow', '느리게 (0.5배)'],
    ['fast', 'wheel_fast', '빠르게 (1.5배)'],
    ['faster', 'wheel_faster', '더 빠르게 (2배)'],
];

const COMPACT_WHEEL_LABELS = { slow: '0.5×', fast: '1.5×', faster: '2×' };

const AUTO_SPEED_OPTIONS = [
    [40, 'auto_very_slow', '아주 느림 · 화면당 40초'],
    [30, 'auto_slow', '느림 · 화면당 30초'],
    [20, 'auto_normal', '보통 · 화면당 20초'],
    [12, 'auto_fast', '빠름 · 화면당 12초'],
    [8, 'auto_very_fast', '아주 빠름 · 화면당 8초'],
];

export function ViewerScrollOptions({
    settings,
    onChange,
    autoScrolling,
    onToggleAutoScroll,
    disabled = false,
    compact = false,
}) {
    const id = useId();
    const keyboardPercent = settings.keyboardPercent;
    const [keyboardDraft, setKeyboardDraft] = useState(String(keyboardPercent));

    useEffect(() => {
        setKeyboardDraft(String(keyboardPercent));
    }, [keyboardPercent]);

    const commitKeyboardPercent = () => {
        const numeric = Number(keyboardDraft);
        const next = keyboardDraft.trim() && Number.isFinite(numeric)
            ? Math.min(100, Math.max(10, Math.round(numeric / 5) * 5))
            : keyboardPercent;
        setKeyboardDraft(String(next));
        if (next !== keyboardPercent) onChange({ keyboardPercent: next });
    };

    return (
        <div
            className={`viewer-scroll-options${compact ? ' is-compact' : ''}`}
            role="group"
            aria-label={scrollText('title', '스크롤 설정')}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
                if (event.key !== 'Escape') event.stopPropagation();
            }}
        >
            <div className="viewer-scroll-fields">
                <div className="viewer-scroll-field viewer-scroll-behavior">
                    <span id={`${id}-behavior-label`} className="viewer-scroll-label" title={scrollText('behavior', '스크롤 방식')}>
                        {compact ? scrollText('behavior_short', '방식') : scrollText('behavior', '스크롤 방식')}
                    </span>
                    {compact ? (
                        <select
                            value={settings.behavior}
                            aria-label={scrollText('behavior', '스크롤 방식')}
                            title={scrollText('behavior', '스크롤 방식')}
                            disabled={disabled}
                            onChange={event => onChange({ behavior: event.target.value })}
                        >
                            <option value="default">{scrollText('behavior_default', '기본')}</option>
                            <option value="smooth">{scrollText('behavior_smooth', '부드러운 이동')}</option>
                        </select>
                    ) : <div className="viewer-scroll-segmented" role="group" aria-labelledby={`${id}-behavior-label`}>
                        {[
                            ['default', 'behavior_default', '기본'],
                            ['smooth', 'behavior_smooth', '부드러운 이동'],
                        ].map(([value, key, fallback]) => (
                            <button
                                key={value}
                                type="button"
                                className={settings.behavior === value ? 'is-selected' : ''}
                                aria-pressed={settings.behavior === value}
                                disabled={disabled}
                                onClick={() => onChange({ behavior: value })}
                            >
                                {scrollText(key, fallback)}
                            </button>
                        ))}
                    </div>}
                </div>
                <label className="viewer-scroll-field viewer-scroll-wheel" title={scrollText('wheel_amount', '마우스 휠 이동량')}>
                    <span className="viewer-scroll-label">{compact ? scrollText('wheel_short', '휠') : scrollText('wheel_amount', '마우스 휠 이동량')}</span>
                    <select
                        value={settings.wheelAmount}
                        aria-label={scrollText('wheel_amount', '마우스 휠 이동량')}
                        disabled={disabled}
                        onChange={event => onChange({ wheelAmount: event.target.value })}
                    >
                        {WHEEL_OPTIONS.map(([value, key, fallback]) => (
                            <option key={value} value={value} title={scrollText(key, fallback)}>
                                {compact
                                    ? (value === 'system' ? scrollText('wheel_system_short', '시스템') : COMPACT_WHEEL_LABELS[value])
                                    : scrollText(key, fallback)}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="viewer-scroll-field">
                    <label className="viewer-scroll-label" htmlFor={`${id}-keyboard-number`} title={scrollText('keyboard_amount', '키보드 이동량')}>
                        {compact ? scrollText('keyboard_short', '키보드') : scrollText('keyboard_amount', '키보드 이동량')}
                    </label>
                    <div className="viewer-scroll-keyboard">
                        {!compact && <input
                            type="range"
                            min="10"
                            max="100"
                            step="5"
                            value={keyboardPercent}
                            disabled={disabled}
                            aria-label={scrollText('keyboard_amount', '키보드 이동량')}
                            aria-valuetext={scrollText('keyboard_screen_percent', `화면의 ${keyboardPercent}%`, { percent: keyboardPercent })}
                            onChange={event => {
                                const next = Number(event.target.value);
                                setKeyboardDraft(String(next));
                                onChange({ keyboardPercent: next });
                            }}
                        />}
                        <div className="viewer-scroll-number">
                            {!compact && <span>{scrollText('screen', '화면')}</span>}
                            <input
                                id={`${id}-keyboard-number`}
                                type="number"
                                min="10"
                                max="100"
                                step="5"
                                value={keyboardDraft}
                                aria-label={scrollText('keyboard_amount', '키보드 이동량')}
                                title={scrollText('keyboard_screen_percent', `화면의 ${keyboardPercent}%`, { percent: keyboardPercent })}
                                disabled={disabled}
                                onChange={event => setKeyboardDraft(event.target.value)}
                                onBlur={commitKeyboardPercent}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            <span>%</span>
                        </div>
                    </div>
                </div>
                <label className="viewer-scroll-field viewer-scroll-speed" title={scrollText('auto_speed', '자동 스크롤 속도')}>
                    <span className="viewer-scroll-label">{compact ? scrollText('auto_short', '자동') : scrollText('auto_speed', '자동 스크롤 속도')}</span>
                    <select
                        value={settings.autoSeconds}
                        aria-label={scrollText('auto_speed', '자동 스크롤 속도')}
                        disabled={disabled}
                        onChange={event => onChange({ autoSeconds: Number(event.target.value) })}
                    >
                        {AUTO_SPEED_OPTIONS.map(([value, key, fallback]) => (
                            <option key={value} value={value} title={scrollText(key, fallback)}>
                                {compact ? scrollText('auto_screen_seconds', `화면당 ${value}초`, { seconds: value }) : scrollText(key, fallback)}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="viewer-scroll-auto-actions">
                <span className={`viewer-scroll-auto-status ${autoScrolling ? 'is-running' : ''}`} role="status">
                    {autoScrolling
                        ? scrollText('auto_running', '자동 스크롤 중')
                        : scrollText('auto_stopped', '자동 스크롤 정지')}
                </span>
                <button
                    type="button"
                    className={`viewer-scroll-auto-toggle ${autoScrolling ? 'is-running' : ''}`}
                    onClick={onToggleAutoScroll}
                    disabled={disabled}
                    aria-pressed={Boolean(autoScrolling)}
                    title={autoScrolling ? scrollText('auto_stop', '정지') : scrollText('auto_start', '시작')}
                >
                    <FaIcon name={autoScrolling ? 'stopCircle' : 'play'} size={11} />
                    <span>{autoScrolling ? scrollText('auto_stop', '정지') : scrollText('auto_start', '시작')}</span>
                </button>
            </div>
        </div>
    );
}

export function ViewerScrollPopover({ open, onClose, ...options }) {
    if (!open) return null;

    return (
        <div
            id="viewer-scroll-menu"
            className="viewer-scroll-menu"
            role="dialog"
            aria-label={scrollText('title', '스크롤 설정')}
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }}
            onClick={event => event.stopPropagation()}
        >
            <ViewerScrollOptions {...options} compact />
            <button
                type="button"
                className="viewer-scroll-close"
                onClick={onClose}
                aria-label={scrollText('close', '스크롤 설정 닫기')}
                title={scrollText('close', '스크롤 설정 닫기')}
            >
                <FaIcon name="xmark" size={13} />
            </button>
        </div>
    );
}
