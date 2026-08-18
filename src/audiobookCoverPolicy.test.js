import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { successfulAudioCoverTargets } from './audiobookCoverPolicy.js';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const metadataTabSource = read('./tabs/MetadataTab.jsx');
const metadataEditorSource = read('./components/metadata/AudiobookMetadataEditor.jsx');
const preloadSource = read('../electron/preload.cjs');
const preloadModuleSource = read('../electron/preload.js');
const ipcSource = read('../electron/ipcHandlers.js');
const databaseSource = read('../electron/database/library_db.js');
const metadataTaskSource = read('../electron/tasks/metadataTask.js');
const folderScanSource = read('../electron/tasks/folderScanTask.js');
const viewerSessionsSource = read('../electron/viewerSessions.js');

test('오디오북 썸네일 저장과 교체 UI가 안전한 IPC 경로에 연결된다', () => {
    assert.match(metadataEditorSource, /renderCoverField\?\.\(\)/);
    assert.match(metadataTabSource, /handleExportAudioCover/);
    assert.match(metadataTabSource, /handleSelectLocalAudioCover/);
    assert.match(metadataTabSource, /handleResetAudioCoverChange/);
    assert.match(metadataTabSource, /payload\.audioCoverChange = item\.audioCoverChange/);
    assert.match(metadataTabSource, /successfulAudioCoverTargets/);
    assert.match(metadataTabSource, /AUDIOBOOK_SAVE_FIELD_IDS/);
    assert.match(preloadSource, /exportMetadataCover: \(options\) => ipcRenderer\.invoke\('metadata:exportCover', options\)/);
    assert.match(preloadModuleSource, /exportMetadataCover: \(options\) => ipcRenderer\.invoke\('metadata:exportCover', options\)/);
    assert.match(ipcSource, /ipcMain\.handle\('metadata:exportCover'/);
    assert.match(ipcSource, /decodeMetadataCoverDataUrl/);
});

test('동일한 파일명의 오디오 일부만 저장되면 실패한 항목의 표지 변경은 pending으로 유지한다', () => {
    const successfulPath = '/library/first/Same Title.mp3';
    const failedPath = '/library/second/Same Title.mp3';
    const targets = [
        {
            bookType: 'audio',
            filepath: successfulPath,
            name: 'Same Title.mp3',
            audioCoverChange: { type: 'file', filePath: '/covers/first.png' },
        },
        {
            bookType: 'audio',
            filepath: failedPath,
            name: 'Same Title.mp3',
            audioCoverChange: { type: 'file', filePath: '/covers/second.png' },
        },
    ];

    const successfulTargets = successfulAudioCoverTargets(targets, [successfulPath]);

    assert.deepEqual(successfulTargets.map(item => item.filepath), [successfulPath]);
    assert.equal(successfulTargets.includes(targets[1]), false);
    assert.deepEqual(targets[1].audioCoverChange, {
        type: 'file',
        filePath: '/covers/second.png',
    });
});

test('사용자 지정 오디오북 썸네일은 DB와 스캔, 메타데이터, 뷰어에서 일관되게 우선한다', () => {
    assert.match(databaseSource, /cover_override_path TEXT/);
    assert.match(metadataTaskSource, /audioCoverChange/);
    assert.match(metadataTaskSource, /ignoreAudioCoverOverride/);
    assert.match(metadataTaskSource, /audioCoverOverride/);
    assert.match(folderScanSource, /validAudioCoverOverridePath/);
    assert.match(folderScanSource, /cover_override_path: audioCoverOverridePath/);
    assert.match(viewerSessionsSource, /audioArtworkWithLibraryOverride/);
});
