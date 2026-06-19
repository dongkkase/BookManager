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
