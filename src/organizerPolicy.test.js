import test from 'node:test';
import assert from 'node:assert/strict';

import {
    changeOrganizerUnit,
    filenameOutputPath,
    organizerExtractedTitleName,
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
