import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTranslation, legacyTranslations, translate, translateKnownText } from './utils/i18n.js';

test('인덱스 및 순차 자리표시자에 동적 값을 삽입한다', () => {
    assert.equal(formatTranslation('{0}개 성공, {1}개 실패', [3, 1]), '3개 성공, 1개 실패');
    assert.equal(formatTranslation('{} series have {} missing volumes', [2, 4]), '2 series have 4 missing volumes');
});

test('누락 권수 Toast 문구를 각 언어에서 동적으로 생성한다', () => {
    assert.match(translate('tf_toast_missing', 'ko', [2]), /2/);
    assert.match(translate('tf_toast_missing', 'en', [2]), /2/);
    assert.match(translate('tf_toast_missing', 'ja', [2]), /2/);
});

test('한국어, 영어, 일본어는 동일한 원본 번역 키 집합을 제공한다', () => {
    const allKeys = new Set(
        Object.values(legacyTranslations).flatMap(translations => Object.keys(translations)),
    );
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of allKeys) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
});

test('지원하지 않는 언어와 누락된 현지어 문구는 한국어로 fallback한다', () => {
    assert.equal(translate('tab_folders', 'unknown'), legacyTranslations.ko.tab_folders);
    assert.equal(translate('folder.status.files_found', 'en', { count: 3 }), '3 files found');
});

test('공유 서버는 포트 수정과 OPDS HTTP 호환 안내를 세 언어로 제공한다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        assert.match(translate('tab_sharing_port_desc', language), /1024.*65535/);
        assert.match(translate('tab_sharing_https_desc', language), /OPDS/);
        assert.match(translate('tab_sharing_https_desc', language), /HTTP/);
    }
});

test('named placeholder와 반복 placeholder를 모두 치환한다', () => {
    assert.equal(
        formatTranslation('{count}개 중 {count}개 완료: {msg}', { count: 2, msg: '완료' }),
        '2개 중 2개 완료: 완료',
    );
});

test('이미 표시 중인 번역 문자열을 현재 언어 문구로 다시 해석한다', () => {
    assert.equal(translateKnownText(legacyTranslations.ko.status_wait, 'en'), legacyTranslations.en.status_wait);
    assert.equal(translateKnownText(legacyTranslations.en.status_wait, 'ja'), legacyTranslations.ja.status_wait);
    assert.equal(translateKnownText('사용자 입력 문자열', 'en'), '사용자 입력 문자열');
});

test('폴더 리스트의 출판 레이블 라벨은 메타데이터 필드와 일치한다', () => {
    assert.equal(legacyTranslations.ko.col_imprint, legacyTranslations.ko.t3_f_imp);
    assert.equal(legacyTranslations.en.col_imprint, legacyTranslations.en.t3_f_imp);
    assert.equal(legacyTranslations.ja.col_imprint, legacyTranslations.ja.t3_f_imp);
});

test('구조 정리 일괄 폴더명 추출 메뉴를 세 언어로 표시한다', () => {
    assert.equal(translate('org_batch_folder_name', 'ko'), '일괄: 폴더명 추출');
    assert.equal(translate('org_batch_folder_name', 'en'), 'All: Folder Name');
    assert.equal(translate('org_batch_folder_name', 'ja'), '一括: フォルダ名抽出');
});
