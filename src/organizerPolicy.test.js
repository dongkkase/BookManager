import test from 'node:test';
import assert from 'node:assert/strict';

import {
    changeOrganizerUnit,
    filenameOutputPath,
    organizerExtractedTitleName,
    organizerFolderName,
    organizerOriginalFilenameName,
    preserveOrganizerExtractedTitle,
    removeOrganizerItems,
    sanitizeOrganizerName,
    targetExtension,
    titleOutputPath,
} from './organizerPolicy.js';

test('책 제목 출력 경로는 제목 없음 fallback을 사용한다', () => {
    assert.equal(
        titleOutputPath({ filepath: '/books/a.zip', clean_title: '제목없음' }),
        '/books/제목없음_수정필요',
    );
    assert.equal(
        filenameOutputPath({ filepath: '/books/프랑켄 프랑.zip' }),
        '/books/프랑켄 프랑',
    );
});

test('권과 화 단위를 언어별로 변경한다', () => {
    assert.equal(changeOrganizerUnit('Series 2 외전', 'chapter', 'ko'), 'Series 외전 2화');
    assert.equal(changeOrganizerUnit('Series 2권', 'volume', 'en'), 'Series v2');
    assert.equal(changeOrganizerUnit('シリーズ 3話', 'volume', 'ja'), 'シリーズ 3巻');
    assert.equal(changeOrganizerUnit('에녹 제2부대의 배고픈 원정 밥', 'volume', 'ko'), '에녹 제2부대의 배고픈 원정 밥');
    assert.equal(changeOrganizerUnit('사이코 메트러 2부 01권', 'chapter', 'ko'), '사이코 메트러 2부 01화');
    assert.equal(changeOrganizerUnit('Re 제로부터 시작하는 이세계 생활 제5장', 'volume', 'ko'), 'Re 제로부터 시작하는 이세계 생활 제5장');
});

test('일괄 이름 복원은 기존 파일명과 분석된 제목을 구분한다', () => {
    const volume = {
        original_basename: '프랑켄프랑 01_waifu2x_noise2',
        extracted_name: '프랑켄 프랑 번역본 01권',
        new_name: '프랑켄 프랑 번역본 01화',
    };

    assert.equal(organizerOriginalFilenameName(volume), '프랑켄프랑 01_waifu2x_noise2');
    assert.equal(organizerExtractedTitleName(volume), '프랑켄 프랑 번역본 01권');
    assert.equal(organizerExtractedTitleName({ new_name: 'Fallback 01권' }), 'Fallback 01권');
    assert.deepEqual(
        preserveOrganizerExtractedTitle({ new_name: '프랑켄 프랑 번역본 01권' }),
        { new_name: '프랑켄 프랑 번역본 01권', extracted_name: '프랑켄 프랑 번역본 01권' },
    );
});

test('일괄 폴더명 추출은 파일의 부모 폴더명에서 정확히 (미완)만 제거한다', () => {
    assert.equal(
        organizerFolderName({
            filepath: '/보관함/작품 [특별] (미완)  01권+/책.cbz',
            original_path: '내부/이 값은 사용하지 않음',
            original_basename: '이 값도 사용하지 않음',
        }),
        '작품 [특별]   01권+',
    );
    assert.equal(
        organizerFolderName({ filepath: '/보관함/(미완)외전(미완) (完) [미완] 미완!/책.zip' }),
        '외전 (完) [미완] 미완!',
    );
    assert.equal(
        organizerFolderName({ filepath: 'D:\\보관함\\Windows 폴더 (미완) 03권\\책.zip' }),
        'Windows 폴더  03권',
    );
    assert.equal(
        organizerFolderName({ filepath: '/시리즈/  작품명 (미완)  /책.zip' }),
        '  작품명   ',
    );
    const nfdFolderName = '작품 (미완)'.normalize('NFD');
    assert.equal(
        organizerFolderName({ filepath: `/시리즈/${nfdFolderName}/책.zip` }),
        '작품 '.normalize('NFD'),
    );
    assert.equal(organizerFolderName({ filepath: '/보관함/Root_Files/책.zip' }), 'Root_Files');
    assert.equal(organizerFolderName({ filepath: '/보관함/(미완)/책.zip' }), '');
    assert.equal(
        organizerFolderName({ filepath: '책.zip', original_path: '시리즈/사용하지 않음' }),
        '',
    );
});

test('일괄 폴더명 추출은 기존 파일의 권수만 보존한다', () => {
    const item = { filepath: '/보관함/(미완)작품/묶음.zip' };
    const cases = [
        [{ original_basename: '기존 제목 01권' }, '작품 01권'],
        [{ original_basename: '기존 제목 제1권' }, '작품 제1권'],
        [{ original_basename: '스캔본', original_path: '내부/기존 제목 2.5권/스캔본' }, '작품 2.5권'],
        [{ original_path: '내부/기존 제목 1~3권' }, '작품 1~3권'],
        [{ original_path: '내부 1~10권/기존 제목 04권' }, '작품 04권'],
        [{ original_basename: '기존 제목 12화' }, '작품'],
        [{ original_basename: '기존 제목 2024' }, '작품'],
        [{ original_path: '내부/기존 제목' }, '작품'],
        [{}, '작품'],
    ];

    for (const [volume, expected] of cases) {
        assert.equal(organizerFolderName(item, volume), expected);
    }

    assert.equal(
        organizerFolderName(
            { filepath: '/보관함/작품/기존 제목 03권.cbz' },
            { original_basename: 'Root_Files', original_path: 'Root_Files' },
        ),
        '작품 03권',
    );
    assert.equal(
        organizerFolderName(
            { filepath: '/보관함/(미완)작품 01권/묶음.zip' },
            { original_basename: '기존 제목 01권' },
        ),
        '작품 01권',
    );
    const multipleVolumes = {
        filepath: '/보관함/작품 1~10권/작품 1~10권.zip',
        volumes: [{}, {}],
    };
    assert.equal(
        organizerFolderName(multipleVolumes, { original_basename: '기존 제목 01권' }),
        '작품 1~10권 01권',
    );
    assert.equal(
        organizerFolderName(multipleVolumes, { original_basename: '기존 제목 02권' }),
        '작품 1~10권 02권',
    );
    assert.equal(
        organizerFolderName(
            { filepath: '/보관함/작품/작품 1~10권.zip', volumes: [{}, {}] },
            { original_basename: '스캔본', original_path: '내부/스캔본' },
        ),
        '작품',
    );
});

test('폴더명 추출 권수는 기존 경로와 이름의 가장 마지막 토큰을 사용한다', () => {
    const item = { filepath: '/보관함/작품/묶음.zip' };

    assert.equal(
        organizerFolderName(item, { original_path: '묶음 1~10권/작품 01권' }),
        '작품 01권',
    );
    assert.equal(
        organizerFolderName(item, { original_basename: '묶음 1~10권 작품 02권' }),
        '작품 02권',
    );
});

test('폴더명 추출 권수는 macOS NFD 형태의 한글을 인식한다', () => {
    const nfdVolumeName = '기존 제목 01권'.normalize('NFD');
    const result = organizerFolderName(
        { filepath: '/보관함/작품/묶음.zip' },
        { original_basename: nfdVolumeName },
    );

    assert.equal(result.normalize('NFC'), '작품 01권');
});

test('폴더명 추출 권수는 em dash 범위를 보존한다', () => {
    assert.equal(
        organizerFolderName(
            { filepath: '/보관함/작품/묶음.zip' },
            { original_basename: '기존 제목 1—3권' },
        ),
        '작품 1—3권',
    );
});

test('파일명 금지 문자를 안전하게 치환한다', () => {
    assert.equal(sanitizeOrganizerName('  .A:B?.zip  '), 'A_B_.zip');
});

test('대상 포맷이 없으면 내부 아카이브 확장자를 보존한다', () => {
    assert.equal(targetExtension({ type: 'archive', inner_path: 'a/book.cbz' }, 'none'), '.cbz');
    assert.equal(targetExtension({ type: 'folder' }, 'none'), '.zip');
    assert.equal(targetExtension({ type: 'folder' }, '7z'), '.7z');
});

test('삭제 후 인접 최상위 항목을 선택한다', () => {
    const result = removeOrganizerItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['b']);
    assert.deepEqual(result.items, [{ id: 'a' }, { id: 'c' }]);
    assert.equal(result.nextSelectedId, 'c');
});
