import { readingListsRequest } from '../../readingLists.js';
import { sharingText } from './sharingCommon.js';

export const SHARED_READING_LISTS = [
    { id: 'recent-reading', key: 'folder.recent.title', fallback: '최근 읽음' },
    { id: 'recent-added', key: 'reading_lists.recent_added', fallback: '최근 추가됨' },
    { id: 'recent-updated', key: 'reading_lists.recent_updated', fallback: '최근 업데이트 됨' },
    { id: 'want-to-read', key: 'reading_lists.wishlist', fallback: '읽고 싶은 책' },
    { id: 'collections', key: 'reading_lists.collections', fallback: '컬렉션' },
];

export function sharedReadingLists(config = {}) {
    return SHARED_READING_LISTS.map(list => ({ id: list.id, name: sharingText(config, list.key, list.fallback) }));
}

export async function readSharedReadingList(library, id, collectionId = '') {
    if (!SHARED_READING_LISTS.some(list => list.id === id) || (collectionId && id !== 'collections')) {
        throw new Error('list_not_found');
    }
    if (id === 'collections') {
        const { collections } = await readingListsRequest(library, { operation: 'overview' });
        if (!collectionId) return { collections, rows: [] };
        const collection = collections.find(item => item.id === collectionId);
        if (!collection) throw new Error('list_not_found');
        const { rows } = await readingListsRequest(library, { operation: 'list', id: collectionId });
        return { collection, rows };
    }
    if (id === 'recent-reading') {
        const states = await library.listRecentReadingStates(50);
        const files = await library.listFilesByPaths(states.map(state => state.filePath));
        const byPath = new Map(files.map(file => [file.path, file]));
        return { rows: states.map(state => ({ ...byPath.get(state.filePath), path: state.filePath, last_read_at: state.lastReadAt })) };
    }
    return readingListsRequest(library, { operation: 'list', id });
}
