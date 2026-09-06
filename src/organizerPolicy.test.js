import test from 'node:test';
import assert from 'node:assert/strict';

import {
    changeOrganizerUnit,
    filenameOutputPath,
    groupOrganizerItems,
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

test('같은 폴더의 루트 이미지 압축 파일은 일괄 복원 시 각 원본 파일명을 사용한다', () => {
    const items = ['01', '02', '03', '04'].map(number => ({
        id: number,
        filepath: `/books/(미완)0.5인분의 연인/0.5인분의 연인 ${number}권.cbz`,
        volumes: [{
            id: 'root',
            original_path: 'Root_Files',
            original_basename: 'Root_Files',
            type: 'archive',
            inner_path: '',
            source_ext: '.cbz',
            extracted_name: `0.5인분의 연인 ${number}권`,
            new_name: 'Root_Files',
        }],
    }));
    const [group] = groupOrganizerItems(items);
    const names = group.volumes.map(({ item, volume }) => (
        organizerOriginalFilenameName(volume, item) + targetExtension(volume, 'none')
    ));

    assert.deepEqual(names, [
        '0.5인분의 연인 01권.cbz',
        '0.5인분의 연인 02권.cbz',
        '0.5인분의 연인 03권.cbz',
        '0.5인분의 연인 04권.cbz',
    ]);
});

test('루트 파일명 복원은 Windows 경로와 원본 이름 fallback을 지원하고 확장자를 한 번만 제외한다', () => {
    const volume = { original_path: 'Root_Files', extracted_name: '분석된 제목 1권' };

    assert.equal(
        organizerOriginalFilenameName(volume, { filepath: 'D:\\Books\\「어서 와, 아빠」 01권.v2.CBZ' }),
        '「어서 와, 아빠」 01권.v2',
    );
    assert.equal(organizerOriginalFilenameName(volume, { name: '작품 02권.zip' }), '작품 02권');
    assert.equal(organizerOriginalFilenameName(volume), '분석된 제목 1권');
});

test('실제 내부 압축 파일과 폴더의 Root_Files 이름은 원본 압축 파일명으로 바꾸지 않는다', () => {
    const item = { filepath: '/books/묶음.cbz' };
    const volumes = [
        { original_path: 'Root_Files', original_basename: 'Root_Files', inner_path: 'Root_Files.cbz', type: 'archive' },
        { original_path: 'Root_Files', original_basename: 'Root_Files', type: 'folder' },
        { original_path: 'Part/Root_Files', original_basename: 'Root_Files', type: 'folder' },
        { original_path: '작품 01권', original_basename: '작품 01권', type: 'folder' },
    ];

    assert.deepEqual(volumes.map(volume => organizerOriginalFilenameName(volume, item)), [
        'Root_Files', 'Root_Files', 'Root_Files', '작품 01권',
    ]);
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

test('같은 원본 디렉터리는 하나의 표시 그룹으로 묶고 실행 항목과 권 참조를 그대로 유지한다', () => {
    const firstVolumes = Object.freeze([
        Object.freeze({ id: 'first:0', new_name: 'Series 1' }),
        Object.freeze({ id: 'first:1', new_name: 'Series 2' }),
    ]);
    const lastVolume = Object.freeze({ id: 'last:0', new_name: 'Series 3' });
    const first = Object.freeze({ id: 'first', filepath: '/books/Series/1.cbz', volumes: firstVolumes, out_path: '/output', size_mb: 1.5 });
    const other = Object.freeze({ id: 'other', filepath: '/other/Series/1.cbz', volumes: [], checked: false, size_mb: 2 });
    const last = Object.freeze({ id: 'last', filepath: '/books/Series/3.cbz', volumes: Object.freeze([lastVolume]), out_path: '/output', size_mb: '2.5' });
    const items = Object.freeze([first, other, last]);

    const groups = groupOrganizerItems(items, 'Linux');

    assert.equal(groups.length, 2);
    assert.equal(groups[0].id, 'organizer-directory:/books/Series');
    assert.equal(groups[0].directoryPath, '/books/Series');
    assert.equal(groups[0].name, 'Series');
    assert.deepEqual(groups[0].items, [first, last]);
    assert.equal(groups[0].items[0], first);
    assert.equal(groups[0].items[1], last);
    assert.deepEqual(groups[0].volumes.map(row => row.volume.id), ['first:0', 'first:1', 'last:0']);
    assert.equal(groups[0].volumes[0].item, first);
    assert.equal(groups[0].volumes[0].volume, firstVolumes[0]);
    assert.equal(groups[0].volumes[2].item, last);
    assert.equal(groups[0].volumes[2].volume, lastVolume);
    assert.equal(groups[0].size_mb, 4);
    assert.equal(groups[0].out_path, '/output');
    assert.equal(groups[0].mixedOutPaths, false);
    assert.equal(groups[0].checked, true);
    assert.equal(groups[0].partiallyChecked, false);
    assert.equal(groups[1].items[0], other);
    assert.equal(groups[1].checked, false);
    assert.equal(groups[1].partiallyChecked, false);
    assert.equal(first.volumes, firstVolumes);
    assert.equal(first.volumes.length, 2);
    assert.equal(items.length, 3);
});

test('같은 폴더명이나 출력경로라도 원본 부모 경로가 다르면 그룹을 나눈다', () => {
    const groups = groupOrganizerItems([
        { id: 'first', filepath: '/first/Series/1.cbz', out_path: '/shared' },
        { id: 'second', filepath: '/second/Series/2.cbz', out_path: '/shared' },
    ]);

    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map(group => group.name), ['Series', 'Series']);
    assert.notEqual(groups[0].id, groups[1].id);
});

test('출력경로와 선택 상태가 바뀌어도 원본 폴더 그룹은 유지하고 혼합 상태를 계산한다', () => {
    const first = { id: 'first', filepath: '/books/Series/1.cbz', out_path: '/original', checked: true };
    const second = { id: 'second', filepath: '/books/Series/2.cbz', out_path: '/original', checked: false };
    const initial = groupOrganizerItems([first, second])[0];
    const changed = groupOrganizerItems([first, { ...second, out_path: '/new-output' }])[0];
    const allChanged = groupOrganizerItems([
        { ...first, out_path: '/new-output', checked: true },
        { ...second, out_path: '/new-output', checked: true },
    ])[0];

    assert.equal(changed.id, initial.id);
    assert.equal(changed.directoryPath, '/books/Series');
    assert.equal(changed.out_path, '');
    assert.equal(changed.mixedOutPaths, true);
    assert.equal(changed.checked, false);
    assert.equal(changed.partiallyChecked, true);
    assert.equal(allChanged.id, initial.id);
    assert.equal(allChanged.out_path, '/new-output');
    assert.equal(allChanged.mixedOutPaths, false);
    assert.equal(allChanged.checked, true);
    assert.equal(allChanged.partiallyChecked, false);
    assert.equal(second.out_path, '/original');
    assert.equal(second.checked, false);
});

test('macOS 그룹 키만 NFC로 정규화하고 원본 경로와 대소문자를 보존한다', () => {
    const directory = '/books/작품';
    const first = { id: 'first', filepath: `${directory.normalize('NFD')}/1.cbz` };
    const second = { id: 'second', filepath: `${directory.normalize('NFC')}/2.cbz` };

    const macGroups = groupOrganizerItems([first, second], 'MacIntel');

    assert.equal(macGroups.length, 1);
    assert.equal(macGroups[0].id, `organizer-directory:${directory.normalize('NFC')}`);
    assert.equal(macGroups[0].directoryPath, directory.normalize('NFD'));
    assert.equal(macGroups[0].items[0].filepath, first.filepath);
    assert.equal(groupOrganizerItems([first, second], 'Linux').length, 2);
    assert.equal(groupOrganizerItems([
        { filepath: '/books/Series/1.cbz' },
        { filepath: '/books/series/2.cbz' },
    ], 'MacIntel').length, 2);
});

test('Windows 그룹은 구분자와 대소문자를 통일하며 표시·출력 경로는 원본을 유지한다', () => {
    const first = { id: 'first', filepath: 'C:\\Books\\Series\\1.cbz', out_path: 'D:\\Output' };
    const second = { id: 'second', filepath: 'c:/books/series/2.cbz', out_path: 'd:/output' };
    const groups = groupOrganizerItems([first, second], 'Win32');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, 'organizer-directory:c:/books/series');
    assert.equal(groups[0].directoryPath, 'C:\\Books\\Series');
    assert.equal(groups[0].name, 'Series');
    assert.equal(groups[0].out_path, 'D:\\Output');
    assert.equal(groups[0].mixedOutPaths, false);
    assert.equal(groups[0].items[0].filepath, first.filepath);
    assert.equal(groups[0].items[1].filepath, second.filepath);
});

test('파일이 루트 디렉터리에 있어도 루트 경로를 잃지 않는다', () => {
    const posix = groupOrganizerItems([{ filepath: '/one.cbz' }, { filepath: '/two.cbz' }], 'Linux');
    const windows = groupOrganizerItems([{ filepath: 'C:\\one.cbz' }, { filepath: 'c:/two.cbz' }], 'Win32');

    assert.equal(posix.length, 1);
    assert.equal(posix[0].directoryPath, '/');
    assert.equal(posix[0].name, '/');
    assert.equal(posix[0].id, 'organizer-directory:/');
    assert.equal(windows.length, 1);
    assert.equal(windows[0].directoryPath, 'C:\\');
    assert.equal(windows[0].name, 'C:\\');
    assert.equal(windows[0].id, 'organizer-directory:c:/');
});

test('원본 경로가 없는 항목은 id가 같거나 비어 있어도 각각 표시한다', () => {
    const items = [{ id: 'same', name: 'one' }, { id: 'same', name: 'two' }, {}, {}];
    const groups = groupOrganizerItems(items);

    assert.equal(groups.length, 4);
    assert.equal(new Set(groups.map(group => group.id)).size, 4);
    assert.equal(groups[0].items[0], items[0]);
    assert.equal(groups[1].items[0], items[1]);
    assert.equal(groups[0].name, 'one');
    assert.equal(groups[1].name, 'two');
    assert.equal(groups[0].size_mb, 0);
    assert.deepEqual(groupOrganizerItems([]), []);
});
