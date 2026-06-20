import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);

function readPngSize(filePath) {
    const data = fs.readFileSync(filePath);
    assert.deepEqual([...data.subarray(1, 4)], [80, 78, 71]);
    return {
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
    };
}

test('macOS 고해상도 앱 아이콘은 1024px 정사각형이다', () => {
    const iconPath = path.join(projectRoot, packageConfig.build.mac.icon);
    assert.deepEqual(readPngSize(iconPath), { width: 1024, height: 1024 });
});

test('macOS 배포본은 설치형 DMG가 아닌 universal portable ZIP이다', () => {
    assert.deepEqual(packageConfig.build.mac.target, [{
        target: 'zip',
        arch: ['universal'],
    }]);
    assert.equal(
        packageConfig.build.mac.artifactName,
        'BookManager-${version}-portable-${arch}.${ext}',
    );
});

test('Windows 빌드와 런타임은 ICO 앱 아이콘을 사용한다', () => {
    const iconPath = path.join(projectRoot, packageConfig.build.win.icon);
    const data = fs.readFileSync(iconPath);

    assert.equal(data.readUInt16LE(0), 0);
    assert.equal(data.readUInt16LE(2), 1);
    assert.equal(path.extname(iconPath), '.ico');
});

test('앱 번들 이름과 식별자는 BookManager 정책을 사용한다', () => {
    assert.equal(packageConfig.build.productName, 'BookManager');
    assert.equal(packageConfig.build.appId, 'com.bookmanager.app');
});

test('Electron 메인 프로세스의 i18n 모듈은 app.asar 패키징 대상에 포함한다', () => {
    const i18nFileSet = packageConfig.build.files.find(item => (
        typeof item === 'object'
        && item.from === 'src/utils'
        && item.to === 'src/utils'
    ));
    assert.ok(i18nFileSet);
    assert.equal(i18nFileSet.filter.includes('i18n.js'), true);
    assert.equal(i18nFileSet.filter.includes('i18nData.js'), true);
});

test('macOS 메뉴 막대 아이콘은 16px 템플릿 이미지로 생성한다', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.match(mainSource, /nativeImage\.createFromPath\(iconPath\)\.resize\(\{/);
    assert.match(mainSource, /width:\s*16/);
    assert.match(mainSource, /height:\s*16/);
    assert.match(mainSource, /setTemplateImage\(true\)/);
    assert.match(mainSource, /new Tray\(trayIcon\)/);
});

test('저장된 썸네일은 제한된 전용 프로토콜로 제공한다', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.match(mainSource, /protocol\.registerSchemesAsPrivileged/);
    assert.match(mainSource, /protocol\.handle\('bookmanager-thumbnail'/);
    assert.match(mainSource, /resolveThumbnailDir\(getExecutableDir\(\)\)/);
    assert.match(mainSource, /path\.basename\(requestedName\) !== requestedName/);
});

test('렌더러 CSP는 전용 썸네일 프로토콜 이미지를 허용한다', () => {
    const indexSource = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

    assert.match(indexSource, /img-src[^;]*bookmanager-thumbnail:/);
});
