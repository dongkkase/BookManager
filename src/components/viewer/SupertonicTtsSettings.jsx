import React, { useRef, useState } from 'react';
import {
    SUPERTONIC_READING_PRESETS, applySupertonicReadingPreset, normalizeSupertonicReading,
    supertonicReadingPresetId, validateSupertonicStyle,
} from '../../../electron/supertonicReading.js';

export function SupertonicTtsSettings({ value, voices, baseVoice, text, onChange, onPreview }) {
    const [importError, setImportError] = useState('');
    const [importing, setImporting] = useState(false);
    const valueRef = useRef(value);
    valueRef.current = value;
    const t = (key, fallback) => text(`viewer.tts.supertonic_details.${key}`, fallback);
    const patch = changes => onChange({ ...valueRef.current, ...changes });
    const patchProfile = (name, changes) => patch({ [name]: { ...valueRef.current[name], ...changes } });
    const importStyle = async (event, name) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setImportError('');
        setImporting(true);
        try {
            if (file.size > 1024 * 1024) throw new Error('Style file too large.');
            const data = validateSupertonicStyle(JSON.parse(await file.text()));
            patchProfile(name, { customStyle: { id: crypto.randomUUID(), name: file.name, data } });
        } catch {
            setImportError(t('import_error', '1MB 이하의 올바른 Supertonic 3 스타일 JSON 파일을 선택하세요.'));
        } finally {
            setImporting(false);
        }
    };
    const range = (label, number, min, max, step, onValue, unit = '') => (
        <label className="viewer-supertonic-range">
            <span>{label}</span>
            <input type="range" min={min} max={max} step={step} value={number}
                aria-label={label} onChange={event => onValue(Number(event.target.value))} />
            <output>{Number(number.toFixed(2))}{unit}</output>
        </label>
    );
    return (
        <details className="viewer-supertonic-settings">
            <summary>{t('title', 'Supertonic 낭독 스타일')}</summary>
            <div className="viewer-supertonic-settings-body">
                <p>{t('description', '일반 문장과 대사에 사용할 스타일을 선택하세요. 선택한 음성에 스타일별 속도와 쉼을 적용합니다.')}</p>
                <label className="viewer-supertonic-check">
                    <input type="checkbox" checked={value.dialogueEnabled}
                        onChange={event => patch({ dialogueEnabled: event.target.checked })} />
                    {t('dialogue_enabled', '따옴표 안의 대사 자동 구분')}
                </label>
                <div className="viewer-supertonic-profiles">
                    {['narration', 'dialogue'].map(name => {
                        const profile = value[name];
                        const label = name === 'narration' ? t('narration', '일반 문장') : t('dialogue', '대사');
                        const presetId = supertonicReadingPresetId(profile);
                        return (
                            <fieldset key={name} disabled={importing || (name === 'dialogue' && !value.dialogueEnabled)}>
                                <legend>{label}</legend>
                                <label className="viewer-supertonic-voice">
                                    <span>{t('style', '낭독 스타일')}</span>
                                    <select value={presetId} aria-label={`${label} ${t('style', '낭독 스타일')}`}
                                        onChange={event => {
                                            setImportError('');
                                            patch({ [name]: applySupertonicReadingPreset(valueRef.current[name], event.target.value) });
                                        }}>
                                        {SUPERTONIC_READING_PRESETS.map(preset => (
                                            <option key={preset.id} value={preset.id}>{t(`presets.${preset.id}`, preset.id)}</option>
                                        ))}
                                        {!presetId && <option value="" disabled>{profile.customStyle
                                            ? t('imported_style', '가져온 스타일') : t('manual_style', '직접 설정')}</option>}
                                    </select>
                                </label>
                                <label className="viewer-supertonic-voice">
                                    <span>{t('voice', '음성')}</span>
                                    <select value={profile.customStyle ? 'custom' : profile.voice}
                                        aria-label={`${label} ${t('voice', '음성')}`}
                                        onChange={event => patchProfile(name, { voice: event.target.value, customStyle: null })}>
                                        <option value="">{t('base_voice', '선택한 기본 음성')} ({voices.find(voice => voice.id === baseVoice)?.label})</option>
                                        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                                        {profile.customStyle && <option value="custom">{profile.customStyle.name}</option>}
                                    </select>
                                </label>
                                <p className="viewer-supertonic-preset-summary">
                                    {profile.speed}× · {t('pause_short', '쉼')} {profile.pause}{t('seconds', '초')}
                                </p>
                                <div className="viewer-supertonic-profile-actions">
                                    <button type="button" aria-label={`${label} ${t('preview', '미리듣기')}`}
                                        onClick={() => onPreview(name)}>{t('preview', '미리듣기')}</button>
                                </div>
                                <details className="viewer-supertonic-advanced">
                                    <summary>{t('advanced', '고급 설정')}</summary>
                                    {range(t('speed', '낭독 속도'), profile.speed, 0.5, 2, 0.05,
                                        speed => patchProfile(name, { speed }), '×')}
                                    {range(t('pause', '구간 사이 쉼'), profile.pause, 0, 1.5, 0.01,
                                        pause => patchProfile(name, { pause }), t('seconds', '초'))}
                                    <label className="viewer-supertonic-import">
                                        {t('import_style', '스타일 가져오기')}
                                        <input type="file" accept=".json,application/json" disabled={importing}
                                            aria-label={`${label} ${t('import_style', '스타일 가져오기')}`}
                                            onChange={event => void importStyle(event, name)} />
                                    </label>
                                    {profile.customStyle && (
                                        <div className="viewer-supertonic-custom">
                                            <span title={profile.customStyle.name}>{profile.customStyle.name}</span>
                                            <button type="button" onClick={() => patchProfile(name, { customStyle: null })}>
                                                {t('remove_style', '해제')}
                                            </button>
                                        </div>
                                    )}
                                    <p>{t('style_hint', '별도로 준비한 Supertonic 3 스타일 JSON이 있을 때만 가져오기를 사용하세요.')}</p>
                                </details>
                            </fieldset>
                        );
                    })}
                </div>
                <p>{t('playback_hint', '전체 재생 배속은 위쪽 속도 설정에서 조절합니다.')}</p>
                {importError && <p role="alert" className="viewer-supertonic-error">{importError}</p>}
                <label className="viewer-supertonic-effect-mode">
                    <span>{t('effects', '비명 표현')}</span>
                    <select value={value.effectsMode} onChange={event => patch({ effectsMode: event.target.value })}>
                        <option value="original">{t('effects_original', '원문대로 읽기')}</option>
                        <option value="shorten">{t('effects_shorten', '짧고 작게 읽기')}</option>
                        <option value="skip">{t('effects_skip', '생략')}</option>
                    </select>
                </label>
                <p>{t('effects_hint', '아아악·으아악처럼 인식되는 비명에만 적용합니다. 웃음과 책의 원문은 유지합니다.')}</p>
                {value.effectsMode === 'shorten' && (
                    <div className="viewer-supertonic-effects">
                        <label className="viewer-supertonic-check">
                            <input type="checkbox" checked={value.effectsSoften}
                                onChange={event => patch({ effectsSoften: event.target.checked })} />
                            {t('soften', '비명 고음 완화')}
                        </label>
                        {range(t('volume', '비명 음량'), value.effectsVolume * 100, 10, 100, 5,
                            volume => patch({ effectsVolume: volume / 100 }), '%')}
                        {range(t('max_seconds', '비명 최대 길이'), value.effectsMaxSeconds, 0.5, 5, 0.5,
                            effectsMaxSeconds => patch({ effectsMaxSeconds }), t('seconds', '초'))}
                    </div>
                )}
                {range(t('steps', '합성 단계'), value.totalStep, 2, 12, 1, totalStep => patch({ totalStep }))}
                <p>{t('steps_hint', '단계가 높을수록 생성 시간이 늘어납니다. 기본값은 8입니다.')}</p>
                <div className="viewer-supertonic-footer">
                    <button type="button" onClick={() => onPreview('sample')}>{t('sample', '일반 문장·대사·비명 미리듣기')}</button>
                    <button type="button" disabled={importing} onClick={() => {
                        setImportError('');
                        onChange(normalizeSupertonicReading());
                    }}>{t('reset', '초기화')}</button>
                </div>
            </div>
        </details>
    );
}
