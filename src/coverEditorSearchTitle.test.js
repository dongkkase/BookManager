import assert from 'node:assert/strict';
import test from 'node:test';
import { coverEditorSearchTitle } from './coverEditorSearchTitle.js';

test('cover search removes trailing episode, volume, and range markers from filenames', () => {
    for (const [name, title] of [
        ['마귀 001화.zip', '마귀'],
        ['마귀 001화.zip'.normalize('NFD'), '마귀'],
        ['마귀 제12권 (완결).zip'.normalize('NFD'), '마귀'],
        ['마귀001화.cbz', '마귀'],
        ['마귀 제12권.epub', '마귀'],
        ['마귀 001~100화.zip', '마귀'],
        ['마귀 1권-12권.cbz', '마귀'],
        ['마귀 [001-100] (완결).zip', '마귀'],
        ['마계 001화_고해상도_전체판.zip', '마계'],
        ['마귀 제12권 (완결).zip', '마귀'],
        ['Book vol3 [digital].zip', 'Book'],
        ['마귀 1권 001화.zip', '마귀'],
        ['Book vol3.zip', 'Book'],
        ['Book Vol. 03-04.zip', 'Book'],
        ['Book Volume 3.zip', 'Book'],
        ['Book Chapter 12.cbz', 'Book'],
        ['作品 第12巻.cbz', '作品'],
        ['/library/마귀 제12권.zip', '마귀'],
        ['C:\\library\\마귀 001화.zip', '마귀'],
    ]) assert.equal(coverEditorSearchTitle(name), title, name);
});

test('cover search preserves numeric titles and numbers that are part of a title', () => {
    for (const [name, title] of [
        ['1984.zip', '1984'],
        ['86.epub', '86'],
        ['1984 제1권.zip', '1984'],
        ['86 001화.cbz', '86'],
        ['Fahrenheit 451.epub', 'Fahrenheit 451'],
        ['Match 12.cbz', 'Match 12'],
        ['20세기 소년.zip', '20세기 소년'],
        ['제5도살장.zip', '제5도살장'],
        ['노트 1권의 비밀.zip', '노트 1권의 비밀'],
        ['1화.zip', '1화'],
        ['Book.cbz', 'Book'],
    ]) assert.equal(coverEditorSearchTitle(name), title, name);
});
