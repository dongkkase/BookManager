import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { legacyTranslations } from './utils/i18nData.js';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const settingsSource = readFileSync(path.join(srcRoot, 'components/SettingsModal.jsx'), 'utf8');
const settingsStyles = readFileSync(path.join(srcRoot, 'styles/App.css'), 'utf8');

test('기본 설정은 확장자 선택과 실제 파일 연결 상태를 분리해 표시한다', () => {
    assert.match(settingsSource, /getFileAssociationStatus/);
    assert.match(settingsSource, /applyFileAssociations\(selectedFileAssociations\)/);
    assert.match(settingsSource, /onPersistViewerPaths\(\{ viewer_paths: viewerPaths \}\)/);
    assert.match(settingsSource, /openFileAssociationSettings/);
    assert.match(settingsSource, /requiresSystemConfirmation && window\.electronAPI\?\.openFileAssociationSettings/);
    assert.match(settingsSource, /handleRefreshFileAssociationStatus/);
    assert.match(settingsSource, /checked=\{selectedFileAssociations\.includes\(extension\)\}/);
    assert.match(settingsSource, /useRegisteredCandidate \? association\.isRegistered : association\.isDefault/);
    assert.match(settingsSource, /association\.isDefault/);
    assert.match(settingsSource, /association\.handlerName/);

    for (const group of ['comic', 'document', 'text', 'audio']) {
        assert.match(settingsSource, new RegExp(`key: '${group}'`));
    }
});

test('파일 연결 UI는 비활성화, 상태 배지, 결과 메시지 스타일을 제공한다', () => {
    assert.match(settingsSource, /fileAssociationControlsDisabled/);
    assert.match(settingsSource, /role=\{fileAssociationFeedback\.type === 'error' \? 'alert' : 'status'\}/);
    assert.match(settingsStyles, /\.settings-file-association-option:has\(input:disabled\)/);
    assert.match(settingsStyles, /\.settings-file-association-badge\.is-default/);
    assert.match(settingsStyles, /\.settings-file-association-message\.is-error/);
});

test('파일 연결 설정 문구는 한국어, 영어, 일본어로 제공한다', () => {
    const keys = [
        'file_association_title',
        'file_association_desc',
        'file_association_behavior_notice',
        'file_association_unsupported',
        'file_association_macos_12_required',
        'file_association_refresh',
        'file_association_apply',
        'file_association_status_bookmanager',
        'file_association_status_other',
        'file_association_status_none',
        'file_association_windows_confirmation',
        'file_association_open_settings',
    ];

    for (const language of ['ko', 'en', 'ja']) {
        for (const key of keys) {
            assert.ok(legacyTranslations[language][key], `${language}:${key}`);
        }
    }
});
