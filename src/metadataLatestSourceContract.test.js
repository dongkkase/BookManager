import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(srcRoot);
const metadataTabSource = readFileSync(path.join(srcRoot, 'tabs/MetadataTab.jsx'), 'utf8');
const metadataTaskSource = readFileSync(path.join(projectRoot, 'electron/tasks/metadataTask.js'), 'utf8');
const libraryDbSource = readFileSync(path.join(projectRoot, 'electron/database/library_db.js'), 'utf8');
const ipcHandlersSource = readFileSync(path.join(projectRoot, 'electron/ipcHandlers.js'), 'utf8');
const preloadEsmSource = readFileSync(path.join(projectRoot, 'electron/preload.js'), 'utf8');
const preloadCjsSource = readFileSync(path.join(projectRoot, 'electron/preload.cjs'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `${startMarker} 시작 지점을 찾을 수 있어야 합니다.`);
    assert.ok(end > start, `${endMarker} 종료 지점을 찾을 수 있어야 합니다.`);
    return source.slice(start, end);
}

test('최신권 조회 IPC 계약은 두 preload와 메인 task에 동일하게 연결된다', () => {
    const preloadContract = /loadLatestSeriesMetadata:\s*\(criteria\)\s*=>\s*ipcRenderer\.invoke\('metadata:latest',\s*criteria\)/;

    assert.match(preloadEsmSource, preloadContract);
    assert.match(preloadCjsSource, preloadContract);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('metadata:latest',[\s\S]*?loadLatestSeriesMetadata\(criteria,[\s\S]*?dbPath:\s*libraryDbPath\(\)/);
    assert.match(metadataTaskSource, /export async function loadLatestSeriesMetadata\(criteria\s*=\s*\{\},\s*options\s*=\s*\{\}\)/);
});

test('최신권 후보는 현재 폴더가 아니라 라이브러리 files 전체에서 제목으로 조회한다', () => {
    const candidateSource = sourceBetween(
        libraryDbSource,
        'async getMetadataTitleCandidates',
        'async searchFiles',
    );

    assert.match(candidateSource, /const title\s*=\s*String\(criteria\.title/);
    assert.match(candidateSource, /SELECT path, title, volume, number, mtime, book_type, ext[\s\S]*?FROM files/);
    assert.match(candidateSource, /title\.normalize\('NFC'\)[\s\S]*?title\.normalize\('NFD'\)/);
    assert.match(candidateSource, /titleClauses\s*=\s*titlePrefixes\.map\([\s\S]*?title LIKE \? ESCAPE/);
    assert.match(candidateSource, /WHERE \(\$\{titleClauses\.join\(' OR '\)\}\)/);
    assert.match(candidateSource, /COLLATE NOCASE/);
    assert.doesNotMatch(candidateSource, /criteria\.(?:series|seriesGroup)|series_group/);
    assert.doesNotMatch(candidateSource, /folderPath|libraryPaths|path LIKE|activeItem\.group/);
});

test('최신권 task는 DB 후보의 실제 파일을 표지 없이 다시 분석한다', () => {
    const taskSource = sourceBetween(
        metadataTaskSource,
        'export async function loadLatestSeriesMetadata',
        'export function metadataWriteSupport',
    );

    assert.match(taskSource, /normalizeLatestMetadataTitle\(criteria\.title\)/);
    assert.match(taskSource, /getMetadataTitleCandidates\(\{[\s\S]*?title:\s*normalizedCriteria\.title/);
    assert.match(taskSource, /analyzeMetadataInputs\(\[candidate\.candidatePath\]/);
    assert.match(taskSource, /includeCovers:\s*false/);
    assert.match(taskSource, /for \(const candidate of candidates\)/);
    assert.doesNotMatch(taskSource, /criteria\.(?:series|seriesGroup)|normalizedCriteria\.(?:series|seriesGroup)/);
});

test('메타데이터 탭은 현재 항목의 Title로 전역 최신권 결과를 조회해 batch 정책으로 적용한다', () => {
    const handlerSource = sourceBetween(
        metadataTabSource,
        'const handleLoadLatest',
        'const sanitizeItemForSave',
    );

    assert.match(handlerSource, /const handleLoadLatest\s*=\s*async/);
    assert.match(handlerSource, /window\.electronAPI(?:\?\.|\.)loadLatestSeriesMetadata/);
    assert.match(handlerSource, /const title\s*=\s*String\(activeItem\.metadata\?\.Title\s*\|\|\s*''\)\.trim\(\)/);
    assert.match(handlerSource, /loadLatestSeriesMetadata\?\.\(\{[\s\S]*?\btitle\s*,/);
    assert.match(handlerSource, /bookType:\s*activeBookType/);
    assert.match(handlerSource, /buildLatestMetadataBatch\(/);
    assert.match(handlerSource, /setBatchMetadata\(/);
    assert.doesNotMatch(handlerSource, /inferTitleParts\(activeItem\)/);
    assert.doesNotMatch(handlerSource, /activeItem\.metadata\?\.(?:Series|SeriesGroup)|activeItem\.group/);
    assert.doesNotMatch(handlerSource, /fileList\.filter\([\s\S]*?activeItem\.group/);
});
