import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNativePath, normalizeNativePaths } from './pathPolicy.js';

test('Windows 경로 구분자를 네이티브 형식으로 정규화한다', () => {
    assert.equal(
        normalizeNativePath('C:/만화/일본語/책.cbz', 'win32'),
        'C:\\만화\\일본語\\책.cbz',
    );
});

test('macOS POSIX 경로와 이모지를 보존한다', () => {
    assert.equal(
        normalizeNativePath('/Volumes/NAS/만화/📚 책.cbz', 'darwin'),
        '/Volumes/NAS/만화/📚 책.cbz',
    );
});

test('파일 시스템 접근용 경로는 플랫폼에 관계없이 원래 Unicode 형식을 보존한다', () => {
    const decomposed = `/Users/test/${'한글'.normalize('NFD')}/本.cbz`;
    for (const platform of ['darwin', 'linux']) {
        assert.equal(normalizeNativePath(decomposed, platform), decomposed);
        assert.equal(normalizeNativePath(decomposed.normalize('NFC'), platform), decomposed.normalize('NFC'));
    }
    const windowsPath = `Z:\\${'한글'.normalize('NFD')}\\本.cbz`;
    assert.equal(normalizeNativePath(windowsPath, 'win32'), windowsPath);
});

test('UNC NAS 경로의 서버와 공유 이름을 보존한다', () => {
    assert.equal(
        normalizeNativePath('//NAS01/공유/漫画/책.cbz', 'win32'),
        '\\\\NAS01\\공유\\漫画\\책.cbz',
    );
});

test('Windows 경로는 대소문자와 구분자 차이를 중복으로 처리한다', () => {
    assert.deepEqual(
        normalizeNativePaths([
            'Z:/Books/책.cbz',
            'z:\\books\\책.cbz',
            '\\\\NAS\\공유\\本.cbz',
        ], 'win32'),
        ['Z:\\Books\\책.cbz', '\\\\NAS\\공유\\本.cbz'],
    );
});
