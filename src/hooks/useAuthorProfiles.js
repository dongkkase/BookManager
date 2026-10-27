import { useEffect, useState } from 'react';
import { AUTHOR_PROFILES_KEY, AUTOMATIC_AUTHOR_PROFILES_KEY, createAuthorProfileStore } from '../authorProfileStore.js';
import { normalizeAuthorProfile } from '../authorCatalog.js';

const EMPTY_AUTHORS = [];

export function useAuthorProfiles(authors = EMPTY_AUTHORS, enabled = true) {
    const [store, setStore] = useState(null);
    useEffect(() => {
        if (!enabled) return;
        let storage;
        try { storage = window.localStorage; } catch { storage = null; }
        const nextStore = createAuthorProfileStore({
            storage,
            search: name => window.electronAPI?.searchAuthorProfiles?.(name),
            persistPhoto: async profile => {
                const result = await window.electronAPI?.saveAuthorProfilePhoto?.(profile);
                if (!result?.success) throw new Error(result?.error || 'Author photo could not be saved');
                const saved = normalizeAuthorProfile({ ...profile, storedPhoto: result.photo });
                if (!saved?.storedPhoto || saved.storedPhoto.id !== result.photo?.id) throw new Error('Invalid saved author photo');
                return saved;
            },
        });
        setStore(nextStore);
        const reload = event => {
            if (!event.key || [AUTHOR_PROFILES_KEY, AUTOMATIC_AUTHOR_PROFILES_KEY].includes(event.key)) nextStore.reload();
        };
        window.addEventListener('storage', reload);
        window.addEventListener('focus', reload);
        return () => {
            nextStore.dispose();
            window.removeEventListener('storage', reload);
            window.removeEventListener('focus', reload);
        };
    }, [enabled]);
    useEffect(() => {
        if (!enabled || !store) return;
        store.setBackgroundAuthors(typeof window.electronAPI?.searchAuthorProfiles === 'function' ? authors : EMPTY_AUTHORS);
    }, [authors, enabled, store]);
    return enabled ? store : null;
}
