import { Mark } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { newId, projectError } from '../../../../electron/epubEditor/model.js';
import { normalizeAudioVolume } from './audioNode.js';

function rangeMark(node) {
    return node?.marks.find(mark => mark.type.name === 'audioRange');
}

export function audioRangeAtSelection(state) {
    const { selection } = state;
    if (!(selection instanceof TextSelection)) return null;
    if (selection.empty) return rangeMark(selection.$from.nodeAfter)?.attrs || selection.$from.marks().find(mark => mark.type.name === 'audioRange')?.attrs || rangeMark(selection.$from.nodeBefore)?.attrs || null;
    let attrs = null;
    let mixed = false;
    state.doc.nodesBetween(selection.from, selection.to, node => {
        if (!node.isText) return;
        const mark = rangeMark(node);
        if (!mark || (attrs && attrs.id !== mark.attrs.id)) mixed = true;
        else attrs = mark.attrs;
    });
    return mixed ? null : attrs;
}

export function captureAudioRangeSelection(state) {
    const { doc, selection, schema } = state;
    const existing = audioRangeAtSelection(state);
    const segments = [];
    let restricted = false;
    let overlaps = false;
    const inspect = (node, position, parent) => {
        if (!node.isText && node.type.name !== 'hardBreak') return;
        const mark = rangeMark(node);
        if (existing) {
            if (mark?.attrs.id === existing.id) segments.push({ from: position, to: position + node.nodeSize, text: node.isText ? node.text : '\n' });
            return;
        }
        if (!parent?.type.allowsMarkType(schema.marks.audioRange) || node.marks.some(item => item.type.name === 'code')) restricted = true;
        if (mark) overlaps = true;
        const from = Math.max(position, selection.from);
        const to = Math.min(position + node.nodeSize, selection.to);
        if (from < to) segments.push({ from, to, text: node.isText ? node.text.slice(from - position, to - position) : '\n' });
    };
    if (existing) doc.descendants(inspect);
    else if (selection instanceof TextSelection && !selection.empty) doc.nodesBetween(selection.from, selection.to, inspect);
    return {
        doc, from: selection.from, to: selection.to, existing: existing ? { ...existing } : null,
        canAttach: !!schema.marks.audioRange && (existing ? segments.length > 0 : segments.some(segment => segment.text.trim())) && !restricted && !overlaps,
        restricted, overlaps,
        text: segments.map((segment, index) => `${index && segments[index - 1].to !== segment.from ? '\n' : ''}${segment.text}`).join(''),
    };
}

export function audioBlockChoices(doc) {
    const blocks = [];
    doc.descendants((node, position) => {
        if (node.type.name === 'audio') blocks.push({ key: `block:${position}`, position, node, attrs: { ...node.attrs } });
    });
    return blocks;
}

export function audioRangeTransaction(state, snapshot, settings, source = null) {
    if (!snapshot.doc.eq(state.doc)) throw projectError('AUDIO_RANGE_CHANGED');
    const type = state.schema.marks.audioRange;
    if (!type || !snapshot.canAttach) throw projectError('AUDIO_RANGE_SELECTION_REQUIRED');
    const tr = closeHistory(state.tr);
    if (source) {
        const node = tr.doc.nodeAt(source.position);
        if (!node || node.type.name !== 'audio' || !node.eq(source.node)) throw projectError('AUDIO_RANGE_CHANGED');
        tr.delete(source.position, source.position + node.nodeSize);
    }
    const from = tr.mapping.map(snapshot.from, 1);
    const to = tr.mapping.map(snapshot.to, -1);
    const attrs = settings ? {
        id: snapshot.existing?.id || newId('ar'), assetId: settings.assetId, title: settings.title || '',
        kind: settings.kind === 'background' ? 'background' : 'effect', loop: settings.loop === true,
        controls: settings.controls === true, volume: normalizeAudioVolume(settings.volume),
    } : null;
    if (attrs && (!attrs.assetId || attrs.title.length > 2000)) throw projectError('INVALID_DOCUMENT');
    if (snapshot.existing) {
        tr.doc.descendants((node, position) => {
            if ((!node.isText && node.type.name !== 'hardBreak') || rangeMark(node)?.attrs.id !== snapshot.existing.id) return;
            tr.removeMark(position, position + node.nodeSize, type);
            if (attrs) tr.addMark(position, position + node.nodeSize, type.create(attrs));
        });
    } else {
        if (!attrs) return tr;
        tr.doc.nodesBetween(from, to, (node, position) => {
            if (node.isText || node.type.name === 'hardBreak') tr.addMark(Math.max(from, position), Math.min(to, position + node.nodeSize), type.create(attrs));
        });
    }
    return tr.setSelection(TextSelection.create(tr.doc, from, to)).removeStoredMark(type);
}

function rangeDecorations(doc, label) {
    const seen = new Set();
    const decorations = [];
    doc.descendants((node, position) => {
        const mark = node.isText && rangeMark(node);
        if (!mark || seen.has(mark.attrs.id)) return;
        seen.add(mark.attrs.id);
        const title = `${label('audioRange')} · ${mark.attrs.title || label('audio')}`;
        decorations.push(Decoration.widget(position, () => {
            const badge = document.createElement('span');
            badge.className = 'ee-audio-range-badge';
            badge.textContent = '♫';
            badge.title = title;
            badge.setAttribute('aria-label', title);
            badge.contentEditable = 'false';
            return badge;
        }, { side: -1, key: `${mark.attrs.id}:${title}` }));
    });
    return DecorationSet.create(doc, decorations);
}

export function createAudioRangeExtension(getAssetUrl, label = key => key) {
    return Mark.create({
        name: 'audioRange', inclusive: false, clearable: false,
        addAttributes() {
            return Object.fromEntries(Object.entries({ id: null, assetId: '', title: '', kind: 'effect', loop: false, controls: false, volume: 1 }).map(([key, value]) => [key, { default: value, rendered: false, parseHTML: () => null }]));
        },
        parseHTML() {
            return [{ tag: 'span[data-bookmanager-audio-range]', getAttrs: element => {
                const assetId = element.getAttribute('data-bookmanager-audio-asset');
                if (!getAssetUrl(assetId)) return false;
                const id = element.getAttribute('data-bookmanager-audio-range');
                return {
                    id: /^[a-z][a-z0-9_-]{0,79}$/i.test(id || '') ? id : newId('ar'), assetId,
                    title: (element.getAttribute('data-bookmanager-audio-title') || '').slice(0, 2000),
                    kind: element.getAttribute('data-bookmanager-audio-kind') === 'background' ? 'background' : 'effect',
                    loop: element.getAttribute('data-bookmanager-audio-loop') === 'true',
                    controls: element.getAttribute('data-bookmanager-audio-controls') === 'true',
                    volume: normalizeAudioVolume(element.getAttribute('data-bookmanager-audio-volume')),
                };
            } }];
        },
        renderHTML({ mark }) {
            const attrs = mark.attrs;
            return ['span', {
                'data-bookmanager-audio-range': attrs.id, 'data-bookmanager-audio-asset': attrs.assetId,
                'data-bookmanager-audio-title': attrs.title, 'data-bookmanager-audio-kind': attrs.kind,
                'data-bookmanager-audio-loop': String(attrs.loop), 'data-bookmanager-audio-controls': String(attrs.controls),
                'data-bookmanager-audio-volume': normalizeAudioVolume(attrs.volume), class: 'ee-audio-range',
                title: `${label('audioRange')} · ${attrs.title || label('audio')}`,
            }, 0];
        },
        addProseMirrorPlugins() {
            return [new Plugin({
                state: {
                    init: (_, state) => rangeDecorations(state.doc, label),
                    apply: (transaction, decorations) => transaction.docChanged ? rangeDecorations(transaction.doc, label) : decorations,
                },
                props: {
                    decorations(state) { return this.getState(state); },
                    transformPasted(slice) {
                        const ids = new Map();
                        const remap = fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, index) => {
                            const node = fragment.child(index);
                            const marks = node.marks.map(mark => {
                                if (mark.type.name !== 'audioRange') return mark;
                                if (!ids.has(mark.attrs.id)) ids.set(mark.attrs.id, { ...mark.attrs, id: newId('ar') });
                                return mark.type.create(ids.get(mark.attrs.id));
                            });
                            return (node.isLeaf ? node : node.copy(remap(node.content))).mark(marks);
                        }));
                        return new slice.constructor(remap(slice.content), slice.openStart, slice.openEnd);
                    },
                },
            })];
        },
    });
}
