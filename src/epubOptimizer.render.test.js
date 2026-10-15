import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB optimizer keeps per-book settings below the list and writes only checked files on explicit execution', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') return t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-render-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import EpubOptimizerTool from ${JSON.stringify(`/@fs/${path.join(root, 'src/features/fileTools/epubOptimizer/EpubOptimizerTool.jsx')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(root, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(root, 'src/styles/global.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(root, 'src/styles/App.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const requests = [];
const books = ['/fixture/삽화가 있는 소설.epub', '/fixture/사진으로 보는 여행.epub'];
const longResourcePath = 'EPUB/Text/부록/아주 긴 내부 폴더 이름/독서 기록과 판본별 차이를 설명하는 부록 본문.xhtml';
const revisions = new Map();
let progress;
const analysis = filePath => ({ filePath, size: 12 * 1024 * 1024, version: '3.0', fixedLayout: Boolean(window.fixedLayout), fingerprint: filePath + ':' + (revisions.get(filePath) || 0),
    warnings: ['MISSING_RESOURCES'], missingResources: [{ packageName: 'EPUB/package.opf', href: 'Fonts/missing.ttf', name: 'EPUB/Fonts/missing.ttf', mediaType: 'font/ttf' }], resources: [
    { name: 'Images/illustration.jpg', kind: 'image', mediaType: 'image/jpeg', originalSize: 9 * 1024 * 1024, compressedSize: 9 * 1024 * 1024, width: 4000, height: 3000, canOptimize: true, canRemove: false, usage: 'referenced' },
    { name: 'Images/cover.jpg', kind: 'image', mediaType: 'image/jpeg', originalSize: 1024 * 1024, compressedSize: 1024 * 1024, width: 2000, height: 3000, canOptimize: true, isCover: true, canRemove: false, usage: 'protected' },
    { name: 'Fonts/본문.ttf', kind: 'font', mediaType: 'font/ttf', originalSize: 6 * 1024 * 1024, compressedSize: 1024 * 1024, canOptimize: true, canRemove: false, usage: 'referenced' },
    { name: 'Text/chapter01.xhtml', kind: 'text', mediaType: 'application/xhtml+xml', originalSize: 100000, compressedSize: 10000, canOptimize: false, canRecompress: true, canRemove: false, usage: 'referenced' },
    { name: 'Images/unused.png', kind: 'image', mediaType: 'image/png', originalSize: 128 * 1024, compressedSize: 128 * 1024, width: 800, height: 600, canOptimize: true, canRemove: true, usage: 'unused' },
    { name: 'Fonts/unused.woff', kind: 'font', mediaType: 'font/woff', originalSize: 256 * 1024, compressedSize: 256 * 1024, canOptimize: false, canRemove: true, usage: 'unused' },
    { name: 'Audio/unused.mp3', kind: 'audio', mediaType: 'audio/mpeg', originalSize: 512 * 1024, compressedSize: 512 * 1024, canOptimize: false, canRemove: true, usage: 'unused' },
    { name: 'Audio/unknown.mp3', kind: 'audio', mediaType: 'audio/mpeg', originalSize: 128 * 1024, compressedSize: 128 * 1024, canOptimize: false, canRemove: false, usage: 'unknown' },
    { name: 'mimetype', kind: 'other', mediaType: 'application/epub+zip', originalSize: 20, compressedSize: 20, canOptimize: false, canRemove: false, usage: 'protected' },
    { name: 'META-INF/container.xml', kind: 'text', mediaType: 'application/xml', originalSize: 320, compressedSize: 180, canOptimize: false, canRemove: false, usage: 'protected' },
    { name: longResourcePath, kind: 'text', mediaType: 'application/xhtml+xml', originalSize: 64000, compressedSize: 6000, canOptimize: false, canRemove: false, usage: 'referenced' },
    ...Array.from({ length: window.extraResources ? 45 : 0 }, (_, index) => ({ name: 'Text/extra-' + index + '.xhtml', kind: 'text', mediaType: 'application/xhtml+xml', originalSize: 2000, compressedSize: 1000, canOptimize: false, canRemove: false, usage: 'referenced' })),
].map(resource => ({ canRecompress: resource.name !== 'mimetype' && !resource.encrypted, ...resource,
    ...(window.noRemovalCandidates ? { canRemove: false, usage: resource.usage === 'unused' ? 'referenced' : resource.usage } : {}) })) });
window.electronAPI = {
    stat: async () => ({ isFile: true, isDirectory: false }), selectFiles: async () => books,
    onEpubOptimizerProgress: callback => { progress = callback; return () => { progress = null; }; },
    epubOptimizer: async request => {
        requests.push(structuredClone(request));
        if (request.action === 'inspect') {
            if (window.failNextInspection) { window.failNextInspection = false; throw new Error('Fixture reinspection failed'); }
            return analysis(request.filePath);
        }
        if (request.action === 'optimize') {
            if (request.expectedFingerprint !== analysis(request.filePath).fingerprint) throw new Error('Stale fingerprint used after overwriting the original');
            progress?.({ operationId: request.operationId, percent: 50, completed: 2, total: 4, currentItem: 'Images/illustration.jpg' });
            await new Promise(resolve => { window.completeOptimization = resolve; });
            revisions.set(request.filePath, (revisions.get(request.filePath) || 0) + 1);
            return { status: 'saved', outputPath: request.filePath, backupPath: request.backup ? request.filePath.replace('/fixture/', '/fixture/bak/') : undefined,
                originalSize: 12*1024*1024, outputSize: 8*1024*1024, savedBytes: 4*1024*1024, warnings: [],
                removedResources: [{ name: 'Fonts/unused.woff', kind: 'font', compressedSize: 256 * 1024 }, { name: 'Audio/unused.mp3', kind: 'audio', compressedSize: 512 * 1024 }] };
        }
        return { canceled: true };
    },
};
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
let checks = 0;
const check = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };
async function until(predicate, message) { for (let i=0;i<300;i++) { if (predicate()) return; await frame(); } throw new Error(message + ': ' + document.body.textContent + ' Requests: ' + JSON.stringify(requests)); }
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === label);
const modeRadio = mode => document.querySelector('.epub-optimizer-mode-settings input[type="radio"][value="' + mode + '"]');
const backupCheckbox = () => document.querySelector('.epub-optimizer-backup input[type="checkbox"]');
const imageCheckbox = () => document.querySelector('input[aria-label="이미지 최적화"]');
const removalCheckbox = name => document.querySelector('input[aria-label="' + name + ' 삭제"]');
const removalCategory = kind => document.querySelector('input[aria-label="미사용 ' + kind + ' 삭제"]');
const removalPlan = kind => document.querySelector('.epub-optimizer-removal-categories [data-kind="' + kind + '"] .epub-optimizer-removal-plan').textContent;
const resourceRows = () => [...document.querySelectorAll('.epub-optimizer-resource-table tbody tr[data-resource]')];
const resourceRow = name => resourceRows().find(row => row.dataset.resource === name);
const resourceFilter = () => document.querySelector('select[aria-label="자료 필터"]');
const resourceSort = () => document.querySelector('select[aria-label="자료 정렬"]');
const resourceSearch = () => document.querySelector('input[aria-label="파일 이름·경로 검색"]');
const conversionCheckbox = (name, kind = '이미지') => document.querySelector('input[aria-label="' + name + ' · ' + kind + (kind === '이미지' ? ' 변환' : ' 압축') + '"]');
const selectValue = async (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await frame(); };
window.compactResourceMetrics = [];
const assertCompactResourceRows = context => {
    const heights = [];
    const table = document.querySelector('.epub-optimizer-resource-table');
    check(table.scrollWidth <= table.clientWidth + 1, context + ': compact resource tables must fit without horizontal scrolling');
    for (const row of resourceRows()) {
        const name = row.dataset.resource;
        const height = row.getBoundingClientRect().height;
        heights.push(height);
        check(height > 0 && height <= 64, context + ': resource row must fit two compact lines: ' + name + ' (' + height + 'px)');
        const filename = row.querySelector('.epub-optimizer-resource-label strong');
        check(filename.title === name && getComputedStyle(filename).whiteSpace === 'nowrap', context + ': single-line file names must retain the full path as a tooltip: ' + name);
        check(!row.querySelector('.epub-optimizer-resource-path'), context + ': file paths must not consume another row line: ' + name);
        const metadata = [...row.querySelector('.epub-optimizer-resource-metadata').children].map(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.top + bounds.height / 2;
        });
        check(Math.max(...metadata) - Math.min(...metadata) <= 2, context + ': resource kind, dimensions and usage must stay on one metadata line: ' + name);
        const inputs = [...row.querySelectorAll('.epub-optimizer-resource-inputs input')];
        if (inputs.length) {
            const bounds = inputs.map(input => input.getBoundingClientRect());
            const cell = row.cells[row.cells.length - 1].getBoundingClientRect();
            check(bounds.every(rect => Math.abs(rect.top - bounds[0].top) <= 1 && rect.left >= cell.left && rect.right <= cell.right), context + ': image inputs must share one line and fit inside their settings cell: ' + name);
        }
    }
    const metrics = { context, rows: heights.length, minHeight: Math.min(...heights), maxHeight: Math.max(...heights), tableWidth: table.clientWidth, contentWidth: table.scrollWidth };
    window.compactResourceMetrics.push(metrics);
    return metrics;
};
window.assertCompactResourceRows = assertCompactResourceRows;
const pressKey = async key => {
    window.keyboardComplete = false;
    window.keyboardRequest = key;
    await until(() => window.keyboardComplete, 'Keyboard event did not complete');
    await frame();
};
const rows = () => [...document.querySelectorAll('.epub-optimizer-files tbody tr')];
const inputValue = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles:true })); };
let beforeLeave;
createRoot(document.getElementById('root')).render(<EpubOptimizerTool config={{language:'ko'}} t={t} showToast={() => {}} onBack={() => {}} registerBeforeLeave={fn => { beforeLeave=fn; return () => {}; }} />);
window.testResult = (async () => {
    await until(() => beforeLeave && document.querySelector('.epub-optimizer-empty'), 'Empty state missing');
    check(document.querySelector('.epub-optimizer-empty').textContent.trim() === t('drag_drop'), 'Empty state must show the shared drop hint');
    check(!document.querySelector('.epub-optimizer-files, .cover-editor-footer'), 'Empty state must hide the list and execution controls');
    window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { activeTab: 'tools', action: 'add-file' } }));
    await until(() => rows().length === 2 && document.querySelector('.epub-optimizer-work-area') && !document.querySelector('[aria-busy="true"]'), 'Multi-file inspection did not complete');
    check(requests.filter(r => r.action === 'inspect').length === 2, 'Each book must be inspected');
    check(backupCheckbox().checked && !backupCheckbox().disabled, 'Original file backup must be enabled initially');
    const listToolbar = document.querySelector('.epub-optimizer-files .cover-editor-options-toolbar');
    check(!listToolbar.querySelector('strong, .epub-optimizer-selection-hint') && !listToolbar.textContent.includes('작업 목록'), 'List toolbar must omit the old heading and selection hint');
    check(backupCheckbox().labels[0].classList.contains('cover-editor-option-toggle') && backupCheckbox().labels[0].textContent.trim() === '원본 파일 백업', 'Backup must use the shared cover editor option toggle');
    check(backupCheckbox().labels[0].title.includes('bak'), 'Backup tooltip must describe the backup folder');
    check(document.querySelector('.epub-optimizer-footer-status small').textContent.includes('bak'), 'Enabled backup must be described in the save hint');
    check(document.querySelector('.epub-optimizer-missing-resources')?.textContent.includes('EPUB/Fonts/missing.ttf'), 'Missing resource warnings must list the unresolved path');
    const list = document.querySelector('.epub-optimizer-files').getBoundingClientRect();
    const workspace = document.querySelector('.epub-optimizer-work-area').getBoundingClientRect();
    check(workspace.top >= list.bottom, 'Selected-file workspace must be below the list');
    const modeSettings = document.querySelector('.epub-optimizer-mode-settings');
    check(modeSettings.querySelector('legend')?.textContent.trim() === '설정 방식', 'Settings scope choices must have an accessible group label');
    check(modeRadio('auto').name && modeRadio('auto').name === modeRadio('manual').name, 'Optimization modes must be one native radio group');
    check(modeRadio('auto').checked && !modeRadio('manual').checked, 'Automatic mode must be selected initially');
    check(modeRadio('auto').labels[0]?.textContent.trim() === '공통 설정' && modeRadio('manual').labels[0]?.textContent.trim() === '자료별 설정', 'Mode labels must describe whether resource overrides are available');
    check(document.querySelector('.epub-optimizer-resources h3')?.textContent.trim() === '내부 자료', 'Resource panel title must describe its contents in either mode');
    check(document.querySelector('.epub-optimizer-resource-table thead th:last-child').textContent.trim() === '실행 시 처리', 'Common mode must describe resource actions at execution');
    check([...document.querySelectorAll('.epub-optimizer-resource-table thead th')].map(cell => cell.textContent.trim()).join('|') === '파일|EPUB 내 용량|압축 해제 크기|실행 시 처리', 'Resource table must label file names and the two different size measurements explicitly');
    check(resourceRow('Fonts/본문.ttf').cells[1].textContent.trim() === '1.00 MB' && resourceRow('Fonts/본문.ttf').cells[2].textContent.trim() === '6.00 MB', 'Compressed and uncompressed sizes must match their respective columns');
    check(resourceRow('Images/illustration.jpg').querySelector('.epub-optimizer-resource-label strong').textContent === 'illustration.jpg' && resourceRow('Images/illustration.jpg').querySelector('[title="Images/illustration.jpg"]'), 'Resource rows must distinguish file names while retaining their complete path');
    assertCompactResourceRows('Common settings');
    check(!document.querySelector('.epub-optimizer-resource-table input[type="checkbox"]'), 'Common settings must not display disabled per-resource checkboxes');
    const totalResources = analysis(books[0]).resources.length;
    check(document.querySelector('.epub-optimizer-resource-count').textContent === '전체 ' + totalResources + '개 중 ' + totalResources + '개', 'Resource header must report filtered and total counts');
    check(resourceSort().value === 'size' && resourceRows()[0].dataset.resource === 'Images/illustration.jpg', 'Largest compressed resources must be shown first by default');
    check(resourceRow('Text/chapter01.xhtml').textContent.includes('ZIP 재압축 대상'), 'Recompressible text must show ZIP recompression eligibility instead of an unsupported-resource warning');
    check(resourceRow('mimetype').textContent.includes('개별 변환 없음') && resourceRow('mimetype').textContent.includes('삭제 제외'), 'The EPUB mimetype must remain an unmodified, deletion-protected resource');
    check(resourceRow('META-INF/container.xml').textContent.includes('ZIP 재압축 대상') && resourceRow('META-INF/container.xml').textContent.includes('삭제 제외'), 'Deletion protection must not imply that supported ZIP recompression is disabled');
    check([...resourceRow('META-INF/container.xml').querySelectorAll('[title]')].some(element => element.title.includes('삭제')), 'Protected resource usage must explain that the restriction concerns deletion');
    await selectValue(resourceFilter(), 'convert');
    check(resourceRows().length === 3 && resourceRow('Images/illustration.jpg') && resourceRow('Fonts/본문.ttf') && resourceRow('Images/unused.png'), 'Conversion filter must show only enabled image and font conversions');
    await selectValue(resourceFilter(), 'remove');
    check(resourceRows().length === 0 && document.querySelector('.epub-optimizer-resource-range').textContent === '0개', 'No selected deletions must produce an empty count rather than a fictitious page');
    button('필터 초기화').click(); await frame();
    check(resourceRows().length === totalResources && !button('필터 초기화'), 'Clearing filters must restore all resources and hide the reset action');
    button('자료별 설정').click(); await frame();
    check(modeRadio('manual').checked && conversionCheckbox('Images/illustration.jpg'), 'The resource-panel shortcut must activate editable per-resource settings');
    check(conversionCheckbox('Images/illustration.jpg').labels[0].textContent.trim() === '이미지 변환' && conversionCheckbox('Fonts/본문.ttf', '폰트').labels[0].textContent.trim() === '폰트 압축', 'Individual conversion checkboxes must explain their distinct actions');
    assertCompactResourceRows('Per-resource settings');
    modeRadio('auto').click(); await frame();
    check(document.querySelector('.epub-optimizer-font-option input[aria-label="폰트 무손실 압축 (WOFF)"]') && document.querySelector('.epub-optimizer-zip-option input[aria-label="ZIP 재압축"]'), 'Font compression and ZIP recompression must have separate labeled option cards');
    document.querySelector('input[aria-label="폰트 무손실 압축 (WOFF)"]').click(); await frame();
    check(document.querySelector('.epub-optimizer-font-option .cover-editor-note').textContent.includes('WOFF로 변환하지 않습니다.') && resourceRow('Fonts/본문.ttf').textContent.includes('ZIP 재압축 대상') && !resourceRow('Fonts/본문.ttf').textContent.includes('폰트 압축 대상'), 'Disabling font conversion must leave independent ZIP recompression available');
    document.querySelector('input[aria-label="폰트 무손실 압축 (WOFF)"]').click(); await frame();
    document.querySelector('input[aria-label="ZIP 재압축"]').click(); await frame();
    check(document.querySelector('.epub-optimizer-zip-option .cover-editor-note').textContent.includes('별도 ZIP 재압축을 하지 않습니다.') && resourceRow('Text/chapter01.xhtml').textContent.includes('개별 변환 없음'), 'Disabled ZIP recompression must describe the lack of individual processing for text');
    document.querySelector('input[aria-label="ZIP 재압축"]').click(); await frame();
    modeRadio('auto').focus();
    check(document.activeElement === modeRadio('auto'), 'Mode selection must accept keyboard focus');
    await pressKey('Right');
    check(modeRadio('manual').checked && !modeRadio('auto').checked && document.activeElement === modeRadio('manual'), 'Right arrow must move focus and selection to detailed settings');
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]'), 'Keyboard mode selection must reveal detailed resource controls');
    check(document.querySelector('.epub-optimizer-resource-table thead th:last-child').textContent.trim() === '자료별 설정', 'Resource mode must label its editable column as per-resource settings');
    await pressKey('Left');
    check(modeRadio('auto').checked && !modeRadio('manual').checked && document.activeElement === modeRadio('auto'), 'Left arrow must return focus and selection to automatic mode');
    imageCheckbox().click(); await frame();
    check(!imageCheckbox().checked && document.querySelector('.epub-optimizer-image-controls').matches(':disabled'), 'Turning image optimization off must disable all nested image controls');
    check([...document.querySelectorAll('.epub-optimizer-image-controls input')].every(input => input.matches(':disabled')), 'Quality, dimensions and cover controls must all be inactive when image optimization is off');
    check(document.querySelector('.epub-optimizer-image-option .cover-editor-note').textContent.trim() === '이미지 품질과 크기를 변경하지 않습니다. 미사용 이미지 삭제는 별도 설정입니다.', 'Disabled image optimization must describe actual preservation and separate deletion settings');
    check(document.querySelector('.epub-optimizer-image-controls').textContent.includes('px'), 'Image dimensions must show their pixel unit');
    modeRadio('manual').click(); await frame();
    imageCheckbox().click(); await frame();
    inputValue(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]'), '72'); await frame();
    inputValue(document.querySelector('input[aria-label="Images/illustration.jpg · 이미지 최대 긴 변"]'), '1600'); await frame();
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]').value === '72' && document.querySelector('input[aria-label="Images/illustration.jpg · 이미지 최대 긴 변"]').value === '1600', 'Compact image inputs must independently accept quality and dimension edits');
    assertCompactResourceRows('Edited resource controls');
    button('자료별 설정 초기화').click(); await frame();
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]').value === '82' && document.querySelector('input[aria-label="Images/illustration.jpg · 이미지 최대 긴 변"]').value === '2048' && button('자료별 설정 초기화').disabled, 'Resetting resource settings must restore inherited values and disable the reset action');
    inputValue(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]'), '72'); await frame();
    removalCategory('이미지').click(); await frame();
    button('이미지 원본 유지').click(); await frame();
    check(modeRadio('manual').checked && !imageCheckbox().checked, 'The preserve-original-images preset must keep the chosen settings mode and turn image conversion off');
    check(document.querySelector('input[aria-label="폰트 무손실 압축 (WOFF)"]').checked && document.querySelector('input[aria-label="ZIP 재압축"]').checked, 'The preserve-original-images preset must retain font compression and ZIP recompression');
    check(['폰트', '이미지', '음원'].every(kind => !removalCategory(kind).checked), 'The preserve-original-images preset must leave deletion disabled');
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]').value === '82', 'Applying a preset must reset resource overrides');
    modeRadio('auto').click(); await frame();
    button('균형').click(); await frame();
    backupCheckbox().labels[0].click(); await frame();
    check(!backupCheckbox().checked, 'Clicking the backup label must disable backup');
    check(!document.querySelector('.epub-optimizer-footer-status small').textContent.includes('bak') && document.querySelector('.epub-optimizer-footer-status small').textContent.includes('원본 파일에'), 'Disabled backup must describe saving directly to original files');
    button('용량 우선').click(); await frame();
    button('균형').click(); await frame();
    check(!backupCheckbox().checked, 'Presets must not reset the global backup choice');
    const originalEstimate = document.querySelector('.epub-optimizer-saving strong').textContent;
    inputValue(document.querySelector('input[type="range"]'), '65'); await frame();
    check(document.querySelector('.epub-optimizer-saving strong').textContent !== originalEstimate, 'Estimate must update with quality');
    rows()[1].click(); await frame();
    check(document.querySelector('input[type="range"]').value === '82', 'Second book must retain its own default');
    rows()[0].click(); await frame();
    check(document.querySelector('input[type="range"]').value === '65', 'First book settings must survive selection changes');
    check(!backupCheckbox().checked, 'Selecting another file must preserve the global backup choice');
    check(['폰트', '이미지', '음원'].every(kind => !removalCategory(kind).checked), 'Removal must be opt-in for every category');
    check(document.querySelector('.epub-optimizer-removal-categories').textContent.includes('삭제 가능 1개 · 512.0 KB'), 'Unused audio candidate size must be visible');
    check(['font', 'image', 'audio'].every(kind => removalPlan(kind) === '삭제 예정 0개 · 0 B'), 'Candidate counts must not imply deletion before the user enables it');
    const beforeRemoval = document.querySelector('.epub-optimizer-saving strong').textContent;
    removalCategory('이미지').click(); await frame();
    removalCategory('폰트').click(); await frame();
    check(document.querySelector('.epub-optimizer-saving strong').textContent !== beforeRemoval, 'Removal must update live estimates');
    check(document.querySelectorAll('.epub-optimizer-removing').length === 2, 'Automatic categories must mark unused resources for removal');
    check(removalPlan('font') === '삭제 예정 1개 · 256.0 KB' && removalPlan('image') === '삭제 예정 1개 · 128.0 KB' && removalPlan('audio') === '삭제 예정 0개 · 0 B', 'Common deletion plans must reflect enabled categories only');
    modeRadio('manual').labels[0].click(); await frame();
    check(modeRadio('manual').checked && !modeRadio('auto').checked, 'Clicking a mode label must update the exclusive selection');
    check(removalCheckbox('Images/unused.png').checked, 'Manual mode must inherit category removal');
    check(conversionCheckbox('Images/unused.png').disabled && !resourceRow('Images/unused.png').querySelector('.epub-optimizer-resource-inputs'), 'A resource selected for deletion must disable conversion and hide irrelevant image controls');
    removalCheckbox('Images/unused.png').click(); await frame();
    check(!conversionCheckbox('Images/unused.png').disabled && resourceRow('Images/unused.png').querySelector('.epub-optimizer-resource-inputs'), 'Excluding an image from deletion must restore its independent conversion controls');
    removalCheckbox('Audio/unused.mp3').click(); await frame();
    check(!removalCheckbox('Images/unused.png').checked && removalCheckbox('Audio/unused.mp3').checked, 'Manual removal must allow exclusions and direct selections');
    check(removalPlan('font') === '삭제 예정 1개 · 256.0 KB' && removalPlan('image') === '삭제 예정 0개 · 0 B' && removalPlan('audio') === '삭제 예정 1개 · 512.0 KB', 'Deletion plans must include individual exclusions and additions');
    modeRadio('auto').click(); await frame();
    check(!removalCheckbox('Audio/unused.mp3') && document.querySelectorAll('.epub-optimizer-removing').length === 2, 'Automatic mode must ignore per-resource overrides');
    check(removalPlan('image') === '삭제 예정 1개 · 128.0 KB' && removalPlan('audio') === '삭제 예정 0개 · 0 B', 'Returning to common settings must ignore individual deletion overrides in plan totals');
    modeRadio('manual').click(); await frame();
    check(!removalCheckbox('Images/unused.png').checked && removalCheckbox('Audio/unused.mp3').checked, 'Returning to manual mode must restore removal overrides');
    check(removalPlan('image') === '삭제 예정 0개 · 0 B' && removalPlan('audio') === '삭제 예정 1개 · 512.0 KB', 'Returning to resource settings must restore individual deletion plan totals');
    check(!removalCheckbox('Images/cover.jpg') && !removalCheckbox('Images/illustration.jpg') && !removalCheckbox('Audio/unknown.mp3'), 'Protected, referenced and uncertain resources must not be removable');
    await selectValue(resourceFilter(), 'unused');
    check(resourceRows().length === 3 && resourceFilter().selectedOptions[0].textContent === '삭제 가능 자료', 'Removable filter must include all candidate categories regardless of selected deletion settings');
    await selectValue(resourceFilter(), 'remove');
    check(resourceRows().length === 2 && resourceRow('Fonts/unused.woff') && resourceRow('Audio/unused.mp3') && !resourceRow('Images/unused.png'), 'Deletion filter must follow individual additions and exclusions');
    await selectValue(resourceFilter(), 'all');
    const resource = conversionCheckbox('Images/illustration.jpg');
    check(!resource.disabled, 'Manual resource option must be available');
    resource.click(); await frame();
    check(!resource.checked, 'Manual exclusion must update immediately');
    check(resourceRow('Images/illustration.jpg').textContent.includes('ZIP 재압축 대상') && !removalCheckbox('Images/illustration.jpg'), 'Excluding image conversion must preserve independent ZIP processing without offering deletion of referenced images');
    document.querySelector('button[aria-label="Images/illustration.jpg · 공통 설정으로"]').click(); await frame();
    check(conversionCheckbox('Images/illustration.jpg').checked && !document.querySelector('button[aria-label="Images/illustration.jpg · 공통 설정으로"]'), 'Resetting one resource must restore common conversion settings and remove its reset action');
    inputValue(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]'), '72'); await frame();
    const beforeBrowsing = document.querySelector('.epub-optimizer-saving strong').textContent;
    const requestCountBeforeBrowsing = requests.length;
    await selectValue(resourceSort(), 'name');
    check(resourceRows()[0].dataset.resource === 'Audio/unknown.mp3' && !button('필터 초기화'), 'Name sorting must not act as a resource filter');
    await selectValue(resourceSort(), 'archive');
    check(resourceRows().map(row => row.dataset.resource).join('|') === analysis(books[0]).resources.map(item => item.name).join('|'), 'Archive sorting must restore source archive order');
    await selectValue(resourceSort(), 'size');
    inputValue(resourceSearch(), '아주 긴 내부 폴더 이름'); await frame();
    check(resourceRows().length === 1 && resourceRow(longResourcePath) && document.querySelector('.epub-optimizer-resource-count').textContent === '전체 ' + totalResources + '개 중 1개', 'Search must find resources by directory paths as well as file names');
    inputValue(resourceSearch(), 'no-such-resource'); await frame();
    check(resourceRows().length === 0 && document.querySelector('.epub-optimizer-resource-range').textContent === '0개' && !document.querySelector('.epub-optimizer-pagination').textContent.includes('1 / 1'), 'Empty search results must show a truthful zero count without a first-page indicator');
    button('필터 초기화').click(); await frame();
    check(!resourceSearch().value && resourceRows().length === totalResources && resourceSort().value === 'size', 'Filter reset must restore the resource view without changing the chosen sort order');
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]').value === '72' && !removalCheckbox('Images/unused.png').checked && removalCheckbox('Audio/unused.mp3').checked, 'Filtering, searching and sorting must preserve resource overrides');
    check(document.querySelector('.epub-optimizer-saving strong').textContent === beforeBrowsing && requests.length === requestCountBeforeBrowsing, 'Browsing resource lists must not change estimates or request inspections or conversions');
    button('체크한 파일에 설정 적용').click(); await frame();
    check(!backupCheckbox().checked, 'Copying per-book settings must preserve the global backup choice');
    rows()[1].click(); await frame();
    check(document.querySelector('input[type="range"]').value === '65', 'General settings must copy to checked book');
    check(document.querySelector('input[aria-label="Images/illustration.jpg · JPEG 품질"]').value === '65', 'Resource overrides must not copy between books');
    check(removalCategory('이미지').checked && removalCategory('폰트').checked, 'Removal categories must copy to checked books');
    check(removalCheckbox('Images/unused.png').checked && !removalCheckbox('Audio/unused.mp3').checked, 'Removal overrides must remain specific to each book');
    rows()[1].querySelector('input[type="checkbox"]').click(); await frame();
    check(rows()[1].getAttribute('aria-selected') === 'true', 'Changing execution checkbox must keep selected workspace');
    check(rows()[0].querySelector('input[type="checkbox"]').checked, 'First book must remain checked');
    check(requests.every(r => r.action === 'inspect'), 'Settings and estimates must never run conversion');
    check(requests.every(r => !Object.hasOwn(r, 'backup')), 'Inspection must not request backup writes');
    backupCheckbox().click(); await frame();
    check(backupCheckbox().checked, 'Backup must be re-enabled before execution');
    check(beforeLeave(), 'Idle tool must allow leaving');
    document.querySelector('.epub-optimizer-body').scrollTop = 0;
    window.captureReady = true;
    await new Promise(resolve => { window.continueTest = resolve; });
    button('최적화 실행 (1)').click();
    check(!beforeLeave(), 'Running tool must guard leaving');
    await until(() => window.completeOptimization && modeRadio('auto')?.matches(':disabled') && modeRadio('manual')?.matches(':disabled'), 'Running optimization must disable both mode choices');
    check(backupCheckbox().disabled, 'Running optimization must lock the backup choice');
    backupCheckbox().click(); await frame();
    check(backupCheckbox().checked, 'Running optimization must prevent backup changes');
    modeRadio('auto').click(); await frame();
    check(modeRadio('manual').checked && !modeRadio('auto').checked, 'Running optimization must prevent mode changes');
    window.completeOptimization();
    await until(() => document.querySelector('.cover-editor-result-modal'), 'Result log did not open');
    const runs = requests.filter(r => r.action === 'optimize');
    check(runs.length === 1 && runs[0].filePath === books[0], 'Execute must process checked files instead of selected row');
    check(runs[0].backup === true && !Object.hasOwn(runs[0].settings, 'backup'), 'Enabled backup must reach execution as a top-level boolean');
    check(runs[0].overwrite === true, 'Execution must explicitly replace the original file');
    check(runs[0].settings.resources['Images/illustration.jpg'].quality === 72, 'Detailed resource settings must reach execution');
    check(runs[0].settings.removeUnusedFonts && runs[0].settings.removeUnusedImages && !runs[0].settings.removeUnusedAudio, 'Removal category settings must reach execution');
    check(runs[0].settings.resources['Images/unused.png'].remove === false && runs[0].settings.resources['Audio/unused.mp3'].remove === true, 'Manual removal overrides must reach execution');
    check(document.querySelector('.result-log-content').value.includes('저장 위치: ' + books[0]), 'Results must include the original file as the saved output path');
    check(document.querySelector('.cover-editor-result-modal').textContent.includes('삭제한 자료 2개 · 768.0 KB'), 'Results must include actual removal count and size');
    check(document.querySelector('.cover-editor-result-modal').textContent.includes('Audio/unused.mp3'), 'Results must list removed resource names');
    check(document.querySelector('.result-log-content').value.includes('백업 위치: /fixture/bak/삽화가 있는 소설.epub'), 'Results must include the saved backup path');
    const firstInspection = requests.filter(r => r.action === 'inspect');
    check(firstInspection.length === 3 && firstInspection[2].filePath === books[0] && firstInspection[2].operationId !== runs[0].operationId, 'Saved originals must be inspected again with a new operation ID');
    check(backupCheckbox().disabled, 'Open results must keep the backup choice locked');
    document.querySelector('.result-log-close').click(); await frame();
    backupCheckbox().click(); await frame();
    check(!backupCheckbox().checked && !backupCheckbox().disabled, 'Closing results must allow disabling backup');
    button('용량 우선').click(); await frame();
    rows()[0].click(); await frame();
    check(!backupCheckbox().checked, 'The disabled backup choice must survive later presets and file selection');
    window.completeOptimization = null;
    window.failNextInspection = true;
    button('최적화 실행 (1)').click();
    await until(() => window.completeOptimization, 'Second optimization did not start');
    check(backupCheckbox().disabled && !backupCheckbox().checked, 'Backup must remain disabled and locked during the second execution');
    window.completeOptimization();
    await until(() => document.querySelector('.cover-editor-result-modal'), 'Second result log did not open');
    const allRuns = requests.filter(r => r.action === 'optimize');
    check(allRuns.length === 2 && allRuns[1].backup === false && !Object.hasOwn(allRuns[1].settings, 'backup'), 'Disabled backup must reach execution as a top-level false boolean');
    check(allRuns[1].expectedFingerprint === books[0] + ':1' && allRuns[1].overwrite === true, 'Later executions must use the refreshed fingerprint of the overwritten file');
    check(!document.querySelector('.result-log-content').value.includes('백업 위치:'), 'Results must omit backup paths when no backup was created');
    check(document.querySelector('.result-log-content').value.includes('저장 위치: ' + books[0]), 'Successful save results must survive a failed reinspection');
    document.querySelector('.result-log-close').click(); await frame();
    check(document.querySelector('.epub-optimizer-inspection-error').textContent.includes('최적화 결과는 저장했지만 다시 분석하지 못했습니다.'), 'Failed reinspection must require inspecting the saved file again');
    check(button('최적화 실행').disabled, 'A failed reinspection must prevent rerunning with stale analysis');
    button('다시 검사').click();
    await until(() => document.querySelector('.epub-optimizer-work-area') && !document.querySelector('[aria-busy="true"]'), 'Manual reinspection did not recover the saved file');
    check(!button('최적화 실행 (1)').disabled && !backupCheckbox().checked, 'Manual reinspection must restore execution without resetting the backup choice');
    window.noRemovalCandidates = true;
    button('다시 검사').click();
    await until(() => document.querySelectorAll('.epub-optimizer-removal-categories input:disabled').length === 3 && !document.querySelector('[aria-busy="true"]'), 'Reinspection with no removal candidates must disable category deletion');
    check([...document.querySelectorAll('.epub-optimizer-removal-categories [data-kind]')].every(card => card.textContent.includes('삭제 후보 없음')), 'Empty deletion categories must explain why deletion is unavailable');
    check(!document.querySelector('.epub-optimizer-removal-plan'), 'Empty deletion categories must not show redundant deletion plans');
    window.fixedLayout = true;
    modeRadio('auto').click(); await frame();
    button('다시 검사').click();
    await until(() => document.querySelector('.epub-optimizer-notice') && !document.querySelector('[aria-busy="true"]'), 'Fixed-layout reinspection did not complete');
    const dimensionInput = () => document.querySelector('.epub-optimizer-image-controls input[aria-label="이미지 최대 긴 변"]');
    check(document.querySelector('.epub-optimizer-notice').textContent.includes('공통 설정') && dimensionInput().value === '0' && dimensionInput().matches(':disabled'), 'Common settings must explain and enforce original image dimensions in fixed-layout EPUBs');
    modeRadio('manual').click(); await frame();
    check(dimensionInput().value === '2048' && !dimensionInput().matches(':disabled'), 'Per-resource settings must restore the configured dimension and allow fixed-layout resizing');
    window.extraResources = true;
    button('다시 검사').click();
    await until(() => button('다음') && !document.querySelector('[aria-busy="true"]'), 'Larger resource lists must expose pagination after reinspection');
    const pagedTotal = analysis(books[0]).resources.length;
    check(resourceRows().length === 40 && document.querySelector('.epub-optimizer-resource-range').textContent === '1–40 / ' + pagedTotal + '개', 'The first resource page must show its actual visible range');
    button('다음').click(); await frame();
    check(resourceRows().length === pagedTotal - 40 && document.querySelector('.epub-optimizer-resource-range').textContent === '41–' + pagedTotal + ' / ' + pagedTotal + '개' && button('다음').disabled, 'The last resource page must report the remaining rows and disable forward navigation');
    await selectValue(resourceFilter(), 'audio');
    check(resourceRows().length === 2 && document.querySelector('.epub-optimizer-resource-range').textContent === '1–2 / 2개' && !button('다음') && !button('이전'), 'Filtering a later page must return to the first range and hide unnecessary pagination');
    return { checks, inspected: requests.filter(r => r.action === 'inspect').length, executed: allRuns.length };
})().catch(error => { window.testFailure = error.message; throw error; });
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<html><head></head><body style="margin:0"><div id="root" style="height:100vh;width:100vw"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, root] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if(level>=2) console.error(message); });
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`)});
    let captureReady = false;
    for (let attempt = 0; attempt < 600; attempt += 1) {
        const state = await window.webContents.executeJavaScript('({ failure: window.testFailure, captureReady: window.captureReady, key: window.keyboardRequest })');
        if (state.failure) throw new Error(state.failure);
        if (state.captureReady) { captureReady = true; break; }
        if (state.key) {
            window.webContents.focus();
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: state.key });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: state.key });
            await window.webContents.executeJavaScript('window.keyboardRequest = null; window.keyboardComplete = true');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!captureReady) throw new Error('Capture timeout');
    if (${Boolean(process.env.BOOKMANAGER_OPTIMIZER_SCREENSHOT)}) {
        await fs.writeFile('/tmp/bookmanager-epub-optimizer.png', (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('document.querySelector(".epub-optimizer-body").scrollTop = document.querySelector(".epub-optimizer-body").scrollHeight');
        await new Promise(resolve => setTimeout(resolve,100));
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-resources.png', (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('document.querySelector(".epub-optimizer-resource-table").scrollTop = document.querySelector(".epub-optimizer-resource-table").scrollHeight');
        await new Promise(resolve => setTimeout(resolve,100));
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-resource-paths.png', (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('document.querySelector(".epub-optimizer-resource-table").scrollTop = 0');
        window.setSize(820,900);
        await new Promise(resolve => setTimeout(resolve,100));
        await window.webContents.executeJavaScript('window.assertCompactResourceRows("Narrow resource rows")');
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-narrow.png', (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('document.querySelector(".epub-optimizer-body").scrollTop += document.querySelector(".epub-optimizer-resources").getBoundingClientRect().top - document.querySelector(".epub-optimizer-body").getBoundingClientRect().top');
        await new Promise(resolve => setTimeout(resolve,100));
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-narrow-resources.png', (await window.webContents.capturePage()).toPNG());
        window.setSize(1280,1000);
        await window.webContents.executeJavaScript('document.querySelector(".epub-optimizer-mode-settings input[value=auto]").click(); document.querySelector(".epub-optimizer-general-settings").scrollIntoView({ block: "start" })');
        await window.webContents.executeJavaScript(${JSON.stringify('document.querySelector(\'input[aria-label="이미지 최적화"]\').click()')});
        await new Promise(resolve => setTimeout(resolve,100));
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-common-image-off.png', (await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript('window.assertCompactResourceRows("Common settings with images off")');
        await fs.writeFile('/tmp/bookmanager-epub-optimizer-row-metrics.json', await window.webContents.executeJavaScript('JSON.stringify(window.compactResourceMetrics, null, 2)'));
        await window.webContents.executeJavaScript(${JSON.stringify('document.querySelector(\'input[aria-label="이미지 최적화"]\').click(); document.querySelector(".epub-optimizer-mode-settings input[value=manual]").click()')});
        await new Promise(resolve => setTimeout(resolve,100));
    }
    const result = await window.webContents.executeJavaScript('window.continueTest(); window.testResult');
    console.log('EPUB_UI_RESULT='+JSON.stringify(result)); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('EPUB UI test timeout: ' + output)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
        });
        assert.equal(output.code, 0, output.output);
        assert.match(output.output, /EPUB_UI_RESULT=.*"executed":2/);
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
