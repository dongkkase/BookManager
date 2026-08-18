import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyTranslations } from './utils/i18nData.js';
import {
    APP_NAME,
    DISCORD_URL,
    ISSUE_URL,
    MANUAL_URL,
    TABS,
    canAcceptGlobalDrop,
    formatAppTitle,
    isFileToolbarEnabled,
    normalizeDroppedPaths,
    resolveTabId,
} from './appShell.js';

test('탭 순서가 원본 순서를 유지한다', () => {
    assert.deepEqual(
        TABS.map(tab => tab.id),
        ['folder', 'organizer', 'renamer', 'metadata', 'sharing', 'releases'],
    );
});

test('공통 파일 툴바는 파일 작업 탭에서만 활성화된다', () => {
    assert.equal(isFileToolbarEnabled('folder'), false);
    assert.equal(isFileToolbarEnabled('organizer'), true);
    assert.equal(isFileToolbarEnabled('renamer'), true);
    assert.equal(isFileToolbarEnabled('metadata'), true);
    assert.equal(isFileToolbarEnabled('sharing'), false);
    assert.equal(isFileToolbarEnabled('releases'), false);
    assert.equal(isFileToolbarEnabled('organizer', true), false);
});

test('앱 제목은 버전을 제외한 BookManager 이름만 사용한다', () => {
    assert.equal(APP_NAME, 'BookManager');
    assert.equal(formatAppTitle('3.0.0'), 'BookManager');
    assert.equal(formatAppTitle(''), 'BookManager');
});

test('버그 신고 URL은 원본 저장소 이슈 주소를 유지한다', () => {
    assert.equal(ISSUE_URL, 'https://github.com/dongkkase/BookManager/issues');
});

test('Discord URL은 공식 초대 주소를 사용한다', () => {
    assert.equal(DISCORD_URL, 'https://discord.gg/ND6gpPZHD');
});

test('매뉴얼 URL은 원본 저장소 Wiki 주소를 사용한다', () => {
    assert.equal(MANUAL_URL, 'https://github.com/dongkkase/BookManager/wiki');
});

test('공유 서버와 릴리즈 탭 및 작업 중에는 전역 드롭을 무시한다', () => {
    assert.equal(canAcceptGlobalDrop('folder'), true);
    assert.equal(canAcceptGlobalDrop('organizer'), true);
    assert.equal(canAcceptGlobalDrop('sharing'), false);
    assert.equal(canAcceptGlobalDrop('releases'), false);
    assert.equal(canAcceptGlobalDrop('metadata', true), false);
});

test('드롭 경로는 입력 순서를 유지하며 중복과 빈 값을 제거한다', () => {
    assert.deepEqual(
        normalizeDroppedPaths(['/books/a.cbz', '', '/books/b.zip', '/books/a.cbz']),
        ['/books/a.cbz', '/books/b.zip'],
    );
});

test('드롭 경로는 Unicode와 Windows NAS 구분자를 정규화한다', () => {
    assert.deepEqual(
        normalizeDroppedPaths([
            `C:/만화/${'한글'.normalize('NFD')}/책.cbz`,
            'c:\\만화\\한글\\책.cbz',
            '//NAS/공유/漫画/📚.cbz',
        ]),
        ['C:\\만화\\한글\\책.cbz', '\\\\NAS\\공유\\漫画\\📚.cbz'],
    );
});

test('POSIX 드롭 경로는 원문을 유지하면서 Unicode 정규형 중복만 제거한다', () => {
    const decomposedPath = `/책/${'한글'.normalize('NFD')}/오디오.m4a`;
    const composedPath = decomposedPath.normalize('NFC');

    assert.notEqual(decomposedPath, composedPath);
    assert.deepEqual(
        normalizeDroppedPaths([decomposedPath, composedPath]),
        [decomposedPath],
    );
    assert.deepEqual(
        normalizeDroppedPaths(['/tmp/a\\b', '/tmp/a/b']),
        ['/tmp/a\\b', '/tmp/a/b'],
    );
});

test('마지막 탭 인덱스를 복원하고 잘못된 값은 첫 탭으로 보정한다', () => {
    assert.equal(resolveTabId(0), 'folder');
    assert.equal(resolveTabId(3), 'metadata');
    assert.equal(resolveTabId('5'), 'releases');
    assert.equal(resolveTabId('metadata'), 'metadata');
    assert.equal(resolveTabId('invalid', 2), 'renamer');
    assert.equal(resolveTabId(-1), 'folder');
    assert.equal(resolveTabId(99), 'folder');
    assert.equal(resolveTabId('invalid'), 'folder');
});

test('한국어·영어·일본어 탭 문구가 원본 번역 키를 그대로 사용한다', () => {
    const expected = {
        ko: ['폴더', '압축 파일 구조 정리(평탄화)', '내부 파일명 변경', '메타데이터 관리', '공유 서버', '업데이트 및 릴리즈 노트'],
        en: ['Folders', 'Archive Organizer', 'Inner Renamer', 'Metadata Management', 'Sharing', 'Updates & Release Notes'],
        ja: ['フォルダ', 'アーカイブ構成整理 (フラット化)', '内部ファイル名変更', 'メタデータ管理', '共有サーバー', 'アップデート & リリースノート'],
    };

    for (const [language, labels] of Object.entries(expected)) {
        assert.deepEqual(
            TABS.map(tab => legacyTranslations[language][tab.labelKey]),
            labels,
        );
    }
});
