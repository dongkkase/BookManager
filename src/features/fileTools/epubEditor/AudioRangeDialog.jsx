import React, { useEffect, useRef, useState } from 'react';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';
import { audioBlockChoices, captureAudioRangeSelection } from './audioRanges';
import { normalizeAudioVolume } from './audioNode';

export default function AudioRangeDialog({ editor, project, assetUrls, onImport, onApply, onClose }) {
    const [snapshot] = useState(() => captureAudioRangeSelection(editor.state));
    const [blocks] = useState(() => audioBlockChoices(editor.state.doc));
    const assets = project.assets.filter(asset => asset.kind === 'audio');
    const initial = snapshot.existing || { assetId: assets[0]?.id || '', title: assets[0]?.name || '', kind: 'effect', loop: false, controls: false, volume: 1 };
    const [draft, setDraft] = useState(initial);
    const [choice, setChoice] = useState(initial.assetId ? `asset:${initial.assetId}` : '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const busyRef = useRef(false);
    const player = useRef(null);
    const source = blocks.find(block => block.key === choice) || null;
    const volume = Math.round(normalizeAudioVolume(draft.volume) * 100);
    const patch = values => setDraft(current => ({ ...current, ...values }));
    useEffect(() => {
        if (player.current) player.current.volume = normalizeAudioVolume(draft.volume);
    }, [draft.volume, draft.assetId]);
    useEffect(() => {
        const audio = player.current;
        return () => { audio?.pause(); };
    }, []);
    const close = () => { if (!busyRef.current) onClose(); };
    const run = async operation => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        player.current?.pause();
        try { await operation(); }
        catch (failure) { setError(l(failure.code || 'error')); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const select = value => {
        setChoice(value);
        const block = blocks.find(item => item.key === value);
        if (block) patch({ assetId: block.attrs.assetId, title: block.attrs.title, kind: block.attrs.kind, controls: block.attrs.controls !== false, loop: block.attrs.loop === true, volume: normalizeAudioVolume(block.attrs.volume) });
        else {
            const asset = assets.find(item => `asset:${item.id}` === value);
            if (asset) patch({ assetId: asset.id, title: asset.name });
        }
    };
    const importAudio = () => run(async () => {
        const asset = await onImport();
        if (asset) { setChoice(`asset:${asset.id}`); patch({ assetId: asset.id, title: asset.name }); }
    });
    const submit = event => {
        event.preventDefault();
        if (snapshot.canAttach && draft.assetId) void run(() => onApply(snapshot, draft, source));
    };
    return <EditorDialog title={l(snapshot.existing ? 'editAudioRange' : 'attachAudio')} onClose={close} onSubmit={submit} className="ee-audio-range-dialog" footer={<>
        {error && <p className="ee-text-error" role="alert">{error}</p>}
        {snapshot.existing && <button type="button" className="ee-button ee-danger" disabled={busy} onClick={() => void run(() => onApply(snapshot, null))}>{l('unlinkAudioRange')}</button>}
        <button type="button" className="ee-button" disabled={busy} onClick={close}>{l('cancel')}</button>
        <button type="submit" className="ee-button ee-primary" disabled={busy || !snapshot.canAttach || !draft.assetId}>{l('apply')}</button>
    </>}>
        <p className="ee-muted">{l('audioRangeHint')}</p>
        <div className="ee-audio-range-summary"><strong>{l('audioRangeText')}</strong><p>{snapshot.text.slice(0, 600) || l('AUDIO_RANGE_SELECTION_REQUIRED')}{snapshot.text.length > 600 ? '…' : ''}</p></div>
        {!snapshot.canAttach && <p className="ee-text-error" role="status">{l(snapshot.restricted ? 'audioRangeRestricted' : snapshot.overlaps ? 'audioRangeOverlaps' : 'AUDIO_RANGE_SELECTION_REQUIRED')}</p>}
        <fieldset className="ee-audio-range-fields" disabled={busy || !snapshot.canAttach}>
            <label className="ee-field"><span>{l('audioRangeSource')}</span><select value={choice} onChange={event => select(event.target.value)}>
                {!choice && <option value="">{l('audioRangeChoose')}</option>}
                {blocks.length > 0 && <optgroup label={l('audioRangeInserted')}>{blocks.map(block => <option key={block.key} value={block.key}>{block.attrs.title || assets.find(asset => asset.id === block.attrs.assetId)?.name || l('audio')} · {l('audioRangeMove')}</option>)}</optgroup>}
                <optgroup label={l('assets')}>{assets.map(asset => <option key={asset.id} value={`asset:${asset.id}`}>{asset.name}</option>)}</optgroup>
            </select></label>
            <button type="button" className="ee-button" onClick={() => void importAudio()}>{l('audioRangeImport')}</button>
            {source && <p className="ee-muted">{l('audioRangeMoveHint')}</p>}
            <label className="ee-field"><span>{l('audioTitle')}</span><input value={draft.title} maxLength={2000} onChange={event => patch({ title: event.target.value })} /></label>
            <label className="ee-field"><span>{l('audioKind')}</span><select value={draft.kind} onChange={event => patch({ kind: event.target.value })}><option value="effect">{l('effect')}</option><option value="background">{l('backgroundAudio')}</option></select></label>
            <label className="ee-check"><input type="checkbox" checked={draft.controls} onChange={event => patch({ controls: event.target.checked })} />{l('audioControls')}</label>
            <label className="ee-check"><input type="checkbox" checked={draft.loop} onChange={event => patch({ loop: event.target.checked })} />{l('loop')}</label>
            <label className="ee-field"><span>{l('audioVolume')}</span><div className="ee-range ee-audio-volume"><input type="range" aria-label={l('audioVolume')} aria-valuetext={`${volume}%`} min={0} max={100} step={1} value={volume} onChange={event => patch({ volume: Number(event.target.value) / 100 })} /><output>{volume}%</output></div></label>
            <audio ref={player} controls preload="none" src={assetUrls[draft.assetId]} loop={draft.loop} aria-label={l('audioRangeListen')} />
        </fieldset>
        {busy && <p className="ee-muted" role="status">{l('working')}</p>}
    </EditorDialog>;
}
