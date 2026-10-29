import assert from 'node:assert/strict';
import test from 'node:test';
import { authorHue, authorInitials, authorKey, authorNames, buildAuthorCatalog, buildAuthorIndex, getAuthorCatalog, normalizeAuthorProfile, prepareAuthorCatalog } from './authorCatalog.js';
import { buildFolderCharacterIndex } from './folderCharacterIndex.js';

test('저자 이름은 공동저자 구분자를 처리하고 대소문자·공백·유니코드 차이를 중복으로 세지 않는다', () => {
    const names = authorNames({ writer: ' Jane   Doe, 한강;JANE DOE | 한강\n한강; Émile Zola, E\u0301mile Zola , ; | ' });
    assert.deepEqual(names.map(authorKey), ['jane doe', '한강', 'émile zola']);
    assert.equal(authorKey('  JANE\t DOE  '), 'jane doe');
    assert.equal(authorKey('한강'), '한강');
    assert.equal(authorKey(null), '');
});

test('명시된 writer만 저자로 사용하고 writer 필드가 없는 경우에만 author로 보완한다', () => {
    assert.deepEqual(authorNames({ writer: '글 작가', author: '다른 저자', creators: '제작자' }), ['글 작가']);
    assert.deepEqual(authorNames({ author: '저자', creators: 'Adobe PDF Library' }), ['저자']);
    for (const writer of ['', ' \t ', undefined, null, {}, 123]) {
        assert.deepEqual(authorNames({ writer, author: 'Adobe PDF Library', creators: 'Adobe PDF Library' }), []);
    }
    assert.deepEqual(authorNames({ creators: 'Adobe PDF Library' }), []);
    assert.deepEqual(authorNames({ author: '', creators: 'Acrobat Distiller' }), []);
    for (const file of [null, undefined, {}, { writer: ' ' }, { writer: 123 }]) assert.deepEqual(authorNames(file), []);
});

test('공동저자는 같은 도서를 공유하되 중복 경로·폴더·저자 없는 파일을 도서 수에 포함하지 않는다', () => {
    const first = Object.freeze({ path: '/books/one.epub', writer: 'Alice, Bob, Alice' });
    const second = Object.freeze({ full_path: '/books/two.pdf', path: '/display/two.pdf', author: 'alice' });
    const files = Object.freeze([
        first, second,
        { path: '/books/one.epub', writer: 'Alice, Bob' },
        { full_path: '/books/two.pdf', writer: 'Alice' },
        { path: '/books/directory', writer: 'Alice', isDirectory: true },
        { path: '/books/other-directory', writer: 'Bob', is_folder: true },
        { path: '/books/unknown.epub' }, { writer: 'Missing path' }, null, {},
        { full_path: {}, path: '/books/three.txt', author: 'Bob' },
        { path: '/books/software.pdf', writer: '', author: 'Adobe PDF Library', creators: 'Adobe PDF Library' },
        { path: '/books/producer-only.pdf', creators: 'Acrobat Distiller' },
    ]);
    const result = buildAuthorCatalog(files, 'en');
    assert.deepEqual(result.map(author => author.key), ['alice', 'bob']);
    assert.deepEqual(result[0].books, [first, second]);
    assert.deepEqual(result[1].books.map(file => file.path), ['/books/one.epub', '/books/three.txt']);
    assert.equal(result[0].name, 'Alice');
    assert.equal(result[0].paths, undefined);
    assert.equal(first.writer, 'Alice, Bob, Alice');
    assert.deepEqual(buildAuthorCatalog(), []);
    assert.deepEqual(buildAuthorCatalog(null), []);
    assert.deepEqual(buildAuthorCatalog({ files }), []);
});

test('한글 초성·영문·숫자·기호 그룹을 만들고 같은 영문 이름은 숫자 순서로 정렬한다', () => {
    const names = ['한강', '김영하', '까치', '나태주', 'Alice 10', 'Alice 2', 'Émile Zola', '123 저자', '#익명'];
    const files = names.map((writer, index) => ({ writer, path: `/books/${index}.epub` }));
    for (const language of ['ko', 'en']) {
        const result = buildAuthorCatalog(files, language);
        const byName = new Map(result.map(author => [author.name, author.initial]));
        assert.deepEqual(Object.fromEntries(byName), {
            한강: 'ㅎ', 김영하: 'ㄱ', 까치: 'ㄱ', 나태주: 'ㄴ',
            'Alice 10': 'A', 'Alice 2': 'A', 'Émile Zola': 'E', '123 저자': '0–9', '#익명': '#',
        });
        assert.ok(result.findIndex(author => author.name === 'Alice 2') < result.findIndex(author => author.name === 'Alice 10'));
    }
});

test('마지막 추가일은 가장 최근의 유효한 날짜이며 누락·잘못된 날짜를 무시한다', () => {
    const result = buildAuthorCatalog([
        { path: '/one.epub', writer: 'Author', readingListAddedAt: '2026-10-22T01:00:00Z' },
        { path: '/two.epub', writer: 'Author', readingListAddedAt: 'not a date' },
        { path: '/three.epub', writer: 'Author', readingListAddedAt: '2026-10-25T11:30:00+09:00' },
        { path: '/four.epub', writer: 'Author' },
        { path: '/five.epub', writer: 'Unknown date', readingListAddedAt: null },
    ], 'en');
    assert.equal(result.find(author => author.name === 'Author').lastAdded, Date.parse('2026-10-25T02:30:00Z'));
    assert.equal(result.find(author => author.name === 'Unknown date').lastAdded, 0);
});

test('같은 도서 스냅샷의 저자 집계는 재사용하고 새 스냅샷과 언어 변경은 다시 계산한다', () => {
    const files = [{ path: '/books/one.epub', writer: '한강' }];
    const first = getAuthorCatalog(files, 'ko');
    assert.equal(getAuthorCatalog(files, 'ko'), first);
    assert.notEqual(getAuthorCatalog(files, 'en'), first);
    const refreshed = getAuthorCatalog([...files, { path: '/books/two.epub', writer: '김초엽' }], 'ko');
    assert.equal(refreshed.length, 2);
    assert.notEqual(refreshed, first);
    assert.equal(getAuthorCatalog(files, 'ko'), first);
});

test('저자 초성 색인은 각 그룹의 첫 저자와 개수를 기존 문자 탐색기와 동일하게 유지한다', () => {
    const names = ['한강', '김영하', '김초엽', '까치', '123 저자', '#익명', 'Alice 2', 'Alice 10', 'Émile Zola', 'Öberg', '大江', '村上', 'あき', 'いち', 'カナ', '가나', 'Йван', 'Иван'];
    const files = names.map((writer, index) => ({ writer, path: `/books/${index}.epub` }));
    for (const language of ['ko', 'en', 'ja', 'sv']) {
        const authors = getAuthorCatalog(files, language);
        const expected = buildFolderCharacterIndex(authors.map(author => ({ name: author.name, path: author.key })), language);
        assert.deepEqual(buildAuthorIndex(authors, language), expected);
        const filtered = authors.filter(author => !author.name.includes('김'));
        assert.deepEqual(buildAuthorIndex(filtered, language), buildFolderCharacterIndex(filtered.map(author => ({ name: author.name, path: author.key })), language));
    }
});

test('대형 카탈로그 준비는 작업을 나누고 배지와 화면에서 완성된 집계를 재사용한다', async t => {
    let time = 0;
    t.mock.method(performance, 'now', () => time += 10);
    const files = Array.from({ length: 2048 }, (_, index) => ({
        path: `/books/${index}.epub`, writer: `작가 ${index % 300}, 공동 저자`, readingListAddedAt: '2026-10-25T00:00:00Z',
    }));
    let yielded = 0;
    const prepared = await prepareAuthorCatalog(files, 'ko', {
        yieldTask: async () => { yielded += 1; },
    });
    assert.ok(yielded > 1);
    assert.deepEqual(prepared, buildAuthorCatalog(files, 'ko'));
    assert.equal(getAuthorCatalog(files, 'ko'), prepared);
    assert.equal(await prepareAuthorCatalog(files, 'ko', { yieldTask: () => assert.fail('Cached catalogs must not be rebuilt') }), prepared);
});

test('라이브러리가 변경되면 진행 중인 저자 집계를 중단하고 부분 결과를 캐시하지 않는다', async t => {
    let time = 0;
    let active = true;
    let visited = 0;
    t.mock.method(performance, 'now', () => time += 10);
    const files = Array.from({ length: 2048 }, (_, index) => ({
        path: `/books/${index}.epub`,
        get writer() { visited += 1; return `작가 ${index % 100}`; },
    }));
    const result = await prepareAuthorCatalog(files, 'ko', {
        isCurrent: () => active,
        yieldTask: async () => { active = false; },
    });
    assert.equal(result, null);
    assert.ok(visited < files.length);
    assert.equal(getAuthorCatalog(files, 'ko').reduce((total, author) => total + author.books.length, 0), files.length);
});

test('프로필은 신뢰할 수 없는 저장 URL을 버리고 검증한 저자 ID에서 사진과 출처 URL을 만든다', () => {
    const profile = normalizeAuthorProfile({
        id: 'OL23919A', name: 'J. K. Rowling', birthDate: '1965', deathDate: null, topWork: 'Harry Potter',
        alternateNames: ['Joanne Rowling', null, 12, ...Array.from({ length: 10 }, (_, index) => `Name ${index}`)],
        photoUrl: 'javascript:alert(1)', sourceUrl: 'https://openlibrary.org.attacker.test/author',
        privateValue: 'must not be retained',
    });
    assert.equal(profile.photoUrl, 'https://covers.openlibrary.org/a/olid/OL23919A-M.jpg?default=false');
    assert.equal(profile.sourceUrl, 'https://openlibrary.org/authors/OL23919A');
    assert.equal(profile.deathDate, '');
    assert.equal(profile.alternateNames.length, 8);
    assert.ok(profile.alternateNames.every(name => typeof name === 'string'));
    assert.equal(profile.privateValue, undefined);
    assert.equal(normalizeAuthorProfile({ id: 'OL1A', name: 'x'.repeat(1001) }).name.length, 1000);
    for (const id of ['', 'OL0A', 'OL1W', 'ol1a', 'OL1A/../../private', '/authors/OL1A', 'https://attacker.test/OL1A', `OL${'1'.repeat(16)}A`, ['OL1A'], null, 1]) {
        assert.equal(normalizeAuthorProfile({ id, name: 'Invalid' }), null);
    }
    assert.equal(normalizeAuthorProfile(null), null);
});

test('사진 없는 저자의 이니셜과 색상은 이름에서 일관되게 계산된다', () => {
    assert.equal(authorInitials(' Jane Austen '), 'JA');
    assert.equal(authorInitials('A. A. Milne'), 'AM');
    assert.equal(authorInitials('한강'), '한강');
    assert.equal(authorInitials(''), '?');
    assert.equal(authorInitials('𠮷田'), '𠮷田');
    assert.equal(authorHue(' Jane  Doe '), authorHue('jane doe'));
    assert.equal(authorHue('한강'), authorHue('한강'));
    for (const name of ['한강', 'Jane Doe', '', 'Émile Zola', '𠮷田']) {
        assert.ok(Number.isInteger(authorHue(name)) && authorHue(name) >= 0 && authorHue(name) < 360);
    }
});

test('Wikidata·Wikipedia 프로필은 검증된 식별자와 Wikimedia 사진·저작자 정보를 보존한다', () => {
    const photoUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Han_Kang.jpg/320px-Han_Kang.jpg';
    const wikidata = normalizeAuthorProfile({
        provider: 'wikidata', id: 'Q12345', name: '한강', photoUrl,
        aliases: ['Han Kang'], works: ['채식주의자', null, '채식주의자'], description: '<b>소설가</b>\u0000 소개',
        sourceUrl: 'https://untrusted.invalid/profile', entityId: 'Q666',
        imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Han_Kang.jpg',
        imageLicense: '<a href="javascript:bad">CC BY-SA 4.0</a>', imageArtist: '<b>Photographer</b>',
    });
    assert.equal(wikidata.sourceUrl, 'https://www.wikidata.org/wiki/Q12345');
    assert.equal(wikidata.entityId, 'Q12345');
    assert.equal(wikidata.photoUrl, photoUrl);
    assert.deepEqual(wikidata.alternateNames, ['Han Kang']);
    assert.deepEqual(wikidata.works, ['채식주의자']);
    assert.equal(wikidata.description, '소설가  소개');
    assert.equal(wikidata.imageLicense, 'CC BY-SA 4.0');
    assert.equal(wikidata.imageArtist, 'Photographer');
    assert.equal(wikidata.imageSourceUrl, 'https://commons.wikimedia.org/wiki/File:Han_Kang.jpg');
    assert.deepEqual(normalizeAuthorProfile(wikidata), wikidata);
    const wikipedia = normalizeAuthorProfile({ ...wikidata, provider: 'wikipedia', id: 'wikipedia:ja:12345' });
    assert.equal(wikipedia.sourceUrl, 'https://ja.wikipedia.org/?curid=12345');
    assert.equal(wikipedia.entityId, 'Q12345');
    assert.equal(normalizeAuthorProfile({ id: 'OL1A', photoUrl: '' }).photoUrl, '');
});

test('새 프로필의 외부 URL·잘못된 식별자·비이미지 경로는 사용하지 않는다', () => {
    for (const entry of [
        { provider: 'wikidata', id: 'Q0' }, { provider: 'wikidata', id: 'Q123/extra' },
        { provider: 'wikipedia', id: 'wikipedia:attacker:123' }, { provider: 'wikipedia', id: 'wikipedia:en:0' },
        { provider: 'unknown', id: 'OL1A' }, { provider: 'wikidata', id: 'OL1A' },
    ]) assert.equal(normalizeAuthorProfile(entry), null);
    for (const photoUrl of [
        'https://attacker.invalid/photo.jpg', 'http://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',
        'https://upload.wikimedia.org.attacker.invalid/wikipedia/commons/a/ab/Photo.jpg',
        'https://user:secret@upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',
        'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.svg',
        'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg?redirect=1',
        'https://upload.wikimedia.org/wikipedia/commons/a/ab/%00Photo.jpg', 'javascript:alert(1)',
    ]) assert.equal(normalizeAuthorProfile({ provider: 'wikidata', id: 'Q1', photoUrl }).photoUrl, '');
    for (const imageSourceUrl of ['https://attacker.invalid/File:Photo.jpg', 'https://commons.wikimedia.org/wiki/Main_Page', 'https://en.wikipedia.org/wiki/File:Photo.jpg#section']) {
        assert.equal(normalizeAuthorProfile({ provider: 'wikidata', id: 'Q1', imageSourceUrl }).imageSourceUrl, '');
    }
});

test('직접 고른 사진은 전용 폴더 주소를 사용하고 기존 작가 소개와 출처를 유지한다', () => {
    const photoOverride = { id: 'a1'.repeat(32), sourceUrl: 'https://images.example.com/author.jpg?size=large', query: '한강 작가' };
    const original = {
        provider: 'wikidata', id: 'Q123', name: '한강', description: '한국의 소설가', birthDate: '1970',
        topWork: '채식주의자', works: ['채식주의자'], alternateNames: ['Han Kang'],
        photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg',
        imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg', imageLicense: 'CC BY-SA', imageArtist: 'Previous photographer',
    };
    const updated = normalizeAuthorProfile({ ...original, photoOverride, privatePath: '/Users/private/photo.png' });
    assert.equal(updated.photoUrl, `bookmanager-thumbnail://author-photo/${photoOverride.id}.png`);
    assert.equal(updated.sourceUrl, 'https://www.wikidata.org/wiki/Q123');
    assert.equal(updated.description, original.description);
    assert.equal(updated.birthDate, original.birthDate);
    assert.deepEqual(updated.works, original.works);
    assert.deepEqual(updated.alternateNames, original.alternateNames);
    assert.equal(updated.imageSourceUrl, photoOverride.sourceUrl);
    assert.equal(updated.imageLicense, '');
    assert.equal(updated.imageArtist, '');
    assert.equal(updated.privatePath, undefined);
    assert.deepEqual(updated.photoOverride, photoOverride);
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(updated))), updated);
    assert.equal(normalizeAuthorProfile({ id: 'OL1A', name: '한강', photoOverride }).sourceUrl, 'https://openlibrary.org/authors/OL1A');
});

test('영구 저장한 프로필 사진은 로컬 주소와 원본 출처·저작자 정보를 재시작 후에도 유지한다', () => {
    for (const original of [
        { id: 'OL1A', name: 'Author', photoUrl: 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false' },
        { provider: 'wikidata', id: 'Q1', name: 'Author', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg',
            imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg', imageLicense: 'CC BY-SA', imageArtist: 'Photographer' },
    ]) {
        const storedPhoto = { id: 'ab'.repeat(32), sourceUrl: original.photoUrl };
        const stored = normalizeAuthorProfile({ ...original, storedPhoto });
        assert.equal(stored.photoUrl, `bookmanager-thumbnail://author-photo/${storedPhoto.id}.png`);
        assert.deepEqual(stored.storedPhoto, storedPhoto);
        assert.equal(stored.imageSourceUrl, original.imageSourceUrl || '');
        assert.equal(stored.imageLicense, original.imageLicense || '');
        assert.equal(stored.imageArtist, original.imageArtist || '');
        assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(stored))), stored);
    }
});

test('저장 사진의 파일 식별자와 원본 주소를 검증하며 직접 고른 사진이 우선한다', () => {
    const sourceUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg';
    const original = { provider: 'wikidata', id: 'Q1', name: 'Author', photoUrl: sourceUrl };
    for (const storedPhoto of [
        { id: '../photo', sourceUrl }, { id: 'AB'.repeat(32), sourceUrl },
        { id: 'ab'.repeat(32), sourceUrl: 'file:///tmp/photo.png' },
        { id: 'ab'.repeat(32), sourceUrl: 'https://example.com/Author.jpg' },
    ]) {
        const stored = normalizeAuthorProfile({ ...original, storedPhoto });
        assert.equal(stored.storedPhoto, undefined);
        assert.equal(stored.photoUrl, sourceUrl);
    }
    assert.equal(normalizeAuthorProfile({ id: 'OL1A', storedPhoto: {
        id: 'ab'.repeat(32), sourceUrl: 'https://covers.openlibrary.org/a/olid/OL2A-M.jpg?default=false',
    } }).storedPhoto, undefined);
    const photoOverride = { id: 'cd'.repeat(32), sourceUrl: 'https://images.example.com/photo.jpg', query: 'Author' };
    const chosen = normalizeAuthorProfile({ ...original, storedPhoto: { id: 'ab'.repeat(32), sourceUrl }, photoOverride });
    assert.equal(chosen.storedPhoto, undefined);
    assert.equal(chosen.photoUrl, `bookmanager-thumbnail://author-photo/${photoOverride.id}.png`);
});

test('사진만 선택한 작가는 검증한 해시와 검색어로 Naver 프로필과 출처를 만든다', () => {
    const id = '0123456789abcdef'.repeat(4);
    const updated = normalizeAuthorProfile({
        provider: 'naver', id, name: '한강', photoUrl: 'file:///private/photo.png', sourceUrl: 'javascript:alert(1)',
        photoOverride: { id, sourceUrl: 'https://images.example.com/author.png', query: '<b>한강</b>\n 작가', filePath: '/private/photo.png' },
    });
    assert.equal(updated.sourceUrl, `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent('한강 작가')}`);
    assert.equal(updated.photoUrl, `bookmanager-thumbnail://author-photo/${id}.png`);
    assert.deepEqual(updated.photoOverride, { id, sourceUrl: 'https://images.example.com/author.png', query: '한강 작가' });
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(updated))), updated);
    assert.equal(normalizeAuthorProfile({ ...updated, photoOverride: { ...updated.photoOverride, query: '가'.repeat(300) } }).photoOverride.query.length, 200);
});

test('수동 사진의 잘못된 해시와 비공개 URL은 프로필 이미지로 사용하지 않는다', () => {
    const id = 'ab'.repeat(32);
    const photoOverride = { id, sourceUrl: 'https://images.example.com/author.jpg', query: '작가 사진' };
    for (const invalidId of ['', 'AB'.repeat(32), 'a'.repeat(63), 'a'.repeat(65), '../photo.png', `${id}.png`, ['ab'.repeat(32)]]) {
        assert.equal(normalizeAuthorProfile({ provider: 'naver', id, photoOverride: { ...photoOverride, id: invalidId } }), null);
    }
    for (const sourceUrl of [
        'javascript:alert(1)', 'file:///private/photo.jpg', 'data:image/png;base64,AAAA',
        'https://user:secret@images.example.com/photo.jpg', 'https://images.example.com:8443/photo.jpg',
        'http://localhost/photo.jpg', 'http://localhost./photo.jpg', 'http://server.local/photo.jpg', 'http://intranet/photo.jpg',
        'http://127.0.0.1/photo.jpg', 'http://2130706433/photo.jpg', 'http://0x7f000001/photo.jpg',
        'http://10.0.0.1/photo.jpg', 'http://172.16.1.1/photo.jpg', 'http://192.168.0.1/photo.jpg',
        'http://169.254.169.254/photo.jpg', 'http://100.64.0.1/photo.jpg', 'http://[::1]/photo.jpg',
        'http://[::ffff:127.0.0.1]/photo.jpg', 'https://images.example.com/\\photo.jpg', 'https://images.example.com/\nphoto.jpg',
    ]) {
        const invalidOverride = { ...photoOverride, sourceUrl };
        assert.equal(normalizeAuthorProfile({ provider: 'naver', id, photoOverride: invalidOverride }), null, sourceUrl);
        const existing = normalizeAuthorProfile({ id: 'OL1A', photoOverride: invalidOverride });
        assert.equal(existing.photoOverride, undefined);
        assert.equal(existing.photoUrl, 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false');
    }
    assert.equal(normalizeAuthorProfile({ provider: 'naver', id: 'cd'.repeat(32), photoOverride }), null);
    assert.equal(normalizeAuthorProfile({ provider: 'naver', id, photoOverride: { ...photoOverride, query: '' } }), null);
    assert.equal(normalizeAuthorProfile({ provider: 'naver', id }), null);
});

test('로컬 업로드 사진은 외부 프로필 없이 저장되고 다시 읽을 수 있다', () => {
    const id = 'ab'.repeat(32);
    const photoOverride = { id, source: 'local', sourceUrl: '', query: '' };
    const profile = normalizeAuthorProfile({ provider: 'local', id, name: '저자', photoOverride });
    assert.equal(profile.photoUrl, `bookmanager-thumbnail://author-photo/${id}.png`);
    assert.equal(profile.sourceUrl, '');
    assert.equal(profile.imageSourceUrl, '');
    assert.deepEqual(profile.photoOverride, photoOverride);
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(profile))), profile);
    assert.equal(normalizeAuthorProfile({ ...profile, id: '../private' }), null);
    assert.equal(normalizeAuthorProfile({ ...profile, photoOverride: { ...photoOverride, sourceUrl: 'file:///private/photo.png' } }), null);
});

test('직접 입력한 로컬 프로필은 사진 없이 저장되고 사진을 추가해도 식별자와 소개를 유지한다', () => {
    const id = 'local:5273c576-25e3-4c58-b6f2-d5636ed0da46';
    const profile = normalizeAuthorProfile({ provider: 'local', id, name: '<b>한강</b>', birthDate: '1970-11-27',
        deathDate: '', topWork: '채식주의자', description: '직접 입력한 소개', works: ['채식주의자', '소년이 온다'] });
    assert.equal(profile.name, '한강');
    assert.equal(profile.birthDate, '1970-11-27');
    assert.equal(profile.topWork, '채식주의자');
    assert.equal(profile.description, '직접 입력한 소개');
    assert.equal(profile.photoUrl, '');
    assert.equal(profile.sourceUrl, '');
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(profile))), profile);
    const photoOverride = { id: 'cd'.repeat(32), source: 'local', sourceUrl: '', query: '' };
    const withPhoto = normalizeAuthorProfile({ ...profile, photoOverride });
    assert.equal(withPhoto.id, id);
    assert.equal(withPhoto.description, profile.description);
    assert.equal(withPhoto.photoUrl, `bookmanager-thumbnail://author-photo/${photoOverride.id}.png`);
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(withPhoto))), withPhoto);
});

test('직접 입력한 로컬 프로필은 외부 주소나 저장 사진 경로를 프로필 사진으로 사용하지 않는다', () => {
    const profile = { provider: 'local', id: 'local:5273c576-25e3-4c58-b6f2-d5636ed0da46', name: '저자' };
    for (const photoUrl of ['file:///private/photo.png', 'https://images.example.com/portrait.png',
        'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg', `bookmanager-thumbnail://author-photo/${'ab'.repeat(32)}.png`]) {
        const value = normalizeAuthorProfile({ ...profile, photoUrl, sourceUrl: 'https://example.com/profile',
            storedPhoto: { id: 'ab'.repeat(32), sourceUrl: photoUrl } });
        assert.equal(value.sourceUrl, '');
        assert.equal(value.photoUrl, '');
        assert.equal(value.storedPhoto, undefined);
    }
    for (const id of ['../private', 'local:', 'local:author', 'local:5273c576-25e3-4c58-b6f2-d5636ed0da46/extra', 'ab'.repeat(32)]) {
        assert.equal(normalizeAuthorProfile({ ...profile, id }), null);
    }
});

test('프로필 소개는 문단 줄바꿈을 유지하고 다른 필드는 한 줄로 정리한다', () => {
    const original = { provider: 'local', id: 'local:5273c576-25e3-4c58-b6f2-d5636ed0da46',
        name: '저자\n이름', topWork: '첫 작품\n다음 작품',
        description: '  <b>첫 문단</b>\r\n\r\n두 번째\t문단\u0000\n마지막 문단  ' };
    const value = normalizeAuthorProfile(original);
    assert.equal(value.description, '첫 문단\n\n두 번째 문단 \n마지막 문단');
    assert.equal(value.name, '저자 이름');
    assert.equal(value.topWork, '첫 작품 다음 작품');
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(value))), value);
    assert.equal(normalizeAuthorProfile({ ...original, description: 123 }).description, '');
    assert.equal(normalizeAuthorProfile({ ...original, description: '가'.repeat(1200) }).description.length, 1000);
});

test('다른 프로필의 사진을 선택해도 저자 정보와 사진 저작자 및 라이선스를 각각 보존한다', () => {
    const photoOverride = {
        id: 'cd'.repeat(32), source: 'wikidata', sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg',
        query: 'Author', imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg',
        imageArtist: 'Photographer', imageLicense: 'CC BY 4.0',
    };
    const profile = normalizeAuthorProfile({ id: 'OL1A', name: '저자', birthDate: '1960', description: '소개', photoOverride });
    assert.equal(profile.id, 'OL1A');
    assert.equal(profile.birthDate, '1960');
    assert.equal(profile.description, '소개');
    assert.equal(profile.imageSourceUrl, photoOverride.imageSourceUrl);
    assert.equal(profile.imageArtist, 'Photographer');
    assert.equal(profile.imageLicense, 'CC BY 4.0');
    assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(profile))), profile);
    const unsafe = normalizeAuthorProfile({ ...profile, photoOverride: { ...photoOverride, imageSourceUrl: 'file:///private/photo.png', imageArtist: '<b>Credit</b>' } });
    assert.equal(unsafe.photoOverride.imageSourceUrl, '');
    assert.equal(unsafe.imageArtist, 'Credit');
});

test('국내 저자 출처는 인물 식별자로 링크를 만들고 확인된 프로필 사진 경로만 사용한다', () => {
    const profiles = [
        { provider: 'aladin', id: 'aladin:49154', photoUrl: 'https://image.aladin.co.kr/Author/Photo/49154/49154_2.jpg', sourceUrl: 'https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@49154' },
        { provider: 'kyobo', id: 'kyobo:1000646901', photoUrl: 'https://contents.kyobobook.co.kr/sih/fit-in/300x0/dtl/author/1000646901.jpg?t=2988445', sourceUrl: 'https://store.kyobobook.co.kr/person/detail/1000646901' },
        { provider: 'cartoon', id: `cartoon:${'ab'.repeat(32)}`, photoUrl: '', sourceUrl: 'https://www.cartoon.or.kr/all-member' },
        { provider: 'kmas', id: 'kmas:0000042604', photoUrl: 'https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=cd2302ca-686d-42a8-85fd-22b071fb82d8', sourceUrl: 'https://www.kmas.or.kr/archive/writrList/detail/0000042604' },
    ];
    for (const original of profiles) {
        const profile = normalizeAuthorProfile({ ...original, name: '작가', sourceUrl: 'https://attacker.test/fake' });
        assert.equal(profile.sourceUrl, original.sourceUrl);
        assert.equal(profile.photoUrl, original.photoUrl);
        assert.equal(profile.imageSourceUrl, original.photoUrl ? original.sourceUrl : '');
        assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(profile))), profile);
        if (profile.photoUrl) {
            const saved = normalizeAuthorProfile({ ...profile, storedPhoto: { id: 'ab'.repeat(32), sourceUrl: original.photoUrl } });
            assert.equal(saved.photoUrl, `bookmanager-thumbnail://author-photo/${'ab'.repeat(32)}.png`);
            assert.equal(saved.imageSourceUrl, original.sourceUrl);
            assert.deepEqual(normalizeAuthorProfile(JSON.parse(JSON.stringify(saved))), saved);
            const chosen = normalizeAuthorProfile({ id: 'OL1A', name: '원래 저자', photoOverride: {
                id: 'cd'.repeat(32), source: original.provider, sourceUrl: original.photoUrl,
                query: '작가', imageSourceUrl: original.sourceUrl,
            } });
            assert.equal(chosen.id, 'OL1A');
            assert.equal(chosen.imageSourceUrl, original.sourceUrl);
        }
    }
});

test('국내 저자 사진은 표지·다른 인물·임의 호스트와 추가 URL 인자를 허용하지 않는다', () => {
    const cases = [
        { provider: 'aladin', id: 'aladin:49154', urls: ['https://image.aladin.co.kr/product/1/cover.jpg', 'https://image.aladin.co.kr/Author/Photo/123/123.jpg', 'https://image.aladin.co.kr/Author/Photo/49154/49154.jpg?url=https://example.com'] },
        { provider: 'kyobo', id: 'kyobo:1000646901', urls: ['https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/9780000000000.jpg', 'https://contents.kyobobook.co.kr/dtl/author/1000646902.jpg', 'https://contents.kyobobook.co.kr/dtl/author/1000646901.jpg?t=1&redirect=private'] },
        { provider: 'kmas', id: 'kmas:0000042604', urls: ['https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=../../private', 'https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=cd2302ca-686d-42a8-85fd-22b071fb82d8&filePath=private'] },
    ];
    for (const { provider, id, urls } of cases) {
        for (const photoUrl of [...urls, 'https://attacker.test/author.jpg', 'file:///private/photo.jpg']) {
            assert.equal(normalizeAuthorProfile({ provider, id, photoUrl }).photoUrl, '');
        }
        assert.equal(normalizeAuthorProfile({ provider, id: `${id}/../fake` }), null);
    }
});
