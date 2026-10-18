function validNodes(nodes, ancestors) {
    return (Array.isArray(nodes) ? nodes : []).filter(node => node && typeof node.path === 'string' && node.path && !ancestors.has(node.path));
}

export function buildFolderTreeRows(roots, entries = {}, expandedPaths = new Set()) {
    const rows = [];
    const stack = [];
    const pushSiblings = (nodes, parentPath, parentKey, level, ancestors, ancestorContinues) => {
        const siblings = validNodes(nodes, ancestors);
        const siblingPaths = siblings.map(node => node.path);
        const occurrences = new Map();
        const keys = siblings.map(node => {
            const occurrence = occurrences.get(node.path) || 0;
            occurrences.set(node.path, occurrence + 1);
            return `${parentKey || 'node'}:${JSON.stringify([node.path, occurrence])}`;
        });
        for (let index = siblings.length - 1; index >= 0; index -= 1) {
            stack.push({
                key: keys[index],
                node: siblings[index],
                parentPath,
                parentKey,
                level,
                posInSet: index + 1,
                setSize: siblings.length,
                siblingPaths,
                ancestors,
                ancestorContinues,
            });
        }
    };
    pushSiblings(roots, null, null, 1, new Set(), []);
    while (stack.length) {
        const { ancestors, ...row } = stack.pop();
        const { node, level, ancestorContinues } = row;
        const entry = entries[node.path];
        const childAncestors = new Set(ancestors);
        childAncestors.add(node.path);
        const children = validNodes(entry?.children, childAncestors);
        const isFolder = node.isFolder !== false;
        const canExpand = isFolder && (entry?.status === 'ready'
            ? children.length > 0
            : Number(node.childFolderCount) !== 0 || node.childFolderCount == null);
        const expanded = isFolder && expandedPaths.has(node.path);
        const hasNextSibling = row.posInSet < row.setSize;
        rows.push({
            ...row,
            kind: 'node',
            path: node.path,
            canExpand,
            expanded,
            hasNextSibling,
        });
        if (!expanded) continue;
        const childContinues = level > 1 ? [...ancestorContinues, hasNextSibling] : [];
        if (entry?.status === 'ready' && children.length) {
            pushSiblings(children, node.path, row.key, level + 1, childAncestors, childContinues);
            continue;
        }
        const kind = entry?.status === 'error' ? 'error'
            : entry?.status === 'ready' || (!entry && !canExpand) ? 'empty' : 'loading';
        rows.push({
            key: `${row.key}:${kind}`,
            kind,
            node,
            parentPath: node.path,
            parentKey: row.key,
            level: level + 1,
            ancestorContinues: childContinues,
            hasNextSibling: false,
            error: entry?.error,
        });
    }
    return rows;
}

export function getFolderTreeWindow(rowCount, scrollTop, viewportHeight, rowHeight, overscan = 8) {
    const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 28;
    const count = Math.max(0, rowCount);
    const viewport = Math.max(height, Number.isFinite(viewportHeight) ? viewportHeight : height);
    const offset = Math.max(0, Math.min(Number.isFinite(scrollTop) ? scrollTop : 0, Math.max(0, count * height - viewport)));
    const extra = Math.max(0, Math.floor(overscan));
    const start = Math.max(0, Math.floor(offset / height) - extra);
    const end = Math.min(count, Math.ceil((offset + viewport) / height) + extra);
    return { start, end, beforeHeight: start * height, afterHeight: (count - end) * height };
}
