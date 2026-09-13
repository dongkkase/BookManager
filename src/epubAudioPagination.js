const textLength = text => String(text || '').replace(/\s/gu, '').length;

function visitNodes(nodes, callback) {
    for (const node of nodes) {
        callback(node);
        visitNodes(node.children || [], callback);
    }
}

export function epubAudioBlockNodes(block) {
    const nodes = block.nodes || [];
    const ids = new Set();
    visitNodes(nodes, node => { if (node.id) ids.add(node.id); });
    const markers = (block.anchors || []).filter(anchor => !ids.has(anchor)).map(id => ({ type: 'element', tagName: 'span', id, children: [] }));
    if (!markers.length) return nodes;
    const first = nodes[0];
    return first?.type === 'element' && !first.audioTrackId && !['img', 'br', 'hr'].includes(first.tagName)
        ? [{ ...first, children: [...markers, ...(first.children || [])] }, ...nodes.slice(1)]
        : [...markers, ...nodes];
}

export function separateEpubAudioBlockImages(block, imageNodes) {
    const imageIds = new Set();
    const stripImageWrapperAnchors = node => {
        if (node.tagName === 'img' || node.src) {
            if (node.id) imageIds.add(node.id);
            return node;
        }
        return { ...node, id: undefined, children: (node.children || []).map(stripImageWrapperAnchors) };
    };
    const images = imageNodes.map(stripImageWrapperAnchors);
    const withoutImages = node => node.tagName === 'img' || node.src ? null : {
        ...node,
        children: (node.children || []).map(withoutImages).filter(Boolean),
    };
    const nodes = (block.nodes || []).map(withoutImages).filter(Boolean);
    const audioTracks = [];
    visitNodes(nodes, node => { if (node.audioTrackId) audioTracks.push(node.audioTrackId); });
    return {
        image: { nodes: images, anchors: [...imageIds], audioTracks: [] },
        text: { nodes, anchors: (block.anchors || []).filter(anchor => !imageIds.has(anchor)), audioTracks },
    };
}

export function sliceEpubAudioBlock(block, text, textOffset = 0) {
    const start = Math.max(0, textOffset);
    const end = start + textLength(text);
    const last = end >= textLength(block.text);
    const owns = offset => offset >= start && (offset < end || (last && offset === end));
    const sourceAnchors = new Set();
    const anchors = new Set();
    const audioTracks = new Set();
    let offset = 0;
    const visit = node => {
        if (!node) return null;
        const nodeStart = offset;
        if (node.id) sourceAnchors.add(node.id);
        if (node.type === 'text') {
            let value = '';
            for (const character of String(node.text || '')) {
                const whitespace = /\s/u.test(character);
                if (offset >= start && offset < end) value += character;
                if (!whitespace) offset += character.length;
            }
            return value ? { ...node, text: value } : null;
        }
        const children = node.hiddenText ? [] : (node.children || []).map(visit).filter(Boolean);
        const keepAnchor = owns(nodeStart);
        if (!children.length && !keepAnchor) return null;
        if (keepAnchor && node.id) anchors.add(node.id);
        if (keepAnchor && node.audioTrackId) audioTracks.add(node.audioTrackId);
        return {
            ...node,
            id: keepAnchor ? node.id : undefined,
            audioTrackId: keepAnchor ? node.audioTrackId : undefined,
            children,
        };
    };
    const nodes = epubAudioBlockNodes(block).map(visit).filter(Boolean);
    if (start === 0) {
        (block.anchors || []).forEach(anchor => {
            if (!sourceAnchors.has(anchor)) anchors.add(anchor);
        });
    }
    return { nodes, anchors: [...anchors], audioTracks: [...audioTracks], hasAudio: audioTracks.size > 0 || (block.hasAudio && anchors.size > 0) };
}
