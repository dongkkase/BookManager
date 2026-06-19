function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || String(filePath || '');
}

export function normalizeFavorites(config = {}) {
    const entries = [
        ...(Array.isArray(config.folder_favorites) ? config.folder_favorites : []),
        ...(Array.isArray(config.favorites) ? config.favorites : []),
    ];
    const seen = new Set();
    const normalized = [];

    for (const entry of entries) {
        const path = typeof entry === 'string' ? entry : entry?.path;
        const value = String(path || '').trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        normalized.push({
            name: String(typeof entry === 'object' && entry?.name ? entry.name : basename(value)),
            path: value,
        });
    }

    return normalized;
}

export function addFavoriteEntry(favorites = [], filePath) {
    const path = String(filePath || '').trim();
    if (!path || favorites.some(entry => entry.path === path)) return favorites;
    return [...favorites, { name: basename(path), path }];
}

export function removeFavoriteEntry(favorites = [], filePath) {
    return favorites.filter(entry => entry.path !== filePath);
}

export function serializeFavorites(favorites = []) {
    return {
        folder_favorites: favorites,
        favorites: favorites.map(entry => entry.path),
    };
}
