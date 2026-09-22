import { Fragment, Slice } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export const ASSET_DRAG = 'application/x-bookmanager-epub-asset';

export function readAssetDrag(dataTransfer, sessionId, assets) {
    try {
        const value = JSON.parse(dataTransfer.getData(ASSET_DRAG));
        if (value.sessionId !== sessionId) return null;
        return assets.find(asset => asset.id === value.assetId && ['image', 'audio'].includes(asset.kind)) || null;
    } catch { return null; }
}

export function assetContent(assets) {
    return assets.flatMap(asset => {
        if (asset.kind === 'image') return [{ type: 'image', attrs: { assetId: asset.id, width: 100, align: 'center', alt: '' } }];
        if (asset.kind === 'audio') return [{ type: 'audio', attrs: { assetId: asset.id, title: asset.name, kind: 'effect', loop: false } }];
        return [];
    });
}

export function assetDropTransaction(state, assets, position) {
    const nodes = assetContent(assets).map(content => state.schema.nodeFromJSON(content));
    if (!nodes.length || !Number.isInteger(position) || position < 0 || position > state.doc.content.size) return null;
    const tr = closeHistory(state.tr).replaceRange(position, position, new Slice(Fragment.fromArray(nodes), 0, 0));
    tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(position, 1))));
    return tr.scrollIntoView();
}
