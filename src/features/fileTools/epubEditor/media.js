import { Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { parseMediaUrl } from '../../../../electron/epubEditor/authoring.js';
import { editorText as l } from './labels.js';

export const Media = Node.create({
    name: 'media', group: 'block', atom: true, draggable: true,
    addAttributes() { return { url: { default: '' }, title: { default: '' } }; },
    parseHTML() {
        return [{ tag: 'figure[data-media-url]', getAttrs: element => {
            const media = parseMediaUrl(element.getAttribute('data-media-url'));
            return media ? { url: media.url, title: (element.getAttribute('data-title') || '').slice(0, 2000) } : false;
        } }];
    },
    renderHTML({ node }) {
        return ['figure', { 'data-media-url': node.attrs.url, 'data-title': node.attrs.title, class: 'ee-media-node' }, ['figcaption', {}, node.attrs.title || parseMediaUrl(node.attrs.url)?.provider || l('media')], ['a', { href: node.attrs.url }, node.attrs.url]];
    },
    addNodeView() {
        return ({ node, editor }) => {
            const dom = document.createElement('figure');
            dom.className = 'ee-media-node';
            const caption = document.createElement('figcaption');
            const address = document.createElement('div');
            address.className = 'ee-media-address';
            const player = document.createElement('div');
            const controls = document.createElement('div');
            controls.className = 'ee-media-controls';
            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'ee-button';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'ee-button';
            open.textContent = l('openMedia');
            let playing = false;
            const draw = () => {
                const media = parseMediaUrl(node.attrs.url);
                caption.textContent = node.attrs.title || media?.provider || l('media');
                address.textContent = media?.url || '';
                play.textContent = l(playing ? 'stopMedia' : 'playMedia');
                player.replaceChildren();
                if (playing && media) {
                    const frame = document.createElement('iframe');
                    frame.src = media.embed;
                    frame.title = node.attrs.title || media.provider;
                    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
                    frame.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
                    frame.setAttribute('allowfullscreen', '');
                    frame.referrerPolicy = 'strict-origin-when-cross-origin';
                    player.append(frame);
                }
            };
            const stop = () => { if (playing) { playing = false; draw(); } };
            editor.on('mediaPlaybackStop', stop);
            play.addEventListener('click', () => { if (!playing) editor.emit('mediaPlaybackStop'); playing = !playing; draw(); });
            open.addEventListener('click', () => { const media = parseMediaUrl(node.attrs.url); if (media) window.electronAPI?.openExternal?.(media.url); });
            controls.append(play, open);
            dom.append(caption, address, player, controls);
            draw();
            return {
                dom,
                update(next) { if (next.type.name !== 'media') return false; const changed = next.attrs.url !== node.attrs.url || next.attrs.title !== node.attrs.title; node = next; if (changed) { playing = false; draw(); } return true; },
                stopEvent: event => !!event.target.closest('button, iframe'),
                ignoreMutation: () => true,
                destroy() { editor.off('mediaPlaybackStop', stop); player.replaceChildren(); },
            };
        };
    },
    addProseMirrorPlugins() {
        const editor = this.editor;
        return [new Plugin({ props: { handlePaste: (view, event) => {
            if (view.state.selection.$from.parent.type.name === 'codeBlock') return false;
            const media = parseMediaUrl(event.clipboardData?.getData('text/plain'));
            if (!media) return false;
            return editor.commands.insertContent({ type: 'media', attrs: { url: media.url, title: '' } });
        } } })];
    },
});
