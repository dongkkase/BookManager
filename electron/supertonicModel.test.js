import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    SUPERTONIC_ARCHIVE_NAME,
    SUPERTONIC_DOWNLOAD_URL,
    SUPERTONIC_MODEL_VERSION,
    getSupertonicModelStatus,
    isAllowedSupertonicDownloadUrl,
    resolveSupertonicModelDir,
} from './supertonicModel.js';

test('Supertonic 모델은 앱 데이터 폴더 하위의 고정 경로를 사용한다', () => {
    assert.equal(
        resolveSupertonicModelDir('/portable/BookManager', 'linux', {}),
        path.join('/portable/BookManager', 'BookManagerData', 'models', 'supertonic-3'),
    );
    assert.equal(
        resolveSupertonicModelDir('/portable/BookManager.app/Contents/MacOS', 'darwin', {}),
        path.join('/portable', 'BookManagerData', 'models', 'supertonic-3'),
    );
});

test('Supertonic 다운로드는 고정 릴리즈 파일과 허용된 리디렉션 호스트만 사용한다', () => {
    assert.equal(SUPERTONIC_DOWNLOAD_URL.endsWith(`/${SUPERTONIC_ARCHIVE_NAME}`), true);
    assert.match(SUPERTONIC_DOWNLOAD_URL, /dongkkase\/BookManager-Models\/releases\/download/);
    assert.equal(isAllowedSupertonicDownloadUrl(SUPERTONIC_DOWNLOAD_URL), true);
    assert.equal(isAllowedSupertonicDownloadUrl('https://example.com/model.zip'), false);
    assert.equal(isAllowedSupertonicDownloadUrl('https://release-assets.githubusercontent.com/model.zip', true), true);
    assert.equal(SUPERTONIC_MODEL_VERSION.length, 40);
});

test('필수 모델 파일이 없으면 Supertonic을 설치되지 않은 상태로 판정한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-supertonic-status-'));
    try {
        const status = getSupertonicModelStatus(tempDir);
        assert.equal(status.installed, false);
        assert.equal(status.modelDir, tempDir);
        assert.equal(status.downloadUrl, SUPERTONIC_DOWNLOAD_URL);
        assert.ok(status.archiveSize > 300 * 1024 * 1024);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
