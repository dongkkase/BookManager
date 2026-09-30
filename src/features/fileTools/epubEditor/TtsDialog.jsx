import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../../../electron/epubEditor/model';
import { TTS_LIMITS } from '../../../../electron/epubEditor/tts';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { ttsText as t } from './ttsLabels';
import { captureTtsSelection, draftTtsPreview, ttsDraftError } from './ttsDialogState';
import './tts.css';

const DISPLAY_LIMIT = 12000;
const SPEECH_LIMIT = 4000;

function previewChunks(text) {
    const chunks = [];
    let remaining = text.slice(0, SPEECH_LIMIT).replace(/[\uD800-\uDBFF]$/, '');
    while (remaining) {
        const part = remaining.slice(0, 300);
        const boundary = [...part.matchAll(/[.!?。！？\n]\s*/gu)].at(-1);
        let end = boundary && boundary.index > 80 ? boundary.index + boundary[0].length : part.length;
        if (/[\uD800-\uDBFF]/u.test(remaining[end - 1] || '')) end -= 1;
        chunks.push(remaining.slice(0, end));
        remaining = remaining.slice(end);
    }
    return chunks;
}

export default function TtsDialog({ editor, project, onApply, onClose, onPreviewViewer }) {
    const [snapshot] = useState(() => captureTtsSelection(editor.state));
    const [initialDictionary] = useState(() => (project.tts?.dictionary || []).map(entry => ({ ...entry })));
    const [dictionary, setDictionary] = useState(initialDictionary);
    const [mode, setMode] = useState(snapshot.annotation?.mode || 'auto');
    const [replacement, setReplacement] = useState(snapshot.annotation?.text || '');
    const [annotationTouched, setAnnotationTouched] = useState(false);
    const [annotationId] = useState(() => snapshot.annotation?.id || newId('tts'));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [speaking, setSpeaking] = useState(false);
    const [speechError, setSpeechError] = useState(false);
    const busyRef = useRef(false);
    const mounted = useRef(true);
    const speechToken = useRef(0);
    const speechActive = useRef(false);
    const utteranceRef = useRef(null);
    const dictionaryList = useRef(null);
    const focusAddedEntry = useRef(false);
    const speechSupported = typeof window !== 'undefined' && Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    const annotation = useMemo(() => annotationTouched && snapshot.canAnnotate ? {
        id: annotationId, from: snapshot.from, to: snapshot.to, mode, text: mode === 'replace' ? replacement : '',
    } : null, [annotationId, annotationTouched, mode, replacement, snapshot]);
    const validation = useMemo(() => ttsDraftError(dictionary, annotation), [annotation, dictionary]);
    const preview = useMemo(() => draftTtsPreview(snapshot, dictionary, annotation, { assets: project.assets }), [annotation, dictionary, project.assets, snapshot]);
    const dirty = Boolean(annotation || JSON.stringify(dictionary) !== JSON.stringify(initialDictionary));

    const stopSpeech = useCallback(() => {
        speechToken.current += 1;
        if (speechActive.current) window.speechSynthesis?.cancel();
        speechActive.current = false;
        utteranceRef.current = null;
        setSpeaking(false);
    }, []);
    useEffect(() => {
        stopSpeech();
        setSpeechError(false);
    }, [annotation, dictionary, preview.text, stopSpeech]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            speechToken.current += 1;
            if (speechActive.current) window.speechSynthesis?.cancel();
            speechActive.current = false;
            utteranceRef.current = null;
        };
    }, []);
    useEffect(() => {
        if (!focusAddedEntry.current) return;
        focusAddedEntry.current = false;
        dictionaryList.current?.lastElementChild?.querySelector('input')?.focus();
    }, [dictionary.length]);

    const speak = () => {
        if (!speechSupported || !preview.text || validation) return;
        stopSpeech();
        setSpeechError(false);
        const token = speechToken.current;
        const chunks = previewChunks(preview.text);
        const language = project.metadata.language || 'ko';
        const voices = window.speechSynthesis.getVoices();
        const candidates = voices.filter(voice => voice.lang.toLowerCase().split(/[-_]/)[0] === language.toLowerCase().split(/[-_]/)[0]);
        const voice = candidates.find(item => item.default) || candidates.find(item => item.localService) || candidates[0];
        const next = index => {
            if (speechToken.current !== token) return;
            if (index >= chunks.length) { stopSpeech(); return; }
            const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
            utterance.lang = language;
            if (voice) utterance.voice = voice;
            utterance.onend = () => next(index + 1);
            utterance.onerror = () => {
                if (speechToken.current !== token) return;
                stopSpeech();
                setSpeechError(true);
            };
            utteranceRef.current = utterance;
            speechActive.current = true;
            setSpeaking(true);
            try { window.speechSynthesis.speak(utterance); }
            catch { stopSpeech(); setSpeechError(true); }
        };
        next(0);
    };
    const close = () => {
        if (busyRef.current) return;
        stopSpeech();
        onClose();
    };
    const run = async operation => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        stopSpeech();
        try { await operation(); }
        catch { if (mounted.current) setError(t('error')); }
        finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    const submit = event => {
        event.preventDefault();
        if (validation) { setError(t(validation)); return; }
        void run(() => onApply({ dictionary, annotation }));
    };
    const changeMode = next => {
        setMode(next);
        setAnnotationTouched(true);
        setError(null);
    };
    const updateEntry = (id, field, value) => {
        setDictionary(entries => entries.map(entry => entry.id === id ? { ...entry, [field]: value } : entry));
        setError(null);
    };
    const addEntry = () => {
        if (dictionary.length >= TTS_LIMITS.dictionary) return;
        focusAddedEntry.current = true;
        setDictionary(entries => [...entries, { id: newId('tts'), source: '', replacement: '' }]);
    };

    return <EditorDialog title={t('title')} onClose={close} className="ee-tts-dialog" onSubmit={submit} footer={<>
        {(error || validation) && <p className="ee-tts-error" role="alert">{error || t(validation)}</p>}
        {busy && <p className="ee-muted" role="status">{l('working')}</p>}
        <div className="ee-tts-footer-actions">
            {onPreviewViewer && <button type="button" className="ee-button" disabled={busy || dirty} title={dirty ? t('applyFirst') : t('viewer')} onClick={() => void run(onPreviewViewer)}>{t('viewer')}</button>}
            <div><button type="button" className="ee-button" disabled={busy} onClick={close}>{l('cancel')}</button><button type="submit" className="ee-button ee-primary" disabled={busy || Boolean(validation)}>{l('apply')}</button></div>
        </div>
        {dirty && onPreviewViewer && <p className="ee-muted">{t('applyFirst')}</p>}
    </>}>
        <p className="ee-muted">{t('intro')}</p>
        <fieldset className="ee-tts-fields" disabled={busy}>
            <section className="ee-tts-selection">
                <h3>{t('selectionMode')}</h3>
                {!snapshot.selected ? <p className="ee-muted">{t('noSelection')}</p> : !snapshot.canAnnotate ? <p className="ee-muted">{t('selectionRestricted')}</p> : <>
                    {snapshot.expanded && <p className="ee-muted">{t('selectionExpanded')}</p>}
                    {snapshot.mixed && !annotationTouched && <p className="ee-muted">{t('selectionMixed')}</p>}
                    <div className="ee-tts-modes" role="group" aria-label={t('selectionMode')}>
                        {['auto', 'read', 'replace', 'skip'].map(value => <button key={value} type="button" className="ee-button" aria-pressed={(!snapshot.mixed || annotationTouched) && mode === value} onClick={() => changeMode(value)}>{t(value)}</button>)}
                    </div>
                    <p className="ee-muted">{t(`${mode}Hint`)}</p>
                    {mode === 'replace' && <label className="ee-field"><span>{t('replacement')}</span><textarea rows={3} required maxLength={TTS_LIMITS.replacement} placeholder={t('replacementPlaceholder')} value={replacement} onChange={event => { setReplacement(event.target.value); setAnnotationTouched(true); setError(null); }} /></label>}
                </>}
            </section>
            <section className="ee-tts-preview" aria-label={t('scope')}>
                <h3>{t('scope')} · {t(snapshot.selected ? 'selected' : 'chapter')}</h3>
                <div className="ee-tts-comparison">
                    <label className="ee-field"><span>{t('source')}</span><textarea readOnly rows={7} value={preview.original.slice(0, DISPLAY_LIMIT)} /></label>
                    <label className="ee-field"><span>{t('spoken')}</span><textarea readOnly rows={7} value={preview.text.slice(0, DISPLAY_LIMIT)} placeholder={t('emptyPreview')} /></label>
                </div>
                {(preview.original.length > DISPLAY_LIMIT || preview.text.length > DISPLAY_LIMIT) && <p className="ee-muted">{t('previewLimit').replace('{count}', DISPLAY_LIMIT.toLocaleString())}</p>}
                <div className="ee-tts-listen"><button type="button" className="ee-button" disabled={!speechSupported || !preview.text || Boolean(validation)} onClick={speaking ? stopSpeech : speak}>{t(speaking ? 'stop' : 'systemPreview')}</button>{speaking && <span className="ee-muted" role="status">{t('playing')}</span>}</div>
                <p className="ee-muted">{t(speechSupported ? 'systemHint' : 'unsupported')}</p>
                {preview.text.length > SPEECH_LIMIT && <p className="ee-muted">{t('speechLimit').replace('{count}', SPEECH_LIMIT.toLocaleString())}</p>}
                {speechError && <p className="ee-tts-error" role="alert">{t('speechError')}</p>}
            </section>
            <section className="ee-tts-dictionary">
                <div className="ee-tts-dictionary-heading"><h3>{t('dictionary')} <small>{dictionary.length} / {TTS_LIMITS.dictionary}</small></h3><button type="button" className="ee-button" disabled={dictionary.length >= TTS_LIMITS.dictionary} onClick={addEntry}>{t('add')}</button></div>
                <p className="ee-muted">{t('dictionaryHint')}</p>
                {!dictionary.length && <p className="ee-muted ee-tts-empty">{t('dictionaryEmptyState')}</p>}
                <div className="ee-tts-dictionary-list" ref={dictionaryList}>
                    {dictionary.map((entry, index) => <div className="ee-tts-dictionary-row" key={entry.id}>
                        <label className="ee-field"><span>{t('dictionarySource')} {index + 1}</span><input required maxLength={TTS_LIMITS.source} value={entry.source} onChange={event => updateEntry(entry.id, 'source', event.target.value)} /></label>
                        <label className="ee-field"><span>{t('dictionaryReplacement')} {index + 1}</span><input required maxLength={TTS_LIMITS.replacement} value={entry.replacement} onChange={event => updateEntry(entry.id, 'replacement', event.target.value)} /></label>
                        <button type="button" className="ee-button" aria-label={`${t('remove')} ${index + 1}`} onClick={() => { setDictionary(entries => entries.filter(item => item.id !== entry.id)); setError(null); }}>{l('remove')}</button>
                    </div>)}
                </div>
            </section>
        </fieldset>
    </EditorDialog>;
}
