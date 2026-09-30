import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

export function normalizeAudioVolume(value) {
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return 1;
    const volume = Number(value);
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
}

export function createAudioExtension(getAssetUrl, label = key => key) {
    return Node.create({
        name: 'audio', group: 'block', atom: true, draggable: true,
        addAttributes() {
            return {
                assetId: { default: '' }, title: { default: '' }, kind: { default: 'effect' },
                loop: { default: false }, controls: { default: true }, volume: { default: 1 },
            };
        },
        parseHTML() {
            return [{ tag: 'figure[data-audio-asset]', getAttrs: element => {
                const assetId = element.getAttribute('data-audio-asset');
                if (!getAssetUrl(assetId)) return false;
                const audio = element.querySelector('audio');
                const controls = element.getAttribute('data-bookmanager-audio-controls') ?? audio?.getAttribute('data-bookmanager-audio-controls');
                return {
                    assetId, title: element.getAttribute('data-title') || '',
                    kind: element.getAttribute('data-kind') === 'background' ? 'background' : 'effect',
                    loop: element.getAttribute('data-loop') === 'true',
                    controls: controls !== 'false',
                    volume: normalizeAudioVolume(audio?.getAttribute('data-bookmanager-audio-volume') ?? element.getAttribute('data-bookmanager-audio-volume')),
                };
            } }];
        },
        renderHTML({ node }) {
            const attrs = node.attrs;
            const controls = String(attrs.controls !== false);
            const volume = normalizeAudioVolume(attrs.volume);
            return ['figure', {
                'data-audio-asset': attrs.assetId, 'data-title': attrs.title, 'data-kind': attrs.kind, 'data-loop': String(attrs.loop),
                'data-bookmanager-audio-controls': controls, 'data-bookmanager-audio-volume': volume, class: 'ee-audio-node',
            }, ['figcaption', {}, attrs.title || label('audio')], ['audio', {
                src: getAssetUrl(attrs.assetId), preload: 'none',
                'data-bookmanager-audio-kind': attrs.kind, 'data-bookmanager-audio-controls': controls, 'data-bookmanager-audio-volume': volume,
                ...(attrs.controls !== false ? { controls: 'controls' } : {}), ...(attrs.loop ? { loop: 'loop' } : {}),
            }]];
        },
        addNodeView() {
            return ({ node, editor, getPos }) => {
                const dom = document.createElement('figure');
                dom.className = 'ee-audio-node';
                dom.contentEditable = 'false';
                const caption = document.createElement('figcaption');
                caption.tabIndex = 0;
                caption.setAttribute('role', 'button');
                caption.setAttribute('aria-label', label('audioProperties'));
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.preload = 'none';
                const select = () => {
                    if (editor.isDestroyed || !editor.isEditable) return;
                    const pos = getPos();
                    if (typeof pos !== 'number') return;
                    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false));
                    editor.view.focus();
                };
                caption.addEventListener('click', select);
                caption.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    select();
                });
                const draw = () => {
                    caption.textContent = `${label(node.attrs.kind === 'background' ? 'backgroundAudio' : 'effect')} · ${node.attrs.title || label('audio')}`;
                    const url = getAssetUrl(node.attrs.assetId) || '';
                    if (audio.getAttribute('src') !== url) audio.src = url;
                    audio.loop = node.attrs.loop === true;
                    audio.volume = normalizeAudioVolume(node.attrs.volume);
                };
                dom.append(caption, audio);
                draw();
                return {
                    dom,
                    update(next) { if (next.type.name !== 'audio') return false; node = next; draw(); return true; },
                    stopEvent(event) { return event.target === audio || event.target === caption; },
                    ignoreMutation() { return true; },
                    destroy() { audio.pause(); audio.removeAttribute('src'); audio.load(); },
                };
            };
        },
    });
}
