import assert from 'node:assert/strict';
import test from 'node:test';
import {
    addFavoriteEntry,
    normalizeFavorites,
    removeFavoriteEntry,
    serializeFavorites,
} from './favoriteState.js';

test('기존 문자열 및 원본 객체 즐겨찾기 형식을 함께 읽는다', () => {
    assert.deepEqual(normalizeFavorites({
        favorites: ['/books/a', '/books/b'],
        folder_favorites: [{ name: 'A', path: '/books/a' }],
    }), [
        { name: 'A', path: '/books/a' },
        { name: 'b', path: '/books/b' },
    ]);
});

test('같은 경로는 즐겨찾기에 중복 추가하지 않는다', () => {
    const favorites = [{ name: 'a', path: '/books/a' }];
    assert.equal(addFavoriteEntry(favorites, '/books/a'), favorites);
    assert.deepEqual(addFavoriteEntry(favorites, '/books/b'), [
        ...favorites,
        { name: 'b', path: '/books/b' },
    ]);
});

test('즐겨찾기를 제거하고 두 config 형식으로 저장한다', () => {
    const favorites = removeFavoriteEntry([
        { name: 'a', path: '/books/a' },
        { name: 'b', path: '/books/b' },
    ], '/books/a');

    assert.deepEqual(serializeFavorites(favorites), {
        folder_favorites: [{ name: 'b', path: '/books/b' }],
        favorites: ['/books/b'],
    });
});
